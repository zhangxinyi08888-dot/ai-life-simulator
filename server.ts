import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";
import { queryDynamicLifeEvent } from "./src/data/lifeEvents";
import { callDeepSeekJson, DeepSeekClientConfig } from "./src/utils/deepseek";
import { formatAnswerTurns } from "./src/utils/answerFormatting";
import { formatGeminiErrorForClient, selectMostActionableGeminiError } from "./src/utils/geminiErrors";
import { buildQuestionPrompt } from "./src/utils/questionPrompt";
import { generateCompleteSimulationNode } from "./src/utils/simulationNodeRetry";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json());

type AiClient =
  | { provider: "deepseek"; config: DeepSeekClientConfig }
  | { provider: "gemini"; client: GoogleGenAI };

function getAiClient(): AiClient {
  const deepSeekApiKey = process.env.DEEPSEEK_API_KEY;
  if (deepSeekApiKey) {
    return {
      provider: "deepseek",
      config: {
        apiKey: deepSeekApiKey,
        baseUrl: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
        model: process.env.DEEPSEEK_MODEL || "deepseek-v4-flash"
      }
    };
  }

  const geminiApiKey = process.env.GEMINI_API_KEY;
  if (!geminiApiKey) {
    throw new Error("AI_API_KEY_MISSING");
  }

  return {
    provider: "gemini",
    client: new GoogleGenAI({
      apiKey: geminiApiKey,
      httpOptions: { headers: { "User-Agent": "aistudio-build" } }
    })
  };
}

async function generateContentWithRetry(ai: AiClient, options: { model?: string; contents: any; config?: any }) {
  if (ai.provider === "deepseek") {
    console.log(`[DeepSeek API] Attempting generateContent with model: ${ai.config.model}`);
    const response = await callDeepSeekJson(ai.config, String(options.contents || ""));
    console.log(`[DeepSeek API] Success with model: ${ai.config.model}`);
    return response;
  }

  const models = ["gemini-2.5-flash", "gemini-3.1-flash-lite", "gemini-2.5-flash-lite", "gemini-3.5-flash", "gemini-1.5-flash"];
  const errors: unknown[] = [];

  for (const model of models) {
    try {
      console.log(`[Gemini API] Attempting generateContent with model: ${model}`);
      const response = await ai.client.models.generateContent({
        ...options,
        model: model,
      });
      console.log(`[Gemini API] Success with model: ${model}`);
      return response;
    } catch (err: any) {
      console.error(`[Gemini API] Failed with model: ${model}. Error:`, err.message || err);
      errors.push(err);
    }
  }

  throw selectMostActionableGeminiError(errors);
}

function sendGeminiError(res: express.Response, error: unknown) {
  const clientError = formatGeminiErrorForClient(error);
  return res.status(clientError.status).json(clientError.payload);
}

function parseAiJsonResponse(response: { text?: string }) {
  return JSON.parse(response.text || "{}");
}

function buildNodePromptWithRetryNotice(prompt: string, previousIssues: string[]) {
  if (previousIssues.length === 0) return prompt;

  const issueLabels: Record<string, string> = {
    description: "description 剧情正文",
    attributes: "attributes 五维数值",
    choices: "choices 选项"
  };
  const missingFields = previousIssues.map((issue) => issueLabels[issue] || issue).join("、");

  return `${prompt}

【上一次返回不完整，必须重新生成】
缺失字段：${missingFields}
请重新返回完整 JSON，不要解释，不要省略字段。必须包含：
- description：150-250 字、具体写实的剧情正文；
- attributes：happiness、intelligence、wealth、relation、health 五个数字；
- choices：非结局节点必须正好 3 个选项，结局节点必须 1 个选项。`;
}

function hasCompleteLifeAttributes(attributes: any) {
  return [
    attributes?.happiness,
    attributes?.intelligence,
    attributes?.wealth,
    attributes?.relation,
    attributes?.health
  ].every((value) => typeof value === "number" && Number.isFinite(value));
}

// 1. Endpoint: Generate personalized initial questions with dynamic custom options
app.post("/api/simulator/generate-questions", async (req, res) => {
  try {
    const { userData } = req.body;
    if (!userData) {
      return res.status(400).json({ error: "缺少初始用户数据" });
    }

    let ai;
    try {
      ai = getAiClient();
    } catch (e: any) {
      return res.status(500).json({
        error: "AI_API_KEY_NOT_CONFIGURED",
        message: "未检测到有效的 DeepSeek API 密钥，请在本地 .env 中配置 DEEPSEEK_API_KEY。"
      });
    }

    const prompt = buildQuestionPrompt(userData);

    const response = await generateContentWithRetry(ai, {
      model: "gemini-3.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            questions: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  question: { type: Type.STRING },
                  suggestions: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING }
                  }
                },
                required: ["question", "suggestions"]
              },
              description: "Exactly three items, each containing a personalized question and four to five highly specific first-person suggestion choices."
            }
          },
          required: ["questions"]
        }
      }
    });

    const responseText = response.text || "{}";
    const data = JSON.parse(responseText);
    return res.json(data);

  } catch (error: any) {
    console.error("生成问题失败:", error);
    return sendGeminiError(res, error);
  }
});

// 2. Endpoint: Launch Life Simulation and set Initial Attributes + Start Node
app.post("/api/simulator/start", async (req, res) => {
  try {
    const { userData, answers } = req.body;
    if (!userData || !answers) {
      return res.status(400).json({ error: "信息不足以启动人生推演星轨" });
    }

    let ai;
    try {
      ai = getAiClient();
    } catch (e: any) {
      return res.status(500).json({ error: "AI_API_KEY_NOT_CONFIGURED", message: "未检测到有效的 DeepSeek API 密钥，请在本地 .env 中配置 DEEPSEEK_API_KEY。" });
    }

    const { birthday, birthtime, gender, regressionAge, regressionSituation, regressionChoices, coreStoryFocus, milestones } = userData;

    let milestonesText = "";
    if (milestones && Array.isArray(milestones)) {
      milestonesText = milestones.map((m: any) => `- 【${m.title}】: ${m.content || "未详述"}`).join("\n");
    }

    const prompt = `你是一个极其严谨写实、透彻理解中国现实社会发展规律、经济常识、行业现状和普通人奋斗困局的人生轨迹推演大师。
【核心演变基本原则】：
- 绝对不要写任何玄幻、科幻、神迹或者是绝对极小概率事件。**严禁出现任何诸如‘神秘观察者’、‘特大额海外遗产/信托基金’、‘神秘组织/特工契约’、‘上古套利法门手稿’等。** 所有的遭遇都必须是在现代社会极高概率会发生的事件（如考研失利、第一份工作被扣绩效、为了多挣钱合租远郊房、和前上司或前同事的落地商业合伙摩擦等）。
- 整个推演必须 100% 贴近中国现实社会的真实走向、行业现状和普通人的生活常识。
- 必须基于用户的真实配置与重置背景来严密进行逻辑推导：
  1) 此时处于什么样自设的主客观真实环境？例如：外部阻力（如父母唠叨、资金短缺、考分不足或伴侣态度）是什么？
  2) 在此节点当时由于个人选择（如辞职空窗、回乡创业或勉力买房等）所呈现的真实财务、资源与心理状态。
- 让每个选项和后果都好坏兼容、具有常人所要付出的具体代价（如选择了坚持学术，必然前几年收入清贫、买房退后、压力大，但可能在专业上走得深并感到充实。选择妥协现状进了稳当工作，人变安逸，但会面临三十年如一日的升职天花板与压抑感）。不做一味的倒霉，也不开无敌金手指。

以下是用户的初始配置：
- 真实出生日期：${birthday} (${birthtime || "时间未知"})
- 性别：${gender}
- 年龄起点/人生重置点：${regressionAge || 20} 岁
- 核心关注主线：${
  coreStoryFocus === 'career' ? '职场与创业' : 
  coreStoryFocus === 'romance' ? '恋爱与婚姻' : 
  coreStoryFocus === 'wealth' ? '财富与自由' : 
  coreStoryFocus === 'selftruth' ? '兴趣与理想' : coreStoryFocus
}
- 往昔真实人生大事记：
${milestonesText}
- 当前重置关卡具体情境、当时面临的情况："${regressionSituation || "暂无描述"}"
- 自订分支选项："${regressionChoices || "暂无描述"}"
- 3个剧本背景补全问题与用户的答复：
${formatAnswerTurns(answers, { question: "问题", answer: "答案" }) || "暂无描述"}

请协助输出以下内容：
1. **五维初始值 (initialAttributes)**：
   分配 happiness (幸福度), intelligence (才干与智商), wealth (财富与资源), relation (情商与人际), health (健康状态) 评分 (35-90 之间)，这一数据必须写实地反映在此节点当时由于个人选择所呈现的真实账户与心理写照。
2. **重生起点剧情 (startNode)**：
   - **写实环境描述 (description)**：撰写一段约 150-250 字的情境描述。不要使用生硬华丽的大词、空洞哲理词或文艺描摹，要用极其具体、干练且包含现实事务（例如当时的行业薪水行情、家人的核心争议意见、考学或考公成败落榜的具体通知、第一份工作的技术需求、或在大城市合租的具体租金与生活处境）的写实笔触，客观复现用户在其选定的这一重置点年龄，踏入全新选择或做出转折时，第一个必然会遭遇的社会、职场或生活典型事件。
   - **真实生命阶段名与标题 (stage 和 title)**：生命阶段 stage 必须是人类社会各发展阶段的最真实、大白话代名词（如：“选择前夜”、“初入职场”、“试用期大考”、“考研抉择”等）；标题 title 也必须朴实且完全贴近具体面临的现实议题（如：“偏离兴趣的退路”、“第一份工作的重担”、“转行的迷茫期”等）。
   - **脚踏实地的后续抉择 (choices)**：提供 A, B, C 面向当时具体遭遇抉择时的三个脚踏实地、极其写实、常人所能采取的路线与博弈选项。
   - **4字写实预测标签 (impactSummary)**：如“留校复习”、“大厂实习”、“妥协现状”、“转战副业”，不要用命运隐喻。
   - 保证 isEndingNode 为 false。
   - attributes 必须与生成的 initialAttributes 相等。
   - age 必须等于用户的重置年龄 ${regressionAge || 20}。

请严格以 JSON Schema 形式返回（用中文）。`;

    let latestData: any = {};
    const startNode = await generateCompleteSimulationNode(async (_attempt, previousIssues) => {
      const response = await generateContentWithRetry(ai, {
        model: "gemini-3.5-flash",
        contents: buildNodePromptWithRetryNotice(prompt, previousIssues),
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              initialAttributes: {
                type: Type.OBJECT,
                properties: {
                  happiness: { type: Type.INTEGER },
                  intelligence: { type: Type.INTEGER },
                  wealth: { type: Type.INTEGER },
                  relation: { type: Type.INTEGER },
                  health: { type: Type.INTEGER }
                },
                required: ["happiness", "intelligence", "wealth", "relation", "health"]
              },
              startNode: {
                type: Type.OBJECT,
                properties: {
                  age: { type: Type.INTEGER },
                  stage: { type: Type.STRING },
                  title: { type: Type.STRING },
                  description: { type: Type.STRING },
                  choices: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        id: { type: Type.STRING, description: "A, B, or C" },
                        text: { type: Type.STRING },
                        impactSummary: { type: Type.STRING }
                      },
                      required: ["id", "text", "impactSummary"]
                    }
                  },
                  attributes: {
                    type: Type.OBJECT,
                    properties: {
                      happiness: { type: Type.INTEGER },
                      intelligence: { type: Type.INTEGER },
                      wealth: { type: Type.INTEGER },
                      relation: { type: Type.INTEGER },
                      health: { type: Type.INTEGER }
                    },
                    required: ["happiness", "intelligence", "wealth", "relation", "health"]
                  },
                  isEndingNode: { type: Type.BOOLEAN }
                },
                required: ["age", "stage", "title", "description", "choices", "attributes", "isEndingNode"]
              }
            },
            required: ["initialAttributes", "startNode"]
          }
        }
      });

      latestData = parseAiJsonResponse(response);
      return latestData.startNode || latestData.node || latestData;
    }, { fallbackAge: regressionAge || 20 });

    return res.json({
      ...latestData,
      initialAttributes: hasCompleteLifeAttributes(latestData.initialAttributes)
        ? latestData.initialAttributes
        : startNode.attributes,
      startNode
    });

  } catch (error: any) {
    console.error("启动人生模拟星轨失败:", error);
    return sendGeminiError(res, error);
  }
});

// 3. Endpoint: Advance simulated story to the next life stage node
app.post("/api/simulator/next-node", async (req, res) => {
  try {
    const { userData, answers, history, currentAttributes, selectedDecision, nodeIndex } = req.body;
    if (!userData || !currentAttributes || !selectedDecision) {
      return res.status(400).json({ error: "命运模拟演变所需参数不全" });
    }

    let ai;
    try {
      ai = getAiClient();
    } catch (e: any) {
      return res.status(500).json({ error: "AI_API_KEY_NOT_CONFIGURED", message: "未检测到有效的 DeepSeek API 密钥，请在本地 .env 中配置 DEEPSEEK_API_KEY。" });
    }

    const lastNode = history[history.length - 1];
    const lastAge = lastNode ? lastNode.age : (userData.regressionAge || 20);

    // Query helper for matching life seeds based on current characteristics
    const fallbackAgeCheck = lastAge + 3;
    const seedEvent = queryDynamicLifeEvent(currentAttributes, userData, fallbackAgeCheck);
    const eventSeedPrompt = seedEvent
      ? `\n\n【现实人生事件触发：${seedEvent.title}】\n结合当前角色属性或主线，你在前方流年岁月中触发了一个高概率现实事件：${seedEvent.conceptPrompt}\n请把这个事件设计成当前节点的关键现实局面，并尽量将“是否接受、如何合作、如何取舍、如何承担后果”等重大分叉交给用户通过 A, B, C 选择决定，不要在正文里提前替用户做完选择。`
      : "";

    const historyStr = history.map((item: any, idx: number) => {
      return `【阶段 ${idx + 1} - ${item.age}岁 - ${item.title}】
情节：${item.description}
选择：${item.selectedChoice}`;
    }).join("\n\n");

    const answersText = formatAnswerTurns(answers, { question: "背景补全问题", answer: "用户补充的当时真实信息" });

    const prompt = `你是一个才华横溢、精通大众心理学、社会规律与命运因果抉择的顶级推演大师。
用户正在平行宇宙中改写宿命。请确保接下来的剧情走向与互动选项**深深咬合用户回到这个节点的背后意图、最初面临的困苦，以及他们选择的核心主线**。

核心使命：通过剧本，写实地模拟重新选择一次后，各条生命轨迹在现代中国社会下的真实进展。**不仅要让他们爽快或受挫，更要在字里行间让他们看清自己的内心真我（是更在乎物质和世俗成就，还是追求灵魂自由与心灵平静），从而启发他们在现实生活中的大智慧。**

【用户改写起点与真实背景图谱】
- 性别：${userData.gender}
- 本次重置宿命起点：${userData.regressionAge || 20} 岁
- 当时面临的现实困顿：“${userData.regressionSituation || "暂无描述"}”
- 渴望尝试的平行方向/分支选择：“${userData.regressionChoices || "暂无描述"}”
- 核心关注主线：${
      userData.coreStoryFocus === 'career' ? '事业发展与职场长征' : 
      userData.coreStoryFocus === 'romance' ? '情感羁绊与婚姻现实' : 
      userData.coreStoryFocus === 'wealth' ? '财富积累与抗风险拉扯' : 
      userData.coreStoryFocus === 'selftruth' ? '兴趣理想与世俗对抗' : userData.coreStoryFocus
    }

【3道剧本背景补全问题得到的真实材料】
${answersText || "暂无描述"}

【平行宇宙既往旅程】
${historyStr || "无更早经历"}

【当前精神五维能量值】
- 幸福：${currentAttributes.happiness} | 才智：${currentAttributes.intelligence} | 财富：${currentAttributes.wealth} | 人际：${currentAttributes.relation} | 健康：${currentAttributes.health}

【上一步做出的命运裁决】
用户在刚才的十字路口选择了：【${selectedDecision}】
${eventSeedPrompt}

=========================================
【本次推演具体任务与细节标准】：
1. **年龄前推与精细时空调配（极关键）**：
   - 时间颗粒度必须服务于真实生活，而不是机械跳年。上一节点年龄是 ${lastAge} 岁。
   - 如果当前仍处在重置点后的前 3 个关键节点内，或者本轮出现辞职、合作、复合、买房、外派、创业、裁员、健康危机等重大转折，本次通常只推进数月到 1-2 年。
   - 如果用户选择的是长期稳定积累路线（如持续学习、稳定工作、婚后平稳经营、副业长期耕耘），中后期可自然放宽到 2-4 年，但仍不得粗暴跳过关键冲突。
   - 判定生命阶段 stage（必须契合此新岁数，如青年为“职业前三年”、“转行试水期”，壮年为“中年创业期”、“家庭责任期”等）。
   - 判定诗意、有美学韵味的 4-6 字本章标题 title。
2. **生命落幕判定 (isEndingNode)**：
   - 如果新岁数已经达到 **73 岁及以上**，或者角色的健康值(health)已经**跌破 15**，或者幸福度(happiness)极其低微且步入老年：请触发【人生谢幕最终篇章】。
   - 此时，将 isEndingNode 设为 true。
   - 撰写一段无比唯美、释怀、温柔、回首向来萧瑟处的人情谢幕词（字数200-300字），引导他们在对平行命运的追忆中获得大解脱与心灵启示，平静离世。
   - 此时 choices 必须【只包含唯一一个选项】：
     text: "安详落幕，查看一生洞察"
     impactSummary: "寿终正寝"
3. **活跃真实人生冲突撰写（当 isEndingNode 为 false 时）**：
   - **真实世俗逻辑与好坏相伴（因果不虚）**：逻辑续写上一步抉择的连锁反应。新走的路绝对会伴随着新的、高度写实和高发生概率下的世俗摩擦、代价与收益。例如选择了离线自由职业/辞职折腾，会实打实面临银行余额告急、外卖降级、接不到单面临连续失眠和家庭谴责，但在折腾中也可能享受到掌握时间的纯粹和独当一面的技能。切勿一味顺利，也勿无理倒霉，反映真实的中国现代社会职场与家庭规则下好坏两全的辩证结局，看用户是否愿意为了想要的初心，去忍受相应的必要磨难。
   - **重大转折必须交给用户**：遇到合作邀约、辞职转行、表白复合、买房背债、外派高薪、创业合伙、健康手术等会改变剧本走向的节点时，不要在正文中直接写成已做决定和已发生结局。正文只呈现局面、利弊、压力和诱惑；真正的路线选择必须放入 A, B, C。
   - **内心直面与思想启示**：描述要用极其细腻写实、带有人间烟火味的文字（例如：转行自媒体后，盯着低位个位数点赞失眠、或是坚持理想后面对朋友圈结婚晒房时内心那一下针扎般的失落动摇、或是妥协于高月供置业后在讨厌的指指点点下妥协加班的疲态）。字数控制在 150-250 字。
   - 更新他们的生命五维属性（根据抉择客观、合乎情理地升级或降低属性值，保持在 0-100 内）。
   - 给出【正好三个】高水准、充满真实考验、不仅抉择后续业务/人生实务，更是直接拷问人性的互动选项 A, B, C。每个均配备 4 个字的写实线索 (impactSummary)。

请严格依照 JSON schema 格式返回。`;

    const maxAgeStep = typeof nodeIndex === "number" && nodeIndex < 3 ? 2 : 4;
    const node = await generateCompleteSimulationNode(async (_attempt, previousIssues) => {
      const response = await generateContentWithRetry(ai, {
        model: "gemini-3.5-flash",
        contents: buildNodePromptWithRetryNotice(prompt, previousIssues),
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              age: { type: Type.INTEGER },
              stage: { type: Type.STRING },
              title: { type: Type.STRING },
              description: { type: Type.STRING },
              choices: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    id: { type: Type.STRING, description: "A, B, or C" },
                    text: { type: Type.STRING },
                    impactSummary: { type: Type.STRING }
                  },
                  required: ["id", "text", "impactSummary"]
                }
              },
              attributes: {
                type: Type.OBJECT,
                properties: {
                  happiness: { type: Type.INTEGER },
                  intelligence: { type: Type.INTEGER },
                  wealth: { type: Type.INTEGER },
                  relation: { type: Type.INTEGER },
                  health: { type: Type.INTEGER }
                },
                required: ["happiness", "intelligence", "wealth", "relation", "health"]
              },
              isEndingNode: { type: Type.BOOLEAN }
            },
            required: ["age", "stage", "title", "description", "choices", "attributes", "isEndingNode"]
          }
        }
      });

      return parseAiJsonResponse(response);
    }, {
      fallbackAge: lastAge + 1,
      minAge: lastAge + 1,
      maxAge: lastAge + maxAgeStep
    });
    return res.json(node);

  } catch (error: any) {
    console.error("推演后续命运节点失败:", error);
    return sendGeminiError(res, error);
  }
});

// 4. Endpoint: Analyze personality and provide customized real-life insights
app.post("/api/simulator/analyze-personality", async (req, res) => {
  try {
    const { userData, history, currentAttributes } = req.body;
    if (!userData || !history || !currentAttributes) {
      return res.status(400).json({ error: "缺少分析所需的完整人生轨迹" });
    }

    let ai;
    try {
      ai = getAiClient();
    } catch (e: any) {
      return res.status(500).json({ error: "AI_API_KEY_NOT_CONFIGURED", message: "未检测到有效的 DeepSeek API 密钥，请在本地 .env 中配置 DEEPSEEK_API_KEY。" });
    }

    const historyStr = history.map((item: any, idx: number) => {
      return `【${item.age}岁 - ${item.title} (${item.stage})】
情境描述：${item.description}
用户做出的选择：${item.selectedChoice}`;
    }).join("\n\n");

    const prompt = `你是一位泰斗级的心理学家、命运解读家和极其温柔的成长导师。
用户刚刚在一场虚拟的一生模拟中走完了全部旅程。现在，你需要根据他们在旅程中每一个关键拐弯处做出的抉择、属性的最终沉淀、以及真实世界中的现实背景，为他们出具一份极为深刻、充满艺术感和抚慰力的【一生终极人格与建议报告】。

【用户底色与现实情况】
- 出生生日：${userData.birthday} | 性别：${userData.gender}
- 现实所面临的困惑/现状：${userData.currentSituation}

【模拟的一生回顾】
${historyStr}

【终局属性】
- 幸福：${currentAttributes.happiness} | 才智：${currentAttributes.intelligence} | 财富：${currentAttributes.wealth} | 人际：${currentAttributes.relation} | 健康：${currentAttributes.health}

-----------------------------
【分析任务要素】
请输出以下 8 个结构化板块的内容（语言应具有深度、灵性、亲和力和文学厚度，严禁刻板或套公式）：

1. **终极人生称号 (lifeTitle)**: 一个非常有逼格、文学韵味的人生诗意概括，严禁使用俗套称号。例如："暮色深处的提灯朝圣者", "孤舟涉浪的诗意建筑师", "在烟火深处抱残守缺的漫游者"。
2. **人生墓志铭 (epitaph)**: 一句震撼心灵、温馨、或带有哲思的个人写照。
3. **五个专属性格衡量特质 (personalityTraits)**:
   - 请给这五个维度进行打分（0-100）并撰写详细的为什么得分如是的精辟评价（每项约80字），务必结合他们的模拟选择。属性可以根据他们的行为特征进行翻译（如：“逆境自我治愈率”、“现实物质抱负心”、“感性直觉与利他指数”、“求真探索驱动力”、“社交舒适感与情感守候”等更有灵性的概念）。
4. **深度人格与行为动机剖析 (detailedAnalysis)**:
   - 用大约 2-3 段长文本，系统而深刻地剖析他们为什么会这样选。在哪些关口他们宁可牺牲财富也保护人际？还是为了远方的理想牺牲了当下的幸福？他们的潜意识里，最恐惧的是什么？最期盼的是什么？
5. **现实生活温情照应与建议 (realLifeAdvice)**:
   - 极其关键！请对照用户在现实生活中的困惑：【${userData.currentSituation}】，将这次“模拟人生”的得失当成一面镜子，给他们 1-2 段针对性的破局温情建议。分析他们在现实中是否也带入了这种选择倾向，如何找回内心的平衡、接纳自己的不完美。
6. **个人成长与潜能唤醒建议 (growthAdvice)**:
   - 深度、量身定制的破圈成长指南（约120-150字）。揭露他们的潜意识盲区或思维定势，说明在他们的人格模式下，未来的最佳成长突破点、潜能如何进一步激活。
7. **重大决策学智慧 (decisionAdvice)**:
   - 深度决策风格评估（约120-150字）。分析他们在模拟中体现的高频决策偏好（是直觉型、安全型、防御型还是挑战型），并在面临人生未来的十字路口、学业、职业重大跃迁时，提供科学理性的决策策略与避免认知偏差的忠告。
8. **能量管理与身心幸福指南 (wellnessAdvice)**:
   - 深度自爱与能量管理贴士（约120-150字）。结合他们模拟一生的健康值、幸福感与情商数据，定制一套适合其性格机制的心灵疗愈与日常能量分配法则，指导其在忙碌和不确定的时代中如何达成生活平衡，避免心力枯竭。

请严格根据指定的 JSON schema 格式返回（用中文）。`;

    const response = await generateContentWithRetry(ai, {
      model: "gemini-3.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            lifeTitle: { type: Type.STRING },
            epitaph: { type: Type.STRING },
            personalityTraits: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  trait: { type: Type.STRING },
                  score: { type: Type.INTEGER },
                  description: { type: Type.STRING }
                },
                required: ["trait", "score", "description"]
              }
            },
            detailedAnalysis: { type: Type.STRING },
            realLifeAdvice: { type: Type.STRING },
            growthAdvice: { type: Type.STRING },
            decisionAdvice: { type: Type.STRING },
            wellnessAdvice: { type: Type.STRING }
          },
          required: [
            "lifeTitle",
            "epitaph",
            "personalityTraits",
            "detailedAnalysis",
            "realLifeAdvice",
            "growthAdvice",
            "decisionAdvice",
            "wellnessAdvice"
          ]
        }
      }
    });

    const responseText = response.text || "{}";
    const data = JSON.parse(responseText);
    return res.json(data);

  } catch (error: any) {
    console.error("生成性格分析失败:", error);
    return sendGeminiError(res, error);
  }
});

// 5. Endpoint: Re-calculate and branch story at specific time-travel age
app.post("/api/simulator/time-travel", async (req, res) => {
  try {
    const { userData, answers, history, currentAttributes, targetAge, targetTitle, targetStage, targetDescription } = req.body;
    if (!userData || !currentAttributes || targetAge === undefined) {
      return res.status(400).json({ error: "时光穿梭必备信息缺失" });
    }

    let ai;
    try {
      ai = getAiClient();
    } catch (e: any) {
      return res.status(500).json({ error: "AI_API_KEY_NOT_CONFIGURED", message: "未检测到有效的 DeepSeek API 密钥，请在本地 .env 中配置 DEEPSEEK_API_KEY。" });
    }

    const historyStr = history.map((item: any, idx: number) => {
      return `【阶段 ${idx + 1} - ${item.age}岁 - ${item.title}】
事件：${item.description}
选择：${item.selectedChoice}`;
    }).join("\n\n");

    const answersText = formatAnswerTurns(answers, { question: "背景补全问题", answer: "用户补充的当时真实信息" });

    const prompt = `你是一个极其严谨写实、透彻理解中国现实社会、职场与家庭常识的人生轨迹推演大师。
用户正在进行人生的【时光逆流宿命穿梭】！他们选择推倒了后续岁月中的所有变数，启动时光机，重新回到了【${targetAge}岁】时的核心十字路口。

他们希望能从这一刻起，带着自己重新觉悟的心力，去尝试一条完全不同的选择分支，看清人生的另一面（避免任何玄幻、特工、神秘高人赞助等虚妄事件，必须完全契合落地常识）。

以下是他们当时重新开始的历史锚点场景：
- 年龄：${targetAge}岁 (${targetStage || "流转"} - ${targetTitle || "抉择点"})
- 这一刻当时的经历背景：${targetDescription}
- 当时的五维属性：幸福度 ${currentAttributes.happiness} | 才智 ${currentAttributes.intelligence} | 财富 ${currentAttributes.wealth} | 人际 ${currentAttributes.relation} | 健康 ${currentAttributes.health}

【宿命轨迹契约】
- 性别：${userData.gender}
- 当时选择重置的目标：${userData.regressionAge || 20} 岁遇到的“${userData.regressionSituation || "暂无描述"}”
- 核心关注主线：${
      userData.coreStoryFocus === 'career' ? '事业发展与职场长征' : 
      userData.coreStoryFocus === 'romance' ? '情感羁绊与婚姻现实' : 
      userData.coreStoryFocus === 'wealth' ? '财富积累与抗风险拉扯' : 
      userData.coreStoryFocus === 'selftruth' ? '兴趣理想与世俗对抗' : userData.coreStoryFocus
    }

【3道剧本背景补全问题得到的真实材料】
${answersText || "暂无描述"}

【时光机判定：未被抹去的更早生平回忆】
${historyStr || "这是时光重生的原点（更早无历史记忆）"}

【任务：在此岁数开启完全不同的命运平行宇宙】
请在这里为用户重新谱写全新的命运走向：
- **重新碰撞与现实摩擦（真实因果法则，好坏相伴）**：根据其当前属性、重置后的年龄现实环境和内心反思，重新设计一个极具感染力但高度脚踏实地的全新交叉局面（字数 150-250 字左右）。这一幕应重点突出用户意图改写的方向在该年龄所面临的新一轮客观现实磨练、物质局限和世俗博弈（例如辞职后租房和收入的空窗摩擦、或妥协成婚后平淡的生活微澜）。剧情有得有失、中肯真实、无绝对的金手指爽文套路，反映真实社会的代价。
- **全新分支拷问**：给出【3个全新的分支选项 A, B, C】。每个选项必须包含深刻的社会学深度，体现出不同的现代日常抉择倾向。
- 每个选项要提供正好 4 个字的 impactSummary（写实线索），并确保 isEndingNode 为 false。

请严格依照 JSON schema 格式返回。`;

    const node = await generateCompleteSimulationNode(async (_attempt, previousIssues) => {
      const response = await generateContentWithRetry(ai, {
        model: "gemini-3.5-flash",
        contents: buildNodePromptWithRetryNotice(prompt, previousIssues),
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              age: { type: Type.INTEGER },
              stage: { type: Type.STRING },
              title: { type: Type.STRING },
              description: { type: Type.STRING },
              choices: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    id: { type: Type.STRING, description: "A, B, or C" },
                    text: { type: Type.STRING },
                    impactSummary: { type: Type.STRING }
                  },
                  required: ["id", "text", "impactSummary"]
                }
              },
              attributes: {
                type: Type.OBJECT,
                properties: {
                  happiness: { type: Type.INTEGER },
                  intelligence: { type: Type.INTEGER },
                  wealth: { type: Type.INTEGER },
                  relation: { type: Type.INTEGER },
                  health: { type: Type.INTEGER }
                },
                required: ["happiness", "intelligence", "wealth", "relation", "health"]
              },
              isEndingNode: { type: Type.BOOLEAN }
            },
            required: ["age", "stage", "title", "description", "choices", "attributes", "isEndingNode"]
          }
        }
      });

      const data = parseAiJsonResponse(response);
      return data.newPath || data.node || data;
    }, { fallbackAge: targetAge, minAge: targetAge, maxAge: targetAge });

    return res.json(node);

  } catch (error: any) {
    console.error("时光穿梭推演失败:", error);
    return sendGeminiError(res, error);
  }
});

// Setup Vite Dev Server / Static files handler
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server is running on port ${PORT}`);
  });
}

startServer();

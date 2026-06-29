import { formatAnswerTurns } from "../../utils/answerFormatting";
import { LifeEventSeed } from "../../data/lifeEvents";
import { buildEventIntentPrompt, buildNullEventPrompt } from "../../utils/eventPrompt";
import { StoryContextPack } from "../../utils/storyContext";
import { HistoryItem, LifeAttributes, QuestionTurn, UserInitialData } from "../../types";

function focusLabel(value: string): string {
  if (value === "career") return "事业发展与职场长征";
  if (value === "romance") return "情感羁绊与婚姻现实";
  if (value === "wealth") return "财富积累与抗风险拉扯";
  if (value === "selftruth") return "兴趣理想与世俗对抗";
  if (value === "innerpeace") return "内心平静与自我修复";
  return value || "未指定";
}

function formatMilestones(userData: UserInitialData): string {
  if (Array.isArray(userData.milestones) && userData.milestones.length > 0) {
    return userData.milestones.map((item) => `- 【${item.title}】: ${item.content || "未详述"}`).join("\n");
  }

  return [
    userData.milestoneGaokao ? `- 【高考与升学】: ${userData.milestoneGaokao}` : "",
    userData.milestoneCareer ? `- 【职业经历】: ${userData.milestoneCareer}` : "",
    userData.milestoneRelationship ? `- 【情感经历】: ${userData.milestoneRelationship}` : "",
    userData.milestoneOther ? `- 【其他经历】: ${userData.milestoneOther}` : ""
  ].filter(Boolean).join("\n") || "暂无详述";
}

function formatHistoryForSimulation(history: HistoryItem[]): string {
  return history.map((item, index) => `【阶段 ${index + 1} - ${item.age}岁 - ${item.title}】
情节：${item.description}
选择：${item.selectedChoice}`).join("\n\n");
}

function formatHistoryForInsight(history: HistoryItem[]): string {
  return history.map((item) => `【${item.age}岁 - ${item.title} (${item.stage})】
情境描述：${item.description}
用户做出的选择：${item.selectedChoice}`).join("\n\n");
}

export function buildNodePromptWithRetryNotice(prompt: string, previousIssues: string[]): string {
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

export function buildStartSimulationPrompt(userData: UserInitialData, answers: QuestionTurn[]): string {
  const regressionAge = userData.regressionAge || 20;

  return `你是一个极其严谨写实、透彻理解中国现实社会发展规律、经济常识、行业现状和普通人奋斗困局的人生轨迹推演大师。
【核心演变基本原则】：
- 绝对不要写玄幻、科幻、神迹、神秘组织、海外遗产、特工契约或极小概率金手指。
- 整个推演必须 100% 贴近中国现实社会的真实走向、行业现状和普通人的生活常识。
- 每个选项和后果都必须好坏兼容，包含常人要付出的具体代价。

以下是用户的初始配置：
- 真实出生日期：${userData.birthday} (${userData.birthtime || "时间未知"})
- 性别：${userData.gender}
- 年龄起点/人生重置点：${regressionAge} 岁
- 核心关注主线：${focusLabel(userData.coreStoryFocus)}
- 往昔真实人生大事记：
${formatMilestones(userData)}
- 当前重置关卡具体情境、当时面临的情况："${userData.regressionSituation || "暂无描述"}"
- 自订分支选项："${userData.regressionChoices || "暂无描述"}"
- 3个剧本背景补全问题与用户的答复：
${formatAnswerTurns(answers, { question: "问题", answer: "答案" }) || "暂无描述"}

请协助输出以下内容：
1. initialAttributes：happiness、intelligence、wealth、relation、health 五个 35-90 的写实评分。
2. startNode：用户在 ${regressionAge} 岁重置起点遇到的第一个现实节点。

startNode 要求：
- description：150-250 字，具体、干练、写实，包含现实事务和社会压力。
- stage 和 title：大白话、贴近真实处境。
- choices：A、B、C 三个脚踏实地的路线选项，每个带 4 字 impactSummary。
- isEndingNode 必须为 false。
- attributes 必须与 initialAttributes 相等。
- age 必须等于 ${regressionAge}。

请严格返回 JSON：
{
  "initialAttributes": { "happiness": 50, "intelligence": 50, "wealth": 50, "relation": 50, "health": 50 },
  "startNode": {
    "age": ${regressionAge},
    "stage": "选择前夜",
    "title": "具体标题",
    "description": "150-250字中文剧情",
    "choices": [
      { "id": "A", "text": "具体选择", "impactSummary": "四字标签" },
      { "id": "B", "text": "具体选择", "impactSummary": "四字标签" },
      { "id": "C", "text": "具体选择", "impactSummary": "四字标签" }
    ],
    "attributes": { "happiness": 50, "intelligence": 50, "wealth": 50, "relation": 50, "health": 50 },
    "isEndingNode": false
  }
}`;
}

interface NextNodePromptInput {
  userData: UserInitialData;
  answers: QuestionTurn[];
  history: HistoryItem[];
  currentAttributes: LifeAttributes;
  selectedDecision: string;
  eventSeed?: LifeEventSeed | null;
  storyContext?: StoryContextPack;
}

export function buildNextNodePrompt(input: NextNodePromptInput): string {
  const { userData, answers, history, currentAttributes, selectedDecision, eventSeed, storyContext } = input;
  const lastNode = history[history.length - 1];
  const lastAge = lastNode ? lastNode.age : (userData.regressionAge || 20);
  const eventSeedPrompt = eventSeed
    ? buildEventIntentPrompt(eventSeed, storyContext)
    : buildNullEventPrompt(storyContext);

  return `你是一个才华横溢、精通大众心理学、社会规律与命运因果抉择的顶级推演大师。
请写实模拟用户重新选择一次后，各条生命轨迹在现代中国社会下的真实进展。剧情要咬合用户回到这个节点的真实意图、困苦和核心主线。

【用户改写起点与真实背景图谱】
- 性别：${userData.gender}
- 本次重置宿命起点：${userData.regressionAge || 20} 岁
- 当时面临的现实困顿：“${userData.regressionSituation || "暂无描述"}”
- 渴望尝试的平行方向/分支选择：“${userData.regressionChoices || "暂无描述"}”
- 核心关注主线：${focusLabel(userData.coreStoryFocus)}

【3道剧本背景补全问题得到的真实材料】
${formatAnswerTurns(answers, { question: "背景补全问题", answer: "用户补充的当时真实信息" }) || "暂无描述"}

【平行宇宙既往旅程】
${formatHistoryForSimulation(history) || "无更早经历"}

【当前精神五维能量值】
- 幸福：${currentAttributes.happiness} | 才智：${currentAttributes.intelligence} | 财富：${currentAttributes.wealth} | 人际：${currentAttributes.relation} | 健康：${currentAttributes.health}

【上一步做出的命运裁决】
用户在刚才的十字路口选择了：【${selectedDecision}】
${eventSeedPrompt}

【本次推演任务】
- 上一节点年龄是 ${lastAge} 岁。根据真实生活节奏推进年龄，前期通常推进数月到 1-2 年，中后期可推进 2-4 年。
- 如果新岁数达到 73 岁及以上，或 health 跌破 15，请触发人生谢幕，isEndingNode 为 true，choices 只包含“安详落幕，查看一生洞察”。
- 如果不是结局，请写 150-250 字现实冲突，避免金手指和无理倒霉。
- 给出正好三个 A/B/C 选项，每个带 4 字 impactSummary。
- 返回 age、stage、title、description、choices、attributes、isEndingNode。

请严格返回 JSON。`;
}

export function buildPersonalityPrompt(userData: UserInitialData, history: HistoryItem[], currentAttributes: LifeAttributes): string {
  return `你是一位泰斗级的心理学家、命运解读家和温柔的成长导师。
用户刚刚在虚拟一生模拟中走完旅程。请根据他们每个关键拐弯处的抉择、属性沉淀和真实世界背景，出具一份深刻、抚慰、有现实照应的一生终极人格与建议报告。

【用户底色与现实情况】
- 出生生日：${userData.birthday} | 性别：${userData.gender}
- 现实所面临的困惑/现状：${userData.currentSituation}

【模拟的一生回顾】
${formatHistoryForInsight(history)}

【终局属性】
- 幸福：${currentAttributes.happiness} | 才智：${currentAttributes.intelligence} | 财富：${currentAttributes.wealth} | 人际：${currentAttributes.relation} | 健康：${currentAttributes.health}

请严格返回 JSON，包含：
- lifeTitle
- epitaph
- personalityTraits：五个特质，每项包含 trait、score、description
- detailedAnalysis
- realLifeAdvice
- growthAdvice
- decisionAdvice
- wellnessAdvice`;
}

interface TimeTravelPromptInput {
  userData: UserInitialData;
  answers: QuestionTurn[];
  history: HistoryItem[];
  currentAttributes: LifeAttributes;
  targetAge: number;
  targetTitle?: string;
  targetStage?: string;
  targetDescription?: string;
}

export function buildTimeTravelPrompt(input: TimeTravelPromptInput): string {
  const { userData, answers, history, currentAttributes, targetAge, targetTitle, targetStage, targetDescription } = input;

  return `你是一个极其严谨写实、透彻理解中国现实社会、职场与家庭常识的人生轨迹推演大师。
用户正在进行人生的时光逆流，重新回到【${targetAge}岁】时的核心十字路口，希望从这一刻尝试一条不同分支。

【历史锚点场景】
- 年龄：${targetAge}岁 (${targetStage || "流转"} - ${targetTitle || "抉择点"})
- 当时经历背景：${targetDescription || "暂无描述"}
- 当时五维属性：幸福 ${currentAttributes.happiness} | 才智 ${currentAttributes.intelligence} | 财富 ${currentAttributes.wealth} | 人际 ${currentAttributes.relation} | 健康 ${currentAttributes.health}

【宿命轨迹契约】
- 性别：${userData.gender}
- 原始重置目标：${userData.regressionAge || 20} 岁遇到的“${userData.regressionSituation || "暂无描述"}”
- 核心关注主线：${focusLabel(userData.coreStoryFocus)}

【3道剧本背景补全问题得到的真实材料】
${formatAnswerTurns(answers, { question: "背景补全问题", answer: "用户补充的当时真实信息" }) || "暂无描述"}

【未被抹去的更早生平回忆】
${formatHistoryForSimulation(history) || "这是时光重生的原点（更早无历史记忆）"}

请在此岁数开启完全不同的命运平行宇宙：
- description：150-250 字，突出新方向面临的现实磨练、物质局限和世俗博弈。
- choices：A、B、C 三个全新分支选项，每个带 4 字 impactSummary。
- attributes：五维属性，0-100。
- age 必须等于 ${targetAge}。
- isEndingNode 必须为 false。

请严格返回 JSON。`;
}

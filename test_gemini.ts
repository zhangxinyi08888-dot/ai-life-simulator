import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";
dotenv.config();

const userData: any = {
  birthday: "1995-05-05",
  gender: "男",
  coreStoryFocus: "career",
  milestones: [
    {
      id: "gaokao",
      title: "高考与择学",
      icon: "🎓",
      content: "当年高考志愿失格，为了稳妥听信父母放弃了最感兴趣的专业改报普通电子科，入校深觉枯燥乏味。",
    },
    {
      id: "career",
      title: "首份工作与晋升困难",
      icon: "💼",
      content: "进了一家传统IT外包公司做写代码，起薪低且加班无度。项目不断延期，没有技术沉淀和实质晋升，浑浑噩噩过了几年。",
    }
  ],
  isReturnToPast: true,
  targetAgeNode: "回到过去重新抉择"
};

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.log("No API key");
    return;
  }
  try {
    const ai = new GoogleGenAI({ apiKey });

    const { birthday, birthtime, gender, currentSituation, isReturnToPast, targetAgeNode, coreStoryFocus, milestoneGaokao, milestoneCareer, milestoneRelationship, milestones } = userData;

    let milestonesText = "";
    if (milestones && Array.isArray(milestones)) {
      milestonesText = milestones.map((m: any) => `- 【${m.title}】: ${m.content || "未详述"}`).join("\n");
    } else {
      milestonesText = `- 往昔真实高考与升学：${milestoneGaokao || "暂无描述"}\n- 往昔真实求职与裁员风尘：${milestoneCareer || "暂无描述"}\n- 往昔真实情感姻缘：${milestoneRelationship || "暂无描述"}`;
    }

    const timeTarget = isReturnToPast ? `回到过去节点（${targetAgeNode}）` : "从当前现实情况继续推演";

    const prompt = `你是一个充满智慧与温情的人生分析师与互动小说家。
现在有一个用户准备开始他的一生模拟。以下是他们的初始配置：
- 现实出生日期：${birthday} ${birthtime || "时间未知"}
- 性别：${gender}
- 核心关注主线：${
  coreStoryFocus === 'career' ? '职场与创业' : 
  coreStoryFocus === 'romance' ? '恋爱与婚姻' : 
  coreStoryFocus === 'wealth' ? '财富与自由' : 
  coreStoryFocus === 'selftruth' ? '兴趣与理想' : coreStoryFocus
}
- 往昔真实人生大事迹：
${milestonesText}
- 模拟起始点调整：${timeTarget}

为了让他们模拟的一生更加真实、生动且贴合他们内心隐藏的渴求与特质，请根据以上背景，为他们量身定制【正好3个】深度灵魂追问（用中文）。
这些提问应当具有启发性、心理穿透力，涉及他们对幸福、财富、遗憾、爱或选择的底层态度。
请确保以下条件：
- 语气温暖、柔和、循循善诱，切忌呆板模板化。
- 问题应紧紧针对他们填写的“特定人生遗憾、核心关注主线以及他们最想在平行宇宙中改写的命运节点”。

同时，请为每一个定制的追问生成【正好3个】极具心理共鸣、量身定制的“灵性直觉候选回答/快速选择项”（用中文）。
这些直觉候选项应该分别代表不同的生命切面、格局和本心渴望，帮助用户在面对这一深度追问时快速找到共鸣或启发。
请避免使用任何生硬相同的模板预置选项，选项必须完美契合每一个具体生成的提问内容。

请严格以 JSON 格式返回，包含 questions 数组，其中包含 3 个对象，每个对象有 question 字段 and suggestions（正好有3个简短灵动的回答选项）字段。`;

    console.log("Calling Gemini API with prompt...");
    const response = await ai.models.generateContent({
      model: "gemini-3.1-flash-lite",
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
                  question: { type: Type.STRING, description: "The deeply customized follow-up question." },
                  suggestions: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING },
                    description: "Exactly three distinct, highly personalized candidate answers (choices) for this specific question to spark inspiration."
                  }
                },
                required: ["question", "suggestions"]
              },
              description: "Exactly three items, each containing a personalized question and its three highly specific suggestion choices."
            }
          },
          required: ["questions"]
        }
      }
    });

    console.log("Response text:", response.text);
  } catch (error: any) {
    console.error("Error occurred during generateContent:", error);
  }
}

main();

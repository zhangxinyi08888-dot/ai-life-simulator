import type { UserInitialData } from "../types";

function describeFocus(coreStoryFocus?: string) {
  switch (coreStoryFocus) {
    case "career":
      return "职场与创业（事业发展、技能挑战、岗位选择、行业周期）";
    case "romance":
      return "恋爱与婚姻（亲密关系、家庭阻力、定居规划、现实利益）";
    case "wealth":
      return "财富与自由（收入结构、债务压力、投资机会、风险承受）";
    case "selftruth":
      return "兴趣与理想（天赋兴趣、专业选择、创作冲动、世俗压力）";
    case "innerpeace":
      return "自我安顿（生活节奏、身心状态、关系边界、稳定感）";
    default:
      return coreStoryFocus || "未指定";
  }
}

function formatMilestones(userData: Partial<UserInitialData>) {
  if (Array.isArray(userData.milestones)) {
    return userData.milestones.map((m) => `- 【${m.title}】: ${m.content || "未详述"}`).join("\n");
  }

  return [
    `- 往昔真实高考与升学：${userData.milestoneGaokao || "暂无描述"}`,
    `- 往昔真实求职与职场变化：${userData.milestoneCareer || "暂无描述"}`,
    `- 往昔真实情感与关系经历：${userData.milestoneRelationship || "暂无描述"}`
  ].join("\n");
}

export function buildQuestionPrompt(userData: Partial<UserInitialData>) {
  const {
    birthday,
    birthtime,
    gender,
    coreStoryFocus,
    regressionAge,
    regressionSituation,
    regressionChoices
  } = userData;

  const ageText = regressionAge ? `${regressionAge} 岁` : "用户选择的时间节点";
  const situationText = regressionSituation || "暂无描述";
  const choicesText = regressionChoices || "暂无描述";

  return `你是一个严谨写实的人生剧本建模助手，任务不是判断用户是什么人，而是作为“剧本关键背景补全工具”，为平行人生剧本生成 3 个具体追问。

【最高优先级】
- 用户真实事实 > 追问补全的剧本背景 > 用户在剧本中的选择 > 生辰/星盘/八字假设 > 系统模板。
- 生辰、八字、星盘只能作为提问角度，不能凭空编造现实事实。
- 不要用命理结论替用户补事实；尤其不能编造分数、录取线、工资、家庭资产、伴侣态度、公司规模、健康状况。
- 问题和候选答案必须符合用户选择的时间节点：${ageText}，并紧贴当时情境：“${situationText}”。
- 避免危险假设。例如不要擅自断定“分数卡在一本线边缘”；如果情境涉及高考/志愿，应通过追问确认分数、录取线、家庭预算、专业兴趣、城市选择。

【用户已提供的信息】
1. 生辰信息：
   - 出生日期：${birthday || "未知"} ${birthtime || "时间未知"}
   - 性别：${gender || "未知"}
2. 回溯节点：
   - 年龄/时间节点：${ageText}
   - 当时真实情境：“${situationText}”
   - 当时可选方向或想尝试的改写：“${choicesText}”
3. 本次核心主线：
   - ${describeFocus(coreStoryFocus)}
4. 往昔真实人生大事记：
${formatMilestones(userData)}

=========================================
【三个追问的固定结构】
请生成刚好 3 个问题，顺序必须是：

1. 事实背景追问：当时真实发生了什么？
   - 目标：补齐剧本发生时的事实背景，减少模型幻觉。
   - 必须围绕这个 ${ageText} 节点继续具体化，例如成绩/工作/关系/家庭状态、具体事件、关键人物、城市、钱、学校、岗位、行业、关系进展。
   - 如果已有情境太模糊，要追问最容易写偏的事实，不要追问抽象人生观。

2. 人物状态追问：当时的你是什么状态、什么性格、怎么反应？
   - 目标：让剧本里的用户角色像当时真实的用户。
   - 必须问这个场景下的反应模式，例如遇到压力会硬扛、逃避、找人聊、自己消化；更在意结果、关系、自由、体面还是安全感；表达方式、脾气、敏感点。
   - 不要给用户贴固定人格标签，要问“当时具体怎么反应”。

3. 行动条件追问：你有什么兴趣、能力、资源、限制？
   - 目标：让后续剧情走向有真实依据。
   - 必须问当时实际能做什么、做不到什么；擅长什么、喜欢什么、有哪些支持和资源；朋友、家人、老师、钱、时间、城市机会、身体状态、证书技能等。
   - 必须帮助系统判断哪些剧情走向明显不符合真实情况。

【候选回答要求】
- 每个问题必须提供 4-5 个 suggestions。
- 候选回答要跟随 ${ageText} 和“${situationText}”具体化，不能是通用答案。
- 候选回答必须使用第一人称“我……”口吻，像用户在手机上快速选择自己的真实情况。
- 候选回答应补充可进入剧本的事实素材，例如具体人物、具体限制、能力兴趣、当时反应，而不是空泛情绪。
- 候选回答可以覆盖不同可能性，但不能强迫用户接受系统假设；可以出现“不确定/记不清，但大概是……”这类低负担选项。
- 语言写实、口语化，避免玄学腔、鸡汤腔、夸张宿命感。

请严格依照给定的 JSON Schema 中文返回。`;
}

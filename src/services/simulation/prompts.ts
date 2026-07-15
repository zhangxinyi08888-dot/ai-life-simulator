import { formatAnswerTurns } from "../../utils/answerFormatting";
import { LifeEventSeed } from "../../data/lifeEvents";
import { buildEventIntentPrompt, buildNullEventPrompt } from "../../utils/eventPrompt";
import { StoryContextPack } from "../../utils/storyContext";
import { FinancialState, HistoryItem, LifeAttributes, PressureArcState, QuestionTurn, SimulationNode, UserInitialData, WorldStateSnapshot } from "../../types";
import { AgeContext, formatAgeContextForPrompt } from "../../utils/ageContext";
import { formatPersonStateForPrompt } from "../../utils/personTimeline";
import { formatAgeInMonths, TimelineAdvance } from "../../utils/timelineAdvance";
import { formatFinancialStateForPrompt } from "../../utils/financialState";

const FINANCIAL_NARRATIVE_RULE = `- 正文禁止描述当前存款、积蓄、银行余额、身家、净资产或累计财富的精确总额；需要表达财务状况时，使用“略有积蓄”“现金流紧张”等定性描述，最终金额由系统统一计算和展示。
- 允许描述本阶段实际发生的交易金额，例如月薪、房租、医疗费、首付、贷款、投资额和项目收入。`;

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
  const recent = history.slice(-5);
  const offset = Math.max(0, history.length - recent.length);
  return recent.map((item, index) => `【阶段 ${offset + index + 1} - ${formatAgeInMonths(item.ageInMonths ?? item.age * 12)} - ${item.title}】
情节：${item.description}
选择：${item.selectedChoice}
累计净财富：${item.financialState ? `${item.financialState.netWorthWan} 万元` : "暂无快照"}`).join("\n\n");
}

function formatHistoryForInsight(history: HistoryItem[]): string {
  return history.map((item) => `【${formatAgeInMonths(item.ageInMonths ?? item.age * 12)} - ${item.title} (${item.stage})】
情境描述：${item.description}
用户做出的选择：${item.selectedChoice}`).join("\n\n");
}

function formatAttributeChangeRules(): string {
  return `【属性变化规则】
- attributes 必须由上一步选择和本轮现实后果共同决定，不要只因为选项名称或事件类别机械扣分。
- 属性变化幅度要写实克制，通常每项单轮变化控制在 -12 到 +12。
- 健康由睡眠、持续负荷、运动、医疗、生活环境和恢复条件共同决定；不得仅因为人物处于事业线、收入增加或继续工作就自动降低健康，也不得仅因为停止工作就自动增加健康。
- recoveryState=protected 表示有明确恢复条件，例如睡眠改善、调整工时、委派任务、规律运动、治疗或稳定支持；继续工作也可以是 protected。
- recoveryState=neutral 表示没有持续透支或明显恢复的充分证据，健康通常保持稳定或小幅波动。
- recoveryState=depleted 必须有持续熬夜、症状加重、长期超负荷或无视医疗建议等明确证据；不得仅凭职业或事件类别判断。`;
}

function formatDecisionIntentRules(): string {
  return `【decisionIntent 稳定性规则】
- decisionIntent 是代码识别行动方向的稳定指纹，必须表达“领域:动作:对象”，例如 location:relocate_to:wuhan_guanggu。
- 不能只写 consider_offer、change_job、stay 或 option_a 等模糊动作；必须包含足以区分不同城市、岗位、关系对象或资产的具体对象。
- 展示文案可以变化，但与最近历史语义相同的行动必须复用已有 decisionIntent；不得通过改写文案或更换近义词绕过 cooldown/dormant。
- 语义实质不同的行动必须使用不同 decisionIntent。`;
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
- 年龄只约束行动的执行条件，不约束人生愿望；不得按年龄自动分配学习、工作、家庭、退休或回忆模板。

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
2. initialFinancialState：用户在起点的财务快照，单位均为万元、按当前购买力。
3. startNode：用户在 ${regressionAge} 岁重置起点遇到的第一个现实节点。

initialFinancialState 要求：
- 返回 cashWan、investmentAssetsWan、propertyMarketValueWan、businessAndOtherAssetsWan、totalDebtWan、annualAfterTaxIncomeWan、annualDisposableIncomeWan、annualCoreExpenseWan、employmentStatus、incomeStability、isEstimated。
- employmentStatus 只能是 student、part_time、employed、self_employed、not_working、medical_leave、retired。
- incomeStability 只能是 unstable、volatile、stable、very_stable。
- 只使用用户明确事实或符合职业、城市、年龄的保守估算；缺少依据时使用 5 万或 10 万档位并设置 isEstimated=true。
- 不返回 netWorthWan，净财富和 wealth 由代码计算。

startNode 要求：
- description：150-250 字，具体、干练、写实，包含现实事务和社会压力。
${FINANCIAL_NARRATIVE_RULE}
- stage 和 title：大白话、贴近真实处境。
- choices：A、B、C 三个脚踏实地的路线选项，每个带 4 字 impactSummary。
- 每个 choice 同时返回 temporalHint、decisionIntent、expectedWorldDeltaTypes；至少一个选项推进用户想尝试的方向。
${formatDecisionIntentRules()}
- isEndingNode 必须为 false。
- attributes 必须与 initialAttributes 相等。
- age 必须等于 ${regressionAge}。

请严格返回 JSON：
{
  "initialAttributes": { "happiness": 50, "intelligence": 50, "wealth": 50, "relation": 50, "health": 50 },
  "initialFinancialState": {
    "cashWan": 20, "investmentAssetsWan": 10, "propertyMarketValueWan": 200,
    "businessAndOtherAssetsWan": 0, "totalDebtWan": 120,
    "annualAfterTaxIncomeWan": 30, "annualDisposableIncomeWan": 12,
    "annualCoreExpenseWan": 18, "employmentStatus": "employed", "incomeStability": "stable", "isEstimated": true
  },
  "startNode": {
    "age": ${regressionAge},
    "stage": "选择前夜",
    "title": "具体标题",
    "description": "150-250字中文剧情",
    "choices": [
      { "id": "A", "text": "具体选择", "impactSummary": "四字标签", "decisionIntent": "领域:动作:对象" },
      { "id": "B", "text": "具体选择", "impactSummary": "四字标签", "decisionIntent": "领域:动作:对象" },
      { "id": "C", "text": "具体选择", "impactSummary": "四字标签", "decisionIntent": "领域:动作:对象" }
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
  currentFinancialState?: FinancialState;
  selectedDecision: string;
  eventSeed?: LifeEventSeed | null;
  storyContext?: StoryContextPack;
  timelineAdvance?: TimelineAdvance;
  ageContext?: AgeContext;
  worldState?: WorldStateSnapshot;
  foregroundPressureArc?: PressureArcState;
}

export function buildFinancialSignalsRepairPrompt(input: {
  description: string;
  title: string;
  ageInMonths: number;
  elapsedMonths: number;
  selectedDecision: string;
  currentFinancialState: FinancialState;
  recentHistory: HistoryItem[];
}): string {
  const recentContext = input.recentHistory.slice(-2).map((item) =>
    `- ${formatAgeInMonths(item.ageInMonths ?? item.age * 12)}｜${item.title}：${item.description}`
  ).join("\n") || "- 暂无更早记录";

  return `你只负责补全一段人生剧情对应的财务变化，不得改写剧情、人物、年龄、选项或五维属性。

【时间范围】
- 当前年龄：${formatAgeInMonths(input.ageInMonths)}
- 本阶段共 ${input.elapsedMonths} 个月

【上一步选择】
${input.selectedDecision}

【最近经历】
${recentContext}

【本阶段正文】
标题：${input.title}
${input.description}

【上期财务快照，单位：万元，按当前购买力】
- ${formatFinancialStateForPrompt(input.currentFinancialState)}

【估算规则】
- 优先使用正文明确出现的月薪、月入、年薪、兼职、项目收入、奖金、房租、生活费、学费、医疗费、汇款、债务和资产变化。
- 月薪或稳定月入必须按实际持续月份折算为本阶段总收入；不能把月薪直接当成年收入，也不能把年薪重复乘月份。
- 正文没有写日常生活支出时，结合年龄、学生/工作状态、是否与家人同住、所在城市和上期支出做保守估算，生活支出不能无故为 0。
- “家里欠债”不是用户个人负债；只有用户实际代偿、汇款或共同承担时，才计入本阶段支出。
- 尚未支付的手术费、计划投资和候选选项中的金额不能提前计入；只计算正文已经发生的事实。
- 普通学生或工薪阶段单期净财富变化必须写实。超过 50 万元时，正文必须有房产出售、股权变现、继承、重大负债等明确依据，否则按保守金额重估。
- assetValueChangeWan 只填写已有投资资产的价值涨跌；工资、项目收入和房产变化不能放入该字段。
- propertyMarketValueChangeWan 单独填写房产市值变化：买房或房产升值为正数，卖房或房产贬值为负数；不得与 assetValueChangeWan 重复。
- oneOffIncomeWan 和 oneOffExpenseWan 只记录已经发生的一次性收支；personalDebtChangeWan 只记录用户个人债务净增加或减少。
- 已发生购房时，oneOffExpenseWan 包含首付和税费，propertyMarketValueChangeWan 填写购入房产价值，personalDebtChangeWan 填写新增房贷。
- employmentStatus 只能是 student、part_time、employed、self_employed、not_working、medical_leave、retired。
- incomeStability 只能是 unstable、volatile、stable、very_stable。
- reasons 返回 1-4 条简短依据，必须能在正文或最近经历中找到支持。

只返回以下 JSON，不要 Markdown，不要附加解释：
{
  "financialSignals": {
    "employmentStatus": "employed",
    "monthlyNetIncomeWan": 0,
    "incomeMonths": ${input.elapsedMonths},
    "monthlyLivingExpenseWan": 0,
    "oneOffIncomeWan": 0,
    "oneOffExpenseWan": 0,
    "assetValueChangeWan": 0,
    "propertyMarketValueChangeWan": 0,
    "personalDebtChangeWan": 0,
    "incomeStability": "volatile",
    "confidence": 0.8,
    "reasons": ["估算依据"]
  }
}`;
}

export function buildNextNodePrompt(input: NextNodePromptInput): string {
  const { userData, answers, history, currentAttributes, currentFinancialState, selectedDecision, eventSeed, storyContext, timelineAdvance, ageContext, worldState, foregroundPressureArc } = input;
  const lastNode = history[history.length - 1];
  const lastAge = lastNode ? lastNode.age : (userData.regressionAge || 20);
  const eventSeedPrompt = eventSeed
    ? buildEventIntentPrompt(eventSeed, storyContext)
    : buildNullEventPrompt(storyContext);
  const targetAgeInMonths = timelineAdvance?.targetAgeInMonths ?? (lastAge + 1) * 12;
  const elapsedMonths = timelineAdvance?.elapsedMonths ?? 12;
  const ageContextPrompt = ageContext ? formatAgeContextForPrompt(ageContext) : `【当前年龄与世界状态】\n- 目标时间：${Math.floor(targetAgeInMonths / 12)}岁`;
  const peoplePrompt = worldState?.people.length
    ? worldState.people.map(formatPersonStateForPrompt).map((item) => `- ${item}`).join("\n")
    : "- 暂无结构化人物状态";
  const pressurePrompt = foregroundPressureArc
    ? `pressureArcId=${foregroundPressureArc.id}，phase=${foregroundPressureArc.phaseId}。模型不得修改 phase，只能返回 arcSignals。`
    : "当前没有前台 PressureArc；事件只能提出事实结果，不能自行创建或修改 Arc 状态。";
  const pressureResolutionRule = foregroundPressureArc?.phaseId === "operation"
    ? `
【当前阶段收束要求】
- 本节点必须写清当前阶段压力最终形成了什么结果。
- arcSignals 必须返回 pressure_resolved。
- evidence 必须是正文中直接描述该结果的原句。
- pressureArcId 必须为 ${foregroundPressureArc.id}。
- 这里只表示阶段压力解决，不表示 DirectionArc 或长期人生方向完成。`
    : "";

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

【当前财务快照，单位：万元，按当前购买力】
- ${formatFinancialStateForPrompt(currentFinancialState)}

${ageContextPrompt}

【当前人物状态】
${peoplePrompt}

【PressureArc 单写者边界】
${pressurePrompt}
${pressureResolutionRule}

【上一步做出的命运裁决】
用户在刚才的十字路口选择了：【${selectedDecision}】
${eventSeedPrompt}

【本次推演任务】
- 目标时间由代码确定为 ageInMonths=${targetAgeInMonths}，本轮经过 ${elapsedMonths} 个月；不要自行跳年。
- 本轮 LifeIntensity=${timelineAdvance?.lifeIntensity || "normal"}，由 PressureArc 当前 phase 或新事件首阶段决定。
- 本轮只生成普通 decision checkpoint，isEndingNode 必须为 false；终章由代码的有界长寿规则另行决定。
- 如果不是结局，请写 150-250 字现实冲突，避免金手指和无理倒霉。
${FINANCIAL_NARRATIVE_RULE}
- 年龄约束执行条件，不约束人生愿望。45岁读书、55岁创业、70岁写书、80岁旅行、90岁研究均可成立。
- 每个非终章节点至少一个选项继续推进用户当前方向；禁止三个选项共同导向退休、照护、退出或回忆。
- 只有真正改变未来的选择才能成为节点；复查、等待、恢复等无新分歧过程放入 storyEpisode.internalTransitions。
- 给出正好三个 A/B/C 选项，每个带 4 字 impactSummary、temporalHint、decisionIntent、expectedWorldDeltaTypes。
${formatDecisionIntentRules()}
- narrativeMeta 必须返回 recoveryState、recoveryEvidence、arcSignals、worldDeltas、activeCharacters、primaryActivity、storyEpisode。
- financialSignals 必须放在返回 JSON 顶层，返回 employmentStatus、monthlyNetIncomeWan、incomeMonths、monthlyLivingExpenseWan、oneOffIncomeWan、oneOffExpenseWan、assetValueChangeWan、propertyMarketValueChangeWan、personalDebtChangeWan、incomeStability、confidence、reasons。
- incomeMonths 必须在 0-${elapsedMonths} 之间。正文出现月薪、年薪、兼职、项目收入、房租、医疗、教育、汇款或债务时，必须反映到对应字段。
- 只返回财务事实信号，不要自行返回 netWorthWan、netWorthChangeWan、financialChange 或计算 wealth；这些值由代码统一计算。
- 不要返回 netWorthWan、netWorthChangeWan 或自行计算 wealth；这些值由代码根据财务变化统一计算。
- 收入、支出和资产变化必须与 description 一致；借款、还本金和购买资产不得重复当作净财富损益。
- arcSignals 只能提出“发生了什么”及 evidence，禁止返回 nextPhaseId、nextPressureArcStatus、foregroundPressureArcId 或修改 checkpointCount。
- 返回 age、ageInMonths、stage、title、description、choices、attributes、isEndingNode、narrativeMeta。

${formatAttributeChangeRules()}

请严格返回 JSON。`;
}

export function buildEndingNodePrompt(input: {
  userData: UserInitialData;
  history: HistoryItem[];
  candidateNode: SimulationNode;
  targetAgeInMonths: number;
  forcedByHardMaximum: boolean;
}): string {
  return `你正在为一段写实人生生成自然终章。终章由代码判定，不需要解释概率，也不要描写猎奇或羞辱性的死亡过程。

【目标时间】
${Math.floor(input.targetAgeInMonths / 12)}岁，ageInMonths=${input.targetAgeInMonths}

【用户长期方向】
${input.userData.regressionChoices || input.userData.currentSituation || "未明确"}

【最近人生】
${formatHistoryForSimulation(input.history.slice(-5))}

【本轮选择产生的现实后果】
${input.candidateNode.description}

【本轮财务结果】
${input.candidateNode.financialState ? formatFinancialStateForPrompt(input.candidateNode.financialState) : "暂无结构化财务快照"}

要求：
- 写 150-250 字自然收束，结合最近选择、关系、事业、健康和长期方向。
- 不要把年龄本身写成失败，不要使用突然灾难或具体猎奇死因。
- title、stage、description 要面向完整人生收束。
${FINANCIAL_NARRATIVE_RULE}
- attributes 必须与候选后果一致。
- isEndingNode=true。
- choices 只返回 [{"id":"ENDING","text":"安详落幕，查看一生洞察","impactSummary":"一生回望"}]。
- 不返回 Arc phase 修改。
- ${input.forcedByHardMaximum ? "这是系统绝对年龄上限的终章。" : "这是有界长寿概率触发的自然终章。"}

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
${FINANCIAL_NARRATIVE_RULE}
- choices：A、B、C 三个全新分支选项，每个带 4 字 impactSummary。
- 每个 choice 必须返回 temporalHint、decisionIntent、expectedWorldDeltaTypes。
${formatDecisionIntentRules()}
- attributes：五维属性，0-100。
- age 必须等于 ${targetAge}。
- isEndingNode 必须为 false。

请严格返回 JSON。`;
}

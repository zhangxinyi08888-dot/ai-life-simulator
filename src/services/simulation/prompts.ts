import { formatAnswerTurns } from "../../utils/answerFormatting";
import { LifeEventSeed } from "../../data/lifeEvents";
import { buildEventIntentPrompt, buildNullEventPrompt } from "../../utils/eventPrompt";
import { StoryContextPack } from "../../utils/storyContext";
import { EmploymentTransitionProposal, FinancialState, HistoryItem, LifeAttributes, PressureArcState, QuestionTurn, SimulationNode, UserInitialData, WorldStateSnapshot } from "../../types";
import { AgeContext, formatAgeContextForPrompt } from "../../utils/ageContext";
import { formatPersonStateForPrompt } from "../../utils/personTimeline";
import { formatAgeInMonths, TimelineAdvance } from "../../utils/timelineAdvance";
import { formatFinancialStateForPrompt } from "../../utils/financialState";
import type { FinancialEventProposal, FinancialLedger, FinancialLedgerIssue } from "../../domain/finance";

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
    description: "descriptionParagraphs 剧情正文段落",
    attributes: "attributes 五维数值",
    choices: "choices 选项",
    eventOutcomeId: "choice.eventOutcomeId 缺失或不在本事件 allowedOutcomes 中",
    eventOutcomeCoverage: "三个 choice 没有覆盖至少两个不同的 eventOutcomeId"
  };
  const missingFields = previousIssues.map((issue) => issueLabels[issue] || issue).join("、");
  const outcomeRetryRule = previousIssues.some((issue) => issue === "eventOutcomeId" || issue === "eventOutcomeCoverage")
    ? "\n- eventOutcomeId：每个 choice 都必须从当前事件 allowedOutcomes 中原样选择；三个 choice 至少覆盖两个不同值。"
    : "";

  return `${prompt}

【上一次返回不完整，必须重新生成】
缺失字段：${missingFields}
请重新返回完整 JSON，不要解释，不要省略字段。必须包含：
- descriptionParagraphs：2-4 个字符串组成的数组，总计 150-250 字；每个数组项必须是一段完整、具体、写实的正文；
- attributes：happiness、intelligence、wealth、relation、health 五个数字；
- choices：非结局节点必须正好 3 个选项，结局节点必须 1 个选项。${outcomeRetryRule}`;
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
- 只使用用户明确事实或符合职业、城市、年龄的保守估算；学生缺少依据时个人净财富使用 0-3 万元，其他阶段才使用 5 万或 10 万档位，并设置 isEstimated=true。
- 学生的 totalDebtWan 只记录助学贷款、信用卡、分期或其他明确属于用户本人的债务；家庭债务不得算到学生个人名下，没有个人借款依据时填 0。
- 学生缺少额外财务事实时，基础学费和生活费默认由家庭基本支持覆盖，个人收支持平；只有正文明确出现兼职、奖学金、个人额外自费或个人借款时，才改变个人财富。
- 不返回 netWorthWan，净财富和 wealth 由代码计算。

startNode 要求：
- descriptionParagraphs：2-4 个完整自然段组成的字符串数组，总计 150-250 字，具体、干练、写实，包含现实事务和社会压力。
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
    "descriptionParagraphs": ["第一段完整剧情", "第二段完整剧情"],
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
  currentFinancialLedger?: FinancialLedger;
  selectedOutcomeId?: string;
  selectedDecision: string;
  eventSeed?: LifeEventSeed | null;
  storyContext?: StoryContextPack;
  timelineAdvance?: TimelineAdvance;
  ageContext?: AgeContext;
  worldState?: WorldStateSnapshot;
  foregroundPressureArc?: PressureArcState;
}

export function buildNextNodePrompt(input: NextNodePromptInput): string {
  const { userData, answers, history, currentAttributes, currentFinancialState, currentFinancialLedger, selectedDecision, eventSeed, storyContext, timelineAdvance, ageContext, worldState, foregroundPressureArc } = input;
  const lastNode = history[history.length - 1];
  const lastAge = lastNode ? lastNode.age : (userData.regressionAge || 20);
  const selectedOutcomeId = input.selectedOutcomeId;
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
    ? `pressureArcId=${foregroundPressureArc.id}，phase=${foregroundPressureArc.phaseId}，当前压力主线=${foregroundPressureArc.unresolvedSummary}。本节点事件只提供场景，不得替换这条压力主线；模型不得修改 PressureArc 的 id、eventId、phase 或 status，只能返回 arcSignals。`
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
  const healthPhaseRule = foregroundPressureArc?.phasePolicyId === "health_crisis_v1"
    ? foregroundPressureArc.phaseId === "trigger"
      ? `
【健康危机触发阶段】
- 本节点写清身体或心理状态为什么迫使原生活节奏发生中断。
- 不把继续人生方向等同于维持原有负荷。
- 选择必须包含调整执行方式的中间路径。
- 这是本次健康 Arc 唯一允许使用“停摆、住院、被迫暂停”等急性危机表达的节点。`
      : foregroundPressureArc.phaseId === "recovery"
        ? `
【健康恢复与观察阶段】
- 延续同一次健康压力，但不得再次制造新的停摆、住院或突发恶化来重复 trigger。
- 重点写治疗、睡眠、工时、任务委派、运动、照护支持或生活结构调整是否真正建立。
- protected 只表示恢复条件成立，不表示已经治愈。
- 允许继续原有人生方向，但必须说明执行方式如何改变。
- 若恢复条件已经建立，可返回 pressure_addressed 或 stability_reached；evidence 必须是正文原句。`
        : foregroundPressureArc.phaseId === "operation"
          ? `
【健康压力阶段结果】
- 本节点必须写清这次健康压力最终形成了什么阶段结果。
- 结果可以是恢复、长期管理、带病调整、接受边界或治疗效果有限。
- 不得把阶段结果写成完全治愈，也不得把 PressureArc resolve 写成人生完成。
- arcSignals 必须返回 pressure_resolved。
- pressureArcId 必须与当前前台 PressureArc 一致。
- evidence 必须是正文中直接描述结果的完整原句。
- 本节点不得引入另一项需要长期跟进的重大危机。`
          : ""
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

【当前权威账本受限摘要】
${formatRestrictedFinancialLedger(currentFinancialLedger)}

${ageContextPrompt}

【当前人物状态】
${peoplePrompt}

【PressureArc 单写者边界】
${pressurePrompt}
${pressureResolutionRule}
${healthPhaseRule}

【上一步做出的命运裁决】
用户在刚才的十字路口选择了：【${selectedDecision}】
${selectedOutcomeId ? `该选择对应的已接受 outcome id：【${selectedOutcomeId}】` : "该选择没有结构化 outcome id；不得凭空提交就业状态转换。"}
${eventSeedPrompt}

【本次推演任务】
- 目标时间由代码确定为 ageInMonths=${targetAgeInMonths}，本轮经过 ${elapsedMonths} 个月；不要自行跳年。
- 本轮 LifeIntensity=${timelineAdvance?.lifeIntensity || "normal"}，由 PressureArc 当前 phase 或新事件首阶段决定。
- 本轮只生成普通 decision checkpoint，isEndingNode 必须为 false；终章由代码的有界长寿规则另行决定。
- 如果不是结局，请通过 descriptionParagraphs 返回 2-4 个完整自然段，总计 150-250 字现实冲突，避免金手指和无理倒霉；每个数组项只能包含一个完整段落。
${FINANCIAL_NARRATIVE_RULE}
- 年龄约束执行条件，不约束人生愿望。45岁读书、55岁创业、70岁写书、80岁旅行、90岁研究均可成立。
- 每个非终章节点至少一个选项继续推进用户当前方向；禁止三个选项共同导向退休、照护、退出或回忆。
- 只有真正改变未来的选择才能成为节点；复查、等待、恢复等无新分歧过程放入 storyEpisode.internalTransitions。
- 给出正好三个 A/B/C 选项，每个带 4 字 impactSummary、temporalHint、decisionIntent、expectedWorldDeltaTypes；有事件种子时还必须带 eventOutcomeId。
${formatDecisionIntentRules()}
- narrativeMeta 必须返回 recoveryState、recoveryEvidence、arcSignals、worldDeltas、activeCharacters、primaryActivity、storyEpisode。
- 只有主角在本阶段已经明确入职、离职、创业、停工休养或退休时，career_state worldDelta 才能增加 employmentTransition；必须返回 subject="protagonist"、toStatus、effectiveAtAgeInMonths、sourceOutcomeId、正文原句 evidence 和 confidence。sourceOutcomeId 必须等于上方已接受 outcome id；没有该 id 时不得返回 employmentTransition。
- 其他人物上学、退休、工作，或主角参加课程、考虑辞职、计划创业，都不能产生 employmentTransition。没有明确转换时保持当前就业状态。
${targetAgeInMonths >= 55 * 12 ? "- 主角已满 55 岁：如果 description 明确写出已经退休、离职或停止工作，必须同时提交 employmentTransition，以及结束或暂停账本摘要中 linkedCareerStateId 对应当前职业的工资收入；租金、版税、年金等非职业收入不得结束。" : ""}
${formatMissingCareerIncomeRule(currentFinancialLedger, currentFinancialState?.employmentStatus)}
${formatFinancialCompletenessRules(currentFinancialLedger, targetAgeInMonths)}
- financialEventProposals 必须放在返回 JSON 顶层；没有已经发生的财务变化时返回空数组，不得重复返回全部现有余额。
- 每项 Proposal 必须包含 id、kind、effectiveAtAgeInMonths、payload、sourceOutcomeId、evidence、confidence。sourceOutcomeId 必须等于上方已接受 outcome id；没有该 id 时返回空数组。
- evidence 必须摘自 description 中已经发生的事实句；系统会做标点、空白和金额锚定匹配。confidence 在 0.8-1 时按明确事实提交，0.6-0.8 时按 estimated 提交；低于 0.6、候选选项、计划和意向不能提交。
- 持续收入或支出分别使用 income_source_started/adjusted/paused/ended 与 expense_commitment_started/adjusted/ended；一次性收支使用 one_off_income_received/one_off_expense_paid。
- 新工作工资不得与账本摘要里的旧职业收入叠加：同一职业内薪资变化优先用 income_source_adjusted；换工作必须同时提交旧职业收入的 income_source_ended 和带 linkedCareerStateId 的新 income_source_started。职业、组织或岗位改变时，即使 employmentStatus 仍为 employed，也要提交新的 employmentTransition。
- 正文必须严格区分月薪和年薪：年薪 22 万不得写成月薪 22 万；Proposal 的 monthlyNetAmountWan 与正文月薪必须相同，annualNetAmountWan 与正文年薪必须相同。
- 借款、还本、利息、资产购买、资产出售和重估必须使用各自有方向的事件；不得返回债务净变化、资产净变化或最终余额。
- 公司融资只能用 business_financing_recorded，payload.personalCashReceivedWan 必须为 0；个人分红和出售持股分别使用 business_distribution_received、business_holding_sold。
- employmentStatus 不属于财务 Proposal，只能通过 career_state.employmentTransition 提交。
- 所有金额单位都是万元，例如 500 元=0.05 万元；不要返回 incomeMonths、netWorthWan、netWorthChangeWan、financialChange 或自行计算 wealth。
- 学生阶段的估算基础生活费已有家庭基本支持对冲；不得仅因正常上学生活费提交个人负债。只有正文明确出现助学贷款、分期、信用卡或个人借款时才提交 debt_drawn。
- 不要返回 netWorthWan、netWorthChangeWan 或自行计算 wealth；这些值由代码根据财务变化统一计算。
- 收入、支出和资产变化必须与 descriptionParagraphs 正文一致；借款、还本金和购买资产不得重复当作净财富损益。
- arcSignals 只能提出“发生了什么”及 evidence，禁止返回 nextPhaseId、nextPressureArcStatus、foregroundPressureArcId 或修改 checkpointCount。
- 严格按 title、descriptionParagraphs、其余字段的顺序输出，便于逐段呈现；不要重复返回 description 字符串。
- 返回 title、descriptionParagraphs、age、ageInMonths、stage、choices、attributes、financialEventProposals、isEndingNode、narrativeMeta。

financialEventProposals 示例（仅在正文确实发生对应事实时使用；否则返回 []）：
[
  {
    "id": "income_start_current_node",
    "kind": "income_source_started",
    "effectiveAtAgeInMonths": ${targetAgeInMonths},
    "payload": {
      "id": "income_current_node",
      "type": "salary",
      "displayName": "当前工作税后工资",
      "monthlyNetAmountWan": 2.5,
      "accrualPolicy": "monthly",
      "activeFromAgeInMonths": ${targetAgeInMonths},
      "status": "active",
      "factStatus": "estimated",
      "evidence": []
    },
    "sourceOutcomeId": ${selectedOutcomeId ? `"${selectedOutcomeId}"` : "null"},
    "evidence": "你正式入职，税后月薪为2.5万元。",
    "confidence": 0.9
  }
]

高频事件补充示例：
- 薪资调整：{ "kind": "income_source_adjusted", "payload": { "incomeSourceId": "必须从账本摘要选择", "nextSource": { "id": "与 incomeSourceId 完全相同", "type": "salary", "monthlyNetAmountWan": 4.8, "accrualPolicy": "monthly", "activeFromAgeInMonths": ${targetAgeInMonths}, "status": "active", "factStatus": "estimated", "evidence": [] } } }
- 房贷借入：debt_drawn 创建 mortgage 债务并把本金转入现金账户；买房另用 asset_purchased，并通过 linkedDebtDrawEventId 引用该借款 Proposal id。还本金只用 debt_principal_repaid，不能写债务净变化。
- 持股估值：只有融资额而没有可靠估值时先提交 business_financing_recorded，personalCashReceivedWan=0；已有持股标 needs_review。只有正文同时给出估值或可验证持股价值时才提交 business_holding_revalued。

${formatAttributeChangeRules()}

请严格返回 JSON。`;
}

export function formatRestrictedFinancialLedger(ledger?: FinancialLedger): string {
  if (!ledger) return "- 暂无 V2 账本；本轮只能创建正文明确发生的新来源或账户。";
  const cash = ledger.cashAccounts.filter((item) => item.status === "active").map((item) => (
    `- 现金账户 ${item.id}: type=${item.type}, balance=${item.balanceWan}, factStatus=${item.factStatus}`
  ));
  const income = ledger.incomeSources.filter((item) => item.status !== "ended").map((item) => (
    `- 收入来源 ${item.id}: type=${item.type}, status=${item.status}, monthly=${item.monthlyNetAmountWan ?? "-"}, annual=${item.annualNetAmountWan ?? "-"}, factStatus=${item.factStatus}, review=${item.accrualReviewStatus ?? "normal"}, lastConfirmed=${item.lastConfirmedAtAgeInMonths ?? "-"}`
  ));
  const expenses = ledger.expenseCommitments.filter((item) => item.status !== "ended").map((item) => (
    `- 支出义务 ${item.id}: type=${item.type}, status=${item.status}, monthly=${item.monthlyAmountWan}, factStatus=${item.factStatus}`
  ));
  const debts = ledger.debtAccounts.filter((item) => item.status === "active").map((item) => (
    `- 债务账户 ${item.id}: type=${item.type}, principal=${item.principalWan}, policy=${item.repaymentPolicy.mode}, factStatus=${item.factStatus}`
  ));
  const holdings = ledger.businessHoldings.filter((item) => item.status !== "sold").map((item) => (
    `- 持股 ${item.id}: company=${item.business.displayName}, carryingValue=${item.personalCarryingValueWan}, factStatus=${item.factStatus}`
  ));
  const issues = ledger.unresolvedIssues.filter((item) => item.status !== "resolved").map((item) => (
    `- open issue ${item.id}: code=${item.code}, occurrences=${item.occurrenceCount ?? 1}, age=${item.createdAtAgeInMonths}-${item.lastObservedAtAgeInMonths ?? item.createdAtAgeInMonths}, ${item.summary}`
  ));
  return [...cash, ...income, ...expenses, ...debts, ...holdings, ...issues].join("\n") || "- 当前没有有效收入、支出、债务、持股或 open issue。";
}

function formatMissingCareerIncomeRule(ledger: FinancialLedger | undefined, employmentStatus: FinancialState["employmentStatus"] | undefined): string {
  if (!ledger || !["employed", "self_employed", "part_time"].includes(employmentStatus || "")) return "";
  const hasCareerIncome = ledger.incomeSources.some((source) => source.status === "active" && Boolean(source.linkedCareerStateId) && source.accrualPolicy !== "event_only");
  if (hasCareerIncome) return "";
  return "- 当前身份仍为在职/自雇，但账本没有有效职业收入来源。本节点必须在 description 中明确说明当前税后月薪或年薪并提交对应职业收入 Proposal；如果确实无薪或工资延期，必须明确写出无薪事实，不得用公司合同额、融资额或营收代替个人收入。";
}

function formatFinancialCompletenessRules(ledger: FinancialLedger | undefined, targetAgeInMonths: number): string {
  if (!ledger) return "";
  const rules: string[] = [];
  const hasActiveExpense = ledger.expenseCommitments.some((item) => item.status === "active");
  if (targetAgeInMonths >= 18 * 12 && !hasActiveExpense) {
    rules.push("- 当前是成年阶段，但账本没有任何有效生活支出。description 必须根据本阶段明确的住房、家庭和生活方式写出保守的每月核心支出，并提交 factStatus=estimated 的 expense_commitment_started；不得继续填 0，也不得把无法证明的精确金额标 known。");
  }
  if (targetAgeInMonths >= 55 * 12) {
    const staleCareerSources = ledger.incomeSources.filter((source) => (
      source.status === "active"
      && Boolean(source.linkedCareerStateId)
      && targetAgeInMonths - (source.lastConfirmedAtAgeInMonths ?? source.activeFromAgeInMonths) >= 36
    ));
    if (staleCareerSources.length) {
      rules.push(`- 以下晚年职业收入超过36个月未确认：${staleCareerSources.map((source) => source.id).join("、")}。description 必须明确主角是否仍实际工作；继续工作则提交收入调整/确认 Proposal，已经停止则提交 employmentTransition 与工资结束。不得仅凭年龄自动退休。`);
    }
  }
  return rules.join("\n");
}

export function buildFinancialProposalRepairPrompt(input: {
  rejectedProposals: FinancialEventProposal[];
  rejectedEmploymentTransition?: EmploymentTransitionProposal;
  issues: FinancialLedgerIssue[];
  ledger: FinancialLedger;
  acceptedOutcomeId: string;
  narrativeText: string;
  periodStartAgeInMonths: number;
  periodEndAgeInMonths: number;
}): string {
  return `你只修复财务 Proposal，不得重写故事正文，不得返回解释。

【不可修改的当前正文】
${input.narrativeText}

【本阶段范围】
ageInMonths=${input.periodStartAgeInMonths} 到 ${input.periodEndAgeInMonths}

【必须引用的 outcome id】
${input.acceptedOutcomeId}

【当前权威账本受限摘要】
${formatRestrictedFinancialLedger(input.ledger)}

【被拒 Proposal】
${JSON.stringify(input.rejectedProposals, null, 2)}

【被拒或待补齐的职业转换】
${JSON.stringify(input.rejectedEmploymentTransition || null, null, 2)}

【逐条拒绝原因】
${JSON.stringify(input.issues.map((issue) => ({ proposalIds: issue.relatedProposalIds, code: issue.code, summary: issue.summary })), null, 2)}

只返回：
{ "employmentTransition": 修正后的职业转换或 null, "financialEventProposals": [修正后的 Proposal] }

要求：
- 只修正被拒 Proposal；不能新增正文没有发生的事实。为满足原子依赖，可以同时补充同一收入替换所必需的旧来源 income_source_ended，或同一资产购买所必需的 debt_drawn。
- 正文明确发生退休、停止工作或转为顾问等岗位变化时，employmentTransition 必须与旧职业收入结束/迁移、以及新顾问收入（如有）一起返回；三者将作为一个原子组，要么全部提交，要么全部不提交。
- employmentTransition 必须完整返回 subject="protagonist"、toStatus、effectiveAtAgeInMonths、sourceOutcomeId、occupation（如有）、evidence、confidence；证据与置信度规则和财务 Proposal 相同。
- 每项都必须完整返回 id、kind、effectiveAtAgeInMonths、payload、sourceOutcomeId、evidence、confidence；不得省略 confidence。
- sourceOutcomeId 必须为 ${input.acceptedOutcomeId}。
- 调整现有收入、支出、债务或持股时必须引用上方真实 ID。
- effectiveAtAgeInMonths 必须位于本阶段范围。
- evidence 必须逐字复制当前正文中已经发生事实的完整原句，金额、主语和事件方向一致；禁止概括或改写。
- confidence 必须在 0.6-1 之间；正文逐字明确支持时使用 0.8-1，只能估计时使用 0.6-0.8，低于 0.6 时直接省略该 Proposal。
- 无法可靠修正的 Proposal 直接省略。`;
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
- 通过 descriptionParagraphs 返回 2-4 个完整自然段，总计 150-250 字自然收束，结合最近选择、关系、事业、健康和长期方向。
- 不要把年龄本身写成失败，不要使用突然灾难或具体猎奇死因。
- title、stage、descriptionParagraphs 要面向完整人生收束。
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
- descriptionParagraphs：2-4 个完整自然段组成的字符串数组，总计 150-250 字，突出新方向面临的现实磨练、物质局限和世俗博弈。
${FINANCIAL_NARRATIVE_RULE}
- choices：A、B、C 三个全新分支选项，每个带 4 字 impactSummary。
- 每个 choice 必须返回 temporalHint、decisionIntent、expectedWorldDeltaTypes。
${formatDecisionIntentRules()}
- attributes：五维属性，0-100。
- age 必须等于 ${targetAge}。
- isEndingNode 必须为 false。

请严格返回 JSON。`;
}

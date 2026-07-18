import { formatAnswerTurns } from "../../utils/answerFormatting";
import { formatAgeInMonths } from "../../utils/timelineAdvance";
import { FinalOutcomeContext, HistoryItem, LifeAttributes, QuestionTurn, UserInitialData } from "../../types";
import { getAuthoritativeFinalFinancialContext } from "../../utils/finalOutcomeFinancialSanitizer";

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

function formatHistory(history: HistoryItem[]): string {
  return history.map((item, index) => `索引 ${index}：【${formatAgeInMonths(item.ageInMonths ?? item.age * 12)} - ${item.title}】
情境：${item.description}
用户选择：${item.selectedChoice}
累计净财富：${item.financialState ? `${item.financialState.netWorthWan} 万元${item.financialState.isEstimated ? "（估算）" : ""}` : "暂无快照"}
本阶段财富变化：${item.financialPeriodSummary ? `${item.financialPeriodSummary.netWorthChangeWan >= 0 ? "+" : ""}${item.financialPeriodSummary.netWorthChangeWan} 万元（权威期间汇总）` : "暂无权威期间汇总"}`).join("\n\n");
}

function formatAuthoritativeFinance(history: HistoryItem[]): string {
  const context = getAuthoritativeFinalFinancialContext(history);
  if (!context.state) return "暂无权威财务账本；报告不得引用任何具体金额或回报率。";
  const state = context.state;
  const period = context.periodSummary;
  return [
    `现金 ${state.cashWan} 万元`,
    `净资产 ${state.netWorthWan} 万元`,
    `总债务 ${state.totalDebtWan} 万元`,
    `年化持续收入 ${state.annualizedRecurringIncomeWan} 万元`,
    period ? `本阶段收入 ${period.incomeWan} 万元；核心支出 ${period.coreExpenseWan} 万元；净现金流 ${period.netCashFlowWan} 万元；净资产变化 ${period.netWorthChangeWan} 万元` : "本阶段无权威期间汇总",
    `未解决问题：${state.unresolvedIssueCodes.join("、") || "无"}`,
    context.hasBusinessValueNeedsReview ? "企业权益价值为 needs_review：只能写持有事实和价值待确认，不得写估值、获利或回报数字。" : "企业权益不存在 needs_review 限制。"
  ].join("\n");
}

export function buildFinalOutcomePrompt(
  userData: UserInitialData,
  answers: QuestionTurn[],
  history: HistoryItem[],
  currentAttributes: LifeAttributes,
  context: FinalOutcomeContext
): string {
  const isReflection = context.closureType === "user_reflection";
  const closureRule = isReflection
    ? `这是用户主动结束本次推演后生成的阶段性报告。角色并未死亡，长期人生方向仍可能继续。
- 使用“截至此刻”“这段人生”“已经走过的路”等表达。
- 不得写死亡、遗言、墓志铭、安详落幕、人生终章、完整一生或走完一生。
- PressureArc resolve 只表示当前阶段压力形成结果，不表示 DirectionArc 或长期人生目标已经完成。`
    : `这是角色到达自然生命终点后的完整人生报告。
- 可以使用人生终章、完整人生回顾和人生志铭等表达。`;
  const reportStageLabel = isReflection ? "当前阶段" : "终局";
  const downloadFileName = isReflection ? "这段人生的报告.png" : "人生终章.png";
  return `你是一个严谨写实的人生模式分析产品文案系统。
你不是在分析人格，而是在分析人生运行模式。
不要回答“这个人是什么样的人”，要回答“这个人的人生一直如何运行”。
报告围绕 Cause -> Effect -> Future 组织：选择模式 -> 长期结果 -> 未来趋势 -> 保留什么 -> 升级什么。

【报告收束类型】
closureType=${context.closureType}
${closureRule}

【最重要的产品规则】
- 海报标题用第一人称“我”，必须有梗、有故事感、有反差。
- 海报标题必须从用户人生经历中抽取最有传播性的冲突点，例如“重生之我用20年开发一个APP”。
- 海报其他文案和报告正文使用第二人称“你”。
- 报告不要显式写“依据：”“模式：”“洞察：”“经验：”“建议：”。
- 不要输出“兴趣驱动型、长期主义、执行力强、成果导向”等人格标签式标题。
- 不要把同一个模式拆成多个重复章节。
- 不要写泛泛正确的话，例如“多运动、建立人脉、提升执行力、保持学习”。
- 证据要自然融入正文，正文中可以写“22岁……27岁……31岁……”，但不要露出 AI 推理过程。
- 未来趋势不是预测命运，而是预测模式继续运行后最可能自然发生的结果。
- 调整建议必须写成“模式升级”，不是纠正缺点。

【用户真实背景】
- 性别：${userData.gender}
- 核心主线：${focusLabel(userData.coreStoryFocus)}
- 现实命题：${userData.currentSituation || "暂无"}
- 回溯起点：${userData.regressionAge || "未知"}岁，${userData.regressionSituation || "暂无"}
- 用户想尝试的方向：${userData.regressionChoices || "暂无"}
- 真实人生大事记：
${formatMilestones(userData)}

【背景追问答案】
${formatAnswerTurns(answers, { question: "问题", answer: "答案" }) || "暂无"}

【模拟人生历史，索引必须用于 keyMomentIndexes】
${formatHistory(history)}

【${reportStageLabel}属性】
幸福 ${currentAttributes.happiness} | 才智 ${currentAttributes.intelligence} | 财富 ${currentAttributes.wealth} | 人际 ${currentAttributes.relation} | 健康 ${currentAttributes.health}

【${reportStageLabel}累计净财富】
${history.at(-1)?.financialState ? `${history.at(-1)!.financialState!.netWorthWan} 万元${history.at(-1)!.financialState!.isEstimated ? "（估算）" : ""}` : "暂无结构化财务快照"}

【报告唯一财务事实源】
${formatAuthoritativeFinance(history)}
- 报告和海报中的现金、净资产、收入、支出、债务、回报等数字只能逐项引用本区；历史正文里的财务数字不是报告事实源。
- 本区没有提供的金额、估值、倍数或回报率必须改为定性表述，不得从叙事推算或补写。

【输出要求】
请严格返回 JSON，不要 Markdown，不要解释。返回字段：
{
  "share": {
    "viralTitle": "第一人称‘我’的爆款标题，必须有梗、有故事感、有反差",
    "covenantTitle": "6-14个中文字符的契约称号",
    "oneLineSummary": "第二人称‘你’的一句话人生总结",
    "timeline": [
      { "ageLabel": "18岁", "icon": "🎓", "title": "节点标题", "choiceSummary": "12-22个中文字符", "keyMomentIndexes": [0] }
    ],
    "closingLine": "人生不是由成功组成，而是由一次次选择组成。",
    "posterTheme": "warm_realistic | quiet_dark | clean_magazine 三选一",
    "downloadFileName": "${downloadFileName}",
    "imageAlt": "海报替代文本"
  },
  "report": {
    "executiveSummary": {
      "headline": "30秒读懂整份报告的一句话总览",
      "patterns": [
        { "name": "人生模式名称", "shortDescription": "一句话解释这个反复发生的模式", "keyMomentIndexes": [0] }
      ],
      "closingLine": "这些模式让你获得了今天的优势，也带来了今天的代价。"
    },
    "repeatedPatterns": [
      {
        "name": "模式名称",
        "title": "行为规律型标题，不要人格标签",
        "paragraphs": ["自然叙事，融入多个年龄和选择，不显示‘依据’二字"],
        "keyMomentIndexes": [0],
        "closingLine": "一句有记忆点的总结"
      }
    ],
    "patternEffects": [
      {
        "patternName": "对应模式名称",
        "compoundReturn": "这个模式带来的长期复利",
        "hiddenCost": "这个模式隐藏的代价",
        "paragraphs": ["说明它如何同时成就你和消耗你"],
        "keyMomentIndexes": [0],
        "closingLine": "一句总结"
      }
    ],
    "futureTrends": [
      { "title": "趋势标题", "trend": "如果模式继续，未来十年最可能发生什么", "reason": "为什么这是模式延续，而不是命运预测", "keyMomentIndexes": [0] }
    ],
    "patternsToKeep": [
      { "title": "保留什么模式", "why": "为什么它已经被人生验证有效", "paragraphs": ["具体说明"], "keyMomentIndexes": [0], "closingLine": "一句总结" }
    ],
    "patternsToAdjust": [
      { "title": "升级什么模式", "why": "为什么它过去有用，未来可能限制你", "paragraphs": ["具体说明如何升级"], "keyMomentIndexes": [0], "closingLine": "一句总结" }
    ],
    "finalLifeReading": {
      "title": "如果我是十年后的你",
      "paragraphs": ["不要重复总结前文，只写 AI 看到的人生"],
      "finalSentence": "一句能收藏的生命描述"
    }
  }
}

强制约束：
- share.viralTitle 必须包含“我”，不得用“你”做标题主语。
- share.timeline.length 必须是 4 到 6。
- 所有 keyMomentIndexes 必须引用上方历史索引，不能越界。
- executiveSummary.patterns 必须刚好 3 条。
- repeatedPatterns、patternEffects、futureTrends、patternsToKeep、patternsToAdjust 各 1 到 3 条。
- 报告正文必须围绕人生运行模式，不得像人格测试。`;
}

import { formatAnswerTurns } from "../../utils/answerFormatting";
import { formatAgeInMonths } from "../../utils/timelineAdvance";
import { FinalOutcomeContext, HistoryItem, LifeAttributes, QuestionTurn, UserInitialData } from "../../types";
import { getAuthoritativeFinalFinancialContext } from "../../utils/finalOutcomeFinancialContext";
import {
  deriveFinalFinancialNarrativeAuthority,
  formatFinalFinancialNarrativeAuthorityForPrompt,
  formatFinancialWan
} from "../../utils/finalFinancialNarrativeAuthority";
import { formatPersonalExpenseSummaryForPrompt } from "../../domain/finance/personalExpenseSummary";

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
累计净财富：${item.financialState ? `${formatFinancialWan(item.financialState.netWorthWan)}元${item.financialState.isEstimated ? "（估算）" : ""}` : "暂无快照"}
本阶段财富变化：${item.financialPeriodSummary ? `${item.financialPeriodSummary.netWorthChangeWan >= 0 ? "+" : ""}${formatFinancialWan(item.financialPeriodSummary.netWorthChangeWan)}元（权威期间汇总）` : "暂无权威期间汇总"}`).join("\n\n");
}

function formatAuthoritativeFinance(history: HistoryItem[]): string {
  const context = getAuthoritativeFinalFinancialContext(history);
  if (!context.state) return "暂无权威财务账本；报告不得引用任何具体金额或回报率。";
  const state = context.state;
  const period = context.periodSummary;
  const expenseSummary = context.narrativeAuthority?.personalExpenseSummary;
  return [
    `现金 ${formatFinancialWan(state.cashWan)}元`,
    `净资产 ${formatFinancialWan(state.netWorthWan)}元`,
    `总债务 ${formatFinancialWan(state.totalDebtWan)}元`,
    `年化持续收入 ${formatFinancialWan(state.annualizedRecurringIncomeWan)}元`,
    period ? `本阶段收入 ${formatFinancialWan(period.incomeWan)}元；核心支出 ${formatFinancialWan(period.coreExpenseWan)}元；净现金流 ${formatFinancialWan(period.netCashFlowWan)}元；净资产变化 ${formatFinancialWan(period.netWorthChangeWan)}元` : "本阶段无权威期间汇总",
    "V4 个人持续支出分类摘要（报告与海报唯一支出事实源）：",
    expenseSummary ? formatPersonalExpenseSummaryForPrompt(expenseSummary) : "- V4 支出分类摘要不可用；不得生成具体持续支出金额或责任结论。",
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
  const futureTrendRule = isReflection
    ? "描述模式继续运行后，角色未来十年最可能发生的变化。"
    : "此字段在死亡终局中表示遗留影响：只能回顾历史已经证明的作品、关系或制度影响，以及权威状态中明确存在的未完成事项；不得推演死后的法律程序、债务承担者、采用范围或影响人数。";
  const keepRule = isReflection
    ? "保留什么模式，以及下一阶段为什么仍值得保留"
    : "回顾哪些模式在生前确实产生过正向作用，只作历史判断，不向死者提建议";
  const adjustRule = isReflection
    ? "升级什么模式，以及下一阶段如何升级"
    : "回顾哪些模式在生前形成限制和代价，只作历史判断，不写未来行动";
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
- 不得直接输出幸福、才智、财富、人际、健康的内部属性分数；把属性变化改写成历史中可观察的行为和结果。
- 不得把影响范围夸写成“无数人”“成千上万”“全国”或“遍布各地”，除非历史中有对应量化证据。
- 标题如使用“X年”，X 必须与模拟历史首尾年龄跨度相符；不能为了传播效果虚构年数。
- 每一个标题、名称、段落和总结句都必须由你完整生成。任何字段缺失都会触发整份报告修复，代码不会补写“模式1”或通用人生感悟。
- keyMomentIndexes 必须从历史中选择真实索引；不要机械复制单个索引，也不要让所有章节引用同一组节点。

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
${history.at(-1)?.financialState ? `${formatFinancialWan(history.at(-1)!.financialState!.netWorthWan)}元${history.at(-1)!.financialState!.isEstimated ? "（估算）" : ""}` : "暂无结构化财务快照"}

【报告唯一财务事实源】
${formatAuthoritativeFinance(history)}
- 报告和海报中的现金、净资产、收入、支出、债务、回报等数字只能逐项引用本区；历史正文里的财务数字不是报告事实源。
- 本区没有提供的金额、估值、倍数或回报率必须改为定性表述，不得从叙事推算或补写。

【报告财务语义硬约束】
${formatFinalFinancialNarrativeAuthorityForPrompt(deriveFinalFinancialNarrativeAuthority(history))}
- 上述 debt、netWorth、property 是封闭事实集合。海报标题、称号、摘要、时间线和报告正文都必须服从。
- 只有 debt.kind=debt_fully_repaid 时，才可写已经还清、结清或摆脱债务；debt.kind=no_active_debt 只能陈述当前账本没有仍在账上的个人债务，不能把它写成已发生的清偿。净资产为负时不得写财务自由或经济无忧；没有已确认房产时不得写名下房产、卖房或房产升值。
- no_confirmed_property 只表示“没有已确认房产事实”，不等于已确认没有房产；不得改写成“没有房产”“没有其他可变现资产”。
- 债务尚未清偿时可以准确写“仍未还清”，但不能在任何回顾、假设或建议中暗示已经还清。
- 净资产为负时，不得把负债或负净资产写成换取意义、幸福或丰盈人生的“值得交换”；人生意义和财务代价必须分别陈述，不能互相抵销。

【输出要求】
请严格返回符合以下 TypeScript 类型契约的 JSON；类型契约只描述结构，不是可复制文案。不要返回 Markdown 或解释。
type FinalOutcomeJson = {
  share: {
    viralTitle: string;
    covenantTitle: string;
    oneLineSummary: string;
    timeline: Array<{
      ageLabel: string;
      icon: string;
      title: string;
      choiceSummary: string;
      keyMomentIndexes: number[];
    }>;
    closingLine: string;
    posterTheme: "warm_realistic" | "quiet_dark" | "clean_magazine";
    downloadFileName: "${downloadFileName}";
    imageAlt: string;
  };
  report: {
    executiveSummary: {
      headline: string;
      patterns: Array<{ name: string; shortDescription: string; keyMomentIndexes: number[] }>;
      closingLine: string;
    };
    repeatedPatterns: Array<{
      name: string;
      title: string;
      paragraphs: string[];
      keyMomentIndexes: number[];
      closingLine: string;
    }>;
    patternEffects: Array<{
      patternName: string;
      compoundReturn: string;
      hiddenCost: string;
      paragraphs: string[];
      keyMomentIndexes: number[];
      closingLine: string;
    }>;
    futureTrends: Array<{ title: string; trend: string; reason: string; keyMomentIndexes: number[] }>;
    patternsToKeep: Array<{
      title: string;
      why: string;
      paragraphs: string[];
      keyMomentIndexes: number[];
      closingLine: string;
    }>;
    patternsToAdjust: Array<{
      title: string;
      why: string;
      paragraphs: string[];
      keyMomentIndexes: number[];
      closingLine: string;
    }>;
    finalLifeReading: { title: string; paragraphs: string[]; finalSentence: string };
  };
};

强制约束：
- share.viralTitle 必须包含“我”，不得用“你”做标题主语。
- share.viralTitle 可以直接使用【报告唯一财务事实源】中的金额；只要逐项匹配权威数值，不得仅因金额位于标题中就改成定性表述。事实源没有提供的金额仍然禁止使用。
- share.timeline.length 必须是 4 到 6。
- 所有 keyMomentIndexes 必须引用上方历史索引，不能越界。
- executiveSummary.patterns 必须刚好 3 条。
- repeatedPatterns、patternEffects、futureTrends、patternsToKeep、patternsToAdjust 各 1 到 3 条。
- covenantTitle 必须是 6 到 14 个中文字符；choiceSummary 必须是 12 到 22 个中文字符。
- 分享海报是固定 9:16：viralTitle 最多 24 显示单位，oneLineSummary 最多 44，closingLine 最多 40；timeline 每项 title 最多 16、choiceSummary 最多 22。中文和全角字符按 1 单位、普通 ASCII 按 0.5 单位计算。
- 除 posterTheme 和 downloadFileName 外，所有 string 内容都必须根据本次历史独立生成；不得复制本提示词中的规则句，也不得使用通用占位文案。
- ${futureTrendRule}
- ${keepRule}。
- ${adjustRule}。
- mortality 报告所有字段都不得出现“十年后的你”“下一阶段”“请继续保持”“你应该/需要”等面向死者的未来建议。
- 报告正文必须围绕人生运行模式，不得像人格测试。`;
}

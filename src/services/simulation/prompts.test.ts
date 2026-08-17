import assert from "node:assert/strict";
import { LifeEventSeed } from "../../data/lifeEvents";
import { HistoryItem, LifeAttributes, PressureArcState, QuestionTurn, UserInitialData, WorldStateSnapshot } from "../../types";
import { initializeFinancialLedger, migrateFinancialLedgerV3ToV4 } from "../../domain/finance";
import {
  buildChoiceTextRepairPrompt,
  buildEndingNodePrompt,
  buildFinancialNarrativeRepairPrompt,
  buildFinancialProposalRepairPrompt,
  buildNextNodePrompt,
  buildNodePromptWithRetryNotice
} from "./prompts";

const userData: UserInitialData = {
  birthday: "1995-05-20",
  birthtime: "08:30",
  gender: "女",
  currentSituation: "想重新选择职业路径",
  isReturnToPast: true,
  targetAgeNode: "大学毕业",
  regressionNodeKey: "career",
  regressionAge: 22,
  regressionSituation: "毕业后在稳定和高收入项目之间摇摆",
  regressionChoices: "想看看努力赚钱但不把身体搭进去的路线",
  coreStoryFocus: "career",
  milestones: [{ id: "career", title: "第一份工作", content: "进入一家创业公司" }]
};

const answers: QuestionTurn[] = [
  { id: 1, question: "当时最大的现实限制是什么？", answer: "没什么积蓄，但身体已经经常疲惫。" }
];

const currentAttributes: LifeAttributes = {
  happiness: 42,
  intelligence: 68,
  wealth: 47,
  relation: 52,
  health: 38
};

const history: HistoryItem[] = [
  {
    age: 24,
    stage: "职业承压",
    title: "项目和身体同时告急",
    description: "收入机会变多，但睡眠和情绪都开始变差。",
    selectedChoice: "接一个短期高薪项目",
    attributes: currentAttributes,
    choices: [{ id: "A", text: "接一个短期高薪项目", impactSummary: "现金回血" }],
    isEndingNode: false
  }
];

const healthWarningEvent: LifeEventSeed = {
  id: "health_system_warning",
  category: "health",
  routeLine: "health",
  narrativeMode: "pressure_crisis",
  semanticFamily: "health_system_warning",
  title: "健康系统预警",
  minAge: 22,
  maxAge: 60,
  conditionDescription: "健康下降或长期幸福度不足",
  tags: ["health", "burnout", "instability", "system_warning"],
  trigger: {
    eligibility: () => true
  },
  intent: {
    type: "health_system_warning",
    meaning: "长期高压生活引发身体或精神系统性的现实反馈。",
    tensionAxes: ["收益 vs 健康", "短期稳定 vs 长期风险", "责任 vs 自我保护"],
    allowedOutcomes: [
      "maintain_current_load_with_monitoring",
      "continue_goal_with_adjusted_execution",
      "pause_or_seek_professional_support"
    ],
    emotionalTone: "crisis"
  }
};

const prompt = buildNextNodePrompt({
  userData,
  answers,
  history,
  currentAttributes,
  selectedDecision: "接一个短期高薪项目",
  eventSeed: healthWarningEvent
});
const financialGateRetryPrompt = buildNextNodePrompt({
  userData,
  answers,
  history,
  currentAttributes,
  selectedDecision: "接一个短期高薪项目",
  eventSeed: healthWarningEvent,
  financialGateRetryReasonCodes: ["EMPLOYED_WITHOUT_ACTIVE_CAREER_INCOME"]
});
const careerIncomeTransitionRetryPrompt = buildNextNodePrompt({
  userData,
  answers,
  history,
  currentAttributes,
  selectedDecision: "接受创业公司的产品负责人邀请",
  eventSeed: healthWarningEvent,
  financialGateRetryReasonCodes: ["UNSATISFIED_CAREER_INCOME_TRANSITION"]
});
assert.match(careerIncomeTransitionRetryPrompt, /实习转正/u);
assert.match(careerIncomeTransitionRetryPrompt, /新职业收入不是可选项/u);
const pendingEmployerOfferPrompt = buildNextNodePrompt({
  userData,
  answers,
  history,
  currentAttributes,
  selectedDecision: "确认新岗位的劳动合同",
  eventSeed: healthWarningEvent,
  worldState: {
    people: [],
    directionArcs: [],
    pressureArcs: [],
    committedTransactionIds: [],
    version: 2,
    pendingEmployerOffer: {
      status: "accepted_pending_start",
      sourceOutcomeId: "accept_ai_startup_offer",
      acceptedAtAgeInMonths: 288,
      fromCareerStateId: "career_legacy",
      decision: "接受AI创业公司的产品负责人邀请",
      evidence: "接受AI创业公司的产品负责人邀请"
    }
  }
});
const responsibilityDeltaRetryPrompt = buildNextNodePrompt({
  userData,
  answers,
  history,
  currentAttributes,
  selectedDecision: "接一个短期高薪项目",
  eventSeed: healthWarningEvent,
  selectedOutcomeId: "care_choice",
  financialGateRetryReasonCodes: ["EXPENSE_RESPONSIBILITY_NARRATIVE_DELTA_MISSING"]
});
const rejectedExpenseLifecycleRetryPrompt = buildNextNodePrompt({
  userData,
  answers,
  history,
  currentAttributes,
  selectedDecision: "继续承担当前住房支出",
  eventSeed: healthWarningEvent,
  selectedOutcomeId: "keep_current_home",
  financialGateRetryReasonCodes: ["REJECTED_COMPLETED_EXPENSE_LIFECYCLE"]
});
const endingResponsibilityDeltaRetryPrompt = buildEndingNodePrompt({
  userData,
  history,
  candidateNode: {
    age: 110,
    stage: "人生终章",
    title: "最后的日常",
    description: "你继续整理晚年的生活安排。",
    attributes: currentAttributes,
    choices: [{ id: "A", text: "安静回望", impactSummary: "人生回望" }],
    isEndingNode: false
  } as any,
  targetAgeInMonths: 110 * 12,
  forcedByHardMaximum: true,
  selectedOutcomeId: "ending_parent_care",
  financialGateRetryReasonCodes: ["EXPENSE_RESPONSIBILITY_NARRATIVE_DELTA_MISSING"]
});
const staleLegacyIncomeLedger = initializeFinancialLedger({
  id: "stale_legacy_income_prompt",
  asOfAgeInMonths: 288,
  openingPosition: {
    incomeSources: [{
      id: "legacy_recurring_income",
      type: "salary",
      displayName: "迁移工资",
      monthlyNetAmountWan: 2.5,
      accrualPolicy: "monthly",
      activeFromAgeInMonths: 200,
      status: "active",
      linkedCareerStateId: "career_current",
      factStatus: "estimated",
      lastConfirmedAtAgeInMonths: 200,
      evidence: [{ source: "legacy_migration", reasonCode: "LEGACY_FINANCIAL_STATE_MIGRATION", confidence: 0.5 }]
    }]
  }
});
const staleLegacyIncomePrompt = buildNextNodePrompt({
  userData,
  answers,
  history,
  currentAttributes,
  selectedDecision: "接一个短期高薪项目",
  eventSeed: healthWarningEvent,
  currentFinancialLedger: staleLegacyIncomeLedger
});
const staleLegacyIncomeGateRetryPrompt = buildNextNodePrompt({
  userData,
  answers,
  history,
  currentAttributes,
  selectedDecision: "接一个短期高薪项目",
  eventSeed: healthWarningEvent,
  currentFinancialLedger: staleLegacyIncomeLedger,
  financialGateRetryReasonCodes: ["EMPLOYED_WITHOUT_ACTIVE_CAREER_INCOME"]
});
const nearQuarantineLegacyIncomeLedger = structuredClone(staleLegacyIncomeLedger);
nearQuarantineLegacyIncomeLedger.incomeSources[0]!.lastConfirmedAtAgeInMonths = 288;
nearQuarantineLegacyIncomeLedger.recentTransactions.push(
  {
    id: "legacy_material_1",
    simulationTransactionId: "legacy_material_1",
    eventIds: [],
    periodStartAgeInMonths: 289,
    periodEndAgeInMonths: 289,
    cashDeltaWan: 0,
    assetDeltaWan: 0,
    debtDeltaWan: 0,
    incomeWan: 0,
    expenseWan: 0,
    valuationChangeWan: 0,
    nonCashGainLossWan: 0,
    netWorthDeltaWan: 0,
    evidence: []
  },
  {
    id: "legacy_material_2",
    simulationTransactionId: "legacy_material_2",
    eventIds: [],
    periodStartAgeInMonths: 290,
    periodEndAgeInMonths: 290,
    cashDeltaWan: 0,
    assetDeltaWan: 0,
    debtDeltaWan: 0,
    incomeWan: 0,
    expenseWan: 0,
    valuationChangeWan: 0,
    nonCashGainLossWan: 0,
    netWorthDeltaWan: 0,
    evidence: []
  }
);
const nearQuarantineLegacyIncomePrompt = buildNextNodePrompt({
  userData,
  answers,
  history,
  currentAttributes,
  selectedDecision: "接一个短期高薪项目",
  eventSeed: healthWarningEvent,
  currentFinancialLedger: nearQuarantineLegacyIncomeLedger
});
const alreadyQuarantinedLegacyIncomeLedger = structuredClone(staleLegacyIncomeLedger);
alreadyQuarantinedLegacyIncomeLedger.incomeSources[0]!.factStatus = "needs_review";
alreadyQuarantinedLegacyIncomeLedger.incomeSources[0]!.accrualReviewStatus = "quarantined";
const alreadyQuarantinedLegacyIncomeGateRetryPrompt = buildNextNodePrompt({
  userData,
  answers,
  history,
  currentAttributes,
  selectedDecision: "接一个短期高薪项目",
  eventSeed: healthWarningEvent,
  currentFinancialLedger: alreadyQuarantinedLegacyIncomeLedger,
  financialGateRetryReasonCodes: ["EMPLOYED_WITHOUT_ACTIVE_CAREER_INCOME"]
});
const immutableLegacyIncomeLedger = structuredClone(staleLegacyIncomeLedger);
immutableLegacyIncomeLedger.incomeSources[0]!.activeUntilAgeInMonths = 360;
immutableLegacyIncomeLedger.incomeSources[0]!.linkedAssetAccountId = "legacy_income_asset_link";
immutableLegacyIncomeLedger.incomeSources[0]!.linkedBusinessHoldingId = "legacy_income_holding_link";
const immutableLegacyIncomeGateRetryPrompt = buildNextNodePrompt({
  userData,
  answers,
  history,
  currentAttributes,
  selectedDecision: "接一个短期高薪项目",
  eventSeed: healthWarningEvent,
  currentFinancialLedger: immutableLegacyIncomeLedger,
  financialGateRetryReasonCodes: ["EMPLOYED_WITHOUT_ACTIVE_CAREER_INCOME"]
});
const dualAmountLegacyIncomeLedger = structuredClone(staleLegacyIncomeLedger);
dualAmountLegacyIncomeLedger.incomeSources[0]!.annualNetAmountWan = 30;
const dualAmountLegacyIncomeGateRetryPrompt = buildNextNodePrompt({
  userData,
  answers,
  history,
  currentAttributes,
  selectedDecision: "接一个短期高薪项目",
  eventSeed: healthWarningEvent,
  currentFinancialLedger: dualAmountLegacyIncomeLedger,
  financialGateRetryReasonCodes: ["EMPLOYED_WITHOUT_ACTIVE_CAREER_INCOME"]
});
const ordinaryCareerIncomeLedger = structuredClone(staleLegacyIncomeLedger);
ordinaryCareerIncomeLedger.incomeSources[0]!.id = "ordinary_salary";
ordinaryCareerIncomeLedger.incomeSources[0]!.evidence = [{
  source: "accepted_history",
  reasonCode: "CURRENT_SALARY",
  confidence: 0.9
}];
const ordinaryCareerIncomeGateRetryPrompt = buildNextNodePrompt({
  userData,
  answers,
  history,
  currentAttributes,
  selectedDecision: "接一个短期高薪项目",
  eventSeed: healthWarningEvent,
  currentFinancialLedger: ordinaryCareerIncomeLedger,
  financialGateRetryReasonCodes: ["EMPLOYED_WITHOUT_ACTIVE_CAREER_INCOME"]
});
const legacyAggregateIncomeLedger = structuredClone(alreadyQuarantinedLegacyIncomeLedger);
legacyAggregateIncomeLedger.incomeSources[0]!.type = "other";
const legacyAggregateIncomeGateRetryPrompt = buildNextNodePrompt({
  userData,
  answers,
  history,
  currentAttributes,
  selectedDecision: "接一个短期高薪项目",
  eventSeed: healthWarningEvent,
  currentFinancialLedger: legacyAggregateIncomeLedger,
  financialGateRetryReasonCodes: ["EMPLOYED_WITHOUT_ACTIVE_CAREER_INCOME"]
});
// This reproduces the release-candidate failure shape: an earlier accepted
// outcome left the compatibility aggregate estimated because it only said the
// income had become irregular. That is not a stable salary reconfirmation.
const estimatedOutcomeLegacyIncomeLedger = structuredClone(legacyAggregateIncomeLedger);
estimatedOutcomeLegacyIncomeLedger.asOfAgeInMonths = 657;
estimatedOutcomeLegacyIncomeLedger.incomeSources[0] = {
  ...estimatedOutcomeLegacyIncomeLedger.incomeSources[0]!,
  type: "other",
  monthlyNetAmountWan: 1.5,
  annualNetAmountWan: 32,
  accrualPolicy: "monthly",
  factStatus: "estimated",
  accrualReviewStatus: "normal",
  lastConfirmedAtAgeInMonths: 398,
  evidence: [{
    source: "accepted_simulation_outcome",
    sourceEventId: "accepted_consulting_income_adjusted",
    reasonCode: "EVIDENCE_EXACT_MATCHED",
    excerpt: "项目制合同到期后，你按单结算，收入不再稳定。",
    confidence: 0.7
  }]
};
const estimatedOutcomeLegacyIncomePrompt = buildNextNodePrompt({
  userData,
  answers,
  history: [{ ...history[0]!, age: 54, ageInMonths: 657 }],
  currentAttributes,
  selectedDecision: "接一个短期高薪项目",
  eventSeed: healthWarningEvent,
  currentFinancialLedger: estimatedOutcomeLegacyIncomeLedger,
  currentFinancialState: {
    asOfAgeInMonths: 657,
    employmentStatus: "employed",
    annualAfterTaxIncomeWan: 18,
    annualCoreExpenseWan: 4.2,
    annualDisposableIncomeWan: 13.8,
    cashWan: 20,
    investmentAssetsWan: 0,
    propertyMarketValueWan: 0,
    businessAndOtherAssetsWan: 0,
    totalDebtWan: 0,
    netWorthWan: 20,
    incomeStability: "volatile",
    isEstimated: true,
    currencyUnit: "CNY_WAN_REAL"
  },
  timelineAdvance: {
    elapsedMonths: 4,
    targetAgeInMonths: 661,
    targetAge: 55,
    lifeIntensity: "normal",
    reasonCodes: []
  }
});
const estimatedOutcomeLegacyIncomeGateRetryPrompt = buildNextNodePrompt({
  userData,
  answers,
  history: [{ ...history[0]!, age: 54, ageInMonths: 657 }],
  currentAttributes,
  selectedDecision: "接一个短期高薪项目",
  eventSeed: healthWarningEvent,
  currentFinancialLedger: estimatedOutcomeLegacyIncomeLedger,
  financialGateRetryReasonCodes: ["EMPLOYED_WITHOUT_ACTIVE_CAREER_INCOME"]
});
const selfEmployedEstimatedOutcomeLegacyIncomePrompt = buildNextNodePrompt({
  userData,
  answers,
  history: [{ ...history[0]!, age: 54, ageInMonths: 657 }],
  currentAttributes,
  selectedDecision: "接一个短期高薪项目",
  eventSeed: healthWarningEvent,
  currentFinancialLedger: estimatedOutcomeLegacyIncomeLedger,
  currentFinancialState: {
    asOfAgeInMonths: 657,
    employmentStatus: "self_employed",
    annualAfterTaxIncomeWan: 18,
    annualCoreExpenseWan: 4.2,
    annualDisposableIncomeWan: 13.8,
    cashWan: 20,
    investmentAssetsWan: 0,
    propertyMarketValueWan: 0,
    businessAndOtherAssetsWan: 0,
    totalDebtWan: 0,
    netWorthWan: 20,
    incomeStability: "volatile",
    isEstimated: true,
    currencyUnit: "CNY_WAN_REAL"
  },
  timelineAdvance: {
    elapsedMonths: 4,
    targetAgeInMonths: 661,
    targetAge: 55,
    lifeIntensity: "normal",
    reasonCodes: []
  }
});
const partTimeEstimatedOutcomeLegacyIncomePrompt = buildNextNodePrompt({
  userData,
  answers,
  history: [{ ...history[0]!, age: 54, ageInMonths: 657 }],
  currentAttributes,
  selectedDecision: "接一个短期高薪项目",
  eventSeed: healthWarningEvent,
  currentFinancialLedger: estimatedOutcomeLegacyIncomeLedger,
  currentFinancialState: {
    asOfAgeInMonths: 657,
    employmentStatus: "part_time",
    annualAfterTaxIncomeWan: 18,
    annualCoreExpenseWan: 4.2,
    annualDisposableIncomeWan: 13.8,
    cashWan: 20,
    investmentAssetsWan: 0,
    propertyMarketValueWan: 0,
    businessAndOtherAssetsWan: 0,
    totalDebtWan: 0,
    netWorthWan: 20,
    incomeStability: "volatile",
    isEstimated: true,
    currencyUnit: "CNY_WAN_REAL"
  },
  timelineAdvance: {
    elapsedMonths: 4,
    targetAgeInMonths: 661,
    targetAge: 55,
    lifeIntensity: "normal",
    reasonCodes: []
  }
});
const knownOutcomeLegacyIncomeLedger = structuredClone(estimatedOutcomeLegacyIncomeLedger);
knownOutcomeLegacyIncomeLedger.incomeSources[0]!.factStatus = "known";
knownOutcomeLegacyIncomeLedger.incomeSources[0]!.accrualReviewStatus = "normal";
const knownOutcomeLegacyIncomePrompt = buildNextNodePrompt({
  userData,
  answers,
  history: [{ ...history[0]!, age: 54, ageInMonths: 657 }],
  currentAttributes,
  selectedDecision: "接一个短期高薪项目",
  eventSeed: healthWarningEvent,
  currentFinancialLedger: knownOutcomeLegacyIncomeLedger,
  timelineAdvance: {
    elapsedMonths: 4,
    targetAgeInMonths: 661,
    targetAge: 55,
    lifeIntensity: "normal",
    reasonCodes: []
  }
});
const knownOutcomeLegacyIncomeGateRetryPrompt = buildNextNodePrompt({
  userData,
  answers,
  history: [{ ...history[0]!, age: 54, ageInMonths: 657 }],
  currentAttributes,
  selectedDecision: "接一个短期高薪项目",
  eventSeed: healthWarningEvent,
  currentFinancialLedger: knownOutcomeLegacyIncomeLedger,
  financialGateRetryReasonCodes: ["EMPLOYED_WITHOUT_ACTIVE_CAREER_INCOME"]
});
const v4ExpenseLedger = migrateFinancialLedgerV3ToV4(initializeFinancialLedger({
  id: "v4_expense_prompt",
  asOfAgeInMonths: 288,
  openingPosition: {
    expenseCommitments: [{
      id: "shared_home",
      type: "housing",
      displayName: "共同租住公寓",
      monthlyAmountWan: 0.3,
      grossMonthlyAmountWan: 0.6,
      householdShareRate: 0.5,
      confirmedMonthlyAmountWan: 0.3,
      amountBasis: "explicit_shared_amount",
      amountSourceIds: ["lease:shared_home"],
      financialScope: "shared_household",
      activeFromAgeInMonths: 288,
      status: "active",
      factStatus: "known",
      evidence: [{ source: "accepted_history", reasonCode: "TEST_SHARED_HOME", confidence: 1, financialScope: "shared_household" }]
    }]
  }
}));
const v4ExpensePrompt = buildNextNodePrompt({
  userData,
  answers,
  history,
  currentAttributes,
  selectedDecision: "接一个短期高薪项目",
  eventSeed: healthWarningEvent,
  currentFinancialLedger: v4ExpenseLedger
});
const overdueExpenseReviewPromptLedger = structuredClone(v4ExpenseLedger);
overdueExpenseReviewPromptLedger.expenseCommitments[0]!.factStatus = "needs_review";
overdueExpenseReviewPromptLedger.expenseCommitments[0]!.accrualReviewStatus = "review_due";
overdueExpenseReviewPromptLedger.unresolvedIssues.push({
  id: "expense_review_due_shared_home",
  code: "PENDING_FACT",
  severity: "warning",
  status: "open",
  relatedProposalIds: [],
  relatedAccountIds: ["shared_home"],
  summary: "持续支出共同租住公寓已到复核时点",
  createdAtAgeInMonths: 288,
  occurrenceCount: 2,
  lastObservedAtAgeInMonths: 300
});
const overdueExpenseReviewPrompt = buildNextNodePrompt({
  userData,
  answers,
  history,
  currentAttributes,
  selectedDecision: "接一个短期高薪项目",
  eventSeed: healthWarningEvent,
  currentFinancialLedger: overdueExpenseReviewPromptLedger
});
const firstObservationExpenseReviewLedger = structuredClone(overdueExpenseReviewPromptLedger);
firstObservationExpenseReviewLedger.unresolvedIssues[0]!.occurrenceCount = 1;
const firstObservationExpenseReviewPrompt = buildNextNodePrompt({
  userData,
  answers,
  history,
  currentAttributes,
  selectedDecision: "接一个短期高薪项目",
  eventSeed: healthWarningEvent,
  currentFinancialLedger: firstObservationExpenseReviewLedger
});
const overduePolicyEstimatePromptLedger = structuredClone(overdueExpenseReviewPromptLedger);
overduePolicyEstimatePromptLedger.expenseCommitments[0] = {
  ...overduePolicyEstimatePromptLedger.expenseCommitments[0]!,
  id: "policy_floor_basic_living",
  type: "basic_living",
  displayName: "基础生活支出（待确认）",
  responsibilityKey: "adult_basic_living:protagonist",
  responsibilityKind: "adult_basic_living",
  monthlyAmountWan: 0.35,
  grossMonthlyAmountWan: undefined,
  householdShareRate: undefined,
  confirmedMonthlyAmountWan: undefined,
  amountBasis: "policy_floor",
  amountSourceIds: ["opening_policy_adult_basic_living"],
  financialScope: "personal",
  factStatus: "needs_review",
  evidence: [{ source: "system_policy", reasonCode: "OPENING_POLICY_FLOOR", confidence: 1, financialScope: "personal" }]
};
overduePolicyEstimatePromptLedger.unresolvedIssues[0] = {
  ...overduePolicyEstimatePromptLedger.unresolvedIssues[0]!,
  id: "expense_review_due_policy_floor_basic_living",
  relatedAccountIds: ["policy_floor_basic_living"]
};
const overduePolicyEstimatePrompt = buildNextNodePrompt({
  userData,
  answers,
  history,
  currentAttributes,
  selectedDecision: "接一个短期高薪项目",
  eventSeed: healthWarningEvent,
  currentFinancialLedger: overduePolicyEstimatePromptLedger
});

assert.doesNotMatch(prompt, /高薪不是必然伤健康/);
assert.doesNotMatch(prompt, /高强度、长期、无恢复机制/);
assert.doesNotMatch(prompt, /选择高薪项目可以提高财富/);
assert.doesNotMatch(prompt, /健康是否下降要看工作强度、当前健康、是否有恢复策略/);
assert.match(prompt, /年龄约束执行条件，不约束人生愿望/);
assert.match(prompt, /55岁创业/);
assert.match(prompt, /temporalHint、decisionIntent、expectedWorldDeltaTypes；有事件种子时还必须带 eventOutcomeId/);
assert.match(prompt, /每个 choice 必须返回 eventOutcomeId/);
assert.match(buildNodePromptWithRetryNotice(prompt, ["invalidJson"]), /返回内容不是可解析的完整 JSON/);
assert.match(buildNodePromptWithRetryNotice(prompt, ["choiceText"]), /每个 choice 自己的非空 text 展示正文/);
assert.match(buildNodePromptWithRetryNotice(prompt, ["attributesRange"]), /0-100 的绝对值/);
assert.match(buildNodePromptWithRetryNotice(prompt, ["attributesChange"]), /通常不得超过 ±12/);
assert.match(prompt, /choice\.id 必须严格按显示顺序使用 A、B、C/);
assert.doesNotMatch(prompt, /允许使用.*语义 ID/);
assert.match(prompt, /禁止用“\$\{id\}\. \$\{impactSummary\}”拼接结果充当 text/);
const choiceTextRepairPrompt = buildChoiceTextRepairPrompt({
  title: "岗位与新机会",
  description: "现有岗位和外部机会同时摆在面前。",
  choices: [
    { id: "stay_in_current_role", impactSummary: "专注现岗", decisionIntent: "career:stay:current_role" },
    { id: "accept_new_role_transfer", text: "接受内部转岗", impactSummary: "转岗新业", decisionIntent: "career:transfer:new_role" },
    { id: "startup_for_larger_platform", impactSummary: "跳槽大平台", decisionIntent: "career:join:larger_platform" }
  ]
}, [0, 2]);
assert.match(choiceTextRepairPrompt, /stay_in_current_role/);
assert.match(choiceTextRepairPrompt, /startup_for_larger_platform/);
assert.match(choiceTextRepairPrompt, /只为上述索引返回 choiceTextRepairs/);
assert.match(choiceTextRepairPrompt, /不得修改或重写 id、impactSummary、decisionIntent、eventOutcomeId/);
assert.match(choiceTextRepairPrompt, /"index": 0/);
assert.match(choiceTextRepairPrompt, /"index": 2/);
assert.match(prompt, /decisionIntent 是代码识别行动方向的稳定指纹/);
assert.match(prompt, /领域:动作:对象/);
assert.match(prompt, /语义相同的行动必须复用已有 decisionIntent/);
assert.match(prompt, /不得仅因为人物处于事业线、收入增加或继续工作就自动降低健康/);
assert.match(prompt, /也不得仅因为停止工作就自动增加健康/);
assert.match(prompt, /继续工作也可以是 protected/);
assert.match(prompt, /recoveryState=depleted 必须有/);
assert.match(prompt, /不能自行创建或修改 Arc 状态|模型不得修改 phase/);
assert.match(prompt, /正文禁止描述当前存款、积蓄、银行余额、身家、净资产或累计财富的精确总额/);
assert.match(prompt, /允许描述本阶段实际发生的交易金额/);
assert.match(prompt, /financialEventProposals 必须放在返回 JSON 顶层/);
assert.match(prompt, /financialNarrativeClaims 必须放在返回 JSON 顶层/);
assert.match(prompt, /每个 financialEventProposal 至少返回一项 Claim/);
assert.match(prompt, /未绑定 Claim 的正文或选项/);
assert.match(prompt, /不得返回债务净变化、资产净变化或最终余额/);
assert.match(prompt, /responsibilityKind（例如 recurring_healthcare）不是 type/);
assert.match(prompt, /支出 payload 禁止包含 accrualPolicy/);
assert.match(prompt, /debtAccount.*destinationCashAccountId.*principalDrawnWan/s);
assert.match(prompt, /debtAccount\.principalWan 必须严格等于 principalDrawnWan/);
assert.match(prompt, /公司融资只能用 business_financing_recorded/);
assert.match(prompt, /项目基金、公益资助或拨款/);
assert.match(prompt, /即使款项暂时打到主角名下，也不得用 income_source_\* 或 one_off_income_received 写入个人现金/);
assert.match(prompt, /employmentStatus 不属于财务 Proposal/);
assert.match(prompt, /location_change worldDelta 增加 residence/);
assert.match(prompt, /工坊、工作室、办公室、仓库、门店、公司租金和团队场地不是主角住所/);
assert.match(prompt, /房贷或月供仍只走债务 Proposal/);
assert.match(prompt, /type="expense_responsibility" worldDelta/);
assert.match(prompt, /不填金额、responsibilityKey、账户 id 或 financialScope/);
assert.match(prompt, /shared_household 照护不得返回它，必须走带明确主角份额的财务 Proposal/);
assert.match(prompt, /高龄、父母患病、一次探望\/陪诊、一次理疗、父母或第三方付费、公司场地都不得返回它/);
assert.doesNotMatch(prompt, /financialSignals 必须放在返回 JSON 顶层/);
assert.match(prompt, /最终金额由系统统一计算和展示/);
assert.match(prompt, /不得自行写“连续 N 个月逾期\/拖欠”/);
assert.match(prompt, /default_risk 只能描述风险、通知或协商压力/);
assert.match(prompt, /债务叙事权威契约/);
assert.match(prompt, /permittedInstitutionActions/);
assert.match(prompt, /descriptionParagraphs、choices、storyEpisode、arcSignals evidence/);
assert.match(prompt, /不得凭空提交就业状态转换/);
assert.match(financialGateRetryPrompt, /财务接受门重生修正/);
assert.match(financialGateRetryPrompt, /EMPLOYED_WITHOUT_ACTIVE_CAREER_INCOME/);
assert.match(financialGateRetryPrompt, /不得返回 income_source_ended、income_source_paused/);
assert.match(careerIncomeTransitionRetryPrompt, /不得再写“个人收入尚待确认”/);
assert.match(careerIncomeTransitionRetryPrompt, /原子提交 employmentTransition、旧职业收入结束或迁移与新职业收入/);
assert.match(pendingEmployerOfferPrompt, /已接受但尚未生效的外部职位/);
assert.match(pendingEmployerOfferPrompt, /当前权威 CareerState 与个人工资尚未变化/);
assert.match(pendingEmployerOfferPrompt, /实际入职与主角个人税后薪资事实/);
assert.match(pendingEmployerOfferPrompt, /pendingEmployerOfferResolution/);
assert.match(pendingEmployerOfferPrompt, /action:"started"/);
assert.match(pendingEmployerOfferPrompt, /accept_ai_startup_offer/);
assert.match(responsibilityDeltaRetryPrompt, /EXPENSE_RESPONSIBILITY_NARRATIVE_DELTA_MISSING/);
assert.match(responsibilityDeltaRetryPrompt, /找\/请康复师或理疗师/);
assert.match(responsibilityDeltaRetryPrompt, /responsibilityKind="elder_care"/);
assert.match(responsibilityDeltaRetryPrompt, /evidence 必须逐字包含病情句与服务句/);
assert.match(responsibilityDeltaRetryPrompt, /未知金额由系统建立 needs_review/);
assert.match(rejectedExpenseLifecycleRetryPrompt, /estimate_superseded_by_exact_fact/);
assert.match(rejectedExpenseLifecycleRetryPrompt, /previousCommitmentId=原账户 id/);
assert.match(rejectedExpenseLifecycleRetryPrompt, /不得使用自由文本 changeReason/);
assert.match(rejectedExpenseLifecycleRetryPrompt, /删除这项已完成支出断言或改写为尚在核对的计划/);
assert.match(endingResponsibilityDeltaRetryPrompt, /EXPENSE_RESPONSIBILITY_NARRATIVE_DELTA_MISSING/);
assert.match(endingResponsibilityDeltaRetryPrompt, /找\/请康复师或理疗师/);
assert.match(endingResponsibilityDeltaRetryPrompt, /responsibilityKind="elder_care"/);
assert.match(endingResponsibilityDeltaRetryPrompt, /evidence 必须逐字包含病情句与服务句/);
assert.match(endingResponsibilityDeltaRetryPrompt, /未知金额由系统建立 needs_review/);
assert.match(endingResponsibilityDeltaRetryPrompt, /本轮唯一已接受的 outcome id：【ending_parent_care】/);
assert.match(endingResponsibilityDeltaRetryPrompt, /sourceOutcomeId 必须逐字等于 "ending_parent_care"/);
assert.match(endingResponsibilityDeltaRetryPrompt, /narrativeMeta 必须返回 worldDeltas/);
assert.match(staleLegacyIncomePrompt, /仍在职的迁移估算收入需要本节点明确确认/);
assert.match(staleLegacyIncomePrompt, /incomeSourceId=legacy_recurring_income/);
assert.match(staleLegacyIncomePrompt, /账本金额=monthlyNetAmountWan=2\.5/);
assert.match(staleLegacyIncomePrompt, /description 必须逐字包含以下完整句子/);
assert.match(staleLegacyIncomePrompt, /“你的税后月薪稳定在2\.5万元。”/);
assert.match(staleLegacyIncomePrompt, /payload\.incomeSourceId=legacy_recurring_income/);
assert.match(staleLegacyIncomePrompt, /payload\.nextSource\.id=legacy_recurring_income/);
assert.match(staleLegacyIncomePrompt, /payload\.nextSource\.linkedCareerStateId=career_current/);
assert.match(staleLegacyIncomePrompt, /payload\.nextSource\.monthlyNetAmountWan=2\.5/);
assert.match(staleLegacyIncomePrompt, /payload\.nextSource\.factStatus=known/);
assert.match(staleLegacyIncomePrompt, /financialScope=personal、confidence=0\.8-1/);
assert.match(staleLegacyIncomePrompt, /项目继续、公司运营或客户付费不能替代下方固定的个人薪资句/);
assert.match(staleLegacyIncomePrompt, /账本摘要、重试提示和旧节点不是 evidence/);
assert.match(staleLegacyIncomeGateRetryPrompt, /当前职业收入必须在本次重生中确认/);
assert.match(staleLegacyIncomeGateRetryPrompt, /incomeSourceId=legacy_recurring_income/);
assert.match(staleLegacyIncomeGateRetryPrompt, /税后月薪稳定在2\.5万元/);
assert.match(staleLegacyIncomeGateRetryPrompt, /Proposal\.evidence 必须逐字引用/);
assert.match(nearQuarantineLegacyIncomePrompt, /仍在职的迁移估算收入需要本节点明确确认/);
assert.match(nearQuarantineLegacyIncomePrompt, /incomeSourceId=legacy_recurring_income/);
assert.match(nearQuarantineLegacyIncomePrompt, /payload\.nextSource\.id=legacy_recurring_income/);
assert.match(alreadyQuarantinedLegacyIncomeGateRetryPrompt, /当前职业收入必须在本次重生中确认/);
assert.match(alreadyQuarantinedLegacyIncomeGateRetryPrompt, /incomeSourceId=legacy_recurring_income/);
assert.match(alreadyQuarantinedLegacyIncomeGateRetryPrompt, /accrualReviewStatus=quarantined/);
assert.match(alreadyQuarantinedLegacyIncomeGateRetryPrompt, /不得因重试、账本摘要或旧节点自动恢复计提/);
assert.match(alreadyQuarantinedLegacyIncomeGateRetryPrompt, /“你的税后月薪稳定在2\.5万元。”/);
assert.match(immutableLegacyIncomeGateRetryPrompt, /payload\.nextSource\.displayName="迁移工资"/);
assert.match(immutableLegacyIncomeGateRetryPrompt, /payload\.nextSource\.activeFromAgeInMonths=200/);
assert.match(immutableLegacyIncomeGateRetryPrompt, /payload\.nextSource\.activeUntilAgeInMonths=360/);
assert.match(immutableLegacyIncomeGateRetryPrompt, /payload\.nextSource\.linkedAssetAccountId="legacy_income_asset_link"/);
assert.match(immutableLegacyIncomeGateRetryPrompt, /payload\.nextSource\.linkedBusinessHoldingId="legacy_income_holding_link"/);
assert.match(immutableLegacyIncomeGateRetryPrompt, /payload\.nextSource\.factStatus=known/);
assert.match(immutableLegacyIncomeGateRetryPrompt, /不得新建第二份工资、改换 incomeSourceId、CareerState、金额、类型、计提频率、displayName、状态、activeFrom\/activeUntil 时间窗口或任何账户链接/);
assert.match(immutableLegacyIncomeGateRetryPrompt, /lastConfirmedAtAgeInMonths 由已接受事件写入/);
assert.match(dualAmountLegacyIncomeGateRetryPrompt, /“你的税后月薪稳定在2\.5万元。”/);
assert.doesNotMatch(dualAmountLegacyIncomeGateRetryPrompt, /“你的年税后收入稳定在30万元。”/);
assert.doesNotMatch(ordinaryCareerIncomeGateRetryPrompt, /【当前职业收入必须在本次重生中确认】/);
assert.match(legacyAggregateIncomeGateRetryPrompt, /payload\.nextSource\.type=salary/);
assert.doesNotMatch(legacyAggregateIncomeGateRetryPrompt, /payload\.nextSource\.type=other/);
assert.match(estimatedOutcomeLegacyIncomePrompt, /旧版职业收入仍是 estimated\/needs_review/);
assert.match(estimatedOutcomeLegacyIncomePrompt, /incomeSourceId=legacy_recurring_income/);
assert.match(estimatedOutcomeLegacyIncomePrompt, /旧金额、旧 type 或“此前还能维持开销”都不是当前个人薪酬事实/);
assert.match(estimatedOutcomeLegacyIncomePrompt, /A\. 若主角仍在当前受雇职业工作/);
assert.match(estimatedOutcomeLegacyIncomePrompt, /B\. 若主角已经转为独立经营或项目制顾问/);
assert.match(estimatedOutcomeLegacyIncomePrompt, /C\. 若主角已经离职、退休、停薪或不再有持续有薪工作/);
assert.doesNotMatch(estimatedOutcomeLegacyIncomePrompt, /你的税后月薪稳定在1\.5万元/);
assert.match(estimatedOutcomeLegacyIncomeGateRetryPrompt, /【当前职业收入必须在本次重生中确认】/);
assert.match(estimatedOutcomeLegacyIncomeGateRetryPrompt, /不能留在“仍有些收入”“项目继续”或“能维持开销”/);
assert.match(estimatedOutcomeLegacyIncomeGateRetryPrompt, /type=salary 或有明确个人顾问合同事实时 type=contract/);
assert.match(selfEmployedEstimatedOutcomeLegacyIncomePrompt, /若主角仍在当前独立经营或项目制顾问职业中/);
assert.match(selfEmployedEstimatedOutcomeLegacyIncomePrompt, /继续自雇本身不得虚构 employmentTransition/);
assert.match(selfEmployedEstimatedOutcomeLegacyIncomePrompt, /type=self_employment_draw 或有明确个人顾问合同事实时 type=contract/);
assert.match(partTimeEstimatedOutcomeLegacyIncomePrompt, /若主角仍在当前兼职职业工作/);
assert.match(partTimeEstimatedOutcomeLegacyIncomePrompt, /继续兼职本身不得虚构 employmentTransition/);
assert.match(partTimeEstimatedOutcomeLegacyIncomePrompt, /toStatus=employed 或 self_employed/);
assert.doesNotMatch(knownOutcomeLegacyIncomePrompt, /旧版职业收入仍是 estimated\/needs_review/);
assert.doesNotMatch(knownOutcomeLegacyIncomePrompt, /以下晚年职业收入超过36个月未确认/);
assert.doesNotMatch(knownOutcomeLegacyIncomeGateRetryPrompt, /【当前职业收入必须在本次重生中确认】/);
assert.match(v4ExpensePrompt, /V4 个人持续支出分类摘要（唯一责任事实源）/u);
assert.match(v4ExpensePrompt, /responsibilityKey=primary_residence:main/u);
assert.match(v4ExpensePrompt, /kind=primary_residence/u);
assert.match(v4ExpensePrompt, /scope=shared_household/u);
assert.match(v4ExpensePrompt, /monthly=0.3/u);
assert.match(v4ExpensePrompt, /basis=explicit_shared_amount/u);
assert.match(v4ExpensePrompt, /factStatus=known/u);
assert.match(v4ExpensePrompt, /review=normal/u);
assert.match(overdueExpenseReviewPrompt, /连续至少两个已提交的实质节点未获得新的确认/u);
assert.match(overdueExpenseReviewPrompt, /expense_review_due_shared_home/u);
assert.match(overdueExpenseReviewPrompt, /expenseCommitmentId/u);
assert.match(overdueExpenseReviewPrompt, /expense_commitment_adjusted/u);
assert.doesNotMatch(firstObservationExpenseReviewPrompt, /连续至少两个已提交的实质节点未获得新的确认/u);
assert.doesNotMatch(overduePolicyEstimatePrompt, /以下持续支出已连续至少两个已提交的实质节点未获得新的确认/u);
assert.doesNotMatch(overduePolicyEstimatePrompt, /当前月计提=0\.35/u);
assert.match(overduePolicyEstimatePrompt, /不能只因账本显示 needs_review、review_due 或门禁重生而凭空“确认”或调整/u);
assert.match(prompt, /selectedDecision 是本轮唯一获授权执行的分支/);
assert.match(prompt, /没有 relationship outcome id 时/);
assert.match(prompt, /共同育儿/);
assert.match(prompt, /孩子出生、接送、托育或共同养育/);
assert.match(prompt, /career_state worldDelta 才能增加 employmentTransition/);
assert.match(prompt, /sourceOutcomeId 必须等于上方已接受 outcome id/);
assert.match(prompt, /其他人物上学、退休、工作/);
assert.match(prompt, /descriptionParagraphs 返回 2-4 个完整自然段/);
assert.match(prompt, /每个数组项只能包含一个完整段落/);
assert.match(prompt, /不要重复返回 description 字符串/);
assert.doesNotMatch(prompt, /达到 73 岁及以上/);

const repairLedger = initializeFinancialLedger({ id: "prompt_repair", asOfAgeInMonths: 300 });
const debtRepairPrompt = buildFinancialProposalRepairPrompt({
  rejectedProposals: [],
  issues: [],
  ledger: repairLedger,
  acceptedOutcomeId: "borrow",
  narrativeText: "银行完成20万元贷款放款。",
  periodStartAgeInMonths: 300,
  periodEndAgeInMonths: 306
});
assert.match(debtRepairPrompt, /debt_drawn 的 payload 必须是/);
assert.match(debtRepairPrompt, /不得返回把 id、type、principalAmountWan/);
assert.match(debtRepairPrompt, /debt_restructured 只能在正文明确写出银行已经批准且新还款安排已经生效时返回/);
assert.match(debtRepairPrompt, /不得为了让故事推进而新增卖车到账/);
assert.match(debtRepairPrompt, /即使正文写“你收到”或“到账”，也必须移除对应个人收入 Proposal/);
assert.match(debtRepairPrompt, /changeReason="estimate_superseded_by_exact_fact"/);
assert.match(debtRepairPrompt, /不得用自由文本 changeReason/);

const narrativeRepairPrompt = buildFinancialNarrativeRepairPrompt({
  narrativeText: "银行完成20万元贷款放款，你开始每月还贷。",
  rejectedProposals: [{
    id: "loan", kind: "debt_drawn", effectiveAtAgeInMonths: 306, payload: {},
    sourceOutcomeId: "borrow", evidence: "银行完成20万元贷款放款。", confidence: 0.9
  }],
  acceptedEvents: []
});
assert.match(narrativeRepairPrompt, /不得继续声称贷款已经获批、放款、到账/);
assert.match(narrativeRepairPrompt, /不得继续声称已经产生该笔贷款的月供、还贷或欠款/);

const lateCareerPrompt = buildNextNodePrompt({
  userData,
  answers,
  history: [{ ...history[0], age: 80, ageInMonths: 960 }],
  currentAttributes,
  selectedDecision: "继续独立写作",
  eventSeed: healthWarningEvent
});
assert.match(lateCareerPrompt, /主角已满 80 岁：本节点不得继续沿用 employed/);
assert.match(lateCareerPrompt, /self_employed/);

const mother = {
  id: "person_mother",
  identityKey: { namespace: "user_role" as const, key: "parent:mother" },
  displayName: "母亲",
  relation: "parent" as const,
  lifeStatus: "active" as const,
  source: "user_fact" as const,
  confidence: 1
};
const familyWorldState: WorldStateSnapshot = {
  people: [mother],
  directionArcs: [],
  pressureArcs: [],
  relationships: [],
  familyRelationships: [{
    id: "family_mother",
    participantPersonId: mother.id,
    role: "mother",
    activation: "active",
    contact: "frequent",
    emotionalSupport: "supportive",
    practicalSupport: "conditional",
    autonomyRespect: "high",
    conflictIntensity: "low",
    topicStances: [{
      id: "stance_relocation",
      topic: "relocation",
      stance: "concerned_but_respectful",
      reasons: ["担心搬家成本，但尊重最终决定"],
      effectiveFromAgeInMonths: 288,
      evidence: [{ nodeIndex: 3, sourceOutcomeId: "discuss_relocation", evidence: "我有些担心，但你自己决定。" }],
      source: "accepted_history",
      confidence: 0.9
    }],
    revision: 1
  }],
  version: 2
};
const familyPrompt = buildNextNodePrompt({
  userData,
  answers,
  history,
  currentAttributes,
  selectedDecision: "继续推进职业计划",
  eventSeed: null,
  worldState: familyWorldState
});
assert.match(familyPrompt, /【当前权威家庭关系状态】/);
assert.match(familyPrompt, /role=mother/);
assert.match(familyPrompt, /emotionalSupport=supportive/);
assert.match(familyPrompt, /autonomyRespect=high/);
assert.match(familyPrompt, /relocation=concerned_but_respectful/);
assert.match(familyPrompt, /担心搬家成本，但尊重最终决定/);
assert.match(familyPrompt, /unknown 表示尚无已接受事实，不得解释为反对、保守、冷漠或控制/);

const healthArcBase: PressureArcState = {
  id: "pressure_health_test",
  eventId: "health_forced_pause",
  eventIntentType: "health_forced_pause",
  phasePolicyId: "health_crisis_v1",
  phaseId: "trigger",
  status: "active",
  startedAtAgeInMonths: 24 * 12,
  phaseStartedAtAgeInMonths: 24 * 12,
  phaseCheckpointCount: 0,
  totalCheckpointCount: 0,
  unresolvedSummary: "身体状态迫使生活节奏暂停"
};

function healthPhasePrompt(phaseId: string): string {
  return buildNextNodePrompt({
    userData,
    answers,
    history,
    currentAttributes,
    selectedDecision: "调整负荷并继续治疗",
    eventSeed: healthWarningEvent,
    foregroundPressureArc: { ...healthArcBase, phaseId }
  });
}

assert.match(healthPhasePrompt("trigger"), /健康危机触发阶段/);
assert.match(healthPhasePrompt("trigger"), /唯一允许使用“停摆、住院、被迫暂停”/);
assert.match(healthPhasePrompt("recovery"), /健康恢复与观察阶段/);
assert.match(healthPhasePrompt("recovery"), /不得再次制造新的停摆、住院或突发恶化/);
assert.match(healthPhasePrompt("recovery"), /pressure_addressed 或 stability_reached/);
assert.match(healthPhasePrompt("operation"), /健康压力阶段结果/);
assert.match(healthPhasePrompt("operation"), /arcSignals 必须返回 pressure_resolved/);
assert.match(healthPhasePrompt("operation"), /不得把阶段结果写成完全治愈/);

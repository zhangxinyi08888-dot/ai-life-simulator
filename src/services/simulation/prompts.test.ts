import assert from "node:assert/strict";
import { LifeEventSeed } from "../../data/lifeEvents";
import { HistoryItem, LifeAttributes, PressureArcState, QuestionTurn, UserInitialData, WorldStateSnapshot } from "../../types";
import { initializeFinancialLedger } from "../../domain/finance";
import { buildFinancialNarrativeRepairPrompt, buildFinancialProposalRepairPrompt, buildNextNodePrompt, buildNodePromptWithRetryNotice } from "./prompts";

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

assert.doesNotMatch(prompt, /高薪不是必然伤健康/);
assert.doesNotMatch(prompt, /高强度、长期、无恢复机制/);
assert.doesNotMatch(prompt, /选择高薪项目可以提高财富/);
assert.doesNotMatch(prompt, /健康是否下降要看工作强度、当前健康、是否有恢复策略/);
assert.match(prompt, /年龄约束执行条件，不约束人生愿望/);
assert.match(prompt, /55岁创业/);
assert.match(prompt, /temporalHint、decisionIntent、expectedWorldDeltaTypes；有事件种子时还必须带 eventOutcomeId/);
assert.match(prompt, /每个 choice 必须返回 eventOutcomeId/);
assert.match(buildNodePromptWithRetryNotice(prompt, ["invalidJson"]), /返回内容不是可解析的完整 JSON/);
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
assert.match(prompt, /不得返回债务净变化、资产净变化或最终余额/);
assert.match(prompt, /debtAccount.*destinationCashAccountId.*principalDrawnWan/s);
assert.match(prompt, /debtAccount\.principalWan 必须严格等于 principalDrawnWan/);
assert.match(prompt, /公司融资只能用 business_financing_recorded/);
assert.match(prompt, /employmentStatus 不属于财务 Proposal/);
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
assert.match(prompt, /selectedDecision 是本轮唯一获授权执行的分支/);
assert.match(prompt, /没有 relationship outcome id 时/);
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

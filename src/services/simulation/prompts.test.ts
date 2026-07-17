import assert from "node:assert/strict";
import { LifeEventSeed } from "../../data/lifeEvents";
import { HistoryItem, LifeAttributes, PressureArcState, QuestionTurn, UserInitialData } from "../../types";
import { buildNextNodePrompt } from "./prompts";

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

assert.doesNotMatch(prompt, /高薪不是必然伤健康/);
assert.doesNotMatch(prompt, /高强度、长期、无恢复机制/);
assert.doesNotMatch(prompt, /选择高薪项目可以提高财富/);
assert.doesNotMatch(prompt, /健康是否下降要看工作强度、当前健康、是否有恢复策略/);
assert.match(prompt, /年龄约束执行条件，不约束人生愿望/);
assert.match(prompt, /55岁创业/);
assert.match(prompt, /temporalHint、decisionIntent、expectedWorldDeltaTypes；有事件种子时还必须带 eventOutcomeId/);
assert.match(prompt, /每个 choice 必须返回 eventOutcomeId/);
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
assert.match(prompt, /propertyMarketValueChangeWan/);
assert.match(prompt, /最终金额由系统统一计算和展示/);
assert.doesNotMatch(prompt, /达到 73 岁及以上/);

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

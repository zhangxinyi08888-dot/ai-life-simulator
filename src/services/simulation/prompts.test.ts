import assert from "node:assert/strict";
import { LifeEventSeed } from "../../data/lifeEvents";
import { HistoryItem, LifeAttributes, QuestionTurn, UserInitialData } from "../../types";
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
    allowedOutcomes: ["persist_high_pressure", "optimize_load", "exit_or_pause"],
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

assert.match(prompt, /高薪不是必然伤健康/);
assert.match(prompt, /高强度、长期、无恢复机制/);
assert.match(prompt, /选择高薪项目可以提高财富/);
assert.match(prompt, /健康是否下降要看工作强度、当前健康、是否有恢复策略/);
assert.match(prompt, /年龄约束执行条件，不约束人生愿望/);
assert.match(prompt, /55岁创业/);
assert.match(prompt, /temporalHint、decisionIntent、expectedWorldDeltaTypes/);
assert.match(prompt, /不能自行创建或修改 Arc 状态|模型不得修改 phase/);
assert.doesNotMatch(prompt, /达到 73 岁及以上/);

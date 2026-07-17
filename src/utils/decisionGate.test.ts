import assert from "node:assert/strict";
import { HistoryItem, SimulationChoice, SimulationNode } from "../types";
import { evaluateDecisionGate } from "./decisionGate";

const base: SimulationNode = {
  age: 35,
  ageInMonths: 420,
  stage: "创业阶段",
  title: "现金流选择",
  description: "公司需要决定下一步。",
  attributes: { happiness: 50, intelligence: 70, wealth: 40, relation: 55, health: 60 },
  isEndingNode: false,
  choices: [
    { id: "A", text: "缩减团队保现金流", impactSummary: "收缩求稳", decisionIntent: "reduce_team", expectedWorldDeltaTypes: ["career_state"] },
    { id: "B", text: "寻找新投资继续扩张", impactSummary: "融资扩张", decisionIntent: "raise_funding", expectedWorldDeltaTypes: ["career_state", "relationship_change"] },
    { id: "C", text: "出售业务退出创业", impactSummary: "出售退出", decisionIntent: "sell_business", expectedWorldDeltaTypes: ["career_state", "location_change"] }
  ]
};

assert.equal(evaluateDecisionGate({ candidateNode: base, recentHistory: [], targetAgeInMonths: 420 }).isDecisionCheckpoint, true);

const repetitive: SimulationNode = {
  ...base,
  choices: [
    { id: "A", text: "继续恢复", impactSummary: "继续恢复", decisionIntent: "继续恢复", expectedWorldDeltaTypes: ["health_state"] },
    { id: "B", text: "继续观察", impactSummary: "继续观察", decisionIntent: "继续恢复", expectedWorldDeltaTypes: ["health_state"] },
    { id: "C", text: "继续休息", impactSummary: "继续休息", decisionIntent: "继续恢复", expectedWorldDeltaTypes: ["health_state"] }
  ]
};
const rejected = evaluateDecisionGate({ candidateNode: repetitive, recentHistory: [], targetAgeInMonths: 420 });
assert.equal(rejected.isDecisionCheckpoint, false);
assert.ok(rejected.reasonCodes.includes("insufficient-distinct-actions"));

const cityChoices: SimulationChoice[] = [
  { id: "A", text: "继续留在深圳发展", impactSummary: "留深发展", decisionIntent: "location:stay_in:shenzhen", expectedWorldDeltaTypes: ["career_state"] },
  { id: "B", text: "接受武汉光谷 offer 并搬迁", impactSummary: "迁往武汉", decisionIntent: "location:relocate_to:wuhan_guanggu", expectedWorldDeltaTypes: ["career_state", "location_change"] },
  { id: "C", text: "与武汉公司远程合作", impactSummary: "远程合作", decisionIntent: "career:work_remote:wuhan_company", expectedWorldDeltaTypes: ["career_state"] }
];

function cityHistoryItem(age: number, selectedChoice: string): HistoryItem {
  return {
    age,
    stage: "职业选择",
    title: "城市与工作选择",
    description: "家庭建议和职业发展出现分歧。",
    selectedChoice,
    attributes: base.attributes,
    choices: cityChoices,
    isEndingNode: false
  };
}

const cooledCandidate: SimulationNode = {
  ...base,
  choices: [
    cityChoices[1],
    { id: "B", text: "接受内部架构师岗位", impactSummary: "内部晋升", decisionIntent: "career:accept_role:internal_architect", expectedWorldDeltaTypes: ["career_state"] },
    { id: "C", text: "继续寻找深圳外部机会", impactSummary: "外部求职", decisionIntent: "career:seek_role:shenzhen_external", expectedWorldDeltaTypes: ["career_state", "relationship_change"] }
  ]
};

const passedOnce = [cityHistoryItem(39, cityChoices[0].text)];
assert.equal(evaluateDecisionGate({ candidateNode: cooledCandidate, recentHistory: passedOnce, targetAgeInMonths: 480 }).isDecisionCheckpoint, true);

const passedTwice = [...passedOnce, cityHistoryItem(40, cityChoices[0].text)];
const cooledResult = evaluateDecisionGate({ candidateNode: cooledCandidate, recentHistory: passedTwice, targetAgeInMonths: 492 });
assert.equal(cooledResult.isDecisionCheckpoint, false);
assert.equal(cooledResult.repeatsRecentlyPassedOption, true);
assert.deepEqual(cooledResult.blockedDecisionIntents, ["location:relocate_to:wuhan_guanggu"]);
assert.ok(cooledResult.reasonCodes.includes("repeats-recently-passed-option"));

const selectedLater = [...passedTwice, cityHistoryItem(41, cityChoices[1].text)];
const restoredResult = evaluateDecisionGate({ candidateNode: cooledCandidate, recentHistory: selectedLater, targetAgeInMonths: 504 });
assert.equal(restoredResult.repeatsRecentlyPassedOption, false);

const allowedOutcomeIds = ["consolidate_recovery_plan", "resume_activity_gradually", "adjust_plan_based_on_remaining_limits"];
const validEventNode: SimulationNode = {
  ...base,
  choices: [
    { ...base.choices[0], eventOutcomeId: allowedOutcomeIds[0] },
    { ...base.choices[1], eventOutcomeId: allowedOutcomeIds[1] },
    { ...base.choices[2], eventOutcomeId: allowedOutcomeIds[2] }
  ]
};
assert.equal(evaluateDecisionGate({
  candidateNode: validEventNode,
  recentHistory: [],
  targetAgeInMonths: 420,
  allowedOutcomeIds,
  narrativeMode: "recovery_growth"
}).isDecisionCheckpoint, true);

const invalidOutcome = evaluateDecisionGate({
  candidateNode: { ...validEventNode, choices: validEventNode.choices.map((choice) => ({ ...choice, eventOutcomeId: "invented_outcome" })) },
  recentHistory: [], targetAgeInMonths: 420, allowedOutcomeIds, narrativeMode: "recovery_growth"
});
assert.ok(invalidOutcome.reasonCodes.includes("event-outcome-not-allowed"));
assert.ok(invalidOutcome.reasonCodes.includes("insufficient-event-strategy-coverage"));

const recoveryOnlyMaintain = evaluateDecisionGate({
  candidateNode: {
    ...validEventNode,
    choices: [
      { ...base.choices[0], eventOutcomeId: "continue_recovery" },
      { ...base.choices[1], eventOutcomeId: "continue_observation" },
      { ...base.choices[2], eventOutcomeId: "maintain_recovery" }
    ]
  },
  recentHistory: [], targetAgeInMonths: 420,
  allowedOutcomeIds: ["continue_recovery", "continue_observation", "maintain_recovery"],
  narrativeMode: "recovery_growth"
});
assert.ok(recoveryOnlyMaintain.reasonCodes.includes("recovery-options-only-maintain"));

const stabilityOnlyMaintain = evaluateDecisionGate({
  candidateNode: {
    ...validEventNode,
    choices: [
      { ...base.choices[0], eventOutcomeId: "maintain_current_rhythm" },
      { ...base.choices[1], eventOutcomeId: "maintain_current_order" },
      { ...base.choices[2], eventOutcomeId: "keep_current_arrangement" }
    ]
  },
  recentHistory: [], targetAgeInMonths: 420,
  allowedOutcomeIds: ["maintain_current_rhythm", "maintain_current_order", "keep_current_arrangement"],
  narrativeMode: "stability_meaning"
});
assert.ok(stabilityOnlyMaintain.reasonCodes.includes("stability-options-no-concrete-progression"));

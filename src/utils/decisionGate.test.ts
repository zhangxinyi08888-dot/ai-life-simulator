import assert from "node:assert/strict";
import { SimulationNode } from "../types";
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

import assert from "node:assert/strict";
import { DEFAULT_ENDING_POLICY } from "../config/endingPolicy";
import { SimulationNode } from "../types";
import { evaluateEnding } from "./endingDecision";

function node(age: number, health = 60): SimulationNode {
  return {
    age,
    ageInMonths: age * 12,
    stage: "测试",
    title: "测试",
    description: "测试节点",
    choices: [{ id: "A", text: "继续", impactSummary: "继续生活" }, { id: "B", text: "调整", impactSummary: "调整节奏" }, { id: "C", text: "转向", impactSummary: "改变方向" }],
    attributes: { happiness: 50, intelligence: 50, wealth: 50, relation: 50, health },
    isEndingNode: false
  };
}

const beforeSoftAge = evaluateEnding({ candidateNode: node(72), history: [], targetAgeInMonths: 72 * 12, elapsedMonths: 12, simulationSeed: "s", branchFingerprint: "b", nodeIndex: 1, policy: DEFAULT_ENDING_POLICY });
assert.equal(beforeSoftAge.annualProbability, 0);
assert.equal(beforeSoftAge.shouldEnd, false);

const age80 = evaluateEnding({ candidateNode: node(80, 50), history: [], targetAgeInMonths: 80 * 12, elapsedMonths: 12, simulationSeed: "s", branchFingerprint: "b", nodeIndex: 1, policy: DEFAULT_ENDING_POLICY });
assert.equal(age80.annualProbability, 0.05);

const sixMonths = evaluateEnding({ candidateNode: node(80, 50), history: [], targetAgeInMonths: 80 * 12, elapsedMonths: 6, simulationSeed: "s", branchFingerprint: "b", nodeIndex: 1, policy: DEFAULT_ENDING_POLICY });
assert.ok(sixMonths.nodeProbability < age80.nodeProbability);

const critical = evaluateEnding({ candidateNode: node(80, 10), history: [], targetAgeInMonths: 80 * 12, elapsedMonths: 12, simulationSeed: "s", branchFingerprint: "b", nodeIndex: 1, policy: DEFAULT_ENDING_POLICY });
assert.ok(critical.annualProbability >= 0.65);

const hardMaximum = evaluateEnding({ candidateNode: node(110), history: [], targetAgeInMonths: 110 * 12, elapsedMonths: 12, simulationSeed: "s", branchFingerprint: "b", nodeIndex: 1, policy: DEFAULT_ENDING_POLICY });
assert.equal(hardMaximum.shouldEnd, true);
assert.equal(hardMaximum.forcedByHardMaximum, true);

const repeated = evaluateEnding({ candidateNode: node(80, 50), history: [], targetAgeInMonths: 80 * 12, elapsedMonths: 12, simulationSeed: "s", branchFingerprint: "b", nodeIndex: 1, policy: DEFAULT_ENDING_POLICY });
assert.equal(repeated.roll, age80.roll);

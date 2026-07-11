import assert from "node:assert/strict";
import { HistoryItem, LifeAttributes, PressureArcState, SimulationChoice, UserInitialData, WorldStateSnapshot } from "../../types";
import { generateNextNode, startSimulation } from "./simulationService";

const attributes: LifeAttributes = { happiness: 60, intelligence: 75, wealth: 60, relation: 60, health: 70 };
const userData: UserInitialData = {
  birthday: "1990-01-01",
  birthtime: "08:00",
  gender: "女",
  currentSituation: "继续经营自己的事业",
  isReturnToPast: true,
  targetAgeNode: "创业",
  regressionNodeKey: "career",
  regressionAge: 35,
  regressionSituation: "创业后经历融资压力",
  regressionChoices: "继续把公司做成长期事业",
  coreStoryFocus: "career"
};

function choices(repetitive = false): SimulationChoice[] {
  if (repetitive) {
    return ["继续恢复", "继续观察", "继续休息"].map((text, index) => ({
      id: String.fromCharCode(65 + index), text, impactSummary: "继续等待", decisionIntent: "keep_waiting", expectedWorldDeltaTypes: ["health_state"]
    }));
  }
  return [
    { id: "A", text: "扩大现有业务", impactSummary: "继续扩张", decisionIntent: "expand", expectedWorldDeltaTypes: ["career_state"] },
    { id: "B", text: "引入职业经理人", impactSummary: "协作经营", decisionIntent: "delegate", expectedWorldDeltaTypes: ["career_state", "relationship_change"] },
    { id: "C", text: "缩减规模保持利润", impactSummary: "稳健经营", decisionIntent: "reduce_scope", expectedWorldDeltaTypes: ["career_state"] }
  ];
}

function rawNode(description = "公司经营稳定，你需要决定下一步。", repetitive = false) {
  return {
    age: 999,
    stage: "事业经营",
    title: "下一阶段",
    description,
    choices: choices(repetitive),
    attributes,
    isEndingNode: false,
    narrativeMeta: {
      recoveryState: "protected",
      recoveryEvidence: ["工作负荷已经降低"],
      worldDeltas: [{ type: "career_state", summary: "公司进入稳定经营" }],
      arcSignals: [{ type: "stability_reached", evidence: "经营稳定", confidence: 0.9 }],
      activeCharacters: [],
      storyEpisode: { internalTransitions: [], summary: "经营调整" }
    }
  };
}

function pressureArc(age: number, phaseId = "operation"): PressureArcState {
  return {
    id: "pressure_venture",
    eventId: "career_venture_pressure",
    eventIntentType: "career_venture_pressure",
    phasePolicyId: "generic_pressure_v1",
    phaseId,
    status: "active",
    startedAtAgeInMonths: 35 * 12,
    phaseStartedAtAgeInMonths: age * 12,
    phaseCheckpointCount: 0,
    totalCheckpointCount: 4,
    unresolvedSummary: "融资压力"
  };
}

function historyAt(age: number, arc?: PressureArcState): HistoryItem[] {
  const worldStateSnapshot: WorldStateSnapshot = {
    people: [],
    directionArcs: [{ id: "direction_venture", directionType: "career", summary: "长期创业", status: "active", startedAtAgeInMonths: 35 * 12, userReinforcementCount: 3, establishedAssets: ["公司"] }],
    pressureArcs: arc ? [arc] : [],
    foregroundPressureArcId: arc?.id,
    committedTransactionIds: [],
    version: 1
  };
  return [{
    age,
    ageInMonths: age * 12,
    stage: "创业经营",
    title: "公司经营",
    description: "公司已经运行多年。",
    selectedChoice: "继续创业",
    choices: [{ id: "A", text: "继续创业", impactSummary: "继续经营", temporalHint: { lifeIntensity: "high_tension", durationMonths: [6, 12], requiresFollowUp: true, reason: "创业" } }],
    attributes,
    isEndingNode: false,
    worldStateSnapshot
  }];
}

let capturedPrompt = "";
const stableOperation = await generateNextNode({
  userData,
  answers: [],
  history: historyAt(35, pressureArc(35)),
  currentAttributes: attributes,
  selectedDecision: "继续创业",
  nodeIndex: 1,
  simulationSeed: "operation-seed"
}, {
  callAiJson: async (prompt) => {
    capturedPrompt = prompt;
    return { text: JSON.stringify(rawNode()) };
  }
});
assert.equal(stableOperation.narrativeMeta?.lifeIntensity, "stable");
assert.ok((stableOperation.narrativeMeta?.elapsedMonths || 0) >= 24);
assert.equal(stableOperation.worldStateSnapshot?.pressureArcs[0].status, "resolved");
assert.match(capturedPrompt, /phase=operation/);
assert.match(capturedPrompt, /LifeIntensity=stable/);

const originalRandom = Math.random;
Math.random = () => 0.1;
try {
  let forbiddenAttempts = 0;
  const repaired = await generateNextNode({
    userData,
    answers: [],
    history: historyAt(40),
    currentAttributes: attributes,
    selectedDecision: "继续经营",
    nodeIndex: 1,
    simulationSeed: "forbidden-seed"
  }, {
    callAiJson: async () => {
      forbiddenAttempts += 1;
      return { text: JSON.stringify(forbiddenAttempts === 1 ? { ...rawNode(), nextPhaseId: "growth" } : rawNode("公司经营稳定，规则由状态机决定。")) };
    }
  });
  assert.equal(forbiddenAttempts, 2);
  assert.equal(repaired.committedArcMeta?.transitionAction, "stay");

  let gateAttempts = 0;
  const gated = await generateNextNode({
    userData,
    answers: [],
    history: historyAt(40),
    currentAttributes: attributes,
    selectedDecision: "继续经营",
    nodeIndex: 1,
    simulationSeed: "gate-seed"
  }, {
    callAiJson: async () => {
      gateAttempts += 1;
      return { text: JSON.stringify(rawNode(gateAttempts === 1 ? "恢复期没有新变化。" : "恢复完成后出现新的经营选择。", gateAttempts === 1)) };
    }
  });
  assert.equal(gateAttempts, 2);
  assert.equal(gated.choices[0].decisionIntent, "expand");
} finally {
  Math.random = originalRandom;
}

let endingCalls = 0;
const ending = await generateNextNode({
  userData,
  answers: [],
  history: historyAt(109, pressureArc(109)),
  currentAttributes: attributes,
  selectedDecision: "继续经营",
  nodeIndex: 20,
  simulationSeed: "hard-ending"
}, {
  callAiJson: async (prompt) => {
    endingCalls += 1;
    if (prompt.includes("自然终章")) {
      return { text: JSON.stringify({ ...rawNode("你在长期事业与关系中自然收束了这一生。"), title: "人生终章", stage: "终章", choices: [{ id: "ENDING", text: "安详落幕，查看一生洞察", impactSummary: "一生回望" }], isEndingNode: true }) };
    }
    return { text: JSON.stringify(rawNode()) };
  }
});
assert.equal(endingCalls, 2);
assert.equal(ending.age, 110);
assert.equal(ending.isEndingNode, true);
assert.equal(ending.choices.length, 1);

const age80Start = await startSimulation({ ...userData, regressionAge: 80 }, [], {
  callAiJson: async () => ({ text: JSON.stringify({ initialAttributes: attributes, startNode: rawNode("80岁时，你仍准备继续经营和旅行。") }) })
});
assert.equal(age80Start.startNode.age, 80);
assert.equal(age80Start.startNode.isEndingNode, false);

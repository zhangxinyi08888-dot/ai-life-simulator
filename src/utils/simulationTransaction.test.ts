import assert from "node:assert/strict";
import { SimulationNode, StoryEpisode, WorldDelta } from "../types";
import { reducePressureArc } from "./arcLifecycle";
import { commitSimulationTransaction, emptyWorldState } from "./simulationTransaction";
import { advanceOngoingProcesses } from "./ongoingProcess";

const node: SimulationNode = {
  age: 35,
  stage: "创业",
  title: "融资",
  description: "获得投资。",
  choices: [{ id: "A", text: "扩张", impactSummary: "继续扩张" }],
  attributes: { happiness: 50, intelligence: 70, wealth: 60, relation: 55, health: 60 },
  isEndingNode: false
};
const episode: StoryEpisode = { id: "episode", startAgeInMonths: 420, endAgeInMonths: 426, internalTransitions: [], decisionCheckpointId: "node", summary: "融资期" };
const arc = reducePressureArc({ startProposal: { eventId: "venture", eventIntentType: "venture", currentAgeInMonths: 420 }, selectedDecision: "创业", attributes: node.attributes, timelineAdvance: { elapsedMonths: 0, targetAgeInMonths: 420 } }).nextArcState!;
const transition = reducePressureArc({ currentArc: arc, selectedDecision: "接受投资", acceptedOutcome: { worldDeltas: [{ type: "career_state", summary: "获得投资" }], arcSignals: [{ type: "funding_secured", evidence: "获得投资", confidence: 1 }] }, attributes: node.attributes, timelineAdvance: { elapsedMonths: 6, targetAgeInMonths: 426 } });
const input = { transactionId: "tx", node, storyEpisode: episode, acceptedOutcome: { worldDeltas: [{ type: "career_state", summary: "获得投资" }] as WorldDelta[], arcSignals: [] }, pressureArcTransition: transition, currentWorldStateSnapshot: emptyWorldState() };
const committed = commitSimulationTransaction(input);
assert.equal(committed.worldStateSnapshot.pressureArcs.length, 1);
assert.equal(committed.worldStateSnapshot.committedTransactionIds?.length, 1);

const repeated = commitSimulationTransaction({ ...input, currentWorldStateSnapshot: committed.worldStateSnapshot });
assert.equal(repeated.alreadyCommitted, true);
assert.equal(repeated.worldStateSnapshot.committedTransactionIds?.length, 1);

const pregnancy = {
  id: "pregnancy_1",
  type: "pregnancy" as const,
  subjectPersonIds: ["family_partner"],
  status: "active" as const,
  startedAtAgeInMonths: 420,
  expectedEndAgeInMonths: 429,
  lastUpdatedAtAgeInMonths: 426,
  source: "history" as const,
  confidence: 0.9
};
const processAdvance = advanceOngoingProcesses({ ongoingProcesses: [pregnancy], previousAgeInMonths: 426, targetAgeInMonths: 438 });
assert.throws(() => commitSimulationTransaction({
  ...input,
  transactionId: "process-missing",
  node: { ...node, age: 36, ageInMonths: 438 },
  currentWorldStateSnapshot: { ...emptyWorldState(), ongoingProcesses: [pregnancy] },
  processAdvance
}), /PROCESS_TRANSITION_REQUIRED/);

const processCommitted = commitSimulationTransaction({
  ...input,
  transactionId: "process-completed",
  node: { ...node, age: 36, ageInMonths: 438 },
  acceptedOutcome: {
    worldDeltas: [{ type: "process_completed", processId: "pregnancy_1", completedAtAgeInMonths: 429, summary: "孩子出生" }],
    arcSignals: []
  },
  currentWorldStateSnapshot: { ...emptyWorldState(), ongoingProcesses: [pregnancy] },
  processAdvance
});
assert.equal(processCommitted.worldStateSnapshot.ongoingProcesses?.[0].status, "completed");
const processRepeated = commitSimulationTransaction({
  ...input,
  transactionId: "process-completed",
  node: { ...node, age: 36, ageInMonths: 438 },
  acceptedOutcome: {
    worldDeltas: [{ type: "process_completed", processId: "pregnancy_1", completedAtAgeInMonths: 429, summary: "孩子出生" }],
    arcSignals: []
  },
  currentWorldStateSnapshot: processCommitted.worldStateSnapshot,
  processAdvance
});
assert.equal(processRepeated.alreadyCommitted, true);
assert.equal(processRepeated.worldStateSnapshot.ongoingProcesses?.filter((process) => process.id === "pregnancy_1").length, 1);

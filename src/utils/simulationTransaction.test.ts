import assert from "node:assert/strict";
import { SimulationNode, StoryEpisode, WorldDelta } from "../types";
import { reducePressureArc } from "./arcLifecycle";
import { commitSimulationTransaction, emptyWorldState } from "./simulationTransaction";

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

const careerCommitted = commitSimulationTransaction({
  ...input,
  transactionId: "career-tx",
  currentWorldStateSnapshot: emptyWorldState(),
  acceptedOutcome: {
    worldDeltas: [{
      type: "career_state",
      summary: "正式开始全职创业",
      employmentTransition: {
        subject: "protagonist",
        toStatus: "self_employed",
        effectiveAtAgeInMonths: 426,
        sourceOutcomeId: "start_business",
        evidence: "正式开始全职创业",
        confidence: 0.95
      }
    }],
    arcSignals: []
  }
});
assert.equal(careerCommitted.worldStateSnapshot.currentEmploymentStatus, "self_employed");
assert.equal(careerCommitted.worldStateSnapshot.version, 2);
assert.equal(careerCommitted.worldStateSnapshot.careerStates?.length, 1);
assert.equal(careerCommitted.worldStateSnapshot.currentCareerStateId, "career_career-tx_0");

import assert from "node:assert/strict";
import test from "node:test";
import type { HistoryItem, LifeAttributes, WorldStateSnapshot } from "../../types";
import { isLifeEventCandidateEligible, LIFE_EVENTS_DATABASE } from "../../data/lifeEvents";
import { calculateTimelineAdvance } from "../../utils/timelineAdvance";
import {
  activeRelationshipCheckpoint,
  advanceExplorationProgression,
  createCommitmentProgression,
  createExplorationProgression,
  delayCommitmentProgression,
  earliestRelationshipCheckpointTimelineBoundary,
  relationshipLifecycleEventId
} from "./relationshipLifecycle";

const attributes: LifeAttributes = {
  happiness: 60,
  intelligence: 70,
  wealth: 55,
  relation: 60,
  health: 65
};

function historyWithProgression(
  progression: ReturnType<typeof createExplorationProgression> | ReturnType<typeof createCommitmentProgression>,
  stage: "exploring" | "dating",
  ageInMonths: number
): HistoryItem[] {
  const snapshot: WorldStateSnapshot = {
    people: [{
      id: "person",
      identityKey: { namespace: "accepted_character", key: "candidate" },
      displayName: "林遥",
      relation: "partner",
      lifeStatus: "active",
      source: "accepted_history",
      confidence: 0.9
    }],
    directionArcs: [],
    pressureArcs: [],
    relationships: [{
      id: "relationship",
      participantPersonIds: ["person"],
      type: "romantic",
      stage,
      status: "active",
      effectiveFromAgeInMonths: progression.startedAtAgeInMonths,
      progression,
      source: "accepted_history",
      confidence: 0.9
    }],
    relationshipProgressionVersion: 1,
    version: 2
  };
  return [{
    age: Math.floor(ageInMonths / 12),
    ageInMonths,
    title: "上一节点",
    stage: "继续生活",
    description: "关系保持连续。",
    selectedChoice: "继续",
    attributes,
    choices: [],
    isEndingNode: false,
    worldStateSnapshot: snapshot
  }];
}

test("exploration clarification is gated by progression time rather than prose", () => {
  const event = LIFE_EVENTS_DATABASE.find((candidate) => candidate.id === "romance_connection_clarification")!;
  const progression = createExplorationProgression(360);
  assert.equal(isLifeEventCandidateEligible(event, attributes, {}, 30.1, historyWithProgression(progression, "exploring", 361)), false);
  assert.equal(isLifeEventCandidateEligible(event, attributes, {}, 30.25, historyWithProgression(progression, "exploring", 363)), true);
});

test("due and overdue checkpoints resolve to a causal follow-up event", () => {
  const exploration = createExplorationProgression(360);
  const due = activeRelationshipCheckpoint(historyWithProgression(exploration, "exploring", 372)[0].worldStateSnapshot, 372)!;
  assert.equal(due.status, "due");
  assert.equal(relationshipLifecycleEventId(due, 372), "romance_connection_clarification");

  const terminal = advanceExplorationProgression(advanceExplorationProgression(exploration, 369), 381);
  const resolution = activeRelationshipCheckpoint(historyWithProgression(terminal, "exploring", 381)[0].worldStateSnapshot, 381)!;
  assert.equal(relationshipLifecycleEventId(resolution, 381), "romance_exploration_resolution");
  const resolutionEvent = LIFE_EVENTS_DATABASE.find((candidate) => candidate.id === "romance_exploration_resolution")!;
  assert.equal(isLifeEventCandidateEligible(
    resolutionEvent,
    attributes,
    {},
    381 / 12,
    historyWithProgression(terminal, "exploring", 381)
  ), true);

  const commitment = createCommitmentProgression(360);
  const commitmentDue = activeRelationshipCheckpoint(historyWithProgression(commitment, "dating", 384)[0].worldStateSnapshot, 384)!;
  assert.equal(relationshipLifecycleEventId(commitmentDue, 384), "relationship_material_commitment_test");
  const commitmentEvent = LIFE_EVENTS_DATABASE.find((candidate) => candidate.id === "relationship_material_commitment_test")!;
  assert.equal(isLifeEventCandidateEligible(
    commitmentEvent,
    attributes,
    {},
    32,
    historyWithProgression(commitment, "dating", 384)
  ), true);

  const delayedCommitment = delayCommitmentProgression(commitment, 384);
  const finalCommitment = activeRelationshipCheckpoint(
    historyWithProgression(delayedCommitment, "dating", 396)[0].worldStateSnapshot,
    396
  )!;
  assert.equal(relationshipLifecycleEventId(finalCommitment, 396), "relationship_commitment_resolution");
});

test("ordinary timeline cannot cross an active checkpoint maxAt boundary", () => {
  const snapshot = historyWithProgression(createExplorationProgression(360), "exploring", 361)[0].worldStateSnapshot;
  const boundary = earliestRelationshipCheckpointTimelineBoundary(snapshot, 361);
  assert.equal(boundary, 371);
  const advance = calculateTimelineAdvance({
    currentAgeInMonths: 361,
    temporalProfile: { lifeIntensity: "stable", durationMonths: [36, 60], requiresFollowUp: false },
    simulationSeed: "seed",
    branchFingerprint: "branch",
    hardMaximumAge: 100,
    nextMilestoneAgeInMonths: boundary
  });
  assert.equal(advance.targetAgeInMonths, 371);
  assert.ok(advance.reasonCodes.includes("timeline-boundary"));
});

test("commitment timeline is clamped at its own due and max boundaries", () => {
  const progression = createCommitmentProgression(360);
  const snapshot = historyWithProgression(progression, "dating", 361)[0].worldStateSnapshot;
  const beforeDueBoundary = earliestRelationshipCheckpointTimelineBoundary(snapshot, 361);
  assert.equal(beforeDueBoundary, 383);
  const beforeDueAdvance = calculateTimelineAdvance({
    currentAgeInMonths: 361,
    temporalProfile: { lifeIntensity: "stable", durationMonths: [36, 60], requiresFollowUp: false },
    simulationSeed: "commitment-before-due",
    branchFingerprint: "branch",
    hardMaximumAge: 100,
    nextMilestoneAgeInMonths: beforeDueBoundary
  });
  assert.equal(beforeDueAdvance.targetAgeInMonths, 383);

  const beforeMaxBoundary = earliestRelationshipCheckpointTimelineBoundary(snapshot, 407);
  assert.equal(beforeMaxBoundary, 408);
  const beforeMaxAdvance = calculateTimelineAdvance({
    currentAgeInMonths: 407,
    temporalProfile: { lifeIntensity: "stable", durationMonths: [24, 60], requiresFollowUp: false },
    simulationSeed: "commitment-before-max",
    branchFingerprint: "branch",
    hardMaximumAge: 100,
    nextMilestoneAgeInMonths: beforeMaxBoundary
  });
  assert.equal(beforeMaxAdvance.targetAgeInMonths, progression.maxAtAgeInMonths);
});

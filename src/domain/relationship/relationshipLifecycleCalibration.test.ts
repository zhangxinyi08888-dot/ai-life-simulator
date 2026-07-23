import assert from "node:assert/strict";
import test from "node:test";
import type { RelationshipProgressionState, WorldStateSnapshot } from "../../types";
import { CAREER_LINE_MIX_POLICY } from "../../config/lineMixPolicy";
import { stableRandom } from "../../utils/stableRandom";
import { calculateTimelineAdvance } from "../../utils/timelineAdvance";
import {
  advanceExplorationProgression,
  createCommitmentProgression,
  createExplorationProgression,
  deriveRelationshipCheckpointStatus,
  earliestRelationshipCheckpointTimelineBoundary
} from "./relationshipLifecycle";

function snapshotFor(progression: RelationshipProgressionState, stage: "exploring" | "dating"): WorldStateSnapshot {
  return {
    people: [{
      id: "person",
      identityKey: { namespace: "accepted_character", key: "candidate" },
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
}

function scheduleCheckpoint(
  seed: string,
  progression: RelationshipProgressionState,
  stage: "exploring" | "dating"
): number {
  let currentAgeInMonths = progression.startedAtAgeInMonths;
  for (let nodeIndex = 0; nodeIndex < 8; nodeIndex += 1) {
    const status = deriveRelationshipCheckpointStatus(progression, currentAgeInMonths);
    if (status === "due" || status === "overdue") return currentAgeInMonths + 1;
    if (status === "eligible") {
      const ordinaryRomanceShare = CAREER_LINE_MIX_POLICY.crossLineShare
        * (CAREER_LINE_MIX_POLICY.crossLineWeights.romance || 0);
      const selectedNaturally = stableRandom({
        namespace: "relationship-calibration-natural-selection",
        seed,
        nodeIndex,
        currentAgeInMonths
      }) < ordinaryRomanceShare;
      if (selectedNaturally) return currentAgeInMonths + 1;
    }
    const snapshot = snapshotFor(progression, stage);
    const boundary = earliestRelationshipCheckpointTimelineBoundary(snapshot, currentAgeInMonths);
    const advance = calculateTimelineAdvance({
      currentAgeInMonths,
      temporalProfile: { lifeIntensity: "normal", durationMonths: [12, 36], requiresFollowUp: false },
      simulationSeed: seed,
      branchFingerprint: `${stage}:${nodeIndex}`,
      hardMaximumAge: 100,
      nextMilestoneAgeInMonths: boundary
    });
    currentAgeInMonths = advance.targetAgeInMonths;
  }
  throw new Error(`checkpoint did not schedule for seed ${seed}`);
}

function percentile(values: number[], quantile: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * quantile))];
}

test("1000 stable seeds bound first exploration and commitment reviews", () => {
  const firstReviewWaits: number[] = [];
  const commitmentReviewWaits: number[] = [];
  for (let index = 0; index < 1000; index += 1) {
    const exploration = createExplorationProgression(360);
    const commitment = createCommitmentProgression(360);
    firstReviewWaits.push(scheduleCheckpoint(`exploration-${index}`, exploration, "exploring") - 360);
    commitmentReviewWaits.push(scheduleCheckpoint(`commitment-${index}`, commitment, "dating") - 360);
  }
  assert.ok(percentile(firstReviewWaits, 0.5) <= 13);
  assert.ok(percentile(firstReviewWaits, 0.9) <= 13);
  assert.ok(Math.max(...firstReviewWaits) <= 18);
  assert.ok(percentile(commitmentReviewWaits, 0.5) >= 18);
  assert.ok(percentile(commitmentReviewWaits, 0.5) <= 36);
  assert.ok(percentile(commitmentReviewWaits, 0.9) <= 48);
  assert.ok(Math.max(...commitmentReviewWaits) <= 48);
});

test("50 deterministic development routes cannot retain exploring beyond 36 months", () => {
  const totalExplorationMonths: number[] = [];
  for (let index = 0; index < 50; index += 1) {
    const startedAt = 264 + (index % 29) * 12;
    let progression = createExplorationProgression(startedAt);
    const firstReviewAt = scheduleCheckpoint(`route-${index}-first`, progression, "exploring");
    progression = advanceExplorationProgression(progression, firstReviewAt);
    const secondReviewAt = scheduleCheckpoint(`route-${index}-second`, progression, "exploring");
    progression = advanceExplorationProgression(progression, secondReviewAt);
    const resolutionAt = scheduleCheckpoint(`route-${index}-resolution`, progression, "exploring");
    totalExplorationMonths.push(resolutionAt - startedAt);
  }
  assert.equal(totalExplorationMonths.length, 50);
  assert.ok(percentile(totalExplorationMonths, 0.9) <= 36);
  assert.ok(Math.max(...totalExplorationMonths) <= 36);
});

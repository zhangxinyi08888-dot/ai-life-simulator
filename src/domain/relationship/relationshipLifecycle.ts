import type {
  HistoryItem,
  RelationshipCheckpointStatus,
  RelationshipProgressionState,
  RelationshipState,
  WorldStateSnapshot
} from "../../types";

export const ROMANCE_EXPLORATION_POLICY = {
  id: "romance_exploration_v1",
  firstReview: {
    eligibleAfterMonths: 3,
    dueAfterMonths: 12,
    maxAfterMonths: 18
  },
  slowReview: {
    eligibleAfterMonths: 6,
    dueAfterMonths: 12,
    maxAfterMonths: 18
  },
  maximumReviewCount: 2,
  maximumTotalExplorationMonths: 36
} as const;

export const ROMANCE_COMMITMENT_POLICY = {
  id: "romance_commitment_v1",
  eligibleAfterMonths: 12,
  dueAfterMonths: 24,
  maxAfterMonths: 48,
  maximumDelayCount: 1,
  maximumTotalMonths: 60
} as const;

export function deriveRelationshipCheckpointStatus(
  progression: RelationshipProgressionState,
  currentAgeInMonths: number
): RelationshipCheckpointStatus {
  if (progression.lifecycleStatus === "resolved") return "resolved";
  if (currentAgeInMonths > progression.maxAtAgeInMonths) return "overdue";
  if (currentAgeInMonths >= progression.dueAtAgeInMonths) return "due";
  if (currentAgeInMonths >= progression.eligibleAtAgeInMonths) return "eligible";
  return "waiting";
}

export function createExplorationProgression(
  startedAtAgeInMonths: number,
  options: { startTimeEstimated?: boolean; migrationCreated?: boolean } = {}
): RelationshipProgressionState {
  return {
    policyId: ROMANCE_EXPLORATION_POLICY.id,
    checkpointKind: "exploration_review",
    startedAtAgeInMonths,
    eligibleAtAgeInMonths: startedAtAgeInMonths + ROMANCE_EXPLORATION_POLICY.firstReview.eligibleAfterMonths,
    dueAtAgeInMonths: startedAtAgeInMonths + ROMANCE_EXPLORATION_POLICY.firstReview.dueAfterMonths,
    maxAtAgeInMonths: startedAtAgeInMonths + ROMANCE_EXPLORATION_POLICY.firstReview.maxAfterMonths,
    reviewCount: 0,
    lifecycleStatus: "active",
    ...options
  };
}

export function advanceExplorationProgression(
  current: RelationshipProgressionState,
  effectiveAtAgeInMonths: number
): RelationshipProgressionState {
  const reviewCount = current.reviewCount + 1;
  const totalMaximum = current.startedAtAgeInMonths + ROMANCE_EXPLORATION_POLICY.maximumTotalExplorationMonths;
  const mustResolve = reviewCount >= ROMANCE_EXPLORATION_POLICY.maximumReviewCount;
  return {
    ...current,
    policyId: ROMANCE_EXPLORATION_POLICY.id,
    checkpointKind: "exploration_review",
    eligibleAtAgeInMonths: mustResolve
      ? effectiveAtAgeInMonths
      : effectiveAtAgeInMonths + ROMANCE_EXPLORATION_POLICY.slowReview.eligibleAfterMonths,
    dueAtAgeInMonths: mustResolve
      ? effectiveAtAgeInMonths
      : Math.min(effectiveAtAgeInMonths + ROMANCE_EXPLORATION_POLICY.slowReview.dueAfterMonths, totalMaximum),
    maxAtAgeInMonths: mustResolve
      ? Math.min(effectiveAtAgeInMonths, totalMaximum)
      : Math.min(effectiveAtAgeInMonths + ROMANCE_EXPLORATION_POLICY.slowReview.maxAfterMonths, totalMaximum),
    reviewCount,
    lastReviewAtAgeInMonths: effectiveAtAgeInMonths,
    lifecycleStatus: "active"
  };
}

export function createCommitmentProgression(
  startedAtAgeInMonths: number,
  options: {
    startTimeEstimated?: boolean;
    migrationCreated?: boolean;
    migrationAgeInMonths?: number;
  } = {}
): RelationshipProgressionState {
  const estimatedMigrationAge = options.startTimeEstimated ? options.migrationAgeInMonths : undefined;
  return {
    policyId: ROMANCE_COMMITMENT_POLICY.id,
    checkpointKind: "commitment_review",
    startedAtAgeInMonths,
    eligibleAtAgeInMonths: estimatedMigrationAge !== undefined
      ? estimatedMigrationAge + 6
      : startedAtAgeInMonths + ROMANCE_COMMITMENT_POLICY.eligibleAfterMonths,
    dueAtAgeInMonths: estimatedMigrationAge !== undefined
      ? estimatedMigrationAge + 12
      : startedAtAgeInMonths + ROMANCE_COMMITMENT_POLICY.dueAfterMonths,
    maxAtAgeInMonths: estimatedMigrationAge !== undefined
      ? estimatedMigrationAge + ROMANCE_COMMITMENT_POLICY.maxAfterMonths
      : startedAtAgeInMonths + ROMANCE_COMMITMENT_POLICY.maxAfterMonths,
    reviewCount: 0,
    lifecycleStatus: "active",
    startTimeEstimated: options.startTimeEstimated,
    migrationCreated: options.migrationCreated,
    delayCount: 0
  };
}

export function delayCommitmentProgression(
  current: RelationshipProgressionState,
  effectiveAtAgeInMonths: number
): RelationshipProgressionState {
  const delayCount = (current.delayCount || 0) + 1;
  const totalMaximum = current.startedAtAgeInMonths + ROMANCE_COMMITMENT_POLICY.maximumTotalMonths;
  return {
    ...current,
    eligibleAtAgeInMonths: effectiveAtAgeInMonths,
    dueAtAgeInMonths: Math.min(effectiveAtAgeInMonths + 12, totalMaximum),
    maxAtAgeInMonths: Math.min(effectiveAtAgeInMonths + 24, totalMaximum),
    reviewCount: current.reviewCount + 1,
    lastReviewAtAgeInMonths: effectiveAtAgeInMonths,
    delayCount
  };
}

export function explorationNeedsResolution(
  progression: RelationshipProgressionState,
  currentAgeInMonths: number
): boolean {
  return progression.checkpointKind === "exploration_review"
    && (
      progression.reviewCount >= ROMANCE_EXPLORATION_POLICY.maximumReviewCount
      || currentAgeInMonths >= progression.startedAtAgeInMonths + ROMANCE_EXPLORATION_POLICY.maximumTotalExplorationMonths
    );
}

export function relationshipProgressionWeightMultiplier(
  progression: RelationshipProgressionState,
  currentAgeInMonths: number
): number {
  const status = deriveRelationshipCheckpointStatus(progression, currentAgeInMonths);
  if (status === "waiting" || status === "resolved") return 0;
  if (status === "due") return 8;
  if (status === "overdue") return 12;
  const elapsedSinceEligible = currentAgeInMonths - progression.eligibleAtAgeInMonths;
  if (elapsedSinceEligible < 3) return 1.5;
  if (elapsedSinceEligible < 6) return 3;
  return 6;
}

export interface ActiveRelationshipCheckpoint {
  relationship: RelationshipState;
  progression: RelationshipProgressionState;
  status: RelationshipCheckpointStatus;
}

export interface RelationshipDeferralState {
  checkpointKey: string;
  consecutiveDeferredNodes: number;
  mustRestore: boolean;
}

export function relationshipCheckpointKey(
  checkpoint: Pick<ActiveRelationshipCheckpoint, "relationship" | "progression">
): string {
  const { relationship, progression } = checkpoint;
  return [
    relationship.id,
    progression.checkpointKind,
    progression.startedAtAgeInMonths,
    progression.dueAtAgeInMonths,
    progression.maxAtAgeInMonths
  ].join(":");
}

function relationshipCheckpointKeyFromHistoryItem(item: HistoryItem): string | undefined {
  if (item.eventMeta?.relationshipCheckpointKey) {
    return item.eventMeta.relationshipCheckpointKey;
  }
  const checkpointKind = item.eventMeta?.relationshipCheckpointKind;
  const dueAtAgeInMonths = item.eventMeta?.relationshipCheckpointDueAtAgeInMonths;
  const maxAtAgeInMonths = item.eventMeta?.relationshipCheckpointMaxAtAgeInMonths;
  const relationship = item.worldStateSnapshot?.relationships?.find((candidate) => (
    candidate.type === "romantic"
    && candidate.progression?.checkpointKind === checkpointKind
    && (
      dueAtAgeInMonths === undefined
      || candidate.progression.dueAtAgeInMonths === dueAtAgeInMonths
    )
    && (
      maxAtAgeInMonths === undefined
      || candidate.progression.maxAtAgeInMonths === maxAtAgeInMonths
    )
  ));
  return relationship?.progression
    ? relationshipCheckpointKey({
        relationship,
        progression: relationship.progression
      })
    : undefined;
}

export function deriveRelationshipDeferralState(
  history: HistoryItem[],
  checkpoint: ActiveRelationshipCheckpoint
): RelationshipDeferralState {
  const checkpointKey = relationshipCheckpointKey(checkpoint);
  let consecutiveDeferredNodes = 0;
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const item = history[index];
    if (!item.eventMeta?.relationshipCheckpointDeferred) break;
    if (relationshipCheckpointKeyFromHistoryItem(item) !== checkpointKey) break;
    consecutiveDeferredNodes += 1;
  }
  return {
    checkpointKey,
    consecutiveDeferredNodes,
    mustRestore: checkpoint.status === "overdue" || consecutiveDeferredNodes >= 3
  };
}

export interface RelationshipCheckpointDeferral {
  checkpointKind: RelationshipProgressionState["checkpointKind"];
  status: Extract<RelationshipCheckpointStatus, "due" | "overdue">;
  waitMonths: number;
  dueAtAgeInMonths: number;
  maxAtAgeInMonths: number;
}

export function deriveRelationshipCheckpointDeferral(
  progression: RelationshipProgressionState,
  targetAgeInMonths: number
): RelationshipCheckpointDeferral | undefined {
  const status = deriveRelationshipCheckpointStatus(progression, targetAgeInMonths);
  if (status !== "due" && status !== "overdue") return undefined;
  return {
    checkpointKind: progression.checkpointKind,
    status,
    waitMonths: Math.max(0, targetAgeInMonths - progression.startedAtAgeInMonths),
    dueAtAgeInMonths: progression.dueAtAgeInMonths,
    maxAtAgeInMonths: progression.maxAtAgeInMonths
  };
}

export function activeRelationshipCheckpoint(
  snapshot: WorldStateSnapshot | undefined,
  currentAgeInMonths: number
): ActiveRelationshipCheckpoint | undefined {
  const relationship = snapshot?.relationships?.find((candidate) => (
    candidate.type === "romantic"
    && ["active", "strained"].includes(candidate.status)
    && candidate.progression?.lifecycleStatus === "active"
  ));
  if (!relationship?.progression) return undefined;
  return {
    relationship,
    progression: relationship.progression,
    status: deriveRelationshipCheckpointStatus(relationship.progression, currentAgeInMonths)
  };
}

export function relationshipLifecycleEventId(
  checkpoint: ActiveRelationshipCheckpoint,
  currentAgeInMonths: number
):
  | "romance_connection_clarification"
  | "romance_exploration_resolution"
  | "relationship_material_commitment_test"
  | "relationship_commitment_resolution" {
  if (checkpoint.progression.checkpointKind === "commitment_review") {
    const totalMaximum = checkpoint.progression.startedAtAgeInMonths + ROMANCE_COMMITMENT_POLICY.maximumTotalMonths;
    return (checkpoint.progression.delayCount || 0) >= ROMANCE_COMMITMENT_POLICY.maximumDelayCount
      || currentAgeInMonths >= totalMaximum
      ? "relationship_commitment_resolution"
      : "relationship_material_commitment_test";
  }
  return explorationNeedsResolution(
    checkpoint.progression,
    currentAgeInMonths
  )
    ? "romance_exploration_resolution"
    : "romance_connection_clarification";
}

export function earliestRelationshipCheckpointTimelineBoundary(
  snapshot: WorldStateSnapshot | undefined,
  currentAgeInMonths: number
): number | undefined {
  const boundaries = (snapshot?.relationships || [])
    .filter((relationship) => (
      relationship.type === "romantic"
      && ["active", "strained"].includes(relationship.status)
      && relationship.progression?.lifecycleStatus === "active"
    ))
    .map((relationship) => {
      const progression = relationship.progression!;
      if (currentAgeInMonths < progression.dueAtAgeInMonths - 1) {
        return progression.dueAtAgeInMonths - 1;
      }
      if (currentAgeInMonths < progression.dueAtAgeInMonths) {
        return progression.dueAtAgeInMonths;
      }
      if (currentAgeInMonths >= progression.maxAtAgeInMonths) {
        return currentAgeInMonths + 1;
      }
      return Math.max(currentAgeInMonths + 1, progression.maxAtAgeInMonths - 1);
    });
  return boundaries.length > 0 ? Math.min(...boundaries) : undefined;
}

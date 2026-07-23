import assert from "node:assert/strict";
import test from "node:test";
import type { RelationshipState, WorldStateSnapshot } from "../../types";
import {
  advanceExplorationProgression,
  createCommitmentProgression,
  createExplorationProgression,
  deriveRelationshipCheckpointStatus,
  deriveRelationshipCheckpointDeferral,
  explorationNeedsResolution,
  relationshipProgressionWeightMultiplier
} from "./relationshipLifecycle";
import { ensureRelationshipWorldState, reduceRelationshipState } from "./relationshipState";

test("checkpoint status is derived from authoritative time and is never stored", () => {
  const progression = createExplorationProgression(360);
  assert.equal(deriveRelationshipCheckpointStatus(progression, 362), "waiting");
  assert.equal(deriveRelationshipCheckpointStatus(progression, 363), "eligible");
  assert.equal(deriveRelationshipCheckpointStatus(progression, 372), "due");
  assert.equal(deriveRelationshipCheckpointStatus(progression, 379), "overdue");

  assert.deepEqual(deriveRelationshipCheckpointDeferral(progression, 379), {
    checkpointKind: "exploration_review",
    status: "overdue",
    waitMonths: 19,
    dueAtAgeInMonths: 372,
    maxAtAgeInMonths: 378
  });
  assert.equal(deriveRelationshipCheckpointDeferral(progression, 368), undefined);
  assert.equal("status" in progression, false);
});

test("exploration review advances deterministically and reaches a selectable resolution", () => {
  const first = createExplorationProgression(360);
  const second = advanceExplorationProgression(first, 369);
  assert.equal(second.reviewCount, 1);
  assert.equal(second.eligibleAtAgeInMonths, 375);
  assert.equal(second.dueAtAgeInMonths, 381);
  assert.equal(second.maxAtAgeInMonths, 387);
  const terminal = advanceExplorationProgression(second, 381);
  assert.equal(terminal.reviewCount, 2);
  assert.equal(explorationNeedsResolution(terminal, 381), true);
  assert.equal(terminal.maxAtAgeInMonths <= 396, true);
});

test("eligible exploration weight grows without changing due and max timestamps", () => {
  const progression = createExplorationProgression(360);
  assert.equal(relationshipProgressionWeightMultiplier(progression, 362), 0);
  assert.equal(relationshipProgressionWeightMultiplier(progression, 363), 1.5);
  assert.equal(relationshipProgressionWeightMultiplier(progression, 366), 3);
  assert.equal(relationshipProgressionWeightMultiplier(progression, 369), 6);
  assert.equal(relationshipProgressionWeightMultiplier(progression, 372), 1);
});

test("legacy exploring and dating relationships receive one-time progression migration", () => {
  const people = [
    {
      id: "person_a",
      identityKey: { namespace: "accepted_character" as const, key: "a" },
      relation: "partner" as const,
      lifeStatus: "active" as const,
      source: "accepted_history" as const,
      confidence: 0.9
    },
    {
      id: "person_b",
      identityKey: { namespace: "accepted_character" as const, key: "b" },
      relation: "partner" as const,
      lifeStatus: "active" as const,
      source: "accepted_history" as const,
      confidence: 0.9
    }
  ];
  const relationships: RelationshipState[] = [
    {
      id: "exploring",
      participantPersonIds: ["person_a"],
      type: "romantic",
      stage: "exploring",
      status: "active",
      effectiveFromAgeInMonths: 300,
      source: "accepted_history",
      confidence: 0.9
    },
    {
      id: "dating",
      participantPersonIds: ["person_b"],
      type: "romantic",
      stage: "dating",
      status: "ended",
      effectiveFromAgeInMonths: 330,
      source: "accepted_history",
      confidence: 0.9
    }
  ];
  const snapshot: WorldStateSnapshot = {
    people,
    directionArcs: [],
    pressureArcs: [],
    relationships,
    relationshipRevision: 0,
    version: 2
  };
  const migrated = ensureRelationshipWorldState(snapshot, 360);
  assert.equal(migrated.relationshipProgressionVersion, 1);
  assert.equal(migrated.relationships?.[0].progression?.checkpointKind, "exploration_review");
  assert.equal(migrated.relationships?.[1].progression, undefined);
  const repeated = ensureRelationshipWorldState(migrated, 480);
  assert.deepEqual(repeated.relationships, migrated.relationships);
  assert.equal(repeated.relationshipRevision, migrated.relationshipRevision);
});

test("relationship reducer rejects progression whose time window is unordered", () => {
  const person = {
    id: "person",
    identityKey: { namespace: "accepted_character" as const, key: "person" },
    relation: "partner" as const,
    lifeStatus: "active" as const,
    source: "accepted_history" as const,
    confidence: 0.9
  };
  const current: WorldStateSnapshot = {
    people: [person],
    directionArcs: [],
    pressureArcs: [],
    relationships: [],
    relationshipRevision: 0,
    version: 2
  };
  assert.throws(() => reduceRelationshipState({
    current,
    expectedRevision: 0,
    nextState: {
      id: "relationship",
      participantPersonIds: [person.id],
      type: "romantic",
      stage: "dating",
      status: "active",
      effectiveFromAgeInMonths: 360,
      progression: {
        ...createCommitmentProgression(360),
        dueAtAgeInMonths: 350
      },
      source: "accepted_history",
      confidence: 0.9
    }
  }));
});

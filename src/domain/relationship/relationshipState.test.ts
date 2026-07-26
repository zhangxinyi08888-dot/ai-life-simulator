import assert from "node:assert/strict";
import test from "node:test";
import type { PersonState, WorldStateSnapshot } from "../../types";
import {
  ensureRelationshipWorldState,
  RelationshipStateError,
  mergeAcceptedPeople,
  reduceRelationshipState
} from "./relationshipState";

const father: PersonState = {
  id: "person_parent_father",
  identityKey: { namespace: "user_role", key: "parent:father" },
  displayName: "父亲",
  relation: "parent",
  lifeStatus: "active",
  source: "user_fact",
  confidence: 1
};

function world(): WorldStateSnapshot {
  return { people: [father], directionArcs: [], pressureArcs: [], version: 1 };
}

test("relationship initialization is independent from protagonist profile state", () => {
  const next = ensureRelationshipWorldState(world(), 360);
  assert.equal(next.familyRelationships?.[0].role, "father");
  assert.equal(next.familyRelationships?.[0].emotionalSupport, "unknown");
  assert.equal(next.familyRelationshipRevision, 1);
  assert.equal("protagonistProfile" in next, false);
});

test("accepted initial parent facts preserve an unspecified parent and topic stance", () => {
  const unspecifiedParent: PersonState = {
    id: "person_parent_unspecified",
    identityKey: { namespace: "user_role", key: "parent:unspecified" },
    displayName: "父母",
    relation: "parent",
    lifeStatus: "active",
    relationshipSummary: "父母明确支持我自己决定是否换工作，不要求我求稳，搬家时也愿意提供帮助。",
    source: "user_fact",
    confidence: 0.9
  };
  const next = ensureRelationshipWorldState({
    people: [unspecifiedParent], directionArcs: [], pressureArcs: [], version: 2
  }, 360);
  const relationship = next.familyRelationships?.[0];
  assert.equal(relationship?.role, "parent_unspecified");
  assert.equal(relationship?.practicalSupport, "available");
  assert.equal(relationship?.autonomyRespect, "high");
  assert.equal(relationship?.topicStances[0]?.topic, "career_change");
  assert.equal(relationship?.topicStances[0]?.stance, "supportive");
  assert.equal(relationship?.topicStances[0]?.source, "user_fact");
});

test("accepted initial opposition is scoped to the stated topic", () => {
  const unspecifiedParent: PersonState = {
    id: "person_parent_unspecified",
    identityKey: { namespace: "user_role", key: "parent:unspecified" },
    displayName: "父母",
    relation: "parent",
    lifeStatus: "active",
    relationshipSummary: "父母明确反对我换工作，要求我求稳，否则不愿意在搬家时提供帮助。",
    source: "user_fact",
    confidence: 0.9
  };
  const next = ensureRelationshipWorldState({
    people: [unspecifiedParent], directionArcs: [], pressureArcs: [], version: 2
  }, 360);
  const relationship = next.familyRelationships?.[0];
  assert.equal(relationship?.role, "parent_unspecified");
  assert.equal(relationship?.practicalSupport, "unavailable");
  assert.equal(relationship?.autonomyRespect, "mixed");
  assert.equal(relationship?.topicStances[0]?.topic, "career_change");
  assert.equal(relationship?.topicStances[0]?.stance, "opposed");
  assert.equal(relationship?.emotionalSupport, "unknown");
});

test("relationship reducer rejects dangling people and duplicate exploration", () => {
  assert.throws(() => reduceRelationshipState({
    current: world(), expectedRevision: 0,
    nextState: { id: "missing", participantPersonIds: ["missing"], type: "romantic", stage: "exploring", status: "active", effectiveFromAgeInMonths: 360, source: "accepted_history", confidence: 0.9 }
  }), RelationshipStateError);

  const firstPerson = { ...father, id: "person_first", identityKey: { namespace: "accepted_character" as const, key: "first" }, relation: "partner" as const };
  const secondPerson = { ...father, id: "person_second", identityKey: { namespace: "accepted_character" as const, key: "second" }, relation: "partner" as const };
  const current = { ...world(), people: [firstPerson, secondPerson], relationships: [], relationshipRevision: 0 };
  const first = reduceRelationshipState({
    current, expectedRevision: 0,
    nextState: { id: "first", participantPersonIds: [firstPerson.id], type: "romantic", stage: "exploring", status: "active", effectiveFromAgeInMonths: 360, source: "accepted_history", confidence: 0.9 }
  });
  assert.throws(() => reduceRelationshipState({
    current: first, expectedRevision: 1,
    nextState: { id: "second", participantPersonIds: [secondPerson.id], type: "romantic", stage: "exploring", status: "active", effectiveFromAgeInMonths: 361, source: "accepted_history", confidence: 0.9 }
  }), RelationshipStateError);
});

test("accepted people retain stable identity ids", () => {
  const updated = mergeAcceptedPeople({
    currentPeople: [father],
    acceptedPeople: [{ ...father, id: "replacement", healthStatus: "fragile" }]
  });
  assert.equal(updated[0].id, father.id);
  assert.equal(updated[0].healthStatus, "fragile");
});

test("legacy romantic stages migrate once without losing relationship meaning", () => {
  const romanticPerson = {
    ...father,
    id: "person_partner",
    identityKey: { namespace: "accepted_character" as const, key: "partner" },
    relation: "partner" as const
  };
  const legacy: WorldStateSnapshot = {
    ...world(),
    people: [romanticPerson],
    relationships: [
      {
        id: "active_legacy", participantPersonIds: [romanticPerson.id], type: "romantic", stage: "active",
        status: "strained", effectiveFromAgeInMonths: 300, source: "accepted_history", confidence: 0.9
      },
      {
        id: "ended_legacy", participantPersonIds: [romanticPerson.id], type: "romantic", stage: "ended",
        status: "ended", effectiveFromAgeInMonths: 240, source: "accepted_history", confidence: 0.9
      }
    ],
    relationshipRevision: 2
  };
  const migrated = ensureRelationshipWorldState(legacy, 360);
  assert.equal(migrated.relationships?.[0].stage, "dating");
  assert.equal(migrated.relationships?.[0].status, "strained");
  assert.equal(migrated.relationships?.[1].stage, "separated");
  assert.equal(migrated.relationships?.[1].status, "ended");
  assert.equal(migrated.relationshipRevision, 4);
  assert.equal(migrated.relationships?.[0].progression?.checkpointKind, "commitment_review");
  assert.equal(ensureRelationshipWorldState(migrated, 360).relationshipRevision, 4);
});

test("relationship migration does not resurrect an ended user-fact partner", () => {
  const romanticPerson = {
    ...father,
    id: "person_former_partner",
    identityKey: { namespace: "user_role" as const, key: "partner:current" },
    relation: "partner" as const,
    source: "user_fact" as const
  };
  const ended: WorldStateSnapshot = {
    ...world(),
    people: [romanticPerson],
    relationships: [{
      id: "relationship_former_partner",
      participantPersonIds: [romanticPerson.id],
      type: "romantic",
      stage: "separated",
      status: "ended",
      effectiveFromAgeInMonths: 312,
      source: "accepted_history",
      confidence: 0.95
    }],
    relationshipRevision: 1
  };
  const migrated = ensureRelationshipWorldState(ended, 324);
  assert.equal(migrated.relationships.length, 1);
  assert.equal(migrated.relationships[0].status, "ended");
});

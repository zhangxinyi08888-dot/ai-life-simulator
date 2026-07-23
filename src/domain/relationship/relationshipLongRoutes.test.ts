import assert from "node:assert/strict";
import test from "node:test";
import { LIFE_EVENTS_DATABASE, isLifeEventCandidateEligible } from "../../data/lifeEvents";
import type { HistoryItem, WorldStateSnapshot } from "../../types";
import { hasConfirmedPartner, hasConfirmedRomanticConnection, matchesRequiredContext } from "../../utils/eventEligibility";
import { applySelectedRelationshipOutcome } from "./relationshipOutcome";
import { ensureRelationshipWorldState } from "./relationshipState";

const attributes = { happiness: 60, intelligence: 70, wealth: 55, relation: 60, health: 65 };
const romanceFormation = LIFE_EVENTS_DATABASE.find((event) => event.id === "romance_new_connection")!;
const romanceClarification = LIFE_EVENTS_DATABASE.find((event) => event.id === "romance_connection_clarification")!;
const familyOrdinary = LIFE_EVENTS_DATABASE.find((event) => event.id === "family_value_difference_conversation")!;
const familyPressure = LIFE_EVENTS_DATABASE.find((event) => event.id === "relationship_family_obligation_pull")!;

function emptyWorld(): WorldStateSnapshot {
  return {
    people: [], directionArcs: [], pressureArcs: [], relationships: [], familyRelationships: [],
    routePreferences: [], relationshipRevision: 0, familyRelationshipRevision: 0, version: 2
  };
}

function node(ageInMonths: number, worldStateSnapshot: WorldStateSnapshot, index: number): HistoryItem {
  return {
    age: ageInMonths / 12,
    ageInMonths,
    stage: "事业发展",
    title: `事业节点 ${index}`,
    description: "你继续推进当前工作，并完成了一个阶段目标。",
    selectedChoice: "继续推进事业",
    selectedDecisionIntent: "career:continue:project",
    attributes,
    choices: [{ id: "A", text: "继续推进事业", impactSummary: "保持方向" }],
    isEndingNode: false,
    eventMeta: { eventId: `career_${index}`, eventCategory: "career", routeLine: "career", eventTags: ["career"] },
    worldStateSnapshot
  };
}

function formationChoice(outcomeId: string): HistoryItem {
  const evidence = "你们在活动结束后交换了联系方式。";
  return {
    ...node(360, emptyWorld(), 0),
    title: "新的联系",
    description: evidence,
    selectedChoice: outcomeId === "continue_getting_to_know" ? "继续了解" : "不发展浪漫方向",
    selectedChoiceId: "A",
    selectedEventOutcomeId: outcomeId,
    choices: [{ id: "A", text: "继续了解", impactSummary: "保留空间", eventOutcomeId: outcomeId }],
    eventMeta: { eventId: "romance_new_connection", eventCategory: "relationship", routeLine: "romance", eventTags: ["romance"] },
    narrativeMeta: {
      elapsedMonths: 1,
      elapsedYears: 1 / 12,
      lifeIntensity: "normal",
      nodeMateriality: "decision_checkpoint",
      storyEpisode: { id: "formation", startAgeInMonths: 359, endAgeInMonths: 360, internalTransitions: [], decisionCheckpointId: "choice", summary: evidence },
      recoveryState: "neutral",
      recoveryEvidence: [],
      arcSignals: [],
      activeCharacters: [],
      worldDeltas: [],
      relationshipProposals: outcomeId === "continue_getting_to_know" ? [
        { id: "person", type: "person_introduction", sourceOutcomeId: outcomeId, evidence, displayName: "林遥", candidateOrdinal: 0 },
        { id: "relationship", type: "romantic_transition", sourceOutcomeId: outcomeId, evidence, toStage: "exploring" }
      ] : []
    }
  };
}

function clarificationChoice(outcomeId: "begin_mutual_dating" | "continue_slow_exploration" | "end_romantic_exploration"): HistoryItem {
  const evidence = "持续相处后，你们认真谈起了这段关系的方向。";
  return {
    ...formationChoice(outcomeId),
    age: 32,
    ageInMonths: 384,
    description: evidence,
    selectedChoice: "确认关系方向",
    eventMeta: { eventId: "romance_connection_clarification", eventCategory: "relationship", routeLine: "romance", eventTags: ["romance"] },
    narrativeMeta: {
      ...formationChoice(outcomeId).narrativeMeta!,
      relationshipProposals: [{
        id: "transition", type: "romantic_transition", sourceOutcomeId: outcomeId, evidence,
        ...(outcomeId === "end_romantic_exploration" ? { toStatus: "ended" as const } : { toStage: outcomeId === "begin_mutual_dating" ? "dating" as const : "exploring" as const })
      }]
    }
  };
}

test("an exploring relationship survives fifteen career nodes and clarifies without identity drift", () => {
  const formed = applySelectedRelationshipOutcome({
    current: emptyWorld(),
    selectedHistoryItem: formationChoice("continue_getting_to_know"),
    simulationSeed: "long-route",
    branchFingerprint: "career",
    nodeIndex: 1,
    effectiveAtAgeInMonths: 360
  }).worldStateSnapshot;
  const personId = formed.people[0].id;
  const relationshipId = formed.relationships?.[0].id;
  const history = Array.from({ length: 15 }, (_, index) => node(361 + index, formed, index + 1));

  assert.equal(hasConfirmedRomanticConnection(history.at(-1)?.worldStateSnapshot), true);
  assert.equal(hasConfirmedPartner(history.at(-1)?.worldStateSnapshot), false);
  assert.equal(isLifeEventCandidateEligible(romanceFormation, attributes, {}, 31.25, history), false);
  assert.equal(isLifeEventCandidateEligible(romanceClarification, attributes, {}, 31.25, history), true);

  const dating = applySelectedRelationshipOutcome({
    current: formed,
    selectedHistoryItem: clarificationChoice("begin_mutual_dating"),
    simulationSeed: "long-route",
    branchFingerprint: "career",
    nodeIndex: 17,
    effectiveAtAgeInMonths: 376
  }).worldStateSnapshot;
  assert.equal(dating.people[0].id, personId);
  assert.equal(dating.relationships?.[0].id, relationshipId);
  assert.equal(dating.relationships?.[0].stage, "dating");
  assert.equal(hasConfirmedPartner(dating), true);
});

test("ending exploration after a long route preserves the person and closes both romance gates", () => {
  const formed = applySelectedRelationshipOutcome({
    current: emptyWorld(), selectedHistoryItem: formationChoice("continue_getting_to_know"),
    simulationSeed: "end-route", branchFingerprint: "career", nodeIndex: 1, effectiveAtAgeInMonths: 360
  }).worldStateSnapshot;
  const ended = applySelectedRelationshipOutcome({
    current: formed, selectedHistoryItem: clarificationChoice("end_romantic_exploration"),
    simulationSeed: "end-route", branchFingerprint: "career", nodeIndex: 18, effectiveAtAgeInMonths: 384
  }).worldStateSnapshot;
  assert.equal(ended.people.length, 1);
  assert.equal(ended.relationships?.[0].status, "ended");
  assert.equal(hasConfirmedRomanticConnection(ended), false);
  assert.equal(hasConfirmedPartner(ended), false);
});

test("two explicit refusals close romance temporarily without creating people or relationships", () => {
  const first = applySelectedRelationshipOutcome({
    current: emptyWorld(), selectedHistoryItem: formationChoice("decline_romantic_direction"),
    simulationSeed: "refusal-route", branchFingerprint: "career", nodeIndex: 1, effectiveAtAgeInMonths: 360
  }).worldStateSnapshot;
  const second = applySelectedRelationshipOutcome({
    current: first, selectedHistoryItem: formationChoice("decline_romantic_direction"),
    simulationSeed: "refusal-route", branchFingerprint: "career", nodeIndex: 12, effectiveAtAgeInMonths: 480
  }).worldStateSnapshot;
  assert.equal(second.people.length, 0);
  assert.equal(second.relationships?.length, 0);
  assert.equal(second.routePreferences?.[0].openness, "closed");
  const recentHistory = Array.from({ length: 15 }, (_, index) => node(481 + index, second, index));
  assert.equal(isLifeEventCandidateEligible(romanceFormation, attributes, {}, 42, recentHistory), false);
  const reopened = ensureRelationshipWorldState(second, 721);
  const elapsedHistory = Array.from({ length: 21 }, (_, index) => node(721 + index, reopened, index));
  assert.equal(reopened.routePreferences?.[0].openness, "neutral");
  assert.equal(isLifeEventCandidateEligible(romanceFormation, attributes, {}, 62, elapsedHistory), true);
});

test("family pressure remains unreachable without accepted family facts across fifteen career nodes", () => {
  const history = Array.from({ length: 15 }, (_, index) => node(360 + index, emptyWorld(), index));
  const context = { attribs: attributes, userData: {}, age: 31, history, answers: undefined };
  assert.equal(matchesRequiredContext("confirmed_family", context), false);
  assert.equal(isLifeEventCandidateEligible(familyOrdinary, attributes, {}, 31, history), false);
  assert.equal(isLifeEventCandidateEligible(familyPressure, attributes, {}, 31, history), false);
});

test("an explicit initial partner migrates to dating and suppresses new formation", () => {
  const initial: WorldStateSnapshot = {
    ...emptyWorld(),
    people: [{
      id: "person_initial_partner", identityKey: { namespace: "user_role", key: "partner:current" },
      displayName: "现任伴侣", relation: "partner", lifeStatus: "active", source: "user_fact", confidence: 1,
      relationshipSummary: "正在恋爱"
    }]
  };
  const migrated = ensureRelationshipWorldState(initial, 360);
  const history = Array.from({ length: 15 }, (_, index) => node(360 + index, migrated, index));
  assert.equal(migrated.relationships?.[0].stage, "dating");
  assert.equal(hasConfirmedPartner(migrated), true);
  assert.equal(isLifeEventCandidateEligible(romanceFormation, attributes, {}, 31, history), false);
});

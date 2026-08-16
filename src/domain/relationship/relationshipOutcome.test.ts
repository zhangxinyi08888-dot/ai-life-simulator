import assert from "node:assert/strict";
import test from "node:test";
import type { HistoryItem, WorldStateSnapshot } from "../../types";
import {
  applySelectedRelationshipOutcome,
  deriveOpeningRomanticOutcomeId,
  END_EXISTING_ROMANTIC_RELATIONSHIP_OUTCOME
} from "./relationshipOutcome";

const baseWorld = (): WorldStateSnapshot => ({ people: [], directionArcs: [], pressureArcs: [], relationships: [], relationshipRevision: 0, version: 2 });

function formationHistory(outcomeId = "continue_getting_to_know"): HistoryItem {
  const evidence = "你们在活动结束后交换了联系方式。";
  return {
    age: 30, ageInMonths: 360, title: "新的联系", stage: "事业推进", description: evidence,
    selectedChoice: "继续了解", selectedChoiceId: "A", selectedEventOutcomeId: outcomeId,
    attributes: { health: 70, wealth: 60, relation: 50, intelligence: 75, happiness: 65 },
    choices: [{ id: "A", text: "继续了解", impactSummary: "保留空间", eventOutcomeId: outcomeId }],
    isEndingNode: false,
    eventMeta: { eventId: "romance_new_connection", eventTags: [], routeLine: "romance" },
    narrativeMeta: {
      elapsedMonths: 3, elapsedYears: 0.25, lifeIntensity: "normal", nodeMateriality: "decision_checkpoint",
      storyEpisode: { id: "episode", startAgeInMonths: 357, endAgeInMonths: 360, internalTransitions: [], decisionCheckpointId: "choice", summary: evidence },
      recoveryState: "neutral", recoveryEvidence: [], arcSignals: [], activeCharacters: [], worldDeltas: [],
      relationshipProposals: [
        { id: "person", type: "person_introduction", sourceOutcomeId: outcomeId, evidence, displayName: "林遥", candidateOrdinal: 0 },
        { id: "relationship", type: "romantic_transition", sourceOutcomeId: outcomeId, evidence, toStage: "exploring" }
      ]
    }
  };
}

test("formation choice atomically creates one stable person and exploring relationship", () => {
  const first = applySelectedRelationshipOutcome({
    current: baseWorld(), selectedHistoryItem: formationHistory(), simulationSeed: "seed", branchFingerprint: "branch",
    nodeIndex: 4, effectiveAtAgeInMonths: 363
  });
  assert.equal(first.committed, true);
  assert.equal(first.worldStateSnapshot.people.length, 1);
  assert.equal(first.worldStateSnapshot.people[0].identityKey?.namespace, "accepted_character");
  assert.equal(first.worldStateSnapshot.relationships?.[0].stage, "exploring");
  assert.equal(first.worldStateSnapshot.relationships?.[0].effectiveFromAgeInMonths, 363);
  assert.equal(first.worldStateSnapshot.relationships?.[0].statusEffectiveFromAgeInMonths, 363);
  assert.equal(first.worldStateSnapshot.relationships?.[0].progression?.eligibleAtAgeInMonths, 366);
  assert.equal(first.worldStateSnapshot.relationships?.[0].progression?.dueAtAgeInMonths, 375);
  assert.deepEqual(first.worldStateSnapshot.relationships?.[0].participantPersonIds, [first.worldStateSnapshot.people[0].id]);

  const repeated = applySelectedRelationshipOutcome({
    current: first.worldStateSnapshot, selectedHistoryItem: formationHistory(), simulationSeed: "seed", branchFingerprint: "branch",
    nodeIndex: 4, effectiveAtAgeInMonths: 363
  });
  assert.equal(repeated.committed, false);
  assert.equal(repeated.worldStateSnapshot.people.length, 1);
  assert.equal(repeated.worldStateSnapshot.relationships?.length, 1);
});

test("formation is rejected when evidence is not in the event narrative", () => {
  const history = formationHistory();
  history.narrativeMeta!.relationshipProposals![0].evidence = "正文没有这句话";
  const result = applySelectedRelationshipOutcome({
    current: baseWorld(), selectedHistoryItem: history, simulationSeed: "seed", branchFingerprint: "branch",
    nodeIndex: 4, effectiveAtAgeInMonths: 363
  });
  assert.equal(result.committed, false);
  assert.equal(result.worldStateSnapshot.people.length, 0);
  assert.equal(result.worldStateSnapshot.relationships?.length, 0);
});

test("formation is rejected when the proposed display name is a pronoun or generic role", () => {
  const history = formationHistory();
  const proposal = history.narrativeMeta!.relationshipProposals![0];
  if (proposal.type !== "person_introduction") throw new Error("expected person proposal");
  proposal.displayName = "你";
  const result = applySelectedRelationshipOutcome({
    current: baseWorld(), selectedHistoryItem: history, simulationSeed: "seed", branchFingerprint: "branch",
    nodeIndex: 4, effectiveAtAgeInMonths: 363
  });
  assert.equal(result.committed, false);
  assert.equal(result.reason, "invalid_or_missing_proposal");
  assert.equal(result.worldStateSnapshot.people.length, 0);
  assert.equal(result.worldStateSnapshot.relationships?.length, 0);
});

test("clarification advances only begin dating and keeps the same identity", () => {
  const formed = applySelectedRelationshipOutcome({
    current: baseWorld(), selectedHistoryItem: formationHistory(), simulationSeed: "seed", branchFingerprint: "branch",
    nodeIndex: 4, effectiveAtAgeInMonths: 363
  }).worldStateSnapshot;
  const evidence = "几个月相处后，你们认真谈起了彼此的期待。";
  const clarification = formationHistory("begin_mutual_dating");
  clarification.description = evidence;
  clarification.eventMeta!.eventId = "romance_connection_clarification";
  clarification.narrativeMeta!.relationshipProposals = [{
    id: "dating", type: "romantic_transition", sourceOutcomeId: "begin_mutual_dating", evidence, toStage: "dating"
  }];
  const result = applySelectedRelationshipOutcome({
    current: formed, selectedHistoryItem: clarification, simulationSeed: "seed", branchFingerprint: "branch",
    nodeIndex: 8, effectiveAtAgeInMonths: 369
  });
  assert.equal(result.worldStateSnapshot.people[0].id, formed.people[0].id);
  assert.equal(result.worldStateSnapshot.relationships?.[0].stage, "dating");
  assert.equal(result.worldStateSnapshot.relationships?.[0].status, "active");
  assert.equal(result.worldStateSnapshot.relationships?.[0].statusEffectiveFromAgeInMonths, 363);
  assert.equal(result.worldStateSnapshot.relationships?.[0].progression?.checkpointKind, "commitment_review");
  assert.equal(result.worldStateSnapshot.relationships?.[0].progression?.eligibleAtAgeInMonths, 381);
  assert.equal(result.worldStateSnapshot.relationships?.length, 1);
});

test("only a selected family activation proposal creates neutral parent authority", () => {
  const history = formationHistory("ask_parent_for_practical_help");
  history.eventMeta!.eventId = "career_scope_redefinition";
  history.selectedChoice = "和母亲商量一周临时住处";
  history.narrativeMeta!.relationshipProposals = [{
    id: "activate_mother", type: "family_activation", parentRole: "mother",
    sourceOutcomeId: "ask_parent_for_practical_help", evidence: history.selectedChoice
  }];
  const result = applySelectedRelationshipOutcome({
    current: baseWorld(), selectedHistoryItem: history, simulationSeed: "seed", branchFingerprint: "branch",
    nodeIndex: 5, effectiveAtAgeInMonths: 365
  });
  assert.equal(result.committed, true);
  assert.equal(result.worldStateSnapshot.familyRelationships?.[0].activation, "active");
  assert.equal(result.worldStateSnapshot.familyRelationships?.[0].emotionalSupport, "unknown");
  assert.equal(result.worldStateSnapshot.familyRelationships?.[0].autonomyRespect, "unknown");
});

test("declining romance records opt-down without creating a person or relationship", () => {
  const history = formationHistory("decline_romantic_direction");
  const first = applySelectedRelationshipOutcome({
    current: baseWorld(), selectedHistoryItem: history, simulationSeed: "seed", branchFingerprint: "branch",
    nodeIndex: 4, effectiveAtAgeInMonths: 360
  });
  assert.equal(first.worldStateSnapshot.people.length, 0);
  assert.equal(first.worldStateSnapshot.relationships?.length, 0);
  assert.equal(first.worldStateSnapshot.routePreferences?.[0].openness, "neutral");
  assert.equal(first.worldStateSnapshot.routePreferences?.[0].refusalCount, 1);
  assert.equal(first.worldStateSnapshot.routePreferences?.[0].cooldownUntilAgeInMonths, 480);
  const second = applySelectedRelationshipOutcome({
    current: first.worldStateSnapshot, selectedHistoryItem: history, simulationSeed: "seed", branchFingerprint: "branch",
    nodeIndex: 15, effectiveAtAgeInMonths: 480
  });
  assert.equal(second.worldStateSnapshot.routePreferences?.[0].openness, "closed");
  assert.equal(second.worldStateSnapshot.routePreferences?.[0].refusalCount, 2);
  assert.equal(second.worldStateSnapshot.routePreferences?.[0].cooldownUntilAgeInMonths, 720);
});

test("keeping a new contact as an acquaintance does not create a romantic relationship", () => {
  const result = applySelectedRelationshipOutcome({
    current: baseWorld(), selectedHistoryItem: formationHistory("keep_as_acquaintance"), simulationSeed: "seed", branchFingerprint: "branch",
    nodeIndex: 7, effectiveAtAgeInMonths: 367
  });
  assert.equal(result.worldStateSnapshot.relationships?.length, 0);
  assert.equal(result.worldStateSnapshot.routePreferences?.[0].openness, "neutral");
  assert.equal(result.worldStateSnapshot.routePreferences?.[0].refusalCount, 0);
  assert.equal(result.worldStateSnapshot.routePreferences?.[0].cooldownUntilAgeInMonths, 379);
});

test("parent wording in model narrative without a selected proposal cannot activate family", () => {
  const history = formationHistory("continue_career");
  history.eventMeta!.eventId = "career_scope_redefinition";
  history.description = "模型写道父母可能会担心，但用户没有选择任何父母相关行动。";
  history.narrativeMeta!.relationshipProposals = [];
  const result = applySelectedRelationshipOutcome({
    current: baseWorld(), selectedHistoryItem: history, simulationSeed: "seed", branchFingerprint: "branch",
    nodeIndex: 6, effectiveAtAgeInMonths: 366
  });
  assert.equal(result.committed, false);
  assert.equal(result.worldStateSnapshot.familyRelationships?.length || 0, 0);
});

test("ending exploration keeps the person but ends the authoritative relationship", () => {
  const formed = applySelectedRelationshipOutcome({
    current: baseWorld(), selectedHistoryItem: formationHistory(), simulationSeed: "seed", branchFingerprint: "branch",
    nodeIndex: 4, effectiveAtAgeInMonths: 360
  }).worldStateSnapshot;
  const evidence = "你们坦诚确认不再继续浪漫探索。";
  const history = formationHistory("end_romantic_exploration");
  history.eventMeta!.eventId = "romance_connection_clarification";
  history.description = evidence;
  history.narrativeMeta!.relationshipProposals = [{
    id: "end", type: "romantic_transition", sourceOutcomeId: "end_romantic_exploration", evidence, toStatus: "ended"
  }];
  const result = applySelectedRelationshipOutcome({
    current: formed, selectedHistoryItem: history, simulationSeed: "seed", branchFingerprint: "branch",
    nodeIndex: 8, effectiveAtAgeInMonths: 366
  });
  assert.equal(result.worldStateSnapshot.people.length, 1);
  assert.equal(result.worldStateSnapshot.relationships?.[0].status, "ended");
  assert.equal(result.worldStateSnapshot.relationships?.[0].effectiveFromAgeInMonths, 360);
  assert.equal(result.worldStateSnapshot.relationships?.[0].statusEffectiveFromAgeInMonths, 366);
  assert.equal(result.worldStateSnapshot.relationships?.[0].progression, undefined);
});

test("an accepted opening breakup ends the authoritative partner relationship", () => {
  const partner = {
    id: "person_partner_current",
    identityKey: { namespace: "user_role" as const, key: "partner:current" },
    displayName: "伴侣",
    relation: "partner" as const,
    lifeStatus: "active" as const,
    source: "user_fact" as const,
    confidence: 0.9
  };
  const current: WorldStateSnapshot = {
    ...baseWorld(),
    people: [partner],
    relationships: [{
      id: "relationship_person_partner_current",
      participantPersonIds: [partner.id],
      type: "romantic",
      stage: "dating",
      status: "active",
      effectiveFromAgeInMonths: 312,
      source: "user",
      confidence: 0.9
    }]
  };
  const history = formationHistory(END_EXISTING_ROMANTIC_RELATIONSHIP_OUTCOME);
  history.eventMeta = undefined;
  history.selectedChoice = "接受长期调任，结束这段无法兼顾的关系";
  history.choices = [{
    id: "C",
    text: history.selectedChoice,
    impactSummary: "事业优先",
    eventOutcomeId: END_EXISTING_ROMANTIC_RELATIONSHIP_OUTCOME
  }];
  history.selectedChoiceId = "C";
  const result = applySelectedRelationshipOutcome({
    current,
    selectedHistoryItem: history,
    simulationSeed: "seed",
    branchFingerprint: "opening-breakup",
    nodeIndex: 0,
    effectiveAtAgeInMonths: 312
  });
  assert.equal(deriveOpeningRomanticOutcomeId(history.selectedChoice), END_EXISTING_ROMANTIC_RELATIONSHIP_OUTCOME);
  assert.equal(result.committed, true);
  assert.equal(result.worldStateSnapshot.relationships[0].stage, "separated");
  assert.equal(result.worldStateSnapshot.relationships[0].status, "ended");
  assert.equal(result.worldStateSnapshot.relationships[0].effectiveFromAgeInMonths, 312);
  assert.equal(result.worldStateSnapshot.relationships[0].statusEffectiveFromAgeInMonths, 312);
  assert.equal(result.worldStateSnapshot.relationships[0].progression, undefined);
  assert.equal(result.worldStateSnapshot.people[0].relation, "other");
});

test("formation is suppressed when an active romantic relationship already exists", () => {
  const formed = applySelectedRelationshipOutcome({
    current: baseWorld(), selectedHistoryItem: formationHistory(), simulationSeed: "seed", branchFingerprint: "branch",
    nodeIndex: 4, effectiveAtAgeInMonths: 360
  }).worldStateSnapshot;
  const second = applySelectedRelationshipOutcome({
    current: formed, selectedHistoryItem: formationHistory(), simulationSeed: "second", branchFingerprint: "branch",
    nodeIndex: 20, effectiveAtAgeInMonths: 420
  });
  assert.equal(second.committed, false);
  assert.equal(second.reason, "active_romantic_relationship_exists");
  assert.equal(second.worldStateSnapshot.people.length, 1);
  assert.equal(second.worldStateSnapshot.relationships?.length, 1);
});

test("clarification cannot skip from exploring to a stage not authorized by the selected outcome", () => {
  const formed = applySelectedRelationshipOutcome({
    current: baseWorld(), selectedHistoryItem: formationHistory(), simulationSeed: "seed", branchFingerprint: "branch",
    nodeIndex: 4, effectiveAtAgeInMonths: 360
  }).worldStateSnapshot;
  const evidence = "几个月后，你们决定继续慢慢了解。";
  const clarification = formationHistory("continue_slow_exploration");
  clarification.eventMeta!.eventId = "romance_connection_clarification";
  clarification.description = evidence;
  clarification.narrativeMeta!.relationshipProposals = [{
    id: "invalid_marriage", type: "romantic_transition", sourceOutcomeId: "continue_slow_exploration",
    evidence, toStage: "married"
  }];
  const result = applySelectedRelationshipOutcome({
    current: formed, selectedHistoryItem: clarification, simulationSeed: "seed", branchFingerprint: "branch",
    nodeIndex: 12, effectiveAtAgeInMonths: 372
  });
  assert.equal(result.committed, true);
  assert.equal(result.worldStateSnapshot.relationships?.[0].stage, "exploring");
  assert.equal(result.worldStateSnapshot.relationships?.[0].progression?.reviewCount, 1);
});

test("selected parent topic stances persist by topic and can change without stereotyping the whole relationship", () => {
  const supportive = formationHistory("discuss_relocation");
  supportive.eventMeta!.eventId = "career_scope_redefinition";
  supportive.description = "母亲说她支持你搬去新城市，也愿意帮你整理搬家安排。";
  supportive.selectedChoice = "和母亲讨论搬家计划";
  supportive.narrativeMeta!.relationshipProposals = [
    {
      id: "activate_mother", type: "family_activation", parentRole: "mother",
      sourceOutcomeId: "discuss_relocation", evidence: supportive.selectedChoice
    },
    {
      id: "support_relocation", type: "parent_topic_stance", parentRole: "mother", topic: "relocation",
      stance: "supportive", reasons: ["愿意帮助整理搬家安排"],
      sourceOutcomeId: "discuss_relocation", evidence: supportive.description
    }
  ];
  const first = applySelectedRelationshipOutcome({
    current: baseWorld(), selectedHistoryItem: supportive, simulationSeed: "seed", branchFingerprint: "branch",
    nodeIndex: 9, effectiveAtAgeInMonths: 369
  });
  assert.equal(first.committed, true);
  assert.equal(first.worldStateSnapshot.familyRelationships?.[0].topicStances[0].stance, "supportive");
  assert.equal(first.worldStateSnapshot.familyRelationships?.[0].autonomyRespect, "unknown");

  const opposed = formationHistory("revisit_relocation");
  opposed.eventMeta!.eventId = "career_scope_redefinition";
  opposed.description = "母亲明确反对这次搬家，因为她担心你没有准备好备用资金。";
  opposed.selectedChoice = "再次讨论搬家条件";
  opposed.narrativeMeta!.relationshipProposals = [{
    id: "oppose_relocation", type: "parent_topic_stance", parentRole: "mother", topic: "relocation",
    stance: "opposed", reasons: ["没有准备备用资金"],
    sourceOutcomeId: "revisit_relocation", evidence: opposed.description
  }];
  const second = applySelectedRelationshipOutcome({
    current: first.worldStateSnapshot, selectedHistoryItem: opposed, simulationSeed: "seed", branchFingerprint: "branch",
    nodeIndex: 10, effectiveAtAgeInMonths: 370
  });
  assert.equal(second.committed, true);
  assert.equal(second.worldStateSnapshot.familyRelationships?.[0].topicStances.length, 1);
  assert.equal(second.worldStateSnapshot.familyRelationships?.[0].topicStances[0].stance, "opposed");
  assert.deepEqual(second.worldStateSnapshot.familyRelationships?.[0].topicStances[0].reasons, ["没有准备备用资金"]);
  assert.equal(second.worldStateSnapshot.familyRelationships?.[0].emotionalSupport, "unknown");
});

test("terminal exploration review can return to acquaintance without deleting the person", () => {
  const formed = applySelectedRelationshipOutcome({
    current: baseWorld(), selectedHistoryItem: formationHistory(), simulationSeed: "seed", branchFingerprint: "branch",
    nodeIndex: 4, effectiveAtAgeInMonths: 360
  }).worldStateSnapshot;
  const evidence = "你们确认回到普通认识，不再保留浪漫期待。";
  const resolution = formationHistory("return_to_acquaintance");
  resolution.eventMeta!.eventId = "romance_exploration_resolution";
  resolution.description = evidence;
  resolution.narrativeMeta!.relationshipProposals = [{
    id: "return", type: "romantic_transition", sourceOutcomeId: "return_to_acquaintance",
    evidence, toStage: "acquaintance", toStatus: "ended"
  }];
  const result = applySelectedRelationshipOutcome({
    current: formed, selectedHistoryItem: resolution, simulationSeed: "seed", branchFingerprint: "branch",
    nodeIndex: 10, effectiveAtAgeInMonths: 378
  });
  assert.equal(result.committed, true);
  assert.equal(result.worldStateSnapshot.people.length, 1);
  assert.equal(result.worldStateSnapshot.relationships?.[0].stage, "acquaintance");
  assert.equal(result.worldStateSnapshot.relationships?.[0].status, "ended");
  assert.equal(result.worldStateSnapshot.relationships?.[0].effectiveFromAgeInMonths, 360);
  assert.equal(result.worldStateSnapshot.relationships?.[0].statusEffectiveFromAgeInMonths, 378);
  assert.equal(result.worldStateSnapshot.relationships?.[0].progression, undefined);
});

test("commitment review supports one bounded delay then resolves the checkpoint", () => {
  const formed = applySelectedRelationshipOutcome({
    current: baseWorld(), selectedHistoryItem: formationHistory(), simulationSeed: "seed", branchFingerprint: "branch",
    nodeIndex: 4, effectiveAtAgeInMonths: 360
  }).worldStateSnapshot;
  const datingEvidence = "相处一段时间后，你们确认开始正式交往。";
  const dating = formationHistory("begin_mutual_dating");
  dating.eventMeta!.eventId = "romance_connection_clarification";
  dating.description = datingEvidence;
  dating.narrativeMeta!.relationshipProposals = [{
    id: "dating", type: "romantic_transition", sourceOutcomeId: "begin_mutual_dating",
    evidence: datingEvidence, toStage: "dating", toStatus: "active"
  }];
  const withCommitment = applySelectedRelationshipOutcome({
    current: formed, selectedHistoryItem: dating, simulationSeed: "seed", branchFingerprint: "branch",
    nodeIndex: 8, effectiveAtAgeInMonths: 369
  }).worldStateSnapshot;

  const delayEvidence = "你们约定先满足住房条件，并在一年后重新复核。";
  const delay = formationHistory("delay_with_clear_conditions");
  delay.eventMeta!.eventId = "relationship_material_commitment_test";
  delay.description = delayEvidence;
  delay.narrativeMeta!.relationshipProposals = [{
    id: "delay", type: "romantic_transition", sourceOutcomeId: "delay_with_clear_conditions",
    evidence: delayEvidence, toStage: "dating", toStatus: "active"
  }];
  const delayed = applySelectedRelationshipOutcome({
    current: withCommitment, selectedHistoryItem: delay, simulationSeed: "seed", branchFingerprint: "branch",
    nodeIndex: 12, effectiveAtAgeInMonths: 393
  });
  assert.equal(delayed.committed, true);
  assert.equal(delayed.worldStateSnapshot.relationships?.[0].progression?.delayCount, 1);
  assert.equal(delayed.worldStateSnapshot.relationships?.[0].stage, "dating");

  const planEvidence = "你们形成一份共同生活和长期安排。";
  const plan = formationHistory("make_shared_commitment_plan");
  plan.eventMeta!.eventId = "relationship_commitment_resolution";
  plan.description = planEvidence;
  plan.narrativeMeta!.relationshipProposals = [{
    id: "plan", type: "romantic_transition", sourceOutcomeId: "make_shared_commitment_plan",
    evidence: planEvidence, toStage: "dating", toStatus: "active"
  }];
  const resolved = applySelectedRelationshipOutcome({
    current: delayed.worldStateSnapshot, selectedHistoryItem: plan, simulationSeed: "seed", branchFingerprint: "branch",
    nodeIndex: 16, effectiveAtAgeInMonths: 405
  });
  assert.equal(resolved.committed, true);
  assert.equal(resolved.worldStateSnapshot.relationships?.[0].progression, undefined);
  assert.equal(resolved.worldStateSnapshot.relationships?.[0].stage, "dating");
});

test("commitment evidence survives presentation-only paragraph insertion", () => {
  const formed = applySelectedRelationshipOutcome({
    current: baseWorld(), selectedHistoryItem: formationHistory(), simulationSeed: "seed", branchFingerprint: "branch",
    nodeIndex: 4, effectiveAtAgeInMonths: 360
  }).worldStateSnapshot;
  const datingEvidence = "相处一段时间后，你们确认开始正式交往。";
  const dating = formationHistory("begin_mutual_dating");
  dating.eventMeta!.eventId = "romance_connection_clarification";
  dating.description = datingEvidence;
  dating.narrativeMeta!.relationshipProposals = [{
    id: "dating", type: "romantic_transition", sourceOutcomeId: "begin_mutual_dating",
    evidence: datingEvidence, toStage: "dating", toStatus: "active"
  }];
  const withCommitment = applySelectedRelationshipOutcome({
    current: formed, selectedHistoryItem: dating, simulationSeed: "seed", branchFingerprint: "branch",
    nodeIndex: 8, effectiveAtAgeInMonths: 369
  }).worldStateSnapshot;

  const evidence = "共同计划执行到第二个月，你发现现实更复杂。伴侣开始谈起下一步安排。";
  const reassess = formationHistory("reassess_relationship_fit");
  reassess.eventMeta!.eventId = "relationship_material_commitment_test";
  reassess.description = "共同计划执行到第二个月，你发现现实更复杂。\n\n伴侣开始谈起下一步安排。";
  reassess.narrativeMeta!.relationshipProposals = [{
    id: "reassess", type: "romantic_transition", sourceOutcomeId: "reassess_relationship_fit",
    evidence, toStage: "dating", toStatus: "strained"
  }];
  const committed = applySelectedRelationshipOutcome({
    current: withCommitment, selectedHistoryItem: reassess, simulationSeed: "seed", branchFingerprint: "branch",
    nodeIndex: 12, effectiveAtAgeInMonths: 393
  });

  assert.equal(committed.committed, true);
  assert.equal(committed.worldStateSnapshot.relationships?.[0].status, "strained");
  assert.equal(committed.worldStateSnapshot.relationships?.[0].statusEffectiveFromAgeInMonths, 393);
  assert.equal(committed.worldStateSnapshot.relationships?.[0].progression, undefined);
});

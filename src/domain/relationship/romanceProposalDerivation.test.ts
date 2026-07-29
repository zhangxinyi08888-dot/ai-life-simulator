import assert from "node:assert/strict";
import test from "node:test";
import type { HistoryItem, SimulationNode, WorldStateSnapshot } from "../../types";
import { applySelectedRelationshipOutcome } from "./relationshipOutcome";
import { deriveDeterministicRomanceProposals, romanceCandidate, withRomanceCandidate } from "./romanceProposalDerivation";

function node(activeCharacters: NonNullable<SimulationNode["narrativeMeta"]>["activeCharacters"] = []): SimulationNode {
  const description = "你在行业活动上认识了小苏，活动结束后你们交换了联系方式。";
  return {
    age: 35,
    ageInMonths: 420,
    lifeStage: "midlife",
    stage: "生活交汇",
    title: "生活里的新联系",
    description,
    descriptionParagraphs: [description],
    choices: [
      { id: "A", text: "继续了解", impactSummary: "保持联系", eventOutcomeId: "continue_getting_to_know" },
      { id: "B", text: "普通认识", impactSummary: "保持边界", eventOutcomeId: "keep_as_acquaintance" },
      { id: "C", text: "拒绝发展", impactSummary: "明确拒绝", eventOutcomeId: "decline_romantic_direction" }
    ],
    attributes: { happiness: 50, intelligence: 60, wealth: 50, relation: 50, health: 50 },
    isEndingNode: false,
    eventMeta: { eventId: "romance_new_connection", eventTags: [], routeLine: "romance" },
    narrativeMeta: {
      elapsedMonths: 12,
      elapsedYears: 1,
      lifeIntensity: "normal",
      nodeMateriality: "decision_checkpoint",
      storyEpisode: { id: "episode_romance", startAgeInMonths: 408, endAgeInMonths: 420, internalTransitions: [], decisionCheckpointId: "choice", summary: description },
      recoveryState: "neutral",
      recoveryEvidence: [],
      arcSignals: [],
      activeCharacters,
      worldDeltas: []
    }
  };
}

test("new connection proposals are derived from event semantics and candidate material", () => {
  const source = node([{ candidateOrdinal: 0, displayName: "小苏", relation: "other", presenceMode: "active_scene" }]);
  const derived = deriveDeterministicRomanceProposals(source, "romance_new_connection");
  const proposals = derived.narrativeMeta?.relationshipProposals || [];
  assert.equal(proposals.length, 2);
  assert.deepEqual(proposals.map((proposal) => proposal.type), ["person_introduction", "romantic_transition"]);
  assert.ok(proposals.every((proposal) => proposal.sourceOutcomeId === "continue_getting_to_know"));
  assert.ok(proposals.every((proposal) => derived.description.includes(proposal.evidence)));
  assert.equal(proposals.find((proposal) => proposal.type === "person_introduction")?.displayName, "小苏");
});

test("new connection evidence comes from the paragraph that names the candidate", () => {
  const source = node([{ candidateOrdinal: 0, displayName: "小苏", relation: "other", presenceMode: "active_scene" }]);
  source.descriptionParagraphs = [
    "这一年你的工作逐渐稳定，收入和团队规模都有提升。",
    "你在行业活动上认识了小苏，活动结束后你们交换了联系方式。"
  ];
  source.description = source.descriptionParagraphs.join("\n\n");
  const proposals = deriveDeterministicRomanceProposals(source, "romance_new_connection").narrativeMeta?.relationshipProposals || [];
  assert.ok(proposals.every((proposal) => proposal.evidence.includes("小苏")));
});

test("one unbound named character becomes candidate zero without relying on array position", () => {
  const source = node([{ displayName: "小苏", relation: "other", presenceMode: "active_scene" }]);
  assert.equal(romanceCandidate(source)?.candidateOrdinal, 0);
  assert.equal(deriveDeterministicRomanceProposals(source, "romance_new_connection").narrativeMeta?.activeCharacters[0].candidateOrdinal, 0);
});

test("missing or generic identity material cannot create an authoritative romance candidate", () => {
  const prepared = withRomanceCandidate(node());
  assert.equal(romanceCandidate(prepared), undefined);
  const derived = deriveDeterministicRomanceProposals(prepared, "romance_new_connection");
  const person = derived.narrativeMeta?.relationshipProposals?.find((proposal) => proposal.type === "person_introduction");
  assert.equal(person, undefined);

  const pronoun = node([{ candidateOrdinal: 0, displayName: "你", relation: "other", presenceMode: "active_scene" }]);
  assert.equal(romanceCandidate(pronoun), undefined);
  assert.equal(
    deriveDeterministicRomanceProposals(pronoun, "romance_new_connection")
      .narrativeMeta?.relationshipProposals?.some((proposal) => proposal.type === "person_introduction"),
    false
  );
});

test("clarification transitions are derived for every selectable outcome", () => {
  const derived = deriveDeterministicRomanceProposals(node(), "romance_connection_clarification");
  assert.deepEqual(
    derived.narrativeMeta?.relationshipProposals?.map((proposal) => proposal.sourceOutcomeId),
    ["begin_mutual_dating", "continue_slow_exploration", "end_romantic_exploration"]
  );
});

test("bounded commitment resolution cannot regenerate an unlimited delay outcome", () => {
  const derived = deriveDeterministicRomanceProposals(node(), "relationship_commitment_resolution");
  assert.deepEqual(
    derived.narrativeMeta?.relationshipProposals?.map((proposal) => proposal.sourceOutcomeId),
    [
      "make_shared_commitment_plan",
      "maintain_committed_partnership_without_marriage",
      "reassess_relationship_fit"
    ]
  );
  assert.equal(
    derived.narrativeMeta?.relationshipProposals?.some((proposal) => proposal.sourceOutcomeId === "delay_with_clear_conditions"),
    false
  );
});

test("deterministic commitment proposals can be re-anchored after financial prose grounding", () => {
  const finalParagraphs = [
    "这段时间的工作安排仍在继续，但实际到账的个人收入尚待确认。",
    "你们最终达成一个可执行的共同计划。"
  ];
  const source = node();
  const grounded = deriveDeterministicRomanceProposals({
    ...source,
    description: finalParagraphs.join("\n\n"),
    descriptionParagraphs: finalParagraphs,
    choices: [
      { id: "A", text: "形成共同计划", impactSummary: "共同安排", eventOutcomeId: "make_shared_commitment_plan" },
      { id: "B", text: "延后复核", impactSummary: "明确条件", eventOutcomeId: "delay_with_clear_conditions" },
      { id: "C", text: "重新评估", impactSummary: "评估适配", eventOutcomeId: "reassess_relationship_fit" }
    ],
    narrativeMeta: {
      ...source.narrativeMeta!,
      relationshipProposals: [{
        id: "stale",
        type: "romantic_transition",
        sourceOutcomeId: "make_shared_commitment_plan",
        evidence: "你的主业年收入18万，目前存款70.5万。",
        toStage: "dating",
        toStatus: "active"
      }]
    }
  }, "relationship_material_commitment_test");

  assert.equal(grounded.narrativeMeta?.relationshipProposals?.length, 3);
  for (const proposal of grounded.narrativeMeta?.relationshipProposals || []) {
    assert.equal(grounded.description.includes(proposal.evidence), true);
    assert.notEqual(proposal.evidence, "你的主业年收入18万，目前存款70.5万。");
  }
});

test("derived proposal commits only after the matching outcome is selected", () => {
  const rendered = deriveDeterministicRomanceProposals(
    node([{ candidateOrdinal: 0, displayName: "小苏", relation: "other", presenceMode: "active_scene" }]),
    "romance_new_connection"
  );
  const current: WorldStateSnapshot = {
    people: [], directionArcs: [], pressureArcs: [], relationships: [], relationshipRevision: 0, version: 2
  };
  assert.equal(current.relationships?.length, 0);
  const selectedHistoryItem: HistoryItem = {
    ...rendered,
    selectedChoice: "继续了解",
    selectedChoiceId: "A",
    selectedEventOutcomeId: "continue_getting_to_know"
  };
  const committed = applySelectedRelationshipOutcome({
    current,
    selectedHistoryItem,
    simulationSeed: "seed",
    branchFingerprint: "branch",
    nodeIndex: 4,
    effectiveAtAgeInMonths: 432
  });
  assert.equal(committed.committed, true);
  assert.equal(committed.worldStateSnapshot.people[0].displayName, "小苏");
  assert.equal(committed.worldStateSnapshot.relationships?.[0].stage, "exploring");
});

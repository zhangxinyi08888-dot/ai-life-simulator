import assert from "node:assert/strict";
import test from "node:test";
import type { HistoryItem, UserInitialData, WorldStateSnapshot } from "../../types";
import { createCommitmentProgression } from "../../domain/relationship/relationshipLifecycle";
import { generateNextNodeWithEventOutcomes } from "./testEventOutcomeAdapter";

const userData: UserInitialData = {
  birthday: "1994-02-10",
  birthtime: "08:00",
  gender: "女",
  currentSituation: "在职业和长期关系之间寻找平衡",
  isReturnToPast: true,
  targetAgeNode: "工作初期",
  regressionNodeKey: "relationship",
  regressionAge: 25,
  regressionSituation: "伴侣与职业安排都需要长期协调",
  regressionChoices: "形成共同计划",
  coreStoryFocus: "romance"
};

const partner = {
  id: "person_partner",
  displayName: "林遥",
  relation: "partner" as const,
  lifeStatus: "active" as const,
  source: "accepted_history" as const,
  confidence: 0.95
};

const worldState: WorldStateSnapshot = {
  people: [partner],
  directionArcs: [],
  pressureArcs: [],
  relationships: [{
    id: "relationship_partner",
    participantPersonIds: [partner.id],
    type: "romantic",
    stage: "dating",
    status: "active",
    effectiveFromAgeInMonths: 300,
    progression: createCommitmentProgression(300),
    source: "accepted_history",
    confidence: 0.95
  }],
  relationshipRevision: 1,
  relationshipProgressionVersion: 1,
  version: 2
};

const commitmentEvidence = "你们讨论并形成共同生活的筹备计划和长期安排。";
const history: HistoryItem[] = [{
  age: 30,
  ageInMonths: 360,
  stage: "关系复核",
  title: "长期安排的讨论",
  description: commitmentEvidence,
  selectedChoiceId: "A",
  selectedChoice: commitmentEvidence,
  selectedEventOutcomeId: "make_shared_commitment_plan",
  attributes: { happiness: 62, intelligence: 70, wealth: 48, relation: 72, health: 64 },
  financialState: {
    currencyUnit: "CNY_WAN_REAL",
    asOfAgeInMonths: 360,
    cashWan: 100,
    investmentAssetsWan: 0,
    propertyMarketValueWan: 0,
    businessAndOtherAssetsWan: 0,
    totalDebtWan: 0,
    netWorthWan: 100,
    annualAfterTaxIncomeWan: 0,
    annualDisposableIncomeWan: 0,
    annualCoreExpenseWan: 0,
    employmentStatus: "not_working",
    incomeStability: "unstable",
    isEstimated: true
  },
  choices: [{
    id: "A",
    text: commitmentEvidence,
    impactSummary: "共同计划",
    decisionIntent: "romance:commit:shared_plan",
    eventOutcomeId: "make_shared_commitment_plan",
    expectedWorldDeltaTypes: ["relationship_change"]
  }],
  eventMeta: { eventId: "relationship_material_commitment_test", eventTags: ["relationship"], routeLine: "romance" },
  narrativeMeta: {
    elapsedMonths: 12,
    elapsedYears: 1,
    lifeIntensity: "normal",
    nodeMateriality: "decision_checkpoint",
    storyEpisode: { id: "commitment_episode", startAgeInMonths: 348, endAgeInMonths: 360, internalTransitions: [], decisionCheckpointId: "A", summary: commitmentEvidence },
    recoveryState: "neutral",
    recoveryEvidence: [],
    arcSignals: [],
    activeCharacters: [{ personId: partner.id, displayName: partner.displayName, relation: "partner", presenceMode: "active_scene" }],
    worldDeltas: [],
    relationshipProposals: [{
      id: "commitment_transition",
      type: "romantic_transition",
      sourceOutcomeId: "make_shared_commitment_plan",
      evidence: commitmentEvidence,
      toStage: "dating",
      toStatus: "active"
    }]
  },
  isEndingNode: false,
  worldStateSnapshot: worldState
}];

function candidate(description: string) {
  return {
    age: 31,
    stage: "现实安排",
    title: "长期安排的下一步",
    description,
    choices: [
      { id: "A", text: "继续推进工作并保留固定沟通时间", impactSummary: "平衡推进", decisionIntent: "career:continue:balanced" },
      { id: "B", text: "先压低短期工作负荷，复核共同计划的现实条件", impactSummary: "条件复核", decisionIntent: "relationship:review:conditions" },
      { id: "C", text: "维持各自生活安排，三个月后再讨论下一步", impactSummary: "延后复核", decisionIntent: "relationship:delay:review" }
    ],
    attributes: { happiness: 62, intelligence: 70, wealth: 48, relation: 72, health: 64 },
    isEndingNode: false,
    narrativeMeta: {
      recoveryState: "neutral",
      recoveryEvidence: [],
      arcSignals: [],
      activeCharacters: [{ personId: partner.id, displayName: partner.displayName, relation: "partner", presenceMode: "active_scene" }],
      worldDeltas: []
    }
  };
}

test("locally removes an ungrounded post-commitment marriage and child narrative before state commit", async () => {
  let calls = 0;
  const node = await generateNextNodeWithEventOutcomes({
    userData,
    answers: [],
    history,
    currentAttributes: history[0].attributes,
    selectedDecision: commitmentEvidence,
    nodeIndex: 1,
    simulationSeed: "relationship-authority-repair"
  }, {
    financialNodeGateMode: "shadow",
    expenseLifecycleMode: "shadow",
    callAiJson: async (prompt) => {
      calls += 1;
      return { text: JSON.stringify(candidate("我们领了证，孩子出生。她开始接孩子，孩子的托育费用也进入家庭预算。")) };
    }
  });

  assert.equal(calls, 1, "release-default mode must remove a relation-only conflict without a second full generation");
  assert.doesNotMatch(node.description, /领了证|孩子出生|接孩子|托育/);
  assert.equal(node.eventMeta?.fallbackReason, "relationship_authority_deterministic_fallback");
  assert.equal(node.worldStateSnapshot?.relationships?.[0]?.stage, "dating");
  assert.equal(node.worldStateSnapshot?.people.some((person) => person.relation === "child"), false);
});

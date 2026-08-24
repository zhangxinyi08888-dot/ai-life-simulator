import assert from "node:assert/strict";
import test from "node:test";
import type { FinancialLedger } from "../../domain/finance";
import type { HistoryItem, SimulationNode, UserInitialData, WorldStateSnapshot } from "../../types";
import { validateStoryConsistency } from "../../utils/storyConsistency";
import { repairRelationshipAuthorityFinalSurface } from "./simulationService";
import type { GenerationCallTrace } from "./generationTelemetry";
import { generateNextNodeWithEventOutcomes } from "./testEventOutcomeAdapter";

const worldState: WorldStateSnapshot = {
  people: [],
  directionArcs: [],
  pressureArcs: [],
  relationships: [],
  version: 2
};

const ledger = {
  id: "ledger_relationship_fallback",
  owner: "protagonist",
  currencyUnit: "CNY_WAN_REAL",
  asOfAgeInMonths: 360,
  cashAccounts: [],
  assetAccounts: [],
  incomeSources: [],
  expenseCommitments: [],
  businessHoldings: [],
  debtAccounts: [],
  recentTransactions: [],
  committedTransactionIds: [],
  unresolvedIssues: [],
  revision: 1,
  version: 3
} as FinancialLedger;

const node: SimulationNode = {
  age: 30,
  ageInMonths: 360,
  lifeStage: "early_adulthood",
  stage: "现实安排",
  title: "项目与租约的复核",
  description: "你每月仍支付房租 5000 元，现金流按权威账本继续记录。你和苏棠已经结婚，孩子出生。",
  // The financial fact and invalid relationship claim intentionally share one
  // paragraph: final repair must remove only the latter sentence.
  descriptionParagraphs: ["你每月仍支付房租 5000 元，现金流按权威账本继续记录。你和苏棠已经结婚，孩子出生。"],
  choices: [
    { id: "A", text: "继续按账本执行现有租约", impactSummary: "维持住房安排", decisionIntent: "career:continue:plan" },
    { id: "B", text: "复核项目节奏和现金流", impactSummary: "控制风险", decisionIntent: "career:review:plan" },
    { id: "C", text: "调整项目投入强度", impactSummary: "调整方向", decisionIntent: "career:adjust:plan" }
  ],
  attributes: { happiness: 62, intelligence: 70, wealth: 48, relation: 72, health: 64 },
  financialLedger: ledger,
  isEndingNode: false,
  eventMeta: { eventTags: ["career"], routeLine: "career" },
  narrativeMeta: {
    elapsedMonths: 12,
    elapsedYears: 1,
    lifeIntensity: "normal",
    nodeMateriality: "decision_checkpoint",
    storyEpisode: {
      id: "relationship_authority_surface",
      startAgeInMonths: 348,
      endAgeInMonths: 360,
      internalTransitions: [],
      decisionCheckpointId: "A",
      summary: "项目与租约的复核"
    },
    recoveryState: "neutral",
    recoveryEvidence: [],
    arcSignals: [],
    activeCharacters: [{
      personId: "person_parent",
      relation: "parent",
      presenceMode: "active_scene",
      currentRole: "family",
      candidateOrdinal: 1
    }],
    worldDeltas: [{ type: "relationship_change", personId: "person_stale", summary: "unaccepted relationship transition" }]
  }
};

test("final relationship repair keeps ledger-backed financial text while removing stale relationship surface", () => {
  const repaired = repairRelationshipAuthorityFinalSurface({
    node,
    elapsedMonths: 12,
    targetAgeInMonths: 360,
    people: worldState.people,
    worldState
  }).node;

  assert.equal(repaired.financialLedger, ledger, "a final-surface repair must not replace the committed ledger");
  assert.match(repaired.description, /每月仍支付房租 5000 元/);
  assert.doesNotMatch(repaired.description, /已经结婚|孩子出生/);
  assert.deepEqual(repaired.narrativeMeta?.activeCharacters, [{
    personId: "person_parent",
    relation: "parent",
    presenceMode: "active_scene",
    currentRole: "family"
  }]);
  assert.deepEqual(repaired.narrativeMeta?.worldDeltas, []);
  assert.equal(validateStoryConsistency({
    node: repaired,
    targetAgeInMonths: 360,
    people: worldState.people,
    worldState
  }).some((issue) => issue.code === "relationship_authority_conflict"), false);
});

test("final authority repair removes an implausibly old parent's present-day activity without touching financial text", () => {
  const oldParent = {
    id: "person_parent",
    relation: "parent" as const,
    displayName: "父母",
    estimatedAgeRange: [106.6, 133.6] as [number, number],
    lifeStatus: "active" as const,
    source: "user_fact" as const,
    confidence: 0.9
  };
  const lateLifeWorldState: WorldStateSnapshot = {
    people: [oldParent], directionArcs: [], pressureArcs: [], relationships: [], version: 2
  };
  const lateLifeNode: SimulationNode = {
    ...node,
    age: 88,
    ageInMonths: 1064,
    lifeStage: "longevity",
    description: "本期咨询收入仍按权威账本记录。父亲在院子里慢慢走动，母亲在屋里整理最后一批手工订单。",
    descriptionParagraphs: ["本期咨询收入仍按权威账本记录。父亲在院子里慢慢走动，母亲在屋里整理最后一批手工订单。"]
  };
  const repaired = repairRelationshipAuthorityFinalSurface({
    node: lateLifeNode,
    elapsedMonths: 14,
    targetAgeInMonths: 1064,
    people: lateLifeWorldState.people,
    worldState: lateLifeWorldState
  }).node;

  assert.match(repaired.description, /咨询收入仍按权威账本记录/);
  assert.doesNotMatch(repaired.description, /父亲在院子|母亲在屋里/);
  assert.equal(validateStoryConsistency({
    node: repaired,
    targetAgeInMonths: 1064,
    people: lateLifeWorldState.people,
    worldState: lateLifeWorldState
  }).some((issue) => issue.severity === "error"), false);
});

const generationUserData: UserInitialData = {
  birthday: "1994-02-10",
  birthtime: "08:00",
  gender: "女",
  currentSituation: "在职业发展和个人生活之间寻找稳定节奏",
  isReturnToPast: true,
  targetAgeNode: "工作初期",
  regressionNodeKey: "relationship-fallback",
  regressionAge: 25,
  regressionSituation: "职业安排需要长期推进",
  regressionChoices: "形成可持续的职业方向",
  coreStoryFocus: "career"
};

const generationAttributes = { happiness: 62, intelligence: 70, wealth: 48, relation: 72, health: 64 };
const noRelationshipWorldState: WorldStateSnapshot = {
  people: [],
  directionArcs: [],
  pressureArcs: [],
  relationships: [],
  version: 2
};
const fallbackHistory: HistoryItem[] = [
  {
    age: 28,
    ageInMonths: 336,
    lifeStage: "early_adulthood",
    stage: "工作调整",
    title: "第一次选择",
    description: "你拒绝了浪漫关系的发展，决定先处理职业安排。",
    selectedChoice: "保持职业安排",
    selectedEventOutcomeId: "decline_romantic_direction",
    attributes: generationAttributes,
    choices: [{ id: "A", text: "保持职业安排", impactSummary: "继续推进", eventOutcomeId: "decline_romantic_direction" }],
    isEndingNode: false,
    worldStateSnapshot: noRelationshipWorldState
  },
  {
    age: 30,
    ageInMonths: 360,
    lifeStage: "early_adulthood",
    stage: "工作调整",
    title: "职业安排",
    description: "你继续拒绝浪漫关系的发展，并接受新的工作安排，开始处理项目交接。",
    selectedChoice: "接受新的工作安排",
    selectedEventOutcomeId: "decline_romantic_direction",
    attributes: generationAttributes,
    choices: [{ id: "A", text: "接受新的工作安排", impactSummary: "推进项目", eventOutcomeId: "decline_romantic_direction" }],
    isEndingNode: false,
    worldStateSnapshot: noRelationshipWorldState
  }
];

function repeatedlyInvalidRelationshipCandidate() {
  return {
    age: 31,
    stage: "现实安排",
    title: "项目交接的下一步",
    description: "你接受新的工作安排后，工作交接开始推进。你和苏棠领了证，孩子出生。",
    choices: [
      { id: "A", text: "继续推进项目", impactSummary: "推进项目", decisionIntent: "career:continue:project" },
      { id: "B", text: "复核项目节奏", impactSummary: "控制风险", decisionIntent: "career:review:project" },
      { id: "C", text: "调整项目投入", impactSummary: "调整方向", decisionIntent: "career:adjust:project" }
    ],
    attributes: generationAttributes,
    isEndingNode: false,
    narrativeMeta: {
      recoveryState: "neutral",
      recoveryEvidence: [],
      arcSignals: [],
      activeCharacters: [{
        personId: "person_parent",
        relation: "parent",
        presenceMode: "active_scene",
        currentRole: "family",
        candidateOrdinal: 1
      }],
      worldDeltas: []
    }
  };
}

test("repeated generic relationship authority violations render an auditable fallback instead of pausing", async () => {
  const prompts: string[] = [];
  const traces: GenerationCallTrace[] = [];
  const generated = await generateNextNodeWithEventOutcomes({
    userData: generationUserData,
    answers: [],
    history: fallbackHistory,
    currentAttributes: generationAttributes,
    selectedDecision: "接受新的工作安排",
    nodeIndex: 2,
    // This seed selects career_gradual_transition_window after the two prior
    // explicit romance declines, exercising the historical non-romance path.
    simulationSeed: "rel-fallback-0"
  }, {
    financialNodeGateMode: "shadow",
    expenseLifecycleMode: "shadow",
    enableCandidatePatchRepair: true,
    onGenerationCallTrace: (trace) => traces.push(trace),
    callAiJson: async (prompt) => {
      prompts.push(prompt);
      return { text: JSON.stringify(repeatedlyInvalidRelationshipCandidate()) };
    }
  });

  assert.ok(prompts.some((prompt) => prompt.includes("【关系权威最终修复】")));
  assert.ok(
    traces.some((trace) => (
      trace.kind === "candidate_patch"
      && trace.outcome === "failed"
      && trace.errorCode === "AI_RESPONSE_INVALID"
    )),
    "a complete node returned to the strict patch endpoint must be rejected before deterministic fallback"
  );
  assert.equal(generated.eventMeta?.fallbackReason, "relationship_authority_deterministic_fallback");
  assert.equal(generated.financialProcessingMeta?.narrativeFallback, true);
  assert.ok(generated.financialProcessingMeta?.narrativeFallbackReasonCodes?.includes("RELATIONSHIP_AUTHORITY_DETERMINISTIC_FALLBACK"));
  assert.ok(generated.financialProcessingMeta?.narrativeFallbackSurfacePaths?.includes("relationship_authority"));
  assert.doesNotMatch(generated.description, /领了证|孩子出生/);
  assert.equal(validateStoryConsistency({
    node: generated,
    targetAgeInMonths: generated.ageInMonths!,
    people: generated.worldStateSnapshot?.people || [],
    worldState: generated.worldStateSnapshot
  }).some((issue) => issue.severity === "error"), false);
});

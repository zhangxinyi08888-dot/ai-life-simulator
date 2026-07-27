import assert from "node:assert/strict";
import type { HistoryItem, LifeAttributes, WorldStateSnapshot } from "../types";
import {
  evaluateHistoryCondition,
  hasExploringRelationshipForAtLeastMonths,
  matchesHistoryConditionGroups,
  matchesRequiredContext,
  matchesRequiredContextGroups,
  resolveSelectedDecisionIntent
} from "./eventEligibility";

const current: LifeAttributes = { happiness: 55, intelligence: 60, wealth: 50, relation: 55, health: 58 };

function item(ageInMonths: number, intent: string, health: number, eventId?: string): HistoryItem {
  return {
    age: ageInMonths / 12,
    ageInMonths,
    stage: "测试",
    title: "持续行动",
    description: "工作、关系和健康状态持续变化。",
    selectedChoice: `选择 ${intent}`,
    attributes: { ...current, health },
    choices: [{ id: "A", text: `选择 ${intent}`, impactSummary: "测试", decisionIntent: intent }],
    isEndingNode: false,
    eventMeta: eventId ? { eventId, eventCategory: "health", eventTags: ["test"] } : undefined
  };
}

const history = [
  item(540, "health:reduce_load", 48, "health_forced_pause"),
  item(558, "health:reduce_load", 52),
  item(570, "career:continue_project", 55)
];

assert.equal(resolveSelectedDecisionIntent(history[0]), "health:reduce_load");
assert.equal(evaluateHistoryCondition({
  type: "selected_intent_count", intentPrefixes: ["health:reduce_load"], minCount: 2, withinNodes: 8
}, history, current, 50), true);
assert.equal(evaluateHistoryCondition({
  type: "selected_intent_count", intentPrefixes: ["health:reduce_load"], minCount: 2, withinNodes: 2
}, history, current, 50), false);
history[1].selectedEventOutcomeId = "continue_getting_to_know";
assert.equal(evaluateHistoryCondition({
  type: "selected_outcome_count", outcomeIds: ["continue_getting_to_know"], minCount: 1, withinNodes: 3
}, history, current, 50), true);
assert.equal(evaluateHistoryCondition({
  type: "elapsed_since_event", eventIds: ["health_forced_pause"], minMonths: 6
}, history, current, 50), true);
assert.equal(evaluateHistoryCondition({
  type: "elapsed_since_event", eventIds: ["health_forced_pause"], minMonths: 6, maxMonths: 50
}, history, current, 50), false);
assert.equal(evaluateHistoryCondition({
  type: "attribute_trend", attribute: "health", direction: "improving", withinNodes: 3, minimumDelta: 5
}, history, current, 50), true);
assert.equal(evaluateHistoryCondition({
  type: "event_absent", eventIds: ["health_forced_pause"], withinNodes: 2
}, history, current, 50), true);
assert.equal(matchesHistoryConditionGroups([
  [{ type: "selected_intent_count", intentPrefixes: ["missing"], minCount: 1 }],
  [
    { type: "selected_intent_count", intentPrefixes: ["health:reduce_load"], minCount: 2 },
    { type: "attribute_trend", attribute: "health", direction: "improving", withinNodes: 3, minimumDelta: 5 }
  ]
], history, current, 50), true);

const snapshot: WorldStateSnapshot = {
  people: [
    { id: "partner", relation: "partner", lifeStatus: "active", source: "user_fact", confidence: 0.9 },
    { id: "friend", relation: "friend", lifeStatus: "active", source: "history", confidence: 0.75 }
  ],
  directionArcs: [{ id: "writing", directionType: "creation", summary: "持续写作", status: "active", startedAtAgeInMonths: 500, userReinforcementCount: 3, establishedAssets: [] }],
  pressureArcs: [{ id: "health", eventId: "health_forced_pause", eventIntentType: "health_forced_pause", phasePolicyId: "health_crisis_v1", phaseId: "recovery", status: "stabilizing", startedAtAgeInMonths: 540, phaseStartedAtAgeInMonths: 550, phaseCheckpointCount: 1, totalCheckpointCount: 2, unresolvedSummary: "恢复" }],
  careerSummary: "从事产品工作",
  version: 1
};
history[2].worldStateSnapshot = snapshot;
history[2].financialState = {
  currencyUnit: "CNY_WAN_REAL", asOfAgeInMonths: 570, cashWan: 8, investmentAssetsWan: 0,
  propertyMarketValueWan: 0, businessAndOtherAssetsWan: 0, totalDebtWan: 5, netWorthWan: 3,
  annualAfterTaxIncomeWan: 15, annualDisposableIncomeWan: 5, annualCoreExpenseWan: 10,
  incomeStability: "stable", isEstimated: false
};

const contextInput = { attribs: current, userData: {}, age: 50, history, answers: undefined };
assert.equal(matchesRequiredContext("career_active", contextInput), true);
assert.equal(matchesRequiredContext("career_or_creation_direction", contextInput), true);
assert.equal(matchesRequiredContext("confirmed_partner", contextInput), true);
assert.equal(matchesRequiredContext("confirmed_friend_or_colleague", contextInput), true);
assert.equal(matchesRequiredContext("financial_state_available", contextInput), true);
assert.equal(matchesRequiredContext("debt_present", contextInput), true);
assert.equal(matchesRequiredContext("learning_or_creation_direction", contextInput), true);
assert.equal(matchesRequiredContext("health_recovery_context", contextInput), true);
assert.equal(matchesRequiredContextGroups([["confirmed_family"], ["confirmed_partner", "financial_state_available"]], contextInput), true);

const inferredOnly = history.map((entry) => ({ ...entry, worldStateSnapshot: {
  ...snapshot,
  people: [{ id: "guess", relation: "partner" as const, lifeStatus: "unknown" as const, source: "model_inferred" as const, confidence: 0.55 }]
} }));
assert.equal(matchesRequiredContext("confirmed_partner", { ...contextInput, history: inferredOnly }), false);
assert.equal(matchesRequiredContext("confirmed_partner", {
  ...contextInput,
  history: [],
  userData: { milestoneRelationship: "大学时谈过恋爱，后来已经分手。" }
}), false);

const exploringHistory = history.map((entry) => ({ ...entry, worldStateSnapshot: {
  ...snapshot,
  relationships: [{
    id: "exploring", participantPersonIds: ["partner"], type: "romantic" as const, stage: "exploring" as const,
    status: "strained" as const, effectiveFromAgeInMonths: 540, source: "accepted_history" as const, confidence: 0.9
  }]
} }));
assert.equal(matchesRequiredContext("confirmed_romantic_connection", { ...contextInput, history: exploringHistory }), true);
assert.equal(matchesRequiredContext("confirmed_partner", { ...contextInput, history: exploringHistory }), false);
assert.equal(matchesRequiredContext("no_active_romantic_connection", { ...contextInput, history: exploringHistory }), false);

const longExploringHistory = Array.from({ length: 15 }, (_, index) => ({
  ...item(540 + index * 3, "career:continue_project", 55),
  worldStateSnapshot: exploringHistory[0].worldStateSnapshot
}));
assert.equal(matchesRequiredContext("confirmed_romantic_connection", {
  ...contextInput, age: 49, history: longExploringHistory
}), true);
assert.equal(hasExploringRelationshipForAtLeastMonths(
  longExploringHistory.at(-1)?.worldStateSnapshot,
  49,
  3
), true);

const datingStrainedHistory = history.map((entry) => ({ ...entry, worldStateSnapshot: {
  ...snapshot,
  relationships: [{
    id: "dating", participantPersonIds: ["partner"], type: "romantic" as const, stage: "dating" as const,
    status: "strained" as const, effectiveFromAgeInMonths: 540, source: "accepted_history" as const, confidence: 0.9
  }]
} }));
assert.equal(matchesRequiredContext("confirmed_partner", { ...contextInput, history: datingStrainedHistory }), true);

const endedHistory = history.map((entry) => ({ ...entry, worldStateSnapshot: {
  ...snapshot,
  relationships: [{
    id: "ended", participantPersonIds: ["partner"], type: "romantic" as const, stage: "separated" as const,
    status: "ended" as const, effectiveFromAgeInMonths: 540, source: "accepted_history" as const, confidence: 0.95
  }]
} }));
assert.equal(matchesRequiredContext("confirmed_romantic_connection", { ...contextInput, history: endedHistory }), false);
assert.equal(matchesRequiredContext("confirmed_partner", { ...contextInput, history: endedHistory }), false);
assert.equal(matchesRequiredContext("no_active_romantic_connection", { ...contextInput, history: endedHistory }), true);

const emptySnapshot: WorldStateSnapshot = { people: [], directionArcs: [], pressureArcs: [], relationships: [], version: 2 };
const familyNeutralHistory = [
  { ...item(360, "career:continue_project", 60), worldStateSnapshot: emptySnapshot }
];
assert.equal(matchesRequiredContext("confirmed_family", {
  ...contextInput,
  age: 30,
  history: familyNeutralHistory,
  userData: { currentSituation: "父母希望我留在本地工作。" }
}), true);
assert.equal(matchesRequiredContext("confirmed_family", {
  ...contextInput,
  age: 30,
  history: familyNeutralHistory,
  userData: {},
  answers: [{ answer: "我现在每月给父母 2000 元。" }]
}), true);
assert.equal(matchesRequiredContext("confirmed_family", {
  ...contextInput,
  age: 30,
  history: familyNeutralHistory,
  userData: { currentSituation: "考虑回老家发展。" }
}), false);
assert.equal(matchesRequiredContext("confirmed_family", {
  ...contextInput,
  age: 30,
  history: familyNeutralHistory,
  userData: { currentSituation: "家庭现金流最近比较紧张。" }
}), false);

const unselectedParentOption = {
  ...familyNeutralHistory[0],
  description: "工作项目进入稳定阶段。",
  selectedChoice: "继续推进事业",
  choices: [
    { id: "A", text: "继续推进事业", impactSummary: "保持方向" },
    { id: "B", text: "听从父母安排", impactSummary: "改变方向" }
  ]
};
assert.equal(matchesRequiredContext("confirmed_family", {
  ...contextInput,
  age: 30,
  history: [unselectedParentOption],
  userData: {}
}), false);

const proseOnlyParent = {
  ...familyNeutralHistory[0],
  description: "模型临时写道父母可能会担心。"
};
assert.equal(matchesRequiredContext("confirmed_family", {
  ...contextInput,
  age: 30,
  history: [proseOnlyParent],
  userData: {}
}), false);

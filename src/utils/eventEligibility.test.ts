import assert from "node:assert/strict";
import type { HistoryItem, LifeAttributes, WorldStateSnapshot } from "../types";
import {
  evaluateHistoryCondition,
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

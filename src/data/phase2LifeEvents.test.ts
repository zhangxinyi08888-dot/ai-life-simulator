import assert from "node:assert/strict";
import type { HistoryItem, LifeAttributes, SimulationChoice, SimulationNode, WorldStateSnapshot } from "../types";
import { evaluateDecisionGate } from "../utils/decisionGate";
import { evaluateEventEligibility } from "../utils/eventEligibility";
import { buildEventIntentPrompt } from "../utils/eventPrompt";
import { LIFE_EVENTS_DATABASE, buildEventMeta, getEventTemporalProfile, isLifeEventCandidateEligible, queryDynamicLifeEvent } from "./lifeEvents";

const PHASE2_IDS = [
  "career_gradual_transition_window", "career_scope_redefinition", "career_skill_compounding",
  "career_project_recognition", "career_long_project_completion", "career_sustainable_work_rhythm",
  "career_mentorship_reciprocity", "career_craft_meaning",
  "relationship_mutual_commitment_window", "relationship_release_and_reorientation",
  "relationship_shared_problem_solving", "relationship_trust_rebuilding", "relationship_boundary_aftercare",
  "relationship_family_responsibility_rebalanced", "relationship_daily_companionship",
  "relationship_friendship_deepening", "health_support_plan_choice", "health_recovery_progress",
  "health_function_return", "health_recovery_milestone", "health_sustainable_routine",
  "health_adapted_life_balance", "financial_resource_priority_choice", "financial_cautious_opportunity",
  "financial_emergency_buffer", "financial_debt_reduction_progress", "financial_income_stabilization",
  "financial_long_term_order", "financial_shared_household_plan", "self_new_direction_choice",
  "self_value_reorientation", "self_confidence_rebuilding", "self_skill_validation",
  "self_failure_becomes_method", "self_interest_becomes_practice", "self_daily_meaning",
  "self_long_term_creation"
] as const;

const expectedModes = {
  career_gradual_transition_window: "crossroads_opportunity",
  career_scope_redefinition: "crossroads_opportunity",
  career_skill_compounding: "recovery_growth",
  career_project_recognition: "recovery_growth",
  career_long_project_completion: "recovery_growth",
  career_sustainable_work_rhythm: "stability_meaning",
  career_mentorship_reciprocity: "stability_meaning",
  career_craft_meaning: "stability_meaning",
  relationship_mutual_commitment_window: "crossroads_opportunity",
  relationship_release_and_reorientation: "crossroads_opportunity",
  relationship_shared_problem_solving: "recovery_growth",
  relationship_trust_rebuilding: "recovery_growth",
  relationship_boundary_aftercare: "recovery_growth",
  relationship_family_responsibility_rebalanced: "recovery_growth",
  relationship_daily_companionship: "stability_meaning",
  relationship_friendship_deepening: "stability_meaning",
  health_support_plan_choice: "crossroads_opportunity",
  health_recovery_progress: "recovery_growth",
  health_function_return: "recovery_growth",
  health_recovery_milestone: "recovery_growth",
  health_sustainable_routine: "stability_meaning",
  health_adapted_life_balance: "stability_meaning",
  financial_resource_priority_choice: "crossroads_opportunity",
  financial_cautious_opportunity: "crossroads_opportunity",
  financial_emergency_buffer: "recovery_growth",
  financial_debt_reduction_progress: "recovery_growth",
  financial_income_stabilization: "recovery_growth",
  financial_long_term_order: "stability_meaning",
  financial_shared_household_plan: "stability_meaning",
  self_new_direction_choice: "crossroads_opportunity",
  self_value_reorientation: "crossroads_opportunity",
  self_confidence_rebuilding: "recovery_growth",
  self_skill_validation: "recovery_growth",
  self_failure_becomes_method: "recovery_growth",
  self_interest_becomes_practice: "stability_meaning",
  self_daily_meaning: "stability_meaning",
  self_long_term_creation: "stability_meaning"
} as const;

const expectedFamilies = {
  career_gradual_transition_window: "career_transition", career_scope_redefinition: "career_scope_change",
  career_skill_compounding: "career_skill_growth", career_project_recognition: "career_recognition",
  career_long_project_completion: "career_completion", career_sustainable_work_rhythm: "career_sustainable_rhythm",
  career_mentorship_reciprocity: "career_mentorship", career_craft_meaning: "career_craft_meaning",
  relationship_mutual_commitment_window: "relationship_commitment", relationship_release_and_reorientation: "relationship_release",
  relationship_shared_problem_solving: "relationship_cooperation", relationship_trust_rebuilding: "relationship_trust_repair",
  relationship_boundary_aftercare: "relationship_boundary_growth", relationship_family_responsibility_rebalanced: "family_responsibility_rebalance",
  relationship_daily_companionship: "relationship_companionship", relationship_friendship_deepening: "friendship_deepening",
  health_support_plan_choice: "health_support_plan", health_recovery_progress: "health_recovery_progress",
  health_function_return: "health_function_return", health_recovery_milestone: "health_recovery_closure",
  health_sustainable_routine: "health_sustainable_routine", health_adapted_life_balance: "health_adapted_balance",
  financial_resource_priority_choice: "financial_priority_choice", financial_cautious_opportunity: "financial_cautious_opportunity",
  financial_emergency_buffer: "financial_buffer_growth", financial_debt_reduction_progress: "financial_debt_recovery",
  financial_income_stabilization: "financial_income_stability", financial_long_term_order: "financial_long_term_order",
  financial_shared_household_plan: "financial_household_cooperation", self_new_direction_choice: "self_direction_choice",
  self_value_reorientation: "self_value_reorientation", self_confidence_rebuilding: "self_confidence_recovery",
  self_skill_validation: "self_skill_validation", self_failure_becomes_method: "self_failure_integration",
  self_interest_becomes_practice: "self_interest_practice", self_daily_meaning: "self_daily_meaning",
  self_long_term_creation: "self_long_term_creation"
} as const;

const expectedContexts: Record<string, string[][]> = {
  career_gradual_transition_window: [["career_active"], ["career_or_creation_direction"]],
  career_scope_redefinition: [["career_active"]], career_skill_compounding: [["career_or_creation_direction"]],
  career_project_recognition: [["career_or_creation_direction"]], career_long_project_completion: [["career_or_creation_direction"]],
  career_sustainable_work_rhythm: [["career_active"]], career_mentorship_reciprocity: [["career_active"]],
  career_craft_meaning: [["career_active"], ["career_or_creation_direction"]],
  relationship_mutual_commitment_window: [["confirmed_partner"]],
  relationship_release_and_reorientation: [["confirmed_partner"], ["confirmed_friend_or_colleague"]],
  relationship_shared_problem_solving: [["confirmed_partner"], ["confirmed_family"]],
  relationship_trust_rebuilding: [["confirmed_partner"], ["confirmed_friend_or_colleague"]],
  relationship_boundary_aftercare: [["confirmed_partner"], ["confirmed_family"], ["confirmed_friend_or_colleague"]],
  relationship_family_responsibility_rebalanced: [["confirmed_family"]],
  relationship_daily_companionship: [["confirmed_partner"], ["confirmed_family"]],
  relationship_friendship_deepening: [["confirmed_friend_or_colleague"]],
  health_support_plan_choice: [["health_recovery_context"]], health_recovery_progress: [["health_recovery_context"]],
  health_function_return: [["health_recovery_context"]], health_recovery_milestone: [["health_recovery_context"]],
  health_sustainable_routine: [], health_adapted_life_balance: [["health_recovery_context"]],
  financial_resource_priority_choice: [["financial_state_available"]],
  financial_cautious_opportunity: [["financial_state_available", "career_or_creation_direction"]],
  financial_emergency_buffer: [["financial_state_available"]],
  financial_debt_reduction_progress: [["financial_state_available", "debt_present"]],
  financial_income_stabilization: [["financial_state_available", "career_active"]],
  financial_long_term_order: [["financial_state_available"]],
  financial_shared_household_plan: [["financial_state_available", "confirmed_partner"], ["financial_state_available", "confirmed_family"]],
  self_new_direction_choice: [], self_value_reorientation: [], self_confidence_rebuilding: [],
  self_skill_validation: [["learning_or_creation_direction"]], self_failure_becomes_method: [],
  self_interest_becomes_practice: [["learning_or_creation_direction"]], self_daily_meaning: [],
  self_long_term_creation: [["learning_or_creation_direction"]]
};

const events = PHASE2_IDS.map((id) => LIFE_EVENTS_DATABASE.find((event) => event.id === id)!);
assert.equal(events.length, 37);
assert.equal(new Set(LIFE_EVENTS_DATABASE.map((event) => event.id)).size, LIFE_EVENTS_DATABASE.length);
assert.equal(LIFE_EVENTS_DATABASE.length, 51);
assert.equal(events.some((event) => event.category === "community"), false);
assert.deepEqual(events.map((event) => event.id), [...PHASE2_IDS]);
assert.deepEqual(events.reduce((counts, event) => {
  counts[event.narrativeMode] = (counts[event.narrativeMode] || 0) + 1;
  return counts;
}, {} as Record<string, number>), {
  crossroads_opportunity: 9,
  recovery_growth: 16,
  stability_meaning: 12
});

for (const event of events) {
  assert.ok(event);
  assert.equal(event.intent.type, event.id);
  assert.equal(event.narrativeMode, expectedModes[event.id as keyof typeof expectedModes]);
  assert.equal(event.semanticFamily, expectedFamilies[event.id as keyof typeof expectedFamilies]);
  assert.deepEqual(event.requiredContextGroups || [], expectedContexts[event.id]);
  assert.equal(event.dispatchMode, "random");
  assert.equal(event.fingerprint?.category, event.category);
  assert.deepEqual(event.fingerprint?.tags, event.tags);
  assert.equal(event.fingerprint?.intensity, "minor");
  assert.equal(event.intent.allowedOutcomes.length, 3);
  assert.equal(new Set(event.intent.allowedOutcomes).size, 3);
  assert.equal(event.ageAffinity?.minimumMultiplier, 0.4);
  assert.deepEqual(event.ageAffinity?.preferredRange, [event.minAge, event.maxAge]);
  assert.equal(event.intent.temporalProfile?.requiresFollowUp, false);
  if (event.narrativeMode === "recovery_growth") assert.ok(event.historyConditionGroups?.length);
  if (event.narrativeMode === "stability_meaning") assert.equal(getEventTemporalProfile(event).requiresFollowUp, false);
  assert.ok(event.intent.allowedOutcomes.some((outcome) => !/^(?:continue|maintain)_/.test(outcome)));

  const prompt = buildEventIntentPrompt(event);
  for (const outcome of event.intent.allowedOutcomes) assert.match(prompt, new RegExp(outcome));
  const candidateNode: SimulationNode = {
    age: 40, stage: "事件契约", title: event.title, description: event.intent.meaning,
    attributes: { happiness: 50, intelligence: 50, wealth: 50, relation: 50, health: 50 },
    choices: event.intent.allowedOutcomes.map((outcome, index) => ({
      id: String.fromCharCode(65 + index), text: `执行 ${outcome}`, impactSummary: "形成结果",
      decisionIntent: `${event.category}:${outcome}:current_event`, eventOutcomeId: outcome
    })),
    isEndingNode: false
  };
  const gate = evaluateDecisionGate({
    candidateNode, recentHistory: [], targetAgeInMonths: 480,
    allowedOutcomeIds: event.intent.allowedOutcomes, narrativeMode: event.narrativeMode
  });
  assert.equal(gate.isDecisionCheckpoint, true, `${event.id} generated outcome contract should pass`);
}

const attributes: LifeAttributes = { happiness: 55, intelligence: 62, wealth: 52, relation: 55, health: 55 };
const allContextText = "目前在公司从事产品工作并推进写作创作项目，希望转型；有伴侣、父母和孩子，需要共同生活、住房、家庭照护与医疗支出；此前遭遇失败、拒绝、异地距离、关系边界和信任冲突，正在学习摄影并储蓄还债，建立安全垫。";

function choice(intent: string): SimulationChoice {
  return { id: "A", text: `执行 ${intent}`, impactSummary: "持续行动", decisionIntent: intent };
}

function worldState(): WorldStateSnapshot {
  return {
    people: [
      { id: "partner", relation: "partner", lifeStatus: "active", source: "user_fact", confidence: 0.95 },
      { id: "parent", relation: "parent", lifeStatus: "active", source: "answer", confidence: 0.9 },
      { id: "friend", relation: "friend", lifeStatus: "active", source: "history", confidence: 0.85 }
    ],
    directionArcs: [{
      id: "creation", directionType: "career_creation_project",
      summary: "持续推进写作、产品和摄影创作项目", status: "active",
      startedAtAgeInMonths: 540, userReinforcementCount: 4, establishedAssets: ["作品"]
    }],
    pressureArcs: [
      { id: "health", eventId: "health_forced_pause", eventIntentType: "health_forced_pause", phasePolicyId: "health_crisis_v1", phaseId: "recovery", status: "stabilizing", startedAtAgeInMonths: 540, phaseStartedAtAgeInMonths: 552, phaseCheckpointCount: 1, totalCheckpointCount: 2, unresolvedSummary: "恢复中" },
      { id: "resolved", eventId: "career_pressure", eventIntentType: "career_pressure", phasePolicyId: "generic_pressure_v1", phaseId: "operation", status: "resolved", startedAtAgeInMonths: 500, phaseStartedAtAgeInMonths: 530, phaseCheckpointCount: 2, totalCheckpointCount: 3, unresolvedSummary: "已收束" }
    ],
    careerSummary: "在职并持续推进项目",
    relationshipSummary: "伴侣和家庭关系明确",
    version: 1
  };
}

function satisfyingHistory(event: typeof events[number]): HistoryItem[] {
  const group = event.historyConditionGroups?.[0] || [];
  const intentCondition = group.find((condition) => condition.type === "selected_intent_count");
  const intent = intentCondition?.type === "selected_intent_count" ? intentCondition.intentPrefixes[0] : (
    event.id.includes("health") ? "health:reduce_load" :
      event.id.includes("financial") ? "financial:save" :
        event.id.includes("relationship") ? "relationship:communicate" :
          event.id.includes("career") ? "career:practice" : "growth:learn"
  );
  const count = Math.max(12, intentCondition?.type === "selected_intent_count" ? intentCondition.minCount : 1);
  const history: HistoryItem[] = Array.from({ length: count }, (_, index) => ({
    age: 46 + index * 0.25,
    ageInMonths: 552 + index * 3,
    stage: "持续推进",
    title: "现实行动与调整",
    description: `${allContextText} 项目已有组织、团队和协作者，出现责任分工、成果署名和行业变化；家庭提出照护请求；关系长期不匹配并持续沟通；健康治疗减负后逐渐恢复。`,
    selectedChoice: `执行 ${intent}`,
    selectedDecisionIntent: intent,
    attributes: {
      ...attributes,
      happiness: index === 0 ? 52 : 55,
      intelligence: event.id === "career_project_recognition" ? 62 : (index === 0 ? 56 : 62),
      relation: 55,
      health: index === 0 ? 45 : 55
    },
    financialState: {
      currencyUnit: "CNY_WAN_REAL", asOfAgeInMonths: 552 + index * 3,
      cashWan: 5 + index, investmentAssetsWan: 1, propertyMarketValueWan: 0,
      businessAndOtherAssetsWan: 0, totalDebtWan: 20 - index * 0.5,
      netWorthWan: -14 + index * 1.5, annualAfterTaxIncomeWan: 12,
      annualDisposableIncomeWan: 4, annualCoreExpenseWan: 8,
      incomeStability: index === 0 ? "volatile" : "stable", isEstimated: false
    },
    choices: [choice(intent)],
    isEndingNode: false,
    narrativeMeta: {
      elapsedMonths: 3, elapsedYears: 0.25, lifeIntensity: "normal", nodeMateriality: "decision_checkpoint",
      storyEpisode: { id: `episode_${index}`, startAgeInMonths: 549 + index * 3, endAgeInMonths: 552 + index * 3, internalTransitions: [], decisionCheckpointId: `checkpoint_${index}`, summary: "持续行动" },
      recoveryState: index >= count - 2 ? "protected" : "neutral", recoveryEvidence: ["负荷下降"], arcSignals: [], activeCharacters: [],
      primaryActivity: { domain: "career", intensity: "moderate" }, worldDeltas: []
    },
    worldStateSnapshot: worldState()
  }));

  for (const condition of group) {
    if (condition.type === "elapsed_since_event") {
      history[0].eventMeta = {
        eventId: condition.eventIds?.[0] || "supporting_event",
        eventCategory: event.category,
        eventTags: ["supporting"],
        eventIntensity: "minor",
        eventSemanticFamily: condition.semanticFamilies?.[0]
      };
      history[0].age = 45;
      history[0].ageInMonths = 540 - Math.max(condition.minMonths, 18);
    }
    if (condition.type === "recent_mode_count") {
      for (let index = 0; index < condition.minCount; index += 1) {
        history[history.length - 1 - index].eventMeta = {
          eventId: `mode_${index}`, eventCategory: "growth", eventTags: ["mode"], eventMode: condition.modes[0]
        };
      }
    }
    if (condition.type === "attribute_trend") {
      const target = history[Math.max(0, history.length - condition.withinNodes)];
      const minimum = condition.minimumDelta ?? 1;
      target.attributes = {
        ...target.attributes,
        [condition.attribute]: condition.direction === "improving"
          ? attributes[condition.attribute] - minimum
          : condition.direction === "declining"
            ? attributes[condition.attribute] + minimum
            : attributes[condition.attribute]
      };
    }
    if (condition.type === "pressure_arc_state") {
      const latest = history.at(-1)!;
      const snapshot = latest.worldStateSnapshot!;
      snapshot.pressureArcs.push({
        id: "matching_arc",
        eventId: "matching_event",
        eventIntentType: "matching_event",
        phasePolicyId: condition.phasePolicyIds?.[0] || "generic_pressure_v1",
        phaseId: condition.phaseIds?.[0] || "operation",
        status: condition.statuses?.[0] || "active",
        startedAtAgeInMonths: 500,
        phaseStartedAtAgeInMonths: 550,
        phaseCheckpointCount: 1,
        totalCheckpointCount: 2,
        unresolvedSummary: "结构化状态证据"
      });
    }
  }
  return history;
}

for (const event of events) {
  if (event.requiredContextGroups?.length) {
    assert.equal(isLifeEventCandidateEligible(event, attributes, {}, 50, []), false, `${event.id} should require context`);
  }
  const history = satisfyingHistory(event);
  if (event.historyConditionGroups?.length) {
    assert.equal(evaluateEventEligibility({
      event, attribs: attributes, userData: { currentSituation: allContextText }, age: 50, history,
      answers: [{ answer: allContextText }]
    }), true, `${event.id} history conditions should be reachable`);
  }
}

const unknownRelationshipHistory = satisfyingHistory(events[0]);
unknownRelationshipHistory.forEach((item) => {
  item.worldStateSnapshot = { ...worldState(), people: [{ id: "guess", relation: "partner", lifeStatus: "unknown", source: "model_inferred", confidence: 0.55 }] };
});
const commitmentEvent = LIFE_EVENTS_DATABASE.find((event) => event.id === "relationship_mutual_commitment_window")!;
assert.equal(isLifeEventCandidateEligible(commitmentEvent, attributes, {}, 50, unknownRelationshipHistory), false);

const debtEvent = LIFE_EVENTS_DATABASE.find((event) => event.id === "financial_debt_reduction_progress")!;
const noDebtHistory = satisfyingHistory(debtEvent).map((item) => ({
  ...item,
  financialState: item.financialState ? { ...item.financialState, totalDebtWan: 0 } : undefined
}));
assert.equal(isLifeEventCandidateEligible(debtEvent, attributes, { currentSituation: allContextText }, 50, noDebtHistory), false);

const recoveryEvent = LIFE_EVENTS_DATABASE.find((event) => event.id === "health_recovery_progress")!;
assert.equal(isLifeEventCandidateEligible(recoveryEvent, attributes, {}, 50, []), false);

const legacyContracts = {
  career_venture_pressure: {
    contexts: [["career_or_creation_direction"]],
    outcomes: ["run_limited_venture_pilot", "stay_lean_and_preserve_optionality", "commit_to_high_risk_leap"]
  },
  career_responsibility_shift: {
    contexts: [["career_active"]],
    outcomes: ["accept_limited_responsibility", "draw_explicit_responsibility_boundary", "seek_rule_based_mediation"]
  },
  career_structural_instability: {
    contexts: [["career_active"]],
    outcomes: ["stabilize_immediate_cashflow", "invest_in_gradual_transition", "activate_verified_network_support"]
  },
  career_credit_ownership_conflict: {
    contexts: [["active_project_context"]],
    outcomes: ["document_and_negotiate_ownership", "challenge_credit_capture_formally", "preserve_core_work_and_exit"]
  },
  relationship_material_commitment_test: {
    contexts: [["confirmed_partner"]],
    outcomes: ["make_shared_commitment_plan", "delay_with_clear_conditions", "reassess_relationship_fit"]
  },
  relationship_family_obligation_pull: {
    contexts: [["confirmed_family"]],
    outcomes: ["offer_bounded_family_support", "set_firm_family_boundary", "renegotiate_family_support_terms"]
  },
  relationship_trust_interest_fracture: {
    contexts: [["confirmed_partner"], ["confirmed_friend_or_colleague"]],
    outcomes: ["verify_issue_and_set_safeguards", "attempt_bounded_trust_repair", "end_shared_interest_arrangement"]
  },
  opportunity_unstable_alliance: {
    contexts: [["career_or_creation_direction"]],
    outcomes: ["run_small_alliance_pilot", "decline_for_current_stability", "join_with_explicit_exit_conditions"]
  },
  opportunity_escape_route: {
    contexts: [["identified_life_constraint"]],
    outcomes: ["test_escape_route_temporarily", "stay_and_repair_current_structure", "decline_route_and_seek_another_option"]
  },
  financial_side_path_conflict: {
    contexts: [["financial_state_available", "career_or_creation_direction"]],
    outcomes: ["run_compliant_side_income_pilot", "clarify_rules_before_committing", "decline_and_protect_core_income"]
  },
  life_normal_transition: {
    contexts: [],
    outcomes: ["maintain_current_rhythm", "make_one_small_adjustment", "strengthen_one_existing_direction_or_relationship"]
  }
} as const;

for (const [eventId, contract] of Object.entries(legacyContracts)) {
  const event = LIFE_EVENTS_DATABASE.find((candidate) => candidate.id === eventId)!;
  assert.deepEqual(event.requiredContextGroups || [], contract.contexts);
  assert.deepEqual(event.intent.allowedOutcomes, contract.outcomes);
}

const lowHappinessOnly: LifeAttributes = { ...attributes, happiness: 20 };
assert.equal(isLifeEventCandidateEligible(
  LIFE_EVENTS_DATABASE.find((event) => event.id === "opportunity_escape_route")!,
  lowHappinessOnly, {}, 40, []
), false);
const highIntelligenceOnly: LifeAttributes = { ...attributes, intelligence: 95 };
assert.equal(isLifeEventCandidateEligible(
  LIFE_EVENTS_DATABASE.find((event) => event.id === "career_credit_ownership_conflict")!,
  highIntelligenceOnly, {}, 40, []
), false);
assert.equal(isLifeEventCandidateEligible(
  LIFE_EVENTS_DATABASE.find((event) => event.id === "career_project_recognition")!,
  highIntelligenceOnly, {}, 40, []
), false);
assert.equal(isLifeEventCandidateEligible(
  LIFE_EVENTS_DATABASE.find((event) => event.id === "career_structural_instability")!,
  { ...attributes, wealth: 10 }, {}, 40, []
), false);
assert.equal(isLifeEventCandidateEligible(
  LIFE_EVENTS_DATABASE.find((event) => event.id === "career_responsibility_shift")!,
  attributes, {}, 40, []
), false);

for (const eventId of ["relationship_daily_companionship", "health_sustainable_routine", "self_interest_becomes_practice"]) {
  const event = LIFE_EVENTS_DATABASE.find((candidate) => candidate.id === eventId)!;
  assert.equal(isLifeEventCandidateEligible(
    event,
    attributes,
    { currentSituation: "已婚，与伴侣共同生活；长期坚持写作和摄影创作。" },
    82,
    satisfyingHistory(event)
  ), true, `${eventId} should remain future-facing and eligible after age 80`);
}

const transitionEvent = LIFE_EVENTS_DATABASE.find((event) => event.id === "career_gradual_transition_window")!;
const semanticCooldownHistory = satisfyingHistory(transitionEvent).slice(-1);
semanticCooldownHistory[0].eventMeta = buildEventMeta(transitionEvent);
for (const randomValue of [0, 0.2, 0.5, 0.8, 0.999]) {
  const original = Math.random;
  Math.random = () => randomValue;
  try {
    const selected = queryDynamicLifeEvent(attributes, { currentSituation: allContextText }, 50, semanticCooldownHistory);
    assert.notEqual(selected?.semanticFamily, "career_transition");
  } finally {
    Math.random = original;
  }
}

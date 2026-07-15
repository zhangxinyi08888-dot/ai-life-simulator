import assert from "node:assert/strict";
import { HistoryItem, LifeAttributes, RecoveryState } from "../types";
import { buildEventMeta, calculateAgeAffinityMultiplier, calculateEventSelectionWeight, getEventTemporalProfile, isEventAgeEligible, LIFE_EVENTS_DATABASE, queryDynamicLifeEvent, queryHealthEscalationEvent } from "./lifeEvents";

const lowHealth: LifeAttributes = {
  happiness: 45,
  intelligence: 50,
  wealth: 50,
  relation: 50,
  health: 30
};

const stableAttributes: LifeAttributes = {
  happiness: 58,
  intelligence: 55,
  wealth: 55,
  relation: 52,
  health: 60
};

function historyItem(eventMeta: HistoryItem["eventMeta"]): HistoryItem {
	  return {
	    age: 52,
	    title: "身体亮起红灯",
	    stage: "中年困顿期",
    description: "这一段历史的标题和正文都不是事件标题。",
    selectedChoice: "接受停顿",
    attributes: lowHealth,
    choices: [{ id: "A", text: "接受停顿", impactSummary: "暂缓脚步" }],
    isEndingNode: false,
    eventMeta
  };
}

function healthTrendItem(health: number, eventId?: string, recoveryState: RecoveryState = "depleted"): HistoryItem {
  return {
    ...historyItem(eventId ? {
      eventId,
      eventCategory: "health",
      eventTags: eventId === "health_forced_pause"
        ? ["health", "forced_pause", "major_crisis"]
        : ["health", "burnout", "system_warning"]
    } : undefined),
    attributes: { ...lowHealth, health },
    narrativeMeta: { recoveryState } as HistoryItem["narrativeMeta"]
  };
}

assert.notEqual(
  queryDynamicLifeEvent(lowHealth, {}, 55, [
    historyItem({
      eventId: "health_life_accident_lesson",
      eventCategory: "health",
      eventTags: ["health", "major_crisis", "forced_pause"]
    })
  ])?.id,
  "health_life_accident_lesson"
);

assert.notEqual(
  queryDynamicLifeEvent(lowHealth, {}, 55, [
    historyItem({
      eventCategory: "health",
      eventTags: ["health", "major_crisis", "forced_pause"]
    })
  ])?.id,
  "health_life_accident_lesson"
);

assert.ok(LIFE_EVENTS_DATABASE.every((event) => event.intent));
assert.ok(LIFE_EVENTS_DATABASE.every((event) => event.trigger?.eligibility));
assert.ok(LIFE_EVENTS_DATABASE.every((event) => !("conceptPrompt" in event)));
assert.ok(LIFE_EVENTS_DATABASE.every((event) => !("promptSeed" in event)));
assert.ok(LIFE_EVENTS_DATABASE.every((event) => !("check" in event)));

const randomHealthEvents = LIFE_EVENTS_DATABASE.filter((event) => event.category === "health" && event.dispatchMode !== "arc_only");
const forcedPauseEvent = LIFE_EVENTS_DATABASE.find((event) => event.id === "health_forced_pause");
const healthWarningEvent = LIFE_EVENTS_DATABASE.find((event) => event.id === "health_system_warning");
assert.deepEqual(randomHealthEvents.map((event) => event.id), ["health_system_warning"]);
assert.equal(forcedPauseEvent?.dispatchMode, "arc_only");
assert.equal(healthWarningEvent && buildEventMeta(healthWarningEvent).eventIntensity, "minor");
assert.equal(healthWarningEvent?.intent.emotionalTone, "pressure");
assert.deepEqual(healthWarningEvent?.intent.allowedOutcomes, [
  "maintain_current_load_with_monitoring",
  "continue_goal_with_adjusted_execution",
  "pause_or_seek_professional_support"
]);
assert.deepEqual(forcedPauseEvent?.intent.allowedOutcomes, [
  "continue_despite_medical_risk",
  "continue_with_restricted_capacity",
  "pause_for_treatment_and_recovery"
]);
assert.deepEqual(healthWarningEvent && getEventTemporalProfile(healthWarningEvent), {
  lifeIntensity: "normal",
  durationMonths: [3, 9],
  requiresFollowUp: false
});
assert.equal(forcedPauseEvent && buildEventMeta(forcedPauseEvent).eventIntensity, "major");
assert.equal(forcedPauseEvent?.intent.emotionalTone, "crisis");
assert.equal(forcedPauseEvent && getEventTemporalProfile(forcedPauseEvent).requiresFollowUp, true);
assert.equal(healthWarningEvent?.trigger.eligibility(
  { happiness: 25, intelligence: 50, wealth: 50, relation: 50, health: 60 },
  {},
  30
), false);
assert.equal(forcedPauseEvent?.trigger.eligibility(
  { happiness: 25, intelligence: 50, wealth: 50, relation: 50, health: 60 },
  {},
  30
), false);
assert.equal(queryHealthEscalationEvent(
  { happiness: 25, intelligence: 50, wealth: 50, relation: 50, health: 60 },
  []
), null);
assert.equal(healthWarningEvent?.trigger.eligibility(
  { happiness: 80, intelligence: 50, wealth: 50, relation: 50, health: 41 },
  {},
  30
), true);

assert.equal(queryHealthEscalationEvent(
  { ...lowHealth, health: 29 },
  []
)?.id, "health_forced_pause");

const decliningAfterWarning = [
  healthTrendItem(45, "health_system_warning"),
  healthTrendItem(41),
  healthTrendItem(36)
];
assert.equal(queryHealthEscalationEvent(
  { ...lowHealth, health: 36 },
  decliningAfterWarning
)?.id, "health_forced_pause");

assert.equal(queryHealthEscalationEvent(
  { ...lowHealth, health: 36 },
  [healthTrendItem(45, "health_system_warning"), healthTrendItem(35), healthTrendItem(36)]
), null);
assert.equal(queryHealthEscalationEvent(
  { ...lowHealth, health: 37 },
  [healthTrendItem(44, "health_system_warning"), healthTrendItem(40), healthTrendItem(37)]
), null);
assert.equal(queryHealthEscalationEvent(
  { ...lowHealth, health: 36 },
  [healthTrendItem(45, "health_system_warning"), healthTrendItem(41, undefined, "neutral"), healthTrendItem(36)]
), null);
assert.equal(queryHealthEscalationEvent(
  { ...lowHealth, health: 29 },
  [healthTrendItem(45), healthTrendItem(36, "health_forced_pause"), healthTrendItem(29)]
), null);

const ventureEvent = LIFE_EVENTS_DATABASE.find((event) => event.id === "career_venture_pressure");
assert.ok(ventureEvent);
assert.equal(isEventAgeEligible(ventureEvent, 70), true);
assert.equal(isEventAgeEligible(ventureEvent, 15), false);
assert.equal(calculateAgeAffinityMultiplier(70, { preferredRange: [22, 45], minimumMultiplier: 0.4, outsideRangeAdaptations: [] }), 0.4);
assert.equal(calculateAgeAffinityMultiplier(70, { preferredRange: [22, 45], minimumMultiplier: 0.4, outsideRangeAdaptations: [] }, true), 1);

const selected = queryDynamicLifeEvent(lowHealth, {}, 55, []);
assert.notEqual(selected?.id, "life_normal_transition");
assert.ok(selected === null || selected.intent);
assert.notEqual(selected?.id, "health_forced_pause");

const similarBlocked = queryDynamicLifeEvent(lowHealth, {}, 55, [
  historyItem({
    eventId: "health_system_warning",
    eventCategory: "health",
    eventTags: ["health", "burnout", "instability"]
  })
]);
assert.notEqual(similarBlocked?.id, "health_system_warning");
assert.notEqual(similarBlocked?.intent.type, "health_system_warning");

const relationshipEvent = LIFE_EVENTS_DATABASE.find((event) => event.category === "relationship");
const careerEvent = LIFE_EVENTS_DATABASE.find((event) => event.category === "career");
assert.ok(relationshipEvent);
assert.ok(careerEvent);
assert.ok(
  calculateEventSelectionWeight(relationshipEvent, { coreStoryFocus: "romance" })
    > calculateEventSelectionWeight(relationshipEvent, { coreStoryFocus: "career" })
);
assert.ok(
  calculateEventSelectionWeight(careerEvent, { coreStoryFocus: "career" })
    > calculateEventSelectionWeight(careerEvent, { coreStoryFocus: "romance" })
);

const originalRandom = Math.random;
Math.random = () => 0.99;
try {
  const romanceFallbackEvent = queryDynamicLifeEvent(
    { happiness: 43, intelligence: 40, wealth: 30, relation: 45, health: 60 },
    {
      coreStoryFocus: "romance",
      milestoneRelationship: "有一段异地恋，因为城市选择分开。"
    },
    28,
    []
  );
  assert.equal(romanceFallbackEvent?.category, "relationship");
} finally {
  Math.random = originalRandom;
}

Math.random = () => 0.99;
try {
  const answerRelationshipEvent = queryDynamicLifeEvent(
    { happiness: 43, intelligence: 40, wealth: 30, relation: 45, health: 60 },
    { coreStoryFocus: "career" },
    28,
    [],
    [
      {
        id: 1,
        question: "当时最重要的人是谁？",
        answer: "我和前任还保持联系，异地恋这件事一直悬着。"
      }
    ]
  );
  assert.equal(answerRelationshipEvent?.category, "relationship");
} finally {
  Math.random = originalRandom;
}

const categoryLimitedEvent = queryDynamicLifeEvent(
  { happiness: 52, intelligence: 50, wealth: 42, relation: 65, health: 55 },
  {},
  45,
  [
    historyItem({ eventId: "health_a", eventCategory: "health", eventTags: ["health", "minor"] }),
    historyItem({ eventId: "health_b", eventCategory: "health", eventTags: ["health", "minor"] })
  ]
);
assert.notEqual(categoryLimitedEvent?.category, "health");

const stableEvent = queryDynamicLifeEvent(stableAttributes, {}, 45, [
  historyItem({
    eventId: "career_structural_layoff",
    eventCategory: "career",
    eventTags: ["career", "major_crisis"]
  })
]);
assert.ok(stableEvent === null || stableEvent.id === "life_normal_transition");

import assert from "node:assert/strict";
import { HistoryItem, LifeAttributes } from "../types";
import { calculateEventSelectionWeight, LIFE_EVENTS_DATABASE, queryDynamicLifeEvent } from "./lifeEvents";

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
    eventMeta
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

const selected = queryDynamicLifeEvent(lowHealth, {}, 55, []);
assert.notEqual(selected?.id, "life_normal_transition");
assert.ok(selected === null || selected.intent);

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

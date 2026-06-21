import assert from "node:assert/strict";
import { HistoryItem, LifeAttributes } from "../types";
import { queryDynamicLifeEvent } from "./lifeEvents";

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

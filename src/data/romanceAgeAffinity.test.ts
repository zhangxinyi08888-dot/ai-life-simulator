import assert from "node:assert/strict";
import test from "node:test";
import { calculateAgeAffinityMultiplier, calculateEventSelectionWeight, LIFE_EVENTS_DATABASE } from "./lifeEvents";

const affinity = {
  preferredRange: [18, 100] as [number, number],
  minimumMultiplier: 0.25,
  outsideRangeAdaptations: []
};

test("romance formation uses a piecewise soft age curve without excluding late life", () => {
  assert.equal(calculateAgeAffinityMultiplier(18, affinity, false, "romance_formation_age_v1"), 1.15);
  assert.equal(calculateAgeAffinityMultiplier(25, affinity, false, "romance_formation_age_v1"), 1.25);
  assert.equal(calculateAgeAffinityMultiplier(30, affinity, false, "romance_formation_age_v1"), 1);
  assert.equal(calculateAgeAffinityMultiplier(40, affinity, false, "romance_formation_age_v1"), 0.75);
  assert.equal(calculateAgeAffinityMultiplier(50, affinity, false, "romance_formation_age_v1"), 0.45);
  assert.equal(calculateAgeAffinityMultiplier(70, affinity, false, "romance_formation_age_v1"), 0.25);
  assert.equal(calculateAgeAffinityMultiplier(70, affinity, true, "romance_formation_age_v1"), 1);
  assert.equal(calculateAgeAffinityMultiplier(25, affinity, true, "romance_formation_age_v1"), 1.25);
});

test("romance age affinity can roll back independently and explicit direction restores full weight", () => {
  const event = LIFE_EVENTS_DATABASE.find((candidate) => candidate.id === "romance_new_connection")!;
  const lateDefault = calculateEventSelectionWeight(event, {}, 70, false, true);
  const lateDirected = calculateEventSelectionWeight(event, {}, 70, true, true);
  const disabled = calculateEventSelectionWeight(event, {}, 70, false, false);
  assert.equal(lateDefault / lateDirected, 0.25);
  assert.equal(disabled, lateDirected);
  assert.ok(lateDefault > 0);
});

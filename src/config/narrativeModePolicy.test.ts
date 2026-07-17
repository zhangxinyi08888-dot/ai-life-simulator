import assert from "node:assert/strict";
import type { HistoryItem, LifeAttributes, NarrativeMode } from "../types";
import {
  DEFAULT_MODE_WEIGHTS,
  applyModeFatigue,
  computeModeWeights,
  pickModeByWeight,
  zeroUnavailableModeWeights
} from "./narrativeModePolicy";

const attributes: LifeAttributes = {
  happiness: 50,
  intelligence: 50,
  wealth: 50,
  relation: 50,
  health: 50
};

function eventItem(
  mode: NarrativeMode,
  options: { major?: boolean; selectedChoice?: string; decisionIntent?: string } = {}
): HistoryItem {
  const selectedChoice = options.selectedChoice || "维持当前节奏";
  return {
    age: 35,
    title: "测试事件",
    stage: "人生阶段",
    description: "用于验证叙事模式策略。",
    selectedChoice,
    attributes,
    choices: [{
      id: "A",
      text: selectedChoice,
      impactSummary: "测试",
      decisionIntent: options.decisionIntent
    }],
    isEndingNode: false,
    eventMeta: {
      eventId: `event_${mode}`,
      eventCategory: "growth",
      eventTags: options.major ? ["major_crisis"] : ["test"],
      eventIntensity: options.major ? "major" : "minor",
      eventMode: mode,
      eventSemanticFamily: `family_${mode}`
    }
  };
}

assert.deepEqual(computeModeWeights(attributes, []), DEFAULT_MODE_WEIGHTS);

const twoPressureWeights = computeModeWeights(attributes, [
  eventItem("pressure_crisis"),
  eventItem("pressure_crisis")
]);
assert.equal(twoPressureWeights.pressure_crisis, DEFAULT_MODE_WEIGHTS.pressure_crisis * 0.15);
assert.equal(twoPressureWeights.recovery_growth, DEFAULT_MODE_WEIGHTS.recovery_growth * 1.8);
assert.equal(twoPressureWeights.stability_meaning, DEFAULT_MODE_WEIGHTS.stability_meaning * 1.6);

const majorWeights = computeModeWeights(attributes, [eventItem("pressure_crisis", { major: true })]);
assert.equal(majorWeights.pressure_crisis, DEFAULT_MODE_WEIGHTS.pressure_crisis * 0.1);
assert.equal(majorWeights.recovery_growth, DEFAULT_MODE_WEIGHTS.recovery_growth * 2);
assert.equal(majorWeights.stability_meaning, DEFAULT_MODE_WEIGHTS.stability_meaning * 1.8);

const stableWeights = computeModeWeights(
  { ...attributes, happiness: 55, wealth: 50, health: 55 },
  []
);
assert.equal(stableWeights.pressure_crisis, DEFAULT_MODE_WEIGHTS.pressure_crisis * 0.75);
assert.equal(stableWeights.recovery_growth, DEFAULT_MODE_WEIGHTS.recovery_growth * 1.2);
assert.equal(stableWeights.stability_meaning, DEFAULT_MODE_WEIGHTS.stability_meaning * 1.25);

const focusedWeights = computeModeWeights(attributes, [], { coreStoryFocus: "innerpeace" });
assert.equal(focusedWeights.pressure_crisis, DEFAULT_MODE_WEIGHTS.pressure_crisis * 0.75);
assert.equal(focusedWeights.recovery_growth, DEFAULT_MODE_WEIGHTS.recovery_growth * 1.35);
assert.equal(focusedWeights.stability_meaning, DEFAULT_MODE_WEIGHTS.stability_meaning * 1.3);

const highRiskWeights = computeModeWeights(attributes, [
  eventItem("stability_meaning", { selectedChoice: "抓住机会", decisionIntent: "career:take_high_risk_leap" })
]);
assert.equal(highRiskWeights.crossroads_opportunity, DEFAULT_MODE_WEIGHTS.crossroads_opportunity * 1.35);
assert.equal(highRiskWeights.pressure_crisis, DEFAULT_MODE_WEIGHTS.pressure_crisis * 1.25);
assert.equal(highRiskWeights.stability_meaning, DEFAULT_MODE_WEIGHTS.stability_meaning * 0.8);

const availableOnly = zeroUnavailableModeWeights(DEFAULT_MODE_WEIGHTS, new Set([
  "pressure_crisis",
  "stability_meaning"
]));
assert.deepEqual(availableOnly, {
  pressure_crisis: 0.18,
  crossroads_opportunity: 0,
  recovery_growth: 0,
  stability_meaning: 0.32
});
assert.ok(["pressure_crisis", "stability_meaning"].includes(pickModeByWeight(availableOnly, 0.5)!));
assert.equal(pickModeByWeight({
  pressure_crisis: 0,
  crossroads_opportunity: 0,
  recovery_growth: 0,
  stability_meaning: 0
}, 0.5), null);

const fatigued = applyModeFatigue(DEFAULT_MODE_WEIGHTS, [
  eventItem("pressure_crisis"),
  eventItem("pressure_crisis")
]);
const fatiguedTotal = Object.values(fatigued).reduce((sum, value) => sum + value, 0);
assert.ok(fatigued.pressure_crisis / fatiguedTotal <= 0.1);

const postMajor = applyModeFatigue(DEFAULT_MODE_WEIGHTS, [eventItem("pressure_crisis", { major: true })]);
assert.equal(postMajor.pressure_crisis, 0);

const noRecoveryOrStability = applyModeFatigue({
  pressure_crisis: 0.18,
  crossroads_opportunity: 0.24,
  recovery_growth: 0,
  stability_meaning: 0
}, [eventItem("pressure_crisis", { major: true })]);
assert.equal(noRecoveryOrStability.pressure_crisis, 0.18);

assert.equal(pickModeByWeight(DEFAULT_MODE_WEIGHTS, 0), "pressure_crisis");
assert.equal(pickModeByWeight(DEFAULT_MODE_WEIGHTS, 0.18), "pressure_crisis");
assert.equal(pickModeByWeight(DEFAULT_MODE_WEIGHTS, 0.180001), "crossroads_opportunity");
assert.equal(pickModeByWeight(DEFAULT_MODE_WEIGHTS, 0.999999), "stability_meaning");


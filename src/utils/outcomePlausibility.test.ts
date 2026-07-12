import assert from "node:assert/strict";
import { evaluateOutcomePlausibility } from "./outcomePlausibility";
import { HistoryItem, PersonState, SimulationNode, WorldDelta } from "../types";

const node = (description: string): SimulationNode => ({
  age: 50,
  ageInMonths: 600,
  stage: "关系选择",
  title: "共同决定",
  description,
  choices: [
    { id: "A", text: "继续推进", impactSummary: "共同生活" },
    { id: "B", text: "保持现状", impactSummary: "稳步相处" },
    { id: "C", text: "重新评估", impactSummary: "审视关系" }
  ],
  attributes: { happiness: 60, intelligence: 70, wealth: 60, relation: 70, health: 60 },
  isEndingNode: false
});
const relationshipHistory: HistoryItem[] = [{
  age: 48,
  title: "长期伴侣",
  stage: "稳定关系",
  description: "你与伴侣共同生活多年，开始讨论未来安排。",
  selectedChoice: "继续经营关系",
  choices: [],
  attributes: { happiness: 60, intelligence: 70, wealth: 60, relation: 70, health: 60 },
  isEndingNode: false
}];

const lateMarriage = evaluateOutcomePlausibility({
  candidateNode: node("50岁时，你与长期伴侣决定结婚领证。"),
  worldDeltas: [],
  userData: {},
  history: relationshipHistory,
  people: [],
  targetAgeInMonths: 600
});
assert.equal(lateMarriage.tier, "uncommon");
assert.equal(lateMarriage.supportingFacts.length > 0, true);
assert.equal(lateMarriage.requiresExplicitBasis, false);

const compressedLateMarriage = evaluateOutcomePlausibility({
  candidateNode: node("50岁时，你与交往多年的长期伴侣决定结婚领证。"),
  worldDeltas: [],
  userData: {},
  history: [],
  people: [],
  targetAgeInMonths: 600
});
assert.equal(compressedLateMarriage.tier, "uncommon");
assert.equal(compressedLateMarriage.supportingFacts.length, 1);

const partner: PersonState = {
  id: "family_partner",
  relation: "partner",
  explicitAge: 52,
  lifeStatus: "active",
  source: "history",
  confidence: 0.9
};
const pregnancyDelta: WorldDelta = {
  type: "process_started",
  process: {
    id: "pregnancy_late",
    type: "pregnancy",
    subjectPersonIds: ["family_partner"],
    status: "active",
    startedAtAgeInMonths: 600,
    expectedEndAgeInMonths: 609,
    lastUpdatedAtAgeInMonths: 600,
    source: "model_proposed",
    confidence: 0.8
  }
};
const unsupported = evaluateOutcomePlausibility({
  candidateNode: node("妻子确认怀孕，家庭开始准备。"),
  worldDeltas: [pregnancyDelta],
  userData: {},
  history: [],
  people: [partner],
  targetAgeInMonths: 600
});
assert.equal(unsupported.tier, "exceptional");
assert.equal(unsupported.supportingFacts.length, 0);

const supported = evaluateOutcomePlausibility({
  candidateNode: node("妻子在生殖医学团队长期治疗和医疗评估后确认怀孕。"),
  worldDeltas: [pregnancyDelta],
  userData: {},
  history: [],
  people: [partner],
  targetAgeInMonths: 600
});
assert.equal(supported.tier, "exceptional");
assert.equal(supported.supportingFacts.length, 1);

const ordinaryPregnancy = evaluateOutcomePlausibility({
  candidateNode: node("妻子确认怀孕，家庭开始准备。"),
  worldDeltas: [pregnancyDelta],
  userData: {},
  history: [],
  people: [{ ...partner, explicitAge: 35 }],
  targetAgeInMonths: 600
});
assert.equal(ordinaryPregnancy.tier, "ordinary");

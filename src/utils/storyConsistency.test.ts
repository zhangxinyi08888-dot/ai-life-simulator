import assert from "node:assert/strict";
import { SimulationNode } from "../types";
import { containsForbiddenArcWrite, validateStoryConsistency } from "./storyConsistency";

const node: SimulationNode = {
  age: 82,
  ageInMonths: 984,
  lifeStage: "longevity",
  stage: "继续研究",
  title: "新的研究计划",
  description: "你准备继续研究。",
  choices: [
    { id: "A", text: "继续研究", impactSummary: "持续探索" },
    { id: "B", text: "寻找合作者", impactSummary: "合作推进" },
    { id: "C", text: "整理出版", impactSummary: "成果出版" }
  ],
  attributes: { happiness: 60, intelligence: 80, wealth: 50, relation: 60, health: 55 },
  isEndingNode: false
};
assert.deepEqual(validateStoryConsistency({ node, targetAgeInMonths: 984, people: [] }), []);

const funnel = { ...node, choices: [
  { id: "A", text: "退休养老", impactSummary: "安享晚年" },
  { id: "B", text: "接受照护", impactSummary: "接受照护" },
  { id: "C", text: "回忆过去", impactSummary: "回忆过去" }
] };
assert.ok(validateStoryConsistency({ node: funnel, targetAgeInMonths: 984, people: [] }).some((issue) => issue.code === "age_script_funneling"));

const parentWorld = {
  people: [], directionArcs: [], pressureArcs: [], version: 2 as const,
  familyRelationships: [{
    id: "family_parent", role: "parent_unspecified" as const, activation: "active" as const,
    contact: "unknown" as const, emotionalSupport: "unknown" as const,
    practicalSupport: "unavailable" as const, autonomyRespect: "mixed" as const,
    conflictIntensity: "unknown" as const, revision: 1,
    topicStances: [{
      id: "stance", topic: "career_change" as const, stance: "opposed" as const,
      reasons: ["要求求稳"], effectiveFromAgeInMonths: 960,
      evidence: [], source: "user_fact" as const, confidence: 0.9
    }]
  }]
};
const unauthorizedParentChange = {
  ...node,
  description: "父母的态度从反对转为观望，已经不再直接反对你的工作选择。"
};
assert.ok(validateStoryConsistency({
  node: unauthorizedParentChange, targetAgeInMonths: 984, people: [], worldState: parentWorld
}).some((issue) => issue.code === "family_authority_conflict"));

for (const description of [
  "父母虽然还是念叨稳定第一，但看你干得不错，语气缓和了不少。",
  "妈妈的口风开始松动，慢慢接受了你的选择。",
  "爸爸已经没那么反对，勉强接受了你换工作的决定。"
]) {
  assert.ok(validateStoryConsistency({
    node: { ...node, description }, targetAgeInMonths: 984, people: [], worldState: parentWorld
  }).some((issue) => issue.code === "family_authority_conflict"));
}

const alignedParentNarrative = {
  ...node,
  description: "父母仍然反对你换工作，也没有实际帮忙。"
};
assert.equal(validateStoryConsistency({
  node: alignedParentNarrative, targetAgeInMonths: 984, people: [], worldState: parentWorld
}).some((issue) => issue.code === "family_authority_conflict"), false);
assert.equal(containsForbiddenArcWrite({ narrativeMeta: { nextPhaseId: "growth" } }), true);

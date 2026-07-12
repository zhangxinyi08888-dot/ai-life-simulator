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
assert.equal(containsForbiddenArcWrite({ narrativeMeta: { nextPhaseId: "growth" } }), true);

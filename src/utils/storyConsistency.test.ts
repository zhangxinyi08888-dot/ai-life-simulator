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

const processNode: SimulationNode = {
  ...node,
  age: 53,
  ageInMonths: 642,
  lifeStage: "mature_adulthood",
  description: "妻子仍怀孕六个月，继续等待。",
  narrativeMeta: {
    elapsedMonths: 9,
    elapsedYears: 0.75,
    lifeIntensity: "normal",
    nodeMateriality: "decision_checkpoint",
    storyEpisode: { id: "episode", startAgeInMonths: 633, endAgeInMonths: 642, internalTransitions: [], decisionCheckpointId: "checkpoint", summary: "家庭安排" },
    recoveryState: "neutral",
    recoveryEvidence: [],
    arcSignals: [],
    activeCharacters: [],
    worldDeltas: []
  }
};
const processIssues = validateStoryConsistency({
  node: processNode,
  targetAgeInMonths: 642,
  people: [],
  ongoingProcesses: [{
    id: "pregnancy_1",
    type: "pregnancy",
    subjectPersonIds: ["family_partner"],
    status: "active",
    startedAtAgeInMonths: 627,
    expectedEndAgeInMonths: 636,
    lastUpdatedAtAgeInMonths: 642,
    source: "history",
    confidence: 0.9
  }],
  requiredProcessTransitions: [{ processId: "pregnancy_1", processType: "pregnancy", atAgeInMonths: 642, allowedActions: ["completed", "interrupted"], reason: "已到期" }]
});
assert.equal(processIssues.some((issue) => issue.code === "ongoing_process_time_frozen"), true);
assert.equal(processIssues.some((issue) => issue.code === "ongoing_process_end_overrun"), true);

const uncommonMarriageIssues = validateStoryConsistency({
  node: { ...processNode, description: "50岁时，你们决定结婚领证。", narrativeMeta: { ...processNode.narrativeMeta!, worldDeltas: [] } },
  targetAgeInMonths: 642,
  people: [],
  outcomePlausibility: {
    tier: "uncommon",
    reasons: ["接近或超过50岁的婚姻结果较少见，但允许成立。"],
    supportingFacts: [],
    requiresExplicitBasis: false
  }
});
assert.equal(uncommonMarriageIssues.some((issue) => issue.code === "outcome_plausibility_context_missing" && issue.severity === "warning"), true);
assert.equal(uncommonMarriageIssues.some((issue) => issue.severity === "error"), false);

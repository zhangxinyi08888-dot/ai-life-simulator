import assert from "node:assert/strict";
import { normalizeSimulationNode } from "./simulationResponse";

const node = normalizeSimulationNode({
  stage: "选择前夜",
  title: "志愿分岔",
  narrative: "测试叙事",
  choices: [
    { id: "A", impactSummary: "坚持理想" },
    { label: "B", text: "听从家里安排" },
    { id: "", content: "", impactSummary: "" }
  ],
  attributes: { happiness: 50, wisdom: 60, wealth: 40, social: 45, health: 55 },
  isEndingNode: false
}, { fallbackAge: 18, minAge: 18, maxAge: 20 });

assert.equal(node.age, 18);
assert.equal(node.description, "测试叙事");
assert.equal(node.attributes.intelligence, 60);
assert.equal(node.attributes.relation, 45);
assert.equal(node.choices[0].id, "A");
assert.match(node.choices[0].text, /坚持理想/);
assert.equal(node.choices[1].id, "B");
assert.equal(node.choices[1].text, "听从家里安排");
assert.equal(node.choices[2].id, "C");
assert.equal(node.choices[2].impactSummary, "继续探索");

const clamped = normalizeSimulationNode({ age: 28, choices: [] }, { fallbackAge: 19, minAge: 19, maxAge: 20 });
assert.equal(clamped.age, 20);

const sceneNode = normalizeSimulationNode({
  age: 18,
  scene: "志愿填报前夜",
  choices: [{ id: "A", content: "坚持报设计", impactSummary: "正面抗争" }]
});
assert.equal(sceneNode.description, "志愿填报前夜");
assert.equal(sceneNode.choices[0].text, "坚持报设计");

const crossroadsNode = normalizeSimulationNode({
  age: 18,
  scene: "志愿填报前夜",
  newCrossroads: {
    narrative: "现实拉扯",
    options: [{ id: "A", text: "继续设计", impactSummary: "坚持梦想" }]
  }
});
assert.equal(crossroadsNode.description, "现实拉扯");
assert.equal(crossroadsNode.choices[0].text, "继续设计");

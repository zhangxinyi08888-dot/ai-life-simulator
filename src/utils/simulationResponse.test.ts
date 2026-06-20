import assert from "node:assert/strict";
import { getSimulationNodeValidationIssues, normalizeSimulationNode } from "./simulationResponse";

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

assert.deepEqual(getSimulationNodeValidationIssues({
  age: 42,
  stage: "中年博弈",
  title: "荒原博弈",
  choices: [
    { id: "A", text: "续约一年，为财务自由做最后冲刺", impactSummary: "孤注一掷" },
    { id: "B", text: "立刻离开，回到低成本生活", impactSummary: "及时止损" },
    { id: "C", text: "谈判降负荷，保留部分收入", impactSummary: "折中自救" }
  ],
  isEndingNode: false
}), ["description", "attributes"]);

assert.deepEqual(getSimulationNodeValidationIssues({
  age: 42,
  stage: "中年博弈",
  title: "荒原博弈",
  description: "合同续签的邮件停在屏幕上，老板承诺一年后的分红，现实却是连续三个月失眠和家人催你回到稳定岗位。",
  choices: [
    { id: "A", text: "续约一年，为财务自由做最后冲刺", impactSummary: "孤注一掷" },
    { id: "B", text: "立刻离开，回到低成本生活", impactSummary: "及时止损" },
    { id: "C", text: "谈判降负荷，保留部分收入", impactSummary: "折中自救" }
  ],
  attributes: { happiness: 43, intelligence: 62, wealth: 58, relation: 46, health: 38 },
  isEndingNode: false
}), []);

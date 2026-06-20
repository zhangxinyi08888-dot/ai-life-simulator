import assert from "node:assert/strict";
import { generateCompleteSimulationNode } from "./simulationNodeRetry";

const attempts: string[] = [];
const node = await generateCompleteSimulationNode(async (_attempt, issues) => {
  attempts.push(issues.join(","));
  if (attempts.length === 1) {
    return {
      age: 42,
      stage: "中年博弈",
      title: "荒原博弈",
      choices: [
        { id: "A", text: "续约一年，为财务自由做最后冲刺", impactSummary: "孤注一掷" },
        { id: "B", text: "立刻离开，回到低成本生活", impactSummary: "及时止损" },
        { id: "C", text: "谈判降负荷，保留部分收入", impactSummary: "折中自救" }
      ],
      isEndingNode: false
    };
  }

  return {
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
  };
}, { fallbackAge: 42, maxAttempts: 2 });

assert.equal(attempts.length, 2);
assert.equal(attempts[1], "description,attributes");
assert.match(node.description, /合同续签/);
assert.equal(node.attributes.health, 38);

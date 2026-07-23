import assert from "node:assert/strict";
import { generateCompleteSimulationNode, isRetryableNodeGenerationError } from "./simulationNodeRetry";

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

const invalidJsonAttempts: string[] = [];
const recoveredFromInvalidJson = await generateCompleteSimulationNode(async (_attempt, issues) => {
  invalidJsonAttempts.push(issues.join(","));
  if (invalidJsonAttempts.length === 1) {
    throw Object.assign(new Error("AI 返回内容不是合法 JSON，请重试。"), { code: "AI_RESPONSE_INVALID" });
  }
  return {
    age: 43,
    stage: "中年转折",
    title: "重试后的新节点",
    description: "第一次结构化返回失败后，系统在提交时间线前完成了内部重试。",
    choices: [
      { id: "A", text: "继续推进", impactSummary: "推进" },
      { id: "B", text: "调整方向", impactSummary: "调整" },
      { id: "C", text: "暂缓决定", impactSummary: "暂缓" }
    ],
    attributes: { happiness: 50, intelligence: 60, wealth: 55, relation: 50, health: 50 },
    isEndingNode: false
  };
}, { fallbackAge: 43, maxAttempts: 2 });

assert.equal(invalidJsonAttempts.length, 2);
assert.equal(invalidJsonAttempts[1], "generation-error:AI_RESPONSE_INVALID");
assert.equal(recoveredFromInvalidJson.title, "重试后的新节点");
assert.equal(isRetryableNodeGenerationError(Object.assign(new Error("invalid"), { code: "AI_RESPONSE_INVALID" })), true);
assert.equal(isRetryableNodeGenerationError(Object.assign(new Error("network"), { code: "AI_NETWORK_FAILED" })), false);

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

let invalidJsonAttempts = 0;
const recoveredAfterInvalidJson = await generateCompleteSimulationNode(async (_attempt, issues) => {
  invalidJsonAttempts += 1;
  if (invalidJsonAttempts === 1) throw new Error("malformed json");
  assert.deepEqual(issues, ["invalidJson"]);
  return {
    age: 31,
    stage: "日常转折",
    title: "结构恢复后的节点",
    description: "上一次返回的 JSON 尾部损坏，这一次完整保留用户选择造成的现实后果。",
    choices: [
      { id: "A", text: "继续当前计划", impactSummary: "稳步推进" },
      { id: "B", text: "调整执行节奏", impactSummary: "控制风险" },
      { id: "C", text: "重新评估方向", impactSummary: "保留弹性" }
    ],
    attributes: { happiness: 50, intelligence: 60, wealth: 55, relation: 50, health: 58 },
    isEndingNode: false
  };
}, { fallbackAge: 31, maxAttempts: 2 });
assert.equal(invalidJsonAttempts, 2);
assert.equal(recoveredAfterInvalidJson.title, "结构恢复后的节点");

let romanceAttempts = 0;
const romanceNode = await generateCompleteSimulationNode(async () => {
  romanceAttempts += 1;
  const evidence = "活动结束后，你认识了林悦并交换了联系方式，约好改天继续聊彼此的生活。";
  return {
    age: 30, stage: "生活交汇", title: "新的联系", description: evidence,
    choices: [
      { id: "A", text: "继续了解", impactSummary: "保持联系", eventOutcomeId: "continue_getting_to_know" },
      { id: "B", text: "普通认识", impactSummary: "保持边界", eventOutcomeId: "keep_as_acquaintance" },
      { id: "C", text: "拒绝发展", impactSummary: "明确拒绝", eventOutcomeId: "decline_romantic_direction" }
    ],
    attributes: { happiness: 50, intelligence: 50, wealth: 50, relation: 50, health: 50 }, isEndingNode: false,
    narrativeMeta: {
      activeCharacters: [{ candidateOrdinal: 0, displayName: "林悦", relation: "other", presenceMode: "active_scene", currentRole: "活动参与者" }],
      relationshipProposals: []
    }
  };
}, {
  fallbackAge: 30, maxAttempts: 2,
  allowedOutcomeIds: ["continue_getting_to_know", "keep_as_acquaintance", "decline_romantic_direction"],
  eventIntentType: "romance_new_connection"
});
assert.equal(romanceAttempts, 1);
assert.equal(romanceNode.narrativeMeta?.relationshipProposals?.length, 0);

let repairedRomanceAttempts = 0;
const repairedRomanceNode = await generateCompleteSimulationNode(async () => {
  repairedRomanceAttempts += 1;
  return {
    age: 43,
    stage: "生活交汇",
    title: "总监之位与意外邂逅",
    description: "峰会结束后，林悦主动与你交换联系方式，提议改天在工作之外继续聊聊彼此的生活。",
    choices: [
      { id: "A", text: "继续扩大团队并争取更多客户", impactSummary: "扩大业务", eventOutcomeId: "continue_getting_to_know" },
      { id: "B", text: "放慢扩张并打磨产品", impactSummary: "打磨产品", eventOutcomeId: "keep_as_acquaintance" },
      { id: "C", text: "与林悦保持专业联系并拓展行业人脉", impactSummary: "专业联系", eventOutcomeId: "continue_getting_to_know" }
    ],
    attributes: { happiness: 50, intelligence: 50, wealth: 50, relation: 50, health: 50 },
    isEndingNode: false,
    narrativeMeta: {
      activeCharacters: [{ candidateOrdinal: 0, displayName: "林悦", relation: "other", presenceMode: "active_scene", currentRole: "教育投资人" }],
      relationshipProposals: []
    }
  };
}, {
  fallbackAge: 43,
  maxAttempts: 2,
  allowedOutcomeIds: ["continue_getting_to_know", "keep_as_acquaintance", "decline_romantic_direction"],
  eventIntentType: "romance_new_connection"
});
assert.equal(repairedRomanceAttempts, 1);
assert.deepEqual(repairedRomanceNode.choices.map((choice) => choice.eventOutcomeId), [
  "continue_getting_to_know",
  "keep_as_acquaintance",
  "decline_romantic_direction"
]);
assert.match(repairedRomanceNode.choices[0].text, /林悦.*进一步了解/);
assert.match(repairedRomanceNode.choices[1].text, /普通认识/);
assert.match(repairedRomanceNode.choices[2].text, /婉拒/);

let deferredContractAttempts = 0;
const deferredContractNode = await generateCompleteSimulationNode(async () => {
  deferredContractAttempts += 1;
  return {
    age: 36,
    stage: "生活交汇",
    title: "平淡中的细微抉择 · 原选项 A",
    description: "你接受华东分部半年的外派机会，继续积累跨区域项目经验。",
    choices: [
      { id: "A", text: "接受外派", impactSummary: "积累经验" },
      { id: "B", text: "留在本地", impactSummary: "保持节奏" },
      { id: "C", text: "调整计划", impactSummary: "重新安排" }
    ],
    attributes: { happiness: 50, intelligence: 60, wealth: 50, relation: 55, health: 50 },
    isEndingNode: false,
    narrativeMeta: { activeCharacters: [], relationshipProposals: [] }
  };
}, {
  fallbackAge: 36,
  maxAttempts: 3,
  allowedOutcomeIds: ["continue_getting_to_know", "keep_as_acquaintance", "decline_romantic_direction"],
  eventIntentType: "romance_new_connection",
  deferRomanceContractValidation: true
});
assert.equal(deferredContractAttempts, 1, "romance contract repair belongs to the candidate pipeline, not three full-node retries");
assert.equal(deferredContractNode.title, "平淡中的细微抉择 · 原选项 A");

const choiceTextBaseNode = {
  age: 35,
  stage: "职业转折",
  title: "三个方向",
  description: "期权兑现和外部机会同时出现，你需要在现有岗位、内部转岗和外部平台之间作出选择。",
  choices: [
    { id: "stay_in_current_role", impactSummary: "专注现岗", decisionIntent: "career:stay:current_role" },
    { id: "accept_new_role_transfer", impactSummary: "转岗新业", decisionIntent: "career:transfer:new_role" },
    { id: "startup_for_larger_platform", impactSummary: "跳槽大平台", decisionIntent: "career:join:larger_platform" }
  ],
  attributes: { happiness: 52, intelligence: 70, wealth: 58, relation: 51, health: 60 },
  isEndingNode: false
};

let choiceTextNodeAttempts = 0;
let choiceTextRepairAttempts = 0;
const choiceTextRepairedNode = await generateCompleteSimulationNode(async () => {
  choiceTextNodeAttempts += 1;
  return choiceTextBaseNode;
}, {
  fallbackAge: 35,
  maxAttempts: 2,
  repairMissingChoiceText: async (rawNode, invalidChoiceIndexes) => {
    choiceTextRepairAttempts += 1;
    assert.deepEqual(invalidChoiceIndexes, [0, 1, 2]);
    const texts = [
      "留在现有岗位继续争取期权兑现",
      "接受内部转岗，转向新的业务线",
      "加入更大的平台，换取更快成长"
    ];
    return {
      ...rawNode,
      choices: rawNode.choices.map((choice: Record<string, unknown>, index: number) => ({
        ...choice,
        text: texts[index]
      }))
    };
  }
});
assert.equal(choiceTextNodeAttempts, 1);
assert.equal(choiceTextRepairAttempts, 1);
assert.deepEqual(choiceTextRepairedNode.choices.map((choice) => choice.id), [
  "stay_in_current_role",
  "accept_new_role_transfer",
  "startup_for_larger_platform"
]);
assert.equal(choiceTextRepairedNode.choices[0].text, "留在现有岗位继续争取期权兑现");

let fallbackFullNodeAttempts = 0;
let failedChoiceRepairAttempts = 0;
const fullNodeRegenerated = await generateCompleteSimulationNode(async (_attempt, previousIssues) => {
  fallbackFullNodeAttempts += 1;
  if (fallbackFullNodeAttempts === 1) return choiceTextBaseNode;
  assert.deepEqual(previousIssues, ["choiceText"]);
  return {
    ...choiceTextBaseNode,
    choices: choiceTextBaseNode.choices.map((choice, index) => ({
      ...choice,
      text: ["继续留在现岗推进", "接受内部转岗机会", "加入外部大型平台"][index]
    }))
  };
}, {
  fallbackAge: 35,
  maxAttempts: 2,
  repairMissingChoiceText: async (rawNode) => {
    failedChoiceRepairAttempts += 1;
    return rawNode;
  }
});
assert.equal(failedChoiceRepairAttempts, 1);
assert.equal(fallbackFullNodeAttempts, 2);
assert.equal(fullNodeRegenerated.choices[2].text, "加入外部大型平台");

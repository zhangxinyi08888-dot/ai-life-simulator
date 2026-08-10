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

let missingAttributeAttempts = 0;
const repairedMissingAttributes = await generateCompleteSimulationNode(async () => {
  missingAttributeAttempts += 1;
  return {
    age: 42,
    stage: "职业调整",
    title: "保留有效属性",
    description: "这次节点内容完整，只遗漏了健康数值。",
    choices: [
      { id: "A", text: "继续推进", impactSummary: "推进" },
      { id: "B", text: "调整方向", impactSummary: "调整" },
      { id: "C", text: "暂缓决定", impactSummary: "暂缓" }
    ],
    attributes: { happiness: 62, intelligence: 72, wealth: 48, relation: 57 },
    isEndingNode: false
  };
}, {
  fallbackAge: 42,
  maxAttempts: 1,
  fallbackAttributes: { happiness: 50, intelligence: 60, wealth: 55, relation: 52, health: 44 }
});

assert.equal(missingAttributeAttempts, 1);
assert.equal(repairedMissingAttributes.attributes.happiness, 62);
assert.equal(repairedMissingAttributes.attributes.health, 44);

let deltaLikeAttributeAttempts = 0;
const repairedDeltaLikeAttributes = await generateCompleteSimulationNode(async () => {
  deltaLikeAttributeAttempts += 1;
  return {
    age: 32,
    stage: "关系与工作交错",
    title: "不把变化量当作总值",
    description: "这段时间仍在处理工作节奏与人际关系，身体状况略有波动。",
    choices: [
      { id: "A", text: "继续推进当前工作安排", impactSummary: "继续推进" },
      { id: "B", text: "重新安排与他人的沟通边界", impactSummary: "调整边界" },
      { id: "C", text: "先降低额外投入并观察结果", impactSummary: "降低投入" }
    ],
    // This mirrors the failure mode: the first four fields look like deltas,
    // while health is a valid absolute end-state.
    attributes: { happiness: -2, intelligence: 1, wealth: 99, relation: 0, health: 67 },
    isEndingNode: false
  };
}, {
  fallbackAge: 32,
  maxAttempts: 1,
  fallbackAttributes: { happiness: 72, intelligence: 77, wealth: 46, relation: 77, health: 73 }
});
assert.equal(deltaLikeAttributeAttempts, 1, "invalid attribute fields are repaired locally instead of spending another model call");
assert.deepEqual(repairedDeltaLikeAttributes.attributes, {
  happiness: 72,
  intelligence: 77,
  wealth: 46,
  relation: 77,
  health: 67
});

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
let genericInvalidJsonAttempts = 0;
const recoveredAfterInvalidJson = await generateCompleteSimulationNode(async (_attempt, issues) => {
  genericInvalidJsonAttempts += 1;
  if (genericInvalidJsonAttempts === 1) throw new Error("malformed json");
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
assert.equal(genericInvalidJsonAttempts, 2);
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

let genericOutcomeAttempts = 0;
const genericOutcomeNode = await generateCompleteSimulationNode(async () => {
  genericOutcomeAttempts += 1;
  return {
    age: 45,
    stage: "经营复盘",
    title: "三条经营路径",
    description: "你需要在扩张、稳定和退出之间作出选择。",
    choices: [
      { id: "A", text: "继续扩张", impactSummary: "扩张", eventOutcomeId: "expand" },
      { id: "B", text: "稳定经营", impactSummary: "稳定", eventOutcomeId: "expand" },
      { id: "C", text: "逐步退出", impactSummary: "退出" }
    ],
    attributes: { happiness: 50, intelligence: 60, wealth: 50, relation: 50, health: 50 },
    isEndingNode: false
  };
}, {
  fallbackAge: 45,
  maxAttempts: 2,
  allowedOutcomeIds: ["expand", "stabilize", "exit"],
  eventIntentType: "business_strategy_review"
});
assert.equal(genericOutcomeAttempts, 1);
assert.deepEqual(genericOutcomeNode.choices.map((choice) => choice.eventOutcomeId), ["expand", "stabilize", "exit"]);

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

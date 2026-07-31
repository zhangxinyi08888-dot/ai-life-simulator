import assert from "node:assert/strict";
import {
  getInvalidExplicitChoiceTextIndexes,
  getSimulationNodeValidationIssues,
  normalizeSimulationNode
} from "./simulationResponse";

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
assert.deepEqual(node.descriptionParagraphs, ["测试叙事"]);

const structuredParagraphNode = normalizeSimulationNode({
  age: 20,
  stage: "新阶段",
  title: "结构化正文",
  descriptionParagraphs: ["第一段事实。", "第二段选择。"],
  choices: [
    { id: "A", text: "选择 A" },
    { id: "B", text: "选择 B" },
    { id: "C", text: "选择 C" }
  ],
  attributes: { happiness: 50, intelligence: 50, wealth: 50, relation: 50, health: 50 },
  isEndingNode: false
});
assert.equal(structuredParagraphNode.description, "第一段事实。\n\n第二段选择。");
assert.deepEqual(structuredParagraphNode.descriptionParagraphs, ["第一段事实。", "第二段选择。"]);
assert.equal(node.attributes.intelligence, 60);
assert.equal(node.attributes.relation, 45);
assert.equal(node.choices[0].id, "A");
assert.match(node.choices[0].text, /坚持理想/);
assert.equal(node.choices[1].id, "B");
assert.equal(node.choices[1].text, "听从家里安排");
assert.equal(node.choices[2].id, "C");
assert.equal(node.choices[2].impactSummary, "继续探索");

const outcomeNode = normalizeSimulationNode({
  choices: [{ id: "A", text: "逐步恢复活动", impactSummary: "恢复参与", eventOutcomeId: "resume_activity_gradually" }]
});
assert.equal(outcomeNode.choices[0].eventOutcomeId, "resume_activity_gradually");

const relationshipProposalNode = normalizeSimulationNode({
  description: "你们在活动结束后交换了联系方式。",
  narrativeMeta: {
    relationshipProposals: [{
      id: "person",
      type: "person_introduction",
      candidateOrdinal: 0,
      sourceOutcomeId: "continue_getting_to_know",
      evidence: "你们在活动结束后交换了联系方式。"
    }]
  }
});
assert.equal(relationshipProposalNode.narrativeMeta?.relationshipProposals?.[0].id, "person");

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

const semanticIdChoicesWithoutRealText = {
  age: 42,
  stage: "职业选择",
  title: "岗位与新机会",
  description: "现有岗位和外部机会同时摆在面前，你需要确认下一阶段的投入方向。",
  choices: [
    { id: "stay_in_current_role", impactSummary: "专注现岗", decisionIntent: "career:stay:current_role" },
    { id: "accept_new_role_transfer", content: "转向新业务线", impactSummary: "转岗新业", decisionIntent: "career:transfer:new_role" },
    { id: "startup_for_larger_platform", text: "startup_for_larger_platform. 跳槽大平台", impactSummary: "跳槽大平台", decisionIntent: "career:join:larger_platform" }
  ],
  attributes: { happiness: 50, intelligence: 60, wealth: 55, relation: 50, health: 58 },
  isEndingNode: false
};
assert.deepEqual(getSimulationNodeValidationIssues(semanticIdChoicesWithoutRealText), []);
assert.deepEqual(getInvalidExplicitChoiceTextIndexes(semanticIdChoicesWithoutRealText), [0, 1, 2]);
assert.deepEqual(getSimulationNodeValidationIssues(semanticIdChoicesWithoutRealText, {
  requireExplicitChoiceText: true
}), ["choiceText"]);
const legacySemanticIdNode = normalizeSimulationNode(semanticIdChoicesWithoutRealText);
assert.equal(legacySemanticIdNode.choices[0].id, "stay_in_current_role");
assert.equal(legacySemanticIdNode.choices[0].text, "stay_in_current_role. 专注现岗");

const eventContractNode = {
  age: 42,
  stage: "恢复阶段",
  title: "重新安排生活",
  description: "此前的调整开始产生效果，现在需要决定如何巩固恢复并重新参与原有生活。",
  choices: [
    { id: "A", text: "继续巩固恢复安排", impactSummary: "巩固恢复", eventOutcomeId: "consolidate_recovery_plan" },
    { id: "B", text: "逐步恢复重要活动", impactSummary: "恢复参与", eventOutcomeId: "resume_activity_gradually" },
    { id: "C", text: "按剩余限制调整方案", impactSummary: "动态调整", eventOutcomeId: "adjust_plan_based_on_remaining_limits" }
  ],
  attributes: { happiness: 55, intelligence: 62, wealth: 50, relation: 58, health: 48 },
  isEndingNode: false
};
const recoveryOutcomes = [
  "consolidate_recovery_plan",
  "resume_activity_gradually",
  "adjust_plan_based_on_remaining_limits"
];

assert.deepEqual(getSimulationNodeValidationIssues(eventContractNode, { allowedOutcomeIds: recoveryOutcomes }), []);
assert.deepEqual(getSimulationNodeValidationIssues({
  ...eventContractNode,
  choices: eventContractNode.choices.map(({ eventOutcomeId: _eventOutcomeId, ...choice }) => choice)
}, { allowedOutcomeIds: recoveryOutcomes }), ["eventOutcomeId", "eventOutcomeCoverage"]);
assert.deepEqual(getSimulationNodeValidationIssues({
  ...eventContractNode,
  choices: eventContractNode.choices.map((choice) => ({ ...choice, eventOutcomeId: "consolidate_recovery_plan" }))
}, { allowedOutcomeIds: recoveryOutcomes }), ["eventOutcomeCoverage"]);

const romanceOutcomes = ["continue_getting_to_know", "keep_as_acquaintance", "decline_romantic_direction"];
assert.deepEqual(getSimulationNodeValidationIssues({
  ...eventContractNode,
  choices: [
    { id: "A", text: "继续扩大团队并争取更多客户", impactSummary: "扩大业务", eventOutcomeId: "continue_getting_to_know" },
    { id: "B", text: "放慢扩张并打磨产品", impactSummary: "打磨产品", eventOutcomeId: "keep_as_acquaintance" },
    { id: "C", text: "与林悦保持专业联系并拓展行业人脉", impactSummary: "专业联系", eventOutcomeId: "continue_getting_to_know" }
  ]
}, { allowedOutcomeIds: romanceOutcomes, eventIntentType: "romance_new_connection" }), ["romanceNarrativeGrounding", "eventOutcomeCoverage", "romanceChoiceSemantics"]);
assert.deepEqual(getSimulationNodeValidationIssues({
  ...eventContractNode,
  description: "活动结束后，你认识了林悦并交换了联系方式，约好改天继续聊彼此的生活。",
  narrativeMeta: {
    activeCharacters: [{ candidateOrdinal: 0, displayName: "林悦", relation: "other", presenceMode: "active_scene", currentRole: "活动参与者" }]
  },
  choices: [
    { id: "A", text: "继续和林悦接触，在生活里进一步了解彼此", impactSummary: "继续了解", eventOutcomeId: "continue_getting_to_know" },
    { id: "B", text: "与林悦保持普通认识和专业联系", impactSummary: "普通认识", eventOutcomeId: "keep_as_acquaintance" },
    { id: "C", text: "明确不发展浪漫关系，保持边界", impactSummary: "拒绝发展", eventOutcomeId: "decline_romantic_direction" }
  ]
}, { allowedOutcomeIds: romanceOutcomes, eventIntentType: "romance_new_connection" }), []);
assert.deepEqual(getSimulationNodeValidationIssues({
  ...eventContractNode,
  description: "你在朋友聚会上认识了另一位瑜伽教练，对方邀请你以后一起参加活动。",
  narrativeMeta: {
    activeCharacters: [{
      candidateOrdinal: 0,
      displayName: "你",
      relation: "other",
      presenceMode: "active_scene",
      currentRole: "瑜伽教练",
      encounterType: "new_connection",
      encounterContext: "personal",
      groundingEvidence: "你在朋友聚会上认识了另一位瑜伽教练，对方邀请你以后一起参加活动。"
    }]
  },
  choices: [
    { id: "A", text: "继续和你私下见面，进一步了解彼此", impactSummary: "继续了解", eventOutcomeId: "continue_getting_to_know" },
    { id: "B", text: "与你保持普通认识", impactSummary: "普通认识", eventOutcomeId: "keep_as_acquaintance" },
    { id: "C", text: "明确不发展浪漫关系", impactSummary: "拒绝发展", eventOutcomeId: "decline_romantic_direction" }
  ]
}, { allowedOutcomeIds: romanceOutcomes, eventIntentType: "romance_new_connection" }), ["romanceNarrativeGrounding"]);

assert.deepEqual(getSimulationNodeValidationIssues({
  ...eventContractNode,
  description: "你在行业峰会中结识了产品总监林悦，两人因本地化挑战聊得投机，会后互换了微信。\n\n几次行业交流后，你与林悦从职业交流延伸到周末一起看展、吃饭，两人都感受到了微妙的吸引力。",
  narrativeMeta: {
    activeCharacters: [{ candidateOrdinal: 0, displayName: "林悦", relation: "other", presenceMode: "active_scene", currentRole: "SaaS 公司产品总监" }]
  },
  choices: [
    { id: "A", text: "继续和林悦私下见面，进一步了解彼此", impactSummary: "继续了解", eventOutcomeId: "continue_getting_to_know" },
    { id: "B", text: "与林悦保持普通认识，不发展浪漫关系", impactSummary: "普通认识", eventOutcomeId: "keep_as_acquaintance" },
    { id: "C", text: "明确婉拒与林悦发展浪漫关系", impactSummary: "拒绝发展", eventOutcomeId: "decline_romantic_direction" }
  ]
}, { allowedOutcomeIds: romanceOutcomes, eventIntentType: "romance_new_connection" }), []);

assert.deepEqual(getSimulationNodeValidationIssues({
  ...eventContractNode,
  description: "你在峰会上认识了华东代理商并加了微信，之后双方只讨论产品、合同和公司安排。",
  narrativeMeta: {
    activeCharacters: [{ candidateOrdinal: 0, displayName: "华东代理商", relation: "business_partner", presenceMode: "remote_contact", currentRole: "创业合伙人" }]
  },
  choices: [
    { id: "A", text: "继续和华东代理商私下见面，进一步了解彼此", impactSummary: "继续了解", eventOutcomeId: "continue_getting_to_know" },
    { id: "B", text: "与华东代理商保持普通认识和专业联系", impactSummary: "普通认识", eventOutcomeId: "keep_as_acquaintance" },
    { id: "C", text: "明确婉拒与华东代理商发展浪漫关系", impactSummary: "拒绝发展", eventOutcomeId: "decline_romantic_direction" }
  ]
}, { allowedOutcomeIds: romanceOutcomes, eventIntentType: "romance_new_connection" }), ["romanceNarrativeGrounding"]);

assert.deepEqual(getSimulationNodeValidationIssues({
  ...eventContractNode,
  description: "你在行业交流会上认识了一位教育信息化创业者。对方正在搭建SaaS平台，邀请你周末喝咖啡深谈项目，你认为双方在技术和商业上互补。",
  narrativeMeta: {
    activeCharacters: [{ candidateOrdinal: 0, displayName: "创业者", relation: "business_partner", presenceMode: "active_scene", currentRole: "潜在合作伙伴/新朋友" }]
  },
  choices: [
    { id: "A", text: "继续和创业者私下见面，进一步了解彼此", impactSummary: "继续了解", eventOutcomeId: "continue_getting_to_know" },
    { id: "B", text: "与创业者保持普通认识和专业联系", impactSummary: "普通认识", eventOutcomeId: "keep_as_acquaintance" },
    { id: "C", text: "明确婉拒与创业者发展浪漫关系", impactSummary: "拒绝发展", eventOutcomeId: "decline_romantic_direction" }
  ]
}, { allowedOutcomeIds: romanceOutcomes, eventIntentType: "romance_new_connection" }), ["romanceNarrativeGrounding"]);

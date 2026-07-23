import assert from "node:assert/strict";
import { repairDeterministicRomanceChoices, getSimulationNodeValidationIssues } from "./simulationResponse";

const outcomes = ["continue_getting_to_know", "keep_as_acquaintance", "decline_romantic_direction"];

function fixture(input: {
  title: string;
  description: string;
  displayName?: string;
  currentRole?: string;
  encounterContext?: "personal" | "mixed" | "professional";
  groundingEvidence?: string;
}) {
  return {
    age: 36,
    stage: "生活交汇",
    title: input.title,
    description: input.description,
    descriptionParagraphs: [input.description],
    choices: [
      { id: "A", text: "接受机会并继续原来的事业安排", impactSummary: "继续推进", eventOutcomeId: outcomes[0] },
      { id: "B", text: "保持当前节奏", impactSummary: "保持节奏", eventOutcomeId: outcomes[1] },
      { id: "C", text: "调整工作安排", impactSummary: "调整安排", eventOutcomeId: outcomes[2] }
    ],
    attributes: { happiness: 50, intelligence: 60, wealth: 50, relation: 50, health: 50 },
    isEndingNode: false,
    narrativeMeta: {
      activeCharacters: input.displayName ? [{
        candidateOrdinal: 0,
        displayName: input.displayName,
        relation: "other",
        presenceMode: "active_scene",
        currentRole: input.currentRole || "新认识的人",
        encounterType: "new_connection",
        encounterContext: input.encounterContext,
        groundingEvidence: input.groundingEvidence
      }] : [],
      relationshipProposals: []
    }
  };
}

// R4 failure 1: career route wrote a client/project contact as the romance candidate.
const careerBusinessOnly = fixture({
  title: "顾问生活的涟漪",
  description: "你在陈昊的律所参加项目周会，苏棠负责合规业务。会后她加了你的微信，约你继续讨论合同产品。",
  displayName: "苏棠",
  currentRole: "合作律所律师",
  encounterContext: "professional",
  groundingEvidence: "会后她加了你的微信，约你继续讨论合同产品。"
});

// R4 failure 2: relationship route original option A reached a node whose next
// romance event had no new candidate scaffold at all.
const relationshipOptionA = fixture({
  title: "平淡中的细微抉择 · 原选项 A",
  description: "你接受华东分部半年的外派机会，继续积累跨区域项目经验，也准备和陈曦保持联系。"
});

// R4 failure 3: venture route described a potential partner, not a personal connection.
const venturePartnerOnly = fixture({
  title: "全职创业的七个月",
  description: "路演结束后，你认识了投资经理林洲。他邀请你周末喝咖啡，继续深谈融资条款和渠道合作。",
  displayName: "林洲",
  currentRole: "投资经理",
  encounterContext: "professional",
  groundingEvidence: "他邀请你周末喝咖啡，继续深谈融资条款和渠道合作。"
});

// R4 failure 4: lifespan route returned family routine while the scheduler had
// authorized romance_new_connection.
const familyRoutineMismatch = fixture({
  title: "手册完成与新的对话",
  description: "你继续陪父亲下棋，也安排父母体检，并把乡村数学教具手册交给合作教师。"
});

for (const failed of [careerBusinessOnly, relationshipOptionA, venturePartnerOnly, familyRoutineMismatch]) {
  const issues = getSimulationNodeValidationIssues(failed, {
    allowedOutcomeIds: outcomes,
    eventIntentType: "romance_new_connection"
  });
  assert.ok(issues.includes("romanceNarrativeGrounding"), `${failed.title} must remain an explicit fallback case`);
}

// R4 failure 5: valid personal scene without the old regex's preferred prose.
// Structured grounding must accept it, then deterministic templates must remove
// all model-authored choice-semantics risk.
const structuredWithoutMagicWords = fixture({
  title: "雨停后的书店",
  description: "雨停后，周岚把手里的旧版诗集递给你，说她也会为绝版书绕半座城。你们在书店门口站了十分钟，决定下周一起去旧书市集。",
  displayName: "周岚",
  currentRole: "书店活动参与者",
  encounterContext: "personal",
  groundingEvidence: "周岚把手里的旧版诗集递给你，说她也会为绝版书绕半座城。"
});
const repaired = repairDeterministicRomanceChoices(structuredWithoutMagicWords, "romance_new_connection", outcomes);
assert.deepEqual(repaired.choices.map((choice) => choice.eventOutcomeId), outcomes);
assert.match(repaired.choices[0].text, /周岚.*进一步了解/);
assert.match(repaired.choices[1].text, /普通认识/);
assert.match(repaired.choices[2].text, /婉拒/);
assert.deepEqual(getSimulationNodeValidationIssues(repaired, {
  allowedOutcomeIds: outcomes,
  eventIntentType: "romance_new_connection"
}), []);

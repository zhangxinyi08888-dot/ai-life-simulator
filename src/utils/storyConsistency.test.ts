import assert from "node:assert/strict";
import { SimulationNode } from "../types";
import { containsForbiddenArcWrite, stripForbiddenArcWrites, stripUnauthorizedRelationshipChoices, stripUnauthorizedRomanticCharacters, validateStoryConsistency } from "./storyConsistency";

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

const parentWorld = {
  people: [], directionArcs: [], pressureArcs: [], version: 2 as const,
  familyRelationships: [{
    id: "family_parent", role: "parent_unspecified" as const, activation: "active" as const,
    contact: "unknown" as const, emotionalSupport: "unknown" as const,
    practicalSupport: "unavailable" as const, autonomyRespect: "mixed" as const,
    conflictIntensity: "unknown" as const, revision: 1,
    topicStances: [{
      id: "stance", topic: "career_change" as const, stance: "opposed" as const,
      reasons: ["要求求稳"], effectiveFromAgeInMonths: 960,
      evidence: [], source: "user_fact" as const, confidence: 0.9
    }]
  }]
};
const unauthorizedParentChange = {
  ...node,
  description: "父母的态度从反对转为观望，已经不再直接反对你的工作选择。"
};
assert.ok(validateStoryConsistency({
  node: unauthorizedParentChange, targetAgeInMonths: 984, people: [], worldState: parentWorld
}).some((issue) => issue.code === "family_authority_conflict"));

for (const description of [
  "父母虽然还是念叨稳定第一，但看你干得不错，语气缓和了不少。",
  "妈妈的口风开始松动，慢慢接受了你的选择。",
  "爸爸已经没那么反对，勉强接受了你换工作的决定。"
]) {
  assert.ok(validateStoryConsistency({
    node: { ...node, description }, targetAgeInMonths: 984, people: [], worldState: parentWorld
  }).some((issue) => issue.code === "family_authority_conflict"));
}

const alignedParentNarrative = {
  ...node,
  description: "父母仍然反对你换工作，也没有实际帮忙。"
};
assert.equal(validateStoryConsistency({
  node: alignedParentNarrative, targetAgeInMonths: 984, people: [], worldState: parentWorld
}).some((issue) => issue.code === "family_authority_conflict"), false);

const romanticPerson = {
  id: "person_romantic",
  displayName: "林遥",
  relation: "partner" as const,
  lifeStatus: "active" as const,
  source: "accepted_history" as const,
  confidence: 0.95
};
const romanticWorld = (stage: "exploring" | "dating" | "cohabiting" | "married") => ({
  people: [romanticPerson],
  directionArcs: [],
  pressureArcs: [],
  relationships: [{
    id: "relationship_romantic",
    participantPersonIds: [romanticPerson.id],
    type: "romantic" as const,
    stage,
    status: "active" as const,
    effectiveFromAgeInMonths: 900,
    source: "accepted_history" as const,
    confidence: 0.95
  }],
  version: 2 as const
});

const endedRomanceWorld = {
  people: [romanticPerson],
  directionArcs: [],
  pressureArcs: [],
  relationships: [{
    id: "relationship_ended_romantic",
    participantPersonIds: [romanticPerson.id],
    type: "romantic" as const,
    stage: "ended" as const,
    status: "ended" as const,
    statusEffectiveFromAgeInMonths: 960,
    effectiveFromAgeInMonths: 960,
    source: "accepted_history" as const,
    confidence: 0.95
  }],
  version: 2 as const
};

assert.equal(validateStoryConsistency({
  node: { ...node, description: "你和林遥已经分开近两年，仍在重新安排自己的生活。" },
  targetAgeInMonths: 984,
  people: [romanticPerson],
  worldState: endedRomanceWorld
}).some((issue) => issue.code === "relative_time_authority_conflict"), false);

assert.ok(validateStoryConsistency({
  node: { ...node, description: "你和林遥已经分开近四年，仍在重新安排自己的生活。" },
  targetAgeInMonths: 984,
  people: [romanticPerson],
  worldState: endedRomanceWorld
}).some((issue) => issue.code === "relative_time_authority_conflict"));

const endedRomanceWithoutStatusTiming = {
  ...endedRomanceWorld,
  relationships: endedRomanceWorld.relationships.map((relationship) => {
    const { statusEffectiveFromAgeInMonths: _statusEffectiveFromAgeInMonths, ...legacyRelationship } = relationship;
    return legacyRelationship;
  })
};
assert.equal(validateStoryConsistency({
  node: { ...node, description: "你和林遥已经分开近四年，仍在重新安排自己的生活。" },
  targetAgeInMonths: 984,
  people: [romanticPerson],
  worldState: endedRomanceWithoutStatusTiming
}).some((issue) => issue.code === "relative_time_authority_conflict"), false);

assert.ok(validateStoryConsistency({
  node: { ...node, description: "你们已经正式交往，并开始以伴侣身份安排生活。" },
  targetAgeInMonths: 984,
  people: [romanticPerson],
  worldState: romanticWorld("exploring")
}).some((issue) => issue.code === "relationship_authority_conflict"));

assert.ok(validateStoryConsistency({
  node: {
    ...node,
    description: "你和林遥还在慢慢了解彼此。",
    choices: [
      { id: "A", text: "主动和林遥谈一次，明确表达想和她正式交往", impactSummary: "确认关系" },
      { id: "B", text: "保持目前的探索节奏", impactSummary: "继续了解" },
      { id: "C", text: "回到普通朋友", impactSummary: "停止探索" }
    ]
  },
  targetAgeInMonths: 984,
  people: [romanticPerson],
  worldState: romanticWorld("exploring")
}).some((issue) => issue.code === "relationship_authority_conflict"));

assert.ok(validateStoryConsistency({
  node: {
    ...node,
    eventMeta: { eventId: "family_practical_support_exchange", eventTags: [], routeLine: "family" },
    description: "你在徒步社群里认识了林悦，偶尔一起吃饭。",
    choices: [
      { id: "A", text: "主动约林悦看房，创造一次更私人的相处，试探她对进一步发展的态度", impactSummary: "试探态度" },
      { id: "B", text: "维持频率，不主动推进，给自己时间确认感觉", impactSummary: "保持现状" },
      { id: "C", text: "向林悦坦白过去，观察反应，也让自己卸下心防", impactSummary: "坦诚过去" }
    ]
  },
  targetAgeInMonths: 984,
  people: [],
  worldState: { people: [], directionArcs: [], pressureArcs: [], relationships: [], version: 2 }
}).some((issue) => issue.code === "relationship_authority_conflict"));

assert.ok(validateStoryConsistency({
  node: {
    ...node,
    eventMeta: { eventId: "opportunity_escape_route", eventTags: [], routeLine: "opportunity" },
    description: "接下来的半年，你们的关系缓慢但稳定地升温。你重新学会靠近一个人。34岁时，你和林悦已经交往一年半。",
    choices: [
      { id: "A", text: "明确关系方向", impactSummary: "推进关系" },
      { id: "B", text: "维持现状观察", impactSummary: "保持现状" },
      { id: "C", text: "职业优先缓冲", impactSummary: "职业优先" }
    ]
  },
  targetAgeInMonths: 984,
  people: [],
  worldState: { people: [], directionArcs: [], pressureArcs: [], relationships: [], version: 2 }
}).some((issue) => issue.code === "relationship_authority_conflict"));

assert.ok(validateStoryConsistency({
  node: {
    ...node,
    eventMeta: { eventId: "life_normal_transition", eventTags: [], routeLine: "growth" },
    description: "你在新城市逐渐站稳脚跟。",
    choices: [
      { id: "A", text: "继续深耕职业", impactSummary: "职业发展" },
      { id: "B", text: "报名行业课程", impactSummary: "提升能力" },
      { id: "C", text: "尝试通过相亲或社交 app 拓展交际，重新建立一段认真的亲密关系", impactSummary: "寻找伴侣" }
    ]
  },
  targetAgeInMonths: 984,
  people: [],
  worldState: { people: [], directionArcs: [], pressureArcs: [], relationships: [], version: 2 }
}).some((issue) => issue.code === "relationship_authority_conflict"));

assert.ok(validateStoryConsistency({
  node: {
    ...node,
    eventMeta: { eventId: "health_sustainable_routine", eventTags: [], routeLine: "health" },
    description: "第三年，你决定尝试一段新的关系，通过同事介绍认识了一个朋友。你们相处愉快，但感情进展缓慢。",
    choices: [
      { id: "A", text: "稳扎稳打", impactSummary: "保持节奏" },
      { id: "B", text: "再闯天涯", impactSummary: "继续事业" },
      { id: "C", text: "回归家庭", impactSummary: "照顾父母" }
    ]
  },
  targetAgeInMonths: 984,
  people: [],
  worldState: { people: [], directionArcs: [], pressureArcs: [], relationships: [], version: 2 }
}).some((issue) => issue.code === "relationship_authority_conflict"));

assert.ok(validateStoryConsistency({
  node: {
    ...node,
    description: "你在徒步俱乐部认识了一位普通朋友。",
    choices: [
      { id: "A", text: "接受调令，感情顺其自然", impactSummary: "职业优先" },
      { id: "B", text: "留在现有城市并认真追求徒步俱乐部女生", impactSummary: "追求对方" },
      { id: "C", text: "与女生保持联系，用半年时间观察两地发展再定", impactSummary: "保持联系" }
    ]
  },
  targetAgeInMonths: 984,
  people: [],
  worldState: { people: [], directionArcs: [], pressureArcs: [], relationships: [], version: 2 }
}).some((issue) => issue.code === "relationship_authority_conflict"));

assert.ok(validateStoryConsistency({
  node: {
    ...node,
    choices: [
      { id: "A", text: "A. 情感尝试", impactSummary: "尝试关系" },
      { id: "B", text: "B. 职业扎根", impactSummary: "专注事业" },
      { id: "C", text: "C. 社交拓展", impactSummary: "普通社交" }
    ]
  },
  targetAgeInMonths: 984,
  people: [],
  worldState: { people: [], directionArcs: [], pressureArcs: [], relationships: [], version: 2 }
}).some((issue) => issue.code === "relationship_authority_conflict"));

assert.ok(validateStoryConsistency({
  node: {
    ...node,
    choices: [
      { id: "A", text: "继续相亲，主动扩大普通社交圈", impactSummary: "拓展社交" },
      { id: "B", text: "暂时不刻意找对象", impactSummary: "保持现状" },
      { id: "C", text: "尝试和那位中学教师深入交往，看看能否发展", impactSummary: "推进关系" }
    ]
  },
  targetAgeInMonths: 984,
  people: [],
  worldState: { people: [], directionArcs: [], pressureArcs: [], relationships: [], version: 2 }
}).some((issue) => issue.code === "relationship_authority_conflict"));

assert.ok(validateStoryConsistency({
  node: {
    ...node,
    choices: [
      { id: "A", text: "主动联系那位中学教师，尝试更深入地交往，给彼此一个机会", impactSummary: "推进关系" },
      { id: "B", text: "参加读书会，扩大普通社交圈", impactSummary: "拓展社交" },
      { id: "C", text: "专注工作", impactSummary: "职业优先" }
    ]
  },
  targetAgeInMonths: 984,
  people: [],
  worldState: { people: [], directionArcs: [], pressureArcs: [], relationships: [], version: 2 }
}).some((issue) => issue.code === "relationship_authority_conflict"));

assert.ok(validateStoryConsistency({
  node: {
    ...node,
    choices: [
      { id: "A", text: "申请调回原城市，尝试与前任重新联系，看看是否还有可能", impactSummary: "重联前任" },
      { id: "B", text: "继续留在省城", impactSummary: "事业优先" },
      { id: "C", text: "接受跨省项目", impactSummary: "继续工作" }
    ]
  },
  targetAgeInMonths: 984,
  people: [],
  worldState: { people: [], directionArcs: [], pressureArcs: [], relationships: [], version: 2 }
}).some((issue) => issue.code === "relationship_authority_conflict"));

assert.ok(validateStoryConsistency({
  node: {
    ...node,
    eventMeta: { eventId: "family_ordinary_contact", eventTags: [], routeLine: "family" },
    description: "你和林遥正在面对异地工作的现实压力。",
    choices: [
      { id: "A", text: "为爱降速", impactSummary: "调整节奏", decisionIntent: "romance:choose:linyao", eventOutcomeId: "share_a_bounded_update" },
      { id: "B", text: "异地维系", impactSummary: "保持联系", decisionIntent: "romance:maintain:long_distance", eventOutcomeId: "arrange_a_later_contact" },
      { id: "C", text: "放手前行", impactSummary: "结束关系", decisionIntent: "romance:end:with_linyao", eventOutcomeId: "keep_contact_brief" }
    ]
  },
  targetAgeInMonths: 984,
  people: [romanticPerson],
  worldState: romanticWorld("dating")
}).some((issue) => issue.code === "relationship_authority_conflict"));

assert.ok(validateStoryConsistency({
  node: {
    ...node,
    eventMeta: { eventId: "career_responsibility_shift", eventTags: [], routeLine: "career" },
    description: "你和林遥仍处于相互了解阶段。",
    choices: [
      { id: "A", text: "认真思考后向林遥表明，你愿意以结婚为前提正式交往", impactSummary: "正式交往", decisionIntent: "romance:proceed:linyao_marriage_oriented", eventOutcomeId: "accept_limited_responsibility" },
      { id: "B", text: "继续了解", impactSummary: "保持探索", decisionIntent: "romance:discuss:future", eventOutcomeId: "draw_explicit_responsibility_boundary" },
      { id: "C", text: "专注职业", impactSummary: "职业优先", decisionIntent: "career:focus:current_role", eventOutcomeId: "seek_rule_based_mediation" }
    ]
  },
  targetAgeInMonths: 984,
  people: [romanticPerson],
  worldState: romanticWorld("exploring")
}).some((issue) => issue.code === "relationship_authority_conflict"));

assert.ok(validateStoryConsistency({
  node: {
    ...node,
    eventMeta: { eventId: "career_sustainable_work_rhythm", eventTags: [], routeLine: "career" },
    description: "你在进修课上认识了普通朋友林晓。",
    choices: [
      { id: "A", text: "经营与林晓的友谊，观察感情走向", impactSummary: "保持接触" },
      { id: "B", text: "报名行业课程", impactSummary: "提升技能" },
      { id: "C", text: "陪父母体检", impactSummary: "家庭联系" }
    ],
    narrativeMeta: {
      elapsedMonths: 12,
      elapsedYears: 1,
      lifeIntensity: "normal",
      nodeMateriality: "decision_checkpoint",
      storyEpisode: { id: "episode", startAgeInMonths: 972, endAgeInMonths: 984, internalTransitions: [], decisionCheckpointId: "choice", summary: "普通节点" },
      recoveryState: "neutral",
      recoveryEvidence: [],
      arcSignals: [],
      activeCharacters: [{ displayName: "林晓", relation: "other", presenceMode: "active_scene", candidateOrdinal: 0 }],
      worldDeltas: []
    }
  },
  targetAgeInMonths: 984,
  people: [],
  worldState: { people: [], directionArcs: [], pressureArcs: [], relationships: [], version: 2 }
}).some((issue) => issue.code === "relationship_authority_conflict"));

assert.equal(validateStoryConsistency({
  node: {
    ...node,
    description: "你和林遥还在慢慢了解彼此。",
    choices: [
      { id: "A", text: "和林遥讨论是否适合正式交往", impactSummary: "坦诚讨论" },
      { id: "B", text: "保持目前的探索节奏", impactSummary: "继续了解" },
      { id: "C", text: "回到普通朋友", impactSummary: "停止探索" }
    ]
  },
  targetAgeInMonths: 984,
  people: [romanticPerson],
  worldState: romanticWorld("exploring")
}).some((issue) => issue.code === "relationship_authority_conflict"), false);

assert.equal(validateStoryConsistency({
  node: {
    ...node,
    description: "你正式确认长期调任，随后与伴侣进行了最后一次坦诚对话。第二天，你们平静地结束了四年的关系。后来前任开始了新恋情。"
  },
  targetAgeInMonths: 984,
  people: [romanticPerson],
  worldState: {
    ...romanticWorld("dating"),
    relationships: [{
      ...romanticWorld("dating").relationships[0],
      stage: "separated" as const,
      status: "ended" as const
    }]
  }
}).some((issue) => issue.code === "relationship_authority_conflict"), false);

assert.ok(validateStoryConsistency({
  node: {
    ...node,
    description: "你已经适应了新城市的生活，偶尔仍会想起前任。",
    choices: [
      { id: "A", text: "专注事业冲刺", impactSummary: "事业优先" },
      { id: "B", text: "回归平衡生活", impactSummary: "调整节奏" },
      { id: "C", text: "挽回旧日感情，与前任复合", impactSummary: "挽回关系" }
    ]
  },
  targetAgeInMonths: 984,
  people: [romanticPerson],
  worldState: {
    ...romanticWorld("dating"),
    relationships: [{
      ...romanticWorld("dating").relationships[0],
      stage: "separated" as const,
      status: "ended" as const
    }]
  }
}).some((issue) => issue.code === "relationship_authority_conflict"));

assert.ok(validateStoryConsistency({
  node: {
    ...node,
    description: "你在读书会和林悦逐渐熟络，但当前没有已提交的爱情关系。",
    choices: [
      { id: "A", text: "A. 情感新起点", impactSummary: "主动尝试" },
      { id: "B", text: "B. 职业避险", impactSummary: "稳住工作" },
      { id: "C", text: "C. 家庭坦诚", impactSummary: "沟通父母" }
    ]
  },
  targetAgeInMonths: 984,
  people: [],
  worldState: { people: [], directionArcs: [], pressureArcs: [], relationships: [], version: 2 }
}).some((issue) => issue.code === "relationship_authority_conflict"));

assert.ok(validateStoryConsistency({
  node: {
    ...node,
    description: "你和林悦的关系进入了新阶段，你们合租两居室，并建立家庭共同账户。",
    choices: [
      { id: "A", text: "接受共同账户方案", impactSummary: "共同财务" },
      { id: "B", text: "保持财务独立", impactSummary: "独立管理" },
      { id: "C", text: "试行三个月", impactSummary: "短期试行" }
    ]
  },
  targetAgeInMonths: 984,
  people: [],
  worldState: { people: [], directionArcs: [], pressureArcs: [], relationships: [], version: 2 }
}).some((issue) => issue.code === "relationship_authority_conflict"));

assert.ok(validateStoryConsistency({
  node: {
    ...node,
    description: "你们继续处理住房和双方父母的现实压力。",
    choices: [
      { id: "A", text: "接受父母帮助，先领证买房，简单办婚礼，把家稳住再说", impactSummary: "立即成家" },
      { id: "B", text: "继续储蓄", impactSummary: "保持节奏" },
      { id: "C", text: "调整工作", impactSummary: "职业调整" }
    ]
  },
  targetAgeInMonths: 984,
  people: [romanticPerson],
  worldState: romanticWorld("dating")
}).some((issue) => issue.code === "relationship_authority_conflict"));

assert.ok(validateStoryConsistency({
  node: { ...node, description: "共同生活的第一年，你们重新分配了家务。" },
  targetAgeInMonths: 984,
  people: [romanticPerson],
  worldState: romanticWorld("dating")
}).some((issue) => issue.code === "relationship_authority_conflict"));

assert.ok(validateStoryConsistency({
  node: { ...node, title: "同居生活的日常校准", description: "你们重新分配了家务。" },
  targetAgeInMonths: 984,
  people: [romanticPerson],
  worldState: romanticWorld("dating")
}).some((issue) => issue.code === "relationship_authority_conflict"));

assert.ok(validateStoryConsistency({
  node: { ...node, title: "婚后生活的平衡木", description: "你的妻子开始重新安排工作和家庭时间。" },
  targetAgeInMonths: 984,
  people: [romanticPerson],
  worldState: romanticWorld("dating")
}).some((issue) => issue.code === "relationship_authority_conflict"));

assert.ok(validateStoryConsistency({
  node: {
    ...node,
    description: "你们仍在讨论婚期和住房安排。",
    choices: [
      { id: "A", text: "正式领证结婚，按计划开始备孕", impactSummary: "立即成家" },
      { id: "B", text: "继续讨论住房条件", impactSummary: "继续协商" },
      { id: "C", text: "重新评估长期目标", impactSummary: "重新评估" }
    ]
  },
  targetAgeInMonths: 984,
  people: [romanticPerson],
  worldState: romanticWorld("dating")
}).some((issue) => issue.code === "relationship_authority_conflict"));

assert.ok(validateStoryConsistency({
  node: {
    ...node,
    description: "你们仍在讨论婚期和住房安排。",
    choices: [
      { id: "A", text: "按计划一年后领证结婚，并开始备孕", impactSummary: "延后执行" },
      { id: "B", text: "继续讨论住房条件", impactSummary: "继续协商" },
      { id: "C", text: "重新评估长期目标", impactSummary: "重新评估" }
    ]
  },
  targetAgeInMonths: 984,
  people: [romanticPerson],
  worldState: romanticWorld("dating")
}).some((issue) => issue.code === "relationship_authority_conflict"));

assert.equal(validateStoryConsistency({
  node: {
    ...node,
    description: "你们继续讨论长期安排。",
    choices: [
      { id: "A", text: "先储蓄半年，等条件成熟后再考虑是否领证", impactSummary: "延后评估" },
      { id: "B", text: "继续讨论住房条件", impactSummary: "继续协商" },
      { id: "C", text: "重新评估长期目标", impactSummary: "重新评估" }
    ]
  },
  targetAgeInMonths: 984,
  people: [romanticPerson],
  worldState: romanticWorld("dating")
}).some((issue) => issue.code === "relationship_authority_conflict"), false);

assert.ok(validateStoryConsistency({
  node: {
    ...node,
    description: "你和陈总监保持正常业务合作。",
    choices: [
      { id: "A", text: "继续推进客户合作", impactSummary: "专业合作" },
      { id: "B", text: "认真考虑和陈总监的关系，看是否有新的情感可能", impactSummary: "情感试探" },
      { id: "C", text: "减少项目投入", impactSummary: "控制精力" }
    ]
  },
  targetAgeInMonths: 984,
  people: [],
  worldState: { people: [], directionArcs: [], pressureArcs: [], relationships: [], version: 2 }
}).some((issue) => issue.code === "relationship_authority_conflict"));

assert.equal(validateStoryConsistency({
  node: {
    ...node,
    description: "你目前没有伴侣，但开始重新安排生活。",
    choices: [
      { id: "A", text: "主动参加社交活动，未来认真考虑婚姻和家庭的可能性", impactSummary: "开放社交" },
      { id: "B", text: "继续专注工作", impactSummary: "事业优先" },
      { id: "C", text: "增加运动时间", impactSummary: "改善健康" }
    ]
  },
  targetAgeInMonths: 984,
  people: [],
  worldState: { people: [], directionArcs: [], pressureArcs: [], relationships: [], version: 2 }
}).some((issue) => issue.code === "relationship_authority_conflict"), false);

assert.equal(validateStoryConsistency({
  node: {
    ...node,
    description: "与伴侣坦诚沟通后，你们约定先分开一段时间。半年后，对方平静地说你们已经走散。分手后，你偶尔会想起前任，但还没准备好开始新关系。"
  },
  targetAgeInMonths: 984,
  people: [romanticPerson],
  worldState: {
    ...romanticWorld("dating"),
    relationships: [{
      ...romanticWorld("dating").relationships[0],
      stage: "separated" as const,
      status: "ended" as const
    }]
  }
}).some((issue) => issue.code === "relationship_authority_conflict"), false);

assert.ok(validateStoryConsistency({
  node: {
    ...node,
    description: "你和前任已经分手。后来你认识了新的伴侣，你们正式交往。"
  },
  targetAgeInMonths: 984,
  people: [romanticPerson],
  worldState: {
    ...romanticWorld("dating"),
    relationships: [{
      ...romanticWorld("dating").relationships[0],
      stage: "separated" as const,
      status: "ended" as const
    }]
  }
}).some((issue) => issue.code === "relationship_authority_conflict"));

assert.equal(validateStoryConsistency({
  node: { ...node, description: "你们讨论是否正式交往，也谈到未来共同生活的现实条件。" },
  targetAgeInMonths: 984,
  people: [romanticPerson],
  worldState: romanticWorld("exploring")
}).some((issue) => issue.code === "relationship_authority_conflict"), false);

assert.equal(validateStoryConsistency({
  node: {
    ...node,
    description: "你开始使用社交软件，见过几个对象，但都没能深入发展。你想，也许以后会重新打开心扉去建立亲密关系。",
    choices: [
      { id: "A", text: "继续拓展普通社交活动", impactSummary: "增加接触" },
      { id: "B", text: "把时间留给职业提升", impactSummary: "专注事业" },
      { id: "C", text: "保持当前生活节奏", impactSummary: "保持稳定" }
    ]
  },
  targetAgeInMonths: 984,
  people: [],
  worldState: { people: [], directionArcs: [], pressureArcs: [], relationships: [], version: 2 }
}).some((issue) => issue.code === "relationship_authority_conflict"), false);

const staleRomanticCharacterNode = {
  ...node,
  narrativeMeta: {
    elapsedMonths: 12,
    elapsedYears: 1,
    lifeIntensity: "normal" as const,
    nodeMateriality: "decision_checkpoint" as const,
    storyEpisode: { id: "episode", startAgeInMonths: 972, endAgeInMonths: 984, internalTransitions: [], decisionCheckpointId: "choice", summary: "普通节点" },
    recoveryState: "neutral" as const,
    recoveryEvidence: [],
    arcSignals: [],
    activeCharacters: [
      { personId: "person_former", relation: "other" as const, presenceMode: "active_scene" as const, currentRole: "romantic_interest", candidateOrdinal: 0 },
      { personId: "person_parent", relation: "parent" as const, presenceMode: "active_scene" as const, currentRole: "family", candidateOrdinal: 1 }
    ],
    worldDeltas: []
  }
};
const strippedRomanticCharacterNode = stripUnauthorizedRomanticCharacters(
  staleRomanticCharacterNode,
  { people: [], directionArcs: [], pressureArcs: [], relationships: [], version: 2 }
);
assert.deepEqual(strippedRomanticCharacterNode.narrativeMeta?.activeCharacters, []);

const exploringChoiceNode = stripUnauthorizedRelationshipChoices({
  ...node,
  choices: [
    { id: "A", text: "正式开始恋爱关系", impactSummary: "越级推进" },
    { id: "B", text: "保持边界，继续观察", impactSummary: "观察" },
    { id: "C", text: "优先处理当前工作", impactSummary: "工作" }
  ]
}, {
  people: [],
  directionArcs: [],
  pressureArcs: [],
  relationships: [{
    id: "romance",
    participantPersonIds: ["self", "candidate"],
    type: "romantic",
    status: "active",
    stage: "exploring",
    effectiveFromAgeInMonths: 972,
    source: "accepted_history",
    confidence: 1
  }],
  version: 2
});
assert.deepEqual(exploringChoiceNode.choices.map((choice) => choice.id), ["B", "C"]);

assert.ok(validateStoryConsistency({
  node: {
    ...node,
    description: "你在新岗位站稳脚跟，也认识了一些新同事。",
    choices: [
      { id: "A", text: "鼓励新认识的女生迁居，等双方关系稳定后再规划共同生活", impactSummary: "推进关系" },
      { id: "B", text: "继续当前工作", impactSummary: "保持节奏" },
      { id: "C", text: "回家看望父母", impactSummary: "家庭联系" }
    ],
    narrativeMeta: {
      elapsedMonths: 12,
      elapsedYears: 1,
      lifeIntensity: "normal",
      nodeMateriality: "decision_checkpoint",
      storyEpisode: { id: "episode", startAgeInMonths: 972, endAgeInMonths: 984, internalTransitions: [], decisionCheckpointId: "choice", summary: "普通节点" },
      recoveryState: "neutral",
      recoveryEvidence: [],
      arcSignals: [],
      activeCharacters: [{ personId: "person_former", relation: "other", presenceMode: "active_scene", currentRole: "romantic_interest", candidateOrdinal: 0 }],
      worldDeltas: []
    }
  },
  targetAgeInMonths: 984,
  people: [],
  worldState: { people: [], directionArcs: [], pressureArcs: [], relationships: [], version: 2 }
}).some((issue) => issue.code === "relationship_authority_conflict"));

assert.equal(validateStoryConsistency({
  node: {
    ...node,
    eventMeta: { eventId: "romance_new_connection", eventTags: [], routeLine: "romance" },
    description: "你在行业活动上认识了一个女生，活动后交换了联系方式。",
    choices: [
      { id: "A", text: "继续了解这个新认识的女生", impactSummary: "继续了解" },
      { id: "B", text: "保持普通认识", impactSummary: "普通联系" },
      { id: "C", text: "不发展浪漫关系", impactSummary: "明确婉拒" }
    ]
  },
  targetAgeInMonths: 984,
  people: [],
  worldState: { people: [], directionArcs: [], pressureArcs: [], relationships: [], version: 2 }
}).some((issue) => issue.code === "relationship_authority_conflict"), false);

assert.equal(containsForbiddenArcWrite({ narrativeMeta: { nextPhaseId: "growth" } }), true);
const sanitizedArcOutput = stripForbiddenArcWrites({
  title: "保留的节点",
  nextPhaseId: "growth",
  narrativeMeta: {
    phaseCheckpointCount: 2,
    arcSignals: [{ type: "pressure_resolved", evidence: "压力趋稳", nextPressureArcStatus: "resolved" }]
  },
  choices: [{ id: "A", foregroundPressureArcId: "arc-model-write" }]
});
assert.deepEqual(sanitizedArcOutput, {
  title: "保留的节点",
  narrativeMeta: {
    arcSignals: [{ type: "pressure_resolved", evidence: "压力趋稳" }]
  },
  choices: [{ id: "A" }]
});
assert.equal(containsForbiddenArcWrite(sanitizedArcOutput), false);

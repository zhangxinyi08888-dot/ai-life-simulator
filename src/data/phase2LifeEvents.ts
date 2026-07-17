import type { HistoryItem, LifeAttributes } from "../types";
import type { LifeEventSeed } from "./lifeEvents";

const ADAPTATION = ["年龄只调整执行方式、风险和支持条件，不得删除该人生方向。"];

interface Phase2EventDefinition extends Omit<LifeEventSeed,
  "dispatchMode" | "minAge" | "maxAge" | "ageAffinity" | "conditionDescription" | "tags" | "fingerprint" | "trigger"
> {
  preferredRange: [number, number];
  conditionDescription: string;
  tags: string[];
  trigger?: LifeEventSeed["trigger"];
  temporal: { lifeIntensity: "normal" | "stable"; durationMonths: [number, number] };
}

function phase2Event(definition: Phase2EventDefinition): LifeEventSeed {
  const { preferredRange, temporal, ...event } = definition;
  return {
    ...event,
    dispatchMode: "random",
    minAge: preferredRange[0],
    maxAge: preferredRange[1],
    ageAffinity: {
      preferredRange,
      minimumMultiplier: 0.4,
      outsideRangeAdaptations: ADAPTATION
    },
    fingerprint: {
      category: event.category,
      tags: event.tags,
      intensity: "minor"
    },
    trigger: definition.trigger || { eligibility: () => true },
    intent: {
      ...event.intent,
      temporalProfile: {
        ...temporal,
        requiresFollowUp: false
      }
    }
  };
}

function ageInMonths(item: HistoryItem): number {
  return item.ageInMonths ?? item.age * 12;
}

function selectedIntent(item: HistoryItem): string {
  if (item.selectedDecisionIntent) return item.selectedDecisionIntent;
  const selected = item.choices.find((choice) => item.selectedChoice.includes(choice.text));
  return selected?.decisionIntent || item.selectedChoice;
}

function textInHistory(history: HistoryItem[] = [], pattern: RegExp, count = 10): boolean {
  return history.slice(-count).some((item) => pattern.test(
    `${item.title} ${item.description} ${item.selectedChoice} ${selectedIntent(item)}`
  ));
}

function elapsedSinceMatchingIntent(history: HistoryItem[] = [], age: number, pattern: RegExp): number | undefined {
  const match = history.find((item) => pattern.test(selectedIntent(item)));
  return match ? age * 12 - ageInMonths(match) : undefined;
}

function hasRecentMajor(history: HistoryItem[] = [], category?: string): boolean {
  return history.slice(-4).some((item) => (
    item.eventMeta?.eventIntensity === "major"
    && (!category || item.eventMeta.eventCategory === category)
  ));
}

function latestFinancialState(history: HistoryItem[] = []) {
  return [...history].reverse().find((item) => item.financialState)?.financialState;
}

function healthArcPhase(history: HistoryItem[] = [], phases: string[]): boolean {
  return Boolean([...history].reverse().find((item) => item.worldStateSnapshot)?.worldStateSnapshot?.pressureArcs.some((arc) => (
    arc.phasePolicyId === "health_crisis_v1" && phases.includes(arc.phaseId) && arc.status !== "resolved"
  )));
}

function latestWorld(history: HistoryItem[] = []) {
  return [...history].reverse().find((item) => item.worldStateSnapshot)?.worldStateSnapshot;
}

function hasReliablePeer(history: HistoryItem[] = []): boolean {
  return Boolean(latestWorld(history)?.people.some((person) => (
    ["friend", "colleague", "mentor"].includes(person.relation)
    && person.source !== "model_inferred"
    && person.confidence >= 0.7
    && !["distant", "deceased"].includes(person.lifeStatus)
  )));
}

function countSelectedIntents(history: HistoryItem[] = [], pattern: RegExp, withinNodes = history.length): number {
  return history.slice(-withinNodes).filter((item) => pattern.test(selectedIntent(item))).length;
}

function noAcuteHealthArc(history: HistoryItem[] = []): boolean {
  return !healthArcPhase(history, ["trigger", "acute"]);
}

function attributeChanged(
  history: HistoryItem[] = [],
  attribs: LifeAttributes,
  attribute: keyof LifeAttributes,
  minimum: number,
  direction: "up" | "down"
): boolean {
  const earliest = history[0];
  if (!earliest) return false;
  const delta = attribs[attribute] - earliest.attributes[attribute];
  return direction === "up" ? delta >= minimum : delta <= -minimum;
}

export const PHASE2_LIFE_EVENTS: LifeEventSeed[] = [
  phase2Event({
    id: "career_gradual_transition_window",
    category: "career",
    narrativeMode: "crossroads_opportunity",
    semanticFamily: "career_transition",
    title: "渐进式转型窗口",
    preferredRange: [20, 70],
    conditionDescription: "已有职业或创作方向出现可小规模验证的新路径",
    cooldown: 5,
    baseProbability: 0.68,
    tags: ["career", "transition", "pilot", "opportunity"],
    requiredContextGroups: [["career_active"], ["career_or_creation_direction"]],
    trigger: { eligibility: (_attribs, _userData, _age, history = []) => noAcuteHealthArc(history) },
    historyConditionGroups: [],
    intent: {
      type: "career_gradual_transition_window",
      meaning: "现有路径出现一个可以小规模试验的新方向，不必立即辞职或孤注一掷。",
      tensionAxes: ["当前稳定 vs 新方向", "完整转型 vs 小步试点", "短期效率 vs 长期适配"],
      allowedOutcomes: ["run_transition_pilot", "prepare_before_switching", "keep_current_path_with_review_date"],
      emotionalTone: "crossroads"
    },
    temporal: { lifeIntensity: "normal", durationMonths: [6, 18] }
  }),
  phase2Event({
    id: "career_scope_redefinition",
    category: "career",
    narrativeMode: "crossroads_opportunity",
    semanticFamily: "career_scope_change",
    title: "重新定义工作边界",
    preferredRange: [22, 75],
    conditionDescription: "已有工作责任或负荷需要重新划定规模、分工和边界",
    cooldown: 5,
    baseProbability: 0.62,
    tags: ["career", "scope_change", "boundary", "responsibility"],
    requiredContextGroups: [["career_active"]],
    historyConditionGroups: [
      [{ type: "selected_intent_count", intentPrefixes: ["career:expand", "career:accept_responsibility"], minCount: 1, withinNodes: 6 }],
      [{ type: "attribute_trend", attribute: "health", direction: "declining", withinNodes: 3, minimumDelta: 4 }],
      [{ type: "attribute_trend", attribute: "happiness", direction: "declining", withinNodes: 3, minimumDelta: 4 }]
    ],
    intent: {
      type: "career_scope_redefinition",
      meaning: "角色可以重新定义职责、规模和工作方式，而不是只能继续或退出。",
      tensionAxes: ["影响力 vs 可持续性", "收入 vs 自主边界", "完整承担 vs 重新分工"],
      allowedOutcomes: ["narrow_scope_keep_core", "delegate_and_share_responsibility", "maintain_scope_with_explicit_limits"],
      emotionalTone: "crossroads"
    },
    temporal: { lifeIntensity: "normal", durationMonths: [6, 18] }
  }),
  phase2Event({
    id: "career_skill_compounding",
    category: "career",
    narrativeMode: "recovery_growth",
    semanticFamily: "career_skill_growth",
    title: "能力开始形成复利",
    preferredRange: [18, 90],
    conditionDescription: "同一职业或创作能力经过持续练习开始形成复利",
    cooldown: 5,
    baseProbability: 0.72,
    tags: ["career", "skill_growth", "accumulation", "flourishing"],
    requiredContextGroups: [["career_or_creation_direction"]],
    trigger: { eligibility: (_attribs, _userData, age, history = []) => (elapsedSinceMatchingIntent(history, age, /career:(learn|practice)|growth:study|creation:practice/i) ?? -1) >= 6 },
    historyConditionGroups: [[{ type: "selected_intent_count", intentPrefixes: ["career:learn", "career:practice", "growth:study", "creation:practice"], minCount: 2, withinNodes: 8 }]],
    intent: {
      type: "career_skill_compounding",
      meaning: "反复练习开始转化为更稳定的判断、效率或作品质量。",
      tensionAxes: ["继续深挖 vs 扩大应用", "专业深度 vs 可见成果", "个人能力 vs 协作影响"],
      allowedOutcomes: ["deepen_specialty", "apply_skill_to_real_project", "share_skill_with_others"],
      emotionalTone: "flourishing"
    },
    temporal: { lifeIntensity: "normal", durationMonths: [12, 24] }
  }),
  phase2Event({
    id: "career_project_recognition",
    category: "career",
    narrativeMode: "recovery_growth",
    semanticFamily: "career_recognition",
    title: "项目获得真实认可",
    preferredRange: [20, 85],
    conditionDescription: "持续推进的项目或作品获得具体外部反馈和认可",
    cooldown: 7,
    baseProbability: 0.58,
    tags: ["career", "recognition", "project", "flourishing"],
    requiredContextGroups: [["career_or_creation_direction"]],
    historyConditionGroups: [[
      { type: "selected_intent_count", intentPrefixes: ["career:project", "career:continue", "creation:practice", "creation:publish", "growth:create"], minCount: 2, withinNodes: 10 },
      { type: "event_absent", semanticFamilies: ["career_recognition"], withinNodes: 6 },
      { type: "attribute_trend", attribute: "intelligence", direction: "stable", withinNodes: 3, minimumDelta: 2 }
    ], [
      { type: "selected_intent_count", intentPrefixes: ["career:project", "career:continue", "creation:practice", "creation:publish", "growth:create"], minCount: 2, withinNodes: 10 },
      { type: "event_absent", semanticFamilies: ["career_recognition"], withinNodes: 6 },
      { type: "attribute_trend", attribute: "intelligence", direction: "improving", withinNodes: 3, minimumDelta: 1 }
    ]],
    intent: {
      type: "career_project_recognition",
      meaning: "此前投入第一次得到具体外部反馈、采用、收入、职责或信誉上的认可。",
      tensionAxes: ["扩大影响 vs 保持质量", "兑现成果 vs 继续打磨", "个人所有权 vs 团队共享"],
      allowedOutcomes: ["scale_recognized_work", "protect_quality_and_consolidate", "convert_recognition_into_long_term_position"],
      emotionalTone: "flourishing"
    },
    temporal: { lifeIntensity: "normal", durationMonths: [12, 30] }
  }),
  phase2Event({
    id: "career_long_project_completion",
    category: "career",
    narrativeMode: "recovery_growth",
    semanticFamily: "career_completion",
    title: "长期项目阶段完成",
    preferredRange: [22, 100],
    conditionDescription: "同一长期项目经过足够时间形成阶段完成结果",
    cooldown: 8,
    baseProbability: 0.52,
    tags: ["career", "project_completion", "reflection", "closure"],
    requiredContextGroups: [["career_or_creation_direction"]],
    trigger: { eligibility: (_attribs, _userData, age, history = []) => (elapsedSinceMatchingIntent(history, age, /career:|creation:|growth:create/i) ?? -1) >= 18 },
    historyConditionGroups: [[
      { type: "selected_intent_count", intentPrefixes: ["career:", "creation:", "growth:create"], minCount: 3, withinNodes: 12 },
      { type: "event_absent", semanticFamilies: ["career_completion"], withinNodes: 8 }
    ]],
    intent: {
      type: "career_long_project_completion",
      meaning: "一项持续多年的工作、研究、经营或创作完成阶段成果，角色需要决定如何收束或延伸。",
      tensionAxes: ["完成感 vs 新目标", "公开成果 vs 私人意义", "继续扩张 vs 有意识收束"],
      allowedOutcomes: ["close_project_and_integrate_learning", "extend_project_into_next_stage", "share_or_publish_completed_work"],
      emotionalTone: "reflection"
    },
    temporal: { lifeIntensity: "stable", durationMonths: [18, 36] }
  }),
  phase2Event({
    id: "career_sustainable_work_rhythm",
    category: "career",
    narrativeMode: "stability_meaning",
    semanticFamily: "career_sustainable_rhythm",
    title: "可持续的工作节奏",
    preferredRange: [20, 100],
    conditionDescription: "已有工作在非危机状态下逐渐形成可持续节奏",
    cooldown: 4,
    baseProbability: 0.72,
    tags: ["career", "sustainable_rhythm", "boundary", "stability"],
    requiredContextGroups: [["career_active"]],
    trigger: { eligibility: (attribs, _userData, _age, history = []) => attribs.health >= 42 && !hasRecentMajor(history) },
    historyConditionGroups: [],
    intent: {
      type: "career_sustainable_work_rhythm",
      meaning: "工作没有发生戏剧性变化，但职责、节奏和生活边界逐渐稳定。",
      tensionAxes: ["稳定节奏 vs 适度进步", "可靠交付 vs 个人空间", "习惯延续 vs 小幅优化"],
      allowedOutcomes: ["maintain_sustainable_rhythm", "improve_one_work_habit", "reserve_time_for_non_work_direction"],
      emotionalTone: "everyday"
    },
    temporal: { lifeIntensity: "stable", durationMonths: [18, 48] }
  }),
  phase2Event({
    id: "career_mentorship_reciprocity",
    category: "career",
    narrativeMode: "stability_meaning",
    semanticFamily: "career_mentorship",
    title: "经验开始流动",
    preferredRange: [25, 100],
    conditionDescription: "已形成的经验或同行关系开始产生双向学习",
    cooldown: 7,
    baseProbability: 0.52,
    tags: ["career", "mentorship", "connection", "growth"],
    requiredContextGroups: [["career_active"]],
    trigger: { eligibility: (attribs, _userData, _age, history = []) => {
      const peer = hasReliablePeer(history);
      const skillEvidence = countSelectedIntents(history, /career:(learn|practice|complete|recognition)|creation:/i, 8) >= 1;
      return (attribs.intelligence >= 58 || peer) && (skillEvidence || peer);
    } },
    historyConditionGroups: [],
    intent: {
      type: "career_mentorship_reciprocity",
      meaning: "角色在同行、导师或后辈关系中交换经验，同时重新理解自己的专业位置。",
      tensionAxes: ["独立完成 vs 共同成长", "输出经验 vs 继续学习", "个人成绩 vs 群体能力"],
      allowedOutcomes: ["mentor_with_boundaries", "build_peer_learning_exchange", "remain_learner_and_seek_feedback"],
      emotionalTone: "connection"
    },
    temporal: { lifeIntensity: "stable", durationMonths: [12, 36] }
  }),
  phase2Event({
    id: "career_craft_meaning",
    category: "career",
    narrativeMode: "stability_meaning",
    semanticFamily: "career_craft_meaning",
    title: "在专业日常中找到意义",
    preferredRange: [18, 110],
    conditionDescription: "长期专业或创作实践形成个人标准和意义",
    cooldown: 6,
    baseProbability: 0.62,
    tags: ["career", "craft", "meaning", "stability"],
    requiredContextGroups: [["career_active"], ["career_or_creation_direction"]],
    trigger: { eligibility: (_attribs, _userData, _age, history = []) => !textInHistory(history, /强制停工|职业危机|裁员|被解雇/, 3) },
    historyConditionGroups: [
      [{ type: "selected_intent_count", intentPrefixes: ["career:", "creation:"], minCount: 2, withinNodes: 8 }],
      [{ type: "direction_reinforcement_count", minCount: 2 }]
    ],
    intent: {
      type: "career_craft_meaning",
      meaning: "长期做一件事形成了秩序、身份和个人标准，价值不再只来自职位或收入。",
      tensionAxes: ["外部评价 vs 内在标准", "效率 vs 手艺", "持续实践 vs 寻找新刺激"],
      allowedOutcomes: ["deepen_personal_standard", "connect_craft_to_daily_life", "open_craft_to_new_context"],
      emotionalTone: "reflection"
    },
    temporal: { lifeIntensity: "stable", durationMonths: [24, 60] }
  }),
  phase2Event({
    id: "relationship_mutual_commitment_window",
    category: "relationship",
    narrativeMode: "crossroads_opportunity",
    semanticFamily: "relationship_commitment",
    title: "双方承诺窗口",
    preferredRange: [20, 80],
    conditionDescription: "已确认的伴侣关系进入双方共同定义承诺的阶段",
    cooldown: 7,
    baseProbability: 0.58,
    tags: ["relationship", "commitment", "mutual_plan", "crossroads"],
    requiredContextGroups: [["confirmed_partner"]],
    historyConditionGroups: [[
      { type: "selected_intent_count", intentPrefixes: ["relationship:communicate", "relationship:cooperate", "relationship:plan", "relationship:commit"], minCount: 1, withinNodes: 8 },
      { type: "event_absent", semanticFamilies: ["relationship_commitment"], withinNodes: 8 }
    ]],
    intent: {
      type: "relationship_mutual_commitment_window",
      meaning: "关系走到需要双方共同定义承诺、生活安排和边界的阶段。",
      tensionAxes: ["亲密 vs 自主", "共同计划 vs 各自方向", "承诺形式 vs 实际协作"],
      allowedOutcomes: ["make_mutual_commitment_plan", "delay_commitment_with_clear_conditions", "redefine_relationship_scope"],
      emotionalTone: "crossroads"
    },
    temporal: { lifeIntensity: "normal", durationMonths: [6, 18] }
  }),
  phase2Event({
    id: "relationship_release_and_reorientation",
    category: "relationship",
    narrativeMode: "crossroads_opportunity",
    semanticFamily: "relationship_release",
    title: "放手与重新定向",
    preferredRange: [18, 100],
    conditionDescription: "经持续尝试仍不匹配的重要关系需要结束或重定义",
    cooldown: 8,
    baseProbability: 0.54,
    tags: ["relationship", "release", "boundary", "reflection"],
    requiredContextGroups: [["confirmed_partner"], ["confirmed_friend_or_colleague"]],
    trigger: { eligibility: (attribs, _userData, _age, history = []) => textInHistory(history, /不匹配|距离|异地|边界冲突|长期冲突|关系疏远/, 8) && !attributeChanged(history.slice(-3), attribs, "relation", 3, "up") && !attributeChanged(history.slice(-3), attribs, "happiness", 3, "up") },
    historyConditionGroups: [[{ type: "selected_intent_count", intentPrefixes: ["relationship:adjust", "relationship:communicate", "relationship:set_boundary", "relationship:repair", "relationship:reduce_contact"], minCount: 2, withinNodes: 8 }]],
    intent: {
      type: "relationship_release_and_reorientation",
      meaning: "持续尝试后，角色可以选择结束、降低关系强度或重新定义彼此位置。",
      tensionAxes: ["维持熟悉 vs 接受结束", "责任感 vs 自我保护", "失去关系 vs 释放未来空间"],
      allowedOutcomes: ["end_relationship_with_clarity", "reduce_contact_and_redefine_role", "attempt_one_bounded_repair"],
      emotionalTone: "reflection"
    },
    temporal: { lifeIntensity: "normal", durationMonths: [6, 18] }
  }),
  phase2Event({
    id: "relationship_shared_problem_solving",
    category: "relationship",
    narrativeMode: "recovery_growth",
    semanticFamily: "relationship_cooperation",
    title: "共同解决现实问题",
    preferredRange: [18, 100],
    conditionDescription: "沟通和分工开始形成共同解决现实问题的能力",
    cooldown: 5,
    baseProbability: 0.7,
    tags: ["relationship", "cooperation", "responsibility", "repair"],
    requiredContextGroups: [["confirmed_partner"], ["confirmed_family"]],
    trigger: { eligibility: (_attribs, _userData, age, history = []) => (elapsedSinceMatchingIntent(history, age, /relationship:(communicate|share_responsibility|set_boundary)/i) ?? -1) >= 3 },
    historyConditionGroups: [[{ type: "selected_intent_count", intentPrefixes: ["relationship:communicate", "relationship:share_responsibility", "relationship:set_boundary"], minCount: 1, withinNodes: 8 }]],
    intent: {
      type: "relationship_shared_problem_solving",
      meaning: "此前的沟通或边界开始转化为更清楚的分工和共同解决问题的能力。",
      tensionAxes: ["独自承担 vs 共同负责", "效率 vs 彼此感受", "旧习惯 vs 新协作方式"],
      allowedOutcomes: ["formalize_shared_responsibility", "keep_testing_new_cooperation", "request_more_specific_support"],
      emotionalTone: "connection"
    },
    temporal: { lifeIntensity: "normal", durationMonths: [6, 18] }
  }),
  phase2Event({
    id: "relationship_trust_rebuilding",
    category: "relationship",
    narrativeMode: "recovery_growth",
    semanticFamily: "relationship_trust_repair",
    title: "信任逐步重建",
    preferredRange: [18, 100],
    conditionDescription: "关系裂纹后通过连续一致行动逐步重建信任",
    cooldown: 7,
    baseProbability: 0.56,
    tags: ["relationship", "trust_repair", "connection", "recovery"],
    requiredContextGroups: [["confirmed_partner"], ["confirmed_friend_or_colleague"]],
    trigger: { eligibility: (attribs, _userData, _age, history = []) => textInHistory(history, /信任|裂纹|背叛|边界|共同利益|trust|boundary/, 10) && !attributeChanged(history.slice(-3), attribs, "relation", 1, "down") },
    historyConditionGroups: [[
      { type: "selected_intent_count", intentPrefixes: ["relationship:repair", "relationship:communicate", "relationship:honesty"], minCount: 2, withinNodes: 10 }
    ]],
    intent: {
      type: "relationship_trust_rebuilding",
      meaning: "信任不是一次谈话恢复，而是在连续一致的行动中重新形成。",
      tensionAxes: ["再次信任 vs 保留保护", "原谅 vs 核实变化", "恢复亲密 vs 接受新的边界"],
      allowedOutcomes: ["restore_trust_gradually", "maintain_relationship_with_safeguards", "acknowledge_partial_repair_only"],
      emotionalTone: "connection"
    },
    temporal: { lifeIntensity: "normal", durationMonths: [9, 24] }
  }),
  phase2Event({
    id: "relationship_boundary_aftercare",
    category: "relationship",
    narrativeMode: "recovery_growth",
    semanticFamily: "relationship_boundary_growth",
    title: "建立边界后的关系变化",
    preferredRange: [18, 110],
    conditionDescription: "建立边界后关系进入适应、修正和稳定阶段",
    cooldown: 6,
    baseProbability: 0.66,
    tags: ["relationship", "boundary", "aftercare", "growth"],
    requiredContextGroups: [["confirmed_partner"], ["confirmed_family"], ["confirmed_friend_or_colleague"]],
    historyConditionGroups: [[{ type: "selected_intent_count", intentPrefixes: ["relationship:set_boundary", "relationship:reduce_contact", "relationship:renegotiate_support"], minCount: 1, withinNodes: 8 }]],
    intent: {
      type: "relationship_boundary_aftercare",
      meaning: "边界产生了真实后果：可能减少冲突、带来距离，也可能迫使关系重新协商。",
      tensionAxes: ["边界稳定 vs 关系温度", "短期不适 vs 长期尊重", "解释自己 vs 允许他人适应"],
      allowedOutcomes: ["hold_boundary_consistently", "soften_delivery_keep_boundary", "revise_boundary_based_on_results"],
      emotionalTone: "reflection"
    },
    temporal: { lifeIntensity: "normal", durationMonths: [6, 18] }
  }),
  phase2Event({
    id: "relationship_family_responsibility_rebalanced",
    category: "relationship",
    narrativeMode: "recovery_growth",
    semanticFamily: "family_responsibility_rebalance",
    title: "家庭责任重新分配",
    preferredRange: [20, 100],
    conditionDescription: "家庭义务经过协商开始形成更可持续的分担",
    cooldown: 7,
    baseProbability: 0.58,
    tags: ["relationship", "family_obligation", "boundary", "rebalance"],
    requiredContextGroups: [["confirmed_family"]],
    trigger: { eligibility: (_attribs, _userData, age, history = []) => textInHistory(history, /家庭义务|照护|家人.*责任|资源压力/, 10) && (elapsedSinceMatchingIntent(history, age, /relationship:(negotiate|seek_support|refuse|set_boundary)/i) ?? -1) >= 6 },
    historyConditionGroups: [[{ type: "selected_intent_count", intentPrefixes: ["relationship:negotiate", "relationship:seek_support", "relationship:refuse", "relationship:set_boundary"], minCount: 1, withinNodes: 10 }]],
    intent: {
      type: "relationship_family_responsibility_rebalanced",
      meaning: "原本集中在一个人身上的家庭责任开始重新分配，角色获得更可持续的位置。",
      tensionAxes: ["公平分担 vs 家庭习惯", "照顾他人 vs 保留生活", "短期摩擦 vs 长期秩序"],
      allowedOutcomes: ["formalize_family_role_split", "accept_limited_role_with_support", "reopen_negotiation_for_unresolved_load"],
      emotionalTone: "connection"
    },
    temporal: { lifeIntensity: "normal", durationMonths: [6, 24] }
  }),
  phase2Event({
    id: "relationship_daily_companionship",
    category: "relationship",
    narrativeMode: "stability_meaning",
    semanticFamily: "relationship_companionship",
    title: "稳定陪伴的日常",
    preferredRange: [18, 110],
    conditionDescription: "可靠关系通过普通陪伴和共同安排积累安全感",
    cooldown: 5,
    baseProbability: 0.7,
    tags: ["relationship", "companionship", "routine", "connection"],
    requiredContextGroups: [["confirmed_partner"], ["confirmed_family"]],
    trigger: { eligibility: (_attribs, _userData, _age, history = []) => !hasRecentMajor(history, "relationship") },
    historyConditionGroups: [],
    intent: {
      type: "relationship_daily_companionship",
      meaning: "关系通过普通陪伴、共同安排和重复的小行动形成安全感。",
      tensionAxes: ["共同时间 vs 各自空间", "习惯稳定 vs 保持新鲜", "照顾彼此 vs 保留自主"],
      allowedOutcomes: ["strengthen_shared_routine", "protect_individual_space", "create_one_new_shared_practice"],
      emotionalTone: "connection"
    },
    temporal: { lifeIntensity: "stable", durationMonths: [12, 36] }
  }),
  phase2Event({
    id: "relationship_friendship_deepening",
    category: "relationship",
    narrativeMode: "stability_meaning",
    semanticFamily: "friendship_deepening",
    title: "友谊与同行连接深化",
    preferredRange: [18, 110],
    conditionDescription: "已存在的朋友、同事或导师关系通过长期往来深化",
    cooldown: 6,
    baseProbability: 0.6,
    tags: ["relationship", "friendship", "connection", "stability"],
    requiredContextGroups: [["confirmed_friend_or_colleague"]],
    historyConditionGroups: [],
    intent: {
      type: "relationship_friendship_deepening",
      meaning: "一段非亲密伴侣关系通过长期往来形成信任、支持或共同兴趣。",
      tensionAxes: ["依赖 vs 互相支持", "坦诚 vs 保留边界", "共同经历 vs 各自生活"],
      allowedOutcomes: ["invest_in_friendship_consistently", "share_a_real_difficulty", "build_a_shared_activity"],
      emotionalTone: "connection"
    },
    temporal: { lifeIntensity: "stable", durationMonths: [12, 36] }
  }),
  phase2Event({
    id: "health_support_plan_choice",
    category: "health",
    narrativeMode: "crossroads_opportunity",
    semanticFamily: "health_support_plan",
    title: "支持与治疗安排选择",
    preferredRange: [18, 110],
    conditionDescription: "健康问题明确后需要选择治疗、减负和支持安排",
    cooldown: 6,
    baseProbability: 0.62,
    tags: ["health", "support_plan", "crossroads", "recovery"],
    requiredContextGroups: [["health_recovery_context"]],
    trigger: { eligibility: (attribs, _userData, _age, history = []) => attribs.health >= 30 && attribs.health <= 55 && noAcuteHealthArc(history) },
    historyConditionGroups: [[
      { type: "elapsed_since_event", eventIds: ["health_system_warning", "health_recovery_observation"], minMonths: 0 },
      { type: "event_absent", semanticFamilies: ["health_support_plan"], withinNodes: 6 }
    ]],
    intent: {
      type: "health_support_plan_choice",
      meaning: "健康问题已经明确，角色需要选择怎样安排治疗、负荷、支持和原有人生方向。",
      tensionAxes: ["专业支持 vs 自我管理", "短期停顿 vs 调整后继续", "隐私自主 vs 接受帮助"],
      allowedOutcomes: ["seek_structured_health_support", "reduce_load_with_monitoring_plan", "coordinate_support_and_continue_adjusted_goal"],
      emotionalTone: "crossroads"
    },
    temporal: { lifeIntensity: "normal", durationMonths: [3, 9] }
  }),
  phase2Event({
    id: "health_recovery_progress",
    category: "health",
    narrativeMode: "recovery_growth",
    semanticFamily: "health_recovery_progress",
    title: "恢复开始出现证据",
    preferredRange: [18, 110],
    conditionDescription: "持续治疗或减负后出现可观察的恢复证据",
    cooldown: 5,
    baseProbability: 0.72,
    tags: ["health", "recovery_progress", "improvement", "observation"],
    requiredContextGroups: [["health_recovery_context"]],
    trigger: { eligibility: (attribs, _userData, age, history = []) => {
      const intentElapsed = elapsedSinceMatchingIntent(history, age, /health:(reduce_load|seek_support|treatment)/i);
      const historyPath = typeof intentElapsed === "number" && intentElapsed >= 6
        && attributeChanged(history.slice(-3), attribs, "health", 3, "up");
      const arcPath = healthArcPhase(history, ["recovery", "operation"])
        && !history.slice(-2).every((item) => item.narrativeMeta?.recoveryState === "depleted");
      return historyPath || arcPath;
    } },
    historyConditionGroups: [
      [
        { type: "selected_intent_count", intentPrefixes: ["health:reduce_load", "health:seek_support", "health:treatment"], minCount: 2, withinNodes: 8 },
        { type: "attribute_trend", attribute: "health", direction: "improving", withinNodes: 3, minimumDelta: 3 }
      ],
      [{ type: "pressure_arc_state", phasePolicyIds: ["health_crisis_v1"], phaseIds: ["recovery", "operation"], statuses: ["active", "stabilizing"] }]
    ],
    intent: {
      type: "health_recovery_progress",
      meaning: "持续调整开始转化为症状、体力、睡眠或生活能力上的可观察改善。",
      tensionAxes: ["扩大活动 vs 保护恢复", "回到旧节奏 vs 建立新节奏", "短期好转 vs 长期稳定"],
      allowedOutcomes: ["consolidate_recovery_plan", "resume_activity_gradually", "adjust_plan_based_on_remaining_limits"],
      emotionalTone: "flourishing"
    },
    temporal: { lifeIntensity: "normal", durationMonths: [3, 12] }
  }),
  phase2Event({
    id: "health_function_return",
    category: "health",
    narrativeMode: "recovery_growth",
    semanticFamily: "health_function_return",
    title: "生活能力逐步恢复",
    preferredRange: [18, 110],
    conditionDescription: "健康改善开始转化为日常生活能力恢复",
    cooldown: 7,
    baseProbability: 0.56,
    tags: ["health", "function_return", "recovery", "flourishing"],
    requiredContextGroups: [["health_recovery_context"]],
    trigger: { eligibility: (attribs, _userData, _age, history = []) => attributeChanged(history.slice(-3), attribs, "health", 5, "up") && history.slice(-2).some((item) => item.narrativeMeta?.recoveryState === "protected") },
    historyConditionGroups: [[
      { type: "elapsed_since_event", eventIds: ["health_forced_pause", "health_recovery_observation", "health_recovery_progress"], minMonths: 9 },
      { type: "attribute_trend", attribute: "health", direction: "improving", withinNodes: 3, minimumDelta: 5 }
    ]],
    intent: {
      type: "health_function_return",
      meaning: "恢复不只体现在数值上，角色重新获得处理工作、关系或日常活动的能力。",
      tensionAxes: ["恢复参与 vs 避免过载", "原方向 vs 调整后的能力边界", "证明自己 vs 尊重身体反馈"],
      allowedOutcomes: ["resume_one_meaningful_role", "keep_recovery_as_primary_goal", "redesign_role_around_current_capacity"],
      emotionalTone: "flourishing"
    },
    temporal: { lifeIntensity: "normal", durationMonths: [6, 18] }
  }),
  phase2Event({
    id: "health_recovery_milestone",
    category: "health",
    narrativeMode: "recovery_growth",
    semanticFamily: "health_recovery_closure",
    title: "健康危机阶段收束",
    preferredRange: [18, 110],
    conditionDescription: "急性健康危机转为恢复完成或长期可管理状态",
    cooldown: 10,
    baseProbability: 0.48,
    tags: ["health", "recovery_closure", "reflection", "stability"],
    requiredContextGroups: [["health_recovery_context"]],
    trigger: { eligibility: (attribs, _userData, _age, history = []) => !hasRecentMajor(history, "health") && !attributeChanged(history.slice(-3), attribs, "health", 1, "down") },
    historyConditionGroups: [
      [{ type: "pressure_arc_state", phasePolicyIds: ["health_crisis_v1"], statuses: ["resolved"] }],
      [{ type: "elapsed_since_event", eventIds: ["health_recovery_observation"], minMonths: 12 }]
    ],
    intent: {
      type: "health_recovery_milestone",
      meaning: "急性危机已转为恢复完成或长期可管理状态，健康不再必须占据人生前台。",
      tensionAxes: ["恢复后的谨慎 vs 重新投入", "完全恢复期待 vs 接受长期管理", "旧身份 vs 调整后的生活"],
      allowedOutcomes: ["close_acute_health_chapter", "adopt_long_term_management_identity", "reenter_previous_direction_with_limits"],
      emotionalTone: "reflection"
    },
    temporal: { lifeIntensity: "stable", durationMonths: [6, 18] }
  }),
  phase2Event({
    id: "health_sustainable_routine",
    category: "health",
    narrativeMode: "stability_meaning",
    semanticFamily: "health_sustainable_routine",
    title: "可持续的健康日常",
    preferredRange: [12, 110],
    conditionDescription: "非急性状态下形成可持续的健康维护日常",
    cooldown: 5,
    baseProbability: 0.68,
    tags: ["health", "routine", "maintenance", "stability"],
    requiredContextGroups: [],
    trigger: { eligibility: (attribs, _userData, _age, history = []) => attribs.health >= 45 && noAcuteHealthArc(history) && !hasRecentMajor(history, "health") },
    historyConditionGroups: [],
    intent: {
      type: "health_sustainable_routine",
      meaning: "健康通过可持续的睡眠、活动、复查、饮食或负荷边界维持，而不是靠一次英雄式改变。",
      tensionAxes: ["规律 vs 灵活", "维护身体 vs 继续生活", "自我管理 vs 接受支持"],
      allowedOutcomes: ["maintain_health_routine", "improve_one_sustainable_habit", "adapt_routine_to_current_life"],
      emotionalTone: "everyday"
    },
    temporal: { lifeIntensity: "stable", durationMonths: [12, 36] }
  }),
  phase2Event({
    id: "health_adapted_life_balance",
    category: "health",
    narrativeMode: "stability_meaning",
    semanticFamily: "health_adapted_balance",
    title: "带着限制建立稳定生活",
    preferredRange: [18, 110],
    conditionDescription: "在真实健康限制下建立可持续的参与和生活结构",
    cooldown: 7,
    baseProbability: 0.54,
    tags: ["health", "adaptation", "management", "meaning"],
    requiredContextGroups: [["health_recovery_context"]],
    trigger: { eligibility: (attribs, _userData, _age, history = []) => attribs.health >= 35 && attribs.health <= 65 && noAcuteHealthArc(history) && !hasRecentMajor(history, "health") },
    historyConditionGroups: [[{ type: "elapsed_since_event", eventIds: ["health_system_warning", "health_forced_pause", "health_recovery_observation", "health_recovery_progress"], minMonths: 6 }]],
    intent: {
      type: "health_adapted_life_balance",
      meaning: "角色不必等到完全康复才重新拥有工作、关系、兴趣和未来，可以围绕真实限制建立稳定生活。",
      tensionAxes: ["接受限制 vs 放弃可能", "保护身体 vs 保持参与", "可持续生活 vs 追求恢复到过去"],
      allowedOutcomes: ["build_life_around_current_capacity", "preserve_one_core_direction", "seek_additional_support_for_more_participation"],
      emotionalTone: "reflection"
    },
    temporal: { lifeIntensity: "stable", durationMonths: [12, 36] }
  }),
  phase2Event({
    id: "financial_resource_priority_choice",
    category: "financial",
    narrativeMode: "crossroads_opportunity",
    semanticFamily: "financial_priority_choice",
    title: "资源优先级选择",
    preferredRange: [18, 100],
    conditionDescription: "有限资源需要在安全、成长、家庭和个人方向间排序",
    cooldown: 5,
    baseProbability: 0.64,
    tags: ["financial", "priority", "crossroads", "resource_allocation"],
    requiredContextGroups: [["financial_state_available"]],
    trigger: { eligibility: (_attribs, userData, _age, history = [], answers) => {
      const text = `${JSON.stringify(userData)} ${JSON.stringify(answers)} ${history.slice(-6).map((item) => `${item.description} ${item.selectedChoice}`).join(" ")}`;
      return [/(储蓄|现金|安全垫)/, /(债务|贷款|还款)/, /(教育|学习|培训)/, /(住房|房租|买房)/, /(健康|治疗|医疗)/, /(创作|项目|兴趣)/].filter((pattern) => pattern.test(text)).length >= 2;
    } },
    historyConditionGroups: [[{ type: "event_absent", semanticFamilies: ["financial_priority_choice"], withinNodes: 6 }]],
    intent: {
      type: "financial_resource_priority_choice",
      meaning: "有限资源需要在安全、成长、家庭和个人方向之间排序。",
      tensionAxes: ["安全垫 vs 长期投入", "家庭需要 vs 个人方向", "现在使用 vs 未来选择权"],
      allowedOutcomes: ["prioritize_financial_safety", "fund_one_long_term_direction", "split_resources_by_explicit_ratio"],
      emotionalTone: "crossroads"
    },
    temporal: { lifeIntensity: "normal", durationMonths: [12, 24] }
  }),
  phase2Event({
    id: "financial_cautious_opportunity",
    category: "financial",
    narrativeMode: "crossroads_opportunity",
    semanticFamily: "financial_cautious_opportunity",
    title: "可控规模的财务机会",
    preferredRange: [20, 80],
    conditionDescription: "已有技能或工作带来可限定投入的财务试点机会",
    cooldown: 7,
    baseProbability: 0.58,
    tags: ["financial", "opportunity", "pilot", "risk_control"],
    requiredContextGroups: [["financial_state_available", "career_or_creation_direction"]],
    trigger: { eligibility: (_attribs, _userData, _age, history = []) => (latestFinancialState(history)?.cashWan ?? -1) >= 0 && !hasRecentMajor(history, "financial") },
    historyConditionGroups: [[
      { type: "event_absent", semanticFamilies: ["financial_cautious_opportunity"], withinNodes: 8 },
      { type: "event_absent", eventIds: ["financial_major_crisis"], withinNodes: 4 }
    ]],
    intent: {
      type: "financial_cautious_opportunity",
      meaning: "角色获得一个可以限定投入、验证需求并保留退出空间的增收或经营机会。",
      tensionAxes: ["试点规模 vs 潜在收益", "现金安全 vs 机会窗口", "控制风险 vs 学习速度"],
      allowedOutcomes: ["run_small_financial_pilot", "delay_until_buffer_ready", "decline_and_protect_core_finances"],
      emotionalTone: "opportunity"
    },
    temporal: { lifeIntensity: "normal", durationMonths: [6, 18] }
  }),
  phase2Event({
    id: "financial_emergency_buffer",
    category: "financial",
    narrativeMode: "recovery_growth",
    semanticFamily: "financial_buffer_growth",
    title: "应急缓冲开始形成",
    preferredRange: [18, 100],
    conditionDescription: "持续储蓄或稳定收入开始形成应急缓冲",
    cooldown: 6,
    baseProbability: 0.7,
    tags: ["financial", "buffer", "saving", "recovery"],
    requiredContextGroups: [["financial_state_available"]],
    trigger: { eligibility: (_attribs, _userData, age, history = []) => {
      const states = history.slice(-8).filter((item) => item.financialState);
      const elapsed = elapsedSinceMatchingIntent(history, age, /financial:(save|reduce_expense)|career:stabilize_income/i);
      return typeof elapsed === "number" && elapsed >= 6 && states.length > 0
        && (latestFinancialState(history)?.cashWan ?? -Infinity) >= (states[0].financialState?.cashWan ?? Infinity);
    } },
    historyConditionGroups: [[{ type: "selected_intent_count", intentPrefixes: ["financial:save", "financial:reduce_expense", "career:stabilize_income"], minCount: 2, withinNodes: 8 }]],
    intent: {
      type: "financial_emergency_buffer",
      meaning: "持续储蓄、控制支出或稳定收入开始形成可以应对波动的缓冲。",
      tensionAxes: ["继续积累 vs 使用部分资源", "安全感 vs 新投入", "严格纪律 vs 保留生活质量"],
      allowedOutcomes: ["continue_building_buffer", "set_buffer_target_then_redirect_surplus", "use_small_part_for_meaningful_goal"],
      emotionalTone: "flourishing"
    },
    temporal: { lifeIntensity: "normal", durationMonths: [9, 24] }
  }),
  phase2Event({
    id: "financial_debt_reduction_progress",
    category: "financial",
    narrativeMode: "recovery_growth",
    semanticFamily: "financial_debt_recovery",
    title: "债务压力逐步下降",
    preferredRange: [18, 100],
    conditionDescription: "持续处置使结构化债务和利息压力下降",
    cooldown: 6,
    baseProbability: 0.66,
    tags: ["financial", "debt", "recovery", "cashflow"],
    requiredContextGroups: [["financial_state_available", "debt_present"]],
    trigger: { eligibility: (_attribs, _userData, age, history = []) => {
      const states = history.slice(-10).filter((item) => item.financialState);
      const elapsed = elapsedSinceMatchingIntent(history, age, /financial:(repay|reduce_expense)|career:(increase_income|stabilize_income)/i);
      return typeof elapsed === "number" && elapsed >= 6 && states.length > 0
        && (latestFinancialState(history)?.totalDebtWan ?? Infinity) < (states[0].financialState?.totalDebtWan ?? -Infinity);
    } },
    historyConditionGroups: [[{ type: "selected_intent_count", intentPrefixes: ["financial:repay", "financial:reduce_expense", "career:increase_income", "career:stabilize_income"], minCount: 2, withinNodes: 10 }]],
    intent: {
      type: "financial_debt_reduction_progress",
      meaning: "持续处置开始降低债务和利息压力，角色重新获得部分选择空间。",
      tensionAxes: ["加速偿还 vs 保留现金", "债务清理 vs 生活质量", "单一目标 vs 同时恢复其他生活领域"],
      allowedOutcomes: ["accelerate_debt_reduction", "balance_debt_and_cash_buffer", "maintain_current_repayment_plan"],
      emotionalTone: "flourishing"
    },
    temporal: { lifeIntensity: "normal", durationMonths: [9, 24] }
  }),
  phase2Event({
    id: "financial_income_stabilization",
    category: "financial",
    narrativeMode: "recovery_growth",
    semanticFamily: "financial_income_stability",
    title: "收入结构趋于稳定",
    preferredRange: [18, 90],
    conditionDescription: "工作或客户结构调整使收入波动下降",
    cooldown: 7,
    baseProbability: 0.62,
    tags: ["financial", "income_stability", "recovery", "career"],
    requiredContextGroups: [["financial_state_available", "career_active"]],
    trigger: { eligibility: (_attribs, _userData, age, history = []) => {
      const states = history.slice(-10).filter((item) => item.financialState);
      const elapsed = elapsedSinceMatchingIntent(history, age, /career:(stabilize_income|build_clients|restructure_work)/i);
      const rank = { unstable: 0, volatile: 1, stable: 2, very_stable: 3 };
      return typeof elapsed === "number" && elapsed >= 9 && states.length > 0
        && rank[latestFinancialState(history)?.incomeStability || "unstable"] > rank[states[0].financialState?.incomeStability || "unstable"];
    } },
    historyConditionGroups: [[{ type: "selected_intent_count", intentPrefixes: ["career:stabilize_income", "career:build_clients", "career:restructure_work"], minCount: 2, withinNodes: 10 }]],
    intent: {
      type: "financial_income_stabilization",
      meaning: "收入未必大幅增加，但波动降低、来源更清楚，生活不再依赖下一次翻盘。",
      tensionAxes: ["稳定性 vs 增长速度", "集中主业 vs 多来源", "收入提升 vs 时间边界"],
      allowedOutcomes: ["consolidate_stable_income", "diversify_without_overload", "trade_some_income_for_sustainability"],
      emotionalTone: "flourishing"
    },
    temporal: { lifeIntensity: "normal", durationMonths: [12, 30] }
  }),
  phase2Event({
    id: "financial_long_term_order",
    category: "financial",
    narrativeMode: "stability_meaning",
    semanticFamily: "financial_long_term_order",
    title: "长期财务秩序",
    preferredRange: [18, 110],
    conditionDescription: "非危机财务状态形成支持长期生活的秩序",
    cooldown: 6,
    baseProbability: 0.66,
    tags: ["financial", "order", "stability", "meaning"],
    requiredContextGroups: [["financial_state_available"]],
    trigger: { eligibility: (_attribs, _userData, _age, history = []) => (latestFinancialState(history)?.cashWan ?? -1) >= 0 && !hasRecentMajor(history, "financial") },
    historyConditionGroups: [],
    intent: {
      type: "financial_long_term_order",
      meaning: "财富不再主要承担证明和翻盘功能，而成为支持生活、关系和未来选择的秩序。",
      tensionAxes: ["储备未来 vs 使用当下", "纪律 vs 弹性", "个人安全 vs 支持重要关系"],
      allowedOutcomes: ["maintain_financial_order", "allocate_for_quality_of_life", "support_one_long_term_commitment"],
      emotionalTone: "everyday"
    },
    temporal: { lifeIntensity: "stable", durationMonths: [18, 48] }
  }),
  phase2Event({
    id: "financial_shared_household_plan",
    category: "financial",
    narrativeMode: "stability_meaning",
    semanticFamily: "financial_household_cooperation",
    title: "共同生活的财务协作",
    preferredRange: [20, 100],
    conditionDescription: "可靠关系中的共同生活支出需要透明协作",
    cooldown: 8,
    baseProbability: 0.5,
    tags: ["financial", "household", "cooperation", "relationship"],
    requiredContextGroups: [["financial_state_available", "confirmed_partner"], ["financial_state_available", "confirmed_family"]],
    trigger: { eligibility: (_attribs, userData, _age, history = [], answers) => /共同生活|照护|住房|房租|家庭支出|生活费|医疗费/.test(`${JSON.stringify(userData)} ${JSON.stringify(answers)} ${history.slice(-8).map((item) => item.description).join(" ")}`) },
    historyConditionGroups: [[{ type: "event_absent", semanticFamilies: ["financial_household_cooperation"], withinNodes: 8 }]],
    intent: {
      type: "financial_shared_household_plan",
      meaning: "家庭或伴侣开始用更透明、可持续的方式安排共同支出和个人空间。",
      tensionAxes: ["共同账户 vs 个人自主", "公平分担 vs 收入差异", "长期计划 vs 当下需要"],
      allowedOutcomes: ["create_shared_financial_rules", "separate_personal_and_shared_budgets", "review_household_plan_periodically"],
      emotionalTone: "connection"
    },
    temporal: { lifeIntensity: "stable", durationMonths: [12, 36] }
  }),
  phase2Event({
    id: "self_new_direction_choice",
    category: "growth",
    narrativeMode: "crossroads_opportunity",
    semanticFamily: "self_direction_choice",
    title: "新的个人方向",
    preferredRange: [15, 110],
    conditionDescription: "已有兴趣、学习或价值方向出现可投入的新路径",
    cooldown: 6,
    baseProbability: 0.66,
    tags: ["growth", "direction", "crossroads", "experiment"],
    requiredContextGroups: [],
    trigger: { eligibility: (_attribs, userData, _age, history = [], answers) => /学习|创作|研究|旅行|生活方式|价值|兴趣|写作|摄影|艺术|技能/.test(`${JSON.stringify(userData)} ${JSON.stringify(answers)} ${history.slice(-6).map((item) => `${item.selectedChoice} ${item.description}`).join(" ")}`) },
    historyConditionGroups: [[{ type: "event_absent", semanticFamilies: ["self_direction_choice"], withinNodes: 6 }]],
    intent: {
      type: "self_new_direction_choice",
      meaning: "角色发现一个值得投入的新方向，需要决定它在现实生活中占据多大位置。",
      tensionAxes: ["兴趣 vs 既有责任", "试验 vs 承诺", "个人意义 vs 外部评价"],
      allowedOutcomes: ["run_small_self_direction_experiment", "commit_regular_time_to_direction", "keep_direction_as_background_for_now"],
      emotionalTone: "crossroads"
    },
    temporal: { lifeIntensity: "normal", durationMonths: [6, 18] }
  }),
  phase2Event({
    id: "self_value_reorientation",
    category: "growth",
    narrativeMode: "crossroads_opportunity",
    semanticFamily: "self_value_reorientation",
    title: "重新排序重要的事",
    preferredRange: [18, 110],
    conditionDescription: "经历具体收束、恢复或长期投入后重新排序价值",
    cooldown: 8,
    baseProbability: 0.56,
    tags: ["growth", "values", "reflection", "reorientation"],
    requiredContextGroups: [],
    trigger: { eligibility: (_attribs, _userData, _age, history = []) => {
      const world = [...history].reverse().find((item) => item.worldStateSnapshot)?.worldStateSnapshot;
      return Boolean(world?.pressureArcs.some((arc) => arc.status === "resolved"))
        || history.slice(-8).some((item) => /completion|release|recovery_closure/.test(item.eventMeta?.eventSemanticFamily || ""))
        || Boolean(world?.directionArcs.some((arc) => arc.userReinforcementCount >= 3));
    } },
    historyConditionGroups: [
      [{ type: "pressure_arc_state", statuses: ["resolved"] }],
      [{ type: "elapsed_since_event", semanticFamilies: ["career_completion", "relationship_release", "health_recovery_closure"], minMonths: 0 }],
      [{ type: "direction_reinforcement_count", minCount: 3 }]
    ],
    intent: {
      type: "self_value_reorientation",
      meaning: "经历具体结果后，角色重新理解成功、安全、关系、自由或身体在自己人生中的排序。",
      tensionAxes: ["旧标准 vs 新经验", "外部认可 vs 内在一致", "保留野心 vs 改变衡量方式"],
      allowedOutcomes: ["redefine_success_criteria", "protect_one_new_priority", "test_new_values_before_full_commitment"],
      emotionalTone: "reflection"
    },
    temporal: { lifeIntensity: "normal", durationMonths: [12, 24] }
  }),
  phase2Event({
    id: "self_confidence_rebuilding",
    category: "growth",
    narrativeMode: "recovery_growth",
    semanticFamily: "self_confidence_recovery",
    title: "信心逐步恢复",
    preferredRange: [12, 110],
    conditionDescription: "失败后通过连续小行动和真实反馈恢复信心",
    cooldown: 6,
    baseProbability: 0.68,
    tags: ["growth", "confidence", "recovery", "small_wins"],
    requiredContextGroups: [],
    trigger: { eligibility: (attribs, _userData, _age, history = []) => textInHistory(history, /失败|拒绝|停顿|未达成|落选|退出|受挫/, 10) && (!attributeChanged(history.slice(-3), attribs, "happiness", 1, "down")) },
    historyConditionGroups: [[
      { type: "selected_intent_count", intentPrefixes: ["growth:small_step", "growth:learn", "growth:seek_support", "career:practice", "creation:practice"], minCount: 2, withinNodes: 10 },
      { type: "attribute_trend", attribute: "happiness", direction: "improving", withinNodes: 3, minimumDelta: 3 }
    ], [
      { type: "selected_intent_count", intentPrefixes: ["growth:small_step", "growth:learn", "growth:seek_support", "career:practice", "creation:practice"], minCount: 2, withinNodes: 10 },
      { type: "attribute_trend", attribute: "happiness", direction: "stable", withinNodes: 3, minimumDelta: 2 }
    ]],
    intent: {
      type: "self_confidence_rebuilding",
      meaning: "信心不是口号，而是通过连续完成小目标和承受现实反馈重新形成。",
      tensionAxes: ["继续小步积累 vs 扩大挑战", "保护新信心 vs 接受失败可能", "自我认可 vs 外部验证"],
      allowedOutcomes: ["increase_challenge_gradually", "consolidate_small_wins", "seek_real_world_feedback"],
      emotionalTone: "flourishing"
    },
    temporal: { lifeIntensity: "normal", durationMonths: [6, 18] }
  }),
  phase2Event({
    id: "self_skill_validation",
    category: "growth",
    narrativeMode: "recovery_growth",
    semanticFamily: "self_skill_validation",
    title: "学习成果得到验证",
    preferredRange: [12, 110],
    conditionDescription: "持续学习或练习通过现实使用得到验证",
    cooldown: 6,
    baseProbability: 0.66,
    tags: ["growth", "skill_validation", "flourishing", "practice"],
    requiredContextGroups: [["learning_or_creation_direction"]],
    trigger: { eligibility: (_attribs, _userData, age, history = []) => (elapsedSinceMatchingIntent(history, age, /growth:(learn|study|practice|make)|creation:practice|career:learn/i) ?? -1) >= 6 },
    historyConditionGroups: [[
      { type: "selected_intent_count", intentPrefixes: ["growth:learn", "growth:study", "growth:practice", "growth:make", "creation:practice", "career:learn"], minCount: 2, withinNodes: 10 },
      { type: "event_absent", semanticFamilies: ["self_skill_validation"], withinNodes: 8 }
    ]],
    intent: {
      type: "self_skill_validation",
      meaning: "学习开始通过作品、解决问题、考试、教学或现实使用得到验证。",
      tensionAxes: ["继续学习 vs 开始应用", "私人兴趣 vs 公开成果", "广度 vs 深度"],
      allowedOutcomes: ["apply_skill_in_real_context", "deepen_skill_before_expanding", "share_skill_or_teach_others"],
      emotionalTone: "flourishing"
    },
    temporal: { lifeIntensity: "normal", durationMonths: [9, 24] }
  }),
  phase2Event({
    id: "self_failure_becomes_method",
    category: "growth",
    narrativeMode: "recovery_growth",
    semanticFamily: "self_failure_integration",
    title: "失败经验形成方法",
    preferredRange: [15, 110],
    conditionDescription: "失败后经过调整和复盘形成可迁移方法",
    cooldown: 8,
    baseProbability: 0.58,
    tags: ["growth", "failure", "reflection", "method"],
    requiredContextGroups: [],
    trigger: { eligibility: (_attribs, _userData, age, history = []) => textInHistory(history, /失败|退出|拒绝|未达成|后果不佳|落选|中止/, 10) && (elapsedSinceMatchingIntent(history, age, /growth:(adjust|reflect|retry)|career:(adjust|retry)|creation:retry/i) ?? -1) >= 6 },
    historyConditionGroups: [[{ type: "selected_intent_count", intentPrefixes: ["growth:adjust", "growth:reflect", "growth:retry", "career:adjust", "career:retry", "creation:retry"], minCount: 1, withinNodes: 10 }]],
    intent: {
      type: "self_failure_becomes_method",
      meaning: "失败没有被美化，但角色从中提炼出以后能使用的判断、边界或工作方法。",
      tensionAxes: ["再次尝试 vs 接受不适合", "保留经验 vs 放下执念", "证明自己 vs 修正方法"],
      allowedOutcomes: ["apply_learned_method_to_next_attempt", "close_failed_direction_keep_learning", "run_smaller_test_with_new_constraints"],
      emotionalTone: "reflection"
    },
    temporal: { lifeIntensity: "normal", durationMonths: [9, 24] }
  }),
  phase2Event({
    id: "self_interest_becomes_practice",
    category: "growth",
    narrativeMode: "stability_meaning",
    semanticFamily: "self_interest_practice",
    title: "兴趣成为稳定实践",
    preferredRange: [8, 110],
    conditionDescription: "同一兴趣通过固定时间和作品成为稳定实践",
    cooldown: 5,
    baseProbability: 0.72,
    tags: ["growth", "interest", "routine", "practice"],
    requiredContextGroups: [["learning_or_creation_direction"]],
    historyConditionGroups: [
      [{ type: "selected_intent_count", intentPrefixes: ["growth:", "creation:", "learning:"], minCount: 2, withinNodes: 8 }],
      [{ type: "direction_reinforcement_count", minCount: 2 }]
    ],
    intent: {
      type: "self_interest_becomes_practice",
      meaning: "兴趣不一定变成职业，但通过固定时间、作品或社群成为生活中稳定存在的部分。",
      tensionAxes: ["纯粹兴趣 vs 外部成果", "稳定习惯 vs 新鲜感", "个人空间 vs 分享连接"],
      allowedOutcomes: ["protect_regular_practice_time", "complete_one_small_artifact", "share_interest_with_trusted_others"],
      emotionalTone: "everyday"
    },
    temporal: { lifeIntensity: "stable", durationMonths: [12, 36] }
  }),
  phase2Event({
    id: "self_daily_meaning",
    category: "growth",
    narrativeMode: "stability_meaning",
    semanticFamily: "self_daily_meaning",
    title: "普通生活中的意义感",
    preferredRange: [8, 110],
    conditionDescription: "非危机生活中的重复活动形成可辨认的意义",
    cooldown: 5,
    baseProbability: 0.74,
    tags: ["growth", "daily_meaning", "stability", "reflection"],
    requiredContextGroups: [],
    trigger: { eligibility: (_attribs, _userData, _age, history = []) => {
      const world = [...history].reverse().find((item) => item.worldStateSnapshot)?.worldStateSnapshot;
      const hasDirection = world?.directionArcs.some((arc) => ["active", "background"].includes(arc.status));
      const hasReliableRelation = world?.people.some((person) => person.source !== "model_inferred" && person.confidence >= 0.7 && !["distant", "deceased"].includes(person.lifeStatus));
      const hasRoutine = history.slice(-6).some((item) => item.narrativeMeta?.lifeIntensity === "stable" || /日常|习惯|规律|陪伴|练习/.test(item.description));
      return !hasRecentMajor(history) && Boolean(hasDirection || hasReliableRelation || hasRoutine);
    } },
    historyConditionGroups: [[{ type: "event_absent", semanticFamilies: ["self_daily_meaning"], withinNodes: 6 }]],
    intent: {
      type: "self_daily_meaning",
      meaning: "角色从重复的工作、照料、学习、兴趣或陪伴中辨认出自己愿意长期保留的生活部分。",
      tensionAxes: ["追求变化 vs 看见已有价值", "效率 vs 感受", "宏大目标 vs 可持续日常"],
      allowedOutcomes: ["protect_meaningful_daily_element", "simplify_life_around_core_values", "add_one_small_source_of_aliveness"],
      emotionalTone: "reflection"
    },
    temporal: { lifeIntensity: "stable", durationMonths: [18, 48] }
  }),
  phase2Event({
    id: "self_long_term_creation",
    category: "growth",
    narrativeMode: "stability_meaning",
    semanticFamily: "self_long_term_creation",
    title: "长期创作与表达",
    preferredRange: [12, 110],
    conditionDescription: "长期创作或表达形成作品序列、方法或个人声音",
    cooldown: 7,
    baseProbability: 0.58,
    tags: ["growth", "creation", "long_term", "meaning"],
    requiredContextGroups: [["learning_or_creation_direction"]],
    trigger: { eligibility: (_attribs, _userData, age, history = []) => (elapsedSinceMatchingIntent(history, age, /creation:|growth:(create|write|make)/i) ?? -1) >= 18 },
    historyConditionGroups: [[
      { type: "selected_intent_count", intentPrefixes: ["creation:", "growth:create", "growth:write", "growth:make"], minCount: 3, withinNodes: 12 },
      { type: "event_absent", semanticFamilies: ["career_completion", "health_recovery_closure"], withinNodes: 8 }
    ]],
    intent: {
      type: "self_long_term_creation",
      meaning: "长期表达形成了作品序列、方法或个人声音，即使规模不大也具有持续性。",
      tensionAxes: ["继续私人实践 vs 面向他人", "完成作品 vs 不断修改", "稳定表达 vs 尝试新形式"],
      allowedOutcomes: ["complete_and_archive_work", "share_work_with_real_audience", "begin_next_creation_cycle"],
      emotionalTone: "flourishing"
    },
    temporal: { lifeIntensity: "stable", durationMonths: [18, 48] }
  }),
];

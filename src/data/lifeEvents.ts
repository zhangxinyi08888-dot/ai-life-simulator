import type { EventMeta, HistoryItem, LifeAttributes, LifeEventCategory, TemporalProfile, UserInitialData } from "../types";

type UserEventData = Partial<UserInitialData> & { birthday?: string; gender?: string; currentSituation?: string };

export type EmotionalTone = "pressure" | "neutral" | "opportunity" | "crisis";
export type ActionPrimitive = string;

export interface EventTrigger {
  // Eligibility only determines whether the event enters the candidate pool.
  // It must not be treated as a deterministic trigger.
  eligibility: (attribs: LifeAttributes, userData: UserEventData, age: number) => boolean;
}

export interface EventIntent {
  type: string;
  meaning: string;
  tensionAxes: string[];
  allowedOutcomes: ActionPrimitive[];
  emotionalTone?: EmotionalTone;
  temporalProfile?: TemporalProfile;
  phasePolicyId?: string;
}

export interface HardAgeConstraint {
  minAge?: number;
  maxAge?: number;
  reason: string;
  basis: "legal" | "biological" | "historical_fact";
}

export interface AgeAffinity {
  preferredRange?: [number, number];
  minimumMultiplier: number;
  outsideRangeAdaptations: string[];
}

export interface EventFingerprint {
  category: LifeEventCategory;
  tags: string[];
  intensity?: "minor" | "major";
}

export interface LifeEventSeed {
  id: string;
  category: LifeEventCategory;
  title: string;
  minAge: number;
  maxAge: number;
  conditionDescription: string;
  cooldown?: number;
  baseProbability?: number;
  trigger: EventTrigger;
  intent: EventIntent;
  tags: string[];
  fingerprint?: EventFingerprint;
  hardAgeConstraint?: HardAgeConstraint;
  ageAffinity?: AgeAffinity;
}

export const LIFE_EVENTS_DATABASE: LifeEventSeed[] = [
  {
    id: "career_venture_pressure",
    category: "career",
    title: "事业机会与承压跃迁",
    minAge: 22,
    maxAge: 45,
    conditionDescription: "才智与资源足以进入更高风险事业机会",
    cooldown: 5,
    baseProbability: 0.65,
    tags: ["career", "opportunity", "instability", "ambition"],
    trigger: {
      eligibility: (attribs) => attribs.intelligence >= 65 && attribs.wealth >= 55
    },
    intent: {
      type: "career_venture_pressure",
      meaning: "事业上出现一次更高收益但更高不确定性的跃迁机会。",
      tensionAxes: ["野心 vs 稳定", "机会窗口 vs 现金流风险", "自我证明 vs 可承受代价"],
      allowedOutcomes: ["take_high_risk_leap", "stay_lean_and_cautious", "convert_position_to_cash"],
      emotionalTone: "opportunity"
    }
  },
  {
    id: "career_responsibility_shift",
    category: "career",
    title: "责任转移与利益不对等",
    minAge: 23,
    maxAge: 55,
    conditionDescription: "人际较高且处在资源或组织关系中",
    cooldown: 6,
    baseProbability: 0.7,
    tags: ["career", "responsibility_shift", "interest_conflict", "reputation_risk"],
    trigger: {
      eligibility: (attribs) => attribs.relation >= 58 && attribs.wealth >= 35 && attribs.wealth <= 78
    },
    intent: {
      type: "career_responsibility_shift",
      meaning: "你被卷入一次责任与利益不对等的局面，需要判断是否承担不属于自己的代价。",
      tensionAxes: ["责任 vs 自保", "关系 vs 原则", "短期机会 vs 长期名声"],
      allowedOutcomes: ["absorb_partial_responsibility", "publicly_draw_boundary", "seek_rule_based_mediation"],
      emotionalTone: "pressure"
    }
  },
  {
    id: "career_structural_instability",
    category: "career",
    title: "结构变化与生计压力",
    minAge: 22,
    maxAge: 58,
    conditionDescription: "财富/资源较低，抗风险能力不足",
    cooldown: 5,
    baseProbability: 0.75,
    tags: ["career", "instability", "survival_pressure", "transition"],
    trigger: {
      eligibility: (attribs) => attribs.wealth < 45
    },
    intent: {
      type: "career_structural_instability",
      meaning: "外部结构变化让原本的收入或职业路径变得不稳定。",
      tensionAxes: ["生存现金流 vs 职业尊严", "快速止损 vs 长期转型", "被动适应 vs 主动重组"],
      allowedOutcomes: ["accept_lower_quality_stability", "invest_in_transition", "activate_network_resources"],
      emotionalTone: "crisis"
    }
  },
  {
    id: "career_credit_ownership_conflict",
    category: "career",
    title: "成果归属与边界争夺",
    minAge: 20,
    maxAge: 50,
    conditionDescription: "才智突出，容易产出关键价值",
    cooldown: 6,
    baseProbability: 0.62,
    tags: ["career", "credit_ownership", "boundary", "reputation_risk"],
    trigger: {
      eligibility: (attribs) => attribs.intelligence >= 72
    },
    intent: {
      type: "career_credit_ownership_conflict",
      meaning: "你创造的关键价值面临被他人、组织或合作关系重新分配。",
      tensionAxes: ["体面合作 vs 自我主张", "眼前安全 vs 长期权益", "规则内争取 vs 关系破裂风险"],
      allowedOutcomes: ["quietly_trade_credit_for_security", "challenge_credit_capture", "preserve_core_value_and_exit"],
      emotionalTone: "pressure"
    }
  },
  {
    id: "relationship_material_commitment_test",
    category: "relationship",
    title: "关系承诺与现实成本",
    minAge: 24,
    maxAge: 42,
    conditionDescription: "幸福度尚可，关系进入现实承诺压力区",
    cooldown: 5,
    baseProbability: 0.65,
    tags: ["relationship", "commitment", "financial_pressure", "family_expectation"],
    trigger: {
      eligibility: (attribs) => attribs.happiness >= 45
    },
    intent: {
      type: "relationship_material_commitment_test",
      meaning: "亲密关系进入现实承诺阶段，情感愿望需要面对资源、家庭和长期责任。",
      tensionAxes: ["感情 vs 物质基础", "两人共识 vs 家庭期待", "自由感 vs 稳定承诺"],
      allowedOutcomes: ["commit_with_heavy_cost", "delay_commitment_for_autonomy", "reassess_relationship_fit"],
      emotionalTone: "pressure"
    }
  },
  {
    id: "relationship_family_obligation_pull",
    category: "relationship",
    title: "亲缘责任与自我边界",
    minAge: 22,
    maxAge: 60,
    conditionDescription: "人际较强但幸福承压",
    cooldown: 5,
    baseProbability: 0.68,
    tags: ["relationship", "family_obligation", "boundary", "sacrifice"],
    trigger: {
      eligibility: (attribs) => attribs.relation >= 50 && attribs.happiness < 62
    },
    intent: {
      type: "relationship_family_obligation_pull",
      meaning: "亲缘或熟人关系向你提出现实责任要求，你需要重新划定自我边界。",
      tensionAxes: ["亲情责任 vs 自我保护", "道义评价 vs 现实承受力", "回馈家庭 vs 保留人生主动权"],
      allowedOutcomes: ["sacrifice_resources_for_family", "set_firm_boundary", "renegotiate_support_terms"],
      emotionalTone: "pressure"
    }
  },
  {
    id: "relationship_trust_interest_fracture",
    category: "relationship",
    title: "信任裂纹与利益考验",
    minAge: 20,
    maxAge: 55,
    conditionDescription: "关系资源与财富资源交叠",
    cooldown: 6,
    baseProbability: 0.58,
    tags: ["relationship", "betrayal", "interest_conflict", "trust"],
    trigger: {
      eligibility: (attribs) => attribs.relation >= 40 && attribs.wealth >= 50
    },
    intent: {
      type: "relationship_trust_interest_fracture",
      meaning: "一段重要关系在现实利益面前出现信任裂纹。",
      tensionAxes: ["情分 vs 利益", "和解 vs 切割", "继续合作 vs 建立防线"],
      allowedOutcomes: ["preserve_relationship_with_boundaries", "cut_and_confront", "renegotiate_mutual_interest"],
      emotionalTone: "pressure"
    }
  },
  {
    id: "health_system_warning",
    category: "health",
    title: "健康系统预警",
    minAge: 22,
    maxAge: 60,
    conditionDescription: "健康下降或长期幸福度不足",
    cooldown: 6,
    baseProbability: 0.75,
    tags: ["health", "burnout", "instability", "system_warning"],
    fingerprint: {
      category: "health",
      tags: ["health", "burnout", "instability", "system_warning"],
      intensity: "major"
    },
    trigger: {
      eligibility: (attribs) => attribs.health < 45 || attribs.happiness < 36
    },
    intent: {
      type: "health_system_warning",
      meaning: "长期高压、缺少恢复机制的生活引发身体或精神系统性的现实反馈；高薪本身不是健康风险，风险来自强度、时长和恢复缺口。",
      tensionAxes: ["收入机会 vs 工作强度", "短期稳定 vs 长期恢复", "责任 vs 自我保护"],
      allowedOutcomes: ["persist_high_pressure", "optimize_load", "exit_or_pause"],
      emotionalTone: "crisis"
    }
  },
  {
    id: "health_forced_pause",
    category: "health",
    title: "身体停摆与节奏重排",
    minAge: 18,
    maxAge: 70,
    conditionDescription: "健康很低或幸福度很低",
    cooldown: 8,
    baseProbability: 0.7,
    tags: ["health", "forced_pause", "burnout", "major_crisis"],
    fingerprint: {
      category: "health",
      tags: ["health", "forced_pause", "burnout", "major_crisis"],
      intensity: "major"
    },
    trigger: {
      eligibility: (attribs) => attribs.health < 40 || attribs.happiness < 35
    },
    intent: {
      type: "health_forced_pause",
      meaning: "身体或心理状态迫使原有生活节奏暂停，你必须重新安排责任、收入和自我照料。",
      tensionAxes: ["继续硬撑 vs 接受停顿", "现实责任 vs 身体边界", "自我价值 vs 休息羞耻"],
      allowedOutcomes: ["continue_hard_mode", "reduce_load", "pause_recovery"],
      emotionalTone: "crisis"
    }
  },
  {
    id: "opportunity_unstable_alliance",
    category: "opportunity",
    title: "不稳定联盟与未来押注",
    minAge: 21,
    maxAge: 50,
    conditionDescription: "才智较好但资源不足",
    cooldown: 5,
    baseProbability: 0.65,
    tags: ["opportunity", "alliance", "uncertainty", "resource_gap"],
    trigger: {
      eligibility: (attribs) => attribs.intelligence >= 60 && attribs.wealth < 48
    },
    intent: {
      type: "opportunity_unstable_alliance",
      meaning: "一个外部合作机会打开了新的上升通道，但收益和风险都不稳定。",
      tensionAxes: ["低保障机会 vs 稳定现金流", "跟随他人 vs 保持自主", "未来想象 vs 当前生活成本"],
      allowedOutcomes: ["join_full_commitment", "decline_for_stability", "support_part_time"],
      emotionalTone: "opportunity"
    }
  },
  {
    id: "opportunity_escape_route",
    category: "opportunity",
    title: "逃离路径与代价交换",
    minAge: 22,
    maxAge: 48,
    conditionDescription: "幸福度低，存在逃离当前生活结构的动机",
    cooldown: 6,
    baseProbability: 0.6,
    tags: ["opportunity", "escape_route", "isolation", "high_reward"],
    trigger: {
      eligibility: (attribs) => attribs.happiness < 40
    },
    intent: {
      type: "opportunity_escape_route",
      meaning: "一个能离开当前困局的机会出现，但它要求你付出孤独、风险或关系成本。",
      tensionAxes: ["逃离困局 vs 承受孤独", "高收益 vs 高不确定", "个人突破 vs 关系断裂"],
      allowedOutcomes: ["accept_escape_route", "stay_and_endure", "use_offer_as_leverage"],
      emotionalTone: "opportunity"
    }
  },
  {
    id: "financial_side_path_conflict",
    category: "financial",
    title: "副线收入与合规边界",
    minAge: 20,
    maxAge: 55,
    conditionDescription: "才智较好但财富尚不稳",
    cooldown: 5,
    baseProbability: 0.68,
    tags: ["financial", "side_income", "compliance_risk", "opportunity"],
    trigger: {
      eligibility: (attribs) => attribs.intelligence >= 60 && attribs.wealth < 60
    },
    intent: {
      type: "financial_side_path_conflict",
      meaning: "一条新的收入路径开始出现，但它与现有身份、规则或稳定性产生冲突。",
      tensionAxes: ["增收机会 vs 合规风险", "短期现金 vs 长期信用", "自由探索 vs 稳定身份"],
      allowedOutcomes: ["go_independent_fast", "reduce_and_hide_exposure", "continue_dual_track_risk"],
      emotionalTone: "opportunity"
    }
  },
  {
    id: "life_normal_transition",
    category: "growth",
    title: "平稳生活与长期积累",
    minAge: 18,
    maxAge: 80,
    conditionDescription: "无强事件或近期发生过重大事件时的平稳过渡",
    cooldown: 2,
    baseProbability: 0.35,
    tags: ["normal_life", "transition", "breathing_room", "growth"],
    fingerprint: {
      category: "growth",
      tags: ["normal_life", "transition", "breathing_room", "growth"],
      intensity: "minor"
    },
    trigger: {
      eligibility: () => true
    },
    intent: {
      type: "life_normal_transition",
      meaning: "没有强烈突发事件，生活进入一段平稳但仍有细小取舍的长期积累阶段。",
      tensionAxes: ["维持节奏 vs 微调方向", "日常责任 vs 自我修复", "平淡积累 vs 新的可能"],
      allowedOutcomes: ["maintain_current_rhythm", "make_small_adjustment", "repair_health_or_relationship"],
      emotionalTone: "neutral"
    }
  }
];

const DEFAULT_COOLDOWN = 4;
const TAG_SIMILARITY_THRESHOLD = 0.5;
const NORMAL_EVENT_ID = "life_normal_transition";
const NULL_EVENT_CHANCE = 0.2;
const FOCUS_CATEGORY_BOOST: Record<string, Partial<Record<LifeEventCategory, number>>> = {
  career: { career: 1.6, financial: 1.2, growth: 1.1 },
  romance: { relationship: 1.7, growth: 1.1 },
  wealth: { financial: 1.7, career: 1.2, opportunity: 1.1 },
  selftruth: { growth: 1.5, career: 1.1, opportunity: 1.1 },
  innerpeace: { growth: 1.5, health: 1.3, relationship: 1.1 }
};

const RELATIONSHIP_KEYWORDS = ["恋", "婚", "伴侣", "前任", "异地恋", "分手", "相亲", "暧昧", "对象", "父母", "家庭阻力"];

function eventTags(event: LifeEventSeed): string[] {
  return event.fingerprint?.tags || event.tags;
}

function sharedTagCount(left: string[], right: string[]): number {
  return left.filter((tag) => right.includes(tag)).length;
}

function tagSimilarity(left: string[], right: string[]): number {
  const denominator = Math.min(left.length, right.length);
  if (denominator === 0) return 0;
  return sharedTagCount(left, right) / denominator;
}

function eventMeta(item: HistoryItem): EventMeta | undefined {
  return item.eventMeta;
}

function isEventInCooldown(event: LifeEventSeed, history: HistoryItem[]): boolean {
  const cooldown = event.cooldown ?? DEFAULT_COOLDOWN;
  const recent = history.slice(-cooldown);

  return recent.some((item) => {
    const meta = eventMeta(item);
    return Boolean(meta?.eventId && meta.eventId === event.id);
  });
}

function isTagSimilarToRecent(event: LifeEventSeed, history: HistoryItem[]): boolean {
  const tags = eventTags(event);
  return history.slice(-3).some((item) => {
    const recentTags = item.eventMeta?.eventTags || [];
    const shared = sharedTagCount(tags, recentTags);
    return shared >= 2 && tagSimilarity(tags, recentTags) >= TAG_SIMILARITY_THRESHOLD;
  });
}

function isCategoryLimited(event: LifeEventSeed, history: HistoryItem[]): boolean {
  const recent = history.slice(-2);
  if (recent.length < 2) return false;

  const categories = recent.map((item) => item.eventMeta?.eventCategory).filter(Boolean);
  if (categories.length < 2 || categories[0] !== categories[1]) return false;

  return categories[0] === event.category;
}

function hasRecentMajorEvent(history: HistoryItem[]): boolean {
  return history.slice(-2).some((item) => item.eventMeta?.eventTags?.includes("major_crisis"));
}

function hasStableBreathingRoom(attribs: LifeAttributes): boolean {
  return attribs.health >= 50 && attribs.wealth >= 50 && attribs.happiness >= 50;
}

function stringifyUnknown(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(stringifyUnknown).join("\n");
  if (typeof value === "object") return Object.values(value as Record<string, unknown>).map(stringifyUnknown).join("\n");
  return String(value);
}

function hasRelationshipContext(userData: UserEventData, answers?: unknown): boolean {
  if (userData.coreStoryFocus === "romance") return true;

  const text = [
    userData.regressionSituation,
    userData.regressionChoices,
    userData.milestoneRelationship,
    userData.milestoneOther,
    ...(Array.isArray(userData.milestones) ? userData.milestones.map((item) => `${item.title} ${item.content}`) : []),
    stringifyUnknown(answers)
  ].filter(Boolean).join("\n");

  return RELATIONSHIP_KEYWORDS.some((keyword) => text.includes(keyword));
}

function isEligibleForCandidatePool(event: LifeEventSeed, attribs: LifeAttributes, userData: UserEventData, age: number, answers?: unknown): boolean {
  if (event.trigger.eligibility(attribs, userData, age)) return true;
  return event.category === "relationship" && hasRelationshipContext(userData, answers);
}

function defaultAgeAffinity(event: LifeEventSeed): AgeAffinity {
  return event.ageAffinity || {
    preferredRange: [event.minAge, event.maxAge],
    minimumMultiplier: 0.4,
    outsideRangeAdaptations: ["年龄只调整执行方式、风险和支持条件，不得删除该人生方向。"]
  };
}

export function calculateAgeAffinityMultiplier(age: number, affinity: AgeAffinity | undefined, userDirected = false): number {
  if (userDirected || !affinity?.preferredRange) return 1;
  const [min, max] = affinity.preferredRange;
  if (age >= min && age <= max) return 1;
  const distance = age < min ? min - age : age - max;
  const multiplier = distance <= 10 ? 0.8 : distance <= 20 ? 0.6 : 0.4;
  return Math.max(multiplier, affinity.minimumMultiplier);
}

function defaultHardAgeConstraint(event: LifeEventSeed): HardAgeConstraint | undefined {
  if (event.hardAgeConstraint) return event.hardAgeConstraint;
  if (["career", "relationship", "financial", "opportunity"].includes(event.category)) {
    return { minAge: 18, reason: "未成年人法律与独立责任边界", basis: "legal" };
  }
  return undefined;
}

function satisfiesHardAgeConstraint(event: LifeEventSeed, age: number): boolean {
  const constraint = defaultHardAgeConstraint(event);
  if (!constraint) return true;
  if (typeof constraint.minAge === "number" && age < constraint.minAge) return false;
  if (typeof constraint.maxAge === "number" && age > constraint.maxAge) return false;
  return true;
}

export function isEventAgeEligible(event: LifeEventSeed, age: number): boolean {
  return satisfiesHardAgeConstraint(event, age);
}

function isUserDirected(event: LifeEventSeed, userData: UserEventData, history: HistoryItem[]): boolean {
  const focusMatch = FOCUS_CATEGORY_BOOST[userData.coreStoryFocus || ""]?.[event.category];
  if (focusMatch && focusMatch > 1.2) return true;
  const recentChoiceText = history.slice(-3).map((item) => item.selectedChoice).join("\n");
  const categoryKeywords: Record<LifeEventCategory, string[]> = {
    career: ["工作", "事业", "创业", "项目", "研究", "写书"],
    relationship: ["关系", "恋", "婚", "家人", "伴侣"],
    health: ["健康", "恢复", "治疗", "运动"],
    financial: ["财富", "收入", "现金流", "投资"],
    growth: ["学习", "读书", "旅行", "创作", "成长"],
    opportunity: ["机会", "合作", "创业", "转型"]
  };
  return categoryKeywords[event.category].some((keyword) => recentChoiceText.includes(keyword));
}

export function calculateEventSelectionWeight(event: LifeEventSeed, userData: UserEventData = {}, age?: number, userDirected = false): number {
  const base = event.baseProbability ?? 0.5;
  const focusBoost = FOCUS_CATEGORY_BOOST[userData.coreStoryFocus || ""]?.[event.category] ?? 1;
  const ageMultiplier = typeof age === "number" ? calculateAgeAffinityMultiplier(age, defaultAgeAffinity(event), userDirected) : 1;
  return base * focusBoost * ageMultiplier;
}

function pickWeighted(candidates: LifeEventSeed[], userData: UserEventData, age: number, history: HistoryItem[]): LifeEventSeed | null {
  const total = candidates.reduce((sum, event) => sum + calculateEventSelectionWeight(event, userData, age, isUserDirected(event, userData, history)), 0);
  if (total <= 0) return null;

  let cursor = Math.random() * total;
  for (const event of candidates) {
    cursor -= calculateEventSelectionWeight(event, userData, age, isUserDirected(event, userData, history));
    if (cursor <= 0) return event;
  }

  return candidates[candidates.length - 1] || null;
}

// Helper to select one V2 life event intent dynamically. null means normal life progression.
export function queryDynamicLifeEvent(
  attribs: LifeAttributes,
  userData: UserEventData,
  age: number,
  history: HistoryItem[] = [],
  answers?: unknown
): LifeEventSeed | null {
  const candidates = LIFE_EVENTS_DATABASE.filter((event) => {
    return satisfiesHardAgeConstraint(event, age) && isEligibleForCandidatePool(event, attribs, userData, age, answers);
  });

  if (candidates.length === 0) return null;

  const nonCooledCandidates = candidates.filter((event) => !isEventInCooldown(event, history));
  if (nonCooledCandidates.length === 0) return null;

  const tagAllowedCandidates = nonCooledCandidates.filter((event) => !isTagSimilarToRecent(event, history));
  const similaritySafeCandidates = tagAllowedCandidates.length > 0 ? tagAllowedCandidates : nonCooledCandidates;

  const categoryAllowedCandidates = similaritySafeCandidates.filter((event) => !isCategoryLimited(event, history));
  const pressureSafeCandidates = categoryAllowedCandidates.length > 0 ? categoryAllowedCandidates : similaritySafeCandidates;
  const normalTransition = pressureSafeCandidates.find((event) => event.id === NORMAL_EVENT_ID);

  if (normalTransition && hasRecentMajorEvent(history) && hasStableBreathingRoom(attribs)) {
    return normalTransition;
  }

  const dramaticCandidates = pressureSafeCandidates.filter((event) => event.id !== NORMAL_EVENT_ID);
  if (dramaticCandidates.length === 0) return normalTransition || null;

  if (Math.random() < NULL_EVENT_CHANCE) return null;

  return pickWeighted(dramaticCandidates, userData, age, history);
}

export function buildEventMeta(event: LifeEventSeed): EventMeta {
  return {
    eventId: event.id,
    eventCategory: event.category,
    eventTags: eventTags(event),
    eventIntensity: event.fingerprint?.intensity || (event.intent.emotionalTone === "crisis" ? "major" : "minor"),
    phasePolicyId: event.intent.phasePolicyId || "generic_pressure_v1"
  };
}

export function getEventTemporalProfile(event: LifeEventSeed): TemporalProfile {
  if (event.intent.temporalProfile) return event.intent.temporalProfile;
  if (event.fingerprint?.intensity === "major" || event.intent.emotionalTone === "crisis") {
    return { lifeIntensity: "high_tension", durationMonths: [6, 12], requiresFollowUp: true };
  }
  if (event.id === NORMAL_EVENT_ID || event.fingerprint?.intensity === "minor") {
    return { lifeIntensity: "normal", durationMonths: [12, 24], requiresFollowUp: false };
  }
  return { lifeIntensity: "normal", durationMonths: [12, 36], requiresFollowUp: false };
}

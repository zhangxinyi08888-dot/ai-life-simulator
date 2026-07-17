import type { EventMeta, HistoryItem, LifeAttributes, LifeEventCategory, NarrativeMode, TemporalProfile, UserInitialData } from "../types";
import {
  NARRATIVE_MODES,
  applyModeFatigue,
  computeModeWeights,
  pickModeByWeight,
  zeroUnavailableModeWeights
} from "../config/narrativeModePolicy";
import {
  evaluateEventEligibility,
  type EventHistoryCondition,
  type RequiredContextKey
} from "../utils/eventEligibility";
import { PHASE2_LIFE_EVENTS } from "./phase2LifeEvents";

type UserEventData = Partial<UserInitialData> & { birthday?: string; gender?: string; currentSituation?: string };

export type EmotionalTone =
  | "crisis"        // 直接威胁，需要立即响应（健康停摆、失业、重大损失）
  | "pressure"      // 累积张力，艰难取舍（责任冲突、利益博弈、家庭义务）
  | "crossroads"    // 真正的分岔口，每条路都有道理（职业转型、关系升级、城市迁移）
  | "opportunity"   // 正向可能，风险可控（新合作、新技能、新连接）
  | "flourishing"   // 事情在变好，选择在于如何利用这个势头
  | "connection"    // 关系在加深，选择在于信任和脆弱的程度
  | "reflection"    // 内部视角转变，选择在于如何看待自己和过去
  | "everyday";     // 日常的微小选择，随时间复利
export type ActionPrimitive = string;

export interface EventTrigger {
  // Eligibility only determines whether the event enters the candidate pool.
  // It must not be treated as a deterministic trigger.
  eligibility: (
    attribs: LifeAttributes,
    userData: UserEventData,
    age: number,
    history?: HistoryItem[],
    answers?: unknown
  ) => boolean;
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
  narrativeMode: NarrativeMode;
  semanticFamily: string;
  dispatchMode?: "random" | "arc_only";
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
  historyConditionGroups?: EventHistoryCondition[][];
  requiredContextGroups?: RequiredContextKey[][];
}

export interface EventSelectionTrace {
  selectedMode?: NarrativeMode;
  availableModes: NarrativeMode[];
  modeWeightsBeforeFatigue?: Record<NarrativeMode, number>;
  modeWeightsAfterFatigue?: Record<NarrativeMode, number>;
  candidateIdsBeforeFilters: string[];
  candidateIdsAfterFilters: string[];
  selectedEventId?: string;
  selectionReason: string;
}

let lastEventSelectionTrace: EventSelectionTrace | undefined;

export function getLastEventSelectionTrace(): EventSelectionTrace | undefined {
  return lastEventSelectionTrace ? structuredClone(lastEventSelectionTrace) : undefined;
}

export const LIFE_EVENTS_DATABASE: LifeEventSeed[] = [
  {
    id: "career_venture_pressure",
    category: "career",
    narrativeMode: "crossroads_opportunity",
    semanticFamily: "career_transition",
    requiredContextGroups: [["career_or_creation_direction"]],
    historyConditionGroups: [[{ type: "event_absent", semanticFamilies: ["career_transition"], withinNodes: 6 }]],
    title: "事业机会与承压跃迁",
    minAge: 22,
    maxAge: 45,
    conditionDescription: "才智与资源足以进入更高风险事业机会",
    cooldown: 5,
    baseProbability: 0.65,
    tags: ["career", "opportunity", "instability", "ambition"],
    trigger: {
      eligibility: (attribs) => attribs.intelligence >= 60
    },
    intent: {
      type: "career_venture_pressure",
      meaning: "事业上出现一次更高收益但更高不确定性的跃迁机会。",
      tensionAxes: ["野心 vs 稳定", "机会窗口 vs 现金流风险", "自我证明 vs 可承受代价"],
      allowedOutcomes: ["run_limited_venture_pilot", "stay_lean_and_preserve_optionality", "commit_to_high_risk_leap"],
      emotionalTone: "opportunity"
    }
  },
  {
    id: "career_responsibility_shift",
    category: "career",
    narrativeMode: "pressure_crisis",
    semanticFamily: "career_scope_change",
    requiredContextGroups: [["career_active"]],
    title: "责任转移与利益不对等",
    minAge: 23,
    maxAge: 55,
    conditionDescription: "人际较高且处在资源或组织关系中",
    cooldown: 6,
    baseProbability: 0.7,
    tags: ["career", "responsibility_shift", "interest_conflict", "reputation_risk"],
    trigger: {
      eligibility: (_attribs, _userData, _age, history = []) => /责任|团队|协作|组织变化|扩张|分工/.test(history.slice(-6).map((item) => `${item.description} ${item.selectedChoice}`).join(" "))
    },
    intent: {
      type: "career_responsibility_shift",
      meaning: "你被卷入一次责任与利益不对等的局面，需要判断是否承担不属于自己的代价。",
      tensionAxes: ["责任 vs 自保", "关系 vs 原则", "短期机会 vs 长期名声"],
      allowedOutcomes: ["accept_limited_responsibility", "draw_explicit_responsibility_boundary", "seek_rule_based_mediation"],
      emotionalTone: "pressure"
    }
  },
  {
    id: "career_structural_instability",
    category: "career",
    narrativeMode: "pressure_crisis",
    semanticFamily: "career_structural_instability",
    requiredContextGroups: [["career_active"]],
    title: "结构变化与生计压力",
    minAge: 22,
    maxAge: 58,
    conditionDescription: "财富/资源较低，抗风险能力不足",
    cooldown: 5,
    baseProbability: 0.75,
    tags: ["career", "instability", "survival_pressure", "transition"],
    trigger: {
      eligibility: (_attribs, _userData, _age, history = []) => {
        const financial = [...history].reverse().find((item) => item.financialState)?.financialState;
        return financial?.incomeStability === "unstable" || financial?.incomeStability === "volatile"
          || /裁员|降薪|岗位变化|行业变化|组织调整|收入不稳/.test(history.slice(-8).map((item) => `${item.description} ${item.selectedChoice}`).join(" "));
      }
    },
    intent: {
      type: "career_structural_instability",
      meaning: "外部结构变化让原本的收入或职业路径变得不稳定。",
      tensionAxes: ["生存现金流 vs 职业尊严", "快速止损 vs 长期转型", "被动适应 vs 主动重组"],
      allowedOutcomes: ["stabilize_immediate_cashflow", "invest_in_gradual_transition", "activate_verified_network_support"],
      emotionalTone: "crisis"
    }
  },
  {
    id: "career_credit_ownership_conflict",
    category: "career",
    narrativeMode: "pressure_crisis",
    semanticFamily: "career_credit_ownership",
    requiredContextGroups: [["active_project_context"]],
    title: "成果归属与边界争夺",
    minAge: 20,
    maxAge: 50,
    conditionDescription: "才智突出，容易产出关键价值",
    cooldown: 6,
    baseProbability: 0.62,
    tags: ["career", "credit_ownership", "boundary", "reputation_risk"],
    trigger: {
      eligibility: (_attribs, _userData, _age, history = []) => /协作者|合作方|组织|团队|署名|归属|成果|版权|功劳/.test(history.slice(-8).map((item) => `${item.description} ${item.selectedChoice}`).join(" "))
    },
    intent: {
      type: "career_credit_ownership_conflict",
      meaning: "你创造的关键价值面临被他人、组织或合作关系重新分配。",
      tensionAxes: ["体面合作 vs 自我主张", "眼前安全 vs 长期权益", "规则内争取 vs 关系破裂风险"],
      allowedOutcomes: ["document_and_negotiate_ownership", "challenge_credit_capture_formally", "preserve_core_work_and_exit"],
      emotionalTone: "pressure"
    }
  },
  {
    id: "relationship_material_commitment_test",
    category: "relationship",
    narrativeMode: "crossroads_opportunity",
    semanticFamily: "relationship_commitment",
    requiredContextGroups: [["confirmed_partner"]],
    title: "关系承诺与现实成本",
    minAge: 24,
    maxAge: 42,
    conditionDescription: "幸福度尚可，关系进入现实承诺压力区",
    cooldown: 5,
    baseProbability: 0.65,
    tags: ["relationship", "commitment", "financial_pressure", "family_expectation"],
    trigger: {
      eligibility: (_attribs, _userData, _age, history = []) => /共同计划|关系推进|同居|承诺|生活安排|长期计划/.test(history.slice(-8).map((item) => `${item.description} ${item.selectedChoice}`).join(" "))
    },
    intent: {
      type: "relationship_material_commitment_test",
      meaning: "亲密关系进入现实承诺阶段，情感愿望需要面对资源、家庭和长期责任。",
      tensionAxes: ["感情 vs 物质基础", "两人共识 vs 家庭期待", "自由感 vs 稳定承诺"],
      allowedOutcomes: ["make_shared_commitment_plan", "delay_with_clear_conditions", "reassess_relationship_fit"],
      emotionalTone: "pressure"
    }
  },
  {
    id: "relationship_family_obligation_pull",
    category: "relationship",
    narrativeMode: "pressure_crisis",
    semanticFamily: "family_responsibility",
    requiredContextGroups: [["confirmed_family"]],
    title: "亲缘责任与自我边界",
    minAge: 22,
    maxAge: 60,
    conditionDescription: "人际较强但幸福承压",
    cooldown: 5,
    baseProbability: 0.68,
    tags: ["relationship", "family_obligation", "boundary", "sacrifice"],
    trigger: {
      eligibility: (_attribs, _userData, _age, history = []) => /家庭请求|家人.*请求|照护|赡养|家庭责任|家庭支出|资源压力/.test(history.slice(-8).map((item) => `${item.description} ${item.selectedChoice}`).join(" "))
    },
    intent: {
      type: "relationship_family_obligation_pull",
      meaning: "亲缘或熟人关系向你提出现实责任要求，你需要重新划定自我边界。",
      tensionAxes: ["亲情责任 vs 自我保护", "道义评价 vs 现实承受力", "回馈家庭 vs 保留人生主动权"],
      allowedOutcomes: ["offer_bounded_family_support", "set_firm_family_boundary", "renegotiate_family_support_terms"],
      emotionalTone: "pressure"
    }
  },
  {
    id: "relationship_trust_interest_fracture",
    category: "relationship",
    narrativeMode: "pressure_crisis",
    semanticFamily: "relationship_trust_fracture",
    requiredContextGroups: [["confirmed_partner"], ["confirmed_friend_or_colleague"]],
    title: "信任裂纹与利益考验",
    minAge: 20,
    maxAge: 55,
    conditionDescription: "关系资源与财富资源交叠",
    cooldown: 6,
    baseProbability: 0.58,
    tags: ["relationship", "betrayal", "interest_conflict", "trust"],
    trigger: {
      eligibility: (_attribs, _userData, _age, history = []) => /共同资源|共同利益|合作|信任矛盾|利益冲突|账目|承诺不一致/.test(history.slice(-8).map((item) => `${item.description} ${item.selectedChoice}`).join(" "))
    },
    intent: {
      type: "relationship_trust_interest_fracture",
      meaning: "一段重要关系在现实利益面前出现信任裂纹。",
      tensionAxes: ["情分 vs 利益", "和解 vs 切割", "继续合作 vs 建立防线"],
      allowedOutcomes: ["verify_issue_and_set_safeguards", "attempt_bounded_trust_repair", "end_shared_interest_arrangement"],
      emotionalTone: "pressure"
    }
  },
  {
    id: "health_system_warning",
    category: "health",
    narrativeMode: "pressure_crisis",
    semanticFamily: "health_system_warning",
    title: "健康系统预警",
    minAge: 22,
    maxAge: 60,
    conditionDescription: "健康下降或整体状态长期承压",
    cooldown: 6,
    baseProbability: 0.75,
    tags: ["health", "burnout", "instability", "system_warning"],
    fingerprint: {
      category: "health",
      tags: ["health", "burnout", "instability", "system_warning"],
      intensity: "minor"
    },
    trigger: {
      eligibility: (attribs) => attribs.health < 42
    },
    intent: {
      type: "health_system_warning",
      meaning: "持续压力、生活负荷或恢复不足引发身体或精神状态预警，需要结合最近经历判断具体影响。",
      tensionAxes: ["维持当前节奏 vs 调整整体负荷", "现实责任 vs 身体边界", "独自承受 vs 寻求支持"],
      allowedOutcomes: [
        "maintain_current_load_with_monitoring",
        "continue_goal_with_adjusted_execution",
        "pause_or_seek_professional_support"
      ],
      emotionalTone: "pressure",
      temporalProfile: {
        lifeIntensity: "normal",
        durationMonths: [3, 9],
        requiresFollowUp: false
      }
    }
  },
  {
    id: "health_forced_pause",
    category: "health",
    narrativeMode: "pressure_crisis",
    semanticFamily: "health_acute_crisis",
    dispatchMode: "arc_only",
    title: "身体停摆与节奏重排",
    minAge: 18,
    maxAge: 70,
    conditionDescription: "健康或整体状态已接近承受边界",
    cooldown: 8,
    baseProbability: 0.7,
    tags: ["health", "forced_pause", "burnout", "major_crisis"],
    fingerprint: {
      category: "health",
      tags: ["health", "forced_pause", "burnout", "major_crisis"],
      intensity: "major"
    },
    trigger: {
      eligibility: (attribs) => attribs.health < 30
    },
    intent: {
      type: "health_forced_pause",
      meaning: "身体或心理状态迫使原有生活节奏暂停，你必须重新安排生活责任、日常节奏和自我照料。",
      tensionAxes: ["继续硬撑 vs 接受停顿", "现实责任 vs 身体边界", "自我价值 vs 休息羞耻"],
      allowedOutcomes: [
        "continue_despite_medical_risk",
        "continue_with_restricted_capacity",
        "pause_for_treatment_and_recovery"
      ],
      emotionalTone: "crisis",
      phasePolicyId: "health_crisis_v1"
    }
  },
  {
    id: "health_recovery_observation",
    category: "health",
    narrativeMode: "recovery_growth",
    semanticFamily: "health_recovery_observation",
    dispatchMode: "arc_only",
    title: "治疗与负荷观察",
    minAge: 0,
    maxAge: 110,
    conditionDescription: "健康危机后的治疗、减负、恢复和长期管理阶段",
    cooldown: 0,
    baseProbability: 0,
    tags: ["health", "recovery", "observation"],
    fingerprint: {
      category: "health",
      tags: ["health", "recovery", "observation"],
      intensity: "minor"
    },
    trigger: {
      eligibility: () => false
    },
    intent: {
      type: "health_recovery_observation",
      meaning: "急性健康压力已经进入治疗、调整负荷和观察结果的阶段。",
      tensionAxes: ["恢复条件是否可持续", "原有人生方向如何调整执行", "短期缓解与长期管理"],
      allowedOutcomes: [
        "continue_goal_with_adjusted_execution",
        "maintain_recovery_and_monitoring",
        "restructure_life_around_health_limits"
      ],
      emotionalTone: "reflection",
      temporalProfile: {
        lifeIntensity: "normal",
        durationMonths: [3, 12],
        requiresFollowUp: false
      },
      phasePolicyId: "health_crisis_v1"
    }
  },
  {
    id: "opportunity_unstable_alliance",
    category: "opportunity",
    narrativeMode: "crossroads_opportunity",
    semanticFamily: "career_alliance_opportunity",
    requiredContextGroups: [["career_or_creation_direction"]],
    title: "不稳定联盟与未来押注",
    minAge: 21,
    maxAge: 50,
    conditionDescription: "才智较好但资源不足",
    cooldown: 5,
    baseProbability: 0.65,
    tags: ["opportunity", "alliance", "uncertainty", "resource_gap"],
    trigger: {
      eligibility: () => true
    },
    intent: {
      type: "opportunity_unstable_alliance",
      meaning: "一个外部合作机会打开了新的上升通道，但收益和风险都不稳定。",
      tensionAxes: ["低保障机会 vs 稳定现金流", "跟随他人 vs 保持自主", "未来想象 vs 当前生活成本"],
      allowedOutcomes: ["run_small_alliance_pilot", "decline_for_current_stability", "join_with_explicit_exit_conditions"],
      emotionalTone: "opportunity"
    }
  },
  {
    id: "opportunity_escape_route",
    category: "opportunity",
    narrativeMode: "crossroads_opportunity",
    semanticFamily: "self_escape_route",
    requiredContextGroups: [["identified_life_constraint"]],
    title: "逃离路径与代价交换",
    minAge: 22,
    maxAge: 48,
    conditionDescription: "幸福度低，存在逃离当前生活结构的动机",
    cooldown: 6,
    baseProbability: 0.6,
    tags: ["opportunity", "escape_route", "isolation", "high_reward"],
    trigger: {
      eligibility: () => true
    },
    intent: {
      type: "opportunity_escape_route",
      meaning: "一个能离开当前困局的机会出现，但它要求你付出孤独、风险或关系成本。",
      tensionAxes: ["逃离困局 vs 承受孤独", "高收益 vs 高不确定", "个人突破 vs 关系断裂"],
      allowedOutcomes: ["test_escape_route_temporarily", "stay_and_repair_current_structure", "decline_route_and_seek_another_option"],
      emotionalTone: "opportunity"
    }
  },
  {
    id: "financial_side_path_conflict",
    category: "financial",
    narrativeMode: "crossroads_opportunity",
    semanticFamily: "financial_side_path",
    requiredContextGroups: [["financial_state_available", "career_or_creation_direction"]],
    title: "副线收入与合规边界",
    minAge: 20,
    maxAge: 55,
    conditionDescription: "才智较好但财富尚不稳",
    cooldown: 5,
    baseProbability: 0.68,
    tags: ["financial", "side_income", "compliance_risk", "opportunity"],
    trigger: {
      eligibility: (_attribs, _userData, _age, history = []) => (latestFinancialStateFromHistory(history)?.cashWan ?? 0) >= 0
    },
    intent: {
      type: "financial_side_path_conflict",
      meaning: "一条新的收入路径开始出现，但它与现有身份、规则或稳定性产生冲突。",
      tensionAxes: ["增收机会 vs 合规风险", "短期现金 vs 长期信用", "自由探索 vs 稳定身份"],
      allowedOutcomes: ["run_compliant_side_income_pilot", "clarify_rules_before_committing", "decline_and_protect_core_income"],
      emotionalTone: "opportunity"
    }
  },
  {
    id: "life_normal_transition",
    category: "growth",
    narrativeMode: "stability_meaning",
    semanticFamily: "life_normal_accumulation",
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
      allowedOutcomes: ["maintain_current_rhythm", "make_one_small_adjustment", "strengthen_one_existing_direction_or_relationship"],
      emotionalTone: "everyday"
    }
  },
  ...PHASE2_LIFE_EVENTS
];

const DEFAULT_COOLDOWN = 4;
const TAG_SIMILARITY_THRESHOLD = 0.5;
const NORMAL_EVENT_ID = "life_normal_transition";
const FOCUS_CATEGORY_BOOST: Record<string, Partial<Record<LifeEventCategory, number>>> = {
  career: { career: 1.6, financial: 1.2, growth: 1.1 },
  romance: { relationship: 1.7, growth: 1.1 },
  wealth: { financial: 1.7, career: 1.2, opportunity: 1.1 },
  selftruth: { growth: 1.5, career: 1.1, opportunity: 1.1 },
  innerpeace: { growth: 1.5, health: 1.3, relationship: 1.1 }
};

function eventTags(event: LifeEventSeed): string[] {
  return event.fingerprint?.tags || event.tags;
}

function latestFinancialStateFromHistory(history: HistoryItem[]) {
  return [...history].reverse().find((item) => item.financialState)?.financialState;
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

function findEventById(eventId?: string): LifeEventSeed | undefined {
  return eventId ? LIFE_EVENTS_DATABASE.find((event) => event.id === eventId) : undefined;
}

function eventModeFromHistory(item: HistoryItem): NarrativeMode | undefined {
  return item.eventMeta?.eventMode || findEventById(item.eventMeta?.eventId)?.narrativeMode;
}

function semanticFamilyFromHistory(item: HistoryItem): string | undefined {
  return item.eventMeta?.eventSemanticFamily || findEventById(item.eventMeta?.eventId)?.semanticFamily;
}

function historyWithEventClassification(history: HistoryItem[]): HistoryItem[] {
  return history.map((item) => {
    if (!item.eventMeta) return item;
    const eventMode = eventModeFromHistory(item);
    const eventSemanticFamily = semanticFamilyFromHistory(item);
    if (item.eventMeta.eventMode === eventMode && item.eventMeta.eventSemanticFamily === eventSemanticFamily) return item;
    return {
      ...item,
      eventMeta: {
        ...item.eventMeta,
        eventMode,
        eventSemanticFamily
      }
    };
  });
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
    if (semanticFamilyFromHistory(item) === event.semanticFamily) return true;
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
  return history.slice(-2).some((item) => (
    item.eventMeta?.eventIntensity === "major" || item.eventMeta?.eventTags?.includes("major_crisis")
  ));
}

function hasStableBreathingRoom(attribs: LifeAttributes): boolean {
  return attribs.health >= 50 && attribs.wealth >= 50 && attribs.happiness >= 50;
}

function isEligibleForCandidatePool(
  event: LifeEventSeed,
  attribs: LifeAttributes,
  userData: UserEventData,
  age: number,
  history: HistoryItem[],
  answers?: unknown
): boolean {
  if (event.dispatchMode === "arc_only") return false;
  if (!event.trigger.eligibility(attribs, userData, age, history, answers)) return false;
  return evaluateEventEligibility({ event, attribs, userData, age, history, answers });
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

export function isLifeEventCandidateEligible(
  event: LifeEventSeed,
  attribs: LifeAttributes,
  userData: UserEventData,
  age: number,
  history: HistoryItem[] = [],
  answers?: unknown
): boolean {
  const classifiedHistory = historyWithEventClassification(history);
  return satisfiesHardAgeConstraint(event, age)
    && isEligibleForCandidatePool(event, attribs, userData, age, classifiedHistory, answers);
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
    opportunity: ["机会", "合作", "创业", "转型"],
    community: ["社区", "公益", "邻里", "志愿", "公共事务"]
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
  const classifiedHistory = historyWithEventClassification(history);
  const candidates = LIFE_EVENTS_DATABASE.filter((event) => {
    return satisfiesHardAgeConstraint(event, age)
      && isEligibleForCandidatePool(event, attribs, userData, age, classifiedHistory, answers);
  });

  lastEventSelectionTrace = {
    availableModes: [],
    candidateIdsBeforeFilters: candidates.map((event) => event.id),
    candidateIdsAfterFilters: [],
    selectionReason: "no_eligible_candidates"
  };

  if (candidates.length === 0) return null;

  const nonCooledCandidates = candidates.filter((event) => !isEventInCooldown(event, classifiedHistory));
  if (nonCooledCandidates.length === 0) {
    lastEventSelectionTrace.selectionReason = "all_candidates_in_cooldown";
    return null;
  }

  const tagAllowedCandidates = nonCooledCandidates.filter((event) => !isTagSimilarToRecent(event, classifiedHistory));
  if (tagAllowedCandidates.length === 0) {
    lastEventSelectionTrace.selectionReason = "all_candidates_semantically_similar";
    return null;
  }

  const categoryAllowedCandidates = tagAllowedCandidates.filter((event) => !isCategoryLimited(event, classifiedHistory));
  if (categoryAllowedCandidates.length === 0) {
    lastEventSelectionTrace.selectionReason = "all_candidates_category_limited";
    return null;
  }
  lastEventSelectionTrace.candidateIdsAfterFilters = categoryAllowedCandidates.map((event) => event.id);

  const candidatesByMode = new Map<NarrativeMode, LifeEventSeed[]>(
    NARRATIVE_MODES.map((mode) => [mode, categoryAllowedCandidates.filter((event) => event.narrativeMode === mode)])
  );
  const stabilityCandidates = candidatesByMode.get("stability_meaning") || [];
  lastEventSelectionTrace.availableModes = NARRATIVE_MODES.filter((mode) => (candidatesByMode.get(mode)?.length || 0) > 0);

  if (hasRecentMajorEvent(classifiedHistory) && hasStableBreathingRoom(attribs)) {
    const selected = pickWeighted(stabilityCandidates, userData, age, classifiedHistory);
    lastEventSelectionTrace.selectedMode = selected?.narrativeMode;
    lastEventSelectionTrace.selectedEventId = selected?.id;
    lastEventSelectionTrace.selectionReason = selected ? "post_major_breathing_room" : "post_major_no_stability_candidate";
    return selected;
  }

  const availableModes = new Set(
    NARRATIVE_MODES.filter((mode) => (candidatesByMode.get(mode)?.length || 0) > 0)
  );
  const availableWeights = zeroUnavailableModeWeights(
    computeModeWeights(attribs, classifiedHistory, userData),
    availableModes
  );
  const fatiguedWeights = applyModeFatigue(availableWeights, classifiedHistory);
  lastEventSelectionTrace.modeWeightsBeforeFatigue = { ...availableWeights };
  lastEventSelectionTrace.modeWeightsAfterFatigue = { ...fatiguedWeights };
  const selectedMode = pickModeByWeight(fatiguedWeights);
  if (!selectedMode) {
    lastEventSelectionTrace.selectionReason = "no_weighted_mode";
    return null;
  }

  const selected = pickWeighted(candidatesByMode.get(selectedMode) || [], userData, age, classifiedHistory);
  lastEventSelectionTrace.selectedMode = selectedMode;
  lastEventSelectionTrace.selectedEventId = selected?.id;
  lastEventSelectionTrace.selectionReason = selected ? "weighted_mode_selection" : "selected_mode_without_candidate";
  return selected;
}

export function queryHealthEscalationEvent(
  attribs: LifeAttributes,
  history: HistoryItem[] = []
): LifeEventSeed | null {
  const forcedPause = LIFE_EVENTS_DATABASE.find((event) => event.id === "health_forced_pause");
  if (!forcedPause || isEventInCooldown(forcedPause, history)) return null;

  if (attribs.health < 30) return forcedPause;
  if (attribs.health >= 38) return null;

  const recent = history.slice(-3);
  if (recent.length < 3) return null;

  const hasRecentWarning = recent.some((item) => item.eventMeta?.eventId === "health_system_warning");
  if (!hasRecentWarning) return null;

  const healthValues = [recent[0].attributes.health, recent[1].attributes.health, attribs.health];
  const continuouslyDeclining = healthValues[0] > healthValues[1] && healthValues[1] > healthValues[2];
  const totalDecline = healthValues[0] - healthValues[2];
  const continuouslyDepleted = recent.slice(-2).every((item) => item.narrativeMeta?.recoveryState === "depleted");

  return continuouslyDeclining && totalDecline >= 8 && continuouslyDepleted
    ? forcedPause
    : null;
}

export function buildEventMeta(event: LifeEventSeed): EventMeta {
  return {
    eventId: event.id,
    eventCategory: event.category,
    eventTags: eventTags(event),
    eventIntensity: event.fingerprint?.intensity || (event.intent.emotionalTone === "crisis" ? "major" : "minor"),
    eventMode: event.narrativeMode,
    eventSemanticFamily: event.semanticFamily,
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

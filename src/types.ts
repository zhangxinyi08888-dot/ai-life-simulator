/**
 * Shared Type Definitions for AI Life Simulator
 */

import type { FinancialLedger, FinancialPeriodSummary } from "./domain/finance/types";

export interface LifeAttributes {
  happiness: number;   // 幸福度 (0 - 100)
  intelligence: number; // 智商/才干 (0 - 100)
  wealth: number;       // 财富/资源 (0 - 100)
  relation: number;     // 人际/情商 (0 - 100)
  health: number;       // 健康/精力 (0 - 100)
}

export type IncomeStability = "unstable" | "volatile" | "stable" | "very_stable";
export type EmploymentStatus = "student" | "part_time" | "employed" | "self_employed" | "not_working" | "medical_leave" | "retired";

export interface FinancialSignals {
  employmentStatus: EmploymentStatus;
  monthlyNetIncomeWan: number;
  incomeMonths: number;
  monthlyLivingExpenseWan: number;
  oneOffIncomeWan: number;
  oneOffExpenseWan: number;
  assetValueChangeWan: number;
  propertyMarketValueChangeWan: number;
  personalDebtChangeWan: number;
  incomeStability: IncomeStability;
  confidence: number;
  reasons: string[];
}

export interface FinancialState {
  currencyUnit: "CNY_WAN_REAL";
  asOfAgeInMonths: number;
  cashWan: number;
  investmentAssetsWan: number;
  propertyMarketValueWan: number;
  businessAndOtherAssetsWan: number;
  totalDebtWan: number;
  netWorthWan: number;
  annualAfterTaxIncomeWan: number;
  annualDisposableIncomeWan: number;
  annualCoreExpenseWan: number;
  employmentStatus?: EmploymentStatus;
  incomeStability: IncomeStability;
  isEstimated: boolean;
}

export interface FinancialChange {
  periodMonths: number;
  afterTaxIncomeWan: number;
  livingExpenseWan: number;
  medicalEducationExpenseWan: number;
  interestAndFeesWan: number;
  assetValueChangeWan: number;
  otherNetChangeWan: number;
  netWorthChangeWan: number;
  liquidityShortfallWan?: number;
  incomeStability?: IncomeStability;
  reasons: string[];
}

export interface EmploymentTransitionProposal {
  subject: "protagonist";
  toStatus: EmploymentStatus;
  effectiveAtAgeInMonths: number;
  sourceOutcomeId?: string;
  evidence: string;
  confidence: number;
}

export interface UserInitialData {
  birthday: string;          // 出生日期: YYYY-MM-DD
  birthtime: string;         // 出生时间: HH:MM or unspecified
  gender: string;            // 性别
  currentSituation: string;  // 现实中当前的情况描述
  isReturnToPast: boolean;   // 是否选择回溯/回到过去某个时间点
  targetAgeNode: string;     // 回溯年份或时间节点说明

  // 主要人生节点记录 (高考、升学、找工作、换工作、裁员、恋爱、结婚等)
  milestoneGaokao?: string;       // 高考与升学情况 (如：哪年高考，留下了哪些志愿遗憾)
  milestoneCareer?: string;       // 找工作、换工作与离职裁员经历
  milestoneRelationship?: string; // 情感、恋爱与结婚进展与遗恨
  milestoneOther?: string;        // 其他宿命机遇或危机回忆
  milestones?: { id: string; title: string; content: string; icon?: string; placeholder?: string; presetTemplate?: string }[];

  // 用户自主选择时光倒流回溯的节点、当时的困境和曾经的选择
  regressionNodeKey: string;      // 回到的节点标识 ("gaokao" | "career" | "layoff" | "romance" | "marriage" | "custom" 等)
  regressionAge: number;          // 回溯起点年龄
  regressionSituation: string;    // 该节点当时的前后文细节及困厄
  regressionChoices: string;      // 当时面临的纠结选择、或梦寐以求想要做的其它选项
  coreStoryFocus: string;         // 核心主线设定 ("career" | "romance" | "wealth" | "selftruth" | "innerpeace")
}

export interface QuestionTurn {
  id: number;
  question: string;
  answer: string | null;
}

export interface QuestionItem {
  question: string;
  suggestions: string[];
}

export interface SimulationChoice {
  id: string;               // "A", "B", "C", "custom"
  text: string;             // 选项文本
  impactSummary: string;    // 选项潜在线索提示或意味
  temporalHint?: ChoiceTemporalHint;
  decisionIntent?: string;   // 稳定的“领域:动作:对象”语义指纹；旧历史可缺失并回退到选项文本
  eventOutcomeId?: string;   // 当前事件允许的结果原语；旧节点和 null 事件节点可缺失
  expectedWorldDeltaTypes?: WorldDelta["type"][];
}

export type LifeIntensity = "critical" | "high_tension" | "normal" | "stable";
export type ReportInvitationReason = "arc_resolved" | "stable_window";
export type SimulationClosureType = "user_reflection" | "mortality";

export interface FinalOutcomeContext {
  closureType: SimulationClosureType;
  invitationReason?: ReportInvitationReason;
  pressureArcId?: string;
  resolutionEvidence?: string[];
}

export interface ReportInvitationMeta {
  id: string;
  status: "pending" | "accepted" | "declined";
  reason: ReportInvitationReason;
  triggerKey: string;
  completedChoiceCount: number;
  pressureArcId?: string;
  resolutionEvidence?: string[];
  acceptedAtChoiceCount?: number;
  declinedAtChoiceCount?: number;
}

export type LifeStage =
  | "childhood"
  | "adolescence"
  | "emerging_adulthood"
  | "early_adulthood"
  | "midlife"
  | "mature_adulthood"
  | "later_life"
  | "longevity";
export type RecoveryState = "protected" | "neutral" | "depleted";

export interface TemporalProfile {
  lifeIntensity: LifeIntensity;
  durationMonths: [number, number];
  requiresFollowUp: boolean;
}

export interface ChoiceTemporalHint extends TemporalProfile {
  reason: string;
}

export type LifeEventCategory = "career" | "relationship" | "health" | "financial" | "growth" | "opportunity" | "community";
export type NarrativeMode = "pressure_crisis" | "crossroads_opportunity" | "recovery_growth" | "stability_meaning";

export interface EventMeta {
  eventId?: string;
  eventCategory?: LifeEventCategory;
  eventTags: string[];
  eventIntensity?: "minor" | "major";
  eventMode?: NarrativeMode;
  eventSemanticFamily?: string;
  phasePolicyId?: string;
}

export type WorldDelta =
  | { type: "person_status"; personId: string; status: PersonLifeStatus; reason: string }
  | { type: "person_role"; personId: string; occupationStatus: PersonState["occupationStatus"] }
  | { type: "relationship_change"; personId: string; summary: string }
  | { type: "career_state"; summary: string; employmentTransition?: EmploymentTransitionProposal }
  | { type: "health_state"; summary: string }
  | { type: "location_change"; summary: string };

export interface ArcSignalProposal {
  pressureArcId?: string;
  type: string;
  evidence: string;
  confidence: number;
}

export type PersonRelation = "parent" | "grandparent" | "partner" | "child" | "sibling" | "friend" | "colleague" | "mentor" | "other";
export type PersonLifeStatus = "active" | "retired" | "limited" | "distant" | "deceased" | "unknown";
export type PersonPresenceMode = "active_scene" | "remote_contact" | "indirect_update" | "memory" | "legacy";

export interface PersonState {
  id: string;
  displayName?: string;
  relation: PersonRelation;
  explicitAge?: number;
  estimatedAgeRange?: [number, number];
  ageInMonthsAtLastUpdate?: number;
  protagonistAgeInMonthsAtLastUpdate?: number;
  lifeStatus: PersonLifeStatus;
  occupationStatus?: "student" | "working" | "retired" | "not_working" | "unknown";
  healthStatus?: "stable" | "fragile" | "care_dependent" | "unknown";
  lastSeenNodeIndex?: number;
  relationshipSummary?: string;
  source: "user_fact" | "answer" | "history" | "model_inferred";
  confidence: number;
}

export interface DirectionArc {
  id: string;
  directionType: string;
  summary: string;
  status: "active" | "background" | "dormant" | "resolved";
  startedAtAgeInMonths: number;
  userReinforcementCount: number;
  establishedAssets: string[];
}

export interface PressureArcState {
  id: string;
  eventId: string;
  eventIntentType: string;
  directionArcId?: string;
  phasePolicyId: string;
  phaseId: string;
  status: "active" | "stabilizing" | "resolved";
  startedAtAgeInMonths: number;
  phaseStartedAtAgeInMonths: number;
  phaseCheckpointCount: number;
  totalCheckpointCount: number;
  unresolvedSummary: string;
}

export interface TimelineTransition {
  atAgeInMonths: number;
  materiality: "transition" | "meaningful_update";
  summary: string;
  worldDeltas: WorldDelta[];
}

export interface StoryEpisode {
  id: string;
  directionArcId?: string;
  pressureArcId?: string;
  startAgeInMonths: number;
  endAgeInMonths: number;
  internalTransitions: TimelineTransition[];
  decisionCheckpointId: string;
  summary: string;
}

export interface NarrativeMeta {
  elapsedMonths: number;
  elapsedYears: number;
  lifeIntensity: LifeIntensity;
  nodeMateriality: "decision_checkpoint";
  storyEpisode: StoryEpisode;
  recoveryState: RecoveryState;
  recoveryEvidence: string[];
  arcSignals: ArcSignalProposal[];
  activeCharacters: Array<{
    personId?: string;
    displayName?: string;
    relation: PersonRelation;
    estimatedAge?: number;
    presenceMode: PersonPresenceMode;
    currentRole?: string;
  }>;
  primaryActivity?: {
    domain: "education" | "career" | "family" | "health" | "community" | "leisure" | "legacy";
    intensity: "low" | "moderate" | "high";
  };
  worldDeltas: WorldDelta[];
}

export interface WorldStateSnapshot {
  people: PersonState[];
  directionArcs: DirectionArc[];
  pressureArcs: PressureArcState[];
  foregroundPressureArcId?: string;
  careerSummary?: string;
  relationshipSummary?: string;
  healthSummary?: string;
  locationSummary?: string;
  currentEmploymentStatus?: EmploymentStatus;
  committedTransactionIds?: string[];
  version: 1;
}

export interface SimulationNode {
  age: number;              // 当前模拟的年龄
  ageInMonths?: number;      // 精确时间真值；旧节点缺失时使用 age * 12
  lifeStage?: LifeStage;
  stage: string;            // 人生阶段: "学步懵懂", "金石华年", "立身扬名", "不惑风雨", "桑榆暮景", "终章致敬" 等
  title: string;            // 本节标题
  description: string;      // 描述性互动小说正文
  choices: SimulationChoice[]; // 三个预设选项 + 支持自定义
  attributes: LifeAttributes;  // 更新后的五维属性值
  financialLedger?: FinancialLedger;
  financialState?: FinancialState;
  financialPeriodSummary?: FinancialPeriodSummary;
  financialSignals?: FinancialSignals;
  financialChange?: FinancialChange;
  isEndingNode: boolean;       // 是否已到达人生终点
  eventMeta?: EventMeta;        // 触发本节点的事件种子元数据，用于冷却与同类限制
  narrativeMeta?: NarrativeMeta;
  worldStateSnapshot?: WorldStateSnapshot;
  committedArcMeta?: {
    pressureArcId?: string;
    phaseId?: string;
    transitionAction?: "start" | "stay" | "advance" | "fallback" | "suspend" | "resume" | "resolve";
  };
  reportInvitation?: ReportInvitationMeta;
}

export interface HistoryItem {
  age: number;
  ageInMonths?: number;
  lifeStage?: LifeStage;
  title: string;
  stage: string;
  description: string;
  selectedChoice: string;
  selectedDecisionIntent?: string;
  attributes: LifeAttributes;   // 存储该历史节点当时的属性状态，支持高保真时光回溯
  financialLedger?: FinancialLedger;
  financialState?: FinancialState;
  financialPeriodSummary?: FinancialPeriodSummary;
  financialSignals?: FinancialSignals;
  financialChange?: FinancialChange;
  choices: SimulationChoice[];   // 存储该节点当时的选项，支持回到历史节点重新选择
  isEndingNode: boolean;         // 存储该节点是否为结局节点，支持完整恢复节点状态
  eventMeta?: EventMeta;
  narrativeMeta?: NarrativeMeta;
  worldStateSnapshot?: WorldStateSnapshot;
  committedArcMeta?: SimulationNode["committedArcMeta"];
  reportInvitation?: ReportInvitationMeta;
}

export interface PersonalityInsight {
  lifeTitle: string;        // 终极人生称号
  epitaph: string;          // 温暖且深刻的人生志铭
  personalityTraits: {
    trait: string;          // 特质名称
    score: number;          // 得分 (0-100)
    description: string;    // 详细表现描述
  }[];
  detailedAnalysis: string; // 深度心理与性格剖析
  realLifeAdvice: string;   // 针对现实生活的温情建议
  growthAdvice: string;     // 针对个人成长的具体建议 (Personal Growth)
  decisionAdvice: string;   // 针对重大决策的决策学建议 (Decision Making Wisdom)
  wellnessAdvice: string;   // 针对身心调适与幸福保障的健康建议 (Well-being & Mindful-care)
}

export type PosterTheme = "warm_realistic" | "quiet_dark" | "clean_magazine";

export interface ShareTimelineItem {
  ageLabel: string;
  icon: string;
  title: string;
  choiceSummary: string;
  keyMomentIndexes: number[];
}

export interface ShareEndingCard {
  viralTitle: string;
  covenantTitle: string;
  oneLineSummary: string;
  timeline: ShareTimelineItem[];
  closingLine: string;
  posterTheme: PosterTheme;
  downloadFileName: string;
  imageAlt: string;
}

export interface PatternSummary {
  name: string;
  shortDescription: string;
  keyMomentIndexes: number[];
}

export interface LifePattern {
  name: string;
  title: string;
  paragraphs: string[];
  keyMomentIndexes: number[];
  closingLine: string;
}

export interface PatternEffect {
  patternName: string;
  compoundReturn: string;
  hiddenCost: string;
  paragraphs: string[];
  keyMomentIndexes: number[];
  closingLine: string;
}

export interface FutureTrend {
  title: string;
  trend: string;
  reason: string;
  keyMomentIndexes: number[];
}

export interface PatternUpgradeItem {
  title: string;
  why: string;
  paragraphs: string[];
  keyMomentIndexes: number[];
  closingLine: string;
}

export interface LifePatternReport {
  executiveSummary: {
    headline: string;
    patterns: PatternSummary[];
    closingLine: string;
  };
  repeatedPatterns: LifePattern[];
  patternEffects: PatternEffect[];
  futureTrends: FutureTrend[];
  patternsToKeep: PatternUpgradeItem[];
  patternsToAdjust: PatternUpgradeItem[];
  finalLifeReading: {
    title: string;
    paragraphs: string[];
    finalSentence: string;
  };
}

export interface FinalLifeOutcome {
  share: ShareEndingCard;
  report: LifePatternReport;
  meta: {
    generatedAt: string;
    modelProvider: "deepseek" | "openai" | "mock";
    posterVersion: "web-v1";
    reportVersion: "life-pattern-v2";
    closureType: SimulationClosureType;
  };
}

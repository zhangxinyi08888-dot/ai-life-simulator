import type { HistoryItem, QuestionTurn, UserInitialData } from "../types";
import { formatAgeInMonths } from "./timelineAdvance";

export type BackgroundThreadType =
  | "romance"
  | "family"
  | "friendship"
  | "career"
  | "health"
  | "financial"
  | "growth";

export interface BackgroundThread {
  id: string;
  type: BackgroundThreadType;
  source: "user_fact" | "answer" | "history" | "event";
  summary: string;
  salience: number;
  lastTouchedNode?: number;
}

export type StoryFactType =
  | "long_term_fact"
  | "stage_fact"
  | "interest_signal"
  | "temporary_emotion";

export type StoryFactSource = "user_data" | "question_answer" | "history" | "choice";

export type DirectionSignalState =
  | "mentioned"
  | "background_detail"
  | "side_thread"
  | "stage_main_arc"
  | "long_term_main_arc";

export interface StoryFact {
  id: string;
  type: StoryFactType;
  text: string;
  source: StoryFactSource;
  sourceAge?: number;
  sourceNodeIndex?: number;
  salience: number;
  decayRate: number;
  currentWeight: number;
  reinforcementCount: number;
  promotedToArc: boolean;
  directionState?: DirectionSignalState;
  stateReason?: string;
  userReinforcementCount?: number;
  modelMentionCount?: number;
  consecutiveUnselectedCount?: number;
}

export interface StoryContextPack {
  userFacts: string[];
  answerFacts: string[];
  longTermFacts: StoryFact[];
  stageFacts: StoryFact[];
  interestSignals: StoryFact[];
  temporaryEmotions: StoryFact[];
  recentHistory: HistoryItem[];
  activeThreads: BackgroundThread[];
}

function compact(value: unknown): string {
  return String(value ?? "").trim();
}

function pushFact(facts: string[], label: string, value: unknown) {
  const text = compact(value);
  if (text && text !== "暂无描述") facts.push(`${label}：${text}`);
}

function answerFactsFrom(answers: unknown): string[] {
  if (!answers) return [];

  const turns = Array.isArray(answers)
    ? answers
    : typeof answers === "object"
      ? Object.entries(answers as Record<string, unknown>).map(([key, value]) => {
          const record = value && typeof value === "object" ? value as Partial<QuestionTurn> : undefined;
          return {
            question: record?.question || key,
            answer: record?.answer ?? value
          };
        })
      : [{ question: "用户补充", answer: answers }];

  return turns
    .map((turn) => {
      const record = turn as Partial<QuestionTurn>;
      const question = compact(record.question || "追问");
      const answer = compact(record.answer);
      return answer ? `${question}：${answer}` : "";
    })
    .filter(Boolean);
}

function includesAny(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => text.includes(keyword));
}

const INTEREST_KEYWORDS = [
  "兴趣",
  "感兴趣",
  "喜欢",
  "热爱",
  "想学",
  "想做",
  "植物",
  "写作",
  "设计",
  "游戏",
  "音乐",
  "绘画",
  "摄影"
];

const DIRECTION_SIGNAL_KEYWORDS = [
  "植物",
  "写作",
  "设计",
  "游戏",
  "音乐",
  "绘画",
  "摄影",
  "AI",
  "人工智能",
  "互联网",
  "金融",
  "教育",
  "医疗",
  "农业",
  "法律",
  "咨询",
  "创业",
  "自由职业",
  "北京",
  "上海",
  "深圳",
  "广州",
  "杭州",
  "出国",
  "回老家"
];

const GENERIC_CHOICE_TEXTS = [
  "继续推进",
  "保持现状",
  "暂时观望",
  "先稳住",
  "稳住现状",
  "顺其自然",
  "继续当前节奏"
];

const OUTCOME_KEYWORDS = [
  "作品",
  "收入",
  "付费",
  "用户",
  "证书",
  "合作",
  "职业身份",
  "身份",
  "长期项目",
  "项目上线",
  "上线",
  "团队",
  "客户",
  "订单",
  "真实工作",
  "变现"
];

const EMOTION_KEYWORDS = ["怕", "焦虑", "后悔", "想逃", "不甘", "冲动", "压力", "纠结", "迷茫"];

const DIRECTION_FACT_KEYWORDS = [...INTEREST_KEYWORDS, ...DIRECTION_SIGNAL_KEYWORDS];

const FACT_DEFAULTS: Record<StoryFactType, { salience: number; decayRate: number }> = {
  long_term_fact: { salience: 0.9, decayRate: 0.02 },
  stage_fact: { salience: 0.75, decayRate: 0.12 },
  interest_signal: { salience: 0.45, decayRate: 0.18 },
  temporary_emotion: { salience: 0.35, decayRate: 0.25 }
};

function makeStoryFact(
  type: StoryFactType,
  text: string,
  source: StoryFactSource,
  index: number,
  sourceAge?: number,
  sourceNodeIndex?: number,
  currentNodeIndex = sourceNodeIndex ?? 0,
  reinforcementCount = 0,
  directionState?: DirectionSignalState,
  modelMentionCount = 0,
  consecutiveUnselectedCount = 0,
  stateReason?: string
): StoryFact {
  const defaults = FACT_DEFAULTS[type];
  const nodeDistance = typeof sourceNodeIndex === "number"
    ? Math.max(0, currentNodeIndex - sourceNodeIndex)
    : 0;
  const reinforcementMultiplier = 1 + reinforcementCount * 0.35;
  const promotedToArc = type === "interest_signal" && (
    directionState === "stage_main_arc" ||
    directionState === "long_term_main_arc"
  );
  const decayedWeight = defaults.salience * Math.pow(1 - defaults.decayRate, nodeDistance) * reinforcementMultiplier;
  const stateFloor = directionState === "long_term_main_arc" || directionState === "stage_main_arc"
    ? 0.75
    : directionState === "side_thread"
      ? 0.55
      : 0;
  const stateCap = directionState === "mentioned" ? 0.2 : 1;
  const currentWeight = Math.min(promotedToArc ? Math.max(decayedWeight, stateFloor) : Math.max(decayedWeight, stateFloor), stateCap);

  return {
    id: `${type}_${index + 1}`,
    type,
    text,
    source,
    sourceAge,
    sourceNodeIndex,
    salience: defaults.salience,
    decayRate: defaults.decayRate,
    currentWeight,
    reinforcementCount,
    promotedToArc,
    directionState,
    stateReason,
    userReinforcementCount: type === "interest_signal" ? reinforcementCount : undefined,
    modelMentionCount: type === "interest_signal" ? modelMentionCount : undefined,
    consecutiveUnselectedCount: type === "interest_signal" ? consecutiveUnselectedCount : undefined
  };
}

function pushStoryFact(
  facts: StoryFact[],
  type: StoryFactType,
  text: unknown,
  source: StoryFactSource,
  sourceAge?: number,
  sourceNodeIndex?: number,
  currentNodeIndex = sourceNodeIndex ?? 0,
  reinforcementCount = 0,
  directionState?: DirectionSignalState,
  modelMentionCount = 0,
  consecutiveUnselectedCount = 0,
  stateReason?: string
) {
  const cleanText = compact(text);
  if (!cleanText || cleanText === "暂无描述") return;
  facts.push(makeStoryFact(
    type,
    cleanText,
    source,
    facts.length,
    sourceAge,
    sourceNodeIndex,
    currentNodeIndex,
    reinforcementCount,
    directionState,
    modelMentionCount,
    consecutiveUnselectedCount,
    stateReason
  ));
}

function extractDirectionKeywords(text: string): string[] {
  return DIRECTION_SIGNAL_KEYWORDS
    .filter((keyword) => text.includes(keyword))
    .sort((a, b) => b.length - a.length);
}

function isGenericChoice(text: string): boolean {
  const cleanText = compact(text);
  return !cleanText || GENERIC_CHOICE_TEXTS.some((generic) => cleanText === generic);
}

function selectedChoiceMatchesDirection(item: HistoryItem, matchedKeywords: string[]): boolean {
  if (matchedKeywords.length === 0 || isGenericChoice(item.selectedChoice)) return false;
  return matchedKeywords.some((keyword) => item.selectedChoice.includes(keyword));
}

function historyBodyMatchesDirection(item: HistoryItem, matchedKeywords: string[]): boolean {
  if (matchedKeywords.length === 0) return false;
  const historyText = `${item.title} ${item.description}`;
  return matchedKeywords.some((keyword) => historyText.includes(keyword));
}

function hasDirectionOutcome(item: HistoryItem): boolean {
  const historyText = `${item.title} ${item.description} ${item.selectedChoice}`;
  return includesAny(historyText, OUTCOME_KEYWORDS);
}

function countUserChoiceReinforcements(text: string, recentHistory: HistoryItem[]): number {
  const matchedKeywords = extractDirectionKeywords(text);
  if (matchedKeywords.length === 0) return 0;

  return recentHistory.filter((item) => selectedChoiceMatchesDirection(item, matchedKeywords)).length;
}

function countUserChoiceOutcomes(text: string, recentHistory: HistoryItem[]): number {
  const matchedKeywords = extractDirectionKeywords(text);
  if (matchedKeywords.length === 0) return 0;

  return recentHistory.filter((item) => selectedChoiceMatchesDirection(item, matchedKeywords) && hasDirectionOutcome(item)).length;
}

function countConsecutiveUnselected(text: string, recentHistory: HistoryItem[]): number {
  const matchedKeywords = extractDirectionKeywords(text);
  if (matchedKeywords.length === 0) return 0;

  let count = 0;
  for (const item of [...recentHistory].reverse()) {
    if (selectedChoiceMatchesDirection(item, matchedKeywords)) break;
    count += 1;
  }
  return count;
}

function countModelMentions(text: string, recentHistory: HistoryItem[]): number {
  const matchedKeywords = extractDirectionKeywords(text);
  if (matchedKeywords.length === 0) return 0;

  return recentHistory.filter((item) => {
    if (!historyBodyMatchesDirection(item, matchedKeywords)) return false;
    return !selectedChoiceMatchesDirection(item, matchedKeywords);
  }).length;
}

const DIRECTION_STATE_RANK: Record<DirectionSignalState, number> = {
  mentioned: 0,
  background_detail: 1,
  side_thread: 2,
  stage_main_arc: 3,
  long_term_main_arc: 4
};

function minDirectionState(state: DirectionSignalState, cap: DirectionSignalState): DirectionSignalState {
  return DIRECTION_STATE_RANK[state] <= DIRECTION_STATE_RANK[cap] ? state : cap;
}

function applyUnselectedDecayCap(state: DirectionSignalState, consecutiveUnselectedCount: number): DirectionSignalState {
  if (consecutiveUnselectedCount >= 5) return "mentioned";
  if (consecutiveUnselectedCount >= 1) return minDirectionState(state, "background_detail");
  return state;
}

function resolveDirectionSignalState(
  userReinforcementCount: number,
  outcomeCount: number,
  consecutiveUnselectedCount: number
): DirectionSignalState {
  const reinforcedState: DirectionSignalState = userReinforcementCount >= 3 && outcomeCount >= 1
    ? "long_term_main_arc"
    : userReinforcementCount >= 2
      ? "stage_main_arc"
      : userReinforcementCount >= 1
        ? "side_thread"
        : "background_detail";

  return applyUnselectedDecayCap(reinforcedState, consecutiveUnselectedCount);
}

function buildDirectionStateReason(
  userReinforcementCount: number,
  outcomeCount: number,
  modelMentionCount: number,
  consecutiveUnselectedCount: number,
  directionState: DirectionSignalState
): string {
  if (directionState === "long_term_main_arc") return `用户选择强化 ${userReinforcementCount} 次且形成 ${outcomeCount} 次现实成果，可作为长期主线`;
  if (directionState === "stage_main_arc") return `用户选择强化 ${userReinforcementCount} 次，可作为阶段主线`;
  if (directionState === "side_thread") return "用户选择强化 1 次，可作为副线";
  if (directionState === "mentioned") return `连续 ${consecutiveUnselectedCount} 个节点未选择，最多作为曾经提过`;
  if (modelMentionCount > 0) return `模型正文提及 ${modelMentionCount} 次但没有用户选择强化，只能作为生活细节`;
  return "早期提到，最近没有用户选择强化，只能作为生活细节";
}

function resolveDirectionMetrics(text: string, recentHistory: HistoryItem[]) {
  const userReinforcementCount = countUserChoiceReinforcements(text, recentHistory);
  const outcomeCount = countUserChoiceOutcomes(text, recentHistory);
  const modelMentionCount = countModelMentions(text, recentHistory);
  const consecutiveUnselectedCount = countConsecutiveUnselected(text, recentHistory);
  const directionState = resolveDirectionSignalState(userReinforcementCount, outcomeCount, consecutiveUnselectedCount);

  return {
    userReinforcementCount,
    outcomeCount,
    modelMentionCount,
    consecutiveUnselectedCount,
    directionState,
    stateReason: buildDirectionStateReason(
      userReinforcementCount,
      outcomeCount,
      modelMentionCount,
      consecutiveUnselectedCount,
      directionState
    )
  };
}

function addThread(threads: BackgroundThread[], thread: BackgroundThread) {
  if (!threads.some((item) => item.type === thread.type && item.summary === thread.summary)) {
    threads.push(thread);
  }
}

function detectThreads(userFacts: string[], answerFacts: string[], recentHistory: HistoryItem[]): BackgroundThread[] {
  const threads: BackgroundThread[] = [];
  const sources: Array<{
    source: BackgroundThread["source"];
    summary: string;
    lastTouchedNode?: number;
  }> = [
    ...userFacts.map((summary) => ({ source: "user_fact" as const, summary })),
    ...answerFacts.map((summary) => ({ source: "answer" as const, summary })),
    ...recentHistory.map((item, index) => ({
      source: "history" as const,
      summary: `${item.title}：${item.description}`,
      lastTouchedNode: index
    }))
  ];

  for (const item of sources) {
    const summary = item.summary;
    if (includesAny(summary, ["父母", "妈妈", "母亲", "爸爸", "父亲", "家里", "家庭", "亲戚", "老家"])) {
      addThread(threads, {
        id: `family_${threads.length + 1}`,
        type: "family",
        source: item.source,
        summary,
        salience: item.source === "answer" ? 0.95 : 0.8,
        lastTouchedNode: item.lastTouchedNode
      });
    }
    if (includesAny(summary, ["恋", "婚", "伴侣", "前任", "异地恋", "分手", "相亲", "暧昧", "对象"])) {
      addThread(threads, {
        id: `romance_${threads.length + 1}`,
        type: "romance",
        source: item.source,
        summary,
        salience: item.source === "answer" ? 0.9 : 0.75,
        lastTouchedNode: item.lastTouchedNode
      });
    }
    if (includesAny(summary, ["朋友", "同学", "同事", "饭局"])) {
      addThread(threads, {
        id: `friendship_${threads.length + 1}`,
        type: "friendship",
        source: item.source,
        summary,
        salience: 0.65,
        lastTouchedNode: item.lastTouchedNode
      });
    }
  }

  return threads;
}

export function buildStoryContextPack(
  userData: Partial<UserInitialData> = {},
  answers: unknown,
  history: HistoryItem[] = []
): StoryContextPack {
  const recentHistory = history.slice(-5);
  const userFacts: string[] = [];
  pushFact(userFacts, "回溯节点", userData.regressionAge ? `${userData.regressionAge} 岁` : "");
  pushFact(userFacts, "当时真实情境", userData.regressionSituation);
  pushFact(userFacts, "想尝试的改写方向", userData.regressionChoices);
  pushFact(userFacts, "核心主线", userData.coreStoryFocus);
  pushFact(userFacts, "情感与关系经历", userData.milestoneRelationship);
  pushFact(userFacts, "求职与职场变化", userData.milestoneCareer);
  pushFact(userFacts, "高考与升学", userData.milestoneGaokao);
  pushFact(userFacts, "其他人生节点", userData.milestoneOther);

  if (Array.isArray(userData.milestones)) {
    for (const milestone of userData.milestones) {
      pushFact(userFacts, milestone.title || milestone.id, milestone.content);
    }
  }

  const answerFacts = answerFactsFrom(answers);
  const activeThreads = detectThreads(userFacts, answerFacts, recentHistory);
  const longTermFacts: StoryFact[] = [];
  const stageFacts: StoryFact[] = [];
  const interestSignals: StoryFact[] = [];
  const temporaryEmotions: StoryFact[] = [];
  const sourceAge = userData.regressionAge;
  const currentNodeIndex = history.length;

  pushStoryFact(stageFacts, "stage_fact", userData.regressionAge ? `回溯节点：${userData.regressionAge} 岁` : "", "user_data", sourceAge, 0, currentNodeIndex);
  pushStoryFact(stageFacts, "stage_fact", userData.regressionSituation ? `当时真实情境：${userData.regressionSituation}` : "", "user_data", sourceAge, 0, currentNodeIndex);
  pushStoryFact(stageFacts, "stage_fact", userData.regressionChoices ? `想尝试的改写方向：${userData.regressionChoices}` : "", "user_data", sourceAge, 0, currentNodeIndex);
  pushStoryFact(longTermFacts, "long_term_fact", userData.coreStoryFocus ? `核心主线：${userData.coreStoryFocus}` : "", "user_data", sourceAge, 0, currentNodeIndex);
  pushStoryFact(longTermFacts, "long_term_fact", userData.milestoneRelationship ? `情感与关系经历：${userData.milestoneRelationship}` : "", "user_data", sourceAge, 0, currentNodeIndex);
  pushStoryFact(longTermFacts, "long_term_fact", userData.milestoneCareer ? `求职与职场变化：${userData.milestoneCareer}` : "", "user_data", sourceAge, 0, currentNodeIndex);
  pushStoryFact(longTermFacts, "long_term_fact", userData.milestoneGaokao ? `高考与升学：${userData.milestoneGaokao}` : "", "user_data", sourceAge, 0, currentNodeIndex);
  pushStoryFact(longTermFacts, "long_term_fact", userData.milestoneOther ? `其他人生节点：${userData.milestoneOther}` : "", "user_data", sourceAge, 0, currentNodeIndex);

  for (const fact of [...userFacts, ...answerFacts]) {
    const source = userFacts.includes(fact) ? "user_data" : "question_answer";
    if (includesAny(fact, DIRECTION_FACT_KEYWORDS)) {
      const directionMetrics = resolveDirectionMetrics(fact, recentHistory);
      pushStoryFact(
        interestSignals,
        "interest_signal",
        fact,
        source,
        sourceAge,
        0,
        currentNodeIndex,
        directionMetrics.userReinforcementCount,
        directionMetrics.directionState,
        directionMetrics.modelMentionCount,
        directionMetrics.consecutiveUnselectedCount,
        directionMetrics.stateReason
      );
    }
    if (includesAny(fact, EMOTION_KEYWORDS)) {
      pushStoryFact(temporaryEmotions, "temporary_emotion", fact, source, sourceAge, 0, currentNodeIndex);
    }
  }

  return {
    userFacts,
    answerFacts,
    longTermFacts,
    stageFacts,
    interestSignals,
    temporaryEmotions,
    recentHistory,
    activeThreads
  };
}

function formatSection(title: string, items: string[]): string {
  if (items.length === 0) return `${title}：\n- 暂无`;
  return `${title}：\n${items.map((item) => `- ${item}`).join("\n")}`;
}

function formatStoryFactSection(title: string, facts: StoryFact[]): string {
  if (facts.length === 0) return `${title}：\n- 暂无`;
  return `${title}：\n${facts.map((fact) => {
    const arcState = fact.promotedToArc ? "已强化为长期线索" : "未强化";
    const directionState = fact.directionState
      ? `，state=${fact.directionState}，userChoiceReinforcement=${fact.userReinforcementCount ?? 0}，modelMention=${fact.modelMentionCount ?? 0}，unselected=${fact.consecutiveUnselectedCount ?? 0}，reason=${fact.stateReason || "未说明"}`
      : "";
    return `- ${fact.text}（source=${fact.source}，weight=${fact.currentWeight.toFixed(2)}，salience=${fact.salience.toFixed(2)}，decay=${fact.decayRate.toFixed(2)}，reinforcement=${fact.reinforcementCount}，${arcState}${directionState}）`;
  }).join("\n")}`;
}

export function formatStoryContextPack(pack: StoryContextPack): string {
  const recentHistory = pack.recentHistory.map((item) => `${formatAgeInMonths(item.ageInMonths ?? item.age * 12)} ${item.title}：${item.description} / 选择：${item.selectedChoice}`);
  const activeThreads = pack.activeThreads.map((thread) => `${thread.type}（${thread.source}，${thread.salience.toFixed(2)}）：${thread.summary}`);

  return `\n\n【Story Context Pack】\n【方向线索使用边界】\n- long_term_main_arc：可作为长期人生主线、终章和报告核心。\n- stage_main_arc：可作为当前阶段主线，例如职业、项目、学习方向。\n- side_thread：可延续为副线，但不得主导职业、创业、人生使命或重大转型。\n- background_detail：只能作为生活细节，不能出现在重大选择选项主语中。\n- mentioned：本轮不要主动展开，终章/报告最多作为曾经提过。\n- 模型正文偶然提及不计入强化；只有用户点击、自定义输入、用户选择导致的历史结果和现实成果才允许升级方向状态。\n- 连续未选择会降低使用范围，高权重背景不等于长期主线。\n\n${formatSection("用户真实事实", pack.userFacts)}\n\n${formatSection("追问补全事实", pack.answerFacts)}\n\n${formatStoryFactSection("长期事实", pack.longTermFacts)}\n\n${formatStoryFactSection("阶段事实", pack.stageFacts)}\n\n${formatStoryFactSection("兴趣倾向", pack.interestSignals)}\n\n${formatStoryFactSection("临时情绪", pack.temporaryEmotions)}\n\n${formatSection("最近 5 个历史节点", recentHistory)}\n\n${formatSection("当前可延续副线", activeThreads)}`;
}

import type { HistoryItem, QuestionTurn, UserInitialData } from "../types";

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

const INTEREST_REINFORCEMENT_KEYWORDS = ["植物", "写作", "设计", "游戏", "音乐", "绘画", "摄影"];

const EMOTION_KEYWORDS = ["怕", "焦虑", "后悔", "想逃", "不甘", "冲动", "压力", "纠结", "迷茫"];

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
  reinforcementCount = 0
): StoryFact {
  const defaults = FACT_DEFAULTS[type];
  const nodeDistance = typeof sourceNodeIndex === "number"
    ? Math.max(0, currentNodeIndex - sourceNodeIndex)
    : 0;
  const reinforcementMultiplier = 1 + reinforcementCount * 0.35;
  const promotedToArc = type === "interest_signal" && reinforcementCount >= 2;
  const decayedWeight = defaults.salience * Math.pow(1 - defaults.decayRate, nodeDistance) * reinforcementMultiplier;
  const currentWeight = promotedToArc ? Math.max(decayedWeight, 0.75) : decayedWeight;

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
    promotedToArc
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
  reinforcementCount = 0
) {
  const cleanText = compact(text);
  if (!cleanText || cleanText === "暂无描述") return;
  facts.push(makeStoryFact(type, cleanText, source, facts.length, sourceAge, sourceNodeIndex, currentNodeIndex, reinforcementCount));
}

function countRecentMentions(text: string, recentHistory: HistoryItem[]): number {
  if (!text || recentHistory.length === 0) return 0;
  const matchedKeywords = INTEREST_REINFORCEMENT_KEYWORDS.filter((keyword) => text.includes(keyword));
  if (matchedKeywords.length === 0) return 0;

  return recentHistory.filter((item) => {
    const historyText = `${item.title} ${item.description} ${item.selectedChoice}`;
    if (includesAny(historyText, ["没有再", "不再", "没再", "不纠结"])) return false;
    return matchedKeywords.some((keyword) => historyText.includes(keyword));
  }).length;
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
    const reinforcementCount = countRecentMentions(fact, recentHistory);
    if (includesAny(fact, INTEREST_KEYWORDS)) {
      pushStoryFact(interestSignals, "interest_signal", fact, source, sourceAge, 0, currentNodeIndex, reinforcementCount);
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
    return `- ${fact.text}（source=${fact.source}，weight=${fact.currentWeight.toFixed(2)}，salience=${fact.salience.toFixed(2)}，decay=${fact.decayRate.toFixed(2)}，reinforcement=${fact.reinforcementCount}，${arcState}）`;
  }).join("\n")}`;
}

export function formatStoryContextPack(pack: StoryContextPack): string {
  const recentHistory = pack.recentHistory.map((item) => `${item.age}岁 ${item.title}：${item.description} / 选择：${item.selectedChoice}`);
  const activeThreads = pack.activeThreads.map((thread) => `${thread.type}（${thread.source}，${thread.salience.toFixed(2)}）：${thread.summary}`);

  return `\n\n【Story Context Pack】\n【事实影响规则】\n- 最近 5 个历史节点和最近选择优先于早期兴趣。\n- 早期兴趣若最近历史没有强化，只能作为生活细节，不得自动升级为职业、创业方向或终身主线。\n- 用户在某个时间节点表达的兴趣，不得自动扩展为终身职业、创业方向或人生主题；只有被后续选择、最近历史或现实成果持续强化时，才允许升级为长期主线。\n\n${formatSection("用户真实事实", pack.userFacts)}\n\n${formatSection("追问补全事实", pack.answerFacts)}\n\n${formatStoryFactSection("长期事实", pack.longTermFacts)}\n\n${formatStoryFactSection("阶段事实", pack.stageFacts)}\n\n${formatStoryFactSection("兴趣倾向", pack.interestSignals)}\n\n${formatStoryFactSection("临时情绪", pack.temporaryEmotions)}\n\n${formatSection("最近 5 个历史节点", recentHistory)}\n\n${formatSection("当前可延续副线", activeThreads)}`;
}

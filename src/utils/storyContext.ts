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

export interface StoryContextPack {
  userFacts: string[];
  answerFacts: string[];
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
  const recentHistory = history.slice(-5);
  const activeThreads = detectThreads(userFacts, answerFacts, recentHistory);

  return {
    userFacts,
    answerFacts,
    recentHistory,
    activeThreads
  };
}

function formatSection(title: string, items: string[]): string {
  if (items.length === 0) return `${title}：\n- 暂无`;
  return `${title}：\n${items.map((item) => `- ${item}`).join("\n")}`;
}

export function formatStoryContextPack(pack: StoryContextPack): string {
  const recentHistory = pack.recentHistory.map((item) => `${item.age}岁 ${item.title}：${item.description} / 选择：${item.selectedChoice}`);
  const activeThreads = pack.activeThreads.map((thread) => `${thread.type}（${thread.source}，${thread.salience.toFixed(2)}）：${thread.summary}`);

  return `\n\n【Story Context Pack】\n${formatSection("用户真实事实", pack.userFacts)}\n\n${formatSection("追问补全事实", pack.answerFacts)}\n\n${formatSection("最近 5 个历史节点", recentHistory)}\n\n${formatSection("当前可延续副线", activeThreads)}`;
}

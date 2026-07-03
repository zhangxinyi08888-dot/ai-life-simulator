import {
  FinalLifeOutcome,
  FutureTrend,
  HistoryItem,
  LifePattern,
  LifePatternReport,
  PatternEffect,
  PatternSummary,
  PatternUpgradeItem,
  PosterTheme,
  ShareEndingCard,
  ShareTimelineItem
} from "../types";

const THEMES: PosterTheme[] = ["warm_realistic", "quiet_dark", "clean_magazine"];

function readString(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function readStringArray(value: unknown, fallback: string[]): string[] {
  const items = Array.isArray(value)
    ? value.map((item) => readString(item)).filter(Boolean)
    : [];
  return items.length > 0 ? items : fallback;
}

function clampText(value: string, maxLength: number): string {
  const chars = Array.from(value);
  if (chars.length <= maxLength) return value;
  return `${chars.slice(0, Math.max(0, maxLength - 1)).join("")}…`;
}

function sanitizeFileName(value: unknown): string {
  const raw = readString(value, "人生终章.png")
    .replace(/[\\/:*?"<>|]+/g, "")
    .replace(/\s+/g, "")
    .trim();
  const withoutExt = raw.replace(/\.png$/i, "") || "人生终章";
  return `${withoutExt}.png`;
}

function normalizeTitleSubject(value: unknown): string {
  const fallback = "重生之我把人生重新跑了一遍";
  const title = readString(value, fallback)
    .replace(/重生之你/g, "重生之我")
    .replace(/AI推演：你/g, "AI推演：我")
    .replace(/^你/, "我");
  if (title.includes("我")) return clampText(title, 30);
  return clampText(`重生之我${title.replace(/^《|》$/g, "")}`, 30);
}

function normalizeIndexes(value: unknown, historyLength: number): number[] {
  const indexes = Array.isArray(value) ? value : [];
  const unique = indexes
    .filter((index): index is number => Number.isInteger(index) && index >= 0 && index < historyLength)
    .filter((index, position, array) => array.indexOf(index) === position)
    .slice(0, 4);
  return unique.length > 0 ? unique : [0].filter((index) => index < historyLength);
}

function readIndexes(record: any, historyLength: number): number[] {
  return normalizeIndexes(record?.keyMomentIndexes ?? record?.evidenceNodeIndexes, historyLength);
}

function fallbackTimeline(history: HistoryItem[]): ShareTimelineItem[] {
  return history.slice(0, 6).map((item, index) => ({
    ageLabel: `${item.age}岁`,
    icon: ["🎓", "💼", "🚀", "📱", "⚠️", "🌱"][index] || "✨",
    title: clampText(item.title || "关键选择", 12),
    choiceSummary: clampText(item.selectedChoice || "这次选择塑造了今天的你", 24),
    keyMomentIndexes: [index]
  }));
}

function normalizeTimelineItem(item: any, history: HistoryItem[], index: number): ShareTimelineItem {
  const historyItem = history[index] || history[0];
  return {
    ageLabel: clampText(readString(item?.ageLabel, historyItem ? `${historyItem.age}岁` : "现在"), 8),
    icon: clampText(readString(item?.icon, ["🎓", "💼", "🚀", "📱", "⚠️", "🌱"][index] || "✨"), 4),
    title: clampText(readString(item?.title, historyItem?.title || "关键选择"), 14),
    choiceSummary: clampText(readString(item?.choiceSummary, historyItem?.selectedChoice || "这次选择塑造了今天的你"), 26),
    keyMomentIndexes: readIndexes(item, history.length)
  };
}

function normalizeShare(data: any, history: HistoryItem[]): ShareEndingCard {
  const rawTimeline = Array.isArray(data?.timeline) ? data.timeline : [];
  const normalizedTimeline = rawTimeline
    .slice(0, 6)
    .map((item, index) => normalizeTimelineItem(item, history, index));
  const timeline = normalizedTimeline.length >= 4
    ? normalizedTimeline
    : fallbackTimeline(history).slice(0, Math.max(4, normalizedTimeline.length));
  const viralTitle = normalizeTitleSubject(data?.viralTitle);
  const posterTheme = THEMES.includes(data?.posterTheme) ? data.posterTheme : "warm_realistic";

  return {
    viralTitle,
    covenantTitle: clampText(readString(data?.covenantTitle, "仍在选择自己的人"), 16),
    oneLineSummary: clampText(readString(data?.oneLineSummary, "现实改变过你的路径，却没有真正改变你的热爱。"), 44),
    timeline: timeline.slice(0, 6),
    closingLine: clampText(readString(data?.closingLine, "人生不是由成功组成，而是由一次次选择组成。"), 40),
    posterTheme,
    downloadFileName: sanitizeFileName(data?.downloadFileName),
    imageAlt: readString(data?.imageAlt, `${viralTitle} 人生终章海报`)
  };
}

function normalizeSummaryPattern(item: any, historyLength: number, index: number): PatternSummary {
  return {
    name: readString(item?.name, `人生模式${index + 1}`),
    shortDescription: readString(item?.shortDescription, "一个反复出现的选择模式。"),
    keyMomentIndexes: readIndexes(item, historyLength)
  };
}

function normalizeLifePattern(item: any, historyLength: number, index: number): LifePattern {
  return {
    name: readString(item?.name, `模式${index + 1}`),
    title: readString(item?.title, "你的人生一直有一个反复出现的选择方式"),
    paragraphs: readStringArray(item?.paragraphs, ["回顾你的关键节点，会发现真正塑造你的不是单次决定，而是多次重复出现的选择方式。"]),
    keyMomentIndexes: readIndexes(item, historyLength),
    closingLine: readString(item?.closingLine, "这些重复出现的选择，才是真正塑造你人生的底层系统。")
  };
}

function normalizePatternEffect(item: any, historyLength: number, index: number): PatternEffect {
  return {
    patternName: readString(item?.patternName ?? item?.name, `模式${index + 1}`),
    compoundReturn: readString(item?.compoundReturn, "它让你的经验和能力开始形成复利。"),
    hiddenCost: readString(item?.hiddenCost, "它也让反馈变慢，压力更容易被你一个人承担。"),
    paragraphs: readStringArray(item?.paragraphs, ["每一种模式都有收益，也有成本。真正的人生复盘，是看清它如何同时成就你和消耗你。"]),
    keyMomentIndexes: readIndexes(item, historyLength),
    closingLine: readString(item?.closingLine, "复利和代价，其实来自同一个模式。")
  };
}

function normalizeFutureTrend(item: any, historyLength: number, index: number): FutureTrend {
  return {
    title: readString(item?.title, `趋势${index + 1}`),
    trend: readString(item?.trend, "未来最可能延续的，不是命运安排，而是你已经形成的选择模式。"),
    reason: readString(item?.reason, "因为这个模式已经在多个关键节点中反复出现。"),
    keyMomentIndexes: readIndexes(item, historyLength)
  };
}

function normalizeUpgradeItem(item: any, historyLength: number, index: number, keep: boolean): PatternUpgradeItem {
  return {
    title: readString(item?.title, keep ? `保留已经有效的模式${index + 1}` : `升级开始限制你的模式${index + 1}`),
    why: readString(item?.why, keep ? "它已经被你的人生验证有效。" : "它过去帮过你，但未来可能开始限制你。"),
    paragraphs: readStringArray(item?.paragraphs, [keep ? "继续保留它，但要更主动地使用它。" : "这不是纠正缺点，而是把旧模式升级到下一阶段。"]),
    keyMomentIndexes: readIndexes(item, historyLength),
    closingLine: readString(item?.closingLine, keep ? "这不是偶然优势，而是应该继续保留的复利方式。" : "模式升级，才是下一段人生的关键。")
  };
}

function normalizeArray<T>(
  value: unknown,
  minLength: number,
  maxLength: number,
  factory: (item: any, index: number) => T,
  fallbackItems: any[]
): T[] {
  const source = Array.isArray(value) ? value.slice(0, maxLength) : [];
  const normalized = source.map(factory);
  const fallback = fallbackItems.map(factory);
  return [...normalized, ...fallback].slice(0, Math.max(minLength, normalized.length));
}

function normalizeReport(data: any, historyLength: number): LifePatternReport {
  const fallbackPatterns = [
    { name: "反复回到真正重视的事", shortDescription: "你会先照顾现实，但真正重要的东西会不断回来。", keyMomentIndexes: [0] },
    { name: "靠积累而不是靠风口", shortDescription: "你更相信能力和作品会慢慢变值钱。", keyMomentIndexes: [0] },
    { name: "习惯自己解决问题", shortDescription: "你成长很快，也更容易独自消耗。", keyMomentIndexes: [0] }
  ];
  const executive = data?.executiveSummary || {};
  const summaryPatterns = normalizeArray(
    executive.patterns,
    3,
    3,
    (item, index) => normalizeSummaryPattern(item, historyLength, index),
    fallbackPatterns
  );

  return {
    executiveSummary: {
      headline: readString(executive.headline, "AI 回顾了你的人生轨迹，发现真正塑造你的，不是某一次重大决定，而是几个不断重复的选择模式。"),
      patterns: summaryPatterns,
      closingLine: readString(executive.closingLine, "这些模式让你获得了今天的优势，也带来了今天的代价。")
    },
    repeatedPatterns: normalizeArray(
      data?.repeatedPatterns,
      1,
      3,
      (item, index) => normalizeLifePattern(item, historyLength, index),
      [{ title: "你的人生一直在重复同一种选择", keyMomentIndexes: [0] }]
    ),
    patternEffects: normalizeArray(
      data?.patternEffects,
      1,
      3,
      (item, index) => normalizePatternEffect(item, historyLength, index),
      [{ patternName: "长期重复的选择模式", keyMomentIndexes: [0] }]
    ),
    futureTrends: normalizeArray(
      data?.futureTrends,
      1,
      3,
      (item, index) => normalizeFutureTrend(item, historyLength, index),
      [{ title: "模式会继续塑造未来", keyMomentIndexes: [0] }]
    ),
    patternsToKeep: normalizeArray(
      data?.patternsToKeep,
      1,
      3,
      (item, index) => normalizeUpgradeItem(item, historyLength, index, true),
      [{ title: "保留长期积累", keyMomentIndexes: [0] }]
    ),
    patternsToAdjust: normalizeArray(
      data?.patternsToAdjust,
      1,
      3,
      (item, index) => normalizeUpgradeItem(item, historyLength, index, false),
      [{ title: "不要再一个人完成所有事情", keyMomentIndexes: [0] }]
    ),
    finalLifeReading: {
      title: readString(data?.finalLifeReading?.title, "AI看到的人生"),
      paragraphs: readStringArray(data?.finalLifeReading?.paragraphs, ["如果只能用一句话描述你的人生，AI 看到的是同一种选择被你重复了很多年。"]),
      finalSentence: readString(data?.finalLifeReading?.finalSentence, "你的命运，从来不是某一次选择决定的，而是同一种选择，被重复了很多年。")
    }
  };
}

export function normalizeFinalLifeOutcome(data: any, history: HistoryItem[] = []): FinalLifeOutcome {
  return {
    share: normalizeShare(data?.share, history),
    report: normalizeReport(data?.report, history.length),
    meta: {
      generatedAt: readString(data?.meta?.generatedAt, new Date().toISOString()),
      modelProvider: data?.meta?.modelProvider === "openai" || data?.meta?.modelProvider === "mock" ? data.meta.modelProvider : "deepseek",
      posterVersion: "web-v1",
      reportVersion: "life-pattern-v2"
    }
  };
}

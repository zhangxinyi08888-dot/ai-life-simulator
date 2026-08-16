import type {
  FinalLifeOutcome,
  HistoryItem,
  LifePatternReport,
  PosterTheme,
  ShareEndingCard,
  SimulationClosureType
} from "../types";

const THEMES: PosterTheme[] = ["warm_realistic", "quiet_dark", "clean_magazine"];

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function textArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(text) : [];
}

function indexes(value: unknown): number[] {
  return Array.isArray(value) ? [...value] as number[] : [];
}

function sanitizeFileName(value: unknown): string {
  const raw = text(value)
    .replace(/[\\/:*?"<>|]+/g, "")
    .replace(/\s+/g, "")
    .trim();
  if (!raw) return "";
  const withoutExt = raw.replace(/\.png$/i, "");
  return `${withoutExt}.png`;
}

function normalizeShare(data: any): ShareEndingCard {
  return {
    viralTitle: text(data?.viralTitle),
    covenantTitle: text(data?.covenantTitle),
    oneLineSummary: text(data?.oneLineSummary),
    timeline: Array.isArray(data?.timeline) ? data.timeline.map((item: any) => ({
      ageLabel: text(item?.ageLabel),
      icon: text(item?.icon),
      title: text(item?.title),
      choiceSummary: text(item?.choiceSummary),
      keyMomentIndexes: indexes(item?.keyMomentIndexes)
    })) : [],
    closingLine: text(data?.closingLine),
    posterTheme: THEMES.includes(data?.posterTheme) ? data.posterTheme : data?.posterTheme as PosterTheme,
    downloadFileName: sanitizeFileName(data?.downloadFileName),
    imageAlt: text(data?.imageAlt)
  };
}

function normalizeReport(data: any): LifePatternReport {
  return {
    executiveSummary: {
      headline: text(data?.executiveSummary?.headline),
      patterns: Array.isArray(data?.executiveSummary?.patterns)
        ? data.executiveSummary.patterns.map((item: any) => ({
          name: text(item?.name),
          shortDescription: text(item?.shortDescription),
          keyMomentIndexes: indexes(item?.keyMomentIndexes)
        }))
        : [],
      closingLine: text(data?.executiveSummary?.closingLine)
    },
    repeatedPatterns: Array.isArray(data?.repeatedPatterns) ? data.repeatedPatterns.map((item: any) => ({
      name: text(item?.name),
      title: text(item?.title),
      paragraphs: textArray(item?.paragraphs),
      keyMomentIndexes: indexes(item?.keyMomentIndexes),
      closingLine: text(item?.closingLine)
    })) : [],
    patternEffects: Array.isArray(data?.patternEffects) ? data.patternEffects.map((item: any) => ({
      patternName: text(item?.patternName),
      compoundReturn: text(item?.compoundReturn),
      hiddenCost: text(item?.hiddenCost),
      paragraphs: textArray(item?.paragraphs),
      keyMomentIndexes: indexes(item?.keyMomentIndexes),
      closingLine: text(item?.closingLine)
    })) : [],
    futureTrends: Array.isArray(data?.futureTrends) ? data.futureTrends.map((item: any) => ({
      title: text(item?.title),
      trend: text(item?.trend),
      reason: text(item?.reason),
      keyMomentIndexes: indexes(item?.keyMomentIndexes)
    })) : [],
    patternsToKeep: Array.isArray(data?.patternsToKeep) ? data.patternsToKeep.map((item: any) => ({
      title: text(item?.title),
      why: text(item?.why),
      paragraphs: textArray(item?.paragraphs),
      keyMomentIndexes: indexes(item?.keyMomentIndexes),
      closingLine: text(item?.closingLine)
    })) : [],
    patternsToAdjust: Array.isArray(data?.patternsToAdjust) ? data.patternsToAdjust.map((item: any) => ({
      title: text(item?.title),
      why: text(item?.why),
      paragraphs: textArray(item?.paragraphs),
      keyMomentIndexes: indexes(item?.keyMomentIndexes),
      closingLine: text(item?.closingLine)
    })) : [],
    finalLifeReading: {
      title: text(data?.finalLifeReading?.title),
      paragraphs: textArray(data?.finalLifeReading?.paragraphs),
      finalSentence: text(data?.finalLifeReading?.finalSentence)
    }
  };
}

/**
 * Applies display-only formatting after the raw model payload has passed every
 * structural and factual validator. It must never invent prose, report items,
 * or history references.
 */
export function normalizeFinalLifeOutcome(
  data: any,
  _history: HistoryItem[] = [],
  closureType: SimulationClosureType = "mortality"
): FinalLifeOutcome {
  return {
    share: normalizeShare(data?.share),
    report: normalizeReport(data?.report),
    meta: {
      generatedAt: new Date().toISOString(),
      modelProvider: data?.meta?.modelProvider === "openai" || data?.meta?.modelProvider === "mock" ? data.meta.modelProvider : "deepseek",
      posterVersion: "web-v1",
      reportVersion: "life-pattern-v2",
      closureType
    }
  };
}

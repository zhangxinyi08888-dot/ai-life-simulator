import type { HistoryItem, LifeAttributes, NarrativeMode, UserInitialData } from "../types";

export interface NarrativeModeWeights {
  pressure_crisis: number;
  crossroads_opportunity: number;
  recovery_growth: number;
  stability_meaning: number;
}

export const NARRATIVE_MODES: NarrativeMode[] = [
  "pressure_crisis",
  "crossroads_opportunity",
  "recovery_growth",
  "stability_meaning"
];

export const DEFAULT_MODE_WEIGHTS: NarrativeModeWeights = {
  pressure_crisis: 0.18,
  crossroads_opportunity: 0.24,
  recovery_growth: 0.26,
  stability_meaning: 0.32
};

type ModeUserData = Pick<Partial<UserInitialData>, "coreStoryFocus">;

function multiply(weights: NarrativeModeWeights, mode: NarrativeMode, multiplier: number): void {
  weights[mode] *= multiplier;
}

function recentEventItems(history: HistoryItem[], count = 3): HistoryItem[] {
  return history.filter((item) => Boolean(item.eventMeta?.eventId)).slice(-count);
}

function isMajorCrisis(item: HistoryItem | undefined): boolean {
  return Boolean(
    item?.eventMeta?.eventIntensity === "major"
    || item?.eventMeta?.eventTags?.includes("major_crisis")
  );
}

function selectedIntent(item: HistoryItem | undefined): string {
  if (!item) return "";
  if (item.selectedDecisionIntent) return item.selectedDecisionIntent;
  const selectedChoice = item.choices.find((choice) => choice.text === item.selectedChoice);
  return selectedChoice?.decisionIntent || item.selectedChoice || "";
}

function isExplicitHighRiskIntent(intent: string): boolean {
  return /(?:high[_-]?risk|all[_-]?in|full[_-]?commit|expand|leap|venture|创业|扩张|孤注一掷|高风险|全部投入)/i.test(intent);
}

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export function computeModeWeights(
  attribs: LifeAttributes,
  history: HistoryItem[],
  userData: ModeUserData = {}
): NarrativeModeWeights {
  const weights = { ...DEFAULT_MODE_WEIGHTS };
  const recentEvents = recentEventItems(history);
  const recentEventModes = recentEvents.map((item) => item.eventMeta?.eventMode).filter(Boolean) as NarrativeMode[];
  const recentNodeModes = history.slice(-3).map((item) => item.eventMeta?.eventMode).filter(Boolean) as NarrativeMode[];
  const latestNode = history[history.length - 1];

  if (recentEventModes.slice(-2).length === 2 && recentEventModes.slice(-2).every((mode) => mode === "pressure_crisis")) {
    multiply(weights, "pressure_crisis", 0.15);
    multiply(weights, "recovery_growth", 1.8);
    multiply(weights, "stability_meaning", 1.6);
  }

  if (isMajorCrisis(latestNode)) {
    multiply(weights, "pressure_crisis", 0.1);
    multiply(weights, "recovery_growth", 2);
    multiply(weights, "stability_meaning", 1.8);
  }

  if (recentNodeModes.filter((mode) => mode === "recovery_growth").length >= 2) {
    multiply(weights, "recovery_growth", 0.55);
    multiply(weights, "stability_meaning", 1.25);
    multiply(weights, "crossroads_opportunity", 1.2);
  }

  if (recentNodeModes.filter((mode) => mode === "stability_meaning").length >= 2) {
    multiply(weights, "stability_meaning", 0.65);
    multiply(weights, "crossroads_opportunity", 1.35);
    multiply(weights, "recovery_growth", 1.15);
  }

  if (attribs.health < 42) multiply(weights, "pressure_crisis", 1.35);

  if (attribs.health >= 55 && attribs.wealth >= 50 && attribs.happiness >= 55) {
    multiply(weights, "stability_meaning", 1.25);
    multiply(weights, "recovery_growth", 1.2);
    multiply(weights, "pressure_crisis", 0.75);
  }

  if (userData.coreStoryFocus === "selftruth") {
    multiply(weights, "recovery_growth", 1.25);
    multiply(weights, "stability_meaning", 1.2);
    multiply(weights, "crossroads_opportunity", 1.1);
  }

  if (userData.coreStoryFocus === "innerpeace") {
    multiply(weights, "recovery_growth", 1.35);
    multiply(weights, "stability_meaning", 1.3);
    multiply(weights, "pressure_crisis", 0.75);
  }

  if (isExplicitHighRiskIntent(selectedIntent(history[history.length - 1]))) {
    multiply(weights, "crossroads_opportunity", 1.35);
    multiply(weights, "pressure_crisis", 1.25);
    multiply(weights, "stability_meaning", 0.8);
  }

  for (const mode of NARRATIVE_MODES) weights[mode] = finiteNonNegative(weights[mode]);
  return weights;
}

export function zeroUnavailableModeWeights(
  weights: NarrativeModeWeights,
  availableModes: ReadonlySet<NarrativeMode>
): NarrativeModeWeights {
  const next = { ...weights };
  for (const mode of NARRATIVE_MODES) {
    if (!availableModes.has(mode)) next[mode] = 0;
    else next[mode] = finiteNonNegative(next[mode]);
  }
  return next;
}

export function applyModeFatigue(
  weights: NarrativeModeWeights,
  history: HistoryItem[]
): NarrativeModeWeights {
  const next = { ...weights };
  const recent = recentEventItems(history);
  const latestEvent = recent[recent.length - 1];
  const latestModes = recent.slice(-2).map((item) => item.eventMeta?.eventMode);

  if (latestModes.length === 2 && latestModes.every((mode) => mode === "pressure_crisis")) {
    const otherWeight = NARRATIVE_MODES
      .filter((mode) => mode !== "pressure_crisis")
      .reduce((sum, mode) => sum + finiteNonNegative(next[mode]), 0);
    next.pressure_crisis = Math.min(finiteNonNegative(next.pressure_crisis), otherWeight / 9);
  }

  if (isMajorCrisis(latestEvent) && (next.recovery_growth > 0 || next.stability_meaning > 0)) {
    next.pressure_crisis = 0;
  }

  for (const mode of NARRATIVE_MODES) next[mode] = finiteNonNegative(next[mode]);
  return next;
}

export function pickModeByWeight(
  weights: NarrativeModeWeights,
  randomValue = Math.random()
): NarrativeMode | null {
  const total = NARRATIVE_MODES.reduce((sum, mode) => sum + finiteNonNegative(weights[mode]), 0);
  if (total <= 0) return null;

  const normalizedRandom = Number.isFinite(randomValue)
    ? Math.min(Math.max(randomValue, 0), 1 - Number.EPSILON)
    : 0;
  let cursor = normalizedRandom * total;

  for (const mode of NARRATIVE_MODES) {
    cursor -= finiteNonNegative(weights[mode]);
    if (cursor <= 0 && weights[mode] > 0) return mode;
  }

  return [...NARRATIVE_MODES].reverse().find((mode) => weights[mode] > 0) || null;
}

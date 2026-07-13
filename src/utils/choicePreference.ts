import type { HistoryItem, SimulationChoice } from "../types";

export type ChoicePreferenceState = "available" | "cooldown" | "dormant";

export interface ChoicePreferenceSignal {
  decisionIntent: string;
  selectedCount: number;
  passedOfferCount: number;
  consecutivePassedOfferCount: number;
  lastOfferedNodeIndex: number;
  lastSelectedNodeIndex?: number;
  cooldownUntilNodeIndex?: number;
  state: ChoicePreferenceState;
  recentOptionTexts: string[];
}

export const CHOICE_PREFERENCE_POLICY = {
  cooldownAfterPassedOffers: 2,
  dormantAfterPassedOffers: 3,
  cooldownDecisionNodes: 3,
  maxRecentOptionTexts: 3
} as const;

function compact(value: unknown): string {
  return String(value ?? "").trim();
}

function isGeneratedFallbackIntent(value: string): boolean {
  return /^[A-C][：:]/i.test(value);
}

export function normalizeDecisionIntent(choice: SimulationChoice): string {
  const rawIntent = compact(choice.decisionIntent);
  const source = rawIntent && !isGeneratedFallbackIntent(rawIntent)
    ? rawIntent
    : compact(choice.text);

  return source
    .replace(/^[A-C](?:[.、：:\s-]+)/i, "")
    .replace(/\s+/g, "_")
    .toLowerCase();
}

function isSelectedChoice(choice: SimulationChoice, selectedChoice: string): boolean {
  const selected = compact(selectedChoice);
  const choiceText = compact(choice.text);
  if (!selected || !choiceText) return false;
  return selected === choiceText || selected.includes(choiceText);
}

function pushRecentText(texts: string[], text: string): string[] {
  const cleanText = compact(text);
  if (!cleanText) return texts;
  return [cleanText, ...texts.filter((item) => item !== cleanText)]
    .slice(0, CHOICE_PREFERENCE_POLICY.maxRecentOptionTexts);
}

interface MutableChoicePreferenceSignal extends Omit<ChoicePreferenceSignal, "state" | "cooldownUntilNodeIndex"> {
  lastEvidence: "selected" | "passed";
}

export function buildChoicePreferenceSignals(
  history: HistoryItem[],
  currentNodeIndex = history.length
): ChoicePreferenceSignal[] {
  const signals = new Map<string, MutableChoicePreferenceSignal>();

  history.forEach((item, nodeIndex) => {
    const choicesByIntent = new Map<string, SimulationChoice[]>();
    for (const choice of item.choices || []) {
      if (choice.id === "ENDING") continue;
      const decisionIntent = normalizeDecisionIntent(choice);
      if (!decisionIntent) continue;
      const choices = choicesByIntent.get(decisionIntent) || [];
      choices.push(choice);
      choicesByIntent.set(decisionIntent, choices);
    }

    for (const [decisionIntent, choices] of choicesByIntent) {
      const selected = choices.some((choice) => isSelectedChoice(choice, item.selectedChoice));
      const existing = signals.get(decisionIntent) || {
        decisionIntent,
        selectedCount: 0,
        passedOfferCount: 0,
        consecutivePassedOfferCount: 0,
        lastOfferedNodeIndex: nodeIndex,
        recentOptionTexts: [],
        lastEvidence: "passed" as const
      };

      existing.lastOfferedNodeIndex = nodeIndex;
      existing.recentOptionTexts = pushRecentText(existing.recentOptionTexts, choices[0]?.text || decisionIntent);

      if (selected) {
        existing.selectedCount += 1;
        existing.consecutivePassedOfferCount = 0;
        existing.lastSelectedNodeIndex = nodeIndex;
        existing.lastEvidence = "selected";
      } else {
        existing.passedOfferCount += 1;
        existing.consecutivePassedOfferCount += 1;
        existing.lastEvidence = "passed";
      }

      signals.set(decisionIntent, existing);
    }
  });

  return [...signals.values()].map((signal) => {
    const cooldownUntilNodeIndex = signal.lastOfferedNodeIndex + CHOICE_PREFERENCE_POLICY.cooldownDecisionNodes;
    const state: ChoicePreferenceState = signal.lastEvidence === "selected"
      ? "available"
      : signal.consecutivePassedOfferCount >= CHOICE_PREFERENCE_POLICY.dormantAfterPassedOffers
        ? "dormant"
        : signal.consecutivePassedOfferCount >= CHOICE_PREFERENCE_POLICY.cooldownAfterPassedOffers
          && currentNodeIndex <= cooldownUntilNodeIndex
          ? "cooldown"
          : "available";

    const { lastEvidence: _lastEvidence, ...publicSignal } = signal;
    return {
      ...publicSignal,
      state,
      cooldownUntilNodeIndex: state === "cooldown" ? cooldownUntilNodeIndex : undefined
    };
  }).sort((left, right) => right.lastOfferedNodeIndex - left.lastOfferedNodeIndex);
}

export function blockedDecisionIntents(history: HistoryItem[], currentNodeIndex = history.length): Set<string> {
  return new Set(
    buildChoicePreferenceSignals(history, currentNodeIndex)
      .filter((signal) => signal.state === "cooldown" || signal.state === "dormant")
      .map((signal) => signal.decisionIntent)
  );
}

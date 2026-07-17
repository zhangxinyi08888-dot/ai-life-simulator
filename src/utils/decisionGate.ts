import { HistoryItem, LifeIntensity, NarrativeMode, PressureArcState, SimulationChoice, SimulationNode } from "../types";
import { blockedDecisionIntents, normalizeDecisionIntent } from "./choicePreference";

export interface DecisionGateResult {
  isDecisionCheckpoint: boolean;
  distinctActionCount: number;
  changesFutureState: boolean;
  repeatsPreviousDecision: boolean;
  repeatsRecentlyPassedOption: boolean;
  blockedDecisionIntents: string[];
  reasonCodes: string[];
}

export const DEFAULT_NODE_DENSITY_POLICY = {
  maxCriticalCheckpointsPerPressureArc: 2,
  maxHighOrCriticalCheckpointsPerRolling12Months: 3
} as const;

function normalizedIntent(choice: SimulationChoice): string {
  return normalizeDecisionIntent(choice);
}

function hasDistinctWorldChanges(choices: SimulationChoice[]): boolean {
  const signatures = choices.map((choice) => [...(choice.expectedWorldDeltaTypes || [])].sort().join(","));
  return new Set(signatures.filter(Boolean)).size >= 2 || new Set(choices.map(normalizedIntent)).size >= 2;
}

function repeatedPreviousDecision(node: SimulationNode, previous?: HistoryItem): boolean {
  if (!previous) return false;
  const previousText = previous.selectedChoice.trim();
  return node.choices.every((choice) => {
    const intent = normalizedIntent(choice);
    return intent === previousText || /^(继续|保持|观察|等待|休息|恢复)/.test(intent) && /^(继续|保持|观察|等待|休息|恢复)/.test(previousText);
  });
}

export function countRecentHighIntensityNodes(history: HistoryItem[], targetAgeInMonths: number): number {
  return history.filter((item) => {
    const ageInMonths = item.ageInMonths ?? item.age * 12;
    const intensity = item.narrativeMeta?.lifeIntensity;
    return targetAgeInMonths - ageInMonths <= 12 && targetAgeInMonths >= ageInMonths && (intensity === "critical" || intensity === "high_tension");
  }).length;
}

export function evaluateDecisionGate(input: {
  candidateNode: SimulationNode;
  previousNode?: HistoryItem;
  pressureArc?: PressureArcState;
  recentHistory: HistoryItem[];
  targetAgeInMonths: number;
  independentCriticalEvent?: boolean;
  allowedOutcomeIds?: string[];
  narrativeMode?: NarrativeMode;
}): DecisionGateResult {
  const choices = input.candidateNode.choices;
  const distinctActionCount = new Set(choices.map(normalizedIntent).filter(Boolean)).size;
  const changesFutureState = hasDistinctWorldChanges(choices);
  const repeatsPreviousDecision = repeatedPreviousDecision(input.candidateNode, input.previousNode);
  const cooledIntents = blockedDecisionIntents(input.recentHistory, input.recentHistory.length);
  const repeatedPassedIntents = [...new Set(
    choices
      .map(normalizedIntent)
      .filter((intent) => intent && cooledIntents.has(intent))
  )];
  const repeatsRecentlyPassedOption = repeatedPassedIntents.length > 0;
  const intensity: LifeIntensity = input.candidateNode.narrativeMeta?.lifeIntensity || "normal";
  const recentHigh = countRecentHighIntensityNodes(input.recentHistory, input.targetAgeInMonths);
  const pressureCriticalCount = input.pressureArc && intensity === "critical" ? input.pressureArc.phaseCheckpointCount : 0;
  const densityExceeded = !input.independentCriticalEvent && (
    recentHigh >= DEFAULT_NODE_DENSITY_POLICY.maxHighOrCriticalCheckpointsPerRolling12Months
    || pressureCriticalCount >= DEFAULT_NODE_DENSITY_POLICY.maxCriticalCheckpointsPerPressureArc
  );
  const reasonCodes: string[] = [];
  if (distinctActionCount < 2) reasonCodes.push("insufficient-distinct-actions");
  if (!changesFutureState) reasonCodes.push("no-distinct-world-change");
  if (repeatsPreviousDecision) reasonCodes.push("repeats-previous-decision");
  if (repeatsRecentlyPassedOption) reasonCodes.push("repeats-recently-passed-option");
  if (densityExceeded) reasonCodes.push("node-density-exceeded");

  if (input.allowedOutcomeIds) {
    const allowed = new Set(input.allowedOutcomeIds);
    const outcomeIds = choices.map((choice) => choice.eventOutcomeId || "");
    if (outcomeIds.some((outcomeId) => !outcomeId || !allowed.has(outcomeId))) {
      reasonCodes.push("event-outcome-not-allowed");
    }
    if (new Set(outcomeIds.filter(Boolean)).size < 2 || distinctActionCount < 2) {
      reasonCodes.push("insufficient-event-strategy-coverage");
    }
    if (input.narrativeMode === "recovery_growth") {
      const onlyMaintainRecovery = outcomeIds.every((outcomeId) => (
        /^(?:continue_recovery|continue_observation|maintain_recovery|maintain_current|keep_recovery|rest|observe|pause)/.test(outcomeId)
      ));
      if (onlyMaintainRecovery) reasonCodes.push("recovery-options-only-maintain");
    }
    if (input.narrativeMode === "stability_meaning") {
      const noConcreteProgression = outcomeIds.every((outcomeId) => /^(?:maintain_|keep_current|wait|observe)/.test(outcomeId));
      if (noConcreteProgression) reasonCodes.push("stability-options-no-concrete-progression");
    }
  }

  return {
    isDecisionCheckpoint: reasonCodes.length === 0,
    distinctActionCount,
    changesFutureState,
    repeatsPreviousDecision,
    repeatsRecentlyPassedOption,
    blockedDecisionIntents: repeatedPassedIntents,
    reasonCodes
  };
}

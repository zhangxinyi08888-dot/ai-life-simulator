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

export function applyDecisionDensityDowngrade(
  node: SimulationNode,
  gate: DecisionGateResult
): SimulationNode {
  if (!gate.reasonCodes.includes("node-density-exceeded") || !node.narrativeMeta) return node;
  return {
    ...node,
    narrativeMeta: {
      ...node.narrativeMeta,
      lifeIntensity: "normal"
    }
  };
}

export function pruneRecentlyPassedChoices(
  node: SimulationNode,
  gate: DecisionGateResult
): SimulationNode {
  if (!gate.repeatsRecentlyPassedOption || gate.blockedDecisionIntents.length === 0) return node;
  const blocked = new Set(gate.blockedDecisionIntents);
  const choices = node.choices.filter((choice) => !blocked.has(normalizedIntent(choice)));
  // Two materially different choices are a complete checkpoint. If pruning
  // would leave fewer than two, preserve the candidate so the model repair
  // path can replace the whole invalid choice set.
  if (choices.length < 2 || choices.length === node.choices.length) return node;
  return { ...node, choices };
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

export function removeBlockedChoicesAfterRepair(node: SimulationNode, blockedIntents: string[]): SimulationNode {
  if (blockedIntents.length === 0) return node;
  const blocked = new Set(blockedIntents);
  const availableChoices = node.choices.filter((choice) => !blocked.has(normalizedIntent(choice)));
  return availableChoices.length >= 2 ? { ...node, choices: availableChoices } : node;
}

export function downgradeDensityLimitedNode(node: SimulationNode, reasonCodes: string[]): SimulationNode {
  if (!reasonCodes.includes("node-density-exceeded")) return node;
  return {
    ...node,
    narrativeMeta: node.narrativeMeta
      ? { ...node.narrativeMeta, lifeIntensity: "normal" }
      : node.narrativeMeta
  };
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
  // Relationship lifecycle checkpoints intentionally reuse a small, stable
  // outcome vocabulary across reviews (for example "continue slow
  // exploration"). The relationship progression state, not generic option
  // cooldown, limits how often those outcomes may recur and eventually swaps
  // the event to a forced resolution. Applying the generic cooldown here
  // rejects the whole deterministic checkpoint before that state machine can
  // advance.
  const isCausallyRequiredCheckpoint = ["relationship_follow_up", "forced"].includes(
    input.candidateNode.eventMeta?.selectionKind || ""
  );
  const repeatedPassedIntents = [...new Set(
    choices
      .map(normalizedIntent)
      .filter((intent) => !isCausallyRequiredCheckpoint && intent && cooledIntents.has(intent))
  )];
  const repeatsRecentlyPassedOption = repeatedPassedIntents.length > 0;
  const repeatedPassedIntentSet = new Set(repeatedPassedIntents);
  const choicesAfterBlockedSuppression = choices.filter((choice) => (
    !repeatedPassedIntentSet.has(normalizedIntent(choice))
  ));
  const retainsTwoDistinctActions = new Set(
    choicesAfterBlockedSuppression.map(normalizedIntent).filter(Boolean)
  ).size >= 2;
  const retainsEventStrategyCoverage = !input.allowedOutcomeIds || new Set(
    choicesAfterBlockedSuppression.map((choice) => choice.eventOutcomeId).filter(Boolean)
  ).size >= 2;
  const canSuppressBlockedChoices = choicesAfterBlockedSuppression.length >= 2
    && retainsTwoDistinctActions
    && retainsEventStrategyCoverage;
  const intensity: LifeIntensity = input.candidateNode.narrativeMeta?.lifeIntensity || "normal";
  const recentHigh = countRecentHighIntensityNodes(input.recentHistory, input.targetAgeInMonths);
  const pressureCriticalCount = input.pressureArc && intensity === "critical" ? input.pressureArc.phaseCheckpointCount : 0;
  const densityExceeded = !input.independentCriticalEvent
    && (intensity === "critical" || intensity === "high_tension") && (
    recentHigh >= DEFAULT_NODE_DENSITY_POLICY.maxHighOrCriticalCheckpointsPerRolling12Months
    || pressureCriticalCount >= DEFAULT_NODE_DENSITY_POLICY.maxCriticalCheckpointsPerPressureArc
  );
  const reasonCodes: string[] = [];
  if (distinctActionCount < 2) reasonCodes.push("insufficient-distinct-actions");
  if (!changesFutureState) reasonCodes.push("no-distinct-world-change");
  if (repeatsPreviousDecision) reasonCodes.push("repeats-previous-decision");
  if (repeatsRecentlyPassedOption && !canSuppressBlockedChoices) {
    reasonCodes.push("repeats-recently-passed-option");
  }
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

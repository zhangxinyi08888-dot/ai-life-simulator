import { HistoryItem, LifeIntensity, PressureArcState, SimulationChoice, SimulationNode } from "../types";

export interface DecisionGateResult {
  isDecisionCheckpoint: boolean;
  distinctActionCount: number;
  changesFutureState: boolean;
  repeatsPreviousDecision: boolean;
  reasonCodes: string[];
}

export const DEFAULT_NODE_DENSITY_POLICY = {
  maxCriticalCheckpointsPerPressureArc: 2,
  maxHighOrCriticalCheckpointsPerRolling12Months: 3
} as const;

function normalizedIntent(choice: SimulationChoice): string {
  return (choice.decisionIntent || choice.text).trim().replace(/^[A-C][.、：:\s-]*/i, "");
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
}): DecisionGateResult {
  const choices = input.candidateNode.choices;
  const distinctActionCount = new Set(choices.map(normalizedIntent).filter(Boolean)).size;
  const changesFutureState = hasDistinctWorldChanges(choices);
  const repeatsPreviousDecision = repeatedPreviousDecision(input.candidateNode, input.previousNode);
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
  if (densityExceeded) reasonCodes.push("node-density-exceeded");

  return {
    isDecisionCheckpoint: reasonCodes.length === 0,
    distinctActionCount,
    changesFutureState,
    repeatsPreviousDecision,
    reasonCodes
  };
}

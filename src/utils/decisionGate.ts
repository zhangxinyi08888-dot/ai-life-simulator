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

const REQUIRED_CHOICE_IDS = ["A", "B", "C"] as const;

const SEMANTIC_CANONICALIZATIONS: Array<[RegExp, string]> = [
  [/(?:focus|concentrate|maintain|keep|stay|continue|专注|聚焦|集中|保持|维持|继续|留在|坚守)/giu, " maintain "],
  [/(?:internal|existing|current|内部|现有|当前)/giu, " current "],
  [/(?:seek|search|explore|寻找|寻求|探索|物色)/giu, " explore "],
  [/(?:accept|join|take|接受|加入|转入)/giu, " accept "],
  [/(?:leave|exit|resign|sell|离开|退出|辞职|出售)/giu, " exit "],
  [/(?:team|团队)/giu, " team "],
  [/(?:growth|development|成长|发展)/giu, " growth "]
];

function semanticChoiceTokens(choice: SimulationChoice): Set<string> {
  let intent = normalizedIntent(choice);
  // Deterministic recovery choices carry routing metadata in the form
  // `event:<event-id>:<actual-action>:node-<index>`.  Event and node identity
  // are shared by all three choices and must not dominate the semantic
  // comparison; only the action segment describes what the user can choose.
  const structuredEventIntent = intent.match(/^event:[^:]+:(.+?)(?::node-\d+)?$/u);
  if (structuredEventIntent) intent = structuredEventIntent[1];
  let source = `${intent} ${choice.text}`.toLowerCase();
  for (const [pattern, replacement] of SEMANTIC_CANONICALIZATIONS) {
    source = source.replace(pattern, replacement);
  }
  return new Set(source.split(/[^a-z0-9\u4e00-\u9fff]+/u).filter((token) => token.length > 1));
}

function areSemanticallyEquivalent(left: SimulationChoice, right: SimulationChoice): boolean {
  const leftTokens = semanticChoiceTokens(left);
  const rightTokens = semanticChoiceTokens(right);
  const smallerSize = Math.min(leftTokens.size, rightTokens.size);
  if (smallerSize === 0) return false;
  const sharedCount = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  return sharedCount >= 2 && sharedCount / smallerSize >= 2 / 3;
}

function hasThreeSemanticallyDistinctChoices(choices: SimulationChoice[]): boolean {
  if (choices.length !== REQUIRED_CHOICE_IDS.length) return false;
  return choices.every((choice, index) => (
    choices.slice(index + 1).every((other) => !areSemanticallyEquivalent(choice, other))
  ));
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
  const hasRequiredChoiceCount = choices.length === REQUIRED_CHOICE_IDS.length;
  const hasRequiredChoiceIds = hasRequiredChoiceCount && choices.every((choice, index) => (
    choice.id === REQUIRED_CHOICE_IDS[index]
  ));
  const allowedOutcomeSet = new Set(input.allowedOutcomeIds || []);
  const authorizedOutcomeIds = choices.map((choice) => choice.eventOutcomeId || "");
  const hasThreeDistinctAuthorizedOutcomes = Boolean(input.allowedOutcomeIds?.length)
    && authorizedOutcomeIds.every((outcomeId) => allowedOutcomeSet.has(outcomeId))
    && new Set(authorizedOutcomeIds).size === REQUIRED_CHOICE_IDS.length;
  const hasSemanticDiversity = hasThreeDistinctAuthorizedOutcomes
    || hasThreeSemanticallyDistinctChoices(choices);
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
  const intensity: LifeIntensity = input.candidateNode.narrativeMeta?.lifeIntensity || "normal";
  const recentHigh = countRecentHighIntensityNodes(input.recentHistory, input.targetAgeInMonths);
  const pressureCriticalCount = input.pressureArc && intensity === "critical" ? input.pressureArc.phaseCheckpointCount : 0;
  const densityExceeded = !input.independentCriticalEvent
    && (intensity === "critical" || intensity === "high_tension") && (
    recentHigh >= DEFAULT_NODE_DENSITY_POLICY.maxHighOrCriticalCheckpointsPerRolling12Months
    || pressureCriticalCount >= DEFAULT_NODE_DENSITY_POLICY.maxCriticalCheckpointsPerPressureArc
  );
  const reasonCodes: string[] = [];
  if (!hasRequiredChoiceCount) reasonCodes.push("invalid-choice-count");
  if (!hasRequiredChoiceIds) reasonCodes.push("invalid-choice-ids");
  if (distinctActionCount < REQUIRED_CHOICE_IDS.length) reasonCodes.push("insufficient-distinct-actions");
  if (!hasSemanticDiversity) reasonCodes.push("insufficient-semantic-diversity");
  if (!changesFutureState) reasonCodes.push("no-distinct-world-change");
  if (repeatsPreviousDecision) reasonCodes.push("repeats-previous-decision");
  if (repeatsRecentlyPassedOption) {
    reasonCodes.push("repeats-recently-passed-option");
  }
  if (densityExceeded) reasonCodes.push("node-density-exceeded");

  if (input.allowedOutcomeIds) {
    const allowed = new Set(input.allowedOutcomeIds);
    const outcomeIds = choices.map((choice) => choice.eventOutcomeId || "");
    if (outcomeIds.some((outcomeId) => !outcomeId || !allowed.has(outcomeId))) {
      reasonCodes.push("event-outcome-not-allowed");
    }
    if (new Set(outcomeIds.filter(Boolean)).size < 2 || distinctActionCount < REQUIRED_CHOICE_IDS.length) {
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

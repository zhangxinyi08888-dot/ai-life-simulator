import type { HistoryItem, RouteLine } from "../types";
import { stableRandom } from "../utils/stableRandom";

export interface LineMixPolicy {
  id: string;
  mainLineShare: number;
  crossLineShare: number;
  mainPortfolio: Partial<Record<RouteLine, number>>;
  crossLineWeights: Partial<Record<RouteLine, number>>;
  maxConsecutiveCrossLineNodes: number;
  maxEligibleMainNodesWithoutCrossLine: number;
  unavailableCrossLineFallback: "return_to_main";
}

export const CAREER_LINE_MIX_POLICY: LineMixPolicy = {
  id: "career_75_25_v1",
  mainLineShare: 0.75,
  crossLineShare: 0.25,
  mainPortfolio: { career: 0.65, financial: 0.2, opportunity: 0.15 },
  crossLineWeights: { romance: 0.65, family: 0.35 },
  maxConsecutiveCrossLineNodes: 2,
  maxEligibleMainNodesWithoutCrossLine: 10,
  unavailableCrossLineFallback: "return_to_main"
};

export type SelectionEntropySlot = "route_line" | "cross_line" | "narrative_mode" | "event_pick";

export interface SelectionEntropy {
  sample(slot: SelectionEntropySlot): number;
}

export function createSelectionEntropy(input: {
  simulationSeed: string;
  branchFingerprint: string;
  nodeIndex: number;
}): SelectionEntropy {
  return { sample: (slot) => stableRandom({ ...input, slot }) };
}

export interface LineSelectionResult {
  mainLine: "career";
  selectedLine: RouteLine;
  selectionKind: "main" | "cross";
  policyId: string;
  randomSample: number;
  fallbackReason?: string;
  crossLineCandidateAvailable?: boolean;
}

function weightedLine(weights: Partial<Record<RouteLine, number>>, sample: number): RouteLine {
  const entries = Object.entries(weights) as Array<[RouteLine, number]>;
  const total = entries.reduce((sum, [, weight]) => sum + Math.max(0, weight), 0);
  if (total <= 0) return "career";
  let cursor = sample * total;
  for (const [line, weight] of entries) {
    cursor -= Math.max(0, weight);
    if (cursor <= 0) return line;
  }
  return entries.at(-1)?.[0] || "career";
}

export function selectCareerMainPortfolioLine(
  entropy: SelectionEntropy,
  policy: LineMixPolicy = CAREER_LINE_MIX_POLICY,
  availableLines?: Set<RouteLine>
): RouteLine {
  const weights = availableLines
    ? Object.fromEntries(Object.entries(policy.mainPortfolio).filter(([line]) => availableLines.has(line as RouteLine)))
    : policy.mainPortfolio;
  return weightedLine(weights, entropy.sample("cross_line"));
}

function recentOrdinarySelections(history: HistoryItem[], policyId: string) {
  return history.filter((item) => item.eventMeta?.linePolicyId === policyId);
}

export function selectCareerRouteLine(input: {
  history: HistoryItem[];
  availableLines: Set<RouteLine>;
  entropy: SelectionEntropy;
  policy?: LineMixPolicy;
}): LineSelectionResult {
  const policy = input.policy || CAREER_LINE_MIX_POLICY;
  const ordinary = recentOrdinarySelections(input.history, policy.id);
  const crossEligibleOrdinary = ordinary.filter((item) => item.eventMeta?.crossLineCandidateAvailable !== false);
  const recentCrossCount = [...ordinary].reverse().findIndex((item) => item.eventMeta?.selectionKind !== "cross");
  const consecutiveCross = recentCrossCount < 0 ? ordinary.length : recentCrossCount;
  const nodesSinceCross = [...crossEligibleOrdinary].reverse().findIndex((item) => item.eventMeta?.selectionKind === "cross");
  const mainWindow = nodesSinceCross < 0 ? crossEligibleOrdinary.length : nodesSinceCross;
  const crossCandidateAvailable = [...input.availableLines].some((line) => (policy.crossLineWeights[line] || 0) > 0);
  const routeSample = input.entropy.sample("route_line");
  const forceMain = consecutiveCross >= policy.maxConsecutiveCrossLineNodes;
  const forceCross = !forceMain && crossCandidateAvailable && mainWindow >= policy.maxEligibleMainNodesWithoutCrossLine;
  const chooseCross = forceCross || (!forceMain && routeSample >= policy.mainLineShare);
  const selectedLine = weightedLine(chooseCross ? policy.crossLineWeights : policy.mainPortfolio, input.entropy.sample("cross_line"));
  return {
    mainLine: "career",
    selectedLine,
    selectionKind: chooseCross ? "cross" : "main",
    policyId: policy.id,
    randomSample: routeSample,
    crossLineCandidateAvailable: crossCandidateAvailable
  };
}

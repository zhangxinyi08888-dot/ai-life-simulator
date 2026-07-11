import { EndingPolicy } from "../config/endingPolicy";
import { HistoryItem, RecoveryState, SimulationNode } from "../types";
import { stableRandom } from "./stableRandom";

export type HealthTrend = "improving" | "stable" | "declining";

export interface EndingDecision {
  shouldEnd: boolean;
  forcedByHardMaximum: boolean;
  annualProbability: number;
  nodeProbability: number;
  roll: number;
  reasonCodes: string[];
}

function multiplierForHealth(health: number): number {
  if (health >= 75) return 0.55;
  if (health >= 60) return 0.75;
  if (health >= 45) return 1;
  if (health >= 30) return 1.35;
  if (health >= 15) return 1.75;
  return 2.4;
}

function multiplierForRecovery(recovery: RecoveryState): number {
  if (recovery === "protected") return 0.75;
  if (recovery === "depleted") return 1.25;
  return 1;
}

function healthTrend(candidate: SimulationNode, history: HistoryItem[]): HealthTrend {
  if (history.length < 3) return "stable";
  const baseline = history[Math.max(0, history.length - 3)].attributes.health;
  const delta = candidate.attributes.health - baseline;
  return delta >= 6 ? "improving" : delta <= -6 ? "declining" : "stable";
}

function multiplierForTrend(trend: HealthTrend): number {
  if (trend === "improving") return 0.85;
  if (trend === "declining") return 1.25;
  return 1;
}

function baseProbability(policy: EndingPolicy, age: number): number {
  return policy.annualBaseProbabilityByAge.find((band) => age >= band.minAge && age <= band.maxAge)?.probability ?? 0;
}

export function evaluateEnding(input: {
  candidateNode: SimulationNode;
  history: HistoryItem[];
  targetAgeInMonths: number;
  elapsedMonths: number;
  simulationSeed: string;
  branchFingerprint: string;
  nodeIndex: number;
  policy: EndingPolicy;
}): EndingDecision {
  const age = Math.floor(input.targetAgeInMonths / 12);
  const forcedByHardMaximum = input.targetAgeInMonths >= input.policy.hardMaximumAge * 12;
  const recovery = input.candidateNode.narrativeMeta?.recoveryState ?? "neutral";
  const trend = healthTrend(input.candidateNode, input.history);
  const recentMajorHealth = input.history.slice(-3).some((item) => item.eventMeta?.eventCategory === "health" && item.eventMeta.eventIntensity === "major");
  const relationMultiplier = input.candidateNode.attributes.relation >= 70 ? 0.9 : input.candidateNode.attributes.relation < 30 ? 1.1 : 1;
  let annualProbability = baseProbability(input.policy, age)
    * multiplierForHealth(input.candidateNode.attributes.health)
    * multiplierForRecovery(recovery)
    * multiplierForTrend(trend)
    * (recentMajorHealth ? 1.15 : 1)
    * relationMultiplier;
  annualProbability = Math.min(input.policy.maximumAnnualProbability, Math.max(0, annualProbability));
  if (input.candidateNode.attributes.health < input.policy.criticalHealthThreshold) {
    annualProbability = Math.max(annualProbability, 0.65);
  }
  const nodeProbability = forcedByHardMaximum
    ? 1
    : 1 - Math.pow(1 - annualProbability, Math.max(1 / 12, input.elapsedMonths / 12));
  const roll = stableRandom({
    namespace: "ending-roll",
    seed: input.simulationSeed,
    branch: input.branchFingerprint,
    targetAgeInMonths: input.targetAgeInMonths,
    nodeIndex: input.nodeIndex
  });

  return {
    shouldEnd: forcedByHardMaximum || roll < nodeProbability,
    forcedByHardMaximum,
    annualProbability,
    nodeProbability,
    roll,
    reasonCodes: [
      `age:${age}`,
      `health:${input.candidateNode.attributes.health}`,
      `recovery:${recovery}`,
      `trend:${trend}`,
      recentMajorHealth ? "recent-major-health" : "no-recent-major-health"
    ]
  };
}

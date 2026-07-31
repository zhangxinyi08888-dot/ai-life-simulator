import { LifeIntensity, SimulationNode } from "../types";
import {
  getInvalidExplicitChoiceTextIndexes,
  getSimulationNodeValidationIssues,
  normalizeSimulationNode,
  repairDeterministicRomanceChoices
} from "./simulationResponse";

interface GenerateCompleteNodeOptions {
  fallbackAge?: number;
  minAge?: number;
  maxAge?: number;
  maxAttempts?: number;
  targetAgeInMonths?: number;
  previousAgeInMonths?: number;
  elapsedMonths?: number;
  lifeIntensity?: LifeIntensity;
  pressureArcId?: string;
  allowedOutcomeIds?: string[];
  eventIntentType?: string;
  deferRomanceContractValidation?: boolean;
  requireExplicitChoiceText?: boolean;
  repairMissingChoiceText?: (
    node: Record<string, any>,
    invalidChoiceIndexes: number[]
  ) => Promise<Record<string, any>>;
}

const ROMANCE_CONTRACT_ISSUES = new Set([
  "eventOutcomeId",
  "eventOutcomeCoverage",
  "romanceChoiceSemantics",
  "romanceNarrativeGrounding"
]);

export async function generateCompleteSimulationNode(
  generateRawNode: (attempt: number, previousIssues: string[]) => Promise<Record<string, any>>,
  options: GenerateCompleteNodeOptions = {}
): Promise<SimulationNode> {
  const maxAttempts = options.maxAttempts ?? 3;
  let issues: string[] = [];
  let lastNode: Record<string, any> = {};

  const validate = (candidate: Record<string, any>): string[] => {
    let candidateIssues = getSimulationNodeValidationIssues(candidate, {
      allowedOutcomeIds: options.allowedOutcomeIds,
      eventIntentType: options.eventIntentType,
      requireExplicitChoiceText: options.requireExplicitChoiceText ?? true
    });
    if (options.deferRomanceContractValidation) {
      candidateIssues = candidateIssues.filter((issue) => !ROMANCE_CONTRACT_ISSUES.has(issue));
    }
    return candidateIssues;
  };

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      lastNode = repairDeterministicRomanceChoices(
        await generateRawNode(attempt, issues),
        options.eventIntentType,
        options.allowedOutcomeIds
      );
    } catch (error) {
      issues = ["invalidJson"];
      if (attempt === maxAttempts) throw error;
      continue;
    }
    issues = validate(lastNode);
    if (issues.length === 1 && issues[0] === "choiceText" && options.repairMissingChoiceText) {
      try {
        lastNode = repairDeterministicRomanceChoices(
          await options.repairMissingChoiceText(lastNode, getInvalidExplicitChoiceTextIndexes(lastNode)),
          options.eventIntentType,
          options.allowedOutcomeIds
        );
        issues = validate(lastNode);
      } catch {
        issues = ["choiceText"];
      }
    }
    if (issues.length === 0) {
      return normalizeSimulationNode(lastNode, options);
    }
  }

  throw new Error(`SIMULATION_NODE_INCOMPLETE:${issues.join(",") || "unknown"}`);
}

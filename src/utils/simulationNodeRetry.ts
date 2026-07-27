import { LifeIntensity, SimulationNode } from "../types";
import {
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
    issues = getSimulationNodeValidationIssues(lastNode, {
      allowedOutcomeIds: options.allowedOutcomeIds,
      eventIntentType: options.eventIntentType
    });
    if (options.deferRomanceContractValidation) {
      issues = issues.filter((issue) => !ROMANCE_CONTRACT_ISSUES.has(issue));
    }
    if (issues.length === 0) {
      return normalizeSimulationNode(lastNode, options);
    }
  }

  throw new Error(`SIMULATION_NODE_INCOMPLETE:${issues.join(",") || "unknown"}`);
}

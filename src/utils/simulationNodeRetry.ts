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

export function isRetryableNodeGenerationError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; message?: unknown };
  return candidate.code === "AI_RESPONSE_INVALID"
    || (typeof candidate.message === "string" && candidate.message.startsWith("SIMULATION_NODE_INCOMPLETE:"));
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
  let lastRetryableError: unknown;

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
      lastRetryableError = undefined;
    } catch (error) {
      if (attempt === maxAttempts) throw error;
      if (isRetryableNodeGenerationError(error)) {
        const candidate = error as { code?: unknown; message?: unknown };
        const reason = typeof candidate.code === "string"
          ? candidate.code
          : typeof candidate.message === "string"
            ? candidate.message
            : "unknown";
        issues = [`generation-error:${reason}`];
        lastRetryableError = error;
      } else {
        issues = ["invalidJson"];
        lastRetryableError = undefined;
      }
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

  if (lastRetryableError) throw lastRetryableError;
  throw new Error(`SIMULATION_NODE_INCOMPLETE:${issues.join(",") || "unknown"}`);
}

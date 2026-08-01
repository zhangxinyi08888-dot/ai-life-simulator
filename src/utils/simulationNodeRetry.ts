import { LifeAttributes, LifeIntensity, SimulationNode } from "../types";
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
  fallbackAttributes?: LifeAttributes;
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
const DETERMINISTIC_ROMANCE_INTENTS = new Set([
  "romance_new_connection",
  "romance_connection_clarification",
  "romance_exploration_resolution",
  "relationship_material_commitment_test",
  "relationship_commitment_resolution"
]);

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function repairMissingAttributes(
  node: Record<string, any>,
  fallbackAttributes?: LifeAttributes
): Record<string, any> {
  if (!fallbackAttributes) return node;
  const attributes = node.attributes && typeof node.attributes === "object" && !Array.isArray(node.attributes)
    ? node.attributes
    : {};
  const intelligence = attributes.intelligence ?? attributes.wisdom ?? attributes.talent;
  const relation = attributes.relation ?? attributes.social ?? attributes.relationships;
  return {
    ...node,
    attributes: {
      ...attributes,
      happiness: finiteNumber(attributes.happiness) ? attributes.happiness : fallbackAttributes.happiness,
      intelligence: finiteNumber(intelligence) ? intelligence : fallbackAttributes.intelligence,
      wealth: finiteNumber(attributes.wealth) ? attributes.wealth : fallbackAttributes.wealth,
      relation: finiteNumber(relation) ? relation : fallbackAttributes.relation,
      health: finiteNumber(attributes.health) ? attributes.health : fallbackAttributes.health
    }
  };
}

function repairGenericOutcomeCoverage(
  node: Record<string, any>,
  allowedOutcomeIds: string[] = [],
  eventIntentType?: string
): Record<string, any> {
  if (DETERMINISTIC_ROMANCE_INTENTS.has(eventIntentType || "") || allowedOutcomeIds.length < 2 || !Array.isArray(node.choices)) return node;
  const allowed = new Set(allowedOutcomeIds);
  const used = new Set<string>();
  const choices = node.choices.map((choice: Record<string, any>) => {
    const current = typeof choice?.eventOutcomeId === "string" && allowed.has(choice.eventOutcomeId)
      ? choice.eventOutcomeId
      : undefined;
    if (current && !used.has(current)) {
      used.add(current);
      return choice;
    }
    const replacement = allowedOutcomeIds.find((outcomeId) => !used.has(outcomeId));
    if (!replacement) return choice;
    used.add(replacement);
    return { ...choice, eventOutcomeId: replacement };
  });
  return { ...node, choices };
}

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
      lastNode = repairGenericOutcomeCoverage(
        repairDeterministicRomanceChoices(
          repairMissingAttributes(await generateRawNode(attempt, issues), options.fallbackAttributes),
          options.eventIntentType,
          options.allowedOutcomeIds
        ),
        options.allowedOutcomeIds,
        options.eventIntentType
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

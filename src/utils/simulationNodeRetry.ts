import { LifeAttributes, LifeIntensity, SimulationNode } from "../types";
import {
  ATTRIBUTE_MAX,
  ATTRIBUTE_MIN,
  getInvalidExplicitChoiceTextIndexes,
  getSimulationNodeValidationIssues,
  MAX_NARRATIVE_ATTRIBUTE_DELTA,
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
  fallbackAttributeHistory?: LifeAttributes[];
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

export function resolveSafeFallbackAttributes(
  current?: LifeAttributes,
  history: LifeAttributes[] = []
): LifeAttributes | undefined {
  if (!current) return undefined;
  const priorHistory = history.filter((candidate) => (
    !(["happiness", "intelligence", "wealth", "relation", "health"] as const)
      .every((key) => candidate?.[key] === current[key])
  ));
  const nearestValid = (key: keyof LifeAttributes): number | undefined => {
    for (let index = priorHistory.length - 1; index >= 0; index -= 1) {
      const value = priorHistory[index]?.[key];
      if (finiteNumber(value) && value >= ATTRIBUTE_MIN && value <= ATTRIBUTE_MAX) return value;
    }
    return undefined;
  };
  const resolve = (key: keyof LifeAttributes, enforceDelta: boolean): number => {
    const value = current[key];
    const prior = nearestValid(key);
    if (!finiteNumber(value) || value < ATTRIBUTE_MIN || value > ATTRIBUTE_MAX) return prior ?? 50;
    if (enforceDelta && prior !== undefined && Math.abs(value - prior) > MAX_NARRATIVE_ATTRIBUTE_DELTA) return prior;
    return value;
  };
  return {
    happiness: resolve("happiness", true),
    intelligence: resolve("intelligence", true),
    wealth: resolve("wealth", false),
    relation: resolve("relation", true),
    health: resolve("health", false)
  };
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
  const repair = (
    value: unknown,
    previous: number,
    preservePrevious = false,
    enforceDelta = true
  ): number => {
    if (preservePrevious) return previous;
    if (!finiteNumber(value)) return previous;
    if (value < ATTRIBUTE_MIN || value > ATTRIBUTE_MAX) return previous;
    if (enforceDelta && Math.abs(value - previous) > MAX_NARRATIVE_ATTRIBUTE_DELTA) return previous;
    return value;
  };
  return {
    ...node,
    attributes: {
      ...attributes,
      happiness: repair(attributes.happiness, fallbackAttributes.happiness),
      intelligence: repair(intelligence, fallbackAttributes.intelligence),
      // Wealth is later calculated from the accepted ledger transaction, not
      // from the model's narrative estimate.
      wealth: repair(attributes.wealth, fallbackAttributes.wealth, true),
      relation: repair(relation, fallbackAttributes.relation),
      // Health is bounded by reconcileHealth after the candidate pipeline;
      // retain its proposal here so a major health event can use that policy.
      health: repair(attributes.health, fallbackAttributes.health, false, false)
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
  const safeFallbackAttributes = resolveSafeFallbackAttributes(
    options.fallbackAttributes,
    options.fallbackAttributeHistory
  );

  const validate = (candidate: Record<string, any>): string[] => {
    let candidateIssues = getSimulationNodeValidationIssues(candidate, {
      allowedOutcomeIds: options.allowedOutcomeIds,
      eventIntentType: options.eventIntentType,
      previousAttributes: safeFallbackAttributes,
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
          repairMissingAttributes(await generateRawNode(attempt, issues), safeFallbackAttributes),
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
      return normalizeSimulationNode(lastNode, { ...options, fallbackAttributes: safeFallbackAttributes });
    }
  }

  if (lastRetryableError) throw lastRetryableError;
  throw new Error(`SIMULATION_NODE_INCOMPLETE:${issues.join(",") || "unknown"}`);
}

import { LifeIntensity, RecoveryState, SimulationChoice, SimulationNode, WorldDelta } from "../types";
import { deriveLifeStage } from "./timelineAdvance";
import { stableHash } from "./stableRandom";

interface NormalizeOptions {
  fallbackAge?: number;
  minAge?: number;
  maxAge?: number;
  targetAgeInMonths?: number;
  previousAgeInMonths?: number;
  elapsedMonths?: number;
  lifeIntensity?: LifeIntensity;
  pressureArcId?: string;
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clampNumber(value: number, min?: number, max?: number): number {
  if (typeof min === "number" && value < min) return min;
  if (typeof max === "number" && value > max) return max;
  return value;
}

function normalizeAttributes(attributes: any): SimulationNode["attributes"] {
  return {
    happiness: readNumber(attributes?.happiness, 50),
    intelligence: readNumber(attributes?.intelligence ?? attributes?.wisdom ?? attributes?.talent, 50),
    wealth: readNumber(attributes?.wealth, 50),
    relation: readNumber(attributes?.relation ?? attributes?.social ?? attributes?.relationships, 50),
    health: readNumber(attributes?.health, 50)
  };
}

type WithNormalizedChoices<T> = Omit<T, "choices"> & { choices: SimulationNode["choices"] };
type WithNormalizedNode<T> = Omit<T, keyof SimulationNode> & SimulationNode;

function readNodeDescription(node: any): string {
  return readString(node?.description)
    || readString(node?.narrative)
    || readString(node?.newCrossroads?.narrative)
    || readString(node?.scene)
    || readString(node?.story);
}

function hasCompleteAttributes(attributes: any): boolean {
  return [
    attributes?.happiness,
    attributes?.intelligence ?? attributes?.wisdom ?? attributes?.talent,
    attributes?.wealth,
    attributes?.relation ?? attributes?.social ?? attributes?.relationships,
    attributes?.health
  ].every((value) => typeof value === "number" && Number.isFinite(value));
}

export function normalizeSimulationNodeChoices<T extends Record<string, any>>(node: T): WithNormalizedChoices<T> {
  const rawChoices = Array.isArray(node.choices)
    ? node.choices
    : Array.isArray(node.options)
      ? node.options
      : Array.isArray(node.newCrossroads?.options)
        ? node.newCrossroads.options
        : [];
  const choices = rawChoices.map((choice: any, index: number) => {
    const id = readString(choice?.id) || readString(choice?.label) || String.fromCharCode(65 + index);
    const impactSummary = readString(choice?.impactSummary) || readString(choice?.summary) || "继续探索";
    const text = readString(choice?.text) || readString(choice?.content) || readString(choice?.choice) || readString(choice?.labelText) || `${id}. ${impactSummary}`;
    const rawIntensity = readString(choice?.temporalHint?.lifeIntensity);
    const lifeIntensity: LifeIntensity = ["critical", "high_tension", "normal", "stable"].includes(rawIntensity)
      ? rawIntensity as LifeIntensity
      : /急|立即|危机|重病/.test(text)
        ? "critical"
        : /创业|融资|辞职|转型|扩张|冲突/.test(text)
          ? "high_tension"
          : /稳定|维持|长期|退休/.test(text)
            ? "stable"
            : "normal";
    const defaultDuration: Record<LifeIntensity, [number, number]> = {
      critical: [1, 6], high_tension: [6, 12], normal: [12, 36], stable: [36, 60]
    };
    const duration = Array.isArray(choice?.temporalHint?.durationMonths) && choice.temporalHint.durationMonths.length >= 2
      ? [readNumber(choice.temporalHint.durationMonths[0], defaultDuration[lifeIntensity][0]), readNumber(choice.temporalHint.durationMonths[1], defaultDuration[lifeIntensity][1])] as [number, number]
      : defaultDuration[lifeIntensity];
    const validDeltaTypes = new Set([
      "person_status", "person_role", "relationship_change", "process_started", "process_completed", "process_interrupted",
      "career_state", "health_state", "location_change"
    ]);
    const expectedWorldDeltaTypes = Array.isArray(choice?.expectedWorldDeltaTypes)
      ? choice.expectedWorldDeltaTypes.filter((value: unknown): value is WorldDelta["type"] => typeof value === "string" && validDeltaTypes.has(value))
      : [];

    return {
      id,
      text,
      impactSummary,
      temporalHint: {
        lifeIntensity,
        durationMonths: duration,
        requiresFollowUp: Boolean(choice?.temporalHint?.requiresFollowUp ?? (lifeIntensity === "critical" || lifeIntensity === "high_tension")),
        reason: readString(choice?.temporalHint?.reason) || impactSummary
      },
      decisionIntent: readString(choice?.decisionIntent) || `${id}:${impactSummary}`,
      expectedWorldDeltaTypes
    } satisfies SimulationChoice;
  });

  return {
    ...node,
    choices
  };
}

export function getSimulationNodeValidationIssues(node: Record<string, any>): string[] {
  const issues: string[] = [];
  const choices = normalizeSimulationNodeChoices(node).choices;
  const requiredChoiceCount = node?.isEndingNode ? 1 : 3;

  if (!readNodeDescription(node)) issues.push("description");
  if (!hasCompleteAttributes(node?.attributes)) issues.push("attributes");
  if (choices.length !== requiredChoiceCount) issues.push("choices");

  return issues;
}

export function normalizeSimulationNode<T extends Record<string, any>>(node: T, options: NormalizeOptions = {}): WithNormalizedNode<T> {
  const normalized = normalizeSimulationNodeChoices(node);
  const fallbackAge = options.fallbackAge ?? 20;

  const age = clampNumber(readNumber(normalized.age ?? normalized.currentAge, fallbackAge), options.minAge, options.maxAge);
  const ageInMonths = options.targetAgeInMonths ?? readNumber(normalized.ageInMonths, age * 12);
  const elapsedMonths = options.elapsedMonths ?? Math.max(0, ageInMonths - (options.previousAgeInMonths ?? ageInMonths));
  const rawRecovery = readString(normalized.narrativeMeta?.recoveryState);
  const recoveryState: RecoveryState = ["protected", "neutral", "depleted"].includes(rawRecovery) ? rawRecovery as RecoveryState : "neutral";
  const lifeIntensity = options.lifeIntensity || (["critical", "high_tension", "normal", "stable"].includes(normalized.narrativeMeta?.lifeIntensity)
    ? normalized.narrativeMeta.lifeIntensity as LifeIntensity
    : "normal");
  const worldDeltas = Array.isArray(normalized.narrativeMeta?.worldDeltas)
    ? normalized.narrativeMeta.worldDeltas.filter((value: unknown): value is WorldDelta => Boolean(value && typeof value === "object" && typeof (value as { type?: unknown }).type === "string"))
    : [];
  const arcSignals = Array.isArray(normalized.narrativeMeta?.arcSignals) ? normalized.narrativeMeta.arcSignals : [];
  const episodeId = readString(normalized.narrativeMeta?.storyEpisode?.id) || `episode_${stableHash({ ageInMonths, title: normalized.title })}`;
  const title = readString(normalized.title) || "新的选择";
  const description = readNodeDescription(normalized) || "新的现实局面正在展开。";

  return {
    ...normalized,
    age,
    ageInMonths,
    lifeStage: deriveLifeStage(age),
    stage: readString(normalized.stage) || "现实转折",
    title,
    description,
    attributes: normalizeAttributes(normalized.attributes),
    isEndingNode: Boolean(normalized.isEndingNode),
    narrativeMeta: {
      elapsedMonths,
      elapsedYears: elapsedMonths / 12,
      lifeIntensity,
      nodeMateriality: "decision_checkpoint",
      storyEpisode: {
        id: episodeId,
        pressureArcId: options.pressureArcId,
        startAgeInMonths: options.previousAgeInMonths ?? ageInMonths,
        endAgeInMonths: ageInMonths,
        internalTransitions: Array.isArray(normalized.narrativeMeta?.storyEpisode?.internalTransitions) ? normalized.narrativeMeta.storyEpisode.internalTransitions : [],
        decisionCheckpointId: readString(normalized.narrativeMeta?.storyEpisode?.decisionCheckpointId) || `checkpoint_${stableHash({ episodeId, title })}`,
        summary: readString(normalized.narrativeMeta?.storyEpisode?.summary) || description.slice(0, 80)
      },
      recoveryState,
      recoveryEvidence: Array.isArray(normalized.narrativeMeta?.recoveryEvidence) ? normalized.narrativeMeta.recoveryEvidence.filter((value: unknown): value is string => typeof value === "string") : [],
      arcSignals,
      activeCharacters: Array.isArray(normalized.narrativeMeta?.activeCharacters) ? normalized.narrativeMeta.activeCharacters : [],
      primaryActivity: normalized.narrativeMeta?.primaryActivity,
      worldDeltas
    }
  } as WithNormalizedNode<T>;
}

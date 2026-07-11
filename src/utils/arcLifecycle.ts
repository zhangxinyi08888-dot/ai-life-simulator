import { ArcSignalProposal, LifeAttributes, PressureArcState, TemporalProfile, WorldDelta } from "../types";
import { DEFAULT_TEMPORAL_PROFILES } from "./timelineAdvance";
import { stableHash } from "./stableRandom";

export type ArcExitCondition =
  | { type: "choice_outcome"; outcome: string }
  | { type: "arc_signal"; signalType: string }
  | { type: "attribute_at_least"; attribute: keyof LifeAttributes; value: number }
  | { type: "attribute_at_most"; attribute: keyof LifeAttributes; value: number }
  | { type: "world_delta"; deltaType: WorldDelta["type"] }
  | { type: "elapsed_months"; value: number }
  | { type: "checkpoint_cap"; value: number };

export interface ArcPhaseDefinition extends TemporalProfile {
  id: string;
  minCheckpoints: number;
  maxCheckpoints: number;
  exitConditions: ArcExitCondition[];
  nextPhaseId?: string;
  fallbackPhaseId?: string;
  resolvesPressureArc?: boolean;
}

export interface PhaseTransitionPolicy {
  id: string;
  initialPhaseId: string;
  allowedSignalTypes: string[];
  phases: ArcPhaseDefinition[];
}

export interface AcceptedNodeOutcome {
  worldDeltas: WorldDelta[];
  arcSignals: ArcSignalProposal[];
}

export interface PressureArcTransitionDecision {
  action: "start" | "stay" | "advance" | "fallback" | "suspend" | "resume" | "resolve";
  previousPhaseId?: string;
  nextPhaseId?: string;
  nextArcState?: PressureArcState;
  foregroundPressureArcId?: string;
  reasonCodes: string[];
}

export const DEFAULT_PHASE_POLICY: PhaseTransitionPolicy = {
  id: "generic_pressure_v1",
  initialPhaseId: "trigger",
  allowedSignalTypes: ["pressure_addressed", "pressure_persists", "stability_reached", "funding_secured", "funding_failed", "cashflow_stable", "team_formed"],
  phases: [
    { id: "trigger", ...DEFAULT_TEMPORAL_PROFILES.high_tension, durationMonths: [3, 6], minCheckpoints: 1, maxCheckpoints: 1, exitConditions: [{ type: "checkpoint_cap", value: 1 }], nextPhaseId: "response" },
    { id: "response", ...DEFAULT_TEMPORAL_PROFILES.high_tension, minCheckpoints: 1, maxCheckpoints: 2, exitConditions: [{ type: "arc_signal", signalType: "pressure_addressed" }, { type: "arc_signal", signalType: "funding_secured" }, { type: "checkpoint_cap", value: 2 }], nextPhaseId: "growth", fallbackPhaseId: "growth" },
    { id: "growth", ...DEFAULT_TEMPORAL_PROFILES.normal, durationMonths: [12, 24], minCheckpoints: 1, maxCheckpoints: 2, exitConditions: [{ type: "arc_signal", signalType: "stability_reached" }, { type: "world_delta", deltaType: "career_state" }, { type: "checkpoint_cap", value: 2 }], nextPhaseId: "operation", fallbackPhaseId: "operation" },
    { id: "operation", ...DEFAULT_TEMPORAL_PROFILES.stable, durationMonths: [24, 60], minCheckpoints: 1, maxCheckpoints: 1, exitConditions: [{ type: "checkpoint_cap", value: 1 }], resolvesPressureArc: true }
  ]
};

export function resolvePhase(policy: PhaseTransitionPolicy, phaseId: string): ArcPhaseDefinition {
  return policy.phases.find((phase) => phase.id === phaseId)
    || policy.phases.find((phase) => phase.id === policy.initialPhaseId)
    || policy.phases[0];
}

function initializePressureArc(input: {
  eventId: string;
  eventIntentType: string;
  currentAgeInMonths: number;
  policy?: PhaseTransitionPolicy;
  summary?: string;
}): PressureArcState {
  const policy = input.policy || DEFAULT_PHASE_POLICY;
  return {
    id: `pressure_${stableHash({ eventId: input.eventId, age: input.currentAgeInMonths })}`,
    eventId: input.eventId,
    eventIntentType: input.eventIntentType,
    phasePolicyId: policy.id,
    phaseId: policy.initialPhaseId,
    status: "active",
    startedAtAgeInMonths: input.currentAgeInMonths,
    phaseStartedAtAgeInMonths: input.currentAgeInMonths,
    phaseCheckpointCount: 0,
    totalCheckpointCount: 0,
    unresolvedSummary: input.summary || input.eventIntentType
  };
}

export function validateNodeOutcomeProposal(input: {
  worldDeltas?: WorldDelta[];
  arcSignals?: ArcSignalProposal[];
  policy?: PhaseTransitionPolicy;
  narrativeText?: string;
}): AcceptedNodeOutcome {
  const policy = input.policy || DEFAULT_PHASE_POLICY;
  const worldDeltas = Array.isArray(input.worldDeltas) ? input.worldDeltas : [];
  const arcSignals = (Array.isArray(input.arcSignals) ? input.arcSignals : []).filter((signal) => {
    return policy.allowedSignalTypes.includes(signal.type)
      && typeof signal.evidence === "string"
      && signal.evidence.trim().length > 0
      && (!input.narrativeText || input.narrativeText.includes(signal.evidence.trim()))
      && Number.isFinite(signal.confidence)
      && signal.confidence >= 0
      && signal.confidence <= 1;
  });
  return { worldDeltas, arcSignals };
}

function conditionMatches(condition: ArcExitCondition, input: {
  selectedDecision: string;
  acceptedOutcome: AcceptedNodeOutcome;
  attributes: LifeAttributes;
  elapsedMonths: number;
  checkpointCount: number;
}): boolean {
  if (condition.type === "choice_outcome") return input.selectedDecision.includes(condition.outcome);
  if (condition.type === "arc_signal") return input.acceptedOutcome.arcSignals.some((signal) => signal.type === condition.signalType);
  if (condition.type === "world_delta") return input.acceptedOutcome.worldDeltas.some((delta) => delta.type === condition.deltaType);
  if (condition.type === "attribute_at_least") return input.attributes[condition.attribute] >= condition.value;
  if (condition.type === "attribute_at_most") return input.attributes[condition.attribute] <= condition.value;
  if (condition.type === "elapsed_months") return input.elapsedMonths >= condition.value;
  return input.checkpointCount >= condition.value;
}

export function reducePressureArc(input: {
  currentArc?: PressureArcState;
  startProposal?: { eventId: string; eventIntentType: string; currentAgeInMonths: number; summary?: string };
  policy?: PhaseTransitionPolicy;
  selectedDecision: string;
  acceptedOutcome?: AcceptedNodeOutcome;
  attributes: LifeAttributes;
  timelineAdvance: { elapsedMonths: number; targetAgeInMonths: number };
}): PressureArcTransitionDecision {
  const policy = input.policy || DEFAULT_PHASE_POLICY;
  if (!input.currentArc && input.startProposal) {
    const nextArcState = initializePressureArc({ ...input.startProposal, policy });
    return {
      action: "start",
      nextPhaseId: nextArcState.phaseId,
      nextArcState,
      foregroundPressureArcId: nextArcState.id,
      reasonCodes: ["event-start-proposal-accepted"]
    };
  }
  if (!input.currentArc) return { action: "stay", reasonCodes: ["no-pressure-arc"] };

  const acceptedOutcome = input.acceptedOutcome || { worldDeltas: [], arcSignals: [] };
  const currentPhase = resolvePhase(policy, input.currentArc.phaseId);
  const phaseCheckpointCount = input.currentArc.phaseCheckpointCount + 1;
  const totalCheckpointCount = input.currentArc.totalCheckpointCount + 1;
  const canExit = phaseCheckpointCount >= currentPhase.minCheckpoints;
  const matched = canExit && currentPhase.exitConditions.some((condition) => conditionMatches(condition, {
    selectedDecision: input.selectedDecision,
    acceptedOutcome,
    attributes: input.attributes,
    elapsedMonths: input.timelineAdvance.elapsedMonths,
    checkpointCount: phaseCheckpointCount
  }));
  const hitCap = phaseCheckpointCount >= currentPhase.maxCheckpoints;

  if ((matched || hitCap) && currentPhase.resolvesPressureArc) {
    return {
      action: "resolve",
      previousPhaseId: currentPhase.id,
      nextArcState: { ...input.currentArc, status: "resolved", phaseCheckpointCount, totalCheckpointCount },
      reasonCodes: [hitCap ? "phase-cap" : "exit-condition", "pressure-resolved"]
    };
  }

  const nextPhaseId = hitCap
    ? currentPhase.fallbackPhaseId || currentPhase.nextPhaseId
    : matched
      ? currentPhase.nextPhaseId
      : undefined;
  if (nextPhaseId) {
    const nextState: PressureArcState = {
      ...input.currentArc,
      phaseId: nextPhaseId,
      phaseStartedAtAgeInMonths: input.timelineAdvance.targetAgeInMonths,
      phaseCheckpointCount: 0,
      totalCheckpointCount
    };
    return {
      action: hitCap && currentPhase.fallbackPhaseId ? "fallback" : "advance",
      previousPhaseId: currentPhase.id,
      nextPhaseId,
      nextArcState: nextState,
      foregroundPressureArcId: nextState.id,
      reasonCodes: [hitCap ? "phase-cap" : "exit-condition"]
    };
  }

  return {
    action: "stay",
    previousPhaseId: currentPhase.id,
    nextPhaseId: currentPhase.id,
    nextArcState: { ...input.currentArc, phaseCheckpointCount, totalCheckpointCount },
    foregroundPressureArcId: input.currentArc.id,
    reasonCodes: ["phase-continues"]
  };
}

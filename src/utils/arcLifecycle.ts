import { ArcSignalProposal, LifeAttributes, PressureArcState, TemporalProfile, WorldDelta } from "../types";
import type { DebtHealthLevel, DebtHealthState } from "../domain/finance/debtHealth";
import type { AcceptedFinancialEvent } from "../domain/finance/types";
import { LIFE_EVENTS_DATABASE, type LifeEventSeed } from "../data/lifeEvents";
import { DEFAULT_TEMPORAL_PROFILES } from "./timelineAdvance";
import { stableHash } from "./stableRandom";
import { sanitizeEmploymentTransitions } from "./employmentState";
import { normalizeWorldDeltas } from "./normalizeWorldDeltas";

export type ArcExitCondition =
  | { type: "choice_outcome"; outcome: string }
  | { type: "arc_signal"; signalType: string }
  | { type: "attribute_at_least"; attribute: keyof LifeAttributes; value: number }
  | { type: "attribute_at_most"; attribute: keyof LifeAttributes; value: number }
  | { type: "world_delta"; deltaType: WorldDelta["type"] }
  | { type: "elapsed_months"; value: number }
  | { type: "checkpoint_cap"; value: number }
  | { type: "debt_health_at_most"; value: Exclude<DebtHealthLevel, "none" | "defaulted" | "unknown"> }
  | { type: "debt_health_sustainable" };

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
  earlyResolveConditions?: ArcExitCondition[];
}

export interface AcceptedNodeOutcome {
  worldDeltas: WorldDelta[];
  arcSignals: ArcSignalProposal[];
}

export interface PressureArcTransitionDecision {
  action: "start" | "stay" | "advance" | "fallback" | "suspend" | "resume" | "interleave" | "resolve";
  previousPhaseId?: string;
  nextPhaseId?: string;
  nextArcState?: PressureArcState;
  foregroundPressureArcId?: string;
  additionalArcStateUpdates?: PressureArcState[];
  reasonCodes: string[];
}

export const DEFAULT_PHASE_POLICY: PhaseTransitionPolicy = {
  id: "generic_pressure_v1",
  initialPhaseId: "trigger",
  allowedSignalTypes: ["pressure_addressed", "pressure_persists", "pressure_resolved", "stability_reached", "funding_secured", "funding_failed", "cashflow_stable", "team_formed"],
  phases: [
    { id: "trigger", ...DEFAULT_TEMPORAL_PROFILES.high_tension, durationMonths: [3, 6], minCheckpoints: 1, maxCheckpoints: 1, exitConditions: [{ type: "checkpoint_cap", value: 1 }], nextPhaseId: "response" },
    { id: "response", ...DEFAULT_TEMPORAL_PROFILES.high_tension, minCheckpoints: 1, maxCheckpoints: 2, exitConditions: [{ type: "arc_signal", signalType: "pressure_addressed" }, { type: "arc_signal", signalType: "funding_secured" }, { type: "checkpoint_cap", value: 2 }], nextPhaseId: "growth", fallbackPhaseId: "growth" },
    { id: "growth", ...DEFAULT_TEMPORAL_PROFILES.normal, durationMonths: [12, 24], minCheckpoints: 1, maxCheckpoints: 2, exitConditions: [{ type: "arc_signal", signalType: "stability_reached" }, { type: "world_delta", deltaType: "career_state" }, { type: "checkpoint_cap", value: 2 }], nextPhaseId: "operation", fallbackPhaseId: "operation" },
    { id: "operation", ...DEFAULT_TEMPORAL_PROFILES.stable, durationMonths: [24, 60], minCheckpoints: 1, maxCheckpoints: 1, exitConditions: [{ type: "checkpoint_cap", value: 1 }], resolvesPressureArc: true }
  ]
};

export const HEALTH_CRISIS_PHASE_POLICY: PhaseTransitionPolicy = {
  id: "health_crisis_v1",
  initialPhaseId: "trigger",
  allowedSignalTypes: ["pressure_addressed", "pressure_persists", "pressure_resolved", "stability_reached"],
  phases: [
    {
      id: "trigger",
      ...DEFAULT_TEMPORAL_PROFILES.high_tension,
      durationMonths: [3, 6],
      minCheckpoints: 1,
      maxCheckpoints: 1,
      exitConditions: [{ type: "checkpoint_cap", value: 1 }],
      nextPhaseId: "recovery"
    },
    {
      id: "recovery",
      ...DEFAULT_TEMPORAL_PROFILES.normal,
      durationMonths: [3, 12],
      minCheckpoints: 1,
      maxCheckpoints: 2,
      exitConditions: [
        { type: "arc_signal", signalType: "stability_reached" },
        { type: "arc_signal", signalType: "pressure_addressed" },
        { type: "checkpoint_cap", value: 2 }
      ],
      nextPhaseId: "operation",
      fallbackPhaseId: "operation"
    },
    {
      id: "operation",
      ...DEFAULT_TEMPORAL_PROFILES.stable,
      durationMonths: [6, 18],
      minCheckpoints: 1,
      maxCheckpoints: 1,
      exitConditions: [{ type: "checkpoint_cap", value: 1 }],
      resolvesPressureArc: true
    }
  ]
};

export const FINANCIAL_DEBT_PHASE_POLICY: PhaseTransitionPolicy = {
  id: "financial_debt_v1",
  initialPhaseId: "trigger",
  earlyResolveConditions: [{ type: "debt_health_sustainable" }],
  allowedSignalTypes: [
    "debt_plan_reviewed",
    "restructuring_started",
    "restructuring_accepted",
    "restructuring_failed",
    "debt_cashflow_stabilized",
    "debt_pressure_persists"
  ],
  phases: [
    {
      id: "trigger",
      ...DEFAULT_TEMPORAL_PROFILES.high_tension,
      durationMonths: [3, 6],
      minCheckpoints: 1,
      maxCheckpoints: 1,
      exitConditions: [{ type: "checkpoint_cap", value: 1 }],
      nextPhaseId: "response"
    },
    {
      id: "response",
      ...DEFAULT_TEMPORAL_PROFILES.high_tension,
      durationMonths: [3, 9],
      minCheckpoints: 1,
      maxCheckpoints: 2,
      exitConditions: [
        { type: "arc_signal", signalType: "restructuring_started" },
        { type: "checkpoint_cap", value: 2 }
      ],
      nextPhaseId: "restructuring",
      fallbackPhaseId: "restructuring"
    },
    {
      id: "restructuring",
      ...DEFAULT_TEMPORAL_PROFILES.normal,
      durationMonths: [3, 12],
      minCheckpoints: 1,
      maxCheckpoints: 2,
      exitConditions: [
        { type: "arc_signal", signalType: "restructuring_accepted" },
        { type: "checkpoint_cap", value: 2 }
      ],
      nextPhaseId: "recovery",
      fallbackPhaseId: "recovery"
    },
    {
      id: "recovery",
      ...DEFAULT_TEMPORAL_PROFILES.normal,
      durationMonths: [6, 18],
      minCheckpoints: 1,
      maxCheckpoints: 2,
      exitConditions: [
        { type: "debt_health_at_most", value: "watch" },
        { type: "checkpoint_cap", value: 2 }
      ],
      nextPhaseId: "operation",
      fallbackPhaseId: "operation"
    },
    {
      id: "operation",
      ...DEFAULT_TEMPORAL_PROFILES.stable,
      durationMonths: [9, 24],
      minCheckpoints: 1,
      maxCheckpoints: 1,
      exitConditions: [
        { type: "debt_health_at_most", value: "watch" },
        { type: "checkpoint_cap", value: 1 }
      ]
    }
  ]
};

const PHASE_POLICIES: Record<string, PhaseTransitionPolicy> = {
  [DEFAULT_PHASE_POLICY.id]: DEFAULT_PHASE_POLICY,
  [HEALTH_CRISIS_PHASE_POLICY.id]: HEALTH_CRISIS_PHASE_POLICY,
  [FINANCIAL_DEBT_PHASE_POLICY.id]: FINANCIAL_DEBT_PHASE_POLICY
};

export function resolvePhasePolicy(policyId?: string): PhaseTransitionPolicy {
  return PHASE_POLICIES[policyId || DEFAULT_PHASE_POLICY.id] || DEFAULT_PHASE_POLICY;
}

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
  worldDeltas?: unknown;
  arcSignals?: ArcSignalProposal[];
  policy?: PhaseTransitionPolicy;
  narrativeText?: string;
  expectedSourceOutcomeId?: string;
}): AcceptedNodeOutcome {
  const policy = input.policy || DEFAULT_PHASE_POLICY;
  const normalizedWorldDeltas = normalizeWorldDeltas({
    worldDeltas: input.worldDeltas,
    acceptedOutcomeIds: input.expectedSourceOutcomeId ? [input.expectedSourceOutcomeId] : []
  });
  const worldDeltas = sanitizeEmploymentTransitions({
    worldDeltas: normalizedWorldDeltas.worldDeltas,
    narrativeText: input.narrativeText,
    expectedSourceOutcomeId: input.expectedSourceOutcomeId
  });
  const arcSignals = (Array.isArray(input.arcSignals) ? input.arcSignals : []).filter((signal) => {
    const isSystemDerivedDebtSignal = signal.type === "restructuring_accepted"
      || signal.type === "debt_cashflow_stabilized";
    return !isSystemDerivedDebtSignal
      && policy.allowedSignalTypes.includes(signal.type)
      && typeof signal.evidence === "string"
      && signal.evidence.trim().length > 0
      && (!input.narrativeText || input.narrativeText.includes(signal.evidence.trim()))
      && Number.isFinite(signal.confidence)
      && signal.confidence >= 0
      && signal.confidence <= 1;
  });
  return { worldDeltas, arcSignals };
}

const DEBT_HEALTH_ORDER: Record<Exclude<DebtHealthLevel, "unknown">, number> = {
  none: 0,
  manageable: 1,
  watch: 2,
  distressed: 3,
  default_risk: 4,
  defaulted: 5
};

export function matchesDebtHealthExitCondition(
  condition: Extract<ArcExitCondition, { type: "debt_health_at_most" }>,
  debtHealthState?: DebtHealthState
): boolean {
  if (!debtHealthState || debtHealthState.level === "unknown") return false;
  return DEBT_HEALTH_ORDER[debtHealthState.level] <= DEBT_HEALTH_ORDER[condition.value];
}

export function isDebtHealthSustainable(debtHealthState?: DebtHealthState): boolean {
  if (!debtHealthState
    || debtHealthState.source !== "authoritative_ledger"
    || !["none", "manageable", "watch"].includes(debtHealthState.level)) return false;
  if (debtHealthState.trend === "worsening") return false;
  const latestServiceUnpaid = debtHealthState.latestDebtServiceHasUnpaidAmount
    ?? (
      debtHealthState.consecutiveMissedPaymentMonths > 0
      || debtHealthState.reasonCodes.includes("RECENT_MISSED_PAYMENT")
      || debtHealthState.reasonCodes.includes("RECENT_PARTIAL_PAYMENT")
    );
  const hasOpenDelinquency = debtHealthState.hasOpenDelinquentIssue
    ?? debtHealthState.consecutiveMissedPaymentMonths >= 2;
  return !latestServiceUnpaid && !hasOpenDelinquency;
}

function conditionMatches(condition: ArcExitCondition, input: {
  selectedDecision: string;
  acceptedOutcome: AcceptedNodeOutcome;
  attributes: LifeAttributes;
  elapsedMonths: number;
  checkpointCount: number;
  closingDebtHealthState?: DebtHealthState;
}): boolean {
  if (condition.type === "choice_outcome") return input.selectedDecision.includes(condition.outcome);
  if (condition.type === "arc_signal") return input.acceptedOutcome.arcSignals.some((signal) => signal.type === condition.signalType);
  if (condition.type === "world_delta") return input.acceptedOutcome.worldDeltas.some((delta) => delta.type === condition.deltaType);
  if (condition.type === "attribute_at_least") return input.attributes[condition.attribute] >= condition.value;
  if (condition.type === "attribute_at_most") return input.attributes[condition.attribute] <= condition.value;
  if (condition.type === "elapsed_months") return input.elapsedMonths >= condition.value;
  if (condition.type === "debt_health_at_most") {
    return matchesDebtHealthExitCondition(condition, input.closingDebtHealthState);
  }
  if (condition.type === "debt_health_sustainable") {
    return isDebtHealthSustainable(input.closingDebtHealthState);
  }
  return input.checkpointCount >= condition.value;
}

export function reducePressureArc(input: {
  currentArc?: PressureArcState;
  startProposal?: { eventId: string; eventIntentType: string; currentAgeInMonths: number; summary?: string };
  policy?: PhaseTransitionPolicy;
  interleave?: boolean;
  selectedDecision: string;
  acceptedOutcome?: AcceptedNodeOutcome;
  acceptedFinancialEvents?: AcceptedFinancialEvent[];
  rejectedFinancialProposalIds?: string[];
  attributes: LifeAttributes;
  timelineAdvance: { elapsedMonths: number; targetAgeInMonths: number };
  closingDebtHealthState?: DebtHealthState;
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
  if (input.interleave) {
    return {
      action: "interleave",
      previousPhaseId: input.currentArc.phaseId,
      nextPhaseId: input.currentArc.phaseId,
      nextArcState: { ...input.currentArc },
      foregroundPressureArcId: input.currentArc.id,
      reasonCodes: ["relationship-checkpoint-interleaved", "pressure-arc-preserved"]
    };
  }

  if (input.currentArc.status === "suspended") {
    return {
      action: "stay",
      previousPhaseId: input.currentArc.phaseId,
      nextPhaseId: input.currentArc.phaseId,
      nextArcState: { ...input.currentArc },
      reasonCodes: ["pressure-arc-suspended"]
    };
  }

  const acceptedOutcome = input.acceptedOutcome || { worldDeltas: [], arcSignals: [] };
  const acceptedFinancialEvents = input.acceptedFinancialEvents || [];
  const hasAcceptedRestructure = acceptedFinancialEvents.some((event) => (
    event.kind === "debt_restructured" || event.kind === "debt_forgiven"
  ));
  const systemSignals: ArcSignalProposal[] = [
    ...(hasAcceptedRestructure ? [{ type: "restructuring_accepted", evidence: "system:accepted-financial-event", confidence: 1 }] : []),
    ...(isDebtHealthSustainable(input.closingDebtHealthState) ? [{ type: "debt_cashflow_stabilized", evidence: "system:closing-debt-health", confidence: 1 }] : [])
  ];
  const transitionOutcome = systemSignals.length > 0
    ? { ...acceptedOutcome, arcSignals: [...acceptedOutcome.arcSignals, ...systemSignals] }
    : acceptedOutcome;
  const currentPhase = resolvePhase(policy, input.currentArc.phaseId);
  const phaseCheckpointCount = input.currentArc.phaseCheckpointCount + 1;
  const totalCheckpointCount = input.currentArc.totalCheckpointCount + 1;
  const earlyResolved = (policy.earlyResolveConditions || []).some((condition) => conditionMatches(condition, {
    selectedDecision: input.selectedDecision,
    acceptedOutcome: transitionOutcome,
    attributes: input.attributes,
    elapsedMonths: input.timelineAdvance.elapsedMonths,
    checkpointCount: phaseCheckpointCount,
    closingDebtHealthState: input.closingDebtHealthState
  }));
  if (earlyResolved) {
    return {
      action: "resolve",
      previousPhaseId: currentPhase.id,
      nextArcState: {
        ...input.currentArc,
        status: "resolved",
        phaseCheckpointCount,
        totalCheckpointCount,
        resolutionReasonCodes: [...(input.currentArc.resolutionReasonCodes || []), "debt-health-sustainable"]
      },
      reasonCodes: ["early-resolution-condition", "pressure-resolved"]
    };
  }
  const canExit = phaseCheckpointCount >= currentPhase.minCheckpoints;
  const matched = canExit && currentPhase.exitConditions.some((condition) => conditionMatches(condition, {
    selectedDecision: input.selectedDecision,
    acceptedOutcome: transitionOutcome,
    attributes: input.attributes,
    elapsedMonths: input.timelineAdvance.elapsedMonths,
    checkpointCount: phaseCheckpointCount,
    closingDebtHealthState: input.closingDebtHealthState
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

  if (policy.id === FINANCIAL_DEBT_PHASE_POLICY.id
    && currentPhase.id === "operation"
    && hitCap) {
    return {
      action: "stay",
      previousPhaseId: currentPhase.id,
      nextPhaseId: currentPhase.id,
      nextArcState: {
        ...input.currentArc,
        phaseCheckpointCount: currentPhase.maxCheckpoints,
        totalCheckpointCount
      },
      foregroundPressureArcId: input.currentArc.id,
      reasonCodes: ["phase-cap", "resolution-condition-not-met"]
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

export function preemptDebtArcForAcuteHealth(input: {
  debtArc: PressureArcState;
  healthStartProposal: { eventId: string; eventIntentType: string; currentAgeInMonths: number; summary?: string };
}): PressureArcTransitionDecision {
  const healthArc = initializePressureArc({ ...input.healthStartProposal, policy: HEALTH_CRISIS_PHASE_POLICY });
  const suspendedDebtArc: PressureArcState = {
    ...input.debtArc,
    status: "suspended",
    suspendedAtAgeInMonths: input.healthStartProposal.currentAgeInMonths,
    suspendedByArcId: healthArc.id
  };
  return {
    action: "start",
    nextPhaseId: healthArc.phaseId,
    nextArcState: healthArc,
    additionalArcStateUpdates: [suspendedDebtArc],
    foregroundPressureArcId: healthArc.id,
    reasonCodes: ["acute-health-preempts-debt", "event-start-proposal-accepted"]
  };
}

export function resolveDebtArcAfterHealth(input: {
  debtArc: PressureArcState;
  healthArcId: string;
  closingDebtHealthState?: DebtHealthState;
}): PressureArcState {
  if (input.debtArc.status !== "suspended" || input.debtArc.suspendedByArcId !== input.healthArcId) {
    return { ...input.debtArc };
  }
  const { suspendedAtAgeInMonths: _suspendedAt, suspendedByArcId: _suspendedBy, ...rest } = input.debtArc;
  if (input.closingDebtHealthState && ["none", "manageable", "watch"].includes(input.closingDebtHealthState.level)) {
    return {
      ...rest,
      status: "resolved",
      resolutionReasonCodes: [
        ...(input.debtArc.resolutionReasonCodes || []),
        "debt-stabilized-during-health-preemption"
      ]
    };
  }
  return { ...rest, status: "active" };
}

const FINANCIAL_DEBT_PRESENTATION_EVENT_IDS: Record<string, string> = {
  trigger: "financial_payment_strain",
  response: "financial_payment_strain",
  restructuring: "financial_debt_restructuring",
  recovery: "financial_life_under_repayment",
  operation: "financial_life_under_repayment"
};

function isSafeDebtArcPresentationInsert(phaseId: string, event: LifeEventSeed): boolean {
  if (phaseId === "response") return event.id === "financial_repayment_tradeoff";
  if (phaseId !== "recovery" && phaseId !== "operation") return false;
  if (event.id === "financial_debt_reduction_progress") return true;
  if (event.fingerprint?.intensity === "major") return false;
  if (event.intent.temporalProfile?.requiresFollowUp) return false;
  if (phaseId === "recovery") return ["health", "relationship", "career"].includes(event.category);
  return true;
}

export function resolvePressureArcPresentationEvent(input: {
  arc: PressureArcState;
  safeDynamicEvent?: LifeEventSeed;
}): LifeEventSeed | null {
  if (input.arc.phasePolicyId !== FINANCIAL_DEBT_PHASE_POLICY.id) {
    return input.safeDynamicEvent
      || LIFE_EVENTS_DATABASE.find((event) => event.id === input.arc.eventId)
      || null;
  }
  if (input.safeDynamicEvent && isSafeDebtArcPresentationInsert(input.arc.phaseId, input.safeDynamicEvent)) {
    return input.safeDynamicEvent;
  }
  const eventId = FINANCIAL_DEBT_PRESENTATION_EVENT_IDS[input.arc.phaseId]
    || FINANCIAL_DEBT_PRESENTATION_EVENT_IDS.trigger;
  return LIFE_EVENTS_DATABASE.find((event) => event.id === eventId) || null;
}

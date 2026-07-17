import {
  EmploymentStatus,
  EmploymentTransitionProposal,
  FinancialState,
  WorldDelta,
  WorldStateSnapshot
} from "../types";
import type { CareerState } from "../domain/career/types";

const EMPLOYMENT_STATUSES: EmploymentStatus[] = [
  "student",
  "part_time",
  "employed",
  "self_employed",
  "not_working",
  "medical_leave",
  "retired"
];

export function resolveAuthoritativeEmploymentStatus(input: {
  currentCareerState?: Pick<CareerState, "employmentStatus">;
  worldState: Pick<WorldStateSnapshot, "currentEmploymentStatus">;
  legacyFinancialState?: Pick<FinancialState, "employmentStatus">;
  isInitialization: boolean;
}): EmploymentStatus | undefined {
  if (input.currentCareerState) return input.currentCareerState.employmentStatus;
  if (input.worldState.currentEmploymentStatus) return input.worldState.currentEmploymentStatus;
  if (!input.isInitialization) return undefined;
  return input.legacyFinancialState?.employmentStatus;
}

export function validateEmploymentTransition(input: {
  proposal: EmploymentTransitionProposal | undefined;
  narrativeText?: string;
  expectedSourceOutcomeId?: string;
}): EmploymentTransitionProposal | undefined {
  const proposal = input.proposal;
  if (!proposal || proposal.subject !== "protagonist") return undefined;
  if (!EMPLOYMENT_STATUSES.includes(proposal.toStatus)) return undefined;
  if (!Number.isFinite(proposal.effectiveAtAgeInMonths) || proposal.effectiveAtAgeInMonths < 0) return undefined;
  if (!Number.isFinite(proposal.confidence) || proposal.confidence < 0.8 || proposal.confidence > 1) return undefined;
  const evidence = typeof proposal.evidence === "string" ? proposal.evidence.trim() : "";
  if (!evidence || (input.narrativeText && !input.narrativeText.includes(evidence))) return undefined;
  if (!input.expectedSourceOutcomeId || proposal.sourceOutcomeId !== input.expectedSourceOutcomeId) return undefined;
  return { ...proposal, evidence };
}

export function sanitizeEmploymentTransitions(input: {
  worldDeltas: WorldDelta[];
  narrativeText?: string;
  expectedSourceOutcomeId?: string;
}): WorldDelta[] {
  return input.worldDeltas.map((delta) => {
    if (delta.type !== "career_state" || !delta.employmentTransition) return delta;
    const employmentTransition = validateEmploymentTransition({
      proposal: delta.employmentTransition,
      narrativeText: input.narrativeText,
      expectedSourceOutcomeId: input.expectedSourceOutcomeId
    });
    if (employmentTransition) return { ...delta, employmentTransition };
    const { employmentTransition: _ignored, ...summaryOnlyDelta } = delta;
    return summaryOnlyDelta;
  });
}

export function resolveEmploymentStatusForNode(input: {
  currentStatus?: EmploymentStatus;
  worldDeltas?: WorldDelta[];
  narrativeText?: string;
  expectedSourceOutcomeId?: string;
}): EmploymentStatus | undefined {
  const sanitized = sanitizeEmploymentTransitions({
    worldDeltas: input.worldDeltas || [],
    narrativeText: input.narrativeText,
    expectedSourceOutcomeId: input.expectedSourceOutcomeId
  });
  for (const delta of sanitized) {
    if (delta.type === "career_state" && delta.employmentTransition) {
      return delta.employmentTransition.toStatus;
    }
  }
  return input.currentStatus;
}

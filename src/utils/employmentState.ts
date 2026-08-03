import {
  EmploymentStatus,
  EmploymentTransitionProposal,
  FinancialState,
  PendingEmployerOfferResolution,
  WorldDelta,
  WorldStateSnapshot
} from "../types";
import type { CareerState } from "../domain/career/types";
import { matchesNormalizedEvidence } from "../domain/finance/evidenceMatching";

const EMPLOYMENT_STATUSES: EmploymentStatus[] = [
  "student",
  "part_time",
  "employed",
  "self_employed",
  "not_working",
  "medical_leave",
  "retired"
];

/**
 * A proposed start date, onboarding process, or accepted offer is not a
 * completed employment fact. This intentionally remains conservative because
 * the result controls CareerState and recurring salary writes.
 */
export function hasCompletedEmployerStartEvidence(value: string): boolean {
  const uncompletedStart = /(?:下(?:个)?月|下周|明天|未来|将于|将在|计划|准备|拟|预计|等待|确认|安排|尚未|还未|若|如果|一旦)[^。；]{0,32}(?:入职|到岗|上班|任职|担任)|(?:入职|到岗|上班)后(?:可以|将|会|需|需要|再|先)|入职(?:手续|流程|日期)/u;
  const completedStart = /(?:正式|已经|已(?:经)?|开始|随后)[^。；]{0,24}(?:入职|到岗|上班|任职|担任)|(?:入职|到岗|上班)后(?:[，,。；]|(?:你|我|本人|主角|自己|便|就|开始|发现|负责|进入))|(?:你|我|本人|主角|自己)[^。；]{0,12}(?:入职|到岗|上班|任职|担任)后|(?:正式)?加入[^。；]{0,24}(?:公司|企业|机构|团队)[^。；]{0,28}(?:担任|任职|负责|工作|职位|岗位)/u;
  // A choice may legitimately say “计划下月入职” while the resulting
  // outcome records a later completed start.  Evaluate each sentence so the
  // earlier plan cannot erase a separate, completed employment fact.
  return value.split(/(?<=[。！？；])/u).some((sentence) => (
    !uncompletedStart.test(sentence) && completedStart.test(sentence)
  ));
}

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
  if (!Number.isFinite(proposal.confidence) || proposal.confidence < 0.6 || proposal.confidence > 1) return undefined;
  const evidence = typeof proposal.evidence === "string" ? proposal.evidence.trim() : "";
  if (!evidence || (input.narrativeText && !matchesNormalizedEvidence(input.narrativeText, evidence))) return undefined;
  if (!input.expectedSourceOutcomeId || proposal.sourceOutcomeId !== input.expectedSourceOutcomeId) return undefined;
  return { ...proposal, evidence };
}

export function validatePendingEmployerOfferResolution(input: {
  proposal: PendingEmployerOfferResolution | undefined;
  narrativeText?: string;
  expectedSourceOutcomeId?: string;
}): PendingEmployerOfferResolution | undefined {
  const proposal = input.proposal;
  if (!proposal || !["withdrawn", "started"].includes(proposal.action)) return undefined;
  if (!proposal.pendingOfferSourceOutcomeId || !input.expectedSourceOutcomeId || proposal.sourceOutcomeId !== input.expectedSourceOutcomeId) {
    return undefined;
  }
  if (!Number.isFinite(proposal.confidence) || proposal.confidence < 0.6 || proposal.confidence > 1) return undefined;
  const evidence = typeof proposal.evidence === "string" ? proposal.evidence.trim() : "";
  if (!evidence || (input.narrativeText && !matchesNormalizedEvidence(input.narrativeText, evidence))) return undefined;
  if (proposal.action === "withdrawn"
    && (!/(?:放弃|拒绝|婉拒|撤回|不去|取消)/u.test(evidence) || /(?:不放弃|没有放弃|未放弃)/u.test(evidence))) return undefined;
  if (proposal.action === "started" && !hasCompletedEmployerStartEvidence(evidence)) return undefined;
  return { ...proposal, evidence };
}

export function sanitizeEmploymentTransitions(input: {
  worldDeltas: WorldDelta[];
  narrativeText?: string;
  expectedSourceOutcomeId?: string;
}): WorldDelta[] {
  return input.worldDeltas.map((delta) => {
    if (delta.type !== "career_state") return delta;
    const employmentTransition = validateEmploymentTransition({
      proposal: delta.employmentTransition,
      narrativeText: input.narrativeText,
      expectedSourceOutcomeId: input.expectedSourceOutcomeId
    });
    const pendingEmployerOfferResolution = validatePendingEmployerOfferResolution({
      proposal: delta.pendingEmployerOfferResolution,
      narrativeText: input.narrativeText,
      expectedSourceOutcomeId: input.expectedSourceOutcomeId
    });
    if (employmentTransition || pendingEmployerOfferResolution) {
      const {
        employmentTransition: _rawEmploymentTransition,
        pendingEmployerOfferResolution: _rawPendingEmployerOfferResolution,
        ...baseDelta
      } = delta;
      return {
        ...baseDelta,
        ...(employmentTransition ? { employmentTransition } : {}),
        ...(pendingEmployerOfferResolution ? { pendingEmployerOfferResolution } : {})
      };
    }
    const {
      employmentTransition: _ignoredEmploymentTransition,
      pendingEmployerOfferResolution: _ignoredPendingEmployerOfferResolution,
      ...summaryOnlyDelta
    } = delta;
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

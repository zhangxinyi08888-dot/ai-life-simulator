import type { EmploymentStatus, EmploymentTransitionProposal } from "../../types";
import type { FinancialEvidence } from "../finance/types";
import type {
  AcceptedCareerTransition,
  CareerState,
  CareerStateCollection,
  CareerTransitionProposal
} from "./types";
import { matchesNormalizedEvidence } from "../finance/evidenceMatching";

const EMPLOYMENT_STATUSES: EmploymentStatus[] = [
  "student",
  "part_time",
  "employed",
  "self_employed",
  "not_working",
  "medical_leave",
  "retired"
];

export class CareerStateError extends Error {
  readonly code: "INVALID_TRANSITION" | "CAREER_REVISION_CONFLICT";

  constructor(code: CareerStateError["code"], message: string) {
    super(message);
    this.name = "CareerStateError";
    this.code = code;
  }
}

export function initializeCareerState(input: {
  id: string;
  employmentStatus: EmploymentStatus;
  effectiveFromAgeInMonths: number;
  source?: CareerState["source"];
  confidence?: number;
  occupation?: string;
  industry?: string;
  organization?: string;
}): CareerState {
  if (!EMPLOYMENT_STATUSES.includes(input.employmentStatus)) {
    throw new CareerStateError("INVALID_TRANSITION", "初始就业状态无效");
  }
  return {
    id: input.id,
    employmentStatus: input.employmentStatus,
    occupation: input.occupation,
    industry: input.industry,
    organization: input.organization,
    activeProjectIds: [],
    effectiveFromAgeInMonths: input.effectiveFromAgeInMonths,
    source: input.source || "accepted_history",
    confidence: Math.min(1, Math.max(0, input.confidence ?? 0.8))
  };
}

function nextCareerState(current: CareerState, proposal: CareerTransitionProposal): CareerState {
  const clearsCurrentRole = proposal.toStatus === "student"
    || proposal.toStatus === "not_working"
    || proposal.toStatus === "retired";
  return {
    id: `career_${proposal.id}`,
    employmentStatus: proposal.toStatus,
    occupation: proposal.occupation ?? (clearsCurrentRole ? undefined : current.occupation),
    industry: proposal.industry ?? current.industry,
    organization: proposal.organization ?? (clearsCurrentRole ? undefined : current.organization),
    careerStage: proposal.careerStage ?? current.careerStage,
    activeProjectIds: [...current.activeProjectIds],
    effectiveFromAgeInMonths: proposal.effectiveAtAgeInMonths,
    source: "accepted_history",
    confidence: proposal.confidence
  };
}

export function validateAndAcceptCareerTransition(input: {
  proposal: CareerTransitionProposal;
  currentCareerState: CareerState;
  acceptedOutcomeId: string;
  narrativeText: string;
  periodStartAgeInMonths: number;
  periodEndAgeInMonths: number;
}): AcceptedCareerTransition {
  const { proposal, currentCareerState } = input;
  if (!proposal.id || proposal.fromCareerStateId !== currentCareerState.id) {
    throw new CareerStateError("INVALID_TRANSITION", "职业转换必须引用提交前的当前 CareerState");
  }
  if (proposal.sourceOutcomeId !== input.acceptedOutcomeId) {
    throw new CareerStateError("INVALID_TRANSITION", "职业转换必须关联已接受的选择结果");
  }
  if (!EMPLOYMENT_STATUSES.includes(proposal.toStatus)) {
    throw new CareerStateError("INVALID_TRANSITION", "目标就业状态无效");
  }
  if (!Number.isInteger(proposal.effectiveAtAgeInMonths)
    || proposal.effectiveAtAgeInMonths < input.periodStartAgeInMonths
    || proposal.effectiveAtAgeInMonths > input.periodEndAgeInMonths) {
    throw new CareerStateError("INVALID_TRANSITION", "职业转换生效时间不在本阶段内");
  }
  const evidenceText = proposal.evidence.trim();
  if (!evidenceText || !matchesNormalizedEvidence(input.narrativeText, evidenceText)) {
    throw new CareerStateError("INVALID_TRANSITION", "职业转换证据必须来自当前正文原句");
  }
  if (!Number.isFinite(proposal.confidence) || proposal.confidence < 0.6 || proposal.confidence > 1) {
    throw new CareerStateError("INVALID_TRANSITION", "职业转换 confidence 必须在 0.6-1 之间");
  }
  const evidence: FinancialEvidence[] = [{
    source: "accepted_simulation_outcome",
    sourceEventId: proposal.sourceOutcomeId,
    excerpt: evidenceText,
    reasonCode: "ACCEPTED_CAREER_TRANSITION",
    confidence: proposal.confidence
  }];
  return {
    id: `accepted_${proposal.id}`,
    proposalId: proposal.id,
    fromCareerStateId: currentCareerState.id,
    nextCareerState: nextCareerState(currentCareerState, proposal),
    effectiveAtAgeInMonths: proposal.effectiveAtAgeInMonths,
    evidence,
    acceptedByReasonCodes: ["OUTCOME_AUTHORITY", "PROTAGONIST_TRANSITION", "TEMPORAL_EVIDENCE"]
  };
}

export function reduceCareerStates(input: {
  current: CareerStateCollection;
  expectedCareerRevision: number;
  acceptedTransitions: AcceptedCareerTransition[];
}): CareerStateCollection {
  if (input.current.careerRevision !== input.expectedCareerRevision) {
    throw new CareerStateError(
      "CAREER_REVISION_CONFLICT",
      `Career revision 冲突：期望 ${input.expectedCareerRevision}，实际 ${input.current.careerRevision}`
    );
  }
  if (!input.acceptedTransitions.length) return input.current;
  const next: CareerStateCollection = structuredClone(input.current);
  const committedIds = new Set(next.careerStates.map((state) => state.id));
  for (const transition of [...input.acceptedTransitions].sort((left, right) => left.effectiveAtAgeInMonths - right.effectiveAtAgeInMonths)) {
    if (committedIds.has(transition.nextCareerState.id)) continue;
    if (transition.fromCareerStateId !== next.currentCareerStateId) {
      throw new CareerStateError("INVALID_TRANSITION", `职业转换 ${transition.id} 的前置状态已过期`);
    }
    next.careerStates.push(structuredClone(transition.nextCareerState));
    next.currentCareerStateId = transition.nextCareerState.id;
    next.careerRevision += 1;
    committedIds.add(transition.nextCareerState.id);
  }
  return next;
}

export function currentCareerState(input: {
  careerStates?: CareerState[];
  currentCareerStateId?: string;
}): CareerState | undefined {
  return input.careerStates?.find((state) => state.id === input.currentCareerStateId);
}

export function adaptTransitionalEmploymentProposal(input: {
  proposal: EmploymentTransitionProposal;
  currentCareerState: CareerState;
  proposalId: string;
  acceptedOutcomeId: string;
}): CareerTransitionProposal {
  return {
    id: input.proposalId,
    fromCareerStateId: input.currentCareerState.id,
    toStatus: input.proposal.toStatus,
    occupation: input.proposal.occupation,
    industry: input.proposal.industry,
    organization: input.proposal.organization,
    careerStage: input.proposal.careerStage,
    effectiveAtAgeInMonths: input.proposal.effectiveAtAgeInMonths,
    sourceOutcomeId: input.acceptedOutcomeId,
    evidence: input.proposal.evidence,
    confidence: input.proposal.confidence
  };
}

export function commitTransitionalEmploymentTransition(input: {
  currentCareerState?: CareerState;
  proposal: EmploymentTransitionProposal;
  nextCareerStateId: string;
}): CareerState {
  const proposal = input.proposal;
  if (!EMPLOYMENT_STATUSES.includes(proposal.toStatus)) {
    throw new CareerStateError("INVALID_TRANSITION", "过渡期职业转换目标无效");
  }
  const clearsCurrentRole = proposal.toStatus === "student"
    || proposal.toStatus === "not_working"
    || proposal.toStatus === "retired";
  return {
    id: input.nextCareerStateId,
    employmentStatus: proposal.toStatus,
    occupation: proposal.occupation ?? (clearsCurrentRole ? undefined : input.currentCareerState?.occupation),
    industry: proposal.industry ?? input.currentCareerState?.industry,
    organization: proposal.organization ?? (clearsCurrentRole ? undefined : input.currentCareerState?.organization),
    careerStage: proposal.careerStage ?? input.currentCareerState?.careerStage,
    activeProjectIds: [...(input.currentCareerState?.activeProjectIds || [])],
    effectiveFromAgeInMonths: proposal.effectiveAtAgeInMonths,
    source: "accepted_history",
    confidence: proposal.confidence
  };
}

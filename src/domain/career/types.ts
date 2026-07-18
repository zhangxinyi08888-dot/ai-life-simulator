import type { EmploymentStatus } from "../../types";
import type { FinancialEvidence } from "../finance/types";

export interface CareerState {
  id: string;
  employmentStatus: EmploymentStatus;
  occupation?: string;
  industry?: string;
  organization?: string;
  careerStage?: string;
  activeProjectIds: string[];
  effectiveFromAgeInMonths: number;
  source: "user" | "accepted_history";
  confidence: number;
}

export interface CareerTransitionProposal {
  id: string;
  fromCareerStateId: string;
  toStatus: EmploymentStatus;
  occupation?: string;
  industry?: string;
  organization?: string;
  careerStage?: string;
  effectiveAtAgeInMonths: number;
  sourceOutcomeId: string;
  evidence: string;
  confidence: number;
}

export interface AcceptedCareerTransition {
  id: string;
  proposalId?: string;
  fromCareerStateId: string;
  nextCareerState: CareerState;
  effectiveAtAgeInMonths: number;
  evidence: FinancialEvidence[];
  acceptedByReasonCodes: string[];
}

export interface CareerStateCollection {
  careerStates: CareerState[];
  currentCareerStateId: string;
  careerRevision: number;
}

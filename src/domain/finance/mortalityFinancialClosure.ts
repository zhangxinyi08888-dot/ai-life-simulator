import type { AcceptedCareerTransition, CareerState } from "../career/types";
import type { AcceptedFinancialEvent, FinancialEvidence, FinancialLedger } from "./types";

export interface MortalityFinancialClosure {
  careerTransitions: AcceptedCareerTransition[];
  financialEvents: Array<AcceptedFinancialEvent & {
    kind: "income_source_ended";
    payload: { incomeSourceId: string };
  }>;
}

export function buildMortalityFinancialClosure(input: {
  currentCareer: CareerState;
  ledger: FinancialLedger;
  ageInMonths: number;
  transactionId: string;
}): MortalityFinancialClosure {
  const evidence: FinancialEvidence[] = [{
    source: "system_policy",
    reasonCode: "MORTALITY_LIFECYCLE_CLOSED",
    confidence: 1
  }];
  const proposalId = `mortality_closure_${input.transactionId}`;
  const careerTransitions: AcceptedCareerTransition[] = input.currentCareer.employmentStatus === "not_working"
    ? []
    : [{
        id: `accepted_${proposalId}`,
        proposalId,
        fromCareerStateId: input.currentCareer.id,
        nextCareerState: {
          id: `career_terminal_${input.transactionId}`,
          employmentStatus: "not_working",
          occupation: undefined,
          industry: input.currentCareer.industry,
          organization: undefined,
          careerStage: "life_closed",
          activeProjectIds: [],
          effectiveFromAgeInMonths: input.ageInMonths,
          source: "accepted_history",
          confidence: 1
        },
        effectiveAtAgeInMonths: input.ageInMonths,
        evidence,
        acceptedByReasonCodes: ["SYSTEM_LIFECYCLE", "MORTALITY"]
      }];
  const financialEvents: MortalityFinancialClosure["financialEvents"] = input.ledger.incomeSources
    .filter((source) => source.status === "active" && Boolean(source.linkedCareerStateId))
    .map((source) => ({
      id: `accepted_mortality_income_end_${source.id}_${input.transactionId}`,
      proposalId,
      kind: "income_source_ended" as const,
      effectiveAtAgeInMonths: input.ageInMonths,
      payload: { incomeSourceId: source.id },
      evidence,
      acceptedByReasonCodes: ["SYSTEM_LIFECYCLE", "MORTALITY"]
    }));
  return { careerTransitions, financialEvents };
}

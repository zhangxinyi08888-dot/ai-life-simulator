import type { AcceptedCareerTransition, CareerState } from "../career/types";
import type { AcceptedFinancialEvent, FinancialEvidence, FinancialLedger } from "./types";

export interface LateLifeEmploymentClosure {
  careerTransitions: AcceptedCareerTransition[];
  financialEvents: Array<AcceptedFinancialEvent & {
    kind: "income_source_ended";
    payload: { incomeSourceId: string };
  }>;
}

/**
 * Product reality policy: ordinary employment must be closed by age 80.
 * Independent work can continue only through a separately accepted
 * self_employed transition. This fallback never infers a new income amount.
 */
export function buildLateLifeEmploymentClosure(input: {
  currentCareer: CareerState;
  ledger: FinancialLedger;
  ageInMonths: number;
  transactionId: string;
}): LateLifeEmploymentClosure {
  if (input.ageInMonths < 80 * 12 || input.currentCareer.employmentStatus !== "employed") {
    return { careerTransitions: [], financialEvents: [] };
  }
  const evidence: FinancialEvidence[] = [{
    source: "system_policy",
    reasonCode: "AGE_80_EMPLOYMENT_STATUS_CLOSED",
    confidence: 1
  }];
  const proposalId = `late_life_employment_closure_${input.transactionId}`;
  const careerTransitions: AcceptedCareerTransition[] = [{
    id: `accepted_${proposalId}`,
    proposalId,
    fromCareerStateId: input.currentCareer.id,
    nextCareerState: {
      id: `career_retired_${input.transactionId}`,
      employmentStatus: "retired",
      occupation: undefined,
      industry: input.currentCareer.industry,
      organization: undefined,
      careerStage: "retired_by_age_policy",
      activeProjectIds: [],
      effectiveFromAgeInMonths: input.ageInMonths,
      source: "accepted_history",
      confidence: 1
    },
    effectiveAtAgeInMonths: input.ageInMonths,
    evidence,
    acceptedByReasonCodes: ["SYSTEM_LIFECYCLE", "AGE_80_EMPLOYMENT_POLICY"]
  }];
  const financialEvents: LateLifeEmploymentClosure["financialEvents"] = input.ledger.incomeSources
    .filter((source) => source.status === "active" && source.linkedCareerStateId === input.currentCareer.id)
    .map((source) => ({
      id: `accepted_late_life_income_end_${source.id}_${input.transactionId}`,
      proposalId,
      kind: "income_source_ended" as const,
      effectiveAtAgeInMonths: input.ageInMonths,
      payload: { incomeSourceId: source.id },
      evidence,
      acceptedByReasonCodes: ["SYSTEM_LIFECYCLE", "AGE_80_EMPLOYMENT_POLICY"]
    }));
  return { careerTransitions, financialEvents };
}

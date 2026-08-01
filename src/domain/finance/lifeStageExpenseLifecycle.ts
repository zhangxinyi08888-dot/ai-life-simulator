import type { WorldStateSnapshot } from "../../types";
import type { ExpenseCommitmentV4, ExpenseResponsibilityCandidate, FinancialLedgerIssue } from "./types";
import {
  deriveExpenseResponsibilityCandidates,
  type ExplicitExpenseResponsibilityFact
} from "./expenseResponsibility";

/**
 * Compatibility façade for the former regex lifecycle module.  It now only
 * derives responsibility candidates; it never manufactures Accepted events.
 * Reconciliation, schema validation, Preview and the acceptance gate own the
 * write path.
 */
export interface LifeStageExpenseLifecycleResult {
  candidates: ExpenseResponsibilityCandidate[];
  issues: FinancialLedgerIssue[];
  reviewReasonCodes: string[];
  triggers: ExpenseResponsibilityCandidate[];
  coveredTriggerCount: number;
}

export function detectLifeStageExpenseTriggers(narrativeText: string): ExpenseResponsibilityCandidate[] {
  return deriveExpenseResponsibilityCandidates({ ageInMonths: 0, narrativeText }).candidates;
}

export function applyLifeStageExpenseLifecycle(input: {
  narrativeText: string;
  currentWorldState?: WorldStateSnapshot;
  candidateWorldState?: WorldStateSnapshot;
  existingExpenseCommitments?: ExpenseCommitmentV4[];
  explicitFacts?: ExplicitExpenseResponsibilityFact[];
  ageInMonths: number;
}): LifeStageExpenseLifecycleResult {
  const derived = deriveExpenseResponsibilityCandidates({
    currentWorldState: input.currentWorldState,
    candidateWorldState: input.candidateWorldState,
    existingExpenseCommitments: input.existingExpenseCommitments,
    narrativeText: input.narrativeText,
    explicitFacts: input.explicitFacts,
    ageInMonths: input.ageInMonths
  });
  const ownerIssues: FinancialLedgerIssue[] = derived.candidates
    .filter((candidate) => candidate.liability === "unknown")
    .map((candidate) => ({
      id: `expense_responsibility_owner_review_${candidate.responsibilityKey.replace(/[^a-zA-Z0-9:_-]/gu, "_")}`,
      code: "PENDING_FACT",
      severity: "warning",
      status: "open",
      relatedProposalIds: [],
      relatedAccountIds: [],
      summary: `责任 ${candidate.responsibilityKey} 已被识别，但主角承担比例尚未确认`,
      createdAtAgeInMonths: input.ageInMonths
    }));
  return {
    candidates: derived.candidates,
    triggers: derived.candidates,
    // A trigger is no longer automatically covered.  Coverage is calculated
    // against independent annotations in the audit, never by this detector.
    coveredTriggerCount: 0,
    issues: ownerIssues,
    reviewReasonCodes: ownerIssues.map((item) => item.id)
  };
}

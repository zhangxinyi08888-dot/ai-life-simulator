import type { WorldStateSnapshot } from "../../types";
import type { ExpenseNarrativeBindingMode } from "../../config/financialGatePolicy";
import type { ExpenseCommitmentV4, ExpenseResponsibilityCandidate, FinancialLedgerIssue } from "./types";
import type { NarrativeExpenseFactBindingResult } from "./narrativeExpenseFactBinding";
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
  narrativeBindingMode: ExpenseNarrativeBindingMode;
  narrativeBinding?: NarrativeExpenseFactBindingResult;
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
  sourceNodeId?: string;
  sourceOutcomeId?: string;
  narrativeBindingMode?: ExpenseNarrativeBindingMode;
}): LifeStageExpenseLifecycleResult {
  const derived = deriveExpenseResponsibilityCandidates({
    currentWorldState: input.currentWorldState,
    candidateWorldState: input.candidateWorldState,
    existingExpenseCommitments: input.existingExpenseCommitments,
    narrativeText: input.narrativeText,
    explicitFacts: input.explicitFacts,
    ageInMonths: input.ageInMonths,
    sourceNodeId: input.sourceNodeId,
    sourceOutcomeId: input.sourceOutcomeId,
    narrativeBindingMode: input.narrativeBindingMode
  });
  return {
    candidates: derived.candidates,
    triggers: derived.candidates,
    // A trigger is no longer automatically covered.  Coverage is calculated
    // against independent annotations in the audit, never by this detector.
    coveredTriggerCount: 0,
    // Reconciliation is now the single writer for responsibility severity and
    // persistent issues.  Having this façade produce a second unknown-owner
    // issue used to let lifecycle, binder and reconciler disagree about a
    // material fact's blocking status.
    issues: [],
    reviewReasonCodes: [],
    narrativeBindingMode: derived.narrativeBindingMode,
    narrativeBinding: derived.narrativeBinding
  };
}

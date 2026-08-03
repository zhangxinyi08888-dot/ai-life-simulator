import { expenseReviewIntervalMonths } from "./expenseEstimationPolicyV2";
import type {
  AcceptedFinancialEvent,
  ExpenseCommitment,
  ExpenseCommitmentV4,
  FinancialEvidence,
  FinancialLedgerIssue,
  FinancialLedgerV4
} from "./types";

export interface ExpenseLifecycleReviewPlan {
  events: AcceptedFinancialEvent<"expense_commitment_adjusted">[];
  issues: FinancialLedgerIssue[];
  reviewedCommitmentIds: string[];
}

/**
 * A due review gets one accepted-node grace observation before the next-node
 * prompt must explicitly obtain a real-world confirmation.  `occurrenceCount`
 * is incremented only at the authoritative commit boundary, so generation
 * retries do not consume this budget.
 */
export const EXPENSE_REVIEW_CONFIRMATION_AFTER_SUBSTANTIVE_NODES = 2;

/**
 * A policy/context/legacy estimate (most visibly the adult-basic-living
 * floor) is a nonzero cash-flow safeguard, not a model-originated claim
 * about the protagonist's current real-world spending. Once it becomes due,
 * the system records the review and keeps the warning open, but a narrator
 * cannot truthfully "confirm" or adjust that amount unless this node
 * contains a separate accepted fact.
 *
 * Other commitments with an explicit / last-known amount are different: a
 * due review asks the next node to obtain a real current fact after the
 * grace period.  Keeping this distinction here prevents the prompt and the
 * gate from treating a deterministic floor as an endlessly rejected model
 * proposal.
 */
export function isPolicyOwnedExpenseEstimate(
  commitment: Pick<ExpenseCommitment, "factStatus" | "amountBasis">
): boolean {
  return commitment.factStatus === "needs_review"
    && ["policy_floor", "contextual_estimate", "legacy_estimate"].includes(commitment.amountBasis);
}

export function expenseReviewRequiresPromptConfirmation(
  issue: FinancialLedgerIssue,
  commitment?: Pick<ExpenseCommitment, "factStatus" | "amountBasis">
): boolean {
  const isExpenseReviewIssue = issue.id.startsWith("expense_review_due_")
    || issue.id.startsWith("expense_lifecycle_review_");
  const overdue = issue.status !== "resolved"
    && isExpenseReviewIssue
    && (issue.occurrenceCount ?? 1) >= EXPENSE_REVIEW_CONFIRMATION_AFTER_SUBSTANTIVE_NODES;
  // The optional parameter keeps this small predicate compatible with older
  // audit callers that only have an issue.  The prompt builder always passes
  // the authoritative V4 commitment, which is where the policy ownership
  // distinction can be made safely.
  if (!overdue) return false;
  return !commitment || !isPolicyOwnedExpenseEstimate(commitment);
}

function reviewEvidence(commitment: ExpenseCommitmentV4, ageInMonths: number): FinancialEvidence {
  return {
    source: "system_policy",
    reasonCode: "EXPENSE_REVIEW_DUE",
    excerpt: `责任 ${commitment.responsibilityKey} 到达复核时点，原计提继续生效`,
    confidence: 1,
    financialScope: commitment.financialScope
  };
}

function hasRecordedReviewAtOrAfter(commitment: ExpenseCommitmentV4, ageInMonths: number): boolean {
  if ((commitment.lastReviewedAtAgeInMonths ?? -1) < ageInMonths) return false;
  // Migrations and a new start initialize lastReviewedAt for bookkeeping, but
  // that is not a completed lifecycle review. Only the review state/evidence
  // proves that the account already received the deterministic transition.
  return commitment.evidence.some((evidence) => (
    evidence.reasonCode === "EXPENSE_REVIEW_DUE"
    || evidence.reasonCode === "SYSTEM_POLICY_REVIEW"
  ));
}

export function expenseCommitmentReviewDue(input: {
  commitment: ExpenseCommitmentV4;
  ageInMonths: number;
  changedResponsibilityKeys?: string[];
}): boolean {
  const changed = new Set(input.changedResponsibilityKeys || []);
  // A material responsibility delta may ask for an immediate review even
  // before the ordinary calendar deadline.  The same delta must not rewrite
  // the account again when a retried node sees the already-recorded review.
  if (changed.has(input.commitment.responsibilityKey)) {
    return !hasRecordedReviewAtOrAfter(input.commitment, input.ageInMonths);
  }
  const interval = expenseReviewIntervalMonths(input.commitment.responsibilityKind);
  const dueAt = input.commitment.nextReviewAtAgeInMonths
    ?? (input.commitment.lastConfirmedAtAgeInMonths ?? input.commitment.activeFromAgeInMonths) + interval;
  // The policy deadline creates one review transition.  It deliberately does
  // not produce an adjustment on every later node: the unresolved issue stays
  // open and is observed again at commit time, while the account remains
  // untouched until a new responsibility fact arrives.
  return input.ageInMonths >= dueAt
    && !hasRecordedReviewAtOrAfter(input.commitment, dueAt);
}

function reviewOutstanding(input: {
  commitment: ExpenseCommitmentV4;
  ageInMonths: number;
  changedResponsibilityKeys?: string[];
}): boolean {
  const changed = new Set(input.changedResponsibilityKeys || []);
  if (changed.has(input.commitment.responsibilityKey)) return true;
  const interval = expenseReviewIntervalMonths(input.commitment.responsibilityKind);
  const dueAt = input.commitment.nextReviewAtAgeInMonths
    ?? (input.commitment.lastConfirmedAtAgeInMonths ?? input.commitment.activeFromAgeInMonths) + interval;
  return input.ageInMonths >= dueAt;
}

function sameEvidence(left: FinancialEvidence, right: FinancialEvidence): boolean {
  return left.source === right.source
    && left.reasonCode === right.reasonCode
    && left.excerpt === right.excerpt
    && left.financialScope === right.financialScope;
}

function mergeChangedEvidence(input: {
  commitment: ExpenseCommitmentV4;
  changedEvidence?: FinancialEvidence[];
  policyEvidence: FinancialEvidence;
}): FinancialEvidence[] {
  const merged = [...input.commitment.evidence];
  for (const evidence of [...(input.changedEvidence || []), input.policyEvidence]) {
    if (!merged.some((existing) => sameEvidence(existing, evidence))) merged.push(evidence);
  }
  return merged;
}

/**
 * A review is an explicit state transition, not a silent amount reset.  It
 * preserves the existing amount and source facts.  `paused` accounts therefore
 * keep their review clock but do not become active and do not accrue.
 */
export function buildExpenseLifecycleReviewPlan(input: {
  ledger: FinancialLedgerV4;
  ageInMonths: number;
  changedResponsibilityKeys?: string[];
  /** Candidate evidence is persisted on the one review transition it caused. */
  changedEvidenceByResponsibilityKey?: Record<string, FinancialEvidence[]>;
  /** A substantive start/adjust/end in this same atomic plan owns the account. */
  skipCommitmentIds?: string[];
  proposalNamespace?: string;
}): ExpenseLifecycleReviewPlan {
  const events: AcceptedFinancialEvent<"expense_commitment_adjusted">[] = [];
  const issues: FinancialLedgerIssue[] = [];
  const reviewedCommitmentIds: string[] = [];
  const proposalNamespace = input.proposalNamespace || "system_expense_review";
  const skippedCommitmentIds = new Set(input.skipCommitmentIds || []);

  for (const commitment of input.ledger.expenseCommitments) {
    if (commitment.status === "ended") continue;
    if (skippedCommitmentIds.has(commitment.id)) continue;
    const isOutstanding = reviewOutstanding({
      commitment,
      ageInMonths: input.ageInMonths,
      changedResponsibilityKeys: input.changedResponsibilityKeys
    });
    if (!isOutstanding) continue;
    const shouldTransition = expenseCommitmentReviewDue({
      commitment,
      ageInMonths: input.ageInMonths,
      changedResponsibilityKeys: input.changedResponsibilityKeys
    });

    const id = `${proposalNamespace}_${commitment.id}_${input.ageInMonths}`;
    // A review issue is durable.  Later nodes keep observing the same pending
    // fact (and therefore increment its occurrence count at the commit
    // boundary), but never keep appending a new review adjustment/evidence
    // record solely because the due date is in the past.
    issues.push({
      id: `expense_review_due_${commitment.id}`,
      code: "PENDING_FACT",
      severity: "warning",
      status: "open",
      relatedProposalIds: shouldTransition ? [id] : [],
      relatedAccountIds: [commitment.id],
      summary: `持续支出 ${commitment.displayName} 已到复核时点；继续按现有金额计提，等待金额或责任范围确认`,
      createdAtAgeInMonths: input.ageInMonths
    });
    if (!shouldTransition) continue;

    const evidence = reviewEvidence(commitment, input.ageInMonths);
    const nextCommitment: ExpenseCommitmentV4 = {
      ...structuredClone(commitment),
      factStatus: "needs_review",
      accrualReviewStatus: "review_due",
      lastReviewedAtAgeInMonths: input.ageInMonths,
      // Keep the original due point.  The account remains due until an actual
      // amount fact is accepted; repeated substantive nodes then aggregate on
      // one stable issue instead of silently postponing review forever.
      nextReviewAtAgeInMonths: commitment.nextReviewAtAgeInMonths
        ?? (commitment.lastConfirmedAtAgeInMonths ?? commitment.activeFromAgeInMonths)
          + expenseReviewIntervalMonths(commitment.responsibilityKind),
      evidence: mergeChangedEvidence({
        commitment,
        changedEvidence: input.changedEvidenceByResponsibilityKey?.[commitment.responsibilityKey],
        policyEvidence: evidence
      })
    };
    events.push({
      id: `accepted_${id}`,
      proposalId: id,
      kind: "expense_commitment_adjusted",
      effectiveAtAgeInMonths: input.ageInMonths,
      payload: { expenseCommitmentId: commitment.id, nextCommitment },
      evidence: [evidence],
      acceptedByReasonCodes: ["EXPENSE_REVIEW_DUE"]
    });
    reviewedCommitmentIds.push(commitment.id);
  }
  return { events, issues, reviewedCommitmentIds };
}

import {
  estimateExpenseResponsibility,
  expenseReviewIntervalMonths,
  type ExpenseResponsibilityEstimateContext
} from "./expenseEstimationPolicyV2";
import {
  buildExpenseLifecycleReviewPlan,
  type ExpenseLifecycleReviewPlan
} from "./expenseLifecycleReview";
import type { FinancialNodeGateMode } from "../../config/financialGatePolicy";
import type {
  AcceptedFinancialEvent,
  ExpenseAmountBasis,
  ExpenseCommitmentV4,
  ExpenseResponsibilityCandidate,
  FinancialEventProposal,
  FinancialEvidence,
  FinancialLedgerIssue,
  FinancialLedgerV4
} from "./types";
import { roundWan } from "./ledgerMath";

/**
 * A deterministic reconciliation outcome for one detector candidate. This is
 * intentionally a plan trace, not a ledger write: the simulation service
 * uses the same trace in shadow and enforced modes and only the latter may
 * submit the resulting events to the authoritative transaction.
 */
export type ExpenseCommitmentReconciliationCandidateDisposition =
  | "planned_start"
  | "planned_adjust"
  | "planned_end"
  | "planned_review"
  | "ignored"
  | "issue"
  | "blocked";

export interface ExpenseCommitmentReconciliationCandidateDecision {
  candidateId: string;
  disposition: ExpenseCommitmentReconciliationCandidateDisposition;
  reasonCodes: string[];
  relatedProposalIds: string[];
  relatedIssueIds: string[];
  wouldBlock: boolean;
}

export interface ExpenseCommitmentReconciliationResult {
  proposals: FinancialEventProposal[];
  /** Deterministic review transitions preserve existing accepted amounts. */
  reviewEvents: AcceptedFinancialEvent<"expense_commitment_adjusted">[];
  issues: FinancialLedgerIssue[];
  reviewReasonCodes: string[];
  candidates: ExpenseResponsibilityCandidate[];
  candidateDecisions: ExpenseCommitmentReconciliationCandidateDecision[];
  ignoredCandidateIds: string[];
  wouldBlock: boolean;
  reviewPlan: ExpenseLifecycleReviewPlan;
}

function issue(input: {
  id: string;
  code?: FinancialLedgerIssue["code"];
  severity?: FinancialLedgerIssue["severity"];
  summary: string;
  ageInMonths: number;
  candidate?: ExpenseResponsibilityCandidate;
  relatedAccountIds?: string[];
  relatedProposalIds?: string[];
}): FinancialLedgerIssue {
  return {
    id: input.id,
    code: input.code || "PENDING_FACT",
    severity: input.severity || "warning",
    status: "open",
    relatedProposalIds: input.relatedProposalIds || [],
    relatedAccountIds: input.relatedAccountIds || [],
    summary: input.summary,
    createdAtAgeInMonths: input.ageInMonths
  };
}

function activeByKey(ledger: FinancialLedgerV4, key: string): ExpenseCommitmentV4 | undefined {
  return ledger.expenseCommitments.find((commitment) => (
    commitment.responsibilityKey === key && commitment.status !== "ended"
  ));
}

/**
 * A model-originated expense proposal has already passed the Accepted-event
 * boundary before this deterministic lifecycle pass runs.  It is therefore
 * the sole writer for its responsibility in this node.  Resolve end events
 * against the pre-commit ledger because their payload deliberately carries an
 * account id rather than duplicating the stable responsibility identity.
 */
function responsibilityKeyFromAcceptedExpenseEvent(input: {
  event: AcceptedFinancialEvent;
  ledger: FinancialLedgerV4;
}): string | undefined {
  switch (input.event.kind) {
    case "expense_commitment_started": {
      const event = input.event as AcceptedFinancialEvent<"expense_commitment_started">;
      return event.payload.responsibilityKey;
    }
    case "expense_commitment_adjusted": {
      const event = input.event as AcceptedFinancialEvent<"expense_commitment_adjusted">;
      return event.payload.nextCommitment.responsibilityKey;
    }
    case "expense_commitment_ended": {
      const event = input.event as AcceptedFinancialEvent<"expense_commitment_ended">;
      return input.ledger.expenseCommitments.find((commitment) => (
        commitment.id === event.payload.expenseCommitmentId
      ))?.responsibilityKey;
    }
    default:
      return undefined;
  }
}

function acceptedExpenseResponsibilityKeys(input: {
  events: AcceptedFinancialEvent[] | undefined;
  ledger: FinancialLedgerV4;
}): Set<string> {
  const keys = new Set<string>();
  for (const event of input.events || []) {
    const key = responsibilityKeyFromAcceptedExpenseEvent({ event, ledger: input.ledger });
    if (key) keys.add(key);
  }
  return keys;
}

function nonAccruingCandidate(candidate: ExpenseResponsibilityCandidate): boolean {
  return candidate.completion !== "completed"
    || candidate.cadence === "one_off"
    || candidate.financialScope === "business_operating"
    || candidate.financialScope === "third_party"
    || candidate.liability === "third_party"
    || candidate.liability === "none";
}

function actualShare(candidate: ExpenseResponsibilityCandidate): number | undefined {
  if (candidate.protagonistShareWan !== undefined) return candidate.protagonistShareWan;
  if (candidate.explicitMonthlyTotalWan !== undefined && candidate.shareRate !== undefined) {
    return roundWan(candidate.explicitMonthlyTotalWan * candidate.shareRate);
  }
  return candidate.explicitMonthlyTotalWan;
}

function sourceIsAccepted(candidate: ExpenseResponsibilityCandidate): boolean {
  return candidate.source !== "narrative_supplement";
}

function samePeople(left: string[] | undefined, right: string[] | undefined): boolean {
  const normalized = (values: string[] | undefined) => [...new Set(values || [])].sort();
  return JSON.stringify(normalized(left)) === JSON.stringify(normalized(right));
}

function sameEvidence(left: FinancialEvidence, right: FinancialEvidence): boolean {
  return left.source === right.source
    && left.reasonCode === right.reasonCode
    && left.excerpt === right.excerpt
    && left.financialScope === right.financialScope;
}

function candidateEvidenceIsNew(existing: ExpenseCommitmentV4, candidate: ExpenseResponsibilityCandidate): boolean {
  return candidate.evidence.some((evidence) => (
    !existing.evidence.some((current) => sameEvidence(current, evidence))
  ));
}

function appendCandidateEvidence(existing: ExpenseCommitmentV4, candidate: ExpenseResponsibilityCandidate): FinancialEvidence[] {
  const evidence = [...existing.evidence];
  for (const item of candidate.evidence) {
    if (!evidence.some((current) => sameEvidence(current, item))) evidence.push(item);
  }
  return evidence;
}

function activeScope(candidate: ExpenseResponsibilityCandidate): "personal" | "shared_household" {
  return candidate.financialScope === "shared_household" ? "shared_household" : "personal";
}

/**
 * An ended V4 responsibility deliberately cannot be adjusted back to active.
 * A later, genuinely new start uses the same responsibility key but a new
 * account id, preserving the historical end and the reducer's V4 invariant.
 */
function nextCommitmentId(input: {
  ledger: FinancialLedgerV4;
  candidate: ExpenseResponsibilityCandidate;
  ageInMonths: number;
}): string {
  const base = `expense_${input.candidate.responsibilityKey.replace(/[^a-zA-Z0-9:_-]/gu, "_")}`;
  if (!input.ledger.expenseCommitments.some((commitment) => commitment.id === base)) return base;
  const restartBase = `${base}_restart_${input.ageInMonths}`;
  if (!input.ledger.expenseCommitments.some((commitment) => commitment.id === restartBase)) return restartBase;
  let ordinal = 2;
  while (input.ledger.expenseCommitments.some((commitment) => commitment.id === `${restartBase}_${ordinal}`)) ordinal += 1;
  return `${restartBase}_${ordinal}`;
}

interface ExistingCommitmentMutation {
  next: ExpenseCommitmentV4;
  requiresChangeAuthority: boolean;
  changeReason?: ExpenseResponsibilityCandidate["changeReason"];
}

/**
 * Candidate producers naturally say `start` whenever a completed payer fact
 * appears.  At the ledger boundary that means "start if absent, otherwise
 * adjust/confirm the one stable responsibility".  This prevents a later
 * exact medical, care, or shared-housing fact from being dropped merely
 * because an earlier policy estimate already created the account.
 */
function mutationForExistingCandidate(input: {
  existing: ExpenseCommitmentV4;
  candidate: ExpenseResponsibilityCandidate;
  ageInMonths: number;
}): ExistingCommitmentMutation | undefined {
  const { existing, candidate } = input;
  const nextAmount = actualShare(candidate);
  const hasExactAmount = nextAmount !== undefined;
  const acceptedAmount = hasExactAmount && sourceIsAccepted(candidate);
  const resumesAcceptedPausedResponsibility = existing.status === "paused"
    && candidate.action === "start"
    && candidate.nextStatus === undefined
    && sourceIsAccepted(candidate);
  const requestedStatus = candidate.nextStatus || (resumesAcceptedPausedResponsibility ? "active" : existing.status);
  const nextScope = activeScope(candidate);
  const nextParticipants = candidate.participantPersonIds && candidate.participantPersonIds.length > 0
    ? candidate.participantPersonIds
    : existing.participantPersonIds;
  const amountChanged = hasExactAmount && Math.abs(nextAmount - existing.monthlyAmountWan) > 0.0001;
  const statusChanged = requestedStatus !== existing.status;
  const scopeChanged = nextScope !== existing.financialScope;
  const participantsChanged = !samePeople(nextParticipants, existing.participantPersonIds);
  const shareChanged = candidate.shareRate !== undefined && candidate.shareRate !== existing.householdShareRate;
  // An Accepted exact fact may confirm an estimate even when the numeric
  // amount happens to be unchanged.  Without this, the account stays
  // `needs_review` forever and policy reviews can overwrite later evidence.
  const confirmationChanged = acceptedAmount && (
    existing.factStatus !== "known"
    || existing.confirmedMonthlyAmountWan !== roundWan(nextAmount)
    || existing.amountBasis === "contextual_estimate"
    || existing.amountBasis === "last_known"
  );
  if (!amountChanged && !statusChanged && !scopeChanged && !participantsChanged && !shareChanged && !confirmationChanged) {
    return undefined;
  }

  const nextMonthlyAmountWan = hasExactAmount ? roundWan(nextAmount) : existing.monthlyAmountWan;
  const nextFactStatus = hasExactAmount
    ? acceptedAmount ? "known" : "needs_review"
    : (scopeChanged || participantsChanged || shareChanged) ? "needs_review" : existing.factStatus;
  const nextAccrualReviewStatus = nextFactStatus === "known"
    ? "normal"
    : (hasExactAmount || scopeChanged || participantsChanged || shareChanged)
      ? "conservative"
      : existing.accrualReviewStatus;
  const changeReason = candidate.changeReason
    || (resumesAcceptedPausedResponsibility ? "responsibility_resumed" : undefined);
  return {
    next: {
      ...structuredClone(existing),
      monthlyAmountWan: nextMonthlyAmountWan,
      grossMonthlyAmountWan: hasExactAmount ? candidate.explicitMonthlyTotalWan : existing.grossMonthlyAmountWan,
      confirmedMonthlyAmountWan: hasExactAmount
        ? acceptedAmount ? nextMonthlyAmountWan : undefined
        : existing.confirmedMonthlyAmountWan,
      amountBasis: hasExactAmount
        ? acceptedAmount
          ? candidate.shareRate !== undefined && candidate.explicitMonthlyTotalWan !== undefined
            ? "explicit_shared_amount"
            : "explicit_known"
          : "last_known"
        : existing.amountBasis,
      amountSourceIds: hasExactAmount
        ? [candidate.amountSourceId || `accepted:${candidate.id}`]
        : existing.amountSourceIds,
      financialScope: nextScope,
      participantPersonIds: nextParticipants,
      householdShareRate: candidate.shareRate !== undefined ? candidate.shareRate : existing.householdShareRate,
      status: requestedStatus,
      factStatus: nextFactStatus,
      accrualReviewStatus: nextAccrualReviewStatus,
      lastConfirmedAtAgeInMonths: acceptedAmount ? input.ageInMonths : existing.lastConfirmedAtAgeInMonths,
      lastReviewedAtAgeInMonths: input.ageInMonths,
      // A confirmed amount establishes a new review deadline.  A narrative
      // supplement and an amount-unknown scope change remain reviewable at
      // the prior deadline rather than pretending uncertainty is resolved.
      nextReviewAtAgeInMonths: acceptedAmount
        ? input.ageInMonths + expenseReviewIntervalMonths(existing.responsibilityKind)
        : existing.nextReviewAtAgeInMonths,
      evidence: appendCandidateEvidence(existing, candidate)
    },
    requiresChangeAuthority: nextMonthlyAmountWan < existing.monthlyAmountWan - 0.0001 || statusChanged,
    changeReason
  };
}

function commitmentForCandidate(input: {
  candidate: ExpenseResponsibilityCandidate;
  ageInMonths: number;
  commitmentId?: string;
  /**
   * Context comes from the same accepted WorldState Preview as the candidate.
   * It is optional only for compatibility with callers that have not yet
   * supplied location/household state; absent values use the policy's
   * explicit `unknown -> medium` rule rather than an arbitrary low estimate.
   */
  estimateContext?: Omit<ExpenseResponsibilityEstimateContext, "responsibilityKind" | "ageInMonths">;
}): { commitment?: ExpenseCommitmentV4; issue?: FinancialLedgerIssue } {
  const explicitShare = actualShare(input.candidate);
  const estimate = explicitShare === undefined ? estimateExpenseResponsibility({
    ...input.estimateContext,
    responsibilityKind: input.candidate.responsibilityKind,
    ageInMonths: input.ageInMonths,
    // A candidate alone cannot prove a free home.  Preserve a caller's
    // accepted context if present; otherwise a new residence is unknown,
    // which the V2 policy treats as a nonzero reviewable responsibility.
    livingArrangement: input.estimateContext?.livingArrangement
      || (input.candidate.responsibilityKind === "primary_residence" ? "unknown" : undefined)
  }) : undefined;
  if (explicitShare === undefined && !estimate) {
    return {
      issue: issue({
        id: `expense_estimation_policy_missing_${input.candidate.responsibilityKey}`,
        code: "EXPENSE_ESTIMATION_POLICY_MISSING",
        severity: "blocking",
        summary: `责任 ${input.candidate.responsibilityKey} 在当前年龄/居住/城市上下文中缺少可用的支出估计策略，不能回落为零或 basic floor`,
        ageInMonths: input.ageInMonths,
        candidate: input.candidate
      })
    };
  }
  const accrual = explicitShare ?? estimate!.accrualMonthlyAmountWan;
  // A verified free/provided home is not an active zero commitment.  It is a
  // state fact, so record a review rather than misrepresenting it as cashflow.
  if (accrual <= 0) {
    return {
      issue: issue({
        id: `expense_zero_candidate_${input.candidate.responsibilityKey}`,
        summary: `责任 ${input.candidate.responsibilityKey} 的个人承担额为零；保留居住/责任事实复核，不创建 active 零金额账户`,
        ageInMonths: input.ageInMonths,
        candidate: input.candidate
      })
    };
  }
  const isExplicit = explicitShare !== undefined;
  const isShared = input.candidate.financialScope === "shared_household";
  const acceptedSource = sourceIsAccepted(input.candidate);
  // A prose-only number may be a useful conservative accrual input, but it
  // is not a confirmed financial fact. Do not label it explicit_* because
  // that basis requires a confirmed personal share and accepted evidence.
  const amountBasis: ExpenseAmountBasis = isExplicit
    ? acceptedSource
      ? isShared && input.candidate.explicitMonthlyTotalWan !== undefined && input.candidate.shareRate !== undefined
        ? "explicit_shared_amount"
        : "explicit_known"
      : "last_known"
    : "contextual_estimate";
  const factStatus = isExplicit && acceptedSource ? "known" : "needs_review";
  const estimateEvidence = estimate ? [{
    source: "system_policy" as const,
    reasonCode: `EXPENSE_POLICY_${input.candidate.responsibilityKind.toUpperCase()}`,
    confidence: 1,
    financialScope: input.candidate.financialScope
  }] : [];
  return {
    commitment: {
      id: input.commitmentId || `expense_${input.candidate.responsibilityKey.replace(/[^a-zA-Z0-9:_-]/gu, "_")}`,
      responsibilityKey: input.candidate.responsibilityKey,
      responsibilityKind: input.candidate.responsibilityKind,
      type: input.candidate.proposedType,
      displayName: input.candidate.responsibilityKind === "primary_residence" ? "住房持续支出"
        : input.candidate.responsibilityKind === "child_support" ? "子女抚养持续支出"
          : input.candidate.responsibilityKind === "elder_care" ? "赡养与照护持续支出"
            : input.candidate.responsibilityKind === "recurring_healthcare" ? "持续医疗支出"
              : input.candidate.responsibilityKind === "personal_insurance" ? "持续保险支出"
                : input.candidate.responsibilityKind === "continuing_education" ? "持续教育支出"
                  : "个人基础生活支出",
      monthlyAmountWan: roundWan(accrual),
      grossMonthlyAmountWan: input.candidate.explicitMonthlyTotalWan,
      confirmedMonthlyAmountWan: factStatus === "known" ? roundWan(accrual) : undefined,
      plausibleMonthlyAmountRangeWan: estimate?.plausibleRangeWan,
      amountBasis,
      amountSourceIds: [input.candidate.amountSourceId || `${estimate?.policyId || "accepted"}:${input.candidate.responsibilityKey}`],
      estimationPolicyId: estimate?.policyId,
      financialScope: input.candidate.financialScope === "shared_household" ? "shared_household" : "personal",
      participantPersonIds: input.candidate.participantPersonIds,
      householdShareRate: input.candidate.shareRate,
      activeFromAgeInMonths: input.ageInMonths,
      status: "active",
      factStatus,
      accrualReviewStatus: factStatus === "known" ? "normal" : "conservative",
      lastConfirmedAtAgeInMonths: factStatus === "known" ? input.ageInMonths : undefined,
      lastReviewedAtAgeInMonths: input.ageInMonths,
      nextReviewAtAgeInMonths: input.ageInMonths + expenseReviewIntervalMonths(input.candidate.responsibilityKind),
      evidence: [...input.candidate.evidence, ...estimateEvidence]
    }
  };
}

function toProposal(input: {
  candidate: ExpenseResponsibilityCandidate;
  commitment: ExpenseCommitmentV4;
  sourceOutcomeId?: string;
  ageInMonths: number;
}): FinancialEventProposal {
  const id = `system_expense_start_${input.candidate.id}`;
  return {
    id,
    kind: "expense_commitment_started",
    effectiveAtAgeInMonths: input.ageInMonths,
    payload: input.commitment,
    evidence: input.candidate.evidence.map((item) => item.excerpt).filter(Boolean).join("；") || input.commitment.displayName,
    sourceOutcomeId: input.sourceOutcomeId,
    confidence: 1,
    financialScope: input.candidate.financialScope
  } as FinancialEventProposal;
}

function reviewIssue(candidate: ExpenseResponsibilityCandidate, ageInMonths: number, summary: string): FinancialLedgerIssue {
  return issue({
    id: `expense_responsibility_review_${candidate.responsibilityKey.replace(/[^a-zA-Z0-9:_-]/gu, "_")}`,
    summary,
    ageInMonths,
    candidate
  });
}

/**
 * Candidate producers should pass an explicit reason, especially for
 * structured WorldState deltas.  This fallback only maps a concrete accepted
 * evidence phrase; it never treats elapsed time, retirement, or silence as a
 * lifecycle end.
 */
function endReasonForCandidate(candidate: ExpenseResponsibilityCandidate) {
  if (candidate.changeReason) return candidate.changeReason;
  const text = candidate.evidence.map((item) => item.excerpt || "").join("；");
  if (/搬离|退租|退房|不再居住|搬出/u.test(text)) return "residence_ended" as const;
  if (/子女.{0,20}(?:独立|工作|不再需要抚养)|独立生活/u.test(text)) return "dependent_independent" as const;
  if (/去世|离世/u.test(text)) return "care_recipient_deceased" as const;
  if (/照护.{0,30}(?:转由|转给|改由|不再由)|(?:责任|费用).{0,20}(?:转移|改由|转由)/u.test(text)) return "care_responsibility_transferred" as const;
  if (/(?:治疗|用药|复诊).{0,24}(?:完成|结束|停止)|康复/u.test(text)) return "treatment_completed" as const;
  if (/(?:保单|保险).{0,24}(?:取消|终止|退保|结束)|不再.{0,12}(?:缴纳|支付).{0,12}(?:保费|保险)/u.test(text)) return "insurance_cancelled" as const;
  if (/毕业|退学|(?:课程|教育).{0,24}(?:完成|结束)|不再.{0,12}(?:学费|教育费)/u.test(text)) return "education_completed" as const;
  if (/(?:原子)?拆分|分项|拆成/u.test(text)) return "aggregate_atomically_split" as const;
  return "responsibility_ended" as const;
}

/**
 * An active V4 legacy aggregate deliberately means its component coverage is
 * unknown.  The amount must remain the sole accrual until an explicit,
 * atomic coverage/split fact is accepted; a newly detected rent, medical, or
 * support candidate cannot be added beside it without double counting.
 */
function activeUnknownCoverageAggregate(ledger: FinancialLedgerV4): ExpenseCommitmentV4 | undefined {
  return ledger.expenseCommitments.find((commitment) => (
    commitment.status === "active"
    && commitment.responsibilityKind === "legacy_aggregate"
    && commitment.factStatus === "needs_review"
  ));
}

function wouldStartNewComponent(input: {
  candidate: ExpenseResponsibilityCandidate;
  existing?: ExpenseCommitmentV4;
}): boolean {
  if (input.existing || input.candidate.responsibilityKind === "legacy_aggregate") return false;
  return input.candidate.action === "start"
    || input.candidate.action === "adjust"
    || isConfirmedSharedResidenceTransition(input.candidate);
}

function aggregateComponentGapIssue(input: {
  aggregate: ExpenseCommitmentV4;
  candidate: ExpenseResponsibilityCandidate;
  ageInMonths: number;
}): FinancialLedgerIssue {
  return issue({
    id: `expense_component_gap_${input.aggregate.id}_${input.candidate.responsibilityKey.replace(/[^a-zA-Z0-9:_-]/gu, "_")}`,
    code: "EXPENSE_OPENING_COMPONENT_GAP",
    summary: `聚合支出 ${input.aggregate.displayName} 的覆盖关系仍未知；${input.candidate.responsibilityKey} 仅保留候选并触发复核，不能与聚合支出并行计提`,
    ageInMonths: input.ageInMonths,
    candidate: input.candidate,
    relatedAccountIds: [input.aggregate.id]
  });
}

/**
 * RelationshipState is sufficient to establish that a shared residence now
 * exists, even when it has not supplied a rent amount.  It is deliberately
 * narrower than an arbitrary review candidate: only the structured,
 * accepted-world transition emitted for confirmed cohabitation/marriage may
 * create the policy-based residence commitment below.  Prose-only hints and
 * generic household reviews must continue through the normal review path.
 */
function isConfirmedSharedResidenceTransition(candidate: ExpenseResponsibilityCandidate): boolean {
  return candidate.responsibilityKey === "primary_residence:main"
    && candidate.responsibilityKind === "primary_residence"
    && candidate.proposedType === "housing"
    && candidate.action === "review"
    && candidate.completion === "completed"
    && candidate.liability === "shared"
    && candidate.financialScope === "shared_household"
    && candidate.source === "accepted_world_delta";
}

function isCareerExitReview(candidate: ExpenseResponsibilityCandidate): boolean {
  return candidate.action === "review"
    // `:main` is retained only as a read-compatibility alias for early V4
    // snapshots. New opening and lifecycle writes always use `:protagonist`.
    && ["adult_basic_living:protagonist", "adult_basic_living:main"].includes(candidate.responsibilityKey)
    && candidate.evidence.some((item) => item.reasonCode === "EXPENSE_CAREER_EXIT_REVIEW");
}

/**
 * Reconciles responsibility candidates into schema-shaped proposals.  It does
 * not mutate the ledger.  The simulation service runs the resulting proposals
 * through normal proposal validation, Preview and the node acceptance gate.
 */
export function reconcileExpenseCommitments(input: {
  ledger: FinancialLedgerV4;
  candidates: ExpenseResponsibilityCandidate[];
  /**
   * Direct expense Accepted events have first-writer authority for this node.
   * Derived lifecycle candidates may still be retained for audit telemetry,
   * but must not emit a sibling start/adjust/end or stale scheduled review.
   */
  acceptedExpenseEvents?: AcceptedFinancialEvent[];
  ageInMonths: number;
  /** Preview-derived context used only for new unknown-amount responsibilities. */
  estimateContext?: Omit<ExpenseResponsibilityEstimateContext, "responsibilityKind" | "ageInMonths">;
  sourceOutcomeId?: string;
  mode: FinancialNodeGateMode;
}): ExpenseCommitmentReconciliationResult {
  const proposals: FinancialEventProposal[] = [];
  const issues: FinancialLedgerIssue[] = [];
  const ignoredCandidateIds: string[] = [];
  const candidateDecisionById = new Map<string, ExpenseCommitmentReconciliationCandidateDecision>(
    input.candidates.map((candidate) => [candidate.id, {
      candidateId: candidate.id,
      disposition: "ignored" as const,
      reasonCodes: ["NO_RECONCILIATION_ACTION"],
      relatedProposalIds: [],
      relatedIssueIds: [],
      wouldBlock: false
    }])
  );
  /** Candidate-to-responsibility links for reviews emitted after the main pass. */
  const reviewKeysByCandidateId = new Map<string, Set<string>>();
  const recordCandidateDecision = (inputDecision: {
    candidate: ExpenseResponsibilityCandidate;
    disposition: ExpenseCommitmentReconciliationCandidateDisposition;
    reasonCode: string;
    proposalId?: string;
    issue?: FinancialLedgerIssue;
  }) => {
    const previous = candidateDecisionById.get(inputDecision.candidate.id);
    const relatedProposalIds = new Set(previous?.relatedProposalIds || []);
    const relatedIssueIds = new Set(previous?.relatedIssueIds || []);
    const reasonCodes = new Set(previous?.reasonCodes || []);
    reasonCodes.delete("NO_RECONCILIATION_ACTION");
    reasonCodes.add(inputDecision.reasonCode);
    if (inputDecision.proposalId) relatedProposalIds.add(inputDecision.proposalId);
    if (inputDecision.issue) relatedIssueIds.add(inputDecision.issue.id);
    candidateDecisionById.set(inputDecision.candidate.id, {
      candidateId: inputDecision.candidate.id,
      disposition: inputDecision.disposition,
      reasonCodes: [...reasonCodes],
      relatedProposalIds: [...relatedProposalIds],
      relatedIssueIds: [...relatedIssueIds],
      wouldBlock: inputDecision.disposition === "blocked"
        || Boolean(inputDecision.issue && inputDecision.issue.severity === "blocking")
    });
  };
  const changedKeys: string[] = [];
  const changedEvidenceByResponsibilityKey: Record<string, FinancialEvidence[]> = {};
  // The ledger is intentionally immutable during reconciliation, so pending
  // start proposals must participate in the same idempotency index as already
  // committed commitments. Otherwise a retried/duplicated candidate within
  // one node can mint the same recurring responsibility twice.
  const plannedStartKeys = new Set<string>();
  // A scheduled policy review is calculated from the pre-commit ledger.  A
  // real action for the same account must own this node, otherwise the stale
  // review payload can overwrite a just-confirmed amount or fail after an
  // end.  See buildExpenseLifecycleReviewPlan.skipCommitmentIds.
  const plannedMutationCommitmentIds = new Set<string>();
  const acceptedExpenseKeys = acceptedExpenseResponsibilityKeys({
    events: input.acceptedExpenseEvents,
    ledger: input.ledger
  });
  const acceptedExpenseCommitmentIds = new Set(input.ledger.expenseCommitments
    .filter((commitment) => acceptedExpenseKeys.has(commitment.responsibilityKey))
    .map((commitment) => commitment.id));
  const reportedAggregateComponentKeys = new Set<string>();
  const aggregateWithUnknownCoverage = activeUnknownCoverageAggregate(input.ledger);
  const queueReview = (responsibilityKey: string, evidence: FinancialEvidence[] = []) => {
    changedKeys.push(responsibilityKey);
    if (evidence.length === 0) return;
    const collected = changedEvidenceByResponsibilityKey[responsibilityKey] ||= [];
    for (const item of evidence) {
      if (!collected.some((current) => sameEvidence(current, item))) collected.push(item);
    }
  };
  const queueCandidateReview = (candidate: ExpenseResponsibilityCandidate, responsibilityKey: string, evidence: FinancialEvidence[] = []) => {
    queueReview(responsibilityKey, evidence);
    const keys = reviewKeysByCandidateId.get(candidate.id) || new Set<string>();
    keys.add(responsibilityKey);
    reviewKeysByCandidateId.set(candidate.id, keys);
  };
  for (const candidate of input.candidates) {
    // Do this before any lifecycle issue/review work. A direct Accepted fact
    // is not a second candidate to reconcile; letting a deterministic plan
    // touch it would either duplicate accrual or overwrite the direct amount.
    if (acceptedExpenseKeys.has(candidate.responsibilityKey)) {
      ignoredCandidateIds.push(candidate.id);
      recordCandidateDecision({
        candidate,
        disposition: "ignored",
        reasonCode: "DIRECT_ACCEPTED_EXPENSE_FIRST_WRITER"
      });
      continue;
    }
    if (nonAccruingCandidate(candidate)) {
      ignoredCandidateIds.push(candidate.id);
      recordCandidateDecision({
        candidate,
        disposition: "ignored",
        reasonCode: "NON_ACCRUING_SCOPE_OR_CADENCE"
      });
      continue;
    }
    if (candidate.liability === "unknown") {
      const unresolvedLiabilityIssue = reviewIssue(candidate, input.ageInMonths, `责任 ${candidate.responsibilityKey} 已出现，但主角是否承担尚未确认；不得从个人现金自动扣款`);
      issues.push(unresolvedLiabilityIssue);
      recordCandidateDecision({
        candidate,
        disposition: "issue",
        reasonCode: "LIABILITY_UNKNOWN_REVIEW_REQUIRED",
        issue: unresolvedLiabilityIssue
      });
      continue;
    }
    const existing = activeByKey(input.ledger, candidate.responsibilityKey);
    if (aggregateWithUnknownCoverage && wouldStartNewComponent({ candidate, existing })) {
      // The aggregate is still the authoritative prospective cashflow. Mark
      // it due for review but do not manufacture a second component account
      // from an otherwise valid candidate.
      queueReview(aggregateWithUnknownCoverage.responsibilityKey, candidate.evidence);
      const componentKey = `${aggregateWithUnknownCoverage.id}:${candidate.responsibilityKey}`;
      if (!reportedAggregateComponentKeys.has(componentKey)) {
        const aggregateGapIssue = aggregateComponentGapIssue({
          aggregate: aggregateWithUnknownCoverage,
          candidate,
          ageInMonths: input.ageInMonths
        });
        issues.push(aggregateGapIssue);
        recordCandidateDecision({
          candidate,
          disposition: "issue",
          reasonCode: "LEGACY_AGGREGATE_COMPONENT_COVERAGE_UNKNOWN",
          issue: aggregateGapIssue
        });
        reportedAggregateComponentKeys.add(componentKey);
      } else {
        recordCandidateDecision({
          candidate,
          disposition: "issue",
          reasonCode: "LEGACY_AGGREGATE_COMPONENT_COVERAGE_UNKNOWN"
        });
      }
      continue;
    }
    if (!existing && plannedStartKeys.has(candidate.responsibilityKey)) {
      ignoredCandidateIds.push(candidate.id);
      recordCandidateDecision({
        candidate,
        disposition: "ignored",
        reasonCode: "DUPLICATE_PENDING_START"
      });
      continue;
    }
    if (candidate.action === "review") {
      if (isCareerExitReview(candidate)) {
        // Retirement/not-working changes affordability, not the underlying
        // obligations. Review every existing recurring responsibility while
        // preserving each amount and status; no generic post-career discount
        // or automatic ending is permitted here.
        for (const commitment of input.ledger.expenseCommitments.filter((item) => item.status !== "ended")) {
          queueCandidateReview(candidate, commitment.responsibilityKey);
        }
      } else if (!existing || candidateEvidenceIsNew(existing, candidate)) {
        queueCandidateReview(candidate, candidate.responsibilityKey, candidate.evidence);
      }
      if (!existing && !isCareerExitReview(candidate)) {
        // A completed, protagonist/shared responsibility with an unknown
        // amount is still a real recurring cash-flow responsibility.  Create
        // its typed, nonzero policy account rather than leaving the ledger at
        // the unrelated basic-living floor.  The account remains
        // `needs_review`; this does not pretend an exact amount or silently
        // turn an owner-unknown candidate into a personal deduction.
        //
        // This generalizes the original confirmed-shared-residence exception
        // to every canonical V4 responsibility.  It deliberately excludes
        // `liability=unknown`, which §8.3 requires to stay as a review issue
        // until the protagonist's responsibility is established.
        const built = commitmentForCandidate({
          candidate,
          ageInMonths: input.ageInMonths,
          commitmentId: nextCommitmentId({ ledger: input.ledger, candidate, ageInMonths: input.ageInMonths }),
          estimateContext: input.estimateContext
        });
        if (built.issue) {
          issues.push(built.issue);
          recordCandidateDecision({
            candidate,
            disposition: built.issue.severity === "blocking" ? "blocked" : "issue",
            reasonCode: built.issue.code,
            issue: built.issue
          });
        } else {
          const proposal = toProposal({
            candidate,
            commitment: built.commitment!,
            sourceOutcomeId: input.sourceOutcomeId,
            ageInMonths: input.ageInMonths
          });
          proposals.push(proposal);
          plannedStartKeys.add(candidate.responsibilityKey);
          recordCandidateDecision({
            candidate,
            disposition: "planned_start",
            reasonCode: "REVIEW_CANDIDATE_REQUIRES_INITIAL_COMMITMENT",
            proposalId: proposal.id
          });
        }
      } else if (!existing) {
        const missingReviewTargetIssue = reviewIssue(candidate, input.ageInMonths, `关系或生活安排发生变化，需要复核 ${candidate.responsibilityKey}；没有金额事实时不创建泛化家庭消费桶`);
        issues.push(missingReviewTargetIssue);
        recordCandidateDecision({
          candidate,
          disposition: "issue",
          reasonCode: "CAREER_EXIT_REVIEW_TARGET_MISSING",
          issue: missingReviewTargetIssue
        });
      } else if (!candidateEvidenceIsNew(existing, candidate) && !isCareerExitReview(candidate)) {
        recordCandidateDecision({
          candidate,
          disposition: "ignored",
          reasonCode: "REVIEW_EVIDENCE_ALREADY_CURRENT"
        });
      }
      continue;
    }
    if (candidate.action === "end") {
      if (!existing) {
        recordCandidateDecision({
          candidate,
          disposition: "ignored",
          reasonCode: "END_TARGET_NOT_ACTIVE"
        });
        continue;
      }
      if (plannedMutationCommitmentIds.has(existing.id)) {
        ignoredCandidateIds.push(candidate.id);
        recordCandidateDecision({
          candidate,
          disposition: "ignored",
          reasonCode: "CONFLICTING_PENDING_MUTATION"
        });
        continue;
      }
      if (candidate.evidence.length === 0) {
        const endWithoutEvidenceIssue = issue({
          id: `expense_end_without_evidence_${existing.id}`,
          severity: "blocking",
          summary: `支出责任 ${existing.responsibilityKey} 请求结束但缺少 Accepted 结束证据`,
          ageInMonths: input.ageInMonths,
          candidate
        });
        issues.push(endWithoutEvidenceIssue);
        recordCandidateDecision({
          candidate,
          disposition: "blocked",
          reasonCode: "END_WITHOUT_ACCEPTED_EVIDENCE",
          issue: endWithoutEvidenceIssue
        });
      } else {
        const proposal = {
          id: `system_expense_end_${candidate.id}`,
          kind: "expense_commitment_ended",
          effectiveAtAgeInMonths: input.ageInMonths,
          payload: {
            expenseCommitmentId: existing.id,
            previousCommitmentId: existing.id,
            // A structured candidate should carry the more specific reason.
            // The generic value is still explicit and may only clear the
            // validator when the Accepted outcome says this responsibility
            // actually ended or transferred.
            changeReason: endReasonForCandidate(candidate)
          },
          evidence: candidate.evidence.map((item) => item.excerpt).filter(Boolean).join("；"),
          sourceOutcomeId: input.sourceOutcomeId,
          confidence: 1,
          financialScope: candidate.financialScope
        } as FinancialEventProposal;
        proposals.push(proposal);
        plannedMutationCommitmentIds.add(existing.id);
        recordCandidateDecision({
          candidate,
          disposition: "planned_end",
          reasonCode: "END_WITH_ACCEPTED_EVIDENCE",
          proposalId: proposal.id
        });
      }
      continue;
    }
    if (existing) {
      if (plannedMutationCommitmentIds.has(existing.id)) {
        ignoredCandidateIds.push(candidate.id);
        recordCandidateDecision({
          candidate,
          disposition: "ignored",
          reasonCode: "CONFLICTING_PENDING_MUTATION"
        });
        continue;
      }
      // A repeated `start` candidate is a normal production shape: candidate
      // derivation does not read the ledger and therefore cannot know that a
      // policy/earlier fact already made the stable responsibility. Reconcile
      // it as an in-place action, never as a second account.
      const mutation = (candidate.action === "start" || candidate.action === "adjust")
        ? mutationForExistingCandidate({ existing, candidate, ageInMonths: input.ageInMonths })
        : undefined;
      if (mutation) {
        const proposal = {
          id: `system_expense_adjust_${candidate.id}`,
          kind: "expense_commitment_adjusted",
          effectiveAtAgeInMonths: input.ageInMonths,
          payload: {
            expenseCommitmentId: existing.id,
            ...(mutation.requiresChangeAuthority ? {
              previousCommitmentId: existing.id,
              changeReason: mutation.changeReason
            } : {}),
            nextCommitment: mutation.next
          },
          evidence: candidate.evidence.map((item) => item.excerpt).filter(Boolean).join("；"),
          sourceOutcomeId: input.sourceOutcomeId,
          confidence: 1,
          financialScope: candidate.financialScope
        } as FinancialEventProposal;
        proposals.push(proposal);
        plannedMutationCommitmentIds.add(existing.id);
        recordCandidateDecision({
          candidate,
          disposition: "planned_adjust",
          reasonCode: "EXISTING_COMMITMENT_MUTATION",
          proposalId: proposal.id
        });
      } else if (candidateEvidenceIsNew(existing, candidate)) {
        // A completed same-key fact with no changed numeric/state field is
        // still a new responsibility observation. Persist it once through the
        // review transition, then leave later retries to the stable issue.
        queueCandidateReview(candidate, candidate.responsibilityKey, candidate.evidence);
      } else {
        recordCandidateDecision({
          candidate,
          disposition: "ignored",
          reasonCode: "NO_MATERIAL_MUTATION"
        });
      }
      continue;
    }
    const built = commitmentForCandidate({
      candidate,
      ageInMonths: input.ageInMonths,
      commitmentId: nextCommitmentId({ ledger: input.ledger, candidate, ageInMonths: input.ageInMonths }),
      estimateContext: input.estimateContext
    });
    if (built.issue) {
      issues.push(built.issue);
      recordCandidateDecision({
        candidate,
        disposition: built.issue.severity === "blocking" ? "blocked" : "issue",
        reasonCode: built.issue.code,
        issue: built.issue
      });
      continue;
    }
    const proposal = toProposal({ candidate, commitment: built.commitment!, sourceOutcomeId: input.sourceOutcomeId, ageInMonths: input.ageInMonths });
    proposals.push(proposal);
    plannedStartKeys.add(candidate.responsibilityKey);
    recordCandidateDecision({
      candidate,
      disposition: "planned_start",
      reasonCode: "NEW_RESPONSIBILITY_COMMITMENT",
      proposalId: proposal.id
    });
  }

  const reviewPlan = buildExpenseLifecycleReviewPlan({
    ledger: input.ledger,
    ageInMonths: input.ageInMonths,
    changedResponsibilityKeys: changedKeys,
    changedEvidenceByResponsibilityKey,
    skipCommitmentIds: [...new Set([
      ...plannedMutationCommitmentIds,
      ...acceptedExpenseCommitmentIds
    ])]
  });
  issues.push(...reviewPlan.issues);
  const commitmentIdByResponsibilityKey = new Map(input.ledger.expenseCommitments
    .map((commitment) => [commitment.responsibilityKey, commitment.id]));
  const reviewEventsByResponsibilityKey = new Map<string, AcceptedFinancialEvent<"expense_commitment_adjusted">[]>();
  for (const event of reviewPlan.events) {
    const key = event.payload.nextCommitment.responsibilityKey;
    const events = reviewEventsByResponsibilityKey.get(key) || [];
    events.push(event);
    reviewEventsByResponsibilityKey.set(key, events);
  }
  for (const candidate of input.candidates) {
    const reviewKeys = reviewKeysByCandidateId.get(candidate.id);
    if (!reviewKeys || reviewKeys.size === 0) continue;
    const current = candidateDecisionById.get(candidate.id);
    // A review candidate may create a new typed commitment in the same pass.
    // The start is its actual planned action, so do not relabel it as review.
    if (current && ["planned_start", "planned_adjust", "planned_end", "issue", "blocked"].includes(current.disposition)) continue;
    const reviewEvents = [...reviewKeys].flatMap((key) => reviewEventsByResponsibilityKey.get(key) || []);
    if (reviewEvents.length > 0) {
      recordCandidateDecision({
        candidate,
        disposition: "planned_review",
        reasonCode: "SCHEDULED_OR_CHANGED_RESPONSIBILITY_REVIEW",
        proposalId: reviewEvents[0].proposalId
      });
      // A career-exit review can legitimately fan out to several commitments.
      for (const event of reviewEvents.slice(1)) {
        recordCandidateDecision({
          candidate,
          disposition: "planned_review",
          reasonCode: "SCHEDULED_OR_CHANGED_RESPONSIBILITY_REVIEW",
          proposalId: event.proposalId
        });
      }
      continue;
    }
    const relatedCommitmentIds = new Set([...reviewKeys]
      .map((key) => commitmentIdByResponsibilityKey.get(key))
      .filter((id): id is string => Boolean(id)));
    const reviewIssues = reviewPlan.issues.filter((reviewIssue) => (
      reviewIssue.relatedAccountIds.some((id) => relatedCommitmentIds.has(id))
    ));
    if (reviewIssues.length > 0) {
      recordCandidateDecision({
        candidate,
        disposition: reviewIssues.some((reviewIssue) => reviewIssue.severity === "blocking") ? "blocked" : "issue",
        reasonCode: "REVIEW_PLAN_ISSUE",
        issue: reviewIssues[0]
      });
      for (const reviewIssue of reviewIssues.slice(1)) {
        recordCandidateDecision({
          candidate,
          disposition: reviewIssue.severity === "blocking" ? "blocked" : "issue",
          reasonCode: "REVIEW_PLAN_ISSUE",
          issue: reviewIssue
        });
      }
    } else {
      recordCandidateDecision({
        candidate,
        disposition: "ignored",
        reasonCode: "REVIEW_NOT_DUE_OR_ALREADY_CURRENT"
      });
    }
  }
  const reviewReasonCodes = [...new Set(issues.filter((item) => item.severity === "warning").map((item) => item.id))];
  return {
    proposals,
    reviewEvents: reviewPlan.events,
    issues,
    reviewReasonCodes,
    candidates: input.candidates,
    candidateDecisions: input.candidates.map((candidate) => candidateDecisionById.get(candidate.id)!),
    ignoredCandidateIds,
    wouldBlock: issues.some((item) => item.severity === "blocking" && item.status !== "resolved"),
    reviewPlan
  };
}

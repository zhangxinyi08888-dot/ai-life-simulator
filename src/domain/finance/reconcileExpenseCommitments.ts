import {
  estimateExpenseResponsibility,
  expenseReviewIntervalMonths,
  type ExpenseResponsibilityEstimateContext
} from "./expenseEstimationPolicyV2";
import {
  buildExpenseLifecycleReviewPlan,
  type ExpenseLifecycleReviewPlan
} from "./expenseLifecycleReview";
import {
  parentElderCareCoverageRole,
  type ParentElderCareCoverageRole
} from "./elderCareCoverage";
import type { FinancialNodeGateMode } from "../../config/financialGatePolicy";
import type {
  AcceptedFinancialEvent,
  ExpenseAmountBasis,
  ExpenseCommitmentV4,
  ExpenseIssueResolutionKind,
  ExpenseResponsibilityCandidate,
  FinancialEventProposal,
  FinancialEvidence,
  FinancialLedgerIssue,
  FinancialLedgerV4
} from "./types";
import { isExpenseCommitmentV4 } from "./types";
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
  expenseResolutionKind?: ExpenseIssueResolutionKind;
  expenseResponsibilityKey?: string;
}): FinancialLedgerIssue {
  return {
    id: input.id,
    code: input.code || "PENDING_FACT",
    severity: input.severity || "warning",
    status: "open",
    relatedProposalIds: input.relatedProposalIds || [],
    relatedAccountIds: input.relatedAccountIds || [],
    summary: input.summary,
    createdAtAgeInMonths: input.ageInMonths,
    ...(input.expenseResolutionKind ? { expenseResolutionKind: input.expenseResolutionKind } : {}),
    ...(input.expenseResponsibilityKey || input.candidate?.responsibilityKey
      ? { expenseResponsibilityKey: input.expenseResponsibilityKey || input.candidate?.responsibilityKey }
      : {})
  };
}

function activeByKey(ledger: FinancialLedgerV4, key: string): ExpenseCommitmentV4 | undefined {
  return ledger.expenseCommitments.find((commitment) => (
    commitment.responsibilityKey === key && commitment.status !== "ended"
  ));
}

function canonicalizeNarrativeParentHealthcareCandidate(input: {
  ledger: FinancialLedgerV4;
  candidate: ExpenseResponsibilityCandidate;
}): ExpenseResponsibilityCandidate {
  const { candidate } = input;
  if (candidate.source !== "narrative_supplement"
    || candidate.responsibilityKind !== "recurring_healthcare"
    || !candidate.responsibilityKey.startsWith("recurring_healthcare:")
    || activeByKey(input.ledger, candidate.responsibilityKey)) return candidate;
  const beneficiary = candidate.responsibilityKey.replace(/^recurring_healthcare:/u, "");
  // Reconcile only the generic parent aliases that the opening and clause
  // binding paths themselves emit. A different named/person id may represent
  // a genuinely separate obligation and needs an Accepted atomic split rather
  // than an eager alias guess at the ledger boundary.
  if (!["opening_parent", "parents", "parent", "person_parent_unspecified"].includes(beneficiary)) return candidate;
  const aggregateTargets = input.ledger.expenseCommitments.filter((commitment) => (
    commitment.status !== "ended"
    && commitment.responsibilityKind === "recurring_healthcare"
    && ["recurring_healthcare:opening_parent", "recurring_healthcare:parents"].includes(commitment.responsibilityKey)
  ));
  if (aggregateTargets.length !== 1) return candidate;
  const target = aggregateTargets[0];
  return {
    ...candidate,
    responsibilityKey: target.responsibilityKey,
    participantPersonIds: target.participantPersonIds?.length
      ? target.participantPersonIds
      : candidate.participantPersonIds,
    sourceBindingReasonCodes: [
      ...new Set([...(candidate.sourceBindingReasonCodes || []), "EXPENSE_PARENT_HEALTHCARE_EXISTING_AGGREGATE_REUSED"])
    ]
  };
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

/**
 * A completed shared residence is different from an unspecified shared care
 * arrangement.  If the narrative establishes that the protagonist is already
 * jointly responsible for a residence but does not state a monetary total,
 * V4 requires the typed housing responsibility to accrue at its contextual
 * policy base as `needs_review`.  This is not an inference that a joint fund
 * contribution (or a percentage of income) is rent: no gross amount, share
 * rate, or confirmed amount is copied into the commitment.
 */
function isAmountUnknownNarrativeSharedResidence(candidate: ExpenseResponsibilityCandidate): boolean {
  return candidate.source === "narrative_supplement"
    && candidate.responsibilityKey === "primary_residence:main"
    && candidate.responsibilityKind === "primary_residence"
    && candidate.proposedType === "housing"
    && candidate.action === "start"
    && candidate.completion === "completed"
    && candidate.cadence !== "one_off"
    && candidate.financialScope === "shared_household"
    && candidate.liability === "shared"
    && candidate.explicitMonthlyTotalWan === undefined
    && candidate.protagonistShareWan === undefined
    && candidate.shareRate === undefined;
}

/**
 * Narrative is supplementary evidence, not authority for a household share.
 * In particular, plural prose such as “我们轮流照护父母” may establish a
 * reviewable responsibility observation, but it does not establish the
 * protagonist's individual cash share.  A completed shared residence with no
 * stated total is the narrow exception above: it starts a policy-based
 * `needs_review` housing commitment instead of silently leaving the ledger at
 * the unrelated basic-living floor.  A stated shared total still needs a
 * mathematically checkable protagonist allocation; it must never be treated
 * as the protagonist's whole bill.
 */
function isUnsupportedNarrativeSharedResponsibility(candidate: ExpenseResponsibilityCandidate): boolean {
  if (candidate.source !== "narrative_supplement"
    || candidate.financialScope !== "shared_household"
    || candidate.liability !== "shared") return false;
  if (isAmountUnknownNarrativeSharedResidence(candidate)) return false;
  const total = candidate.explicitMonthlyTotalWan;
  const share = candidate.protagonistShareWan;
  const rate = candidate.shareRate;
  // Narrative may establish a reviewable shared account only when it gives a
  // mathematically checkable personal allocation. It remains needs_review,
  // never a known fact, but a stated 50/50 split is enough to avoid treating
  // the entire household total as either the protagonist's bill or zero.
  return !(Number.isFinite(total)
    && Number.isFinite(share)
    && Number.isFinite(rate)
    && (total || 0) > 0
    && (share || 0) > 0
    && (rate || 0) > 0
    && (rate || 0) <= 1
    && Math.abs(roundWan((total || 0) * (rate || 0)) - (share || 0)) <= 0.0001);
}

/**
 * Shared elder-care and healthcare are a stricter ownership boundary than an
 * ordinary shared residence. A collective care action can establish that a
 * responsibility needs review, but it cannot tell the personal ledger what
 * the protagonist pays. A direct Accepted fact, user fact, or narrative that
 * states the exact total and exact protagonist allocation is sufficient to
 * plan the allocation; a prose-only allocation remains `needs_review`, never
 * a known fact. Otherwise the result must remain an issue/review rather than
 * a policy-estimated cash outflow.
 *
 * `accepted_world_delta` is deliberately not enough here: WorldState can
 * establish that a family member needs care, but it does not own a financial
 * allocation. Direct Accepted financial events are processed before this
 * reconciler and retain their own validator/atomicity path.
 */
function lacksAcceptedSharedCareOrHealthcareShare(candidate: ExpenseResponsibilityCandidate): boolean {
  if (candidate.financialScope !== "shared_household"
    || candidate.liability !== "shared"
    || !["elder_care", "recurring_healthcare"].includes(candidate.responsibilityKind)) return false;
  const hasAllocationSource = candidate.source === "accepted_outcome"
    || candidate.source === "user_fact"
    || candidate.source === "narrative_supplement";
  const total = candidate.explicitMonthlyTotalWan;
  const share = candidate.protagonistShareWan;
  const shareRate = candidate.shareRate;
  const hasConsistentPositiveShare = Number.isFinite(total)
    && Number.isFinite(share)
    && Number.isFinite(shareRate)
    && (total || 0) > 0
    && (share || 0) > 0
    && (shareRate || 0) > 0
    && (shareRate || 0) <= 1
    && Math.abs(roundWan((total || 0) * (shareRate || 0)) - (share || 0)) <= 0.0001;
  const hasAuthoritativeEvidence = candidate.evidence.some((item) => (
    item.source === "accepted_simulation_outcome" || item.source === "user"
  ));
  // A narrative supplement with an exact mathematical allocation is allowed
  // to create a conservative `needs_review` commitment. Its source is still
  // not authoritative for `known` status (handled by sourceIsAccepted), while
  // an accepted WorldState observation never supplies a personal share.
  return !(hasAllocationSource
    && hasConsistentPositiveShare
    && (candidate.source === "narrative_supplement" || hasAuthoritativeEvidence));
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
  estimateContext?: Omit<ExpenseResponsibilityEstimateContext, "responsibilityKind" | "ageInMonths">;
}): ExistingCommitmentMutation | undefined {
  const { existing, candidate } = input;
  const nextAmount = actualShare(candidate);
  const hasExactAmount = nextAmount !== undefined;
  // This is the only estimate-refresh path for an existing responsibility.
  // It is deliberately much narrower than a periodic review: the account
  // must already be personal, active, and contextual/unknown; a newly
  // completed care-intensity fact must request it; and the current policy
  // must be strictly higher. Therefore age alone cannot create or mutate an
  // account, exact/last-known amounts cannot be overwritten, and no path can
  // lower a cash outflow.
  const policyUpliftRequested = candidate.policyEstimateAdjustment === "increase_only";
  const contextualElderCareUplift = policyUpliftRequested
    && candidate.action === "adjust"
    && candidate.completion === "completed"
    && candidate.cadence === "recurring_unknown"
    && candidate.liability === "protagonist"
    && candidate.financialScope === "personal"
    && candidate.nextStatus === undefined
    && candidate.changeReason === undefined
    && candidate.responsibilityKind === "elder_care"
    && candidate.responsibilityKey === existing.responsibilityKey
    && existing.responsibilityKind === "elder_care"
    && parentElderCareCoverageRole(existing) !== undefined
    && existing.status === "active"
    && existing.financialScope === "personal"
    && existing.factStatus === "needs_review"
    && existing.amountBasis === "contextual_estimate"
    && !hasExactAmount
    && candidate.shareRate === undefined
    && samePeople(candidate.participantPersonIds, existing.participantPersonIds)
    && candidateEvidenceIsNew(existing, candidate);
  // `increase_only` is code-owned planning metadata, not a generic way to
  // smuggle an ordinary expense mutation through the reconciliation layer.
  // An ineligible request may at most leave a review trace in the caller; it
  // cannot write an amount, status, scope, participant, or share change.
  if (policyUpliftRequested && !contextualElderCareUplift) return undefined;
  const policyUplift = contextualElderCareUplift
    ? estimateExpenseResponsibility({
      ...input.estimateContext,
      responsibilityKind: existing.responsibilityKind,
      ageInMonths: input.ageInMonths,
      careIntensity: "elevated"
    })
    : undefined;
  const upliftedMonthlyAmountWan = policyUplift
    && policyUplift.accrualMonthlyAmountWan > existing.monthlyAmountWan + 0.0001
    ? roundWan(policyUplift.accrualMonthlyAmountWan)
    : undefined;
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
  const amountChanged = hasExactAmount
    ? Math.abs(nextAmount - existing.monthlyAmountWan) > 0.0001
    : upliftedMonthlyAmountWan !== undefined;
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

  const nextMonthlyAmountWan = hasExactAmount
    ? roundWan(nextAmount)
    : upliftedMonthlyAmountWan ?? existing.monthlyAmountWan;
  const nextFactStatus = hasExactAmount
    ? acceptedAmount ? "known" : "needs_review"
    : (upliftedMonthlyAmountWan !== undefined || scopeChanged || participantsChanged || shareChanged)
      ? "needs_review"
      : existing.factStatus;
  const nextAccrualReviewStatus = nextFactStatus === "known"
    ? "normal"
    : (hasExactAmount || upliftedMonthlyAmountWan !== undefined || scopeChanged || participantsChanged || shareChanged)
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
      amountBasis: upliftedMonthlyAmountWan !== undefined
        ? "contextual_estimate"
        : hasExactAmount
        ? acceptedAmount
          ? candidate.shareRate !== undefined && candidate.explicitMonthlyTotalWan !== undefined
            ? "explicit_shared_amount"
            : "explicit_known"
          : "last_known"
        : existing.amountBasis,
      amountSourceIds: hasExactAmount
        ? [candidate.amountSourceId || `accepted:${candidate.id}`]
        : upliftedMonthlyAmountWan !== undefined
          ? [...new Set([
            ...existing.amountSourceIds,
            `${policyUplift!.policyId}@${policyUplift!.policyVersion}:contextual-uplift:${existing.responsibilityKey}`
          ])]
          : existing.amountSourceIds,
      plausibleMonthlyAmountRangeWan: upliftedMonthlyAmountWan !== undefined
        ? policyUplift!.plausibleRangeWan
        : existing.plausibleMonthlyAmountRangeWan,
      estimationPolicyId: upliftedMonthlyAmountWan !== undefined
        ? policyUplift!.policyId
        : existing.estimationPolicyId,
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
      nextReviewAtAgeInMonths: (acceptedAmount || upliftedMonthlyAmountWan !== undefined)
        ? input.ageInMonths + expenseReviewIntervalMonths(existing.responsibilityKind)
        : existing.nextReviewAtAgeInMonths,
      evidence: (() => {
        const evidence = appendCandidateEvidence(existing, candidate);
        if (upliftedMonthlyAmountWan === undefined) return evidence;
        const policyEvidence: FinancialEvidence = {
          source: "system_policy",
          reasonCode: "EXPENSE_CONTEXTUAL_UPLIFT_ELEVATED_CARE",
          excerpt: `已确认照护强度升级；${existing.responsibilityKey} 在 ${policyUplift!.policyId}@${policyUplift!.policyVersion} 下从 ${existing.monthlyAmountWan} 万/月上调为 ${upliftedMonthlyAmountWan} 万/月，金额仍待确认`,
          confidence: 1,
          financialScope: "personal"
        };
        if (!evidence.some((item) => sameEvidence(item, policyEvidence))) evidence.push(policyEvidence);
        return evidence;
      })()
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
    financialScope: input.candidate.financialScope,
    systemGenerated: reconciliationSystemGenerated(input.candidate)
  } as FinancialEventProposal;
}

/**
 * An accepted WorldState delta is already a validated fact in the authority
 * chain.  Keep its marker separate from prose supplement reconciliation so
 * the validator can accept the structured source without weakening ordinary
 * narrative evidence matching for all other lifecycle candidates.
 */
function reconciliationSystemGenerated(candidate: ExpenseResponsibilityCandidate): FinancialEventProposal["systemGenerated"] {
  if (candidate.policyEstimateAdjustment === "increase_only") return "expense_contextual_care_uplift";
  return candidate.source === "accepted_world_delta"
    ? "expense_world_delta_reconciliation"
    : "expense_responsibility_reconciliation";
}

function reviewIssue(input: {
  candidate: ExpenseResponsibilityCandidate;
  ageInMonths: number;
  summary: string;
  severity?: FinancialLedgerIssue["severity"];
  resolutionKind?: ExpenseIssueResolutionKind;
}): FinancialLedgerIssue {
  const { candidate } = input;
  return issue({
    id: `expense_responsibility_review_${candidate.responsibilityKey.replace(/[^a-zA-Z0-9:_-]/gu, "_")}`,
    summary: input.summary,
    ageInMonths: input.ageInMonths,
    candidate,
    severity: input.severity,
    expenseResolutionKind: input.resolutionKind,
    expenseResponsibilityKey: candidate.responsibilityKey
  });
}

/**
 * The clause binder is the sole materiality writer for narrative facts.  The
 * reconciler deliberately consumes that explicit flag rather than repeating
 * sentence-level regexes and drifting into a second, inconsistent severity
 * decision.  Legacy candidates stay review-only until they are migrated to
 * a bound source.
 */
function isMaterialUnknownNarrativeBinding(candidate: ExpenseResponsibilityCandidate): boolean {
  return candidate.source === "narrative_supplement"
    && Boolean(candidate.sourceFactBindingId)
    && candidate.sourceMateriality === "critical";
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

type ElderCareCoverageRole = ParentElderCareCoverageRole;

/**
 * The aggregate-parent coverage rule applies only to a parent-beneficiary
 * account. The protagonist's `elder_care:care_plan` stays independent.
 */
function elderCareCoverageRole(input: {
  responsibilityKind: ExpenseResponsibilityCandidate["responsibilityKind"] | ExpenseCommitmentV4["responsibilityKind"];
  responsibilityKey: string;
  participantPersonIds?: string[];
}): ElderCareCoverageRole | undefined {
  return parentElderCareCoverageRole(input);
}

function wouldCreateNewResponsibility(input: {
  candidate: ExpenseResponsibilityCandidate;
  existing?: ExpenseCommitmentV4;
}): boolean {
  if (input.existing || input.candidate.action === "end") return false;
  return !isCareerExitReview(input.candidate);
}

function activeElderCareCoverageOverlap(input: {
  ledger: FinancialLedgerV4;
  candidate: ExpenseResponsibilityCandidate;
  /** An Accepted same-node atomic split ends this aggregate before the candidate starts. */
  atomicallySplitAggregateCommitmentIds?: Set<string>;
}): ExpenseCommitmentV4 | undefined {
  const candidateRole = elderCareCoverageRole(input.candidate);
  if (!candidateRole) return undefined;
  return input.ledger.expenseCommitments.find((commitment) => (
    // A pause is a temporary accrual state, not an atomic split or end of the
    // responsibility. Allowing an individual account beside a paused
    // aggregate would create a latent double count the moment the aggregate
    // resumes.
    commitment.status !== "ended"
    && elderCareCoverageRole(commitment)
      && elderCareCoverageRole(commitment) !== candidateRole
    // An aggregate only stops covering its components within this Preview
    // when a direct Accepted `aggregate_atomically_split` end names this exact
    // commitment. A generic end or unrelated end does not make an individual
    // start safe.
    && !(elderCareCoverageRole(commitment) === "aggregate"
      && input.atomicallySplitAggregateCommitmentIds?.has(commitment.id))
  ));
}

/**
 * The lifecycle runs after direct Accepted expense facts have been selected
 * for this node. Those facts are not yet in `ledger`, so keep an explicit
 * Preview-local coverage index. It records direct aggregate/individual upserts
 * plus the only legal way an existing aggregate stops covering components: an
 * Accepted `aggregate_atomically_split` end of that exact account.
 */
interface AcceptedElderCareCoverageIndex {
  upserts: Array<{
    event: AcceptedFinancialEvent;
    responsibilityKey: string;
    role: ElderCareCoverageRole;
  }>;
  atomicallySplitAggregateCommitmentIds: Set<string>;
}

function acceptedElderCareCoverage(input: {
  event: AcceptedFinancialEvent;
  ledger: FinancialLedgerV4;
}): { responsibilityKey: string; role: ElderCareCoverageRole } | undefined {
  const responsibilityKey = responsibilityKeyFromAcceptedExpenseEvent(input);
  if (!responsibilityKey) return undefined;
  if (input.event.kind === "expense_commitment_started") {
    const event = input.event as AcceptedFinancialEvent<"expense_commitment_started">;
    if (!isExpenseCommitmentV4(event.payload)) return undefined;
    const role = elderCareCoverageRole(event.payload);
    return role ? { responsibilityKey, role } : undefined;
  }
  if (input.event.kind === "expense_commitment_adjusted") {
    const event = input.event as AcceptedFinancialEvent<"expense_commitment_adjusted">;
    if (!isExpenseCommitmentV4(event.payload.nextCommitment)) return undefined;
    const role = elderCareCoverageRole(event.payload.nextCommitment);
    return role ? { responsibilityKey, role } : undefined;
  }
  return undefined;
}

function acceptedAggregateAtomicSplitCommitmentId(input: {
  event: AcceptedFinancialEvent;
  ledger: FinancialLedgerV4;
}): string | undefined {
  if (input.event.kind !== "expense_commitment_ended") return undefined;
  const event = input.event as AcceptedFinancialEvent<"expense_commitment_ended">;
  const commitment = input.ledger.expenseCommitments.find((item) => item.id === event.payload.expenseCommitmentId);
  if (!commitment || elderCareCoverageRole(commitment) !== "aggregate") return undefined;
  return event.payload.previousCommitmentId === commitment.id
    && event.payload.changeReason === "aggregate_atomically_split"
    ? commitment.id
    : undefined;
}

function acceptedElderCareCoverageIndex(input: {
  events: AcceptedFinancialEvent[] | undefined;
  ledger: FinancialLedgerV4;
}): AcceptedElderCareCoverageIndex {
  const index: AcceptedElderCareCoverageIndex = {
    upserts: [],
    atomicallySplitAggregateCommitmentIds: new Set<string>()
  };
  for (const event of input.events || []) {
    const atomicSplitCommitmentId = acceptedAggregateAtomicSplitCommitmentId({ event, ledger: input.ledger });
    if (atomicSplitCommitmentId) {
      index.atomicallySplitAggregateCommitmentIds.add(atomicSplitCommitmentId);
      continue;
    }
    if (event.kind === "expense_commitment_ended") continue;
    const coverage = acceptedElderCareCoverage({ event, ledger: input.ledger });
    if (coverage) index.upserts.push({ event, ...coverage });
  }
  return index;
}

function acceptedElderCareCoverageOverlap(input: {
  index: AcceptedElderCareCoverageIndex;
  candidate: ExpenseResponsibilityCandidate;
}): { event: AcceptedFinancialEvent; responsibilityKey: string } | undefined {
  const candidateRole = elderCareCoverageRole(input.candidate);
  if (!candidateRole) return undefined;
  const overlap = input.index.upserts.find((item) => item.role !== candidateRole);
  return overlap ? { event: overlap.event, responsibilityKey: overlap.responsibilityKey } : undefined;
}

function elderCareCoverageOverlapIssue(input: {
  candidate: ExpenseResponsibilityCandidate;
  ageInMonths: number;
  activeCommitment?: ExpenseCommitmentV4;
  pendingCandidate?: ExpenseResponsibilityCandidate;
  acceptedEvent?: AcceptedFinancialEvent;
  acceptedResponsibilityKey?: string;
}): FinancialLedgerIssue {
  const counterpart = input.activeCommitment?.responsibilityKey
    || input.pendingCandidate?.responsibilityKey
    || input.acceptedResponsibilityKey
    || "elder_care:parents";
  const counterpartId = input.activeCommitment?.id
    || input.acceptedEvent?.id
    || `pending_${input.pendingCandidate?.id || "unknown"}`;
  return issue({
    id: `expense_elder_care_overlap_${counterpartId}_${input.candidate.responsibilityKey.replace(/[^a-zA-Z0-9:_-]/gu, "_")}`,
    code: "EXPENSE_DUPLICATE_RESPONSIBILITY",
    summary: `父母聚合照护与个人照护账户覆盖可能重叠：${counterpart} 和 ${input.candidate.responsibilityKey} 不能并行计提；保留已接受责任并触发复核，等待 Accepted 原子拆分或覆盖关系确认`,
    ageInMonths: input.ageInMonths,
    candidate: input.candidate,
    relatedAccountIds: input.activeCommitment ? [input.activeCommitment.id] : [],
    relatedProposalIds: input.acceptedEvent ? [input.acceptedEvent.proposalId || input.acceptedEvent.id] : []
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
  // Candidates originate outside this reducer.  Keep malformed model output
  // on the normal blocking/repair path instead of allowing an absent evidence
  // array to throw a raw TypeError before the acceptance gate can record it.
  const malformedEvidenceCandidateIds = new Set(input.candidates
    .filter((candidate) => !Array.isArray(candidate.evidence))
    .map((candidate) => candidate.id));
  const candidates = input.candidates.map((candidate) => ({
    ...candidate,
    evidence: Array.isArray(candidate.evidence) ? candidate.evidence : []
  }));
  const proposals: FinancialEventProposal[] = [];
  const issues: FinancialLedgerIssue[] = [];
  const ignoredCandidateIds: string[] = [];
  const candidateDecisionById = new Map<string, ExpenseCommitmentReconciliationCandidateDecision>(
    candidates.map((candidate) => [candidate.id, {
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
  const acceptedElderCareCoverage = acceptedElderCareCoverageIndex({
    events: input.acceptedExpenseEvents,
    ledger: input.ledger
  });
  const acceptedExpenseCommitmentIds = new Set(input.ledger.expenseCommitments
    .filter((commitment) => acceptedExpenseKeys.has(commitment.responsibilityKey))
    .map((commitment) => commitment.id));
  const reportedAggregateComponentKeys = new Set<string>();
  const aggregateWithUnknownCoverage = activeUnknownCoverageAggregate(input.ledger);
  const plannedElderCareStarts = new Map<ElderCareCoverageRole, ExpenseResponsibilityCandidate>();
  const rememberPlannedElderCareStart = (candidate: ExpenseResponsibilityCandidate) => {
    const role = elderCareCoverageRole(candidate);
    if (role) plannedElderCareStarts.set(role, candidate);
  };
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
  for (const sourceCandidate of candidates) {
    const candidate = canonicalizeNarrativeParentHealthcareCandidate({
      ledger: input.ledger,
      candidate: sourceCandidate
    });
    if (malformedEvidenceCandidateIds.has(candidate.id)) {
      const malformedEvidenceIssue = issue({
        id: `expense_candidate_missing_evidence_${candidate.id}`,
        code: "EXPENSE_SCHEMA_FIELD_MISMATCH",
        severity: "blocking",
        summary: `支出责任候选 ${candidate.responsibilityKey} 缺少 evidence 数组，不能生成或修改持续支出`,
        ageInMonths: input.ageInMonths,
        candidate
      });
      issues.push(malformedEvidenceIssue);
      recordCandidateDecision({
        candidate,
        disposition: "blocked",
        reasonCode: "MISSING_CANDIDATE_EVIDENCE",
        issue: malformedEvidenceIssue
      });
      continue;
    }
    // Do this before any lifecycle issue/review work. A direct Accepted fact
    // is not a second candidate to reconcile; letting a deterministic plan
    // touch it would either duplicate accrual or overwrite the direct amount.
    if (acceptedExpenseKeys.has(sourceCandidate.responsibilityKey)
      || acceptedExpenseKeys.has(candidate.responsibilityKey)) {
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
    if (isUnsupportedNarrativeSharedResponsibility(candidate)) {
      const hasMaterialSharedTotal = Number.isFinite(candidate.explicitMonthlyTotalWan)
        && (candidate.explicitMonthlyTotalWan || 0) > 0;
      const isCriticalBinding = isMaterialUnknownNarrativeBinding(candidate);
      const unsupportedSharedNarrativeIssue = issue({
        id: `expense_shared_narrative_requires_accepted_share_${candidate.id}`,
        code: "EXPENSE_RESPONSIBILITY_SCOPE_CONFLICT",
        // A stated household total is material cash-flow evidence. Until the
        // text gives an exact protagonist allocation it must regenerate in
        // enforced mode; accepting it as a mere review would silently retain
        // the old, too-low expense baseline for the whole period.
        severity: hasMaterialSharedTotal || isCriticalBinding ? "blocking" : "warning",
        summary: `叙事仅表明共同责任 ${candidate.responsibilityKey}，未提供 Accepted 的主角个人承担额；不得以策略估算创建 shared_household active commitment`,
        ageInMonths: input.ageInMonths,
        candidate,
        expenseResolutionKind: "shared_allocation",
        expenseResponsibilityKey: candidate.responsibilityKey
      });
      issues.push(unsupportedSharedNarrativeIssue);
      recordCandidateDecision({
        candidate,
        disposition: hasMaterialSharedTotal || isCriticalBinding ? "blocked" : "issue",
        reasonCode: candidate.sourceBindingReasonCodes?.find((code) => (
          code === "EXPENSE_SHARED_PROTAGONIST_SHARE_UNRESOLVED"
        )) || "NARRATIVE_SHARED_AMOUNT_REQUIRES_ACCEPTED_FACT",
        issue: unsupportedSharedNarrativeIssue
      });
      continue;
    }
    if (lacksAcceptedSharedCareOrHealthcareShare(candidate)) {
      const isCriticalBinding = isMaterialUnknownNarrativeBinding(candidate);
      const sharedCareOwnershipIssue = issue({
        id: `expense_shared_care_requires_accepted_share_${candidate.id}`,
        code: "EXPENSE_RESPONSIBILITY_SCOPE_CONFLICT",
        severity: isCriticalBinding ? "blocking" : "warning",
        summary: `共同责任 ${candidate.responsibilityKey} 未提供权威、可核算的主角月承担额；仅保留复核/issue，不能以估算方式创建、调整或结束个人持续支出`,
        ageInMonths: input.ageInMonths,
        candidate,
        expenseResolutionKind: "shared_allocation",
        expenseResponsibilityKey: candidate.responsibilityKey
      });
      issues.push(sharedCareOwnershipIssue);
      recordCandidateDecision({
        candidate,
        disposition: isCriticalBinding ? "blocked" : "issue",
        reasonCode: candidate.sourceBindingReasonCodes?.find((code) => (
          code === "EXPENSE_SHARED_PROTAGONIST_SHARE_UNRESOLVED"
        )) || "SHARED_CARE_REQUIRES_ACCEPTED_PROTAGONIST_SHARE",
        issue: sharedCareOwnershipIssue
      });
      continue;
    }
    if (candidate.liability === "unknown") {
      const critical = isMaterialUnknownNarrativeBinding(candidate);
      const unresolvedLiabilityIssue = reviewIssue({
        candidate,
        ageInMonths: input.ageInMonths,
        severity: critical ? "blocking" : "warning",
        resolutionKind: "payer_scope",
        summary: critical
          ? `持续现金流 ${candidate.responsibilityKey} 已有明确金额/频率但付款人或范围未绑定；必须在本轮补齐，不能静默推进时间或收入`
          : `责任 ${candidate.responsibilityKey} 已出现，但主角是否承担尚未确认；不得从个人现金自动扣款`
      });
      issues.push(unresolvedLiabilityIssue);
      recordCandidateDecision({
        candidate,
        disposition: critical ? "blocked" : "issue",
        reasonCode: candidate.sourceBindingReasonCodes?.find((code) => (
          code === "EXPENSE_COMPLETED_RECURRING_PAYER_UNRESOLVED"
            || code === "EXPENSE_COMPLETED_RECURRING_SCOPE_CONFLICT"
        )) || "LIABILITY_UNKNOWN_REVIEW_REQUIRED",
        issue: unresolvedLiabilityIssue
      });
      continue;
    }
    const existing = activeByKey(input.ledger, candidate.responsibilityKey);
    if (candidate.policyEstimateAdjustment === "increase_only" && !existing) {
      // An intensity uplift may refine only an account whose responsibility
      // was already accepted. It must never become a back door for age or
      // narrative severity to create a new personal commitment.
      recordCandidateDecision({
        candidate,
        disposition: "ignored",
        reasonCode: "CONTEXTUAL_UPLIFT_TARGET_NOT_ACTIVE"
      });
      continue;
    }
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
    // An aggregate parent-care account and a named parent-care account cover
    // potentially the same obligation. Never open a second accrual account
    // on either side of that boundary: review the existing one and leave an
    // auditable overlap issue until an Accepted atomic split resolves it.
    if (wouldCreateNewResponsibility({ candidate, existing })) {
      const acceptedOverlap = acceptedElderCareCoverageOverlap({
        index: acceptedElderCareCoverage,
        candidate
      });
      if (acceptedOverlap) {
        const overlapIssue = elderCareCoverageOverlapIssue({
          candidate,
          ageInMonths: input.ageInMonths,
          acceptedEvent: acceptedOverlap.event,
          acceptedResponsibilityKey: acceptedOverlap.responsibilityKey
        });
        issues.push(overlapIssue);
        recordCandidateDecision({
          candidate,
          disposition: "issue",
          reasonCode: "DIRECT_ACCEPTED_ELDER_CARE_AGGREGATE_INDIVIDUAL_OVERLAP",
          issue: overlapIssue
        });
        continue;
      }
      const activeOverlap = activeElderCareCoverageOverlap({
        ledger: input.ledger,
        candidate,
        atomicallySplitAggregateCommitmentIds: acceptedElderCareCoverage.atomicallySplitAggregateCommitmentIds
      });
      if (activeOverlap) {
        queueReview(activeOverlap.responsibilityKey, candidate.evidence);
        const overlapIssue = elderCareCoverageOverlapIssue({
          candidate,
          ageInMonths: input.ageInMonths,
          activeCommitment: activeOverlap
        });
        issues.push(overlapIssue);
        recordCandidateDecision({
          candidate,
          disposition: "issue",
          reasonCode: "ELDER_CARE_AGGREGATE_INDIVIDUAL_OVERLAP",
          issue: overlapIssue
        });
        continue;
      }
      const role = elderCareCoverageRole(candidate);
      const pendingOverlap = role
        ? plannedElderCareStarts.get(role === "aggregate" ? "individual" : "aggregate")
        : undefined;
      if (pendingOverlap) {
        const overlapIssue = elderCareCoverageOverlapIssue({
          candidate,
          ageInMonths: input.ageInMonths,
          pendingCandidate: pendingOverlap
        });
        issues.push(overlapIssue);
        recordCandidateDecision({
          candidate,
          disposition: "issue",
          reasonCode: "ELDER_CARE_AGGREGATE_INDIVIDUAL_PENDING_OVERLAP",
          issue: overlapIssue
        });
        continue;
      }
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
          rememberPlannedElderCareStart(candidate);
          recordCandidateDecision({
            candidate,
            disposition: "planned_start",
            reasonCode: "REVIEW_CANDIDATE_REQUIRES_INITIAL_COMMITMENT",
            proposalId: proposal.id
          });
        }
      } else if (!existing) {
        const missingReviewTargetIssue = reviewIssue({
          candidate,
          ageInMonths: input.ageInMonths,
          resolutionKind: "exact_amount",
          summary: `关系或生活安排发生变化，需要复核 ${candidate.responsibilityKey}；没有金额事实时不创建泛化家庭消费桶`
        });
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
          financialScope: candidate.financialScope,
          systemGenerated: reconciliationSystemGenerated(candidate)
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
        ? mutationForExistingCandidate({
          existing,
          candidate,
          ageInMonths: input.ageInMonths,
          estimateContext: input.estimateContext
        })
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
          financialScope: candidate.financialScope,
          systemGenerated: reconciliationSystemGenerated(candidate)
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
    rememberPlannedElderCareStart(candidate);
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
  for (const candidate of candidates) {
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
    candidates,
    candidateDecisions: candidates.map((candidate) => candidateDecisionById.get(candidate.id)!),
    ignoredCandidateIds,
    wouldBlock: issues.some((item) => item.severity === "blocking" && item.status !== "resolved"),
    reviewPlan
  };
}

import type {
  AcceptedFinancialEvent,
  ExpenseCommitmentType,
  ExpenseCommitmentV4,
  ExpenseResponsibilityKind,
  FinancialEventProposal,
  FinancialLedgerIssue,
  FinancialLedgerV4
} from "./types";
import { bindNarrativeExpenseFacts, type NarrativeExpenseFactBinding, type TextSpan } from "./narrativeExpenseFactBinding";

/**
 * This module deliberately owns no ledger writes.  It verifies whether one
 * code-owned observation is sufficiently authoritative to let a later
 * integration build an `expense_commitment_started` or
 * `expense_commitment_adjusted` event.
 *
 * In particular, a model proposal cannot turn itself into a confirmation by
 * setting `factStatus: "known"`: the caller must first stamp the observation
 * with one of the authority sources below.
 */
export type ExpenseConfirmationAuthoritySourceKind =
  | "user_fact"
  | "direct_financial_proposal"
  | "accepted_world_delta"
  | "narrative_supplement"
  | "scheduled_review"
  | "system_policy"
  | "legacy_migration";

export type ExpenseConfirmationPayer = "protagonist" | "shared" | "third_party" | "unknown";
export type ExpenseConfirmationCadence = "monthly" | "annual";
export type ExpenseConfirmationStatementKind = "exact" | "estimate";

/** A contiguous UTF-16 span in the final, user-visible narrative. */
export interface FinalNarrativeExpenseEvidenceAnchor extends TextSpan {
  kind: "final_narrative_span";
  fingerprint: string;
}

/**
 * User facts may be accepted without being copied into the rendered prose.
 * The reference still has to name the exact accepted source and the fields
 * from which the code-owned observation was derived.
 */
export interface StructuredAcceptedExpenseFactRef {
  kind: "structured_accepted_fact";
  sourceKind: "user_fact" | "direct_financial_proposal" | "accepted_world_delta";
  sourceId: string;
  fieldPaths: string[];
  fingerprint: string;
}

export type ExpenseConfirmationEvidenceAnchor =
  | FinalNarrativeExpenseEvidenceAnchor
  | StructuredAcceptedExpenseFactRef;

/**
 * Non-persistent, code-stamped observation. Amounts are expressed in the
 * stated cadence; `validateExpenseConfirmation` normalizes them to a monthly
 * commitment amount only after it has verified that cadence against evidence.
 */
export interface ExpenseAmountObservation {
  id: string;
  authoritySourceKind: ExpenseConfirmationAuthoritySourceKind;
  authoritySourceId: string;
  sourceOutcomeId?: string;

  /** Required for an adjustment; omitted only for a genuinely new account. */
  expenseCommitmentId?: string;
  responsibilityKey: string;
  responsibilityKind: ExpenseResponsibilityKind;
  proposedType: ExpenseCommitmentType;
  statementKind: ExpenseConfirmationStatementKind;
  cadence: ExpenseConfirmationCadence;

  payer: ExpenseConfirmationPayer;
  financialScope: "personal" | "shared_household" | "business_operating" | "third_party";
  /** Personal amount in the stated cadence. Required for personal/shared confirmation. */
  protagonistAmountWan?: number;
  /** Household total in the stated cadence. Required for a shared confirmation. */
  grossAmountWan?: number;
  householdShareRate?: number;
  effectiveAtAgeInMonths: number;

  /**
   * A fresh code-generated ID for this exact amount fact. It must not be an
   * existing commitment's amount source ID, otherwise the observation is a
   * ledger echo rather than a new confirmation.
   */
  amountSourceId: string;
  evidenceFingerprint: string;
  /** Direct model proposals must point at their final-text binding. */
  bindingId?: string;
  evidenceAnchor: ExpenseConfirmationEvidenceAnchor;
}

export interface AcceptedAuthoritySnapshot {
  sourceNodeId: string;
  sourceOutcomeId: string;
  acceptedUserFactIds: string[];
  acceptedDirectProposalIds: string[];
  acceptedWorldDeltaIds: string[];
  periodStartAgeInMonths: number;
  periodEndAgeInMonths: number;
}

export type ExpenseConfirmationDisposition =
  | "not_confirmation"
  | "confirmed_exact"
  | "contextual_reprice"
  | "review_only"
  | "blocked";

/** A code-owned projection only; it is not a Financial Event payload. */
export interface CanonicalExpenseConfirmationFields {
  factStatus: "known";
  amountBasis: "explicit_known" | "explicit_shared_amount";
  monthlyAmountWan: number;
  confirmedMonthlyAmountWan: number;
  grossMonthlyAmountWan?: number;
  householdShareRate?: number;
  confirmedAtAgeInMonths: number;
}

export interface ExpenseConfirmationValidationResult {
  disposition: ExpenseConfirmationDisposition;
  observationId: string;
  proposalId: string;
  responsibilityKey: string;
  accountId?: string;
  matchedBindingId?: string;
  reasonCodes: string[];
  /** Existing issue IDs are copied only on a valid exact confirmation. */
  targetIssueIds: string[];
  resolutionKind?: "exact_amount" | "shared_allocation";
  canonicalConfirmation?: CanonicalExpenseConfirmationFields;
}

export interface ValidateExpenseConfirmationInput {
  observation: ExpenseAmountObservation;
  proposal: FinancialEventProposal;
  previousLedger: Pick<FinancialLedgerV4, "expenseCommitments">;
  currentAcceptedAuthority: AcceptedAuthoritySnapshot;
  finalNarrativeText: string;
  periodStartAgeInMonths: number;
  periodEndAgeInMonths: number;
  bindings: readonly NarrativeExpenseFactBinding[];
  /** Durable review issues the eventual same Accepted event must resolve. */
  targetIssueIds?: readonly string[];
}

interface ProposalCommitmentView {
  kind: "expense_commitment_started" | "expense_commitment_adjusted";
  accountId?: string;
  nextCommitment: Record<string, unknown>;
}

const NON_CONFIRMATION_SOURCES = new Set<ExpenseConfirmationAuthoritySourceKind>([
  "narrative_supplement",
  "scheduled_review",
  "system_policy",
  "legacy_migration"
]);
const APPROXIMATE_AMOUNT_PREFIX = /(?:约|大概|预算|预计)\s*$/u;
const APPROXIMATE_AMOUNT_SUFFIX = /^\s*左右/u;
const EPSILON = 0.0001;

function result(input: ValidateExpenseConfirmationInput, disposition: ExpenseConfirmationDisposition, reasonCodes: string[], extra: Partial<ExpenseConfirmationValidationResult> = {}): ExpenseConfirmationValidationResult {
  return {
    disposition,
    observationId: input.observation.id,
    proposalId: input.proposal.id,
    responsibilityKey: input.observation.responsibilityKey,
    reasonCodes,
    targetIssueIds: [],
    ...extra
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function finitePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function finiteShare(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function equalAmount(left: number | undefined, right: number | undefined): boolean {
  return left !== undefined && right !== undefined && Math.abs(left - right) <= EPSILON;
}

function toMonthly(amount: number, cadence: ExpenseConfirmationCadence): number {
  return cadence === "annual" ? amount / 12 : amount;
}

function proposalCommitmentView(proposal: FinancialEventProposal): ProposalCommitmentView | undefined {
  if (!isRecord(proposal.payload)) return undefined;
  if (proposal.kind === "expense_commitment_started") {
    return { kind: proposal.kind, nextCommitment: proposal.payload };
  }
  if (proposal.kind !== "expense_commitment_adjusted") return undefined;
  const accountId = proposal.payload.expenseCommitmentId;
  const nextCommitment = proposal.payload.nextCommitment;
  if (typeof accountId !== "string" || !isRecord(nextCommitment)) return undefined;
  return { kind: proposal.kind, accountId, nextCommitment };
}

function findExistingCommitment(input: ValidateExpenseConfirmationInput): {
  commitment?: ExpenseCommitmentV4;
  reasonCode?: string;
} {
  const { observation, previousLedger } = input;
  if (observation.expenseCommitmentId) {
    const commitment = previousLedger.expenseCommitments.find((item) => item.id === observation.expenseCommitmentId);
    return commitment ? { commitment } : { reasonCode: "EXPENSE_CONFIRMATION_ACCOUNT_MISSING" };
  }
  const matches = previousLedger.expenseCommitments.filter((item) => item.responsibilityKey === observation.responsibilityKey);
  if (matches.length === 0) return {};
  if (matches.length > 1) return { reasonCode: "EXPENSE_CONFIRMATION_ACCOUNT_AMBIGUOUS" };
  return { commitment: matches[0] };
}

function findBinding(input: ValidateExpenseConfirmationInput): {
  binding?: NarrativeExpenseFactBinding;
  reasonCode?: string;
} {
  const { observation, bindings } = input;
  if (!observation.bindingId) return {};
  const matches = bindings.filter((item) => item.id === observation.bindingId);
  if (matches.length === 0) return { reasonCode: "EXPENSE_CONFIRMATION_BINDING_MISSING" };
  if (matches.length > 1) return { reasonCode: "EXPENSE_CONFIRMATION_BINDING_AMBIGUOUS" };
  return { binding: matches[0] };
}

function bindingSpans(binding: NarrativeExpenseFactBinding): Array<TextSpan | undefined> {
  return [
    binding.responsibilitySpan,
    binding.completionSpan,
    binding.payerSpan,
    binding.amountSpan,
    binding.cadenceSpan
  ];
}

function sameSpan(left: TextSpan, right: TextSpan): boolean {
  return left.start === right.start && left.end === right.end && left.excerpt === right.excerpt;
}

function narrativeAnchorIsValid(input: ValidateExpenseConfirmationInput, binding: NarrativeExpenseFactBinding): string | undefined {
  const { evidenceAnchor, evidenceFingerprint } = input.observation;
  if (evidenceAnchor.kind !== "final_narrative_span") return "EXPENSE_CONFIRMATION_EVIDENCE_ANCHOR_KIND_INVALID";
  if (evidenceAnchor.fingerprint !== evidenceFingerprint || binding.evidenceFingerprint !== evidenceFingerprint) {
    return "EXPENSE_CONFIRMATION_EVIDENCE_FINGERPRINT_MISMATCH";
  }
  if (!Number.isInteger(evidenceAnchor.start)
    || !Number.isInteger(evidenceAnchor.end)
    || evidenceAnchor.start < 0
    || evidenceAnchor.end <= evidenceAnchor.start
    || evidenceAnchor.end > input.finalNarrativeText.length
    || input.finalNarrativeText.slice(evidenceAnchor.start, evidenceAnchor.end) !== evidenceAnchor.excerpt) {
    return "EXPENSE_CONFIRMATION_EVIDENCE_ANCHOR_INVALID";
  }
  if (!bindingSpans(binding).some((span) => span && sameSpan(span, evidenceAnchor))) {
    return "EXPENSE_CONFIRMATION_EVIDENCE_ANCHOR_NOT_BOUND";
  }
  const amountPrefix = input.finalNarrativeText.slice(Math.max(0, evidenceAnchor.start - 8), evidenceAnchor.start);
  const amountSuffix = input.finalNarrativeText.slice(evidenceAnchor.end, Math.min(input.finalNarrativeText.length, evidenceAnchor.end + 6));
  if (APPROXIMATE_AMOUNT_PREFIX.test(amountPrefix) || APPROXIMATE_AMOUNT_SUFFIX.test(amountSuffix)) {
    return "EXPENSE_CONFIRMATION_APPROXIMATE_AMOUNT";
  }
  return undefined;
}

function structuredAnchorIsValid(observation: ExpenseAmountObservation): string | undefined {
  const { evidenceAnchor } = observation;
  if (evidenceAnchor.kind !== "structured_accepted_fact") return "EXPENSE_CONFIRMATION_EVIDENCE_ANCHOR_KIND_INVALID";
  if (evidenceAnchor.sourceKind !== observation.authoritySourceKind
    || evidenceAnchor.sourceId !== observation.authoritySourceId
    || evidenceAnchor.fingerprint !== observation.evidenceFingerprint) {
    return "EXPENSE_CONFIRMATION_STRUCTURED_REF_MISMATCH";
  }
  const requiredFields = observation.financialScope === "shared_household"
    ? ["payer", "financialScope", "responsibilityKey", "cadence", "grossAmountWan", "protagonistAmountWan", "householdShareRate"]
    : ["payer", "financialScope", "responsibilityKey", "cadence", "protagonistAmountWan"];
  if (!requiredFields.every((field) => evidenceAnchor.fieldPaths.includes(field))) {
    return "EXPENSE_CONFIRMATION_STRUCTURED_REF_INCOMPLETE";
  }
  return undefined;
}

function expectedLiability(observation: ExpenseAmountObservation): "protagonist" | "shared" | undefined {
  if (observation.financialScope === "personal" && observation.payer === "protagonist") return "protagonist";
  if (observation.financialScope === "shared_household" && observation.payer === "shared") return "shared";
  return undefined;
}

function bindingAgainstObservation(binding: NarrativeExpenseFactBinding, observation: ExpenseAmountObservation): string | undefined {
  if (binding.sourceIdentityStatus !== "bound") return "EXPENSE_CONFIRMATION_BINDING_SOURCE_IDENTITY_MISSING";
  if (binding.responsibilityKey !== observation.responsibilityKey) return "EXPENSE_CONFIRMATION_RESPONSIBILITY_KEY_MISMATCH";
  if (binding.responsibilityKind !== observation.responsibilityKind) return "EXPENSE_CONFIRMATION_RESPONSIBILITY_KIND_MISMATCH";
  if (binding.proposedType !== observation.proposedType) return "EXPENSE_CONFIRMATION_TYPE_MISMATCH";
  if (binding.completion !== "completed" && binding.completion !== "ongoing") return "EXPENSE_CONFIRMATION_COMPLETION_NOT_ACCEPTED";
  const liability = expectedLiability(observation);
  if (!liability || binding.liability !== liability) return "EXPENSE_CONFIRMATION_PAYER_MISMATCH";
  if (binding.financialScope !== observation.financialScope) return "EXPENSE_CONFIRMATION_SCOPE_MISMATCH";
  if (binding.cadence !== observation.cadence) return "EXPENSE_CONFIRMATION_CADENCE_MISMATCH";

  const monthlyPersonalAmount = observation.protagonistAmountWan === undefined
    ? undefined
    : toMonthly(observation.protagonistAmountWan, observation.cadence);
  if (!finitePositive(monthlyPersonalAmount)) return "EXPENSE_CONFIRMATION_AMOUNT_INVALID";
  if (!equalAmount(binding.protagonistShareWan ?? binding.explicitMonthlyTotalWan, monthlyPersonalAmount)) {
    return "EXPENSE_CONFIRMATION_AMOUNT_MISMATCH";
  }
  if (observation.financialScope !== "shared_household") return undefined;
  const monthlyGrossAmount = observation.grossAmountWan === undefined
    ? undefined
    : toMonthly(observation.grossAmountWan, observation.cadence);
  if (!finitePositive(monthlyGrossAmount) || !finiteShare(observation.householdShareRate)) {
    return "EXPENSE_CONFIRMATION_SHARED_FIELDS_INCOMPLETE";
  }
  if (!equalAmount(binding.explicitMonthlyTotalWan, monthlyGrossAmount)
    || !equalAmount(binding.protagonistShareWan, monthlyPersonalAmount)
    || !equalAmount(binding.shareRate, observation.householdShareRate)
    || !equalAmount(monthlyPersonalAmount, monthlyGrossAmount * observation.householdShareRate)) {
    return "EXPENSE_CONFIRMATION_SHARE_MISMATCH";
  }
  return undefined;
}

function proposalAgainstObservation(view: ProposalCommitmentView, observation: ExpenseAmountObservation, existing?: ExpenseCommitmentV4): string | undefined {
  const next = view.nextCommitment;
  const monthlyAmount = observation.protagonistAmountWan === undefined
    ? undefined
    : toMonthly(observation.protagonistAmountWan, observation.cadence);
  if (!finitePositive(monthlyAmount)) return "EXPENSE_CONFIRMATION_AMOUNT_INVALID";
  if (typeof next.id !== "string"
    || next.responsibilityKey !== observation.responsibilityKey
    || next.responsibilityKind !== observation.responsibilityKind
    || next.type !== observation.proposedType) {
    return "EXPENSE_CONFIRMATION_PROPOSAL_IDENTITY_MISMATCH";
  }
  if (next.financialScope !== observation.financialScope) return "EXPENSE_CONFIRMATION_PROPOSAL_SCOPE_MISMATCH";
  if (!equalAmount(next.monthlyAmountWan as number | undefined, monthlyAmount)) return "EXPENSE_CONFIRMATION_PROPOSAL_AMOUNT_MISMATCH";
  if (existing) {
    if (view.kind !== "expense_commitment_adjusted" || view.accountId !== existing.id || next.id !== existing.id) {
      return "EXPENSE_CONFIRMATION_ACCOUNT_MISMATCH";
    }
    if (existing.status === "ended") return "EXPENSE_CONFIRMATION_ACCOUNT_ENDED";
    if (existing.responsibilityKey !== observation.responsibilityKey
      || existing.responsibilityKind !== observation.responsibilityKind
      || existing.type !== observation.proposedType) {
      return "EXPENSE_CONFIRMATION_EXISTING_IDENTITY_MISMATCH";
    }
    // This narrow first integration does not infer a household/person switch
    // from an amount fact. A later explicit responsibility change can widen
    // this rule with its own authority proof.
    if (existing.financialScope !== observation.financialScope) return "EXPENSE_CONFIRMATION_EXISTING_SCOPE_MISMATCH";
  } else if (view.kind !== "expense_commitment_started") {
    return "EXPENSE_CONFIRMATION_ACCOUNT_MISSING";
  }
  if (observation.financialScope !== "shared_household") return undefined;
  const monthlyGrossAmount = observation.grossAmountWan === undefined
    ? undefined
    : toMonthly(observation.grossAmountWan, observation.cadence);
  if (!finitePositive(monthlyGrossAmount) || !finiteShare(observation.householdShareRate)) {
    return "EXPENSE_CONFIRMATION_SHARED_FIELDS_INCOMPLETE";
  }
  if (!equalAmount(next.grossMonthlyAmountWan as number | undefined, monthlyGrossAmount)
    || !equalAmount(next.householdShareRate as number | undefined, observation.householdShareRate)
    || !equalAmount(monthlyAmount, monthlyGrossAmount * observation.householdShareRate)) {
    return "EXPENSE_CONFIRMATION_PROPOSAL_SHARE_MISMATCH";
  }
  return undefined;
}

function observationIsFresh(existing: ExpenseCommitmentV4 | undefined, observation: ExpenseAmountObservation): boolean {
  if (!existing) return true;
  return !existing.amountSourceIds.includes(observation.amountSourceId)
    && !existing.amountSourceIds.includes(observation.evidenceFingerprint)
    && !existing.amountSourceIds.includes(observation.authoritySourceId);
}

function authorityIsAccepted(observation: ExpenseAmountObservation, authority: AcceptedAuthoritySnapshot): string | undefined {
  if (observation.authoritySourceKind === "user_fact") {
    return authority.acceptedUserFactIds.includes(observation.authoritySourceId)
      ? undefined
      : "EXPENSE_CONFIRMATION_AUTHORITY_SOURCE_NOT_ACCEPTED";
  }
  if (observation.authoritySourceKind === "direct_financial_proposal") {
    if (!authority.acceptedDirectProposalIds.includes(observation.authoritySourceId)) {
      return "EXPENSE_CONFIRMATION_AUTHORITY_SOURCE_NOT_ACCEPTED";
    }
    return observation.sourceOutcomeId === authority.sourceOutcomeId
      ? undefined
      : "EXPENSE_CONFIRMATION_OUTCOME_MISMATCH";
  }
  return "EXPENSE_CONFIRMATION_NON_EXACT_AUTHORITY_SOURCE";
}

function currentPeriodIsValid(input: ValidateExpenseConfirmationInput): boolean {
  const { observation, currentAcceptedAuthority } = input;
  if (input.periodStartAgeInMonths !== currentAcceptedAuthority.periodStartAgeInMonths
    || input.periodEndAgeInMonths !== currentAcceptedAuthority.periodEndAgeInMonths) return false;
  return Number.isInteger(observation.effectiveAtAgeInMonths)
    && observation.effectiveAtAgeInMonths >= input.periodStartAgeInMonths
    && observation.effectiveAtAgeInMonths <= input.periodEndAgeInMonths
    && observation.effectiveAtAgeInMonths >= currentAcceptedAuthority.periodStartAgeInMonths
    && observation.effectiveAtAgeInMonths <= currentAcceptedAuthority.periodEndAgeInMonths;
}

/**
 * Validate one exact expense confirmation without mutating the ledger.
 *
 * `not_confirmation`, `review_only`, and `contextual_reprice` deliberately
 * carry no canonical fields or issue resolutions. Only `confirmed_exact` is
 * eligible for a later code-owned event canonicalizer.
 */
export function validateExpenseConfirmation(input: ValidateExpenseConfirmationInput): ExpenseConfirmationValidationResult {
  const { observation, proposal, currentAcceptedAuthority } = input;
  if (NON_CONFIRMATION_SOURCES.has(observation.authoritySourceKind)) {
    return result(input, "not_confirmation", ["EXPENSE_CONFIRMATION_NON_ACCEPTED_SOURCE"]);
  }
  if (proposal.systemGenerated) {
    return result(input, "not_confirmation", ["EXPENSE_CONFIRMATION_SYSTEM_GENERATED_SOURCE"]);
  }
  if (observation.statementKind === "estimate") {
    return result(input, "contextual_reprice", ["EXPENSE_CONFIRMATION_ESTIMATE_ONLY"]);
  }
  if (observation.authoritySourceKind === "accepted_world_delta") {
    return result(input, "review_only", ["EXPENSE_CONFIRMATION_WORLD_DELTA_NOT_EXACT_AUTHORITY"]);
  }
  const authorityIssue = authorityIsAccepted(observation, currentAcceptedAuthority);
  if (authorityIssue) return result(input, "blocked", [authorityIssue]);
  if (observation.authoritySourceKind === "direct_financial_proposal") {
    if (observation.authoritySourceId !== proposal.id || proposal.sourceOutcomeId !== currentAcceptedAuthority.sourceOutcomeId) {
      return result(input, "blocked", ["EXPENSE_CONFIRMATION_DIRECT_PROPOSAL_SOURCE_MISMATCH"]);
    }
    const anchorExcerpt = observation.evidenceAnchor.kind === "final_narrative_span"
      ? observation.evidenceAnchor.excerpt
      : "";
    if (!proposal.evidence.trim()
      || !anchorExcerpt
      || !input.finalNarrativeText.includes(anchorExcerpt)
      || !proposal.evidence.includes(anchorExcerpt)) {
      return result(input, "blocked", ["EXPENSE_CONFIRMATION_PROPOSAL_EVIDENCE_MISMATCH"]);
    }
  }
  if (!Number.isFinite(proposal.confidence) || proposal.confidence < 0.8) {
    return result(input, "blocked", ["EXPENSE_CONFIRMATION_CONFIDENCE_TOO_LOW"]);
  }
  if (!currentPeriodIsValid(input)) {
    return result(input, "blocked", ["EXPENSE_CONFIRMATION_EFFECTIVE_AT_OUT_OF_PERIOD"]);
  }
  if (proposal.effectiveAtAgeInMonths !== observation.effectiveAtAgeInMonths) {
    return result(input, "blocked", ["EXPENSE_CONFIRMATION_PROPOSAL_EFFECTIVE_AT_MISMATCH"]);
  }
  if (!expectedLiability(observation)) {
    return result(input, "blocked", ["EXPENSE_CONFIRMATION_PAYER_SCOPE_INVALID"]);
  }
  if (!observation.amountSourceId.trim() || !observation.evidenceFingerprint.trim()) {
    return result(input, "blocked", ["EXPENSE_CONFIRMATION_SOURCE_ID_MISSING"]);
  }

  const { commitment: existing, reasonCode: existingIssue } = findExistingCommitment(input);
  if (existingIssue) return result(input, "blocked", [existingIssue]);
  if (existing && observation.expenseCommitmentId !== existing.id) {
    return result(input, "blocked", ["EXPENSE_CONFIRMATION_ACCOUNT_MISMATCH"], { accountId: existing.id });
  }
  if (!observationIsFresh(existing, observation)) {
    return result(input, "blocked", ["EXPENSE_CONFIRMATION_LEDGER_ECHO"], { accountId: existing?.id });
  }

  const { binding, reasonCode: bindingIssue } = findBinding(input);
  if (bindingIssue) return result(input, "blocked", [bindingIssue], { accountId: existing?.id });
  if (observation.authoritySourceKind === "direct_financial_proposal" && !binding) {
    return result(input, "blocked", ["EXPENSE_CONFIRMATION_BINDING_REQUIRED"], { accountId: existing?.id });
  }
  if (binding) {
    if (binding.sourceNodeId !== currentAcceptedAuthority.sourceNodeId
      || binding.sourceOutcomeId !== currentAcceptedAuthority.sourceOutcomeId) {
      return result(input, "blocked", ["EXPENSE_CONFIRMATION_BINDING_AUTHORITY_MISMATCH"], { accountId: existing?.id });
    }
    const bindingIssue = bindingAgainstObservation(binding, observation);
    if (bindingIssue) return result(input, "blocked", [bindingIssue], { accountId: existing?.id, matchedBindingId: binding.id });
    const anchorIssue = narrativeAnchorIsValid(input, binding);
    if (anchorIssue) return result(input, "blocked", [anchorIssue], { accountId: existing?.id, matchedBindingId: binding.id });
  } else {
    const anchorIssue = structuredAnchorIsValid(observation);
    if (anchorIssue) return result(input, "blocked", [anchorIssue], { accountId: existing?.id });
  }

  const view = proposalCommitmentView(proposal);
  if (!view) return result(input, "blocked", ["EXPENSE_CONFIRMATION_PROPOSAL_KIND_INVALID"], { accountId: existing?.id, matchedBindingId: binding?.id });
  const proposalIssue = proposalAgainstObservation(view, observation, existing);
  if (proposalIssue) return result(input, "blocked", [proposalIssue], { accountId: existing?.id, matchedBindingId: binding?.id });

  const monthlyAmount = toMonthly(observation.protagonistAmountWan!, observation.cadence);
  const shared = observation.financialScope === "shared_household";
  const monthlyGrossAmount = shared ? toMonthly(observation.grossAmountWan!, observation.cadence) : undefined;
  const accountId = existing?.id || String(view.nextCommitment.id);
  return result(input, "confirmed_exact", ["EXPENSE_CONFIRMATION_ACCEPTED"], {
    accountId,
    matchedBindingId: binding?.id,
    targetIssueIds: [...new Set(input.targetIssueIds || [])],
    resolutionKind: shared ? "shared_allocation" : "exact_amount",
    canonicalConfirmation: {
      factStatus: "known",
      amountBasis: shared ? "explicit_shared_amount" : "explicit_known",
      monthlyAmountWan: monthlyAmount,
      confirmedMonthlyAmountWan: monthlyAmount,
      grossMonthlyAmountWan: monthlyGrossAmount,
      householdShareRate: shared ? observation.householdShareRate : undefined,
      confirmedAtAgeInMonths: observation.effectiveAtAgeInMonths
    }
  });
}

export interface FinalExpenseConfirmationVerification {
  eventId: string;
  valid: boolean;
  matchedBindingId?: string;
  reasonCodes: string[];
}

export interface ExpenseConfirmationAtomicityViolation {
  eventId: string;
  targetIssueId: string;
  reasonCodes: string[];
}

/**
 * A confirmation that promises to resolve a typed review is atomic only when
 * the transaction Preview shows that exact issue resolved by that exact
 * Accepted event. Matching an account or changing its amount is insufficient.
 */
export function validateExpenseConfirmationAtomicity(input: {
  events: AcceptedFinancialEvent[];
  previewIssues: FinancialLedgerIssue[];
}): ExpenseConfirmationAtomicityViolation[] {
  const issueById = new Map(input.previewIssues.map((issue) => [issue.id, issue]));
  const violations: ExpenseConfirmationAtomicityViolation[] = [];
  for (const event of input.events) {
    const resolution = event.expenseConfirmationResolution;
    if (!resolution) continue;
    for (const targetIssueId of resolution.targetIssueIds) {
      const issue = issueById.get(targetIssueId);
      const reasonCodes: string[] = [];
      if (!issue) reasonCodes.push("EXPENSE_CONFIRMATION_TARGET_ISSUE_MISSING");
      else {
        if (issue.status !== "resolved") reasonCodes.push("EXPENSE_CONFIRMATION_TARGET_ISSUE_STILL_OPEN");
        if (issue.resolvedByEventId !== event.id) reasonCodes.push("EXPENSE_CONFIRMATION_TARGET_RESOLVED_BY_OTHER_EVENT");
      }
      if (reasonCodes.length > 0) violations.push({ eventId: event.id, targetIssueId, reasonCodes });
    }
  }
  return violations;
}

/**
 * Rebind a code-stamped exact event against the final user-visible prose.
 * Offsets may legitimately move after a sanitizer, so this verifier accepts
 * one unique fact with the same responsibility/payer/amount semantics; zero
 * or multiple matches invalidate the provisional confirmation before Gate.
 */
export function verifyAcceptedExpenseConfirmationAgainstFinalNarrative(input: {
  event: AcceptedFinancialEvent;
  finalNarrativeText: string;
  sourceNodeId: string;
  sourceOutcomeId: string;
}): FinalExpenseConfirmationVerification {
  const resolution = input.event.expenseConfirmationResolution;
  if (!resolution) return { eventId: input.event.id, valid: true, reasonCodes: [] };
  if (input.event.kind !== "expense_commitment_started" && input.event.kind !== "expense_commitment_adjusted") {
    return { eventId: input.event.id, valid: false, reasonCodes: ["EXPENSE_CONFIRMATION_EVENT_KIND_INVALID"] };
  }
  const commitment = input.event.kind === "expense_commitment_started"
    ? input.event.payload
    : input.event.payload.nextCommitment;
  const bindingResult = bindNarrativeExpenseFacts({
    sourceNodeId: input.sourceNodeId,
    sourceOutcomeId: input.sourceOutcomeId,
    narrativeText: input.finalNarrativeText
  });
  const matches = bindingResult.bindings.filter((binding) => {
    if (binding.responsibilityKey !== resolution.responsibilityKey
      || binding.responsibilityKind !== commitment.responsibilityKind
      || binding.proposedType !== commitment.type
      || binding.financialScope !== commitment.financialScope
      || binding.sourceIdentityStatus !== "bound"
      || !binding.amountSpan) return false;
    const amountPrefix = input.finalNarrativeText.slice(Math.max(0, binding.amountSpan.start - 8), binding.amountSpan.start);
    const amountSuffix = input.finalNarrativeText.slice(binding.amountSpan.end, Math.min(input.finalNarrativeText.length, binding.amountSpan.end + 6));
    if (APPROXIMATE_AMOUNT_PREFIX.test(amountPrefix) || APPROXIMATE_AMOUNT_SUFFIX.test(amountSuffix)) return false;
    if (!equalAmount(binding.protagonistShareWan ?? binding.explicitMonthlyTotalWan, commitment.monthlyAmountWan)) return false;
    if (commitment.financialScope !== "shared_household") return binding.liability === "protagonist";
    return binding.liability === "shared"
      && equalAmount(binding.explicitMonthlyTotalWan, commitment.grossMonthlyAmountWan)
      && equalAmount(binding.shareRate, commitment.householdShareRate)
      && equalAmount(commitment.monthlyAmountWan, (commitment.grossMonthlyAmountWan || 0) * (commitment.householdShareRate || 0));
  });
  if (matches.length !== 1) {
    return {
      eventId: input.event.id,
      valid: false,
      reasonCodes: [matches.length === 0
        ? "EXPENSE_CONFIRMATION_FINAL_BINDING_MISSING"
        : "EXPENSE_CONFIRMATION_FINAL_BINDING_AMBIGUOUS"]
    };
  }
  return {
    eventId: input.event.id,
    valid: true,
    matchedBindingId: matches[0].id,
    reasonCodes: ["EXPENSE_CONFIRMATION_FINAL_BINDING_VERIFIED"]
  };
}

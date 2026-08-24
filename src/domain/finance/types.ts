import type { EmploymentStatus, FinancialState, IncomeStability } from "../../types";

export type FinancialFactStatus = "known" | "estimated" | "unknown" | "needs_review";
export type FinancialFactSource =
  | "user"
  | "accepted_history"
  | "accepted_simulation_outcome"
  | "system_policy"
  | "legacy_migration";

/**
 * A fact may be relevant to the expense classifier without being admissible
 * to the protagonist's personal ledger.  V4 keeps that distinction explicit
 * so a workshop or a parent's own bill cannot silently become a personal
 * recurring commitment.
 */
export type FinancialScopeV4 =
  | "personal"
  | "shared_household"
  | "business_operating"
  | "third_party";

export interface FinancialEvidence {
  source: FinancialFactSource;
  sourceNodeId?: string;
  sourceEventId?: string;
  sourceChoiceId?: string;
  excerpt?: string;
  reasonCode: string;
  confidence: number;
  financialScope?: FinancialScopeV4;
}

export interface CashAccount {
  id: string;
  type: "cash" | "bank_deposit" | "short_term_reserve";
  balanceWan: number;
  status: "active" | "closed";
  factStatus: FinancialFactStatus;
  evidence: FinancialEvidence[];
}

export type AssetType = "investment" | "property" | "annuity" | "insurance_cash_value" | "other_personal_asset";

export interface AssetAccount {
  id: string;
  type: AssetType;
  displayName: string;
  marketValueWan: number;
  plausibleMarketValueRangeWan?: [number, number];
  liquidity: "liquid" | "semi_liquid" | "illiquid";
  status: "active" | "disposed";
  factStatus: FinancialFactStatus;
  openedAtAgeInMonths: number;
  closedAtAgeInMonths?: number;
  evidence: FinancialEvidence[];
}

export type IncomeSourceType =
  | "salary"
  | "contract"
  | "self_employment_draw"
  | "rent"
  | "pension"
  | "annuity_payment"
  | "royalty"
  | "investment_distribution"
  | "business_dividend"
  | "family_support"
  | "other";

export interface IncomeSource {
  id: string;
  type: IncomeSourceType;
  displayName: string;
  monthlyNetAmountWan?: number;
  annualNetAmountWan?: number;
  accrualPolicy: "monthly" | "annual" | "event_only";
  activeFromAgeInMonths: number;
  activeUntilAgeInMonths?: number;
  status: "active" | "paused" | "ended";
  linkedCareerStateId?: string;
  linkedAssetAccountId?: string;
  linkedBusinessHoldingId?: string;
  factStatus: FinancialFactStatus;
  accrualReviewStatus?: "normal" | "quarantined";
  lastConfirmedAtAgeInMonths?: number;
  /** Latest accepted narrative evidence that the protagonist still performs this work. */
  employmentConfirmedAtAgeInMonths?: number;
  /** Auditable provenance for a deterministic role-based compensation estimate. */
  compensationEstimate?: CareerCompensationEstimate;
  evidence: FinancialEvidence[];
}

export type CareerOccupationFamily =
  | "software_engineering"
  | "design"
  | "product"
  | "management"
  | "consulting"
  | "education"
  | "sales_operations"
  | "general";

export type CareerCompensationStage =
  | "internship"
  | "entry"
  | "mid"
  | "senior"
  | "lead"
  | "manager"
  | "executive";

export type CareerEmploymentType = "internship" | "part_time" | "full_time" | "self_employed";

export interface CareerCompensationPolicyInputs {
  occupationFamily: CareerOccupationFamily;
  careerStage: CareerCompensationStage;
  employmentType: CareerEmploymentType;
  industryTier: "technology" | "professional_services" | "education" | "general";
  organizationTier: "top" | "large" | "small" | "unknown";
  regionTier: "tier_1" | "other" | "unknown";
  calendarYear: number;
}

export interface CareerCompensationEstimate {
  resolution: "estimated";
  policyId: "career_compensation_cn_v1";
  policyVersion: 1;
  monthlyNetRangeWan: [number, number];
  monthlyNetAmountWan: number;
  inputs: CareerCompensationPolicyInputs;
  confidence: number;
  effectiveAtAgeInMonths: number;
  reviewAtAgeInMonths: number;
  evidence: string;
}

export type ExpenseCommitmentType = "basic_living" | "housing" | "dependent_support" | "education" | "healthcare" | "insurance" | "other";

export type ExpenseResponsibilityKind =
  | "adult_basic_living"
  | "unclassified_core_consumption"
  | "primary_residence"
  | "child_support"
  | "elder_care"
  | "recurring_healthcare"
  | "personal_insurance"
  | "continuing_education"
  | "legacy_aggregate";

export type ExpenseAmountBasis =
  | "explicit_known"
  | "explicit_shared_amount"
  | "last_known"
  | "contextual_estimate"
  | "policy_floor"
  | "legacy_estimate";

/**
 * The auditable authority for a lower recurring expense, an end, or a
 * temporary pause.  These are deliberately about a changed responsibility,
 * never about cash pressure, employment status, elapsed time, or a policy
 * version.  Those facts may trigger a review, but cannot remove cashflow.
 */
export type ExpenseCommitmentChangeReason =
  | "residence_ended"
  | "shared_responsibility_changed"
  | "explicit_amount_reduced"
  /** A new Accepted exact fact replaces a previously policy/context/legacy estimate. */
  | "estimate_superseded_by_exact_fact"
  | "dependent_independent"
  | "care_responsibility_transferred"
  | "care_recipient_deceased"
  | "treatment_completed"
  | "insurance_cancelled"
  | "education_completed"
  | "aggregate_atomically_split"
  | "aggregate_residual_reallocated"
  | "temporary_third_party_coverage"
  | "responsibility_resumed"
  | "responsibility_ended";

export interface ExpenseCommitment {
  id: string;
  type: ExpenseCommitmentType;
  displayName: string;
  monthlyAmountWan: number;
  activeFromAgeInMonths: number;
  activeUntilAgeInMonths?: number;
  status: "active" | "paused" | "ended";
  factStatus: FinancialFactStatus;
  accrualReviewStatus?: "normal" | "conservative" | "review_due";
  evidence: FinancialEvidence[];

  /**
   * V4 fields stay optional on this compatibility shape so persisted V3
   * ledgers and their restore fixtures remain readable.  New committed V4
   * ledgers use ExpenseCommitmentV4 below, where every required field is
   * made non-optional and enforced by ledger invariants.
   */
  responsibilityKey?: string;
  responsibilityKind?: ExpenseResponsibilityKind;
  grossMonthlyAmountWan?: number;
  confirmedMonthlyAmountWan?: number;
  plausibleMonthlyAmountRangeWan?: [number, number];
  amountBasis?: ExpenseAmountBasis;
  amountSourceIds?: string[];
  estimationPolicyId?: string;
  financialScope?: FinancialScopeV4;
  participantPersonIds?: string[];
  householdShareRate?: number;
  lastConfirmedAtAgeInMonths?: number;
  lastReviewedAtAgeInMonths?: number;
  nextReviewAtAgeInMonths?: number;
}

/** Canonical recurring-expense record written by FinancialLedger v4 only. */
export interface ExpenseCommitmentV4 extends ExpenseCommitment {
  responsibilityKey: string;
  responsibilityKind: ExpenseResponsibilityKind;
  amountBasis: ExpenseAmountBasis;
  amountSourceIds: string[];
  financialScope: "personal" | "shared_household";
  accrualReviewStatus: "normal" | "conservative" | "review_due";
  nextReviewAtAgeInMonths: number;
}

export interface ExpenseResponsibilityCandidate {
  id: string;
  responsibilityKey: string;
  responsibilityKind: ExpenseResponsibilityKind;
  proposedType: ExpenseCommitmentType;
  action: "start" | "adjust" | "end" | "review";
  completion: "completed" | "ongoing" | "planned" | "hypothetical";
  cadence: "one_off" | "monthly" | "quarterly" | "annual" | "recurring_unknown";
  liability: "protagonist" | "shared" | "third_party" | "none" | "unknown";
  financialScope: FinancialScopeV4;
  explicitMonthlyTotalWan?: number;
  protagonistShareWan?: number;
  shareRate?: number;
  amountSourceId?: string;
  participantPersonIds: string[];
  /**
   * The accepted outcome named one parent role, but that role has not yet
   * resolved to an accepted PersonState identity. It is an owner/identity
   * review only and must not be widened to the aggregate `elder_care:parents`
   * account by a same-node narrative fallback.
   */
  identityResolutionRequired?: boolean;
  source: "user_fact" | "accepted_world_delta" | "accepted_outcome" | "narrative_supplement" | "scheduled_review";
  /** Required whenever this candidate pauses, lowers, or permanently ends an existing V4 responsibility. */
  changeReason?: ExpenseCommitmentChangeReason;
  /** `adjust` may temporarily pause or later resume an existing responsibility; starts and ends use their own states. */
  nextStatus?: "active" | "paused";
  /**
   * A newly accepted, higher-intensity responsibility observation can refresh
   * an existing contextual estimate upward. This is deliberately not an
   * amount fact: it never creates an account, confirms an amount, or lowers
   * an existing accrual. The reconciler may use it only for an active
   * `needs_review` contextual estimate of the same responsibility.
   */
  policyEstimateAdjustment?: "increase_only";
  /**
   * Non-persistent binding metadata. It is carried only from the narrative
   * clause binder through reconciliation/gate telemetry; it never contributes
   * to account identity or ledger math.
   */
  sourceFactBindingId?: string;
  sourceSpans?: {
    responsibility: ExpenseNarrativeTextSpan;
    completion?: ExpenseNarrativeTextSpan;
    payer?: ExpenseNarrativeTextSpan;
    amount?: ExpenseNarrativeTextSpan;
    cadence?: ExpenseNarrativeTextSpan;
  };
  sourceClause?: {
    clauseId: string;
    contextClauseIds: string[];
    sentenceIndex: number;
    clauseIndex: number;
  };
  sourceBindingDisposition?: "bound" | "owner_review" | "ambiguous";
  sourceMateriality?: "nonmaterial" | "review" | "critical";
  unresolvedFields?: Array<"completion" | "payer" | "scope" | "amount" | "share" | "cadence">;
  sourceBindingReasonCodes?: string[];
  evidence: FinancialEvidence[];
}

/** A UTF-16 half-open span into one candidate narrative. */
export interface ExpenseNarrativeTextSpan {
  start: number;
  end: number;
  excerpt: string;
}

/** Which future Accepted fact is allowed to close a durable expense review. */
export type ExpenseIssueResolutionKind =
  | "exact_amount"
  | "payer_scope"
  | "shared_allocation"
  | "end_or_pause_authority"
  | "aggregate_split";

export type DebtType = "mortgage" | "consumer_loan" | "student_loan" | "credit_balance" | "business_personal_guarantee" | "family_or_personal_loan" | "liquidity_shortfall";

export interface DebtRepaymentPolicy {
  mode: "known_schedule" | "estimated_amortizing" | "event_driven";
  monthlyPaymentWan?: number;
  monthlyPrincipalWan?: number;
  monthlyInterestWan?: number;
  annualInterestRate?: number;
  remainingTermMonths?: number;
}

export type DebtOrigin = "explicit" | "system_auto_shortfall" | "legacy_migration";

export type DebtServicingStatus = "current" | "partial" | "missed" | "delinquent";

export interface DebtServiceRecord {
  id: string;
  debtAccountId: string;
  ageInMonths: number;
  interestDueWan: number;
  /** Interest newly accrued in this month; excludes carried unpaid interest. */
  currentInterestAccruedWan?: number;
  interestPaidWan: number;
  interestUnpaidWan: number;
  principalDueWan: number;
  principalPaidWan: number;
  principalUnpaidWan: number;
  outcome: "paid" | "partial" | "missed";
  reasonCodes: Array<
    | "PAID_AS_SCHEDULED"
    | "PARTIAL_PAYMENT"
    | "DEBT_PAYMENT_MISSED"
    | "INSUFFICIENT_CASH_AFTER_ESSENTIALS"
  >;
}

export interface DebtAccount {
  id: string;
  type: DebtType;
  displayName: string;
  principalWan: number;
  openedAtAgeInMonths: number;
  closedAtAgeInMonths?: number;
  status: "active" | "repaid" | "restructured" | "defaulted";
  repaymentPolicy: DebtRepaymentPolicy;
  factStatus: FinancialFactStatus;
  evidence: FinancialEvidence[];
  /**
   * These fields are present on every canonical v3 ledger. They remain
   * optional at construction boundaries during the v2 rollout so existing
   * accepted proposal fixtures can be normalized in one place.
   */
  origin?: DebtOrigin;
  accruedUnpaidInterestWan?: number;
  servicingStatus?: DebtServicingStatus;
  consecutiveMissedPaymentMonths?: number;
  totalMissedPaymentMonths?: number;
  recentMissedPaymentAgeInMonths?: number[];
  lastPaymentAtAgeInMonths?: number;
  lastMissedPaymentAtAgeInMonths?: number;
  lastPrincipalIncreaseAtAgeInMonths?: number;
}

/** Frozen persisted debt shape written by FinancialLedger v2. */
export interface DebtAccountV2 {
  id: string;
  type: DebtType;
  displayName: string;
  principalWan: number;
  openedAtAgeInMonths: number;
  closedAtAgeInMonths?: number;
  status: "active" | "repaid" | "restructured" | "defaulted";
  repaymentPolicy: DebtRepaymentPolicy;
  factStatus: FinancialFactStatus;
  evidence: FinancialEvidence[];
}

export interface BusinessEntityRef {
  id: string;
  displayName: string;
  latestPostMoneyValuationWan?: number;
  valuationAsOfAgeInMonths?: number;
  latestFinancingAmountWan?: number;
  financingAsOfAgeInMonths?: number;
  status: "operating" | "exited" | "closed" | "unknown";
  factStatus: FinancialFactStatus;
  evidence: FinancialEvidence[];
}

export interface BusinessHolding {
  id: string;
  business: BusinessEntityRef;
  /** Defaults to equity for ledgers created before option lifecycle support. */
  instrumentType?: "equity" | "stock_option";
  ownershipRate?: number;
  attributableValueWan?: number;
  liquidityDiscountRate?: number;
  optionTerms?: {
    grantedUnits: number;
    vestedUnits: number;
    exercisedUnits: number;
    strikePriceWanPerUnit: number;
    grantedAtAgeInMonths?: number;
    vestingPolicy?: {
      totalMonths: number;
      cliffMonths?: number;
      frequencyMonths?: number;
    };
    fairValueWanPerUnit?: number;
    realizationRiskDiscountRate?: number;
    expiresAtAgeInMonths?: number;
  };
  personalCarryingValueWan: number;
  status: "active" | "partially_sold" | "sold" | "written_off" | "exercised" | "expired" | "cancelled";
  factStatus: FinancialFactStatus;
  evidence: FinancialEvidence[];
}

export interface FinancialLedgerIssue {
  id: string;
  code:
    | "MISSING_FUNDING_SOURCE"
    | "UNRESOLVED_FUNDING_GAP"
    | "UNBALANCED_TRANSACTION"
    | "CAREER_INCOME_CONFLICT"
    | "BUSINESS_PERSONAL_BOUNDARY_CONFLICT"
    | "UNKNOWN_DEBT_SCHEDULE"
    | "UNSUPPORTED_LARGE_VALUE_CHANGE"
    | "ACCOUNT_TYPE_MISMATCH"
    | "LEGACY_UNCERTAINTY"
    | "PENDING_FACT"
    | "DEBT_PAYMENT_MISSED"
    | "DEBT_PAYMENT_DELINQUENT"
    | "LIQUIDITY_SHORTFALL_PERSISTED"
    | "MODEL_OPENING_BALANCE_IGNORED"
    | "CAREER_STATE_STALE"
    | "INVALID_ASSET_TYPE"
    | "EXPENSE_BASELINE_DOWNWARD_OVERWRITE"
    | "EXPENSE_RESPONSIBILITY_SCOPE_CONFLICT"
    | "EXPENSE_BUSINESS_FLOW_IN_PERSONAL_LEDGER"
    | "EXPENSE_THIRD_PARTY_LIABILITY"
    | "EXPENSE_UNKNOWN_ZERO_AMOUNT"
    | "EXPENSE_SHARED_AMOUNT_MISMATCH"
    | "EXPENSE_DUPLICATE_RESPONSIBILITY"
    | "EXPENSE_AGGREGATE_SPLIT_LOSS"
    | "EXPENSE_END_WITHOUT_EVIDENCE"
    | "EXPENSE_REVIEW_OVERDUE"
    | "EXPENSE_OPENING_COMPONENT_GAP"
    | "EXPENSE_MODEL_AGGREGATE_NOT_AUTHORITATIVE"
    | "EXPENSE_DEBT_SERVICE_DOUBLE_COUNT"
    | "EXPENSE_ESTIMATION_POLICY_MISSING"
    | "EXPENSE_AMOUNT_SOURCE_DOUBLE_COUNT"
    | "EXPENSE_DOWNWARD_WITHOUT_AUTHORITY"
    | "EXPENSE_CONFIRMATION_ATOMICITY_FAILED"
    | "EXPENSE_SCHEMA_FIELD_MISMATCH";
  severity: "warning" | "blocking";
  status?: "open" | "resolved";
  relatedProposalIds: string[];
  relatedAccountIds?: string[];
  relatedIncomeSourceIds?: string[];
  relatedDebtAccountIds?: string[];
  relatedBusinessHoldingIds?: string[];
  summary: string;
  createdAtAgeInMonths: number;
  lastObservedAtAgeInMonths?: number;
  occurrenceCount?: number;
  resolvedAtAgeInMonths?: number;
  resolvedByEventId?: string;
  /**
   * New V4 recurring-expense reviews record the missing-fact dimension so an
   * unrelated event touching the same account cannot close them.  Optional
   * for backward-compatible reading of historical ledgers.
   */
  expenseResolutionKind?: ExpenseIssueResolutionKind;
  expenseResponsibilityKey?: string;
  pendingFactPolicy?: "bounded_last_known_income";
}

interface FinancialLedgerCommon {
  id: string;
  owner: "protagonist";
  currencyUnit: "CNY_WAN_REAL";
  asOfAgeInMonths: number;
  cashAccounts: CashAccount[];
  assetAccounts: AssetAccount[];
  incomeSources: IncomeSource[];
  expenseCommitments: ExpenseCommitment[];
  businessHoldings: BusinessHolding[];
  recentTransactions: FinancialTransaction[];
  committedTransactionIds: string[];
  openingAcceptedEventIds?: string[];
  unresolvedIssues: FinancialLedgerIssue[];
  revision: number;
}

/** Frozen persisted input shape. It is read-only migration input, never output. */
export interface FinancialLedgerV2 extends FinancialLedgerCommon {
  debtAccounts: DebtAccountV2[];
  version: 2;
}

export interface FinancialLedgerV3 extends FinancialLedgerCommon {
  debtAccounts: DebtAccount[];
  version: 3;
}

/**
 * V4 makes the responsibility identity, amount basis, scope and review clock
 * mandatory for every committed recurring expense.  V3 remains a read-only
 * compatibility input until it is upgraded at the simulation boundary.
 */
export interface FinancialLedgerV4 extends Omit<FinancialLedgerCommon, "expenseCommitments"> {
  debtAccounts: DebtAccount[];
  expenseCommitments: ExpenseCommitmentV4[];
  version: 4;
}

export type FinancialLedgerInput = FinancialLedgerV2 | FinancialLedgerV3 | FinancialLedgerV4;
/**
 * The runtime boundary deliberately exposes the common commitment shape so
 * legacy financial arithmetic can read V3 and V4 histories without producing
 * array-union inference failures.  V4 writers must narrow with
 * isFinancialLedgerV4 (or accept FinancialLedgerV4 explicitly), which keeps
 * their strict ExpenseCommitmentV4 contract intact.
 */
export interface FinancialLedger extends FinancialLedgerCommon {
  debtAccounts: DebtAccount[];
  version: 3 | 4;
}

export function isFinancialLedgerV4(ledger: FinancialLedgerInput | FinancialLedger): ledger is FinancialLedgerV4 {
  return ledger.version === 4;
}

export function isExpenseCommitmentV4(commitment: unknown): commitment is ExpenseCommitmentV4 {
  if (!commitment || typeof commitment !== "object") return false;
  const candidate = commitment as Partial<ExpenseCommitmentV4>;
  return Boolean(
    candidate.responsibilityKey
    && candidate.responsibilityKind
    && candidate.amountBasis
    && Array.isArray(candidate.amountSourceIds)
    && candidate.financialScope
    && candidate.accrualReviewStatus
    && Number.isInteger(candidate.nextReviewAtAgeInMonths)
  );
}

export type FinancialEventKind =
  | "income_source_started"
  | "income_source_adjusted"
  | "income_source_paused"
  | "income_source_ended"
  | "one_off_income_received"
  | "expense_commitment_started"
  | "expense_commitment_adjusted"
  | "expense_commitment_ended"
  | "one_off_expense_paid"
  | "asset_purchased"
  | "asset_balance_discovered"
  | "asset_sold"
  | "asset_revalued"
  | "debt_drawn"
  | "debt_balance_discovered"
  | "debt_principal_repaid"
  | "debt_interest_paid"
  | "debt_restructured"
  | "debt_forgiven"
  | "debt_default_recorded"
  | "business_holding_started"
  | "business_financing_recorded"
  | "business_option_granted"
  | "business_option_vested"
  | "business_option_revalued"
  | "business_option_exercised"
  | "business_option_expired"
  | "business_option_cancelled"
  | "business_holding_revalued"
  | "business_distribution_received"
  | "business_holding_sold"
  | "family_support_received"
  | "family_support_paid"
  | "liquidity_shortfall_created";

export interface FinancialEventProposal {
  id: string;
  kind: FinancialEventKind;
  effectiveAtAgeInMonths: number;
  payload: unknown;
  evidence: string;
  sourceOutcomeId?: string;
  confidence: number;
  /** Whether the fact belongs to the protagonist's personal ledger or to company operations. */
  financialScope?: FinancialScopeV4;
  /**
   * Reserved for deterministic policy transitions created inside the domain,
   * never accepted from the model transport.  It lets a scheduled V4 review
   * use the same schema/validator/reducer path without pretending the review
   * text was narrated as a new financial fact.
   */
  systemGenerated?: "expense_lifecycle_review"
    | "expense_responsibility_reconciliation"
    /**
     * A tightly constrained, evidence-driven refinement of an existing
     * contextual parent-care estimate. It may only increase that same
     * active responsibility; the validator rejects every identity, scope,
     * status, or amount-basis change outside the dedicated contract.
     */
    | "expense_contextual_care_uplift"
    /**
     * Confirms only that one existing career-income relationship is still
     * active. It deliberately preserves an estimated amount instead of
     * turning "still working" prose into a newly known salary.
     */
    | "career_income_continuation_review"
    /**
     * A responsibility projection from an already accepted structured
     * WorldState delta. This is deliberately distinct from prose-derived
     * reconciliation: the accepted state, rather than a fresh narrative
     * string match, is its fact authority.
     */
    | "expense_world_delta_reconciliation";
}

/**
 * A model-authored financial fact surface bound to the Proposal that owns it.
 * The surface must be copied verbatim from the node narrative. Code can then
 * remove only rejected facts without guessing across the open prose space.
 */
export interface FinancialNarrativeClaim {
  id: string;
  proposalId: string;
  kind: FinancialEventKind;
  surfaceText: string;
}

export interface MoneyReceivedPayload {
  destinationCashAccountId: string;
  amountWan: number;
  incomeSourceId?: string;
}

export interface MoneyPaidPayload {
  sourceCashAccountId: string;
  amountWan: number;
  expenseCommitmentId?: string;
}

export interface AssetPurchasePayload {
  sourceCashAccountId: string;
  assetAccount: AssetAccount;
  cashPaidWan: number;
  transactionFeeWan: number;
  linkedDebtDrawEventId?: string;
}

/** A previously owned asset first becomes known in this period; no current-period cash flow. */
export interface AssetBalanceDiscoveredPayload {
  assetAccount: AssetAccount;
}

export interface AssetSalePayload {
  assetAccountId: string;
  destinationCashAccountId: string;
  assetValueRemovedWan: number;
  cashReceivedWan: number;
  transactionFeeWan: number;
}

export interface AssetRevaluationPayload {
  assetAccountId: string;
  previousMarketValueWan: number;
  newMarketValueWan: number;
  valuationEvidence: FinancialEvidence[];
}

export interface DebtDrawPayload {
  debtAccount: DebtAccount;
  destinationCashAccountId: string;
  principalDrawnWan: number;
}

/** A pre-existing liability first becomes known in this period; no current-period cash flow. */
export interface DebtBalanceDiscoveredPayload {
  debtAccount: DebtAccount;
}

export interface DebtPrincipalRepaymentPayload {
  debtAccountId: string;
  sourceCashAccountId: string;
  principalPaidWan: number;
}

export interface DebtInterestPaymentPayload {
  debtAccountId: string;
  sourceCashAccountId: string;
  interestPaidWan: number;
}

export interface DebtRestructuredPayload {
  oldDebtAccountId: string;
  replacementDebtAccount: DebtAccount;
  sourceCashAccountId?: string;
  transactionFeeWan: number;
  /** Portion of the old unpaid interest incorporated into replacement principal. */
  capitalizedInterestWan?: number;
}

export interface DebtForgivenPayload {
  debtAccountId: string;
  principalForgivenWan: number;
  accruedInterestForgivenWan?: number;
}

export interface DebtDefaultRecordedPayload {
  debtAccountId: string;
  reason: string;
}

export interface BusinessFinancingPayload {
  businessHoldingId: string;
  financingAmountWan: number;
  postMoneyValuationWan?: number;
  ownershipRateAfterFinancing?: number;
  personalCashReceivedWan: 0;
}

export interface BusinessHoldingStartedPayload {
  sourceCashAccountId: string;
  businessHolding: BusinessHolding;
  personalCashInvestedWan: number;
}

export interface BusinessHoldingRevaluationPayload {
  businessHoldingId: string;
  previousCarryingValueWan: number;
  newCarryingValueWan: number;
  postMoneyValuationWan?: number;
  ownershipRate?: number;
  valuationEvidence: FinancialEvidence[];
}

export interface BusinessOptionGrantPayload {
  optionHolding: BusinessHolding;
}

export interface BusinessOptionVestPayload {
  businessHoldingId: string;
  unitsVested: number;
}

export interface BusinessOptionRevaluationPayload {
  businessHoldingId: string;
  previousCarryingValueWan: number;
  fairValueWanPerUnit: number;
  liquidityDiscountRate: number;
  realizationRiskDiscountRate: number;
  newCarryingValueWan: number;
  valuationEvidence: FinancialEvidence[];
}

export interface BusinessOptionExercisePayload {
  businessHoldingId: string;
  unitsExercised: number;
  sourceCashAccountId: string;
  exerciseCostWan: number;
  resultingEquityHolding: BusinessHolding;
}

export interface BusinessOptionClosurePayload {
  businessHoldingId: string;
}

export interface BusinessDistributionPayload extends MoneyReceivedPayload {
  businessHoldingId: string;
}

export interface BusinessHoldingSalePayload {
  businessHoldingId: string;
  destinationCashAccountId: string;
  holdingValueRemovedWan: number;
  ownershipRateSold?: number;
  cashReceivedWan: number;
  transactionFeeWan: number;
}

export interface IncomeSourceMutationPayload {
  incomeSourceId: string;
  nextSource: IncomeSource;
}

export interface IncomeSourceStatusPayload {
  incomeSourceId: string;
}

export interface ExpenseCommitmentMutationPayload {
  expenseCommitmentId: string;
  /** Stable audit link for a lower/pause/resume mutation; equals expenseCommitmentId for an in-place V4 change. */
  previousCommitmentId?: string;
  changeReason?: ExpenseCommitmentChangeReason;
  nextCommitment: ExpenseCommitment;
}

export interface ExpenseCommitmentStatusPayload {
  expenseCommitmentId: string;
  /** Stable audit link for a permanent V4 end; equals expenseCommitmentId. */
  previousCommitmentId?: string;
  changeReason?: ExpenseCommitmentChangeReason;
}

export interface FinancialEventPayloadMap {
  income_source_started: IncomeSource;
  income_source_adjusted: IncomeSourceMutationPayload;
  income_source_paused: IncomeSourceStatusPayload;
  income_source_ended: IncomeSourceStatusPayload;
  one_off_income_received: MoneyReceivedPayload;
  expense_commitment_started: ExpenseCommitment;
  expense_commitment_adjusted: ExpenseCommitmentMutationPayload;
  expense_commitment_ended: ExpenseCommitmentStatusPayload;
  one_off_expense_paid: MoneyPaidPayload;
  asset_purchased: AssetPurchasePayload;
  asset_balance_discovered: AssetBalanceDiscoveredPayload;
  asset_sold: AssetSalePayload;
  asset_revalued: AssetRevaluationPayload;
  debt_drawn: DebtDrawPayload;
  debt_balance_discovered: DebtBalanceDiscoveredPayload;
  debt_principal_repaid: DebtPrincipalRepaymentPayload;
  debt_interest_paid: DebtInterestPaymentPayload;
  debt_restructured: DebtRestructuredPayload;
  debt_forgiven: DebtForgivenPayload;
  debt_default_recorded: DebtDefaultRecordedPayload;
  business_holding_started: BusinessHoldingStartedPayload;
  business_financing_recorded: BusinessFinancingPayload;
  business_option_granted: BusinessOptionGrantPayload;
  business_option_vested: BusinessOptionVestPayload;
  business_option_revalued: BusinessOptionRevaluationPayload;
  business_option_exercised: BusinessOptionExercisePayload;
  business_option_expired: BusinessOptionClosurePayload;
  business_option_cancelled: BusinessOptionClosurePayload;
  business_holding_revalued: BusinessHoldingRevaluationPayload;
  business_distribution_received: BusinessDistributionPayload;
  business_holding_sold: BusinessHoldingSalePayload;
  family_support_received: MoneyReceivedPayload;
  family_support_paid: MoneyPaidPayload;
  liquidity_shortfall_created: DebtDrawPayload;
}

export type FinancialEventPayload = FinancialEventPayloadMap[FinancialEventKind];

export type AcceptedFinancialEvent<K extends FinancialEventKind = FinancialEventKind> = K extends FinancialEventKind ? {
  id: string;
  proposalId?: string;
  kind: K;
  effectiveAtAgeInMonths: number;
  payload: FinancialEventPayloadMap[K];
  evidence: FinancialEvidence[];
  acceptedByReasonCodes: string[];
  /**
   * Code-owned proof that this event resolved one or more recurring-expense
   * fact dimensions.  Model transport cannot provide this field; the
   * confirmation validator stamps it after matching final evidence.
   */
  expenseConfirmationResolution?: {
    disposition: "confirmed_exact";
    responsibilityKey: string;
    accountId: string;
    targetIssueIds: string[];
    resolutionKind: "exact_amount" | "shared_allocation";
    matchedBindingId?: string;
  };
  liquidityTreatment?: "require_explicit" | "allow_system_shortfall";
} : never;

export interface FinancialTransaction {
  id: string;
  simulationTransactionId: string;
  eventIds: string[];
  periodStartAgeInMonths: number;
  periodEndAgeInMonths: number;
  cashDeltaWan: number;
  assetDeltaWan: number;
  debtDeltaWan: number;
  incomeWan: number;
  expenseWan: number;
  valuationChangeWan: number;
  priorFactCorrectionWan?: number;
  nonCashGainLossWan: number;
  netWorthDeltaWan: number;
  debtServiceRecords?: DebtServiceRecord[];
  automaticLiquidityShortfallIncreaseWan?: number;
  automaticLiquidityShortfallRecoveryWan?: number;
  debtPrincipalDrawnWan?: number;
  /** Previously existing debt first discovered in this period; no current cash was received. */
  debtBalanceDiscoveredWan?: number;
  debtPrincipalPaidWan?: number;
  debtPrincipalForgivenWan?: number;
  debtInterestAccruedWan?: number;
  debtInterestPaidWan?: number;
  /** Portion of interest paid that actually reduced accrued debt liability. */
  debtInterestLiabilityPaidWan?: number;
  debtInterestForgivenWan?: number;
  debtCapitalizedInterestWan?: number;
  /**
   * The specific personal debt accounts whose liability was reduced by a
   * repayment, forgiveness, scheduled servicing, or automatic shortfall
   * recovery in this transaction. Totals alone are not enough to prove which
   * account was settled when a period contains more than one liability.
   */
  debtSettlementAccountIds?: string[];
  evidence: FinancialEvidence[];
  /**
   * Evidence is otherwise aggregated at transaction level. Keep the accepted
   * event boundary so production audits can distinguish a personal cash
   * receipt from another, non-personal fact committed in the same period.
   * Optional only for backwards-compatible historical snapshots; all new
   * reducer transactions populate it.
   */
  acceptedEventAudit?: FinancialTransactionEventAudit[];
}

export interface FinancialTransactionEventAudit {
  eventId: string;
  kind: FinancialEventKind;
  evidence: FinancialEvidence[];
}

export interface FinancialPeriodSummary {
  periodStartAgeInMonths: number;
  periodEndAgeInMonths: number;
  incomeWan: number;
  coreExpenseWan: number;
  otherExpenseWan: number;
  debtPrincipalPaidWan: number;
  debtInterestPaidWan: number;
  debtInterestUnpaidWan?: number;
  automaticLiquidityShortfallRecoveryWan?: number;
  assetPurchaseWan: number;
  assetSaleProceedsWan: number;
  valuationChangeWan: number;
  priorFactCorrectionWan?: number;
  netCashFlowWan: number;
  netWorthChangeWan: number;
  transactionIds: string[];
}

export interface DerivedFinancialStateV2 {
  currencyUnit: "CNY_WAN_REAL";
  asOfAgeInMonths: number;
  cashWan: number;
  investmentAssetsWan: number;
  propertyMarketValueWan: number;
  businessAndOtherAssetsWan: number;
  totalDebtWan: number;
  netWorthWan: number;
  periodIncomeWan: number;
  periodCoreExpenseWan: number;
  periodOtherExpenseWan: number;
  periodNetCashFlowWan: number;
  annualizedRecurringIncomeWan: number;
  annualizedCoreExpenseWan: number;
  annualizedDisposableCashFlowWan: number;
  employmentStatus: EmploymentStatus;
  incomeStability: IncomeStability;
  factStatus: FinancialFactStatus;
  unresolvedIssueCodes: FinancialLedgerIssue["code"][];
  ledgerRevision: number;
}

export interface DerivedFinancialStateResult {
  state: DerivedFinancialStateV2;
  compatibilityState: FinancialState;
}

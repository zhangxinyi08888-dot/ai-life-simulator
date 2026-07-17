import type { EmploymentStatus, FinancialState, IncomeStability } from "../../types";

export type FinancialFactStatus = "known" | "estimated" | "unknown" | "needs_review";
export type FinancialFactSource =
  | "user"
  | "accepted_history"
  | "accepted_simulation_outcome"
  | "system_policy"
  | "legacy_migration";

export interface FinancialEvidence {
  source: FinancialFactSource;
  sourceNodeId?: string;
  sourceEventId?: string;
  sourceChoiceId?: string;
  excerpt?: string;
  reasonCode: string;
  confidence: number;
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
  evidence: FinancialEvidence[];
}

export type ExpenseCommitmentType = "basic_living" | "housing" | "dependent_support" | "education" | "healthcare" | "insurance" | "other";

export interface ExpenseCommitment {
  id: string;
  type: ExpenseCommitmentType;
  displayName: string;
  monthlyAmountWan: number;
  activeFromAgeInMonths: number;
  activeUntilAgeInMonths?: number;
  status: "active" | "paused" | "ended";
  factStatus: FinancialFactStatus;
  evidence: FinancialEvidence[];
}

export type DebtType = "mortgage" | "consumer_loan" | "student_loan" | "credit_balance" | "business_personal_guarantee" | "family_or_personal_loan" | "liquidity_shortfall";

export interface DebtRepaymentPolicy {
  mode: "known_schedule" | "estimated_amortizing" | "event_driven";
  monthlyPaymentWan?: number;
  monthlyPrincipalWan?: number;
  monthlyInterestWan?: number;
  annualInterestRate?: number;
  remainingTermMonths?: number;
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
  ownershipRate?: number;
  attributableValueWan?: number;
  liquidityDiscountRate?: number;
  personalCarryingValueWan: number;
  status: "active" | "partially_sold" | "sold" | "written_off";
  factStatus: FinancialFactStatus;
  evidence: FinancialEvidence[];
}

export interface FinancialLedgerIssue {
  id: string;
  code:
    | "MISSING_FUNDING_SOURCE"
    | "UNBALANCED_TRANSACTION"
    | "CAREER_INCOME_CONFLICT"
    | "BUSINESS_PERSONAL_BOUNDARY_CONFLICT"
    | "UNKNOWN_DEBT_SCHEDULE"
    | "UNSUPPORTED_LARGE_VALUE_CHANGE"
    | "LEGACY_UNCERTAINTY";
  severity: "warning" | "blocking";
  relatedProposalIds: string[];
  summary: string;
  createdAtAgeInMonths: number;
}

export interface FinancialLedger {
  id: string;
  owner: "protagonist";
  currencyUnit: "CNY_WAN_REAL";
  asOfAgeInMonths: number;
  cashAccounts: CashAccount[];
  assetAccounts: AssetAccount[];
  debtAccounts: DebtAccount[];
  incomeSources: IncomeSource[];
  expenseCommitments: ExpenseCommitment[];
  businessHoldings: BusinessHolding[];
  recentTransactions: FinancialTransaction[];
  committedTransactionIds: string[];
  unresolvedIssues: FinancialLedgerIssue[];
  revision: number;
  version: 2;
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
  | "asset_sold"
  | "asset_revalued"
  | "debt_drawn"
  | "debt_principal_repaid"
  | "debt_interest_paid"
  | "debt_restructured"
  | "debt_forgiven"
  | "business_financing_recorded"
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
}

export interface DebtForgivenPayload {
  debtAccountId: string;
  principalForgivenWan: number;
}

export interface BusinessFinancingPayload {
  businessHoldingId: string;
  financingAmountWan: number;
  postMoneyValuationWan?: number;
  ownershipRateAfterFinancing?: number;
  personalCashReceivedWan: 0;
}

export interface BusinessHoldingRevaluationPayload {
  businessHoldingId: string;
  previousCarryingValueWan: number;
  newCarryingValueWan: number;
  postMoneyValuationWan?: number;
  ownershipRate?: number;
  valuationEvidence: FinancialEvidence[];
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
  nextCommitment: ExpenseCommitment;
}

export interface ExpenseCommitmentStatusPayload {
  expenseCommitmentId: string;
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
  asset_sold: AssetSalePayload;
  asset_revalued: AssetRevaluationPayload;
  debt_drawn: DebtDrawPayload;
  debt_principal_repaid: DebtPrincipalRepaymentPayload;
  debt_interest_paid: DebtInterestPaymentPayload;
  debt_restructured: DebtRestructuredPayload;
  debt_forgiven: DebtForgivenPayload;
  business_financing_recorded: BusinessFinancingPayload;
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
  nonCashGainLossWan: number;
  netWorthDeltaWan: number;
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
  assetPurchaseWan: number;
  assetSaleProceedsWan: number;
  valuationChangeWan: number;
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

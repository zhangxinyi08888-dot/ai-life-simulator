import type { FinancialEventKind } from "./types";

type JsonRecord = Record<string, unknown>;
export interface FinancialPayloadSchemaError { path: string; reason: string }

const INCOME_TYPES = new Set(["salary", "contract", "self_employment_draw", "rent", "pension", "annuity_payment", "royalty", "investment_distribution", "business_dividend", "family_support", "other"]);
const INCOME_POLICIES = new Set(["monthly", "annual", "event_only"]);
const INCOME_STATUSES = new Set(["active", "paused", "ended"]);
const EXPENSE_TYPES = new Set(["basic_living", "housing", "dependent_support", "education", "healthcare", "insurance", "other"]);
const EXPENSE_STATUSES = new Set(["active", "paused", "ended"]);
const FACT_STATUSES = new Set(["known", "estimated", "unknown", "needs_review"]);
const FINANCIAL_FACT_SOURCES = new Set(["user", "accepted_history", "accepted_simulation_outcome", "system_policy", "legacy_migration"]);
const FINANCIAL_SCOPES = new Set(["personal", "shared_household", "business_operating", "third_party"]);
const COMMITTED_EXPENSE_SCOPES = new Set(["personal", "shared_household"]);
const EXPENSE_RESPONSIBILITY_KINDS = new Set([
  "adult_basic_living", "unclassified_core_consumption", "primary_residence", "child_support", "elder_care", "recurring_healthcare",
  "personal_insurance", "continuing_education", "legacy_aggregate"
]);
const EXPENSE_AMOUNT_BASES = new Set([
  "explicit_known", "explicit_shared_amount", "last_known", "contextual_estimate", "policy_floor", "legacy_estimate"
]);
const EXPENSE_CHANGE_REASONS = new Set([
  "residence_ended", "shared_responsibility_changed", "explicit_amount_reduced", "estimate_superseded_by_exact_fact", "dependent_independent",
  "care_responsibility_transferred", "care_recipient_deceased", "treatment_completed", "insurance_cancelled",
  "education_completed", "aggregate_atomically_split", "temporary_third_party_coverage",
  "aggregate_residual_reallocated",
  "responsibility_resumed", "responsibility_ended"
]);
const ASSET_TYPES = new Set(["investment", "property", "annuity", "insurance_cash_value", "other_personal_asset"]);
const ASSET_LIQUIDITIES = new Set(["liquid", "semi_liquid", "illiquid"]);
const ASSET_STATUSES = new Set(["active", "disposed"]);
const DEBT_TYPES = new Set(["mortgage", "consumer_loan", "student_loan", "credit_balance", "business_personal_guarantee", "family_or_personal_loan", "liquidity_shortfall"]);
const DEBT_STATUSES = new Set(["active", "repaid", "restructured", "defaulted"]);
const DEBT_POLICIES = new Set(["known_schedule", "estimated_amortizing", "event_driven"]);

const isRecord = (value: unknown): value is JsonRecord => Boolean(value) && typeof value === "object" && !Array.isArray(value);
function requiredRecord(value: unknown, path: string, errors: FinancialPayloadSchemaError[]): JsonRecord | undefined {
  if (!isRecord(value)) { errors.push({ path, reason: "必须是对象" }); return undefined; }
  return value;
}
function requiredString(value: unknown, path: string, errors: FinancialPayloadSchemaError[]): void {
  if (typeof value !== "string" || !value.trim()) errors.push({ path, reason: "必须是非空字符串" });
}
function requiredNumber(value: unknown, path: string, errors: FinancialPayloadSchemaError[], allowZero = true): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || (!allowZero && value === 0)) errors.push({ path, reason: allowZero ? "必须是非负有限数" : "必须是正有限数" });
}
function optionalNumber(value: unknown, path: string, errors: FinancialPayloadSchemaError[]): void {
  if (value !== undefined) requiredNumber(value, path, errors);
}
function requiredInteger(value: unknown, path: string, errors: FinancialPayloadSchemaError[]): void {
  if (!Number.isInteger(value) || Number(value) < 0) errors.push({ path, reason: "必须是非负整数" });
}
function requiredEnum(value: unknown, allowed: Set<string>, path: string, errors: FinancialPayloadSchemaError[]): void {
  if (typeof value !== "string" || !allowed.has(value)) errors.push({ path, reason: `必须是合法枚举值（${[...allowed].join("、")}）` });
}
function requiredArray(value: unknown, path: string, errors: FinancialPayloadSchemaError[]): void {
  if (!Array.isArray(value)) errors.push({ path, reason: "必须是数组" });
}
function optionalEnum(value: unknown, allowed: Set<string>, path: string, errors: FinancialPayloadSchemaError[]): void {
  if (value !== undefined) requiredEnum(value, allowed, path, errors);
}
function financialEvidence(value: unknown, path: string, errors: FinancialPayloadSchemaError[]): void {
  const evidence = requiredRecord(value, path, errors); if (!evidence) return;
  requiredEnum(evidence.source, FINANCIAL_FACT_SOURCES, `${path}.source`, errors);
  requiredString(evidence.reasonCode, `${path}.reasonCode`, errors);
  if (typeof evidence.confidence !== "number" || !Number.isFinite(evidence.confidence) || evidence.confidence < 0 || evidence.confidence > 1) {
    errors.push({ path: `${path}.confidence`, reason: "必须是 0-1 之间的有限数" });
  }
  optionalEnum(evidence.financialScope, FINANCIAL_SCOPES, `${path}.financialScope`, errors);
}
function evidenceArray(value: unknown, path: string, errors: FinancialPayloadSchemaError[]): void {
  requiredArray(value, path, errors);
  if (Array.isArray(value)) value.forEach((item, index) => financialEvidence(item, `${path}[${index}]`, errors));
}
function incomeSource(value: unknown, path: string, errors: FinancialPayloadSchemaError[]): void {
  const source = requiredRecord(value, path, errors); if (!source) return;
  requiredString(source.id, `${path}.id`, errors); requiredEnum(source.type, INCOME_TYPES, `${path}.type`, errors);
  requiredString(source.displayName, `${path}.displayName`, errors); requiredEnum(source.accrualPolicy, INCOME_POLICIES, `${path}.accrualPolicy`, errors);
  if (source.accrualPolicy === "monthly") requiredNumber(source.monthlyNetAmountWan, `${path}.monthlyNetAmountWan`, errors);
  if (source.accrualPolicy === "annual") requiredNumber(source.annualNetAmountWan, `${path}.annualNetAmountWan`, errors);
  if (source.employmentConfirmedAtAgeInMonths !== undefined) {
    requiredInteger(source.employmentConfirmedAtAgeInMonths, `${path}.employmentConfirmedAtAgeInMonths`, errors);
  }
  requiredInteger(source.activeFromAgeInMonths, `${path}.activeFromAgeInMonths`, errors); requiredEnum(source.status, INCOME_STATUSES, `${path}.status`, errors);
  requiredEnum(source.factStatus, FACT_STATUSES, `${path}.factStatus`, errors); evidenceArray(source.evidence, `${path}.evidence`, errors);
}
function expenseCommitment(value: unknown, path: string, errors: FinancialPayloadSchemaError[]): void {
  const item = requiredRecord(value, path, errors); if (!item) return;
  requiredString(item.id, `${path}.id`, errors); requiredEnum(item.type, EXPENSE_TYPES, `${path}.type`, errors); requiredString(item.displayName, `${path}.displayName`, errors);
  requiredNumber(item.monthlyAmountWan, `${path}.monthlyAmountWan`, errors); requiredInteger(item.activeFromAgeInMonths, `${path}.activeFromAgeInMonths`, errors);
  requiredEnum(item.status, EXPENSE_STATUSES, `${path}.status`, errors); requiredEnum(item.factStatus, FACT_STATUSES, `${path}.factStatus`, errors); evidenceArray(item.evidence, `${path}.evidence`, errors);
  if (item.status === "active") requiredNumber(item.monthlyAmountWan, `${path}.monthlyAmountWan`, errors, false);
  for (const forbidden of ["monthlyNetAmountWan", "annualNetAmountWan", "annualAmountWan", "incomeSourceId", "accrualPolicy"]) {
    if (Object.prototype.hasOwnProperty.call(item, forbidden)) errors.push({ path: `${path}.${forbidden}`, reason: "收入字段不得出现在持续支出 payload" });
  }
  const hasV4Fields = ["responsibilityKey", "responsibilityKind", "amountBasis", "amountSourceIds", "financialScope", "nextReviewAtAgeInMonths"]
    .some((key) => Object.prototype.hasOwnProperty.call(item, key));
  if (!hasV4Fields) return;
  requiredString(item.responsibilityKey, `${path}.responsibilityKey`, errors);
  requiredEnum(item.responsibilityKind, EXPENSE_RESPONSIBILITY_KINDS, `${path}.responsibilityKind`, errors);
  requiredEnum(item.amountBasis, EXPENSE_AMOUNT_BASES, `${path}.amountBasis`, errors);
  requiredArray(item.amountSourceIds, `${path}.amountSourceIds`, errors);
  if (Array.isArray(item.amountSourceIds)) item.amountSourceIds.forEach((id, index) => requiredString(id, `${path}.amountSourceIds[${index}]`, errors));
  requiredEnum(item.financialScope, COMMITTED_EXPENSE_SCOPES, `${path}.financialScope`, errors);
  requiredEnum(item.accrualReviewStatus, new Set(["normal", "conservative", "review_due"]), `${path}.accrualReviewStatus`, errors);
  requiredInteger(item.nextReviewAtAgeInMonths, `${path}.nextReviewAtAgeInMonths`, errors);
  optionalNumber(item.grossMonthlyAmountWan, `${path}.grossMonthlyAmountWan`, errors);
  optionalNumber(item.confirmedMonthlyAmountWan, `${path}.confirmedMonthlyAmountWan`, errors);
  optionalNumber(item.householdShareRate, `${path}.householdShareRate`, errors);
  if (item.householdShareRate !== undefined && (Number(item.householdShareRate) < 0 || Number(item.householdShareRate) > 1)) {
    errors.push({ path: `${path}.householdShareRate`, reason: "必须在 0-1 之间" });
  }
  const explicitSharedAmount = item.amountBasis === "explicit_shared_amount";
  const explicitAmount = item.amountBasis === "explicit_known" || explicitSharedAmount;
  if (item.factStatus === "known" && !explicitAmount) {
    errors.push({ path: `${path}.amountBasis`, reason: "已知 V4 支出必须使用 explicit_known 或 explicit_shared_amount" });
  }
  if (explicitAmount && item.factStatus !== "known") {
    errors.push({ path: `${path}.factStatus`, reason: "明确金额 V4 支出必须为 known" });
  }
  if (explicitSharedAmount) {
    if (item.financialScope !== "shared_household") {
      errors.push({ path: `${path}.financialScope`, reason: "共同金额必须使用 shared_household 责任范围" });
    }
    requiredNumber(item.grossMonthlyAmountWan, `${path}.grossMonthlyAmountWan`, errors, false);
    requiredNumber(item.householdShareRate, `${path}.householdShareRate`, errors, false);
  }
  if (item.financialScope === "shared_household" && item.factStatus === "known" && !explicitSharedAmount) {
    errors.push({ path: `${path}.amountBasis`, reason: "已知共同家庭金额必须使用 explicit_shared_amount，并提供总额与主角承担比例" });
  }
  if (item.grossMonthlyAmountWan !== undefined && item.householdShareRate !== undefined && Number.isFinite(Number(item.monthlyAmountWan))) {
    if (Math.abs(Number(item.monthlyAmountWan) - Number(item.grossMonthlyAmountWan) * Number(item.householdShareRate)) > 0.005) {
      errors.push({ path: `${path}.monthlyAmountWan`, reason: "必须等于总额乘主角承担比例" });
    }
  }
  if (explicitAmount) {
    requiredNumber(item.confirmedMonthlyAmountWan, `${path}.confirmedMonthlyAmountWan`, errors, false);
    requiredInteger(item.lastConfirmedAtAgeInMonths, `${path}.lastConfirmedAtAgeInMonths`, errors);
  } else if (item.confirmedMonthlyAmountWan !== undefined || item.lastConfirmedAtAgeInMonths !== undefined) {
    errors.push({ path: `${path}.confirmedMonthlyAmountWan`, reason: "非明确金额 V4 支出不得携带确认金额或确认时间" });
  }
  if (["contextual_estimate", "policy_floor", "legacy_estimate"].includes(String(item.amountBasis))) {
    requiredString(item.estimationPolicyId, `${path}.estimationPolicyId`, errors);
  }
}
function assetAccount(value: unknown, path: string, errors: FinancialPayloadSchemaError[]): void {
  const item = requiredRecord(value, path, errors); if (!item) return;
  requiredString(item.id, `${path}.id`, errors); requiredEnum(item.type, ASSET_TYPES, `${path}.type`, errors); requiredString(item.displayName, `${path}.displayName`, errors);
  requiredNumber(item.marketValueWan, `${path}.marketValueWan`, errors); requiredEnum(item.liquidity, ASSET_LIQUIDITIES, `${path}.liquidity`, errors);
  requiredEnum(item.status, ASSET_STATUSES, `${path}.status`, errors); requiredEnum(item.factStatus, FACT_STATUSES, `${path}.factStatus`, errors);
  requiredInteger(item.openedAtAgeInMonths, `${path}.openedAtAgeInMonths`, errors); evidenceArray(item.evidence, `${path}.evidence`, errors);
}
function debtAccount(value: unknown, path: string, errors: FinancialPayloadSchemaError[]): void {
  const item = requiredRecord(value, path, errors); if (!item) return;
  requiredString(item.id, `${path}.id`, errors); requiredEnum(item.type, DEBT_TYPES, `${path}.type`, errors); requiredString(item.displayName, `${path}.displayName`, errors);
  requiredNumber(item.principalWan, `${path}.principalWan`, errors); requiredInteger(item.openedAtAgeInMonths, `${path}.openedAtAgeInMonths`, errors);
  requiredEnum(item.status, DEBT_STATUSES, `${path}.status`, errors); requiredEnum(item.factStatus, FACT_STATUSES, `${path}.factStatus`, errors); evidenceArray(item.evidence, `${path}.evidence`, errors);
  const policy = requiredRecord(item.repaymentPolicy, `${path}.repaymentPolicy`, errors); if (policy) requiredEnum(policy.mode, DEBT_POLICIES, `${path}.repaymentPolicy.mode`, errors);
}
function businessHolding(value: unknown, path: string, errors: FinancialPayloadSchemaError[], requireOption = false): void {
  const item = requiredRecord(value, path, errors); if (!item) return;
  requiredString(item.id, `${path}.id`, errors); requiredNumber(item.personalCarryingValueWan, `${path}.personalCarryingValueWan`, errors);
  requiredEnum(item.factStatus, FACT_STATUSES, `${path}.factStatus`, errors); evidenceArray(item.evidence, `${path}.evidence`, errors);
  const business = requiredRecord(item.business, `${path}.business`, errors); if (business) requiredString(business.id, `${path}.business.id`, errors);
  if (requireOption && item.instrumentType !== "stock_option") errors.push({ path: `${path}.instrumentType`, reason: "期权必须为 stock_option" });
  if (requireOption) {
    const terms = requiredRecord(item.optionTerms, `${path}.optionTerms`, errors);
    if (terms) {
      requiredNumber(terms.grantedUnits, `${path}.optionTerms.grantedUnits`, errors);
      if (Number(terms.grantedUnits) === 0 && item.factStatus !== "needs_review") {
        errors.push({ path: `${path}.optionTerms.grantedUnits`, reason: "未知授予数量只能以 needs_review 保存" });
      }
      requiredNumber(terms.vestedUnits, `${path}.optionTerms.vestedUnits`, errors);
      requiredNumber(terms.exercisedUnits, `${path}.optionTerms.exercisedUnits`, errors);
      requiredNumber(terms.strikePriceWanPerUnit, `${path}.optionTerms.strikePriceWanPerUnit`, errors);
      optionalNumber(terms.grantedAtAgeInMonths, `${path}.optionTerms.grantedAtAgeInMonths`, errors);
      optionalNumber(terms.expiresAtAgeInMonths, `${path}.optionTerms.expiresAtAgeInMonths`, errors);
      if (terms.vestingPolicy !== undefined) {
        const policy = requiredRecord(terms.vestingPolicy, `${path}.optionTerms.vestingPolicy`, errors);
        if (policy) {
          requiredNumber(policy.totalMonths, `${path}.optionTerms.vestingPolicy.totalMonths`, errors, false);
          optionalNumber(policy.cliffMonths, `${path}.optionTerms.vestingPolicy.cliffMonths`, errors);
          optionalNumber(policy.frequencyMonths, `${path}.optionTerms.vestingPolicy.frequencyMonths`, errors);
        }
      }
    }
  }
}

/** Validate every field a reducer branch dereferences before reducer trial. */
export function validateFinancialPayloadSchema(kind: FinancialEventKind, value: unknown): FinancialPayloadSchemaError[] {
  const errors: FinancialPayloadSchemaError[] = []; const payload = requiredRecord(value, "payload", errors); if (!payload) return errors;
  const string = (key: string) => requiredString(payload[key], `payload.${key}`, errors);
  const positive = (key: string) => requiredNumber(payload[key], `payload.${key}`, errors, false);
  const nonNegative = (key: string) => requiredNumber(payload[key], `payload.${key}`, errors);
  switch (kind) {
    case "income_source_started": incomeSource(payload, "payload", errors); break;
    case "income_source_adjusted": string("incomeSourceId"); incomeSource(payload.nextSource, "payload.nextSource", errors); break;
    case "income_source_paused": case "income_source_ended": string("incomeSourceId"); break;
    case "one_off_income_received": case "family_support_received": string("destinationCashAccountId"); positive("amountWan"); break;
    case "expense_commitment_started": expenseCommitment(payload, "payload", errors); break;
    case "expense_commitment_adjusted":
      string("expenseCommitmentId");
      if (payload.previousCommitmentId !== undefined) string("previousCommitmentId");
      if (payload.changeReason !== undefined) requiredEnum(payload.changeReason, EXPENSE_CHANGE_REASONS, "payload.changeReason", errors);
      expenseCommitment(payload.nextCommitment, "payload.nextCommitment", errors);
      break;
    case "expense_commitment_ended":
      string("expenseCommitmentId");
      if (payload.previousCommitmentId !== undefined) string("previousCommitmentId");
      if (payload.changeReason !== undefined) requiredEnum(payload.changeReason, EXPENSE_CHANGE_REASONS, "payload.changeReason", errors);
      break;
    case "one_off_expense_paid": case "family_support_paid": string("sourceCashAccountId"); positive("amountWan"); break;
    case "asset_purchased": string("sourceCashAccountId"); assetAccount(payload.assetAccount, "payload.assetAccount", errors); positive("cashPaidWan"); nonNegative("transactionFeeWan"); break;
    case "asset_balance_discovered": assetAccount(payload.assetAccount, "payload.assetAccount", errors); break;
    case "asset_sold": string("assetAccountId"); string("destinationCashAccountId"); positive("assetValueRemovedWan"); positive("cashReceivedWan"); nonNegative("transactionFeeWan"); break;
    case "asset_revalued": string("assetAccountId"); nonNegative("previousMarketValueWan"); nonNegative("newMarketValueWan"); requiredArray(payload.valuationEvidence, "payload.valuationEvidence", errors); break;
    case "debt_drawn": case "liquidity_shortfall_created": debtAccount(payload.debtAccount, "payload.debtAccount", errors); string("destinationCashAccountId"); positive("principalDrawnWan"); break;
    case "debt_balance_discovered": debtAccount(payload.debtAccount, "payload.debtAccount", errors); break;
    case "debt_principal_repaid": string("debtAccountId"); string("sourceCashAccountId"); positive("principalPaidWan"); break;
    case "debt_interest_paid": string("debtAccountId"); string("sourceCashAccountId"); positive("interestPaidWan"); break;
    case "debt_restructured": string("oldDebtAccountId"); debtAccount(payload.replacementDebtAccount, "payload.replacementDebtAccount", errors); nonNegative("transactionFeeWan"); if (Number(payload.transactionFeeWan) > 0) string("sourceCashAccountId"); break;
    case "debt_forgiven": string("debtAccountId"); positive("principalForgivenWan"); break;
    case "debt_default_recorded": string("debtAccountId"); string("reason"); break;
    case "business_holding_started": string("sourceCashAccountId"); nonNegative("personalCashInvestedWan"); businessHolding(payload.businessHolding, "payload.businessHolding", errors); break;
    case "business_financing_recorded": string("businessHoldingId"); positive("financingAmountWan"); nonNegative("personalCashReceivedWan"); optionalNumber(payload.postMoneyValuationWan, "payload.postMoneyValuationWan", errors); optionalNumber(payload.ownershipRateAfterFinancing, "payload.ownershipRateAfterFinancing", errors); break;
    case "business_option_granted": businessHolding(payload.optionHolding, "payload.optionHolding", errors, true); break;
    case "business_option_vested": string("businessHoldingId"); positive("unitsVested"); break;
    case "business_option_revalued": string("businessHoldingId"); nonNegative("previousCarryingValueWan"); nonNegative("fairValueWanPerUnit"); nonNegative("liquidityDiscountRate"); nonNegative("realizationRiskDiscountRate"); nonNegative("newCarryingValueWan"); requiredArray(payload.valuationEvidence, "payload.valuationEvidence", errors); break;
    case "business_option_exercised": string("businessHoldingId"); positive("unitsExercised"); string("sourceCashAccountId"); nonNegative("exerciseCostWan"); businessHolding(payload.resultingEquityHolding, "payload.resultingEquityHolding", errors); break;
    case "business_option_expired": case "business_option_cancelled": string("businessHoldingId"); break;
    case "business_holding_revalued": string("businessHoldingId"); nonNegative("previousCarryingValueWan"); nonNegative("newCarryingValueWan"); nonNegative("postMoneyValuationWan"); nonNegative("ownershipRate"); requiredArray(payload.valuationEvidence, "payload.valuationEvidence", errors); break;
    case "business_distribution_received": string("businessHoldingId"); string("destinationCashAccountId"); positive("amountWan"); break;
    case "business_holding_sold": string("businessHoldingId"); string("destinationCashAccountId"); positive("holdingValueRemovedWan"); positive("cashReceivedWan"); nonNegative("transactionFeeWan"); optionalNumber(payload.ownershipRateSold, "payload.ownershipRateSold", errors); break;
  }
  return errors;
}

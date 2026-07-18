import type { FinancialEventKind } from "./types";

type JsonRecord = Record<string, unknown>;
export interface FinancialPayloadSchemaError { path: string; reason: string }

const INCOME_TYPES = new Set(["salary", "contract", "self_employment_draw", "rent", "pension", "annuity_payment", "royalty", "investment_distribution", "business_dividend", "family_support", "other"]);
const INCOME_POLICIES = new Set(["monthly", "annual", "event_only"]);
const INCOME_STATUSES = new Set(["active", "paused", "ended"]);
const EXPENSE_TYPES = new Set(["basic_living", "housing", "dependent_support", "education", "healthcare", "insurance", "other"]);
const EXPENSE_STATUSES = new Set(["active", "paused", "ended"]);
const FACT_STATUSES = new Set(["known", "estimated", "unknown", "needs_review"]);
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
function incomeSource(value: unknown, path: string, errors: FinancialPayloadSchemaError[]): void {
  const source = requiredRecord(value, path, errors); if (!source) return;
  requiredString(source.id, `${path}.id`, errors); requiredEnum(source.type, INCOME_TYPES, `${path}.type`, errors);
  requiredString(source.displayName, `${path}.displayName`, errors); requiredEnum(source.accrualPolicy, INCOME_POLICIES, `${path}.accrualPolicy`, errors);
  if (source.accrualPolicy === "monthly") requiredNumber(source.monthlyNetAmountWan, `${path}.monthlyNetAmountWan`, errors);
  if (source.accrualPolicy === "annual") requiredNumber(source.annualNetAmountWan, `${path}.annualNetAmountWan`, errors);
  requiredInteger(source.activeFromAgeInMonths, `${path}.activeFromAgeInMonths`, errors); requiredEnum(source.status, INCOME_STATUSES, `${path}.status`, errors);
  requiredEnum(source.factStatus, FACT_STATUSES, `${path}.factStatus`, errors); requiredArray(source.evidence, `${path}.evidence`, errors);
}
function expenseCommitment(value: unknown, path: string, errors: FinancialPayloadSchemaError[]): void {
  const item = requiredRecord(value, path, errors); if (!item) return;
  requiredString(item.id, `${path}.id`, errors); requiredEnum(item.type, EXPENSE_TYPES, `${path}.type`, errors); requiredString(item.displayName, `${path}.displayName`, errors);
  requiredNumber(item.monthlyAmountWan, `${path}.monthlyAmountWan`, errors); requiredInteger(item.activeFromAgeInMonths, `${path}.activeFromAgeInMonths`, errors);
  requiredEnum(item.status, EXPENSE_STATUSES, `${path}.status`, errors); requiredEnum(item.factStatus, FACT_STATUSES, `${path}.factStatus`, errors); requiredArray(item.evidence, `${path}.evidence`, errors);
}
function assetAccount(value: unknown, path: string, errors: FinancialPayloadSchemaError[]): void {
  const item = requiredRecord(value, path, errors); if (!item) return;
  requiredString(item.id, `${path}.id`, errors); requiredEnum(item.type, ASSET_TYPES, `${path}.type`, errors); requiredString(item.displayName, `${path}.displayName`, errors);
  requiredNumber(item.marketValueWan, `${path}.marketValueWan`, errors); requiredEnum(item.liquidity, ASSET_LIQUIDITIES, `${path}.liquidity`, errors);
  requiredEnum(item.status, ASSET_STATUSES, `${path}.status`, errors); requiredEnum(item.factStatus, FACT_STATUSES, `${path}.factStatus`, errors);
  requiredInteger(item.openedAtAgeInMonths, `${path}.openedAtAgeInMonths`, errors); requiredArray(item.evidence, `${path}.evidence`, errors);
}
function debtAccount(value: unknown, path: string, errors: FinancialPayloadSchemaError[]): void {
  const item = requiredRecord(value, path, errors); if (!item) return;
  requiredString(item.id, `${path}.id`, errors); requiredEnum(item.type, DEBT_TYPES, `${path}.type`, errors); requiredString(item.displayName, `${path}.displayName`, errors);
  requiredNumber(item.principalWan, `${path}.principalWan`, errors); requiredInteger(item.openedAtAgeInMonths, `${path}.openedAtAgeInMonths`, errors);
  requiredEnum(item.status, DEBT_STATUSES, `${path}.status`, errors); requiredEnum(item.factStatus, FACT_STATUSES, `${path}.factStatus`, errors); requiredArray(item.evidence, `${path}.evidence`, errors);
  const policy = requiredRecord(item.repaymentPolicy, `${path}.repaymentPolicy`, errors); if (policy) requiredEnum(policy.mode, DEBT_POLICIES, `${path}.repaymentPolicy.mode`, errors);
}
function businessHolding(value: unknown, path: string, errors: FinancialPayloadSchemaError[], requireOption = false): void {
  const item = requiredRecord(value, path, errors); if (!item) return;
  requiredString(item.id, `${path}.id`, errors); requiredNumber(item.personalCarryingValueWan, `${path}.personalCarryingValueWan`, errors);
  requiredEnum(item.factStatus, FACT_STATUSES, `${path}.factStatus`, errors); requiredArray(item.evidence, `${path}.evidence`, errors);
  const business = requiredRecord(item.business, `${path}.business`, errors); if (business) requiredString(business.id, `${path}.business.id`, errors);
  if (requireOption && item.instrumentType !== "stock_option") errors.push({ path: `${path}.instrumentType`, reason: "期权必须为 stock_option" });
  if (requireOption) {
    const terms = requiredRecord(item.optionTerms, `${path}.optionTerms`, errors);
    if (terms) {
      requiredNumber(terms.grantedUnits, `${path}.optionTerms.grantedUnits`, errors, false);
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
    case "expense_commitment_adjusted": string("expenseCommitmentId"); expenseCommitment(payload.nextCommitment, "payload.nextCommitment", errors); break;
    case "expense_commitment_ended": string("expenseCommitmentId"); break;
    case "one_off_expense_paid": case "family_support_paid": string("sourceCashAccountId"); positive("amountWan"); break;
    case "asset_purchased": string("sourceCashAccountId"); assetAccount(payload.assetAccount, "payload.assetAccount", errors); positive("cashPaidWan"); nonNegative("transactionFeeWan"); break;
    case "asset_sold": string("assetAccountId"); string("destinationCashAccountId"); positive("assetValueRemovedWan"); positive("cashReceivedWan"); nonNegative("transactionFeeWan"); break;
    case "asset_revalued": string("assetAccountId"); nonNegative("previousMarketValueWan"); nonNegative("newMarketValueWan"); requiredArray(payload.valuationEvidence, "payload.valuationEvidence", errors); break;
    case "debt_drawn": case "liquidity_shortfall_created": debtAccount(payload.debtAccount, "payload.debtAccount", errors); string("destinationCashAccountId"); positive("principalDrawnWan"); break;
    case "debt_principal_repaid": string("debtAccountId"); string("sourceCashAccountId"); positive("principalPaidWan"); break;
    case "debt_interest_paid": string("debtAccountId"); string("sourceCashAccountId"); positive("interestPaidWan"); break;
    case "debt_restructured": string("oldDebtAccountId"); debtAccount(payload.replacementDebtAccount, "payload.replacementDebtAccount", errors); nonNegative("transactionFeeWan"); if (Number(payload.transactionFeeWan) > 0) string("sourceCashAccountId"); break;
    case "debt_forgiven": string("debtAccountId"); positive("principalForgivenWan"); break;
    case "business_holding_started": businessHolding(payload, "payload", errors); break;
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

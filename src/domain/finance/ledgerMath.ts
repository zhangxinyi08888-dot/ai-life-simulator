import {
  isFinancialLedgerV4,
  type ExpenseCommitmentV4,
  type FinancialFactStatus,
  type FinancialLedger
} from "./types";

export const PRIMARY_CASH_ACCOUNT_ID = "primary_cash";

export function roundWan(value: number): number {
  return Math.round((value + Number.EPSILON) * 10000) / 10000;
}

export function totalCashWan(ledger: FinancialLedger): number {
  return roundWan(ledger.cashAccounts
    .filter((account) => account.status === "active")
    .reduce((sum, account) => sum + account.balanceWan, 0));
}

export function totalAssetWan(ledger: FinancialLedger): number {
  return roundWan(ledger.assetAccounts
    .filter((account) => account.status === "active")
    .reduce((sum, account) => sum + account.marketValueWan, 0)
    + ledger.businessHoldings
      .filter((holding) => holding.status === "active" || holding.status === "partially_sold")
      .reduce((sum, holding) => sum + holding.personalCarryingValueWan, 0));
}

export function totalDebtWan(ledger: FinancialLedger): number {
  return roundWan(ledger.debtAccounts
    .filter((account) => account.status === "active" || account.status === "defaulted")
    .reduce((sum, account) => sum + account.principalWan + (account.accruedUnpaidInterestWan ?? 0), 0));
}

export function ledgerNetWorthWan(ledger: FinancialLedger): number {
  return roundWan(totalCashWan(ledger) + totalAssetWan(ledger) - totalDebtWan(ledger));
}

const FACT_STATUS_RANK: Record<FinancialFactStatus, number> = {
  known: 0,
  estimated: 1,
  unknown: 2,
  needs_review: 3
};

export function weakestFactStatus(statuses: FinancialFactStatus[]): FinancialFactStatus {
  return statuses.reduce<FinancialFactStatus>((weakest, status) => (
    FACT_STATUS_RANK[status] > FACT_STATUS_RANK[weakest] ? status : weakest
  ), "known");
}

export function cloneLedger(ledger: FinancialLedger): FinancialLedger {
  return structuredClone(ledger);
}

export class FinancialLedgerInvariantError extends Error {
  readonly code: "INVALID_LEDGER" | "MISSING_FUNDING_SOURCE" | "UNBALANCED_TRANSACTION" | "REVISION_CONFLICT";

  constructor(code: FinancialLedgerInvariantError["code"], message: string) {
    super(message);
    this.name = "FinancialLedgerInvariantError";
    this.code = code;
  }
}

function assertFiniteNonNegative(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new FinancialLedgerInvariantError("INVALID_LEDGER", `${label} 必须是非负有限数`);
  }
}

function assertUniqueIds(items: Array<{ id: string }>, label: string): void {
  const ids = new Set<string>();
  for (const item of items) {
    if (!item.id || ids.has(item.id)) {
      throw new FinancialLedgerInvariantError("INVALID_LEDGER", `${label} id 必须存在且唯一: ${item.id || "<empty>"}`);
    }
    ids.add(item.id);
  }
}

function assertIntegerAtOrAfter(value: number | undefined, lowerBound: number, label: string): void {
  if (!Number.isInteger(value) || (value as number) < lowerBound) {
    throw new FinancialLedgerInvariantError("INVALID_LEDGER", `${label} 必须是大于等于 ${lowerBound} 的整数`);
  }
}

function assertV4ExpenseCommitment(commitment: ExpenseCommitmentV4): void {
  if (!commitment.responsibilityKey.trim()) {
    throw new FinancialLedgerInvariantError("INVALID_LEDGER", `V4 支出义务 ${commitment.id} 缺少 responsibilityKey`);
  }
  if (![
    "adult_basic_living",
    "primary_residence",
    "child_support",
    "elder_care",
    "recurring_healthcare",
    "personal_insurance",
    "continuing_education",
    "legacy_aggregate"
  ].includes(commitment.responsibilityKind)) {
    throw new FinancialLedgerInvariantError("INVALID_LEDGER", `V4 支出义务 ${commitment.id}.responsibilityKind 无效`);
  }
  if (![
    "explicit_known",
    "explicit_shared_amount",
    "last_known",
    "contextual_estimate",
    "policy_floor",
    "legacy_estimate"
  ].includes(commitment.amountBasis)) {
    throw new FinancialLedgerInvariantError("INVALID_LEDGER", `V4 支出义务 ${commitment.id}.amountBasis 无效`);
  }
  if (commitment.financialScope !== "personal" && commitment.financialScope !== "shared_household") {
    throw new FinancialLedgerInvariantError("INVALID_LEDGER", `V4 支出义务 ${commitment.id} 不得进入 ${commitment.financialScope} 范围的个人账本`);
  }
  if (!commitment.amountSourceIds.length
    || commitment.amountSourceIds.some((id) => !id || !id.trim())
    || new Set(commitment.amountSourceIds).size !== commitment.amountSourceIds.length) {
    throw new FinancialLedgerInvariantError("INVALID_LEDGER", `V4 支出义务 ${commitment.id}.amountSourceIds 必须为非空且唯一的稳定来源`);
  }
  if (![
    "normal",
    "conservative",
    "review_due"
  ].includes(commitment.accrualReviewStatus)) {
    throw new FinancialLedgerInvariantError("INVALID_LEDGER", `V4 支出义务 ${commitment.id}.accrualReviewStatus 无效`);
  }
  assertIntegerAtOrAfter(commitment.nextReviewAtAgeInMonths, commitment.activeFromAgeInMonths, `V4 支出义务 ${commitment.id}.nextReviewAtAgeInMonths`);
  if (commitment.lastConfirmedAtAgeInMonths !== undefined) {
    assertIntegerAtOrAfter(commitment.lastConfirmedAtAgeInMonths, commitment.activeFromAgeInMonths, `V4 支出义务 ${commitment.id}.lastConfirmedAtAgeInMonths`);
  }
  if (commitment.lastReviewedAtAgeInMonths !== undefined) {
    assertIntegerAtOrAfter(commitment.lastReviewedAtAgeInMonths, commitment.activeFromAgeInMonths, `V4 支出义务 ${commitment.id}.lastReviewedAtAgeInMonths`);
  }
  if (commitment.status === "active" && commitment.monthlyAmountWan <= 0) {
    throw new FinancialLedgerInvariantError("INVALID_LEDGER", `V4 active 支出义务 ${commitment.id} 的月计提必须大于零`);
  }
  if (commitment.status === "active" && commitment.factStatus === "unknown") {
    throw new FinancialLedgerInvariantError("INVALID_LEDGER", `V4 active 支出义务 ${commitment.id} 金额未确认时必须为 needs_review，不能为 unknown`);
  }
  if (commitment.status === "paused" && commitment.activeUntilAgeInMonths !== undefined) {
    throw new FinancialLedgerInvariantError("INVALID_LEDGER", `V4 paused 支出义务 ${commitment.id} 不得写入结束时间`);
  }
  if (commitment.status === "ended" && commitment.activeUntilAgeInMonths === undefined) {
    throw new FinancialLedgerInvariantError("INVALID_LEDGER", `V4 ended 支出义务 ${commitment.id} 必须写入结束时间`);
  }
  if (commitment.plausibleMonthlyAmountRangeWan) {
    const [low, high] = commitment.plausibleMonthlyAmountRangeWan;
    assertFiniteNonNegative(low, `V4 支出义务 ${commitment.id}.plausibleMonthlyAmountRangeWan[0]`);
    assertFiniteNonNegative(high, `V4 支出义务 ${commitment.id}.plausibleMonthlyAmountRangeWan[1]`);
    if (low > high) {
      throw new FinancialLedgerInvariantError("INVALID_LEDGER", `V4 支出义务 ${commitment.id} 的金额范围下界不得大于上界`);
    }
  }
  if (commitment.grossMonthlyAmountWan !== undefined) {
    assertFiniteNonNegative(commitment.grossMonthlyAmountWan, `V4 支出义务 ${commitment.id}.grossMonthlyAmountWan`);
  }
  if (commitment.householdShareRate !== undefined) {
    if (!Number.isFinite(commitment.householdShareRate)
      || commitment.householdShareRate < 0
      || commitment.householdShareRate > 1) {
      throw new FinancialLedgerInvariantError("INVALID_LEDGER", `V4 支出义务 ${commitment.id}.householdShareRate 必须在 0-1 之间`);
    }
    if (commitment.grossMonthlyAmountWan !== undefined
      && Math.abs(commitment.monthlyAmountWan - roundWan(commitment.grossMonthlyAmountWan * commitment.householdShareRate)) > 0.0001) {
      throw new FinancialLedgerInvariantError("INVALID_LEDGER", `V4 支出义务 ${commitment.id} 的个人月计提必须等于总额乘以承担比例`);
    }
  }
  const explicit = commitment.amountBasis === "explicit_known" || commitment.amountBasis === "explicit_shared_amount";
  if (explicit) {
    if (commitment.confirmedMonthlyAmountWan === undefined) {
      throw new FinancialLedgerInvariantError("INVALID_LEDGER", `V4 明确金额支出 ${commitment.id} 缺少 confirmedMonthlyAmountWan`);
    }
    assertFiniteNonNegative(commitment.confirmedMonthlyAmountWan, `V4 支出义务 ${commitment.id}.confirmedMonthlyAmountWan`);
    if (Math.abs(commitment.monthlyAmountWan - commitment.confirmedMonthlyAmountWan) > 0.0001) {
      throw new FinancialLedgerInvariantError("INVALID_LEDGER", `V4 明确金额支出 ${commitment.id} 的计提与确认个人份额不一致`);
    }
    if (commitment.lastConfirmedAtAgeInMonths === undefined || commitment.evidence.length === 0) {
      throw new FinancialLedgerInvariantError("INVALID_LEDGER", `V4 明确金额支出 ${commitment.id} 缺少确认时间或责任证据`);
    }
    if (commitment.evidence.some((item) => item.financialScope === "business_operating" || item.financialScope === "third_party")) {
      throw new FinancialLedgerInvariantError("INVALID_LEDGER", `V4 明确金额支出 ${commitment.id} 不能以企业或第三方责任证据写入个人账本`);
    }
    if (commitment.amountBasis === "explicit_shared_amount" && commitment.financialScope !== "shared_household") {
      throw new FinancialLedgerInvariantError("INVALID_LEDGER", `V4 共同金额支出 ${commitment.id} 必须标记为 shared_household`);
    }
  }
  if (["contextual_estimate", "policy_floor", "legacy_estimate"].includes(commitment.amountBasis)
    && !commitment.estimationPolicyId) {
    throw new FinancialLedgerInvariantError("INVALID_LEDGER", `V4 估算支出 ${commitment.id} 缺少 estimationPolicyId 或迁移标识`);
  }
}

export function assertFinancialLedgerInvariants(ledger: FinancialLedger): void {
  if ((ledger.version !== 3 && ledger.version !== 4) || ledger.owner !== "protagonist" || ledger.currencyUnit !== "CNY_WAN_REAL") {
    throw new FinancialLedgerInvariantError("INVALID_LEDGER", "账本版本、所有者或币种单位无效");
  }
  if (!Number.isInteger(ledger.asOfAgeInMonths) || ledger.asOfAgeInMonths < 0) {
    throw new FinancialLedgerInvariantError("INVALID_LEDGER", "asOfAgeInMonths 必须是非负整数");
  }
  if (!Number.isInteger(ledger.revision) || ledger.revision < 0) {
    throw new FinancialLedgerInvariantError("INVALID_LEDGER", "revision 必须是非负整数");
  }

  assertUniqueIds(ledger.cashAccounts, "现金账户");
  assertUniqueIds(ledger.assetAccounts, "资产账户");
  assertUniqueIds(ledger.debtAccounts, "债务账户");
  assertUniqueIds(ledger.incomeSources, "收入来源");
  assertUniqueIds(ledger.expenseCommitments, "支出义务");
  assertUniqueIds(ledger.businessHoldings, "企业持股");
  if (new Set(ledger.committedTransactionIds).size !== ledger.committedTransactionIds.length) {
    throw new FinancialLedgerInvariantError("INVALID_LEDGER", "committedTransactionIds 不得重复");
  }

  ledger.cashAccounts.forEach((account) => assertFiniteNonNegative(account.balanceWan, `现金账户 ${account.id}.balanceWan`));
  if (!ledger.cashAccounts.some((account) => account.status === "active")) {
    throw new FinancialLedgerInvariantError("INVALID_LEDGER", "账本至少需要一个有效现金账户");
  }
  ledger.assetAccounts.forEach((account) => {
    assertFiniteNonNegative(account.marketValueWan, `资产账户 ${account.id}.marketValueWan`);
    if (account.status === "disposed" && account.marketValueWan !== 0) {
      throw new FinancialLedgerInvariantError("INVALID_LEDGER", `已处置资产 ${account.id} 的市值必须归零`);
    }
  });
  ledger.businessHoldings.forEach((holding) => {
    if (holding.instrumentType !== undefined && !["equity", "stock_option"].includes(holding.instrumentType)) {
      throw new FinancialLedgerInvariantError("INVALID_LEDGER", `企业持股 ${holding.id}.instrumentType 无效`);
    }
    assertFiniteNonNegative(holding.personalCarryingValueWan, `企业持股 ${holding.id}.personalCarryingValueWan`);
    if (holding.ownershipRate !== undefined && (holding.ownershipRate < 0 || holding.ownershipRate > 1)) {
      throw new FinancialLedgerInvariantError("INVALID_LEDGER", `企业持股 ${holding.id}.ownershipRate 必须在 0-1 之间`);
    }
    if (holding.attributableValueWan !== undefined) {
      assertFiniteNonNegative(holding.attributableValueWan, `企业持股 ${holding.id}.attributableValueWan`);
    }
    if (holding.liquidityDiscountRate !== undefined
      && (holding.liquidityDiscountRate < 0 || holding.liquidityDiscountRate > 1)) {
      throw new FinancialLedgerInvariantError("INVALID_LEDGER", `企业持股 ${holding.id}.liquidityDiscountRate 必须在 0-1 之间`);
    }
    if (holding.instrumentType === "stock_option") {
      const terms = holding.optionTerms;
      if (!terms) throw new FinancialLedgerInvariantError("INVALID_LEDGER", `期权 ${holding.id} 缺少 optionTerms`);
      [terms.grantedUnits, terms.vestedUnits, terms.exercisedUnits, terms.strikePriceWanPerUnit]
        .forEach((value, index) => assertFiniteNonNegative(value, `期权 ${holding.id}.optionTerms[${index}]`));
      if ((terms.grantedUnits === 0 && holding.factStatus !== "needs_review")
        || terms.vestedUnits > terms.grantedUnits || terms.exercisedUnits > terms.vestedUnits) {
        throw new FinancialLedgerInvariantError("INVALID_LEDGER", `期权 ${holding.id} 的授予、归属和行权数量不一致`);
      }
      if (terms.fairValueWanPerUnit !== undefined) assertFiniteNonNegative(terms.fairValueWanPerUnit, `期权 ${holding.id}.fairValueWanPerUnit`);
      if (terms.realizationRiskDiscountRate !== undefined
        && (terms.realizationRiskDiscountRate < 0 || terms.realizationRiskDiscountRate > 1)) {
        throw new FinancialLedgerInvariantError("INVALID_LEDGER", `期权 ${holding.id}.realizationRiskDiscountRate 必须在 0-1 之间`);
      }
      if (terms.vestedUnits === terms.exercisedUnits && holding.personalCarryingValueWan !== 0) {
        throw new FinancialLedgerInvariantError("INVALID_LEDGER", `没有剩余已归属单位的期权 ${holding.id} 账面价值必须为零`);
      }
    }
    if (["sold", "written_off", "exercised", "expired", "cancelled"].includes(holding.status) && holding.personalCarryingValueWan !== 0) {
      throw new FinancialLedgerInvariantError("INVALID_LEDGER", `已出售或核销持股 ${holding.id} 的个人账面价值必须归零`);
    }
  });
  ledger.debtAccounts.forEach((account) => {
    assertFiniteNonNegative(account.principalWan, `债务账户 ${account.id}.principalWan`);
    assertFiniteNonNegative(account.accruedUnpaidInterestWan ?? Number.NaN, `债务账户 ${account.id}.accruedUnpaidInterestWan`);
    if (!account.origin || !account.servicingStatus
      || account.consecutiveMissedPaymentMonths === undefined
      || account.totalMissedPaymentMonths === undefined
      || !account.recentMissedPaymentAgeInMonths) {
      throw new FinancialLedgerInvariantError("INVALID_LEDGER", `债务账户 ${account.id} 缺少 v3 偿付字段`);
    }
    if (!Number.isInteger(account.consecutiveMissedPaymentMonths) || account.consecutiveMissedPaymentMonths < 0
      || !Number.isInteger(account.totalMissedPaymentMonths) || account.totalMissedPaymentMonths < 0) {
      throw new FinancialLedgerInvariantError("INVALID_LEDGER", `债务账户 ${account.id} 的 missed counters 无效`);
    }
    if (account.totalMissedPaymentMonths < account.consecutiveMissedPaymentMonths) {
      throw new FinancialLedgerInvariantError("INVALID_LEDGER", `债务账户 ${account.id} 的连续 missed 不得超过累计 missed`);
    }
    if (account.recentMissedPaymentAgeInMonths.some((age) => !Number.isInteger(age) || age < 0)
      || new Set(account.recentMissedPaymentAgeInMonths).size !== account.recentMissedPaymentAgeInMonths.length) {
      throw new FinancialLedgerInvariantError("INVALID_LEDGER", `债务账户 ${account.id} 的 recent missed 月份无效`);
    }
    if (account.principalWan === 0 && account.accruedUnpaidInterestWan === 0
      && account.status !== "repaid" && account.status !== "restructured") {
      throw new FinancialLedgerInvariantError("INVALID_LEDGER", `债务账户 ${account.id} 归零后必须关闭`);
    }
    if ((account.status === "repaid" || account.status === "restructured")
      && (account.principalWan !== 0 || account.accruedUnpaidInterestWan !== 0)) {
      throw new FinancialLedgerInvariantError("INVALID_LEDGER", `已偿清或重组债务 ${account.id} 的本金和未付利息必须归零`);
    }
    if (["mortgage", "consumer_loan", "student_loan", "credit_balance"].includes(account.type)
      && account.status === "active"
      && account.repaymentPolicy.mode === "event_driven") {
      throw new FinancialLedgerInvariantError("INVALID_LEDGER", `标准债务 ${account.id} 必须使用已知或保守估算的摊还策略`);
    }
    for (const [key, value] of Object.entries(account.repaymentPolicy)) {
      if (key !== "mode" && value !== undefined && (!Number.isFinite(value) || value < 0)) {
        throw new FinancialLedgerInvariantError("INVALID_LEDGER", `债务 ${account.id} 的还款字段 ${key} 无效`);
      }
    }
  });
  ledger.incomeSources.forEach((source) => {
    if (!Number.isInteger(source.activeFromAgeInMonths) || source.activeFromAgeInMonths < 0) {
      throw new FinancialLedgerInvariantError("INVALID_LEDGER", `收入来源 ${source.id}.activeFromAgeInMonths 必须是非负整数`);
    }
    if (source.activeUntilAgeInMonths !== undefined
      && (!Number.isInteger(source.activeUntilAgeInMonths) || source.activeUntilAgeInMonths < source.activeFromAgeInMonths)) {
      throw new FinancialLedgerInvariantError("INVALID_LEDGER", `收入来源 ${source.id}.activeUntilAgeInMonths 无效`);
    }
    if (source.monthlyNetAmountWan !== undefined) assertFiniteNonNegative(source.monthlyNetAmountWan, `收入来源 ${source.id}.monthlyNetAmountWan`);
    if (source.annualNetAmountWan !== undefined) assertFiniteNonNegative(source.annualNetAmountWan, `收入来源 ${source.id}.annualNetAmountWan`);
  });
  ledger.expenseCommitments.forEach((commitment) => {
    if (!Number.isInteger(commitment.activeFromAgeInMonths) || commitment.activeFromAgeInMonths < 0) {
      throw new FinancialLedgerInvariantError("INVALID_LEDGER", `支出义务 ${commitment.id}.activeFromAgeInMonths 必须是非负整数`);
    }
    if (commitment.activeUntilAgeInMonths !== undefined
      && (!Number.isInteger(commitment.activeUntilAgeInMonths) || commitment.activeUntilAgeInMonths < commitment.activeFromAgeInMonths)) {
      throw new FinancialLedgerInvariantError("INVALID_LEDGER", `支出义务 ${commitment.id}.activeUntilAgeInMonths 无效`);
    }
    assertFiniteNonNegative(commitment.monthlyAmountWan, `支出义务 ${commitment.id}.monthlyAmountWan`);
  });

  if (isFinancialLedgerV4(ledger)) {
    const activeResponsibilityKeys = new Set<string>();
    for (const commitment of ledger.expenseCommitments) {
      assertV4ExpenseCommitment(commitment);
      if (commitment.status !== "active") continue;
      if (activeResponsibilityKeys.has(commitment.responsibilityKey)) {
        throw new FinancialLedgerInvariantError("INVALID_LEDGER", `V4 active 支出责任不得重复: ${commitment.responsibilityKey}`);
      }
      activeResponsibilityKeys.add(commitment.responsibilityKey);
    }
  }

  if (totalCashWan(ledger) < 0) {
    throw new FinancialLedgerInvariantError("MISSING_FUNDING_SOURCE", "已提交账本现金不得为负");
  }
}

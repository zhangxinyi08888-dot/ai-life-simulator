import type { FinancialFactStatus, FinancialLedger } from "./types";

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
    .reduce((sum, account) => sum + account.principalWan, 0));
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

export function assertFinancialLedgerInvariants(ledger: FinancialLedger): void {
  if (ledger.version !== 2 || ledger.owner !== "protagonist" || ledger.currencyUnit !== "CNY_WAN_REAL") {
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
      if (terms.grantedUnits <= 0 || terms.vestedUnits > terms.grantedUnits || terms.exercisedUnits > terms.vestedUnits) {
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
    if (account.principalWan === 0 && account.status !== "repaid" && account.status !== "restructured") {
      throw new FinancialLedgerInvariantError("INVALID_LEDGER", `债务账户 ${account.id} 归零后必须关闭`);
    }
    if ((account.status === "repaid" || account.status === "restructured") && account.principalWan !== 0) {
      throw new FinancialLedgerInvariantError("INVALID_LEDGER", `已偿清或重组债务 ${account.id} 的本金必须归零`);
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
    if (source.monthlyNetAmountWan !== undefined) assertFiniteNonNegative(source.monthlyNetAmountWan, `收入来源 ${source.id}.monthlyNetAmountWan`);
    if (source.annualNetAmountWan !== undefined) assertFiniteNonNegative(source.annualNetAmountWan, `收入来源 ${source.id}.annualNetAmountWan`);
  });
  ledger.expenseCommitments.forEach((commitment) => assertFiniteNonNegative(commitment.monthlyAmountWan, `支出义务 ${commitment.id}.monthlyAmountWan`));

  if (totalCashWan(ledger) < 0) {
    throw new FinancialLedgerInvariantError("MISSING_FUNDING_SOURCE", "已提交账本现金不得为负");
  }
}

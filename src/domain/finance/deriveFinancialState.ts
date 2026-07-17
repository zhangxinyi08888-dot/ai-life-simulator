import type { EmploymentStatus, FinancialState, IncomeStability } from "../../types";
import { ledgerNetWorthWan, roundWan, totalCashWan, totalDebtWan, weakestFactStatus } from "./ledgerMath";
import type { DerivedFinancialStateResult, DerivedFinancialStateV2, FinancialFactStatus, FinancialLedger, FinancialPeriodSummary } from "./types";

function annualizedIncome(ledger: FinancialLedger): number {
  return roundWan(ledger.incomeSources
    .filter((source) => source.status === "active"
      && source.accrualPolicy !== "event_only"
      && source.activeFromAgeInMonths <= ledger.asOfAgeInMonths
      && (source.activeUntilAgeInMonths === undefined || source.activeUntilAgeInMonths > ledger.asOfAgeInMonths))
    .reduce((sum, source) => sum + (
      source.accrualPolicy === "annual"
        ? source.annualNetAmountWan || 0
        : (source.monthlyNetAmountWan || 0) * 12
    ), 0));
}

function annualizedCoreExpense(ledger: FinancialLedger): number {
  return roundWan(ledger.expenseCommitments
    .filter((commitment) => commitment.status === "active"
      && commitment.activeFromAgeInMonths <= ledger.asOfAgeInMonths
      && (commitment.activeUntilAgeInMonths === undefined || commitment.activeUntilAgeInMonths > ledger.asOfAgeInMonths))
    .reduce((sum, commitment) => sum + commitment.monthlyAmountWan * 12, 0));
}

function annualizedDebtInterest(ledger: FinancialLedger): number {
  return roundWan(ledger.debtAccounts
    .filter((debt) => debt.status === "active" || debt.status === "defaulted")
    .reduce((sum, debt) => {
      if (debt.repaymentPolicy.monthlyInterestWan !== undefined) return sum + debt.repaymentPolicy.monthlyInterestWan * 12;
      if (debt.repaymentPolicy.annualInterestRate !== undefined) return sum + debt.principalWan * debt.repaymentPolicy.annualInterestRate;
      return sum;
    }, 0));
}

function deriveIncomeStability(ledger: FinancialLedger): IncomeStability {
  const active = ledger.incomeSources.filter((source) => source.status === "active"
    && source.accrualPolicy !== "event_only"
    && source.activeFromAgeInMonths <= ledger.asOfAgeInMonths
    && (source.activeUntilAgeInMonths === undefined || source.activeUntilAgeInMonths > ledger.asOfAgeInMonths));
  if (!active.length) return "unstable";
  if (active.some((source) => source.factStatus === "unknown" || source.factStatus === "needs_review")) return "volatile";
  if (active.some((source) => source.type === "contract" || source.type === "self_employment_draw" || source.type === "royalty")) return "volatile";
  return active.length >= 2 ? "very_stable" : "stable";
}

function deriveFactStatus(ledger: FinancialLedger): FinancialFactStatus {
  const statuses = [
    ...ledger.cashAccounts.map((account) => account.factStatus),
    ...ledger.assetAccounts.map((account) => account.factStatus),
    ...ledger.debtAccounts.map((account) => account.factStatus),
    ...ledger.incomeSources.map((source) => source.factStatus),
    ...ledger.expenseCommitments.map((commitment) => commitment.factStatus),
    ...ledger.businessHoldings.map((holding) => holding.factStatus)
  ];
  return weakestFactStatus(statuses);
}

export function deriveFinancialState(input: {
  ledger: FinancialLedger;
  periodSummary?: FinancialPeriodSummary;
  employmentStatus: EmploymentStatus;
}): DerivedFinancialStateResult {
  const { ledger } = input;
  const investmentAssetsWan = roundWan(ledger.assetAccounts
    .filter((account) => account.status === "active" && ["investment", "annuity", "insurance_cash_value"].includes(account.type))
    .reduce((sum, account) => sum + account.marketValueWan, 0));
  const propertyMarketValueWan = roundWan(ledger.assetAccounts
    .filter((account) => account.status === "active" && account.type === "property")
    .reduce((sum, account) => sum + account.marketValueWan, 0));
  const businessAndOtherAssetsWan = roundWan(ledger.assetAccounts
    .filter((account) => account.status === "active" && account.type === "other_personal_asset")
    .reduce((sum, account) => sum + account.marketValueWan, 0)
    + ledger.businessHoldings
      .filter((holding) => holding.status === "active" || holding.status === "partially_sold")
      .reduce((sum, holding) => sum + holding.personalCarryingValueWan, 0));
  const annualizedRecurringIncomeWan = annualizedIncome(ledger);
  const annualizedCoreExpenseWan = annualizedCoreExpense(ledger);
  const annualizedDisposableCashFlowWan = roundWan(
    annualizedRecurringIncomeWan - annualizedCoreExpenseWan - annualizedDebtInterest(ledger)
  );
  const state: DerivedFinancialStateV2 = {
    currencyUnit: "CNY_WAN_REAL",
    asOfAgeInMonths: ledger.asOfAgeInMonths,
    cashWan: totalCashWan(ledger),
    investmentAssetsWan,
    propertyMarketValueWan,
    businessAndOtherAssetsWan,
    totalDebtWan: totalDebtWan(ledger),
    netWorthWan: ledgerNetWorthWan(ledger),
    periodIncomeWan: input.periodSummary?.incomeWan || 0,
    periodCoreExpenseWan: input.periodSummary?.coreExpenseWan || 0,
    periodOtherExpenseWan: input.periodSummary?.otherExpenseWan || 0,
    periodNetCashFlowWan: input.periodSummary?.netCashFlowWan || 0,
    annualizedRecurringIncomeWan,
    annualizedCoreExpenseWan,
    annualizedDisposableCashFlowWan,
    employmentStatus: input.employmentStatus,
    incomeStability: deriveIncomeStability(ledger),
    factStatus: deriveFactStatus(ledger),
    unresolvedIssueCodes: [...new Set(ledger.unresolvedIssues.map((issue) => issue.code))],
    ledgerRevision: ledger.revision
  };
  const compatibilityState: FinancialState = {
    currencyUnit: state.currencyUnit,
    asOfAgeInMonths: state.asOfAgeInMonths,
    cashWan: state.cashWan,
    investmentAssetsWan: state.investmentAssetsWan,
    propertyMarketValueWan: state.propertyMarketValueWan,
    businessAndOtherAssetsWan: state.businessAndOtherAssetsWan,
    totalDebtWan: state.totalDebtWan,
    netWorthWan: state.netWorthWan,
    annualAfterTaxIncomeWan: state.annualizedRecurringIncomeWan,
    annualDisposableIncomeWan: state.annualizedDisposableCashFlowWan,
    annualCoreExpenseWan: state.annualizedCoreExpenseWan,
    employmentStatus: state.employmentStatus,
    incomeStability: state.incomeStability,
    isEstimated: state.factStatus !== "known"
  };
  return { state, compatibilityState };
}

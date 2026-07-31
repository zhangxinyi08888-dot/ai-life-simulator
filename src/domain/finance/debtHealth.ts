import { roundWan, totalCashWan } from "./ledgerMath";
import type { DebtAccount, DerivedFinancialStateV2, FinancialLedger } from "./types";
import { isDebtCrisisEligibleAccount } from "./financialFactEligibility";

export type DebtHealthLevel =
  | "none"
  | "manageable"
  | "watch"
  | "distressed"
  | "default_risk"
  | "defaulted"
  | "unknown";

export type DebtTrend = "improving" | "stable" | "worsening" | "unknown";

export type DebtHealthReasonCode =
  | "NO_ACTIVE_DEBT"
  | "PAYMENTS_CURRENT"
  | "LOW_DEBT_SERVICE_COVERAGE"
  | "NEGATIVE_DISPOSABLE_CASHFLOW"
  | "LOW_CASH_BUFFER"
  | "LIQUIDITY_SHORTFALL_PRESENT"
  | "LIQUIDITY_SHORTFALL_GROWING"
  | "RECENT_PARTIAL_PAYMENT"
  | "RECENT_MISSED_PAYMENT"
  | "CONSECUTIVE_MISSED_PAYMENTS"
  | "BALANCE_REMAINS_AFTER_TERM"
  | "FORMAL_DEFAULT_RECORDED"
  | "DEBT_BALANCE_IMPROVING"
  | "COVERAGE_IMPROVING"
  | "RESTRUCTURING_ACCEPTED_NOT_YET_PROVEN"
  | "INSUFFICIENT_RELIABLE_FACTS";

export interface DebtHealthState {
  asOfAgeInMonths: number;
  level: DebtHealthLevel;
  trend: DebtTrend;
  totalDebtWan: number;
  scheduledDebtServiceNext12MonthsWan: number;
  availableCashForDebtNext12MonthsWan: number;
  debtServiceCoverageRatio?: number;
  cashBufferMonths?: number;
  liquidityShortfallDebtWan: number;
  consecutiveMissedPaymentMonths: number;
  missedPaymentMonthsLast12: number;
  activeDefaultedDebtCount: number;
  reasonCodes: DebtHealthReasonCode[];
  source: "authoritative_ledger" | "legacy_compatibility";
  sourceLedgerRevision?: number;
  /** Closing-period servicing facts consumed by the debt arc; absent on legacy snapshots. */
  latestDebtServiceHasUnpaidAmount?: boolean;
  hasOpenDelinquentIssue?: boolean;
}

export const DEFAULT_DEBT_HEALTH_POLICY = Object.freeze({
  watchCoverageRatio: 1.2,
  distressedCoverageRatio: 1,
  delinquentMonths: 2,
  persistentShortfallMonths: 6,
  worseningShortfallIncreaseCount: 2,
  cashBufferWatchMonths: 1
});

export interface DeriveDebtHealthInput {
  ledger: FinancialLedger;
  derivedFinancialState: DerivedFinancialStateV2;
  previousDebtHealthState?: Partial<DebtHealthState>;
}

interface LegacyFinancialState {
  totalDebtWan?: number;
  isEstimated?: boolean;
  asOfAgeInMonths?: number;
}

function isActiveAtMonth(item: {
  status: string;
  activeFromAgeInMonths: number;
  activeUntilAgeInMonths?: number;
}, month: number): boolean {
  return item.status === "active"
    && item.activeFromAgeInMonths <= month
    && (item.activeUntilAgeInMonths === undefined || item.activeUntilAgeInMonths > month);
}

function monthlyIncomeWan(ledger: FinancialLedger, month: number): number {
  return ledger.incomeSources.reduce((sum, source) => {
    if (!isActiveAtMonth(source, month)
      || source.accrualPolicy === "event_only"
      || source.accrualReviewStatus === "quarantined") return sum;
    const amount = source.accrualPolicy === "annual"
      ? (source.annualNetAmountWan ?? 0) / 12
      : source.monthlyNetAmountWan ?? 0;
    return sum + amount;
  }, 0);
}

function monthlyNonDebtExpenseWan(ledger: FinancialLedger, month: number): number {
  return ledger.expenseCommitments.reduce((sum, commitment) => (
    isActiveAtMonth(commitment, month) ? sum + commitment.monthlyAmountWan : sum
  ), 0);
}

function scheduledDebtServiceForAccount(debt: DebtAccount): number {
  if ((debt.status !== "active" && debt.status !== "defaulted")
    || debt.repaymentPolicy.mode === "event_driven") return 0;

  const policy = debt.repaymentPolicy;
  let principal = debt.principalWan;
  let unpaidInterest = debt.accruedUnpaidInterestWan ?? 0;
  const scheduledMonths = Math.min(12, policy.remainingTermMonths ?? 12);
  let total = 0;
  for (let index = 0; index < scheduledMonths && principal > 0; index += 1) {
    const scheduledInterest = policy.monthlyInterestWan
      ?? (policy.annualInterestRate !== undefined ? principal * policy.annualInterestRate / 12 : 0);
    const principalDue = Math.min(principal, policy.monthlyPrincipalWan
      ?? (policy.monthlyPaymentWan !== undefined
        ? Math.max(0, policy.monthlyPaymentWan - scheduledInterest)
        : policy.remainingTermMonths && policy.remainingTermMonths > 0
          ? principal / Math.max(1, policy.remainingTermMonths - index)
          : 0));
    total += unpaidInterest + scheduledInterest + principalDue;
    // The horizon measures the contractual schedule, not a forecast of
    // another missed payment, so carried interest is counted only once.
    unpaidInterest = 0;
    principal = Math.max(0, principal - principalDue);
  }
  return roundWan(total);
}

function recentMissedMonths(ledger: FinancialLedger, eligibleDebts: DebtAccount[]): number {
  const cutoff = ledger.asOfAgeInMonths - 12;
  const ages = new Set<number>();
  let persistedFallback = 0;
  const eligibleIds = new Set(eligibleDebts.map((debt) => debt.id));
  for (const debt of eligibleDebts) {
    for (const age of debt.recentMissedPaymentAgeInMonths ?? []) {
      if (age > cutoff && age <= ledger.asOfAgeInMonths) ages.add(age);
    }
    persistedFallback = Math.max(persistedFallback, Math.min(12, debt.consecutiveMissedPaymentMonths ?? 0));
  }
  for (const transaction of ledger.recentTransactions) {
    for (const record of transaction.debtServiceRecords ?? []) {
      if (eligibleIds.has(record.debtAccountId) && record.outcome !== "paid" && record.ageInMonths > cutoff && record.ageInMonths <= ledger.asOfAgeInMonths) {
        ages.add(record.ageInMonths);
      }
    }
  }
  return Math.max(ages.size, persistedFallback);
}

function shortfallIncreaseCount(ledger: FinancialLedger): number {
  const cutoff = ledger.asOfAgeInMonths - DEFAULT_DEBT_HEALTH_POLICY.persistentShortfallMonths;
  return ledger.recentTransactions.filter((transaction) => (
    transaction.periodEndAgeInMonths > cutoff
      && transaction.periodEndAgeInMonths <= ledger.asOfAgeInMonths
      && (transaction.automaticLiquidityShortfallIncreaseWan ?? 0) > 0
  )).length;
}

function deriveTrend(
  current: Omit<DebtHealthState, "trend" | "reasonCodes">,
  previous: Partial<DebtHealthState> | undefined,
  reasonCodes: DebtHealthReasonCode[]
): DebtTrend {
  if (!previous || previous.source !== "authoritative_ledger") return "unknown";

  const previousMissed = previous.consecutiveMissedPaymentMonths ?? 0;
  if (current.consecutiveMissedPaymentMonths > previousMissed
    || current.liquidityShortfallDebtWan > (previous.liquidityShortfallDebtWan ?? 0)) return "worsening";

  if (current.consecutiveMissedPaymentMonths === 0) {
    if (current.totalDebtWan < (previous.totalDebtWan ?? current.totalDebtWan)) {
      reasonCodes.push("DEBT_BALANCE_IMPROVING");
      return "improving";
    }
    const previousCoverage = previous.debtServiceCoverageRatio;
    if (current.debtServiceCoverageRatio !== undefined
      && previousCoverage !== undefined
      && current.debtServiceCoverageRatio > previousCoverage) {
      reasonCodes.push("COVERAGE_IMPROVING");
      return "improving";
    }
    // Clearing a previously persisted missed-payment run is itself evidence
    // of improvement, provided the closing account is now current.
    if (previousMissed > 0) {
      reasonCodes.push("COVERAGE_IMPROVING");
      return "improving";
    }
  }
  return "stable";
}

function hasReliableDebtFacts(debts: DebtAccount[]): boolean {
  return debts.some((debt) => {
    const factReliable = debt.factStatus === "known" || debt.factStatus === "estimated";
    const scheduleReliable = debt.repaymentPolicy.mode !== "event_driven"
      || debt.origin === "system_auto_shortfall"
      || (debt.recentMissedPaymentAgeInMonths?.length ?? 0) > 0
      || (debt.totalMissedPaymentMonths ?? 0) > 0;
    return factReliable && scheduleReliable;
  });
}

export function deriveDebtHealthState(input: DeriveDebtHealthInput): DebtHealthState {
  const { ledger, previousDebtHealthState } = input;
  const activeDebts = ledger.debtAccounts.filter((debt) => (
    isDebtCrisisEligibleAccount(debt)
      && debt.principalWan + (debt.accruedUnpaidInterestWan ?? 0) > 0
  ));
  const totalDebt = roundWan(activeDebts.reduce(
    (sum, debt) => sum + debt.principalWan + (debt.accruedUnpaidInterestWan ?? 0), 0
  ));
  const scheduledDebtService = roundWan(activeDebts.reduce(
    (sum, debt) => sum + scheduledDebtServiceForAccount(debt), 0
  ));

  let incomeInHorizon = 0;
  let expenseInHorizon = 0;
  for (let offset = 0; offset < 12; offset += 1) {
    const month = ledger.asOfAgeInMonths + offset;
    incomeInHorizon += monthlyIncomeWan(ledger, month);
    expenseInHorizon += monthlyNonDebtExpenseWan(ledger, month);
  }
  incomeInHorizon = roundWan(incomeInHorizon);
  expenseInHorizon = roundWan(expenseInHorizon);
  const currentCash = totalCashWan(ledger);
  const rawAvailableCash = roundWan(currentCash + incomeInHorizon - expenseInHorizon);
  const availableCash = Math.max(0, rawAvailableCash);
  const coverage = scheduledDebtService > 0
    ? roundWan(availableCash / scheduledDebtService)
    : undefined;
  const currentMonthlyExpense = roundWan(monthlyNonDebtExpenseWan(ledger, ledger.asOfAgeInMonths));
  const cashBufferMonths = currentMonthlyExpense > 0
    ? roundWan(currentCash / currentMonthlyExpense)
    : undefined;
  const liquidityShortfallDebtWan = roundWan(activeDebts
    .filter((debt) => debt.type === "liquidity_shortfall")
    .reduce((sum, debt) => sum + debt.principalWan + (debt.accruedUnpaidInterestWan ?? 0), 0));
  const consecutiveMissedPaymentMonths = activeDebts.reduce(
    (max, debt) => Math.max(max, debt.consecutiveMissedPaymentMonths ?? 0), 0
  );
  const missedPaymentMonthsLast12 = recentMissedMonths(ledger, activeDebts);
  const activeDefaultedDebtCount = activeDebts.filter((debt) => debt.status === "defaulted").length;
  const shortfallIncreases = shortfallIncreaseCount(ledger);
  const hasPartial = activeDebts.some((debt) => debt.servicingStatus === "partial");
  const hasMissed = activeDebts.some((debt) => debt.servicingStatus === "missed");
  const hasDelinquentIssue = ledger.unresolvedIssues.some((issue) => (
    issue.code === "DEBT_PAYMENT_DELINQUENT"
    && (issue.status ?? "open") === "open"
    && (issue.lastObservedAtAgeInMonths ?? issue.createdAtAgeInMonths) > ledger.asOfAgeInMonths - 12
  ));
  const balanceAfterTerm = activeDebts.some((debt) => (
    debt.repaymentPolicy.mode !== "event_driven"
      && debt.repaymentPolicy.remainingTermMonths === 0
      && debt.principalWan + (debt.accruedUnpaidInterestWan ?? 0) > 0
  ));

  const reasonCodes: DebtHealthReasonCode[] = [];
  let level: DebtHealthLevel;
  if (activeDebts.length === 0 || totalDebt === 0) {
    level = "none";
    reasonCodes.push("NO_ACTIVE_DEBT");
  } else if (!hasReliableDebtFacts(activeDebts)) {
    level = "unknown";
    reasonCodes.push("INSUFFICIENT_RELIABLE_FACTS");
  } else if (activeDefaultedDebtCount > 0) {
    level = "defaulted";
    reasonCodes.push("FORMAL_DEFAULT_RECORDED");
  } else if (consecutiveMissedPaymentMonths >= DEFAULT_DEBT_HEALTH_POLICY.delinquentMonths
    || balanceAfterTerm || hasDelinquentIssue) {
    level = "default_risk";
    reasonCodes.push(consecutiveMissedPaymentMonths >= DEFAULT_DEBT_HEALTH_POLICY.delinquentMonths
      ? "CONSECUTIVE_MISSED_PAYMENTS"
      : balanceAfterTerm ? "BALANCE_REMAINS_AFTER_TERM" : "CONSECUTIVE_MISSED_PAYMENTS");
  } else if (hasPartial || hasMissed || shortfallIncreases >= DEFAULT_DEBT_HEALTH_POLICY.worseningShortfallIncreaseCount
    || (coverage !== undefined && coverage < DEFAULT_DEBT_HEALTH_POLICY.distressedCoverageRatio && rawAvailableCash >= 0)) {
    level = "distressed";
    if (hasPartial) reasonCodes.push("RECENT_PARTIAL_PAYMENT");
    if (hasMissed) reasonCodes.push("RECENT_MISSED_PAYMENT");
    if (shortfallIncreases >= DEFAULT_DEBT_HEALTH_POLICY.worseningShortfallIncreaseCount) {
      reasonCodes.push("LIQUIDITY_SHORTFALL_GROWING");
    }
    if (coverage !== undefined && coverage < DEFAULT_DEBT_HEALTH_POLICY.distressedCoverageRatio) {
      reasonCodes.push("LOW_DEBT_SERVICE_COVERAGE");
    }
  } else if ((coverage !== undefined && coverage < DEFAULT_DEBT_HEALTH_POLICY.watchCoverageRatio)
    || rawAvailableCash < 0
    || (cashBufferMonths !== undefined && cashBufferMonths < DEFAULT_DEBT_HEALTH_POLICY.cashBufferWatchMonths)
    || liquidityShortfallDebtWan > 0) {
    level = "watch";
    if (coverage !== undefined && coverage < DEFAULT_DEBT_HEALTH_POLICY.watchCoverageRatio) {
      reasonCodes.push("LOW_DEBT_SERVICE_COVERAGE");
    }
    if (rawAvailableCash < 0) reasonCodes.push("NEGATIVE_DISPOSABLE_CASHFLOW");
    if (cashBufferMonths !== undefined && cashBufferMonths < DEFAULT_DEBT_HEALTH_POLICY.cashBufferWatchMonths) {
      reasonCodes.push("LOW_CASH_BUFFER");
    }
    if (liquidityShortfallDebtWan > 0) reasonCodes.push("LIQUIDITY_SHORTFALL_PRESENT");
  } else {
    level = "manageable";
    reasonCodes.push("PAYMENTS_CURRENT");
  }

  const withoutTrend: Omit<DebtHealthState, "trend" | "reasonCodes"> = {
    asOfAgeInMonths: ledger.asOfAgeInMonths,
    level,
    totalDebtWan: totalDebt,
    scheduledDebtServiceNext12MonthsWan: scheduledDebtService,
    availableCashForDebtNext12MonthsWan: roundWan(availableCash),
    debtServiceCoverageRatio: coverage,
    cashBufferMonths,
    liquidityShortfallDebtWan,
    consecutiveMissedPaymentMonths,
    missedPaymentMonthsLast12,
    activeDefaultedDebtCount,
    source: "authoritative_ledger",
    sourceLedgerRevision: ledger.revision
  };
  const trend = deriveTrend(withoutTrend, previousDebtHealthState, reasonCodes);
  return { ...withoutTrend, trend, reasonCodes: [...new Set(reasonCodes)] };
}

export function deriveLegacyCompatibleDebtHealthState(input: {
  financialState?: LegacyFinancialState;
  asOfAgeInMonths?: number;
}): DebtHealthState {
  const state = input.financialState;
  const reliablyDebtFree = state?.isEstimated === false && state.totalDebtWan === 0;
  return {
    asOfAgeInMonths: input.asOfAgeInMonths ?? state?.asOfAgeInMonths ?? 0,
    level: reliablyDebtFree ? "none" : "unknown",
    trend: "unknown",
    totalDebtWan: Math.max(0, state?.totalDebtWan ?? 0),
    scheduledDebtServiceNext12MonthsWan: 0,
    availableCashForDebtNext12MonthsWan: 0,
    liquidityShortfallDebtWan: 0,
    consecutiveMissedPaymentMonths: 0,
    missedPaymentMonthsLast12: 0,
    activeDefaultedDebtCount: 0,
    reasonCodes: [reliablyDebtFree ? "NO_ACTIVE_DEBT" : "INSUFFICIENT_RELIABLE_FACTS"],
    source: "legacy_compatibility"
  };
}

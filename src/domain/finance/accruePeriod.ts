import { FinancialLedgerInvariantError, PRIMARY_CASH_ACCOUNT_ID, roundWan } from "./ledgerMath";
import type { DebtServiceRecord, FinancialLedger } from "./types";

export interface PeriodAccrual {
  incomeWan: number;
  coreExpenseWan: number;
  debtPrincipalPaidWan: number;
  debtInterestPaidWan: number;
  debtInterestAccruedWan: number;
  debtInterestUnpaidWan: number;
  automaticLiquidityShortfallRecoveryWan: number;
  debtServiceRecords: DebtServiceRecord[];
}

export interface AccruePeriodOptions {
  /** Floors a deficit caused by recurring non-debt obligations before debt service. */
  closeNonDebtLiquidityShortfall?: (ageInMonths: number) => void;
  /** Repays only system-created liquidity shortfall from cash above the reserve target. */
  recoverAutomaticLiquidityShortfall?: (ageInMonths: number) => number;
  /** A restructuring effective at this boundary supersedes that month's old schedule. */
  excludedDebtAccountIds?: ReadonlySet<string>;
}

function overlaps(input: { start: number; end: number; activeFrom: number; activeUntil?: number }): number {
  const overlapStart = Math.max(input.start, input.activeFrom);
  const overlapEnd = Math.min(input.end, input.activeUntil ?? input.end);
  return Math.max(0, overlapEnd - overlapStart);
}

function primaryCashAccount(ledger: FinancialLedger) {
  const account = ledger.cashAccounts.find((item) => item.id === PRIMARY_CASH_ACCOUNT_ID && item.status === "active")
    || ledger.cashAccounts.find((item) => item.status === "active");
  if (!account) throw new FinancialLedgerInvariantError("INVALID_LEDGER", "自动结算需要一个有效现金账户");
  return account;
}

function accrueIncomeAndEssentials(ledger: FinancialLedger, start: number, end: number): { incomeWan: number; coreExpenseWan: number } {
  let incomeWan = 0;
  for (const source of ledger.incomeSources) {
    if (source.status !== "active" || source.accrualPolicy === "event_only" || source.accrualReviewStatus === "quarantined") continue;
    const months = overlaps({ start, end, activeFrom: source.activeFromAgeInMonths, activeUntil: source.activeUntilAgeInMonths });
    const monthlyAmount = source.accrualPolicy === "annual" ? (source.annualNetAmountWan || 0) / 12 : source.monthlyNetAmountWan || 0;
    incomeWan += monthlyAmount * months;
  }
  let coreExpenseWan = 0;
  for (const commitment of ledger.expenseCommitments) {
    if (commitment.status !== "active") continue;
    const months = overlaps({ start, end, activeFrom: commitment.activeFromAgeInMonths, activeUntil: commitment.activeUntilAgeInMonths });
    coreExpenseWan += commitment.monthlyAmountWan * months;
  }
  return { incomeWan: roundWan(incomeWan), coreExpenseWan: roundWan(coreExpenseWan) };
}

function serviceDebtForMonth(
  ledger: FinancialLedger,
  ageInMonths: number,
  excludedDebtAccountIds: ReadonlySet<string>
): { records: DebtServiceRecord[]; currentInterestAccruedWan: number } {
  const cash = primaryCashAccount(ledger);
  const records: DebtServiceRecord[] = [];
  let currentInterestAccruedWan = 0;
  for (const debt of ledger.debtAccounts) {
    if (debt.status !== "active" || debt.repaymentPolicy.mode === "event_driven" || excludedDebtAccountIds.has(debt.id)) continue;
    if (ageInMonths <= debt.openedAtAgeInMonths || (debt.closedAtAgeInMonths !== undefined && ageInMonths > debt.closedAtAgeInMonths)) continue;

    const policy = debt.repaymentPolicy;
    const scheduledInterestWan = roundWan(policy.monthlyInterestWan
      ?? (policy.annualInterestRate !== undefined ? debt.principalWan * policy.annualInterestRate / 12 : 0));
    currentInterestAccruedWan = roundWan(currentInterestAccruedWan + scheduledInterestWan);
    const scheduledPrincipalWan = roundWan(Math.min(debt.principalWan, policy.monthlyPrincipalWan
      ?? (policy.monthlyPaymentWan !== undefined
        ? Math.max(0, policy.monthlyPaymentWan - scheduledInterestWan)
        : policy.remainingTermMonths && policy.remainingTermMonths > 0
          ? debt.principalWan / policy.remainingTermMonths
          : 0)));
    const interestDueWan = roundWan((debt.accruedUnpaidInterestWan ?? 0) + scheduledInterestWan);
    const principalDueWan = scheduledPrincipalWan;
    if (interestDueWan <= 0 && principalDueWan <= 0) {
      throw new FinancialLedgerInvariantError("INVALID_LEDGER", `债务 ${debt.id} 的自动还款策略无法产生有效支付`);
    }

    // Debt service may consume cash, but is never itself eligible for an
    // automatic shortfall draw. Interest is senior to scheduled principal.
    const interestPaidWan = roundWan(Math.min(Math.max(0, cash.balanceWan), interestDueWan));
    cash.balanceWan = roundWan(cash.balanceWan - interestPaidWan);
    const interestUnpaidWan = roundWan(interestDueWan - interestPaidWan);
    const principalPaidWan = interestUnpaidWan === 0
      ? roundWan(Math.min(Math.max(0, cash.balanceWan), principalDueWan))
      : 0;
    cash.balanceWan = roundWan(cash.balanceWan - principalPaidWan);
    const principalUnpaidWan = roundWan(principalDueWan - principalPaidWan);
    debt.accruedUnpaidInterestWan = interestUnpaidWan;
    debt.principalWan = roundWan(debt.principalWan - principalPaidWan);

    const totalDueWan = roundWan(interestDueWan + principalDueWan);
    const totalPaidWan = roundWan(interestPaidWan + principalPaidWan);
    const outcome: DebtServiceRecord["outcome"] = totalPaidWan >= totalDueWan
      ? "paid"
      : totalPaidWan === 0 ? "missed" : "partial";
    if (outcome === "paid") {
      debt.servicingStatus = "current";
      debt.consecutiveMissedPaymentMonths = 0;
      debt.lastPaymentAtAgeInMonths = ageInMonths;
    } else {
      debt.consecutiveMissedPaymentMonths = (debt.consecutiveMissedPaymentMonths ?? 0) + 1;
      debt.totalMissedPaymentMonths = (debt.totalMissedPaymentMonths ?? 0) + 1;
      debt.recentMissedPaymentAgeInMonths = [...new Set([
        ...(debt.recentMissedPaymentAgeInMonths ?? []).filter((age) => age > ageInMonths - 12),
        ageInMonths
      ])];
      debt.lastMissedPaymentAtAgeInMonths = ageInMonths;
      debt.servicingStatus = debt.consecutiveMissedPaymentMonths >= 2
        ? "delinquent"
        : outcome === "missed" ? "missed" : "partial";
      if (totalPaidWan > 0) debt.lastPaymentAtAgeInMonths = ageInMonths;
    }
    if (policy.remainingTermMonths !== undefined) {
      policy.remainingTermMonths = Math.max(0, policy.remainingTermMonths - 1);
    }
    if (debt.principalWan === 0 && debt.accruedUnpaidInterestWan === 0) {
      debt.status = "repaid";
      debt.closedAtAgeInMonths = ageInMonths;
    }
    records.push({
      id: `debt_service_${debt.id}_${ageInMonths}`,
      debtAccountId: debt.id,
      ageInMonths,
      interestDueWan,
      currentInterestAccruedWan: scheduledInterestWan,
      interestPaidWan,
      interestUnpaidWan,
      principalDueWan,
      principalPaidWan,
      principalUnpaidWan,
      outcome,
      reasonCodes: outcome === "paid"
        ? ["PAID_AS_SCHEDULED"]
        : outcome === "missed"
          ? ["DEBT_PAYMENT_MISSED", "INSUFFICIENT_CASH_AFTER_ESSENTIALS"]
          : ["PARTIAL_PAYMENT", "INSUFFICIENT_CASH_AFTER_ESSENTIALS"]
    });
  }
  return { records, currentInterestAccruedWan };
}

export function accruePeriodSlice(
  ledger: FinancialLedger,
  periodStartAgeInMonths: number,
  periodEndAgeInMonths: number,
  options: AccruePeriodOptions = {}
): PeriodAccrual {
  if (periodEndAgeInMonths < periodStartAgeInMonths) {
    throw new FinancialLedgerInvariantError("INVALID_LEDGER", "结算阶段结束时间不能早于开始时间");
  }
  const result: PeriodAccrual = {
    incomeWan: 0,
    coreExpenseWan: 0,
    debtPrincipalPaidWan: 0,
    debtInterestPaidWan: 0,
    debtInterestAccruedWan: 0,
    debtInterestUnpaidWan: 0,
    automaticLiquidityShortfallRecoveryWan: 0,
    debtServiceRecords: []
  };
  const cash = primaryCashAccount(ledger);
  for (let start = periodStartAgeInMonths; start < periodEndAgeInMonths; start += 1) {
    const end = Math.min(start + 1, periodEndAgeInMonths);
    const nonDebt = accrueIncomeAndEssentials(ledger, start, end);
    cash.balanceWan = roundWan(cash.balanceWan + nonDebt.incomeWan - nonDebt.coreExpenseWan);
    result.incomeWan = roundWan(result.incomeWan + nonDebt.incomeWan);
    result.coreExpenseWan = roundWan(result.coreExpenseWan + nonDebt.coreExpenseWan);
    options.closeNonDebtLiquidityShortfall?.(end);
    const unpaidBeforeWan = roundWan(ledger.debtAccounts.reduce((sum, debt) => sum + (debt.accruedUnpaidInterestWan ?? 0), 0));
    const serviced = serviceDebtForMonth(ledger, end, options.excludedDebtAccountIds ?? new Set());
    const records = serviced.records;
    const unpaidAfterWan = roundWan(ledger.debtAccounts.reduce((sum, debt) => sum + (debt.accruedUnpaidInterestWan ?? 0), 0));
    result.debtServiceRecords.push(...records);
    result.debtInterestAccruedWan = roundWan(result.debtInterestAccruedWan + serviced.currentInterestAccruedWan);
    for (const record of records) {
      result.debtPrincipalPaidWan = roundWan(result.debtPrincipalPaidWan + record.principalPaidWan);
      result.debtInterestPaidWan = roundWan(result.debtInterestPaidWan + record.interestPaidWan);
    }
    result.debtInterestUnpaidWan = roundWan(result.debtInterestUnpaidWan + Math.max(0, unpaidAfterWan - unpaidBeforeWan));
    result.automaticLiquidityShortfallRecoveryWan = roundWan(
      result.automaticLiquidityShortfallRecoveryWan + Math.max(0, options.recoverAutomaticLiquidityShortfall?.(end) ?? 0)
    );
  }
  return result;
}

import { FinancialLedgerInvariantError, PRIMARY_CASH_ACCOUNT_ID, roundWan } from "./ledgerMath";
import type { FinancialLedger } from "./types";

export interface PeriodAccrual {
  incomeWan: number;
  coreExpenseWan: number;
}

function overlaps(input: {
  start: number;
  end: number;
  activeFrom: number;
  activeUntil?: number;
}): number {
  const overlapStart = Math.max(input.start, input.activeFrom);
  const overlapEnd = Math.min(input.end, input.activeUntil ?? input.end);
  return Math.max(0, overlapEnd - overlapStart);
}

export function accruePeriodSlice(
  ledger: FinancialLedger,
  periodStartAgeInMonths: number,
  periodEndAgeInMonths: number
): PeriodAccrual {
  if (periodEndAgeInMonths < periodStartAgeInMonths) {
    throw new FinancialLedgerInvariantError("INVALID_LEDGER", "结算阶段结束时间不能早于开始时间");
  }
  if (periodEndAgeInMonths === periodStartAgeInMonths) return { incomeWan: 0, coreExpenseWan: 0 };
  const primaryCash = ledger.cashAccounts.find((account) => account.id === PRIMARY_CASH_ACCOUNT_ID && account.status === "active")
    || ledger.cashAccounts.find((account) => account.status === "active");
  if (!primaryCash) throw new FinancialLedgerInvariantError("INVALID_LEDGER", "自动结算需要一个有效现金账户");

  let incomeWan = 0;
  for (const source of ledger.incomeSources) {
    if (source.status !== "active" || source.accrualPolicy === "event_only") continue;
    const months = overlaps({
      start: periodStartAgeInMonths,
      end: periodEndAgeInMonths,
      activeFrom: source.activeFromAgeInMonths,
      activeUntil: source.activeUntilAgeInMonths
    });
    const monthlyAmount = source.accrualPolicy === "annual"
      ? (source.annualNetAmountWan || 0) / 12
      : source.monthlyNetAmountWan || 0;
    incomeWan += monthlyAmount * months;
  }

  let coreExpenseWan = 0;
  for (const commitment of ledger.expenseCommitments) {
    if (commitment.status !== "active") continue;
    const months = overlaps({
      start: periodStartAgeInMonths,
      end: periodEndAgeInMonths,
      activeFrom: commitment.activeFromAgeInMonths,
      activeUntil: commitment.activeUntilAgeInMonths
    });
    coreExpenseWan += commitment.monthlyAmountWan * months;
  }

  incomeWan = roundWan(incomeWan);
  coreExpenseWan = roundWan(coreExpenseWan);
  // A transaction may temporarily go below zero before an accepted debt draw or
  // asset sale at the same boundary. Only the final atomic commit is constrained.
  primaryCash.balanceWan = roundWan(primaryCash.balanceWan + incomeWan - coreExpenseWan);
  return { incomeWan, coreExpenseWan };
}

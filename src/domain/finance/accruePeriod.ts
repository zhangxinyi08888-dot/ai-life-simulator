import { FinancialLedgerInvariantError, PRIMARY_CASH_ACCOUNT_ID, roundWan } from "./ledgerMath";
import type { FinancialLedger } from "./types";

export interface PeriodAccrual {
  incomeWan: number;
  coreExpenseWan: number;
  debtPrincipalPaidWan: number;
  debtInterestPaidWan: number;
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
  if (periodEndAgeInMonths === periodStartAgeInMonths) {
    return { incomeWan: 0, coreExpenseWan: 0, debtPrincipalPaidWan: 0, debtInterestPaidWan: 0 };
  }
  const primaryCash = ledger.cashAccounts.find((account) => account.id === PRIMARY_CASH_ACCOUNT_ID && account.status === "active")
    || ledger.cashAccounts.find((account) => account.status === "active");
  if (!primaryCash) throw new FinancialLedgerInvariantError("INVALID_LEDGER", "自动结算需要一个有效现金账户");

  let incomeWan = 0;
  for (const source of ledger.incomeSources) {
    if (source.status !== "active" || source.accrualPolicy === "event_only" || source.accrualReviewStatus === "quarantined") continue;
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

  let debtPrincipalPaidWan = 0;
  let debtInterestPaidWan = 0;
  for (const debt of ledger.debtAccounts) {
    if (debt.status !== "active" || debt.repaymentPolicy.mode === "event_driven") continue;
    const paymentStart = Math.max(periodStartAgeInMonths, debt.openedAtAgeInMonths);
    const paymentEnd = Math.min(periodEndAgeInMonths, debt.closedAtAgeInMonths ?? periodEndAgeInMonths);
    const paymentMonths = Math.max(0, paymentEnd - paymentStart);
    for (let month = 0; month < paymentMonths && debt.principalWan > 0; month += 1) {
      const policy = debt.repaymentPolicy;
      const interestWan = roundWan(policy.monthlyInterestWan
        ?? (policy.annualInterestRate !== undefined ? debt.principalWan * policy.annualInterestRate / 12 : 0));
      const scheduledPrincipalWan = policy.monthlyPrincipalWan
        ?? (policy.monthlyPaymentWan !== undefined
          ? Math.max(0, policy.monthlyPaymentWan - interestWan)
          : policy.remainingTermMonths && policy.remainingTermMonths > 0
            ? debt.principalWan / policy.remainingTermMonths
            : 0);
      const principalWan = roundWan(Math.min(debt.principalWan, scheduledPrincipalWan));
      if (principalWan <= 0 && interestWan <= 0) {
        throw new FinancialLedgerInvariantError("INVALID_LEDGER", `债务 ${debt.id} 的自动还款策略无法产生有效支付`);
      }
      primaryCash.balanceWan = roundWan(primaryCash.balanceWan - principalWan - interestWan);
      debt.principalWan = roundWan(debt.principalWan - principalWan);
      debtPrincipalPaidWan = roundWan(debtPrincipalPaidWan + principalWan);
      debtInterestPaidWan = roundWan(debtInterestPaidWan + interestWan);
      if (policy.remainingTermMonths !== undefined) {
        policy.remainingTermMonths = Math.max(0, policy.remainingTermMonths - 1);
      }
      if (debt.principalWan === 0) {
        debt.status = "repaid";
        debt.closedAtAgeInMonths = paymentStart + month + 1;
      }
    }
  }

  incomeWan = roundWan(incomeWan);
  coreExpenseWan = roundWan(coreExpenseWan);
  // A transaction may temporarily go below zero before an accepted debt draw or
  // asset sale at the same boundary. Only the final atomic commit is constrained.
  primaryCash.balanceWan = roundWan(primaryCash.balanceWan + incomeWan - coreExpenseWan);
  return { incomeWan, coreExpenseWan, debtPrincipalPaidWan, debtInterestPaidWan };
}

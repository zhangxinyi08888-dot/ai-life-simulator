import assert from "node:assert/strict";
import test from "node:test";
import { initializeFinancialLedger } from "./initializeLedger";
import { PRIMARY_CASH_ACCOUNT_ID, totalDebtWan } from "./ledgerMath";
import { reduceFinancialLedger } from "./reduceFinancialLedger";
import type { DebtAccount, FinancialEvidence, FinancialLedger } from "./types";

const evidence: FinancialEvidence[] = [{ source: "accepted_history", reasonCode: "PB_DEBT_TEST", confidence: 1 }];

function debt(overrides: Partial<DebtAccount> = {}): DebtAccount {
  return {
    id: "auto_shortfall",
    type: "liquidity_shortfall",
    displayName: "自动流动性缺口",
    principalWan: 5,
    openedAtAgeInMonths: 300,
    status: "active",
    repaymentPolicy: { mode: "event_driven" },
    factStatus: "known",
    evidence: [{ source: "system_policy", reasonCode: "AUTOMATIC_LIQUIDITY_SHORTFALL", confidence: 1 }],
    origin: "system_auto_shortfall",
    accruedUnpaidInterestWan: 0,
    servicingStatus: "current",
    consecutiveMissedPaymentMonths: 0,
    totalMissedPaymentMonths: 0,
    recentMissedPaymentAgeInMonths: [],
    ...overrides
  };
}

function ledger(input: { cashWan: number; expenseWan?: number; incomeWan?: number; debts?: DebtAccount[] }): FinancialLedger {
  return initializeFinancialLedger({
    id: "automatic_shortfall_recovery",
    asOfAgeInMonths: 360,
    openingPosition: {
      cashAccounts: [{
        id: PRIMARY_CASH_ACCOUNT_ID,
        type: "bank_deposit",
        balanceWan: input.cashWan,
        status: "active",
        factStatus: "known",
        evidence
      }],
      debtAccounts: input.debts ?? [debt()],
      incomeSources: input.incomeWan === undefined ? [] : [{
        id: "salary",
        type: "salary",
        displayName: "工资",
        monthlyNetAmountWan: input.incomeWan,
        accrualPolicy: "monthly",
        activeFromAgeInMonths: 360,
        status: "active",
        factStatus: "known",
        evidence
      }],
      expenseCommitments: input.expenseWan === undefined ? [] : [{
        id: "living",
        type: "basic_living",
        displayName: "生活支出",
        monthlyAmountWan: input.expenseWan,
        activeFromAgeInMonths: 360,
        status: "active",
        factStatus: "known",
        evidence
      }]
    }
  });
}

function commit(opening: FinancialLedger, transactionId = "recovery_tx") {
  const result = reduceFinancialLedger({
    ledger: opening,
    transactionId,
    expectedLedgerRevision: opening.revision,
    periodStartAgeInMonths: opening.asOfAgeInMonths,
    periodEndAgeInMonths: opening.asOfAgeInMonths + 1,
    events: [],
    liquidityPolicy: "auto_shortfall_debt"
  });
  assert.equal(result.alreadyCommitted, false);
  if (result.alreadyCommitted) throw new Error("expected commit");
  return result;
}

test("PB-DEBT-01 cash below the three-month expense reserve does not repay auto-shortfall", () => {
  const result = commit(ledger({ cashWan: 3, expenseWan: 1 }));
  assert.equal(result.ledger.cashAccounts[0].balanceWan, 2);
  assert.equal(result.ledger.debtAccounts[0].principalWan, 5);
  assert.equal(result.transaction.automaticLiquidityShortfallRecoveryWan, 0);
});

test("PB-DEBT-02 cash above reserve repays only the surplus", () => {
  const result = commit(ledger({ cashWan: 5, expenseWan: 1 }));
  assert.equal(result.ledger.cashAccounts[0].balanceWan, 3);
  assert.equal(result.ledger.debtAccounts[0].principalWan, 4);
  assert.equal(result.transaction.automaticLiquidityShortfallRecoveryWan, 1);
  assert.equal(result.transaction.debtPrincipalPaidWan, 1);
});

test("PB-DEBT-03 sufficient cash closes auto-shortfall without consuming the reserve", () => {
  const result = commit(ledger({ cashWan: 10, expenseWan: 1, debts: [debt({ principalWan: 3 })] }));
  assert.equal(result.ledger.cashAccounts[0].balanceWan, 6);
  assert.equal(result.ledger.debtAccounts[0].principalWan, 0);
  assert.equal(result.ledger.debtAccounts[0].status, "repaid");
  assert.equal(result.transaction.automaticLiquidityShortfallRecoveryWan, 3);
  assert.deepEqual(result.transaction.debtSettlementAccountIds, ["auto_shortfall"]);
});

test("PB-DEBT-04 missing adult expense facts never means a zero reserve", () => {
  const result = commit(ledger({ cashWan: 10 }));
  assert.equal(result.ledger.cashAccounts[0].balanceWan, 10);
  assert.equal(result.ledger.debtAccounts[0].principalWan, 5);
  assert.equal(result.transaction.automaticLiquidityShortfallRecoveryWan, 0);
});

test("PB-DEBT-05 explicit event-driven personal debt is never auto-repaid", () => {
  const explicitDebt = debt({
    id: "family_loan",
    type: "family_or_personal_loan",
    origin: "explicit",
    evidence,
    principalWan: 5
  });
  const result = commit(ledger({ cashWan: 10, expenseWan: 1, debts: [explicitDebt] }));
  assert.equal(result.ledger.cashAccounts[0].balanceWan, 9);
  assert.equal(result.ledger.debtAccounts[0].principalWan, 5);
  assert.equal(result.transaction.automaticLiquidityShortfallRecoveryWan, 0);
});

test("PB-DEBT-06 known annual interest accrues once and participates in debt conservation", () => {
  const contractDebt = debt({
    id: "contract",
    type: "consumer_loan",
    origin: "explicit",
    evidence,
    principalWan: 12,
    repaymentPolicy: { mode: "known_schedule", annualInterestRate: 0.12, monthlyPrincipalWan: 1, remainingTermMonths: 12 }
  });
  const result = commit(ledger({ cashWan: 0, expenseWan: 0, debts: [contractDebt] }));
  assert.equal(result.transaction.debtInterestAccruedWan, 0.12);
  assert.equal(result.ledger.debtAccounts[0].accruedUnpaidInterestWan, 0.12);
  assert.equal(totalDebtWan(result.ledger), 12.12);
  assert.equal(result.transaction.debtDeltaWan, 0.12);
});

test("PB-DEBT-07 unknown interest is not invented", () => {
  const unknownDebt = debt({
    id: "unknown_contract",
    type: "consumer_loan",
    origin: "explicit",
    evidence,
    principalWan: 12,
    repaymentPolicy: { mode: "known_schedule", monthlyPrincipalWan: 1, remainingTermMonths: 12 }
  });
  const result = commit(ledger({ cashWan: 3, expenseWan: 1, debts: [unknownDebt] }));
  assert.equal(result.transaction.debtInterestAccruedWan, 0);
  assert.equal(result.ledger.debtAccounts[0].accruedUnpaidInterestWan, 0);
});

test("PB-DEBT-08 replaying a committed transaction cannot repay twice", () => {
  const opening = ledger({ cashWan: 5, expenseWan: 1 });
  const first = commit(opening, "idempotent_recovery");
  const replay = reduceFinancialLedger({
    ledger: first.ledger,
    transactionId: "idempotent_recovery",
    expectedLedgerRevision: first.ledger.revision,
    periodStartAgeInMonths: first.ledger.asOfAgeInMonths,
    periodEndAgeInMonths: first.ledger.asOfAgeInMonths,
    events: []
  });
  assert.equal(replay.alreadyCommitted, true);
  assert.equal(replay.ledger.cashAccounts[0].balanceWan, 3);
  assert.equal(replay.ledger.debtAccounts[0].principalWan, 4);
});

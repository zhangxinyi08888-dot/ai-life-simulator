import assert from "node:assert/strict";
import test from "node:test";
import { initializeFinancialLedger } from "./initializeLedger";
import { FinancialLedgerInvariantError, PRIMARY_CASH_ACCOUNT_ID } from "./ledgerMath";
import { reduceFinancialLedger } from "./reduceFinancialLedger";
import type {
  AcceptedFinancialEvent,
  DebtAccount,
  FinancialEventKind,
  FinancialEventPayloadMap,
  FinancialEvidence
} from "./types";

const evidence: FinancialEvidence[] = [{ source: "accepted_history", reasonCode: "DEBT_FACT_CONFIRMED", confidence: 1 }];

function accepted<K extends FinancialEventKind>(
  id: string,
  kind: K,
  effectiveAtAgeInMonths: number,
  payload: FinancialEventPayloadMap[K]
): AcceptedFinancialEvent<K> {
  return { id, kind, effectiveAtAgeInMonths, payload, evidence, acceptedByReasonCodes: ["STRUCTURED_FACT_ACCEPTED"] } as AcceptedFinancialEvent<K>;
}

function debt(overrides: Partial<DebtAccount> = {}): DebtAccount {
  return {
    id: "loan",
    type: "family_or_personal_loan",
    displayName: "个人借款",
    principalWan: 12,
    openedAtAgeInMonths: 240,
    status: "active",
    repaymentPolicy: { mode: "event_driven" },
    factStatus: "known",
    evidence,
    ...overrides
  };
}

function ledgerWithDebt(debtAccount: DebtAccount, cashWan = 100) {
  return initializeFinancialLedger({
    id: `ledger_${debtAccount.id}`,
    asOfAgeInMonths: 240,
    openingPosition: {
      cashAccounts: [{ id: PRIMARY_CASH_ACCOUNT_ID, type: "bank_deposit", balanceWan: cashWan, status: "active", factStatus: "known", evidence }],
      debtAccounts: [debtAccount]
    }
  });
}

test("known debt schedules settle principal and interest separately each month", () => {
  const ledger = ledgerWithDebt(debt({
    type: "mortgage",
    repaymentPolicy: { mode: "known_schedule", monthlyPrincipalWan: 1, monthlyInterestWan: 0.1, monthlyPaymentWan: 1.1, remainingTermMonths: 12 }
  }));
  const result = reduceFinancialLedger({
    ledger,
    transactionId: "tx_known_schedule",
    expectedLedgerRevision: 0,
    periodStartAgeInMonths: 240,
    periodEndAgeInMonths: 246,
    events: []
  });
  assert.equal(result.alreadyCommitted, false);
  assert.equal(result.ledger.cashAccounts[0].balanceWan, 93.4);
  assert.equal(result.ledger.debtAccounts[0].principalWan, 6);
  assert.equal(result.ledger.debtAccounts[0].repaymentPolicy.remainingTermMonths, 6);
  assert.equal(result.periodSummary.debtPrincipalPaidWan, 6);
  assert.equal(result.periodSummary.debtInterestPaidWan, 0.6);
  assert.equal(result.periodSummary.otherExpenseWan, 0.6);
  assert.equal(result.periodSummary.netWorthChangeWan, -0.6);
});

test("estimated amortization uses the recorded rate and remaining term deterministically", () => {
  const ledger = ledgerWithDebt(debt({
    id: "estimated_loan",
    type: "consumer_loan",
    principalWan: 12,
    repaymentPolicy: { mode: "estimated_amortizing", annualInterestRate: 0.12, remainingTermMonths: 12 },
    factStatus: "estimated"
  }));
  const result = reduceFinancialLedger({
    ledger,
    transactionId: "tx_estimated_schedule",
    expectedLedgerRevision: 0,
    periodStartAgeInMonths: 240,
    periodEndAgeInMonths: 241,
    events: []
  });
  assert.equal(result.alreadyCommitted, false);
  assert.equal(result.ledger.debtAccounts[0].principalWan, 11);
  assert.equal(result.periodSummary.debtPrincipalPaidWan, 1);
  assert.equal(result.periodSummary.debtInterestPaidWan, 0.12);
});

test("restructuring closes the old debt, creates an equal replacement and only fees reduce wealth", () => {
  const ledger = ledgerWithDebt(debt({ principalWan: 5 }), 10);
  const replacement = debt({ id: "replacement", principalWan: 5, openedAtAgeInMonths: 241 });
  const result = reduceFinancialLedger({
    ledger,
    transactionId: "tx_restructure",
    expectedLedgerRevision: 0,
    periodStartAgeInMonths: 240,
    periodEndAgeInMonths: 241,
    events: [accepted("restructure", "debt_restructured", 241, {
      oldDebtAccountId: "loan",
      replacementDebtAccount: replacement,
      sourceCashAccountId: PRIMARY_CASH_ACCOUNT_ID,
      transactionFeeWan: 1
    })]
  });
  assert.equal(result.alreadyCommitted, false);
  assert.equal(result.ledger.cashAccounts[0].balanceWan, 9);
  assert.equal(result.ledger.debtAccounts[0].status, "restructured");
  assert.equal(result.ledger.debtAccounts[0].principalWan, 0);
  assert.equal(result.ledger.debtAccounts[1].principalWan, 5);
  assert.equal(result.periodSummary.netWorthChangeWan, -1);
});

test("debt forgiveness is a non-cash gain and never masquerades as income", () => {
  const ledger = ledgerWithDebt(debt({ principalWan: 5 }), 10);
  const result = reduceFinancialLedger({
    ledger,
    transactionId: "tx_forgive",
    expectedLedgerRevision: 0,
    periodStartAgeInMonths: 240,
    periodEndAgeInMonths: 241,
    events: [accepted("forgive", "debt_forgiven", 241, { debtAccountId: "loan", principalForgivenWan: 2 })]
  });
  assert.equal(result.alreadyCommitted, false);
  assert.equal(result.ledger.cashAccounts[0].balanceWan, 10);
  assert.equal(result.ledger.debtAccounts[0].principalWan, 3);
  assert.equal(result.periodSummary.incomeWan, 0);
  assert.equal(result.transaction.nonCashGainLossWan, 2);
  assert.equal(result.periodSummary.netWorthChangeWan, 2);
});

test("long-running private event-driven debt becomes a structured review issue", () => {
  const ledger = ledgerWithDebt(debt({ principalWan: 5 }), 10);
  const result = reduceFinancialLedger({
    ledger,
    transactionId: "tx_review",
    expectedLedgerRevision: 0,
    periodStartAgeInMonths: 240,
    periodEndAgeInMonths: 264,
    events: []
  });
  assert.equal(result.alreadyCommitted, false);
  assert.equal(result.ledger.debtAccounts[0].factStatus, "needs_review");
  assert.equal(result.ledger.unresolvedIssues[0].code, "UNKNOWN_DEBT_SCHEDULE");
});

test("standard debt cannot enter the authoritative ledger as permanently event-driven", () => {
  assert.throws(() => ledgerWithDebt(debt({ type: "mortgage" })), (
    error: unknown
  ) => error instanceof FinancialLedgerInvariantError && error.code === "INVALID_LEDGER");
});

test("automatic scheduled payments still require enough cash and remain atomic on failure", () => {
  const ledger = ledgerWithDebt(debt({
    type: "consumer_loan",
    repaymentPolicy: { mode: "known_schedule", monthlyPrincipalWan: 1, monthlyInterestWan: 0.1 }
  }), 0.5);
  assert.throws(() => reduceFinancialLedger({
    ledger,
    transactionId: "tx_schedule_shortfall",
    expectedLedgerRevision: 0,
    periodStartAgeInMonths: 240,
    periodEndAgeInMonths: 241,
    events: []
  }), (error: unknown) => error instanceof FinancialLedgerInvariantError && error.code === "MISSING_FUNDING_SOURCE");
  assert.equal(ledger.cashAccounts[0].balanceWan, 0.5);
  assert.equal(ledger.debtAccounts[0].principalWan, 12);
  assert.equal(ledger.revision, 0);
});

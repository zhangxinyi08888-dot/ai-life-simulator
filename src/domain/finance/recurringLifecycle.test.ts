import assert from "node:assert/strict";
import test from "node:test";
import { initializeCareerState } from "../career/careerState";
import { deriveFinancialState } from "./deriveFinancialState";
import { initializeFinancialLedger } from "./initializeLedger";
import { PRIMARY_CASH_ACCOUNT_ID } from "./ledgerMath";
import { reduceFinancialLedger } from "./reduceFinancialLedger";
import type {
  AcceptedFinancialEvent,
  ExpenseCommitment,
  FinancialEventKind,
  FinancialEventPayloadMap,
  FinancialEvidence,
  IncomeSource
} from "./types";

const evidence: FinancialEvidence[] = [{
  source: "accepted_history",
  reasonCode: "RECURRING_FACT_CONFIRMED",
  confidence: 1
}];

function accepted<K extends FinancialEventKind>(
  id: string,
  kind: K,
  effectiveAtAgeInMonths: number,
  payload: FinancialEventPayloadMap[K]
): AcceptedFinancialEvent<K> {
  return { id, kind, effectiveAtAgeInMonths, payload, evidence, acceptedByReasonCodes: ["STRUCTURED_FACT_ACCEPTED"] } as AcceptedFinancialEvent<K>;
}

function income(id: string, type: IncomeSource["type"], monthlyNetAmountWan: number, linkedCareerStateId?: string): IncomeSource {
  return {
    id,
    type,
    displayName: id,
    monthlyNetAmountWan,
    accrualPolicy: "monthly",
    activeFromAgeInMonths: 720,
    status: "active",
    linkedCareerStateId,
    factStatus: "known",
    evidence
  };
}

function expense(id: string, type: ExpenseCommitment["type"], monthlyAmountWan: number): ExpenseCommitment {
  return {
    id,
    type,
    displayName: id,
    monthlyAmountWan,
    activeFromAgeInMonths: 720,
    status: "active",
    factStatus: "known",
    evidence
  };
}

test("retirement does not automatically erase salary, rent or pension sources", () => {
  const retired = initializeCareerState({ id: "career_retired", employmentStatus: "retired", effectiveFromAgeInMonths: 720 });
  const ledger = initializeFinancialLedger({
    id: "ledger_retirement",
    asOfAgeInMonths: 720,
    openingPosition: {
      cashAccounts: [{ id: PRIMARY_CASH_ACCOUNT_ID, type: "bank_deposit", balanceWan: 20, status: "active", factStatus: "known", evidence }],
      incomeSources: [
        income("salary", "salary", 2, "career_employed"),
        income("rent", "rent", 1),
        income("pension", "pension", 0.8, retired.id)
      ]
    }
  });
  const result = reduceFinancialLedger({
    ledger,
    transactionId: "tx_retirement_no_financial_event",
    expectedLedgerRevision: 0,
    periodStartAgeInMonths: 720,
    periodEndAgeInMonths: 721,
    events: []
  });
  assert.equal(result.alreadyCommitted, false);
  assert.equal(result.periodSummary.incomeWan, 3.8);
  assert.equal(result.ledger.incomeSources.length, 3);
  assert.equal(result.ledger.incomeSources.find((source) => source.id === "salary")?.status, "active");
});

test("an explicit salary end at mid-period stops only that source and preserves rent", () => {
  const ledger = initializeFinancialLedger({
    id: "ledger_source_end",
    asOfAgeInMonths: 720,
    openingPosition: {
      cashAccounts: [{ id: PRIMARY_CASH_ACCOUNT_ID, type: "bank_deposit", balanceWan: 20, status: "active", factStatus: "known", evidence }],
      incomeSources: [income("salary", "salary", 2, "career_employed"), income("rent", "rent", 1)]
    }
  });
  const result = reduceFinancialLedger({
    ledger,
    transactionId: "tx_salary_end",
    expectedLedgerRevision: 0,
    periodStartAgeInMonths: 720,
    periodEndAgeInMonths: 726,
    events: [accepted("salary_end", "income_source_ended", 723, { incomeSourceId: "salary" })]
  });
  assert.equal(result.alreadyCommitted, false);
  assert.equal(result.periodSummary.incomeWan, 12);
  const derived = deriveFinancialState({ ledger: result.ledger, periodSummary: result.periodSummary, employmentStatus: "retired" });
  assert.equal(derived.state.annualizedRecurringIncomeWan, 12);
  assert.equal(derived.state.periodIncomeWan, 12);
});

test("student or part-time identity never deletes housing and dependent commitments", () => {
  for (const employmentStatus of ["student", "part_time"] as const) {
    const ledger = initializeFinancialLedger({
      id: `ledger_${employmentStatus}`,
      asOfAgeInMonths: 240,
      openingPosition: {
        cashAccounts: [{ id: PRIMARY_CASH_ACCOUNT_ID, type: "bank_deposit", balanceWan: 20, status: "active", factStatus: "known", evidence }],
        expenseCommitments: [expense("housing", "housing", 0.5), expense("dependent", "dependent_support", 0.3)]
          .map((commitment) => ({ ...commitment, activeFromAgeInMonths: 240 }))
      }
    });
    const result = reduceFinancialLedger({
      ledger,
      transactionId: `tx_${employmentStatus}`,
      expectedLedgerRevision: 0,
      periodStartAgeInMonths: 240,
      periodEndAgeInMonths: 241,
      events: []
    });
    assert.equal(result.alreadyCommitted, false);
    assert.equal(result.periodSummary.coreExpenseWan, 0.8);
    assert.equal(result.ledger.expenseCommitments.length, 2);
    assert.equal(deriveFinancialState({ ledger: result.ledger, employmentStatus }).state.annualizedCoreExpenseWan, 9.6);
  }
});

test("mid-period source adjustment separates realized income from the ending annual run rate", () => {
  const original = income("salary", "salary", 1, "career_employed");
  const adjusted = { ...original, monthlyNetAmountWan: 3, activeFromAgeInMonths: 723 };
  const ledger = initializeFinancialLedger({
    id: "ledger_adjustment",
    asOfAgeInMonths: 720,
    openingPosition: {
      cashAccounts: [{ id: PRIMARY_CASH_ACCOUNT_ID, type: "bank_deposit", balanceWan: 10, status: "active", factStatus: "known", evidence }],
      incomeSources: [original]
    }
  });
  const result = reduceFinancialLedger({
    ledger,
    transactionId: "tx_adjustment",
    expectedLedgerRevision: 0,
    periodStartAgeInMonths: 720,
    periodEndAgeInMonths: 726,
    events: [accepted("salary_adjust", "income_source_adjusted", 723, { incomeSourceId: "salary", nextSource: adjusted })]
  });
  assert.equal(result.alreadyCommitted, false);
  assert.equal(result.periodSummary.incomeWan, 12);
  assert.equal(deriveFinancialState({ ledger: result.ledger, periodSummary: result.periodSummary, employmentStatus: "employed" }).state.annualizedRecurringIncomeWan, 36);
});

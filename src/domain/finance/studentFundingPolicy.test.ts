import assert from "node:assert/strict";
import test from "node:test";
import type { FinancialState } from "../../types";
import { initializeCareerState } from "../career/careerState";
import type { AcceptedCareerTransition } from "../career/types";
import { commitFinancialDomainTransaction } from "./commitFinancialDomainTransaction";
import { deriveFinancialState } from "./deriveFinancialState";
import { migrateLegacyFinancialState } from "./migrateLegacyFinancialState";
import { PRIMARY_CASH_ACCOUNT_ID } from "./ledgerMath";
import { reduceFinancialLedger } from "./reduceFinancialLedger";
import type { AcceptedFinancialEvent, FinancialLedger } from "./types";

const startAge = 18 * 12;
const endAge = 19 * 12 + 11;

function studentState(overrides: Partial<FinancialState> = {}): FinancialState {
  return {
    currencyUnit: "CNY_WAN_REAL",
    asOfAgeInMonths: startAge,
    cashWan: 0.3,
    investmentAssetsWan: 0,
    propertyMarketValueWan: 0,
    businessAndOtherAssetsWan: 0,
    totalDebtWan: 0,
    netWorthWan: 0.3,
    annualAfterTaxIncomeWan: 0,
    annualDisposableIncomeWan: -2,
    annualCoreExpenseWan: 2,
    employmentStatus: "student",
    incomeStability: "unstable",
    isEstimated: true,
    ...overrides
  };
}

function opening(overrides: Partial<FinancialState> = {}): FinancialLedger {
  return migrateLegacyFinancialState({
    id: "student_funding",
    legacyState: studentState(overrides),
    linkedCareerStateId: "career_student"
  });
}

function settle(ledger: FinancialLedger, events: AcceptedFinancialEvent[] = []) {
  return reduceFinancialLedger({
    ledger,
    transactionId: `student_${events.length}`,
    expectedLedgerRevision: ledger.revision,
    periodStartAgeInMonths: startAge,
    periodEndAgeInMonths: endAge,
    events,
    liquidityPolicy: "auto_shortfall_debt"
  });
}

test("student basic living costs default to family coverage and keep personal wealth flat", () => {
  const ledger = opening();
  const support = ledger.incomeSources.find((source) => source.type === "family_support");
  assert.equal(support?.monthlyNetAmountWan, ledger.expenseCommitments[0].monthlyAmountWan);

  const result = settle(ledger);
  assert.ok("periodSummary" in result);
  const state = deriveFinancialState({ ledger: result.ledger, employmentStatus: "student", periodSummary: result.periodSummary }).compatibilityState;
  assert.equal(state.netWorthWan, 0.3);
  assert.equal(state.cashWan, 0.3);
  assert.equal(state.totalDebtWan, 0);
  assert.equal(state.annualAfterTaxIncomeWan, 0);
  assert.equal(state.annualDisposableIncomeWan, 0);
});

test("explicit student earnings increase wealth while basic living remains covered", () => {
  const ledger = opening();
  const earning: AcceptedFinancialEvent<"one_off_income_received"> = {
    id: "accepted_student_earning",
    proposalId: "student_earning",
    kind: "one_off_income_received",
    effectiveAtAgeInMonths: endAge,
    payload: { amountWan: 1, destinationCashAccountId: PRIMARY_CASH_ACCOUNT_ID },
    evidence: [{ source: "accepted_simulation_outcome", reasonCode: "TEST_EXPLICIT_EARNING", confidence: 1 }],
    acceptedByReasonCodes: ["TEST"]
  };
  const result = settle(ledger, [earning]);
  assert.ok("periodSummary" in result);
  assert.equal(deriveFinancialState({ ledger: result.ledger, employmentStatus: "student" }).compatibilityState.netWorthWan, 1.3);
});

test("explicit personal student debt remains debt without creating an extra living-cost shortfall", () => {
  const ledger = opening({ totalDebtWan: 2, netWorthWan: -1.7 });
  const result = settle(ledger);
  assert.ok("periodSummary" in result);
  const state = deriveFinancialState({ ledger: result.ledger, employmentStatus: "student" }).compatibilityState;
  assert.equal(state.netWorthWan, -1.7);
  assert.equal(state.totalDebtWan, 2);
  assert.equal(result.ledger.debtAccounts.filter((debt) => debt.type === "liquidity_shortfall").length, 0);
});

test("default family coverage ends at an accepted transition out of student status", () => {
  const ledger = opening();
  const student = initializeCareerState({ id: "career_student", employmentStatus: "student", effectiveFromAgeInMonths: startAge });
  const employed = initializeCareerState({ id: "career_employed", employmentStatus: "employed", effectiveFromAgeInMonths: 19 * 12 });
  const transition: AcceptedCareerTransition = {
    id: "accepted_graduation",
    proposalId: "graduation",
    fromCareerStateId: student.id,
    nextCareerState: employed,
    effectiveAtAgeInMonths: 19 * 12,
    evidence: [{ source: "accepted_simulation_outcome", reasonCode: "TEST_GRADUATION", confidence: 1 }],
    acceptedByReasonCodes: ["TEST"]
  };
  const committed = commitFinancialDomainTransaction({
    transactionId: "student_graduation",
    periodStartAgeInMonths: startAge,
    periodEndAgeInMonths: 20 * 12,
    expectedCareerRevision: 0,
    expectedLedgerRevision: 0,
    currentCareer: { careerStates: [student], currentCareerStateId: student.id, careerRevision: 0 },
    currentFinancialLedger: ledger,
    currentWorldState: {
      people: [], directionArcs: [], pressureArcs: [], careerStates: [student], currentCareerStateId: student.id,
      currentEmploymentStatus: "student", careerRevision: 0, committedTransactionIds: [], version: 2
    },
    acceptedCareerTransitions: [transition],
    acceptedFinancialEvents: [],
    liquidityPolicy: "auto_shortfall_debt"
  });
  const support = committed.financialLedger.incomeSources.find((source) => source.id === "student_basic_family_support");
  assert.equal(support?.status, "ended");
  assert.equal(support?.activeUntilAgeInMonths, 19 * 12);
  assert.equal(committed.worldState.currentEmploymentStatus, "employed");
});

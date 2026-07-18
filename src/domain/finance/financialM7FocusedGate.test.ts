import assert from "node:assert/strict";
import test from "node:test";
import type { WorldStateSnapshot } from "../../types";
import { initializeCareerState } from "../career/careerState";
import { commitFinancialDomainTransaction } from "./commitFinancialDomainTransaction";
import { deriveFinancialState } from "./deriveFinancialState";
import { initializeFinancialLedger } from "./initializeLedger";
import { migrateLegacyFinancialState } from "./migrateLegacyFinancialState";
import type { AcceptedFinancialEvent, ExpenseCommitment, FinancialEvidence, FinancialLedger, IncomeSource } from "./types";

const evidence: FinancialEvidence[] = [{ source: "user", reasonCode: "TEST", confidence: 1 }];

function world(career = initializeCareerState({
  id: "career",
  employmentStatus: "employed",
  effectiveFromAgeInMonths: 360,
  confidence: 1
})): WorldStateSnapshot {
  return {
    people: [], directionArcs: [], pressureArcs: [], careerStates: [career],
    currentCareerStateId: career.id, currentEmploymentStatus: career.employmentStatus,
    careerRevision: 0, committedTransactionIds: [], version: 2
  };
}

function salary(age: number, lastConfirmedAtAgeInMonths = age): IncomeSource {
  return {
    id: "salary", type: "salary", displayName: "工资", monthlyNetAmountWan: 2,
    accrualPolicy: "monthly", activeFromAgeInMonths: age, status: "active",
    linkedCareerStateId: "career", factStatus: "known", accrualReviewStatus: "normal",
    lastConfirmedAtAgeInMonths, evidence
  };
}

function living(age: number): ExpenseCommitment {
  return {
    id: "living", type: "basic_living", displayName: "生活支出", monthlyAmountWan: 1,
    activeFromAgeInMonths: age, status: "active", factStatus: "known", evidence
  };
}

function ledger(age: number, input: { income?: IncomeSource[]; expenses?: ExpenseCommitment[]; cash?: number } = {}): FinancialLedger {
  return initializeFinancialLedger({
    id: "focused", asOfAgeInMonths: age,
    openingPosition: {
      cashAccounts: [{ id: "cash_primary", type: "bank_deposit", balanceWan: input.cash ?? 20, status: "active", factStatus: "known", evidence }],
      incomeSources: input.income || [], expenseCommitments: input.expenses || []
    }
  });
}

function commit(input: { ledger: FinancialLedger; worldState: WorldStateSnapshot; start: number; end: number; transactionId: string; events?: AcceptedFinancialEvent[] }) {
  const career = input.worldState.careerStates?.[0]!;
  return commitFinancialDomainTransaction({
    transactionId: input.transactionId,
    periodStartAgeInMonths: input.start,
    periodEndAgeInMonths: input.end,
    expectedCareerRevision: input.worldState.careerRevision || 0,
    expectedLedgerRevision: input.ledger.revision,
    currentCareer: { careerStates: input.worldState.careerStates || [], currentCareerStateId: career.id, careerRevision: input.worldState.careerRevision || 0 },
    currentFinancialLedger: input.ledger,
    currentWorldState: input.worldState,
    acceptedCareerTransitions: [],
    acceptedFinancialEvents: input.events || [],
    liquidityPolicy: "auto_shortfall_debt"
  });
}

test("M7 focused: explicit mortgage opens debt, repayment policy and a property fact even when value is unknown", () => {
  const migrated = migrateLegacyFinancialState({
    id: "opening",
    linkedCareerStateId: "career",
    legacyState: {
      currencyUnit: "CNY_WAN_REAL", asOfAgeInMonths: 288, cashWan: 35, investmentAssetsWan: 5,
      propertyMarketValueWan: 0, businessAndOtherAssetsWan: 0, totalDebtWan: 210, netWorthWan: -170,
      annualAfterTaxIncomeWan: 38, annualCoreExpenseWan: 18, annualDisposableIncomeWan: 20,
      employmentStatus: "employed", incomeStability: "stable", isEstimated: true
    },
    openingFacts: {
      evidenceText: "房贷余额210万元，每月还款1.3万元，家庭备用金35万元",
      cashWan: 35, ownsProperty: true, mortgagePrincipalWan: 210, mortgageMonthlyPaymentWan: 1.3
    }
  });
  assert.equal(migrated.debtAccounts[0]?.id, "opening_mortgage");
  assert.equal(migrated.debtAccounts[0]?.principalWan, 210);
  assert.equal(migrated.debtAccounts[0]?.repaymentPolicy.monthlyPaymentWan, 1.3);
  const property = migrated.assetAccounts.find((account) => account.type === "property");
  assert.equal(property?.type, "property");
  assert.equal(property?.factStatus, "estimated");
  assert.equal(property?.marketValueWan, 210);
});

test("M7 focused: missing adult expenses receive a deterministic estimate without quarantining income", () => {
  const initial = ledger(360, { income: [salary(360)], cash: 20 });
  const committed = commit({ ledger: initial, worldState: world(), start: 360, end: 372, transactionId: "missing_expense" });
  assert.equal(committed.financialLedger.cashAccounts[0].balanceWan, 39.8);
  assert.equal(committed.financialLedger.incomeSources[0].accrualReviewStatus, "normal");
  const estimated = committed.financialLedger.expenseCommitments.find((item) => item.type === "basic_living");
  assert.equal(estimated?.monthlyAmountWan, 0.35);
  assert.equal(estimated?.factStatus, "estimated");
  assert.ok(estimated?.evidence.some((item) => item.source === "system_policy"));
});

test("M7 focused: an accepted expense fact replaces the system estimate", () => {
  const first = commit({ ledger: ledger(360, { income: [salary(360)] }), worldState: world(), start: 360, end: 372, transactionId: "gap" });
  const expense = living(372);
  const event: AcceptedFinancialEvent = {
    id: "accepted_expense", proposalId: "expense", kind: "expense_commitment_started", effectiveAtAgeInMonths: 372,
    payload: expense, evidence, acceptedByReasonCodes: ["TEST"]
  };
  const second = commit({ ledger: first.financialLedger, worldState: first.worldState, start: 372, end: 373, transactionId: "expense_confirmed", events: [event] });
  assert.equal(second.derivedFinancialState.state.annualizedCoreExpenseWan, 12);
  assert.equal(second.financialLedger.expenseCommitments.find((item) => item.factStatus === "estimated")?.status, "ended");
  assert.equal(second.financialLedger.incomeSources[0].accrualReviewStatus, "normal");
});

test("M7 focused: stale late-career salary is paused before settlement", () => {
  const age = 80 * 12;
  const initial = ledger(age, { income: [salary(55 * 12, age - 48)], expenses: [living(age)], cash: 30 });
  const committed = commit({ ledger: initial, worldState: world(), start: age, end: age + 12, transactionId: "late_career" });
  assert.equal(committed.financialPeriodSummary?.incomeWan, 0);
  assert.equal(committed.financialLedger.incomeSources[0].accrualReviewStatus, "quarantined");
  assert.ok(committed.financialLedger.unresolvedIssues.some((issue) => issue.id === "pending_fact_stale_late_career_salary"));
});

test("M7 focused: deterministic basic living persists without repeated issues", () => {
  const first = commit({ ledger: ledger(360, { income: [salary(360)] }), worldState: world(), start: 360, end: 366, transactionId: "one" });
  const second = commit({ ledger: first.financialLedger, worldState: first.worldState, start: 366, end: 372, transactionId: "two" });
  const livingCommitments = second.financialLedger.expenseCommitments.filter((item) => item.type === "basic_living" && item.status === "active");
  assert.equal(livingCommitments.length, 1);
  assert.equal(second.financialLedger.unresolvedIssues.filter((issue) => issue.id === "pending_fact_missing_adult_expense").length, 0);
  assert.equal(deriveFinancialState({ ledger: second.financialLedger, employmentStatus: "employed" }).compatibilityState.cashWan, 39.8);
});

test("M7 focused: system living estimate advances from young-adult to adult policy", () => {
  const start = 22 * 12;
  const initial = ledger(start, { cash: 20 });
  initial.expenseCommitments.push({
    id: "young_living", type: "basic_living", displayName: "基础生活支出（系统保守估计）",
    monthlyAmountWan: 0.2, activeFromAgeInMonths: 18 * 12, status: "active", factStatus: "estimated",
    evidence: [{ source: "system_policy", reasonCode: "ADULT_BASIC_LIVING_ESTIMATED_V1", confidence: 0.6 }]
  });
  const committed = commit({ ledger: initial, worldState: world(), start, end: 24 * 12, transactionId: "adult_policy_step" });
  const active = committed.financialLedger.expenseCommitments.filter((item) => item.type === "basic_living" && item.status === "active");
  assert.equal(active.length, 1);
  assert.equal(active[0].monthlyAmountWan, 0.35);
  assert.equal(active[0].activeFromAgeInMonths, 23 * 12);
  assert.equal(committed.financialPeriodSummary?.coreExpenseWan, 6.6);
});

test("M7 focused: review status does not block deterministic system living policy transitions", () => {
  const start = 22 * 12;
  const initial = ledger(start, { cash: 20 });
  initial.expenseCommitments.push({
    id: "reviewed_young_living", type: "basic_living", displayName: "基础生活支出（系统保守估计）",
    monthlyAmountWan: 0.2, activeFromAgeInMonths: 18 * 12, status: "active", factStatus: "needs_review",
    evidence: [{ source: "system_policy", reasonCode: "ADULT_BASIC_LIVING_ESTIMATED_V1", confidence: 0.6 }]
  });
  const committed = commit({ ledger: initial, worldState: world(), start, end: 24 * 12, transactionId: "reviewed_policy_step" });
  const active = committed.financialLedger.expenseCommitments.filter((item) => item.type === "basic_living" && item.status === "active");
  assert.equal(active.length, 1);
  assert.equal(active[0].monthlyAmountWan, 0.35);
  assert.equal(active[0].factStatus, "estimated");
});

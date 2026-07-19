import assert from "node:assert/strict";
import test from "node:test";
import { initializeCareerState, validateAndAcceptCareerTransition } from "../career/careerState";
import type { CareerStateCollection } from "../career/types";
import { commitFinancialDomainTransaction } from "./commitFinancialDomainTransaction";
import { initializeFinancialLedger } from "./initializeLedger";
import { FinancialLedgerInvariantError, PRIMARY_CASH_ACCOUNT_ID } from "./ledgerMath";
import type { AcceptedFinancialEvent, FinancialEventKind, FinancialEventPayloadMap, FinancialEvidence, FinancialLedgerIssue } from "./types";
import type { WorldStateSnapshot } from "../../types";

const evidence: FinancialEvidence[] = [{ source: "accepted_simulation_outcome", sourceEventId: "start_business", reasonCode: "TEST_ACCEPTED", confidence: 1 }];

function accepted<K extends FinancialEventKind>(
  id: string,
  kind: K,
  effectiveAtAgeInMonths: number,
  payload: FinancialEventPayloadMap[K]
): AcceptedFinancialEvent<K> {
  return { id, kind, effectiveAtAgeInMonths, payload, evidence, acceptedByReasonCodes: ["TEST_ACCEPTED"] } as AcceptedFinancialEvent<K>;
}

function setup() {
  const careerState = initializeCareerState({ id: "career_employed", employmentStatus: "employed", effectiveFromAgeInMonths: 300 });
  const career: CareerStateCollection = { careerStates: [careerState], currentCareerStateId: careerState.id, careerRevision: 0 };
  const ledger = initializeFinancialLedger({
    id: "atomic_ledger",
    asOfAgeInMonths: 360,
    openingPosition: {
      cashAccounts: [{ id: PRIMARY_CASH_ACCOUNT_ID, type: "bank_deposit", balanceWan: 2, status: "active", factStatus: "known", evidence }]
    }
  });
  const worldState: WorldStateSnapshot = {
    people: [],
    directionArcs: [],
    pressureArcs: [],
    careerStates: [careerState],
    currentCareerStateId: careerState.id,
    currentEmploymentStatus: careerState.employmentStatus,
    careerRevision: 0,
    committedTransactionIds: [],
    version: 2
  };
  const transition = validateAndAcceptCareerTransition({
    proposal: {
      id: "start_business",
      fromCareerStateId: careerState.id,
      toStatus: "self_employed",
      occupation: "创业者",
      organization: "新公司",
      effectiveAtAgeInMonths: 361,
      sourceOutcomeId: "start_business",
      evidence: "你正式离职并创办新公司",
      confidence: 0.95
    },
    currentCareerState: careerState,
    acceptedOutcomeId: "start_business",
    narrativeText: "你正式离职并创办新公司。",
    periodStartAgeInMonths: 360,
    periodEndAgeInMonths: 361
  });
  return { career, ledger, worldState, transition };
}

test("commits CareerState, ledger, WorldState and derived snapshot as one transaction", () => {
  const current = setup();
  const nextCareerStateId = current.transition.nextCareerState.id;
  const result = commitFinancialDomainTransaction({
    transactionId: "atomic_success",
    periodStartAgeInMonths: 360,
    periodEndAgeInMonths: 361,
    expectedCareerRevision: 0,
    expectedLedgerRevision: 0,
    currentCareer: current.career,
    currentFinancialLedger: current.ledger,
    currentWorldState: current.worldState,
    acceptedCareerTransitions: [current.transition],
    acceptedFinancialEvents: [
      accepted("income_source", "income_source_started", 361, {
        id: "founder_draw",
        type: "self_employment_draw",
        displayName: "创始人个人提款",
        monthlyNetAmountWan: 1,
        accrualPolicy: "monthly",
        activeFromAgeInMonths: 361,
        status: "active",
        linkedCareerStateId: nextCareerStateId,
        factStatus: "known",
        evidence
      }),
      accepted("opening_income", "one_off_income_received", 361, {
        destinationCashAccountId: PRIMARY_CASH_ACCOUNT_ID,
        amountWan: 1
      })
    ],
    financialIssues: [{
      id: "career_transition_missing_prior", code: "CAREER_INCOME_CONFLICT", severity: "blocking", status: "open",
      relatedProposalIds: [], summary: "先前节点缺少职业转换", createdAtAgeInMonths: 360
    }]
  });
  assert.equal(result.alreadyCommitted, false);
  assert.equal(result.career.currentCareerStateId, nextCareerStateId);
  assert.equal(result.worldState.currentEmploymentStatus, "self_employed");
  assert.equal(result.worldState.careerRevision, 1);
  assert.equal(result.financialLedger.revision, 1);
  assert.equal(result.financialLedger.cashAccounts[0].balanceWan, 2.65);
  assert.equal(result.financialLedger.expenseCommitments[0]?.type, "basic_living");
  assert.equal(result.derivedFinancialState.state.employmentStatus, "self_employed");
  assert.equal(result.derivedFinancialState.compatibilityState.cashWan, 2.65);
  assert.deepEqual(result.worldState.committedTransactionIds, ["atomic_success"]);
  assert.equal(result.financialLedger.unresolvedIssues.find((item) => item.id === "career_transition_missing_prior")?.status, "resolved");
});

test("a ledger failure returns no partial CareerState or WorldState mutation", () => {
  const current = setup();
  assert.throws(() => commitFinancialDomainTransaction({
    transactionId: "atomic_failure",
    periodStartAgeInMonths: 360,
    periodEndAgeInMonths: 361,
    expectedCareerRevision: 0,
    expectedLedgerRevision: 0,
    currentCareer: current.career,
    currentFinancialLedger: current.ledger,
    currentWorldState: current.worldState,
    acceptedCareerTransitions: [current.transition],
    acceptedFinancialEvents: [accepted("unfunded", "one_off_expense_paid", 361, {
      sourceCashAccountId: PRIMARY_CASH_ACCOUNT_ID,
      amountWan: 5
    })]
  }), (error: unknown) => error instanceof FinancialLedgerInvariantError && error.code === "MISSING_FUNDING_SOURCE");
  assert.equal(current.career.currentCareerStateId, "career_employed");
  assert.equal(current.career.careerRevision, 0);
  assert.equal(current.ledger.revision, 0);
  assert.equal(current.ledger.cashAccounts[0].balanceWan, 2);
  assert.deepEqual(current.worldState.committedTransactionIds, []);
});

test("repeated domain transaction is idempotent only when ledger and WorldState agree", () => {
  const current = setup();
  const committed = commitFinancialDomainTransaction({
    transactionId: "atomic_once",
    periodStartAgeInMonths: 360,
    periodEndAgeInMonths: 361,
    expectedCareerRevision: 0,
    expectedLedgerRevision: 0,
    currentCareer: current.career,
    currentFinancialLedger: current.ledger,
    currentWorldState: current.worldState,
    acceptedCareerTransitions: [],
    acceptedFinancialEvents: []
  });
  const repeated = commitFinancialDomainTransaction({
    transactionId: "atomic_once",
    periodStartAgeInMonths: 360,
    periodEndAgeInMonths: 361,
    expectedCareerRevision: committed.career.careerRevision,
    expectedLedgerRevision: committed.financialLedger.revision,
    currentCareer: committed.career,
    currentFinancialLedger: committed.financialLedger,
    currentWorldState: committed.worldState,
    acceptedCareerTransitions: [],
    acceptedFinancialEvents: []
  });
  assert.equal(repeated.alreadyCommitted, true);
  assert.equal(repeated.financialLedger.revision, 1);
  assert.equal(repeated.worldState.committedTransactionIds?.length, 1);
});

test("a rejected fact quarantines only the affected recurring income and opens a pending issue", () => {
  const current = setup();
  current.ledger.incomeSources.push({
    id: "salary_main",
    type: "salary",
    displayName: "当前工资",
    monthlyNetAmountWan: 5,
    accrualPolicy: "monthly",
    activeFromAgeInMonths: 300,
    status: "active",
    linkedCareerStateId: "career_employed",
    factStatus: "known",
    evidence
  });
  const blockingIssue: FinancialLedgerIssue = {
    id: "rejected_salary_change",
    code: "CAREER_INCOME_CONFLICT",
    severity: "blocking",
    status: "open",
    relatedProposalIds: ["bad_salary_change"],
    relatedIncomeSourceIds: ["salary_main"],
    summary: "工资变化无法确认",
    createdAtAgeInMonths: 361
  };
  const first = commitFinancialDomainTransaction({
    transactionId: "pending_salary",
    periodStartAgeInMonths: 360,
    periodEndAgeInMonths: 361,
    expectedCareerRevision: 0,
    expectedLedgerRevision: 0,
    currentCareer: current.career,
    currentFinancialLedger: current.ledger,
    currentWorldState: current.worldState,
    acceptedCareerTransitions: [],
    acceptedFinancialEvents: [],
    financialIssues: [blockingIssue]
  });
  const salary = first.financialLedger.incomeSources.find((source) => source.id === "salary_main");
  assert.equal(salary?.factStatus, "needs_review");
  assert.equal(salary?.accrualReviewStatus, "quarantined");
  assert.ok(first.financialLedger.unresolvedIssues.some((issue) => issue.code === "PENDING_FACT" && issue.status === "open"));

  const second = commitFinancialDomainTransaction({
    transactionId: "pending_salary_next_period",
    periodStartAgeInMonths: 361,
    periodEndAgeInMonths: 362,
    expectedCareerRevision: first.career.careerRevision,
    expectedLedgerRevision: first.financialLedger.revision,
    currentCareer: first.career,
    currentFinancialLedger: first.financialLedger,
    currentWorldState: first.worldState,
    acceptedCareerTransitions: [],
    acceptedFinancialEvents: []
  });
  assert.equal(second.financialPeriodSummary?.incomeWan, 0);
});

test("a rolled-back career transaction keeps the previously accepted wage active", () => {
  const current = setup();
  current.ledger.incomeSources.push({
    id: "salary_main", type: "salary", displayName: "当前工资", monthlyNetAmountWan: 5,
    accrualPolicy: "monthly", activeFromAgeInMonths: 300, status: "active",
    linkedCareerStateId: "career_employed", factStatus: "known", evidence
  });
  const result = commitFinancialDomainTransaction({
    transactionId: "career_atomicity_rollback", periodStartAgeInMonths: 360, periodEndAgeInMonths: 361,
    expectedCareerRevision: 0, expectedLedgerRevision: 0, currentCareer: current.career,
    currentFinancialLedger: current.ledger, currentWorldState: current.worldState,
    acceptedCareerTransitions: [], acceptedFinancialEvents: [],
    financialIssues: [{
      id: "career_repair_atomicity_rollback", code: "CAREER_INCOME_CONFLICT", severity: "blocking", status: "open",
      relatedProposalIds: ["bad_transition", "bad_salary_migration"], relatedIncomeSourceIds: ["salary_main"],
      summary: "职业转换修复未通过，事务已整体回滚", createdAtAgeInMonths: 361
    }]
  });
  const salary = result.financialLedger.incomeSources.find((source) => source.id === "salary_main");
  assert.equal(result.financialPeriodSummary?.incomeWan, 5);
  assert.equal(salary?.factStatus, "known");
  assert.equal(salary?.accrualReviewStatus ?? "normal", "normal");
  assert.equal(result.financialLedger.unresolvedIssues.find((issue) => issue.id === "career_repair_atomicity_rollback")?.status, "open");
  assert.equal(result.financialLedger.unresolvedIssues.some((issue) => issue.id === "pending_fact_income_salary_main"), false);
});

test("an accepted source event wins over a malformed sibling issue in the same node", () => {
  const current = setup();
  current.ledger.incomeSources.push({
    id: "salary_main", type: "salary", displayName: "当前工资", monthlyNetAmountWan: 2,
    accrualPolicy: "monthly", activeFromAgeInMonths: 300, status: "active",
    linkedCareerStateId: "career_employed", factStatus: "known", evidence
  });
  const result = commitFinancialDomainTransaction({
    transactionId: "accepted_wins_same_node", periodStartAgeInMonths: 360, periodEndAgeInMonths: 361,
    expectedCareerRevision: 0, expectedLedgerRevision: 0, currentCareer: current.career,
    currentFinancialLedger: current.ledger, currentWorldState: current.worldState,
    acceptedCareerTransitions: [],
    acceptedFinancialEvents: [accepted("salary_confirmed", "income_source_adjusted", 361, {
      incomeSourceId: "salary_main",
      nextSource: { ...current.ledger.incomeSources[0], monthlyNetAmountWan: 2.5 }
    })],
    financialIssues: [{
      id: "malformed_salary_sibling", code: "UNBALANCED_TRANSACTION", severity: "blocking", status: "open",
      relatedProposalIds: ["bad_duplicate"], relatedIncomeSourceIds: ["salary_main"],
      summary: "同一响应中的重复工资 Proposal 无效", createdAtAgeInMonths: 361
    }]
  });
  const source = result.financialLedger.incomeSources.find((item) => item.id === "salary_main")!;
  assert.equal(source.monthlyNetAmountWan, 2.5);
  assert.equal(source.accrualReviewStatus, "normal");
  assert.equal(result.financialLedger.unresolvedIssues.find((item) => item.id === "malformed_salary_sibling")?.status, "resolved");
  assert.equal(result.financialLedger.unresolvedIssues.find((item) => item.id === "pending_fact_income_salary_main")?.status, "resolved");
});

test("a rejected adjustment uses the last accepted income baseline for at most two nodes", () => {
  const current = setup();
  current.ledger.expenseCommitments.push({ id: "living", type: "basic_living", displayName: "生活支出", monthlyAmountWan: 1, activeFromAgeInMonths: 300, status: "active", factStatus: "known", evidence });
  current.ledger.incomeSources.push({ id: "salary_main", type: "salary", displayName: "当前工资", monthlyNetAmountWan: 5, accrualPolicy: "monthly", activeFromAgeInMonths: 300, status: "active", linkedCareerStateId: "career_employed", factStatus: "known", evidence });
  const adjustmentIssue: FinancialLedgerIssue = { id: "rejected_adjustment", code: "UNBALANCED_TRANSACTION", severity: "blocking", status: "open", relatedProposalIds: ["adjust_salary"], relatedIncomeSourceIds: ["salary_main"], summary: "工资调整证据尚未确认", createdAtAgeInMonths: 361, pendingFactPolicy: "bounded_last_known_income" };
  const first = commitFinancialDomainTransaction({ transactionId: "bounded_salary_1", periodStartAgeInMonths: 360, periodEndAgeInMonths: 361, expectedCareerRevision: 0, expectedLedgerRevision: 0, currentCareer: current.career, currentFinancialLedger: current.ledger, currentWorldState: current.worldState, acceptedCareerTransitions: [], acceptedFinancialEvents: [], financialIssues: [adjustmentIssue] });
  assert.equal(first.financialPeriodSummary?.incomeWan, 5); assert.equal(first.financialLedger.incomeSources[0].accrualReviewStatus, "normal");
  const second = commitFinancialDomainTransaction({ transactionId: "bounded_salary_2", periodStartAgeInMonths: 361, periodEndAgeInMonths: 362, expectedCareerRevision: first.career.careerRevision, expectedLedgerRevision: first.financialLedger.revision, currentCareer: first.career, currentFinancialLedger: first.financialLedger, currentWorldState: first.worldState, acceptedCareerTransitions: [], acceptedFinancialEvents: [], financialIssues: [{ ...adjustmentIssue, createdAtAgeInMonths: 362 }] });
  assert.equal(second.financialPeriodSummary?.incomeWan, 5); assert.equal(second.financialLedger.incomeSources[0].accrualReviewStatus, "quarantined");
  const third = commitFinancialDomainTransaction({ transactionId: "bounded_salary_3", periodStartAgeInMonths: 362, periodEndAgeInMonths: 363, expectedCareerRevision: second.career.careerRevision, expectedLedgerRevision: second.financialLedger.revision, currentCareer: second.career, currentFinancialLedger: second.financialLedger, currentWorldState: second.worldState, acceptedCareerTransitions: [], acceptedFinancialEvents: [] });
  assert.equal(third.financialPeriodSummary?.incomeWan, 0);
});

test("a later accepted event resolves the matching issue and releases the quarantined source", () => {
  const current = setup();
  current.ledger.expenseCommitments.push({
    id: "living",
    type: "basic_living",
    displayName: "生活支出",
    monthlyAmountWan: 1,
    activeFromAgeInMonths: 300,
    status: "active",
    factStatus: "known",
    evidence
  });
  current.ledger.incomeSources.push({
    id: "salary_main",
    type: "salary",
    displayName: "当前工资",
    monthlyNetAmountWan: 5,
    accrualPolicy: "monthly",
    activeFromAgeInMonths: 300,
    status: "active",
    linkedCareerStateId: "career_employed",
    factStatus: "needs_review",
    accrualReviewStatus: "quarantined",
    evidence
  });
  current.ledger.unresolvedIssues.push({
    id: "pending_fact_income_salary_main_360",
    code: "PENDING_FACT",
    severity: "blocking",
    status: "open",
    relatedProposalIds: ["old_bad_change"],
    relatedIncomeSourceIds: ["salary_main"],
    summary: "等待工资确认",
    createdAtAgeInMonths: 360
  });
  const result = commitFinancialDomainTransaction({
    transactionId: "salary_confirmed",
    periodStartAgeInMonths: 360,
    periodEndAgeInMonths: 361,
    expectedCareerRevision: 0,
    expectedLedgerRevision: 0,
    currentCareer: current.career,
    currentFinancialLedger: current.ledger,
    currentWorldState: current.worldState,
    acceptedCareerTransitions: [],
    acceptedFinancialEvents: [accepted("salary_adjusted", "income_source_adjusted", 361, {
      incomeSourceId: "salary_main",
      nextSource: {
        ...current.ledger.incomeSources[0],
        monthlyNetAmountWan: 6,
        factStatus: "known"
      }
    })]
  });
  assert.equal(result.financialLedger.incomeSources[0].accrualReviewStatus, "normal");
  assert.equal(result.financialLedger.unresolvedIssues[0].status, "resolved");
  assert.equal(result.financialLedger.unresolvedIssues[0].resolvedByEventId, "salary_adjusted");
});

test("legacy estimated income is quarantined after three unconfirmed material nodes", () => {
  const current = setup();
  current.ledger.incomeSources.push({
    id: "legacy_recurring_income",
    type: "other",
    displayName: "旧版估算收入",
    monthlyNetAmountWan: 4,
    accrualPolicy: "monthly",
    activeFromAgeInMonths: 300,
    status: "active",
    factStatus: "estimated",
    lastConfirmedAtAgeInMonths: 359,
    evidence
  });
  current.ledger.recentTransactions.push(...[1, 2, 3].map((index) => ({
    id: `legacy_material_${index}`,
    simulationTransactionId: `legacy_material_${index}`,
    periodStartAgeInMonths: 360,
    periodEndAgeInMonths: 360 + index,
    eventIds: [],
    cashDeltaWan: 0,
    assetDeltaWan: 0,
    debtDeltaWan: 0,
    incomeWan: 0,
    expenseWan: 0,
    valuationChangeWan: 0,
    nonCashGainLossWan: 0,
    netWorthDeltaWan: 0,
    evidence: []
  })));
  const result = commitFinancialDomainTransaction({
    transactionId: "legacy_reconfirm",
    periodStartAgeInMonths: 360,
    periodEndAgeInMonths: 361,
    expectedCareerRevision: 0,
    expectedLedgerRevision: 0,
    currentCareer: current.career,
    currentFinancialLedger: current.ledger,
    currentWorldState: current.worldState,
    acceptedCareerTransitions: [],
    acceptedFinancialEvents: []
  });
  assert.equal(result.financialLedger.incomeSources[0].accrualReviewStatus, "quarantined");
  assert.ok(result.financialLedger.unresolvedIssues.some((issue) => issue.code === "PENDING_FACT" && issue.relatedIncomeSourceIds?.includes("legacy_recurring_income")));
});

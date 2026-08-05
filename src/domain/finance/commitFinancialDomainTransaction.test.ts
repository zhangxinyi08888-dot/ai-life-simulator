import assert from "node:assert/strict";
import test from "node:test";
import { initializeCareerState, validateAndAcceptCareerTransition } from "../career/careerState";
import type { CareerStateCollection } from "../career/types";
import { commitFinancialDomainTransaction } from "./commitFinancialDomainTransaction";
import { deriveDebtHealthState } from "./debtHealth";
import { initializeFinancialLedger } from "./initializeLedger";
import { FinancialLedgerInvariantError, PRIMARY_CASH_ACCOUNT_ID } from "./ledgerMath";
import { migrateFinancialLedgerV3ToV4 } from "./migrateFinancialLedgerV3ToV4";
import { buildExpenseLifecycleReviewPlan } from "./expenseLifecycleReview";
import type {
  AcceptedFinancialEvent,
  FinancialEventKind,
  FinancialEventPayloadMap,
  FinancialEvidence,
  FinancialLedgerIssue,
  FinancialLedgerV4
} from "./types";
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
    financialIssues: [
      {
        id: "career_transition_missing_prior", code: "CAREER_INCOME_CONFLICT", severity: "blocking", status: "open",
        relatedProposalIds: [], summary: "先前节点缺少职业转换", createdAtAgeInMonths: 360
      },
      {
        id: "personal_income_claim_without_event_360", code: "CAREER_INCOME_CONFLICT", severity: "blocking", status: "open",
        relatedProposalIds: [], summary: "先前正文收入没有 Accepted FinancialEvent", createdAtAgeInMonths: 360
      }
    ]
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
  assert.equal(result.financialLedger.unresolvedIssues.find((item) => item.id === "personal_income_claim_without_event_360")?.status, "resolved");
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

test("the adult basic-living floor never rewrites housing commitments", () => {
  const current = setup();
  current.ledger.expenseCommitments.push({
    id: "estimated_housing",
    type: "housing",
    displayName: "待复核住房支出",
    monthlyAmountWan: 0.12,
    activeFromAgeInMonths: 300,
    status: "active",
    factStatus: "estimated",
    evidence: [{ source: "system_policy", reasonCode: "HOUSING_CONTEXT_ESTIMATE_V1", confidence: 0.6 }]
  });
  const result = commitFinancialDomainTransaction({
    transactionId: "preserve_estimated_housing",
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
  const housing = result.financialLedger.expenseCommitments.find((item) => item.id === "estimated_housing");
  const basicLiving = result.financialLedger.expenseCommitments.find((item) => item.status === "active" && item.type === "basic_living");
  assert.equal(housing?.status, "active");
  assert.equal(housing?.monthlyAmountWan, 0.12);
  assert.equal(basicLiving?.monthlyAmountWan, 0.35);
});

test("the automatic basic-living floor is canonical when the transaction already uses ledger V4", () => {
  const current = setup();
  const v4 = migrateFinancialLedgerV3ToV4(current.ledger);
  const result = commitFinancialDomainTransaction({
    transactionId: "v4_auto_basic_living",
    periodStartAgeInMonths: 360,
    periodEndAgeInMonths: 361,
    expectedCareerRevision: 0,
    expectedLedgerRevision: 0,
    currentCareer: current.career,
    currentFinancialLedger: v4,
    currentWorldState: current.worldState,
    acceptedCareerTransitions: [],
    acceptedFinancialEvents: []
  });
  const basicLiving = result.financialLedger.expenseCommitments.find((item) => item.type === "basic_living");
  assert.equal(result.financialLedger.version, 4);
  assert.equal(basicLiving?.responsibilityKey, "adult_basic_living:protagonist");
  assert.equal(basicLiving?.responsibilityKind, "adult_basic_living");
  assert.equal(basicLiving?.amountBasis, "policy_floor");
  assert.equal(basicLiving?.financialScope, "personal");
});

test("the adult basic-living floor does not rewrite a V4 legacy aggregate", () => {
  const current = setup();
  current.ledger.expenseCommitments.push({
    id: "legacy_core_expense",
    type: "basic_living",
    displayName: "旧版核心支出聚合",
    monthlyAmountWan: 0.2,
    activeFromAgeInMonths: 300,
    status: "active",
    factStatus: "estimated",
    evidence: [{ source: "legacy_migration", reasonCode: "LEGACY_FINANCIAL_STATE_MIGRATION", confidence: 0.5 }]
  });
  const v4 = migrateFinancialLedgerV3ToV4(current.ledger);
  const result = commitFinancialDomainTransaction({
    transactionId: "v4_preserve_legacy_aggregate",
    periodStartAgeInMonths: 360,
    periodEndAgeInMonths: 361,
    expectedCareerRevision: 0,
    expectedLedgerRevision: 0,
    currentCareer: current.career,
    currentFinancialLedger: v4,
    currentWorldState: current.worldState,
    acceptedCareerTransitions: [],
    acceptedFinancialEvents: []
  });
  const aggregate = result.financialLedger.expenseCommitments.find((item) => item.id === "legacy_core_expense");
  assert.equal(aggregate?.responsibilityKind, "legacy_aggregate");
  assert.equal(aggregate?.monthlyAmountWan, 0.2);
  assert.equal(result.financialLedger.expenseCommitments.filter((item) => item.status === "active" && item.type === "basic_living").length, 1);
});

test("a scheduled V4 aggregate review does not resolve the outstanding component-gap issue", () => {
  const current = setup();
  current.ledger.expenseCommitments.push({
    id: "legacy_core_expense",
    type: "basic_living",
    displayName: "旧版总生活支出",
    monthlyAmountWan: 1.5,
    activeFromAgeInMonths: 300,
    status: "active",
    factStatus: "estimated",
    evidence: [{ source: "legacy_migration", reasonCode: "LEGACY_CORE_EXPENSE", confidence: 0.5 }]
  });
  const v4 = migrateFinancialLedgerV3ToV4(current.ledger);
  const aggregate = v4.expenseCommitments.find((item) => item.responsibilityKind === "legacy_aggregate")!;
  const componentGap: FinancialLedgerIssue = {
    id: `expense_component_gap_${aggregate.id}_primary_residence:main`,
    code: "EXPENSE_OPENING_COMPONENT_GAP",
    severity: "warning",
    status: "open",
    relatedProposalIds: [],
    relatedAccountIds: [aggregate.id],
    summary: "聚合支出覆盖关系未知；住房责任仅待复核，不能与聚合支出并行计提",
    createdAtAgeInMonths: 361
  };
  const systemReview: AcceptedFinancialEvent<"expense_commitment_adjusted"> = {
    id: "accepted_system_expense_review_legacy",
    proposalId: "system_expense_review_legacy",
    kind: "expense_commitment_adjusted",
    effectiveAtAgeInMonths: 361,
    payload: {
      expenseCommitmentId: aggregate.id,
      nextCommitment: {
        ...aggregate,
        factStatus: "needs_review",
        accrualReviewStatus: "review_due",
        lastReviewedAtAgeInMonths: 361,
        evidence: [...aggregate.evidence, {
          source: "system_policy",
          reasonCode: "SYSTEM_POLICY_REVIEW",
          confidence: 1,
          financialScope: "personal"
        }]
      }
    },
    evidence: [{
      source: "system_policy",
      reasonCode: "SYSTEM_POLICY_REVIEW",
      confidence: 1,
      financialScope: "personal"
    }],
    acceptedByReasonCodes: ["SYSTEM_POLICY_REVIEW"]
  };
  const result = commitFinancialDomainTransaction({
    transactionId: "legacy_aggregate_scheduled_review",
    periodStartAgeInMonths: 360,
    periodEndAgeInMonths: 361,
    expectedCareerRevision: 0,
    expectedLedgerRevision: 0,
    currentCareer: current.career,
    currentFinancialLedger: v4,
    currentWorldState: current.worldState,
    acceptedCareerTransitions: [],
    acceptedFinancialEvents: [systemReview],
    financialIssues: [componentGap]
  });
  const persistedGap = result.financialLedger.unresolvedIssues.find((item) => item.id === componentGap.id);
  assert.equal(persistedGap?.status, "open");
  assert.equal(result.financialLedger.expenseCommitments.find((item) => item.id === aggregate.id)?.monthlyAmountWan, 1.5);
});

test("a higher legacy basic-living estimate is not silently lowered to the policy floor", () => {
  const current = setup();
  current.ledger.expenseCommitments.push({
    id: "legacy_core_expense",
    type: "basic_living",
    displayName: "旧版核心支出聚合",
    monthlyAmountWan: 1.5,
    activeFromAgeInMonths: 300,
    status: "active",
    factStatus: "estimated",
    evidence: [{ source: "legacy_migration", reasonCode: "LEGACY_FINANCIAL_STATE_MIGRATION", confidence: 0.5 }]
  });
  const result = commitFinancialDomainTransaction({
    transactionId: "preserve_higher_legacy_living",
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
  const living = result.financialLedger.expenseCommitments.find((item) => item.id === "legacy_core_expense");
  assert.equal(living?.status, "active");
  assert.equal(living?.monthlyAmountWan, 1.5);
  assert.equal(result.financialPeriodSummary?.coreExpenseWan, 1.5);
});

test("an estimated basic-living adjustment cannot lower a higher legacy estimate", () => {
  const current = setup();
  current.ledger.expenseCommitments.push({
    id: "legacy_core_expense",
    type: "basic_living",
    displayName: "旧版核心支出聚合",
    monthlyAmountWan: 1.5,
    activeFromAgeInMonths: 300,
    status: "active",
    factStatus: "estimated",
    evidence: [{ source: "legacy_migration", reasonCode: "LEGACY_FINANCIAL_STATE_MIGRATION", confidence: 0.5 }]
  });
  const result = commitFinancialDomainTransaction({
    transactionId: "protect_legacy_living_adjustment",
    periodStartAgeInMonths: 360,
    periodEndAgeInMonths: 361,
    expectedCareerRevision: 0,
    expectedLedgerRevision: 0,
    currentCareer: current.career,
    currentFinancialLedger: current.ledger,
    currentWorldState: current.worldState,
    acceptedCareerTransitions: [],
    acceptedFinancialEvents: [accepted("lower_estimated_living", "expense_commitment_adjusted", 361, {
      expenseCommitmentId: "legacy_core_expense",
      nextCommitment: {
        id: "legacy_core_expense",
        type: "basic_living",
        displayName: "模型估算的基本生活支出",
        monthlyAmountWan: 0.35,
        activeFromAgeInMonths: 361,
        status: "active",
        factStatus: "estimated",
        evidence: []
      }
    })]
  });
  const living = result.financialLedger.expenseCommitments.find((item) => item.id === "legacy_core_expense");
  assert.equal(living?.monthlyAmountWan, 1.5);
  assert.ok(living?.evidence.some((item) => item.reasonCode === "BASIC_LIVING_DOWNWARD_REPLACEMENT_BLOCKED"));
});

test("an estimated basic-living adjustment cannot downgrade a higher known amount", () => {
  const current = setup();
  current.ledger.expenseCommitments.push({
    id: "known_basic_living",
    type: "basic_living",
    displayName: "已确认基本生活支出",
    monthlyAmountWan: 1.2,
    activeFromAgeInMonths: 300,
    status: "active",
    factStatus: "known",
    evidence
  });
  const result = commitFinancialDomainTransaction({
    transactionId: "protect_known_living_adjustment",
    periodStartAgeInMonths: 360,
    periodEndAgeInMonths: 361,
    expectedCareerRevision: 0,
    expectedLedgerRevision: 0,
    currentCareer: current.career,
    currentFinancialLedger: current.ledger,
    currentWorldState: current.worldState,
    acceptedCareerTransitions: [],
    acceptedFinancialEvents: [accepted("lower_estimated_known_living", "expense_commitment_adjusted", 361, {
      expenseCommitmentId: "known_basic_living",
      nextCommitment: {
        id: "known_basic_living",
        type: "basic_living",
        displayName: "模型估算的基本生活支出",
        monthlyAmountWan: 0.35,
        activeFromAgeInMonths: 361,
        status: "active",
        factStatus: "estimated",
        evidence: []
      }
    })]
  });
  const living = result.financialLedger.expenseCommitments.find((item) => item.id === "known_basic_living");
  assert.equal(living?.monthlyAmountWan, 1.2);
  assert.equal(living?.factStatus, "known");
  assert.ok(living?.evidence.some((item) => item.reasonCode === "BASIC_LIVING_DOWNWARD_REPLACEMENT_BLOCKED"));
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

test("a rejected debt proposal cannot revoke an existing user-authoritative debt balance", () => {
  const current = setup();
  current.ledger.debtAccounts.push({
    id: "opening_mortgage",
    type: "mortgage",
    displayName: "用户明确的住房按揭",
    principalWan: 210,
    openedAtAgeInMonths: 300,
    status: "active",
    repaymentPolicy: { mode: "estimated_amortizing", monthlyPrincipalWan: 0.875, remainingTermMonths: 240 },
    factStatus: "known",
    origin: "explicit",
    accruedUnpaidInterestWan: 0,
    servicingStatus: "current",
    consecutiveMissedPaymentMonths: 0,
    totalMissedPaymentMonths: 0,
    recentMissedPaymentAgeInMonths: [],
    evidence: [{ source: "user", reasonCode: "EXPLICIT_OPENING_FINANCIAL_FACT", confidence: 1 }]
  });
  const result = commitFinancialDomainTransaction({
    transactionId: "rejected_duplicate_debt",
    periodStartAgeInMonths: 360,
    periodEndAgeInMonths: 361,
    expectedCareerRevision: 0,
    expectedLedgerRevision: 0,
    currentCareer: current.career,
    currentFinancialLedger: current.ledger,
    currentWorldState: current.worldState,
    acceptedCareerTransitions: [],
    acceptedFinancialEvents: [],
    financialIssues: [{
      id: "bad_duplicate_debt",
      code: "UNBALANCED_TRANSACTION",
      severity: "blocking",
      status: "open",
      relatedProposalIds: ["missing_debt_drawn"],
      relatedDebtAccountIds: ["opening_mortgage"],
      summary: "债务变化缺少可靠证据",
      createdAtAgeInMonths: 361
    }]
  });
  assert.equal(result.financialLedger.debtAccounts[0].factStatus, "known");
  const health = deriveDebtHealthState({
    ledger: result.financialLedger,
    derivedFinancialState: result.derivedFinancialState.state
  });
  assert.equal(health.totalDebtWan, result.financialLedger.debtAccounts[0].principalWan);
  assert.notEqual(health.level, "none");
});

test("a current debt account immediately closes its active servicing issue", () => {
  const current = setup();
  current.ledger.debtAccounts.push({
    id: "recovered_loan",
    type: "consumer_loan",
    displayName: "已恢复履约的贷款",
    principalWan: 5,
    openedAtAgeInMonths: 300,
    status: "active",
    repaymentPolicy: { mode: "known_schedule", monthlyPrincipalWan: 0.2, monthlyInterestWan: 0.02, remainingTermMonths: 25 },
    factStatus: "known",
    origin: "explicit",
    accruedUnpaidInterestWan: 0,
    servicingStatus: "current",
    consecutiveMissedPaymentMonths: 0,
    totalMissedPaymentMonths: 1,
    recentMissedPaymentAgeInMonths: [359],
    evidence
  });
  current.ledger.unresolvedIssues.push({
    id: "debt_payment_servicing_recovered_loan",
    code: "DEBT_PAYMENT_MISSED",
    severity: "warning",
    status: "open",
    relatedProposalIds: [],
    relatedDebtAccountIds: ["recovered_loan"],
    summary: "债务已出现未足额履约",
    createdAtAgeInMonths: 359,
    lastObservedAtAgeInMonths: 359,
    occurrenceCount: 1
  });
  const result = commitFinancialDomainTransaction({
    transactionId: "servicing_recovered",
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
  const issue = result.financialLedger.unresolvedIssues.find((item) => item.id === "debt_payment_servicing_recovered_loan");
  assert.equal(issue?.status, "resolved");
  assert.equal(issue?.resolvedAtAgeInMonths, 361);
  assert.equal(issue?.resolvedByEventId, "system:servicing_recovered:servicing_recovered");
});

test("an overdue expense review keeps one open issue and later observations do not rewrite the account", () => {
  const current = setup();
  const v4 = migrateFinancialLedgerV3ToV4(current.ledger);
  v4.expenseCommitments.push({
    id: "overdue_parent_care",
    responsibilityKey: "elder_care:parents",
    responsibilityKind: "elder_care",
    type: "dependent_support",
    displayName: "父母照护",
    monthlyAmountWan: 0.2,
    amountBasis: "contextual_estimate",
    amountSourceIds: ["policy:elder-care"],
    estimationPolicyId: "expense-estimation-policy-v2:test-elder-care",
    financialScope: "personal",
    activeFromAgeInMonths: 300,
    status: "active",
    factStatus: "needs_review",
    accrualReviewStatus: "conservative",
    lastReviewedAtAgeInMonths: 300,
    nextReviewAtAgeInMonths: 361,
    evidence: [{ source: "system_policy", reasonCode: "EXPENSE_POLICY_ELDER_CARE", confidence: 1 }]
  });
  const firstPlan = buildExpenseLifecycleReviewPlan({ ledger: v4, ageInMonths: 361 });
  const first = commitFinancialDomainTransaction({
    transactionId: "overdue_expense_review_first",
    periodStartAgeInMonths: 360,
    periodEndAgeInMonths: 361,
    expectedCareerRevision: 0,
    expectedLedgerRevision: 0,
    currentCareer: current.career,
    currentFinancialLedger: v4,
    currentWorldState: current.worldState,
    acceptedCareerTransitions: [],
    acceptedFinancialEvents: firstPlan.events,
    financialIssues: firstPlan.issues
  });
  const firstIssue = first.financialLedger.unresolvedIssues.find((issue) => issue.id === "expense_review_due_overdue_parent_care");
  assert.equal(firstIssue?.status, "open", "a system review cannot resolve the missing amount/responsibility fact");
  assert.equal(firstIssue?.occurrenceCount, 1);

  const secondPlan = buildExpenseLifecycleReviewPlan({ ledger: first.financialLedger as FinancialLedgerV4, ageInMonths: 362 });
  assert.equal(secondPlan.events.some((event) => event.payload.expenseCommitmentId === "overdue_parent_care"), false);
  const second = commitFinancialDomainTransaction({
    transactionId: "overdue_expense_review_second",
    periodStartAgeInMonths: 361,
    periodEndAgeInMonths: 362,
    expectedCareerRevision: first.career.careerRevision,
    expectedLedgerRevision: first.financialLedger.revision,
    currentCareer: first.career,
    currentFinancialLedger: first.financialLedger,
    currentWorldState: first.worldState,
    acceptedCareerTransitions: [],
    acceptedFinancialEvents: [],
    financialIssues: secondPlan.issues
  });
  const secondIssue = second.financialLedger.unresolvedIssues.find((issue) => issue.id === "expense_review_due_overdue_parent_care");
  assert.equal(secondIssue?.status, "open");
  assert.equal(secondIssue?.occurrenceCount, 2);
  assert.equal(secondIssue?.lastObservedAtAgeInMonths, 362);
  const care = second.financialLedger.expenseCommitments.find((commitment) => commitment.id === "overdue_parent_care")!;
  assert.equal(care.lastReviewedAtAgeInMonths, 361);
  assert.equal(care.evidence.filter((item) => item.reasonCode === "EXPENSE_REVIEW_DUE").length, 1);
});

test("a needs-review adjustment cannot close an overdue expense issue, while an Accepted exact amount can", () => {
  const current = setup();
  const v4 = migrateFinancialLedgerV3ToV4(current.ledger);
  const care = {
    id: "reviewable_parent_care",
    responsibilityKey: "elder_care:parents",
    responsibilityKind: "elder_care" as const,
    type: "dependent_support" as const,
    displayName: "父母照护",
    monthlyAmountWan: 0.2,
    amountBasis: "contextual_estimate" as const,
    amountSourceIds: ["policy:elder-care"],
    estimationPolicyId: "expense-estimation-policy-v2:test-elder-care",
    financialScope: "personal" as const,
    activeFromAgeInMonths: 300,
    status: "active" as const,
    factStatus: "needs_review" as const,
    accrualReviewStatus: "review_due" as const,
    lastReviewedAtAgeInMonths: 361,
    nextReviewAtAgeInMonths: 361,
    evidence: [{ source: "system_policy" as const, reasonCode: "EXPENSE_REVIEW_DUE", confidence: 1, financialScope: "personal" as const }]
  };
  v4.expenseCommitments.push(care);
  v4.unresolvedIssues.push({
    id: "expense_review_due_reviewable_parent_care",
    code: "PENDING_FACT",
    severity: "warning",
    status: "open",
    relatedProposalIds: [],
    relatedAccountIds: [care.id],
    summary: "父母照护金额仍待确认",
    createdAtAgeInMonths: 361
  });

  const inexact = commitFinancialDomainTransaction({
    transactionId: "inexact_review_adjustment",
    periodStartAgeInMonths: 360,
    periodEndAgeInMonths: 362,
    expectedCareerRevision: 0,
    expectedLedgerRevision: 0,
    currentCareer: current.career,
    currentFinancialLedger: v4,
    currentWorldState: current.worldState,
    acceptedCareerTransitions: [],
    acceptedFinancialEvents: [accepted("narrative_only_parent_care", "expense_commitment_adjusted", 362, {
      expenseCommitmentId: care.id,
      nextCommitment: {
        ...care,
        lastReviewedAtAgeInMonths: 362,
        evidence: [...care.evidence, { source: "accepted_simulation_outcome", reasonCode: "CARE_ROUTINE_OBSERVED", confidence: 1, financialScope: "personal" }]
      }
    })]
  });
  assert.equal(inexact.financialLedger.unresolvedIssues.find((issue) => issue.id === "expense_review_due_reviewable_parent_care")?.status, "open");

  const observed = inexact.financialLedger.expenseCommitments.find((item) => item.id === care.id)!;
  const paused = commitFinancialDomainTransaction({
    transactionId: "authorized_review_pause",
    periodStartAgeInMonths: 360,
    periodEndAgeInMonths: 362,
    expectedCareerRevision: 0,
    expectedLedgerRevision: 0,
    currentCareer: current.career,
    currentFinancialLedger: v4,
    currentWorldState: current.worldState,
    acceptedCareerTransitions: [],
    acceptedFinancialEvents: [accepted("third_party_parent_care_pause", "expense_commitment_adjusted", 362, {
      expenseCommitmentId: care.id,
      previousCommitmentId: care.id,
      changeReason: "temporary_third_party_coverage",
      nextCommitment: { ...care, status: "paused" }
    })]
  });
  assert.equal(paused.financialLedger.unresolvedIssues.find((issue) => issue.id === "expense_review_due_reviewable_parent_care")?.status, "resolved");

  const exact = commitFinancialDomainTransaction({
    transactionId: "exact_review_adjustment",
    periodStartAgeInMonths: 362,
    periodEndAgeInMonths: 363,
    expectedCareerRevision: inexact.career.careerRevision,
    expectedLedgerRevision: inexact.financialLedger.revision,
    currentCareer: inexact.career,
    currentFinancialLedger: inexact.financialLedger,
    currentWorldState: inexact.worldState,
    acceptedCareerTransitions: [],
    acceptedFinancialEvents: [accepted("confirmed_parent_care", "expense_commitment_adjusted", 363, {
      expenseCommitmentId: care.id,
      nextCommitment: {
        ...observed,
        monthlyAmountWan: 0.25,
        confirmedMonthlyAmountWan: 0.25,
        amountBasis: "explicit_known",
        amountSourceIds: ["accepted:parent-care-2500"],
        factStatus: "known",
        accrualReviewStatus: "normal",
        lastConfirmedAtAgeInMonths: 363,
        lastReviewedAtAgeInMonths: 363,
        nextReviewAtAgeInMonths: 375,
        evidence: [{ source: "accepted_simulation_outcome", reasonCode: "PARENT_CARE_AMOUNT_CONFIRMED", confidence: 1, financialScope: "personal" }]
      }
    })]
  });
  assert.equal(exact.financialLedger.unresolvedIssues.find((issue) => issue.id === "expense_review_due_reviewable_parent_care")?.status, "resolved");
});

test("a rejected proposal cannot revoke a deterministic automatic-shortfall debt", () => {
  const current = setup();
  current.ledger.debtAccounts.push({
    id: "auto_shortfall",
    type: "liquidity_shortfall",
    displayName: "自动流动性缺口",
    principalWan: 3,
    openedAtAgeInMonths: 360,
    status: "active",
    repaymentPolicy: { mode: "event_driven" },
    factStatus: "known",
    origin: "system_auto_shortfall",
    accruedUnpaidInterestWan: 0,
    servicingStatus: "current",
    consecutiveMissedPaymentMonths: 0,
    totalMissedPaymentMonths: 0,
    recentMissedPaymentAgeInMonths: [],
    evidence: [{ source: "system_policy", reasonCode: "AUTOMATIC_LIQUIDITY_SHORTFALL", confidence: 1 }]
  });
  const result = commitFinancialDomainTransaction({
    transactionId: "rejected_shortfall_change",
    periodStartAgeInMonths: 360,
    periodEndAgeInMonths: 361,
    expectedCareerRevision: 0,
    expectedLedgerRevision: 0,
    currentCareer: current.career,
    currentFinancialLedger: current.ledger,
    currentWorldState: current.worldState,
    acceptedCareerTransitions: [],
    acceptedFinancialEvents: [],
    financialIssues: [{
      id: "bad_shortfall_change",
      code: "UNBALANCED_TRANSACTION",
      severity: "blocking",
      status: "open",
      relatedProposalIds: ["bad_change"],
      relatedDebtAccountIds: ["auto_shortfall"],
      summary: "缺口债变化缺少可靠证据",
      createdAtAgeInMonths: 361
    }]
  });
  assert.equal(result.financialLedger.debtAccounts[0].factStatus, "known");
  const health = deriveDebtHealthState({
    ledger: result.financialLedger,
    derivedFinancialState: result.derivedFinancialState.state
  });
  assert.notEqual(health.level, "unknown");
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

test("a later accepted career income resolves personal-compensation narrative coverage", () => {
  const current = setup();
  current.ledger.unresolvedIssues.push({
    id: "narrative_coverage_personal_compensation_360", code: "PENDING_FACT", severity: "blocking", status: "open",
    relatedProposalIds: [], summary: "正文薪酬尚未入账", createdAtAgeInMonths: 360
  });
  const result = commitFinancialDomainTransaction({
    transactionId: "resolve_personal_compensation", periodStartAgeInMonths: 360, periodEndAgeInMonths: 361,
    expectedCareerRevision: 0, expectedLedgerRevision: 0, currentCareer: current.career,
    currentFinancialLedger: current.ledger, currentWorldState: current.worldState,
    acceptedCareerTransitions: [],
    acceptedFinancialEvents: [accepted("salary_confirmed", "income_source_started", 361, {
      id: "salary_confirmed", type: "salary", displayName: "确认工资", monthlyNetAmountWan: 3,
      accrualPolicy: "monthly", activeFromAgeInMonths: 361, status: "active", linkedCareerStateId: "career_employed",
      factStatus: "known", evidence
    })]
  });
  const issue = result.financialLedger.unresolvedIssues.find((item) => item.id === "narrative_coverage_personal_compensation_360");
  assert.equal(issue?.status, "resolved");
  assert.equal(issue?.resolvedByEventId, "salary_confirmed");
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

test("a same-transaction accepted income event supersedes a rejected competing proposal", () => {
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
    id: "owner_draw",
    type: "self_employment_draw",
    displayName: "创业工资",
    monthlyNetAmountWan: 1,
    accrualPolicy: "monthly",
    activeFromAgeInMonths: 300,
    status: "active",
    linkedCareerStateId: "career_employed",
    factStatus: "known",
    evidence
  });
  const result = commitFinancialDomainTransaction({
    transactionId: "same_tx_income_confirmation",
    periodStartAgeInMonths: 360,
    periodEndAgeInMonths: 361,
    expectedCareerRevision: 0,
    expectedLedgerRevision: 0,
    currentCareer: current.career,
    currentFinancialLedger: current.ledger,
    currentWorldState: current.worldState,
    acceptedCareerTransitions: [],
    acceptedFinancialEvents: [accepted("owner_draw_confirmed", "income_source_adjusted", 360, {
      incomeSourceId: "owner_draw",
      nextSource: { ...current.ledger.incomeSources[0], monthlyNetAmountWan: 4.5, factStatus: "known" }
    })],
    financialIssues: [{
      id: "proposal_issue_competing_owner_draw",
      code: "UNBALANCED_TRANSACTION",
      severity: "blocking",
      status: "open",
      relatedProposalIds: ["bad_owner_draw"],
      relatedIncomeSourceIds: ["owner_draw"],
      summary: "竞争 Proposal 未通过校验",
      createdAtAgeInMonths: 361
    }]
  });
  const source = result.financialLedger.incomeSources.find((item) => item.id === "owner_draw");
  const issue = result.financialLedger.unresolvedIssues.find((item) => item.id === "proposal_issue_competing_owner_draw");
  assert.equal(source?.monthlyNetAmountWan, 4.5);
  assert.equal(source?.factStatus, "known");
  assert.equal(source?.accrualReviewStatus, "normal");
  assert.equal(issue?.status, "resolved");
  assert.equal(issue?.resolvedByEventId, "owner_draw_confirmed");
});

test("legacy estimated income is quarantined after three unconfirmed material nodes", () => {
  const current = setup();
  const legacyEvidence: FinancialEvidence[] = [{
    source: "legacy_migration",
    reasonCode: "LEGACY_FINANCIAL_STATE_MIGRATION",
    confidence: 0.5
  }];
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
    evidence: legacyEvidence
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
  assert.equal(result.financialPeriodSummary?.incomeWan, 0, "the third unconfirmed node must be isolated before it accrues");
  assert.ok(result.financialLedger.unresolvedIssues.some((issue) => (
    issue.code === "PENDING_FACT"
    && issue.severity === "warning"
    && issue.relatedIncomeSourceIds?.includes("legacy_recurring_income")
  )));
});

test("a same-node known adjustment resolves a due legacy income before pre-accrual isolation", () => {
  const current = setup();
  current.ledger.incomeSources.push({
    id: "legacy_recurring_income",
    type: "other",
    displayName: "旧版估算收入",
    monthlyNetAmountWan: 4,
    accrualPolicy: "monthly",
    activeFromAgeInMonths: 300,
    status: "active",
    linkedCareerStateId: "career_employed",
    factStatus: "estimated",
    lastConfirmedAtAgeInMonths: 359,
    evidence: [{ source: "legacy_migration", reasonCode: "LEGACY_FINANCIAL_STATE_MIGRATION", confidence: 0.5 }]
  });
  current.ledger.recentTransactions.push(...[1, 2].map((index) => ({
    id: `legacy_due_material_${index}`,
    simulationTransactionId: `legacy_due_material_${index}`,
    eventIds: [],
    periodStartAgeInMonths: 359 + index,
    periodEndAgeInMonths: 360 + index,
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
    transactionId: "legacy_due_income_confirmed",
    periodStartAgeInMonths: 360,
    periodEndAgeInMonths: 361,
    expectedCareerRevision: 0,
    expectedLedgerRevision: 0,
    currentCareer: current.career,
    currentFinancialLedger: current.ledger,
    currentWorldState: current.worldState,
    acceptedCareerTransitions: [],
    acceptedFinancialEvents: [accepted("legacy_due_income_confirmed", "income_source_adjusted", 361, {
      incomeSourceId: "legacy_recurring_income",
      nextSource: {
        ...current.ledger.incomeSources[0]!,
        type: "salary",
        monthlyNetAmountWan: 4.5,
        factStatus: "known",
        accrualReviewStatus: "normal"
      }
    })]
  });
  const source = result.financialLedger.incomeSources.find((item) => item.id === "legacy_recurring_income");
  assert.equal(source?.factStatus, "known");
  assert.equal(source?.accrualReviewStatus, "normal");
  assert.equal(source?.monthlyNetAmountWan, 4.5);
  assert.equal(result.financialPeriodSummary?.incomeWan, 4, "the pre-adjustment period accrues only because the same node supplied an accepted known fact");
  assert.equal(result.financialLedger.unresolvedIssues.some((issue) => issue.id === "pending_fact_legacy_income_legacy_recurring_income"), false);
});

test("a known legacy account with exact accepted compensation follows the normal recurring lifecycle", () => {
  const current = setup();
  current.ledger.incomeSources.push({
    id: "legacy_recurring_income",
    type: "salary",
    displayName: "已确认工资",
    annualNetAmountWan: 35,
    monthlyNetAmountWan: 35 / 12,
    accrualPolicy: "monthly",
    activeFromAgeInMonths: 336,
    status: "active",
    linkedCareerStateId: "career_employed",
    factStatus: "known",
    lastConfirmedAtAgeInMonths: 336,
    evidence: [{
      source: "accepted_simulation_outcome",
      sourceEventId: "accepted_promotion",
      excerpt: "你升职后税后年薪为35万元。",
      reasonCode: "EVIDENCE_EXACT_MATCHED",
      confidence: 0.9
    }]
  });

  const result = commitFinancialDomainTransaction({
    transactionId: "accepted_legacy_source_continues",
    periodStartAgeInMonths: 360,
    periodEndAgeInMonths: 383,
    expectedCareerRevision: 0,
    expectedLedgerRevision: 0,
    currentCareer: current.career,
    currentFinancialLedger: current.ledger,
    currentWorldState: current.worldState,
    acceptedCareerTransitions: [],
    acceptedFinancialEvents: []
  });

  const salary = result.financialLedger.incomeSources[0];
  assert.equal(result.financialPeriodSummary?.incomeWan, 67.0841);
  assert.equal(salary.accrualReviewStatus ?? "normal", "normal");
  assert.equal(result.financialLedger.unresolvedIssues.some((issue) => (
    issue.id === "pending_fact_legacy_income_legacy_recurring_income"
  )), false);
});

test("a vague accepted outcome does not silently reconfirm an estimated legacy income", () => {
  const current = setup();
  current.ledger.incomeSources.push({
    id: "legacy_recurring_income",
    type: "other",
    displayName: "旧版持续收入聚合",
    monthlyNetAmountWan: 1.5,
    annualNetAmountWan: 32,
    accrualPolicy: "monthly",
    activeFromAgeInMonths: 300,
    status: "active",
    linkedCareerStateId: "career_employed",
    factStatus: "estimated",
    lastConfirmedAtAgeInMonths: 359,
    evidence: [{
      source: "accepted_simulation_outcome",
      sourceEventId: "accepted_consulting_income_adjusted",
      excerpt: "项目制合同到期后，你按单结算，收入不再稳定。",
      reasonCode: "EVIDENCE_EXACT_MATCHED",
      confidence: 0.7
    }]
  });
  current.ledger.recentTransactions.push(...[1, 2, 3].map((index) => ({
    id: `vague_legacy_material_${index}`,
    simulationTransactionId: `vague_legacy_material_${index}`,
    eventIds: [],
    periodStartAgeInMonths: 360,
    periodEndAgeInMonths: 360 + index,
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
    transactionId: "vague_legacy_income_reconfirm",
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

  const source = result.financialLedger.incomeSources.find((item) => item.id === "legacy_recurring_income");
  assert.equal(source?.factStatus, "needs_review");
  assert.equal(source?.accrualReviewStatus, "quarantined");
  assert.equal(source?.type, "other");
  assert.equal(source?.monthlyNetAmountWan, 1.5);
  assert.equal(source?.annualNetAmountWan, 32);
  assert.equal(source?.lastConfirmedAtAgeInMonths, 359);
  assert.equal(result.financialPeriodSummary?.incomeWan, 0, "a vague accepted outcome cannot fund one extra pre-55 period");
  assert.ok(result.financialLedger.unresolvedIssues.some((issue) => (
    issue.id === "pending_fact_legacy_income_legacy_recurring_income"
    && issue.relatedIncomeSourceIds?.includes("legacy_recurring_income")
  )));
});

test("late-life stale estimated legacy income is quarantined before accrual without rewriting its old amount", () => {
  const current = setup();
  current.ledger.asOfAgeInMonths = 657;
  current.ledger.incomeSources.push({
    id: "legacy_recurring_income",
    type: "other",
    displayName: "旧版持续收入聚合",
    monthlyNetAmountWan: 1.5,
    annualNetAmountWan: 32,
    accrualPolicy: "monthly",
    activeFromAgeInMonths: 300,
    status: "active",
    linkedCareerStateId: "career_employed",
    factStatus: "estimated",
    lastConfirmedAtAgeInMonths: 398,
    evidence: [{
      source: "accepted_simulation_outcome",
      sourceEventId: "accepted_consulting_income_adjusted",
      excerpt: "项目制合同到期后，你按单结算，收入不再稳定。",
      reasonCode: "EVIDENCE_EXACT_MATCHED",
      confidence: 0.7
    }]
  });

  const result = commitFinancialDomainTransaction({
    transactionId: "late_stale_legacy_income",
    periodStartAgeInMonths: 657,
    periodEndAgeInMonths: 661,
    expectedCareerRevision: 0,
    expectedLedgerRevision: 0,
    currentCareer: current.career,
    currentFinancialLedger: current.ledger,
    currentWorldState: current.worldState,
    acceptedCareerTransitions: [],
    acceptedFinancialEvents: []
  });

  const source = result.financialLedger.incomeSources.find((item) => item.id === "legacy_recurring_income");
  assert.equal(source?.factStatus, "needs_review");
  assert.equal(source?.accrualReviewStatus, "quarantined");
  assert.equal(source?.type, "other");
  assert.equal(source?.monthlyNetAmountWan, 1.5);
  assert.equal(source?.annualNetAmountWan, 32);
  assert.equal(result.financialPeriodSummary?.incomeWan, 0);
  assert.ok(result.financialLedger.unresolvedIssues.some((issue) => (
    issue.code === "CAREER_STATE_STALE"
    && issue.relatedIncomeSourceIds?.includes("legacy_recurring_income")
  )));
});

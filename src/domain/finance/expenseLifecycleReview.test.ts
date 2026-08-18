import assert from "node:assert/strict";
import test from "node:test";
import { initializeFinancialLedger } from "./initializeLedger";
import { initializeCareerState } from "../career/careerState";
import { migrateFinancialLedgerV3ToV4 } from "./migrateFinancialLedgerV3ToV4";
import {
  buildExpenseLifecycleReviewPlan,
  expenseReviewRequiresPromptConfirmation,
  isPolicyOwnedExpenseEstimate
} from "./expenseLifecycleReview";
import { validateFinancialProposals } from "./validateFinancialProposals";
import type { ExpenseCommitmentV4, FinancialLedgerV3 } from "./types";

function ledger() {
  return migrateFinancialLedgerV3ToV4(initializeFinancialLedger({
    id: "review", asOfAgeInMonths: 80 * 12,
    openingPosition: {
      cashAccounts: [{
        id: "primary_cash", type: "bank_deposit", balanceWan: 20,
        status: "active", factStatus: "known",
        evidence: [{ source: "accepted_history", reasonCode: "TEST_RESERVE", confidence: 1 }]
      }],
      expenseCommitments: [{
      id: "long_term_medical", type: "healthcare", displayName: "长期用药", monthlyAmountWan: 0.12,
      activeFromAgeInMonths: 79 * 12, status: "active", factStatus: "known",
      evidence: [{ source: "accepted_history", reasonCode: "TREATMENT", confidence: 1, excerpt: "持续用药" }]
    }, {
      id: "paused_insurance", type: "insurance", displayName: "暂停保费", monthlyAmountWan: 0.08,
      activeFromAgeInMonths: 78 * 12, status: "paused", factStatus: "needs_review",
      evidence: [{ source: "accepted_history", reasonCode: "COVERAGE", confidence: 1 }]
      }]
    }
  }) as FinancialLedgerV3);
}

test("E-17/E-30 overdue healthcare remains nonzero and becomes review_due rather than ending", () => {
  const result = buildExpenseLifecycleReviewPlan({ ledger: ledger(), ageInMonths: 81 * 12 });
  const medical = result.events.find((item) => item.payload.expenseCommitmentId === "long_term_medical");
  assert.ok(medical);
  assert.equal(medical?.payload.nextCommitment.monthlyAmountWan, 0.12);
  assert.equal(medical?.payload.nextCommitment.status, "active");
  assert.equal(medical?.payload.nextCommitment.accrualReviewStatus, "review_due");
  assert.equal(medical?.payload.nextCommitment.lastConfirmedAtAgeInMonths, 79 * 12);
});

test("E-33 paused responsibility is reviewed but stays paused and therefore cannot accrue", () => {
  const result = buildExpenseLifecycleReviewPlan({ ledger: ledger(), ageInMonths: 81 * 12 });
  const paused = result.events.find((item) => item.payload.expenseCommitmentId === "paused_insurance");
  assert.ok(paused);
  assert.equal(paused?.payload.nextCommitment.status, "paused");
  assert.equal(paused?.payload.nextCommitment.monthlyAmountWan, 0.08);
});

test("a scheduled V4 review uses the ordinary schema and validator path without fabricating narrative evidence", () => {
  const currentLedger = ledger();
  const plan = buildExpenseLifecycleReviewPlan({ ledger: currentLedger, ageInMonths: 81 * 12 });
  const review = plan.events.find((event) => event.payload.expenseCommitmentId === "long_term_medical");
  assert.ok(review);
  const result = validateFinancialProposals({
    proposals: [{
      id: review!.proposalId,
      kind: review!.kind,
      effectiveAtAgeInMonths: review!.effectiveAtAgeInMonths,
      payload: review!.payload,
      evidence: review!.evidence.map((item) => item.excerpt).filter(Boolean).join("；") || "V4 支出责任到期复核",
      sourceOutcomeId: "review_outcome",
      confidence: 1,
      financialScope: "personal",
      systemGenerated: "expense_lifecycle_review"
    }],
    currentLedger,
    currentCareerState: initializeCareerState({ id: "retired", employmentStatus: "retired", effectiveFromAgeInMonths: 80 * 12 }),
    acceptedOutcomeId: "review_outcome",
    narrativeText: "你安静地整理旧照片。",
    periodStartAgeInMonths: 80 * 12,
    periodEndAgeInMonths: 81 * 12,
    simulationTransactionId: "scheduled_expense_review",
    liquidityPolicy: "require_explicit"
  });
  assert.equal(result.issues.length, 0, JSON.stringify(result.issues));
  assert.equal(result.acceptedEvents.length, 1);
  assert.equal(result.acceptedEvents[0].evidence[0].source, "system_policy");
  assert.equal(result.acceptedEvents[0].acceptedByReasonCodes.includes("SYSTEM_POLICY_REVIEW"), true);
});

test("an overdue review is a single account transition; later nodes retain one stable pending issue", () => {
  const current = ledger();
  const first = buildExpenseLifecycleReviewPlan({ ledger: current, ageInMonths: 81 * 12 });
  const firstMedical = first.events.find((event) => event.payload.expenseCommitmentId === "long_term_medical")!;
  const afterFirst = structuredClone(current);
  const index = afterFirst.expenseCommitments.findIndex((commitment) => commitment.id === "long_term_medical");
  afterFirst.expenseCommitments[index] = firstMedical.payload.nextCommitment as ExpenseCommitmentV4;

  const later = buildExpenseLifecycleReviewPlan({ ledger: afterFirst, ageInMonths: 82 * 12 });
  assert.equal(later.events.some((event) => event.payload.expenseCommitmentId === "long_term_medical"), false,
    "a past due date cannot append a new needs_review mutation every node");
  const outstanding = later.issues.find((item) => item.id === "expense_review_due_long_term_medical");
  assert.ok(outstanding, "the unresolved review remains visible for commit-time occurrence aggregation");
  assert.deepEqual(outstanding?.relatedProposalIds, []);
});

test("a stable overdue review asks the next-node prompt for confirmation only after two committed observations", () => {
  const issue = {
    id: "expense_review_due_long_term_medical",
    code: "PENDING_FACT" as const,
    severity: "warning" as const,
    status: "open" as const,
    relatedProposalIds: [],
    relatedAccountIds: ["long_term_medical"],
    summary: "持续支出长期用药已到复核时点",
    createdAtAgeInMonths: 81 * 12,
    occurrenceCount: 1
  };
  assert.equal(expenseReviewRequiresPromptConfirmation(issue), false);
  assert.equal(expenseReviewRequiresPromptConfirmation({ ...issue, occurrenceCount: 2 }), true);
  assert.equal(expenseReviewRequiresPromptConfirmation({ ...issue, occurrenceCount: 9, status: "resolved" }), false);
});

test("policy/context/legacy estimates remain nonzero reviewable accruals without demanding invented narrator confirmation", () => {
  const current = ledger();
  const policyFloor: ExpenseCommitmentV4 = {
    ...current.expenseCommitments[0]!,
    id: "policy_floor_basic_living",
    type: "basic_living",
    displayName: "基础生活支出（待确认）",
    responsibilityKey: "adult_basic_living:protagonist",
    responsibilityKind: "adult_basic_living",
    monthlyAmountWan: 0.35,
    confirmedMonthlyAmountWan: undefined,
    amountBasis: "policy_floor",
    amountSourceIds: ["opening_policy_adult_basic_living"],
    financialScope: "personal",
    factStatus: "needs_review",
    accrualReviewStatus: "normal",
    activeFromAgeInMonths: 80 * 12,
    nextReviewAtAgeInMonths: 81 * 12,
    evidence: [{ source: "system_policy", reasonCode: "OPENING_POLICY_FLOOR", confidence: 1, financialScope: "personal" }]
  };
  current.expenseCommitments = [policyFloor];
  const plan = buildExpenseLifecycleReviewPlan({ ledger: current, ageInMonths: 81 * 12 });
  const transition = plan.events.find((event) => event.payload.expenseCommitmentId === policyFloor.id);
  const issue = plan.issues.find((item) => item.id === `expense_review_due_${policyFloor.id}`);
  assert.ok(transition);
  assert.equal(transition?.payload.nextCommitment.monthlyAmountWan, 0.35);
  assert.equal(transition?.payload.nextCommitment.status, "active");
  assert.equal(transition?.payload.nextCommitment.accrualReviewStatus, "review_due");
  assert.equal(issue?.severity, "warning");
  assert.equal(expenseReviewRequiresPromptConfirmation({ ...issue!, occurrenceCount: 2 }, transition!.payload.nextCommitment), false);

  for (const amountBasis of ["policy_floor", "contextual_estimate", "legacy_estimate"] as const) {
    assert.equal(isPolicyOwnedExpenseEstimate({ ...transition!.payload.nextCommitment, amountBasis }), true);
    assert.equal(expenseReviewRequiresPromptConfirmation(
      { ...issue!, occurrenceCount: 2 },
      { ...transition!.payload.nextCommitment, amountBasis }
    ), false);
  }
  const explicitKnown = {
    ...transition!.payload.nextCommitment,
    amountBasis: "explicit_known" as const,
    confirmedMonthlyAmountWan: 0.35
  };
  assert.equal(isPolicyOwnedExpenseEstimate(explicitKnown), false);
  assert.equal(expenseReviewRequiresPromptConfirmation({ ...issue!, occurrenceCount: 2 }, explicitKnown), true);
});

test("the system-owned unclassified residual keeps a review issue without creating a competing adjustment writer", () => {
  const current = ledger();
  const residual: ExpenseCommitmentV4 = {
    ...current.expenseCommitments[0]!,
    id: "opening_unclassified_core_consumption_312",
    type: "basic_living",
    displayName: "未分类核心生活支出估算（待确认）",
    responsibilityKey: "unclassified_core_consumption:protagonist",
    responsibilityKind: "unclassified_core_consumption",
    monthlyAmountWan: 0.75,
    confirmedMonthlyAmountWan: undefined,
    amountBasis: "contextual_estimate",
    amountSourceIds: ["opening_unclassified_core_consumption_312"],
    financialScope: "personal",
    factStatus: "needs_review",
    accrualReviewStatus: "normal",
    activeFromAgeInMonths: 312,
    lastConfirmedAtAgeInMonths: undefined,
    lastReviewedAtAgeInMonths: 312,
    nextReviewAtAgeInMonths: 324,
    evidence: [{ source: "system_policy", reasonCode: "OPENING_UNCLASSIFIED_CORE_EXPENSE", confidence: 1, financialScope: "personal" }]
  };
  current.expenseCommitments = [residual];

  const plan = buildExpenseLifecycleReviewPlan({ ledger: current, ageInMonths: 328 });

  assert.equal(plan.events.length, 0, "only the deterministic residual reconciler may adjust this account");
  assert.deepEqual(plan.reviewedCommitmentIds, []);
  const issue = plan.issues.find((item) => item.id === `expense_review_due_${residual.id}`);
  assert.ok(issue, "the low-authority residual remains visibly due for classification review");
  assert.deepEqual(issue?.relatedProposalIds, []);
  assert.equal(expenseReviewRequiresPromptConfirmation({ ...issue!, occurrenceCount: 3 }, residual), false);
});

test("a legacy estimate with a pre-contract confirmation timestamp remains readable but is not copied into a new review mutation", () => {
  const current = ledger();
  const legacy = current.expenseCommitments[0]!;
  current.expenseCommitments = [{
    ...legacy,
    id: "legacy_timestamped_estimate",
    responsibilityKey: "adult_basic_living:protagonist",
    responsibilityKind: "adult_basic_living",
    type: "basic_living",
    factStatus: "needs_review",
    amountBasis: "legacy_estimate",
    confirmedMonthlyAmountWan: legacy.monthlyAmountWan,
    lastConfirmedAtAgeInMonths: 80 * 12,
    nextReviewAtAgeInMonths: 81 * 12,
    evidence: [{ source: "legacy_migration", reasonCode: "LEGACY_FINANCIAL_STATE_MIGRATION", confidence: 0.5, financialScope: "personal" }]
  }];
  const plan = buildExpenseLifecycleReviewPlan({ ledger: current, ageInMonths: 81 * 12 });
  assert.equal(plan.events.length, 0, "scheduled review must not re-write the legacy-invalid confirmation pair");
  assert.ok(plan.issues.some((issue) => issue.id === "expense_review_due_legacy_timestamped_estimate"));
});

test("a new responsibility review evidence causes one review transition and is persisted on the commitment", () => {
  const current = ledger();
  const changedEvidence = {
    source: "accepted_simulation_outcome" as const,
    reasonCode: "HIGH_AGE_PARENT_CARE_REVIEW",
    confidence: 1,
    financialScope: "personal" as const,
    excerpt: "父母已过百岁，请人照护的费用逐年增加。"
  };
  const plan = buildExpenseLifecycleReviewPlan({
    ledger: current,
    ageInMonths: 81 * 12,
    changedResponsibilityKeys: ["recurring_healthcare:long_term_medical"],
    changedEvidenceByResponsibilityKey: {
      "recurring_healthcare:long_term_medical": [changedEvidence]
    }
  });
  const review = plan.events.find((event) => event.payload.expenseCommitmentId === "long_term_medical")!;
  assert.ok(review.payload.nextCommitment.evidence.some((evidence) => evidence.reasonCode === "HIGH_AGE_PARENT_CARE_REVIEW"));
});

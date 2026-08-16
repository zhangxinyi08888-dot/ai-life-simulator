import assert from "node:assert/strict";
import test from "node:test";
import { deriveFinancialState } from "./deriveFinancialState";
import { initializeFinancialLedger } from "./initializeLedger";
import { PRIMARY_CASH_ACCOUNT_ID } from "./ledgerMath";
import { migrateFinancialLedgerV3ToV4 } from "./migrateFinancialLedgerV3ToV4";
import { reconcileUnclassifiedCoreExpense, UNCLASSIFIED_CORE_EXPENSE_ID } from "./reconcileUnclassifiedCoreExpense";
import { reduceFinancialLedger } from "./reduceFinancialLedger";
import type { AcceptedFinancialEvent, ExpenseCommitmentV4, FinancialEvidence, FinancialLedgerV3, FinancialLedgerV4 } from "./types";

const acceptedEvidence: FinancialEvidence[] = [{
  source: "accepted_simulation_outcome",
  sourceEventId: "accepted_expense",
  reasonCode: "TEST_ACCEPTED_EXPENSE",
  confidence: 1,
  financialScope: "personal"
}];

function floorLedger(): FinancialLedgerV4 {
  return migrateFinancialLedgerV3ToV4(initializeFinancialLedger({
    id: "unclassified_floor",
    asOfAgeInMonths: 360,
    openingPosition: {
      cashAccounts: [{
        id: PRIMARY_CASH_ACCOUNT_ID,
        type: "bank_deposit",
        balanceWan: 100,
        status: "active",
        factStatus: "known",
        evidence: acceptedEvidence
      }],
      incomeSources: [{
        id: "salary",
        type: "salary",
        displayName: "个人工资",
        monthlyNetAmountWan: 2,
        accrualPolicy: "monthly",
        activeFromAgeInMonths: 360,
        status: "active",
        factStatus: "known",
        evidence: acceptedEvidence
      }],
      expenseCommitments: [{
        id: "adult_floor",
        type: "basic_living",
        displayName: "成年基础生活最低线",
        monthlyAmountWan: 0.35,
        activeFromAgeInMonths: 360,
        status: "active",
        factStatus: "needs_review",
        evidence: [{ source: "system_policy", reasonCode: "ADULT_BASIC_LIVING_ESTIMATED_V1", confidence: 1 }]
      }]
    }
  }) as FinancialLedgerV3);
}

function housingStart(amount: number, ageInMonths: number): AcceptedFinancialEvent {
  const commitment: ExpenseCommitmentV4 = {
    id: `housing_${ageInMonths}`,
    responsibilityKey: "primary_residence:main",
    responsibilityKind: "primary_residence",
    type: "housing",
    displayName: "个人住房支出",
    monthlyAmountWan: amount,
    confirmedMonthlyAmountWan: amount,
    amountBasis: "explicit_known",
    amountSourceIds: [`accepted_housing_${ageInMonths}`],
    financialScope: "personal",
    activeFromAgeInMonths: ageInMonths,
    status: "active",
    factStatus: "known",
    accrualReviewStatus: "normal",
    lastConfirmedAtAgeInMonths: ageInMonths,
    lastReviewedAtAgeInMonths: ageInMonths,
    nextReviewAtAgeInMonths: ageInMonths + 36,
    evidence: acceptedEvidence
  };
  return {
    id: `accepted_housing_start_${ageInMonths}`,
    kind: "expense_commitment_started",
    effectiveAtAgeInMonths: ageInMonths,
    payload: commitment,
    evidence: acceptedEvidence,
    acceptedByReasonCodes: ["TEST_ACCEPTED"]
  } as AcceptedFinancialEvent;
}

function salaryStart(amount: number, ageInMonths: number): AcceptedFinancialEvent {
  return {
    id: `accepted_salary_start_${ageInMonths}`,
    kind: "income_source_started",
    effectiveAtAgeInMonths: ageInMonths,
    payload: {
      id: `salary_${ageInMonths}`,
      type: "salary",
      displayName: "个人工资",
      monthlyNetAmountWan: amount,
      accrualPolicy: "monthly",
      activeFromAgeInMonths: ageInMonths,
      status: "active",
      factStatus: "known",
      evidence: acceptedEvidence
    },
    evidence: acceptedEvidence,
    acceptedByReasonCodes: ["TEST_ACCEPTED"]
  } as AcceptedFinancialEvent;
}

function reconcile(input: { ledger: FinancialLedgerV4; transactionId: string; events?: AcceptedFinancialEvent[]; end?: number }) {
  return reconcileUnclassifiedCoreExpense({
    ledger: input.ledger,
    transactionId: input.transactionId,
    periodStartAgeInMonths: input.ledger.asOfAgeInMonths,
    periodEndAgeInMonths: input.end || input.ledger.asOfAgeInMonths + 12,
    acceptedFinancialEvents: input.events || [],
    estimateContext: { employmentStatus: "employed", livingArrangement: "unknown", cityCostBand: "medium", householdSize: 1 }
  });
}

test("a floor-only employed adult receives an accruing unclassified residual instead of remaining at 4.2 万/year", () => {
  const ledger = floorLedger();
  const events = reconcile({ ledger, transactionId: "create_residual" });
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, "expense_commitment_started");
  const residual = events[0].payload as ExpenseCommitmentV4;
  assert.equal(residual.id, UNCLASSIFIED_CORE_EXPENSE_ID);
  assert.equal(residual.monthlyAmountWan, 0.55);
  assert.equal(residual.factStatus, "needs_review");
  assert.equal(residual.amountBasis, "contextual_estimate");

  const committed = reduceFinancialLedger({
    ledger,
    transactionId: "create_residual",
    expectedLedgerRevision: ledger.revision,
    periodStartAgeInMonths: 360,
    periodEndAgeInMonths: 372,
    events
  });
  assert.equal(committed.alreadyCommitted, false);
  assert.equal(deriveFinancialState({ ledger: committed.ledger, employmentStatus: "employed" }).state.annualizedCoreExpenseWan, 10.8);
});

test("a salary accepted at the opening boundary affects the same transaction estimate", () => {
  const ledger = floorLedger();
  ledger.incomeSources = [];
  const events = reconcile({ ledger, transactionId: "same_boundary_salary", events: [salaryStart(2, 360)] });
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, "expense_commitment_started");
  if (events[0].kind !== "expense_commitment_started") throw new Error("expected start");
  assert.equal(events[0].payload.monthlyAmountWan, 0.55);
});

test("a later accepted typed expense atomically consumes the unclassified residual without double counting", () => {
  const opening = floorLedger();
  const created = reduceFinancialLedger({
    ledger: opening,
    transactionId: "residual_open",
    expectedLedgerRevision: opening.revision,
    periodStartAgeInMonths: 360,
    periodEndAgeInMonths: 372,
    events: reconcile({ ledger: opening, transactionId: "residual_open" })
  });
  assert.equal(created.alreadyCommitted, false);
  const ledger = created.ledger as FinancialLedgerV4;
  const housing = housingStart(0.3, 378);
  const residualEvents = reconcile({ ledger, transactionId: "split_residual", events: [housing], end: 384 });
  const adjustment = residualEvents.find((event) => event.kind === "expense_commitment_adjusted");
  assert.ok(adjustment && adjustment.kind === "expense_commitment_adjusted");
  assert.equal(adjustment.payload.nextCommitment.monthlyAmountWan, 0.25);
  assert.equal(adjustment.payload.changeReason, "aggregate_residual_reallocated");

  const committed = reduceFinancialLedger({
    ledger,
    transactionId: "split_residual",
    expectedLedgerRevision: ledger.revision,
    periodStartAgeInMonths: 372,
    periodEndAgeInMonths: 384,
    events: [housing, ...residualEvents]
  });
  assert.equal(committed.alreadyCommitted, false);
  assert.equal(deriveFinancialState({ ledger: committed.ledger, employmentStatus: "employed" }).state.annualizedCoreExpenseWan, 10.8);
});

test("a typed expense larger than the residual ends the aggregate and raises total spending", () => {
  const opening = floorLedger();
  const opened = reduceFinancialLedger({
    ledger: opening,
    transactionId: "large_residual_open",
    expectedLedgerRevision: opening.revision,
    periodStartAgeInMonths: 360,
    periodEndAgeInMonths: 372,
    events: reconcile({ ledger: opening, transactionId: "large_residual_open" })
  });
  assert.equal(opened.alreadyCommitted, false);
  const ledger = opened.ledger as FinancialLedgerV4;
  const housing = housingStart(0.7, 372);
  const residualEvents = reconcile({ ledger, transactionId: "large_split", events: [housing], end: 384 });
  assert.equal(residualEvents.some((event) => event.kind === "expense_commitment_ended"), true);
  const committed = reduceFinancialLedger({
    ledger,
    transactionId: "large_split",
    expectedLedgerRevision: ledger.revision,
    periodStartAgeInMonths: 372,
    periodEndAgeInMonths: 384,
    events: [housing, ...residualEvents]
  });
  assert.equal(committed.alreadyCommitted, false);
  assert.equal(deriveFinancialState({ ledger: committed.ledger, employmentStatus: "employed" }).state.annualizedCoreExpenseWan, 12.6);
});

test("a later context review reopens an ended residual with a non-colliding account id", () => {
  const ledger = floorLedger();
  ledger.expenseCommitments.push({
    id: UNCLASSIFIED_CORE_EXPENSE_ID,
    responsibilityKey: "unclassified_core_consumption:protagonist",
    responsibilityKind: "unclassified_core_consumption",
    type: "other",
    displayName: "旧未分类余额",
    monthlyAmountWan: 0.55,
    amountBasis: "contextual_estimate",
    amountSourceIds: ["expense-aggregate-fallback-policy-v1@1"],
    financialScope: "personal",
    activeFromAgeInMonths: 348,
    status: "ended",
    factStatus: "needs_review",
    accrualReviewStatus: "conservative",
    nextReviewAtAgeInMonths: 360,
    evidence: [{ source: "system_policy", reasonCode: "EXPENSE_UNCLASSIFIED_CORE_CONSUMPTION", confidence: 1 }]
  });

  const events = reconcile({ ledger, transactionId: "reopen_residual" });
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, "expense_commitment_started");
  if (events[0].kind !== "expense_commitment_started") throw new Error("expected start");
  assert.equal(events[0].payload.id, `${UNCLASSIFIED_CORE_EXPENSE_ID}_360`);
});

test("an active legacy aggregate suppresses the new fallback", () => {
  const ledger = floorLedger();
  ledger.expenseCommitments[0] = {
    ...ledger.expenseCommitments[0],
    id: "legacy_total",
    responsibilityKey: "legacy_aggregate:opening",
    responsibilityKind: "legacy_aggregate",
    type: "other",
    amountBasis: "legacy_estimate",
    amountSourceIds: ["legacy_opening"],
    monthlyAmountWan: 1.2,
    estimationPolicyId: undefined,
    evidence: [{ source: "legacy_migration", reasonCode: "LEGACY_FINANCIAL_STATE_MIGRATION", confidence: 0.5 }]
  };
  assert.deepEqual(reconcile({ ledger, transactionId: "legacy_suppressed" }), []);
});

import assert from "node:assert/strict";
import test from "node:test";
import { deriveFinancialState } from "./deriveFinancialState";
import { initializeFinancialLedger } from "./initializeLedger";
import { assertFinancialLedgerInvariants, FinancialLedgerInvariantError, PRIMARY_CASH_ACCOUNT_ID } from "./ledgerMath";
import { migrateFinancialLedgerV3ToV4, preflightFinancialLedgerV3ToV4 } from "./migrateFinancialLedgerV3ToV4";
import { reduceFinancialLedger } from "./reduceFinancialLedger";
import type { AcceptedFinancialEvent, DebtAccount, ExpenseCommitment, FinancialEvidence } from "./types";

const evidence: FinancialEvidence[] = [{
  source: "accepted_history",
  sourceEventId: "history_expense_fact",
  reasonCode: "TEST_ACCEPTED_EXPENSE_FACT",
  confidence: 1,
  financialScope: "personal"
}];

function v3Ledger(input: { expenses?: ExpenseCommitment[]; debts?: DebtAccount[] } = {}) {
  return initializeFinancialLedger({
    id: "v3_to_v4",
    asOfAgeInMonths: 360,
    openingPosition: {
      cashAccounts: [{
        id: PRIMARY_CASH_ACCOUNT_ID,
        type: "bank_deposit",
        balanceWan: 30,
        status: "active",
        factStatus: "known",
        evidence
      }],
      expenseCommitments: input.expenses,
      debtAccounts: input.debts
    }
  });
}

function mortgage(): DebtAccount {
  return {
    id: "mortgage_main",
    type: "mortgage",
    displayName: "住房贷款",
    principalWan: 120,
    openedAtAgeInMonths: 300,
    status: "active",
    repaymentPolicy: {
      mode: "known_schedule",
      monthlyPrincipalWan: 0.5,
      monthlyInterestWan: 0.3,
      remainingTermMonths: 240
    },
    factStatus: "known",
    evidence
  };
}

test("V3 legacy aggregate is preserved prospectively as one nonzero reviewable V4 responsibility", () => {
  const input = v3Ledger({ expenses: [{
    id: "legacy_core_expense",
    type: "basic_living",
    displayName: "旧版核心支出聚合",
    monthlyAmountWan: 1.5,
    activeFromAgeInMonths: 300,
    status: "active",
    factStatus: "estimated",
    evidence: [{ source: "legacy_migration", reasonCode: "LEGACY_CORE_EXPENSE", confidence: 0.5 }]
  }] });
  const original = structuredClone(input);
  const migrated = migrateFinancialLedgerV3ToV4(input);
  const aggregate = migrated.expenseCommitments[0];

  assert.deepEqual(input, original, "migration must not rewrite the persisted V3 snapshot");
  assert.equal(migrated.version, 4);
  assert.equal(aggregate.responsibilityKind, "legacy_aggregate");
  assert.equal(aggregate.responsibilityKey, "legacy_aggregate:opening");
  assert.equal(aggregate.monthlyAmountWan, 1.5, "legacy aggregate must not be silently replaced by the 0.35 floor");
  assert.equal(aggregate.factStatus, "needs_review");
  assert.equal(aggregate.accrualReviewStatus, "review_due");
  assert.ok(migrated.unresolvedIssues.some((item) => item.code === "EXPENSE_OPENING_COMPONENT_GAP"));
  assert.deepEqual(migrateFinancialLedgerV3ToV4(migrated), migrated, "a V4 restore is idempotent");
});

test("V4 enforces the protagonist share and excludes commercial-premise evidence from personal accrual", () => {
  const shared = migrateFinancialLedgerV3ToV4(v3Ledger({ expenses: [{
    id: "shared_home",
    type: "housing",
    displayName: "共同租住公寓",
    monthlyAmountWan: 0.26,
    grossMonthlyAmountWan: 0.52,
    householdShareRate: 0.5,
    financialScope: "shared_household",
    amountBasis: "explicit_shared_amount",
    amountSourceIds: ["lease:main"],
    confirmedMonthlyAmountWan: 0.26,
    activeFromAgeInMonths: 300,
    status: "active",
    factStatus: "known",
    evidence
  }] }));
  assertFinancialLedgerInvariants(shared);

  const overcharged = structuredClone(shared);
  overcharged.expenseCommitments[0].monthlyAmountWan = 0.52;
  assert.throws(() => assertFinancialLedgerInvariants(overcharged), (error: unknown) => (
    error instanceof FinancialLedgerInvariantError && /总额乘以承担比例/.test(error.message)
  ));

  const workshop = migrateFinancialLedgerV3ToV4(v3Ledger({ expenses: [{
    id: "workshop_rent",
    type: "housing",
    displayName: "木工坊月租",
    monthlyAmountWan: 0.8,
    activeFromAgeInMonths: 300,
    status: "active",
    factStatus: "estimated",
    evidence: [{
      source: "accepted_history",
      reasonCode: "WORKSHOP_LEASE",
      confidence: 1,
      financialScope: "business_operating",
      excerpt: "你租下一间木工坊，用于公司的生产和客户展示。"
    }]
  }] }));
  assert.equal(workshop.expenseCommitments[0].status, "paused");
  assert.ok(workshop.unresolvedIssues.some((item) => item.code === "EXPENSE_BUSINESS_FLOW_IN_PERSONAL_LEDGER"));
  assert.equal(deriveFinancialState({ ledger: workshop, employmentStatus: "employed" }).state.annualizedCoreExpenseWan, 0);
});

test("V4 pause preserves responsibility identity while stopping accrual, and a mortgage payment is removed from housing", () => {
  const v4 = migrateFinancialLedgerV3ToV4(v3Ledger({ expenses: [{
    id: "basic_living",
    type: "basic_living",
    displayName: "个人基本生活费",
    monthlyAmountWan: 0.5,
    activeFromAgeInMonths: 300,
    status: "active",
    factStatus: "known",
    evidence
  }] }));
  const current = v4.expenseCommitments[0];
  assert.throws(() => reduceFinancialLedger({
    ledger: v4,
    transactionId: "pause_v4_without_authority",
    expectedLedgerRevision: 0,
    periodStartAgeInMonths: 360,
    periodEndAgeInMonths: 361,
    events: [{
      id: "pause_without_authority",
      kind: "expense_commitment_adjusted",
      effectiveAtAgeInMonths: 360,
      payload: {
        expenseCommitmentId: current.id,
        nextCommitment: { ...current, status: "paused", activeUntilAgeInMonths: undefined }
      },
      evidence,
      acceptedByReasonCodes: ["TEST"]
    }]
  }), /previousCommitmentId/);
  const pause: AcceptedFinancialEvent<"expense_commitment_adjusted"> = {
    id: "pause_basic_living",
    kind: "expense_commitment_adjusted",
    effectiveAtAgeInMonths: 360,
    payload: {
      expenseCommitmentId: current.id,
      previousCommitmentId: current.id,
      changeReason: "temporary_third_party_coverage",
      nextCommitment: { ...current, status: "paused", activeUntilAgeInMonths: undefined }
    },
    evidence,
    acceptedByReasonCodes: ["ACCEPTED_TEMPORARY_THIRD_PARTY_PAYMENT"]
  };
  const result = reduceFinancialLedger({
    ledger: v4,
    transactionId: "pause_v4_expense",
    expectedLedgerRevision: 0,
    periodStartAgeInMonths: 360,
    periodEndAgeInMonths: 361,
    events: [pause]
  });
  assert.equal(result.alreadyCommitted, false);
  if (result.alreadyCommitted) throw new Error("expected new V4 transaction");
  assert.equal(result.ledger.expenseCommitments[0].status, "paused");
  assert.equal(result.ledger.expenseCommitments[0].responsibilityKey, current.responsibilityKey);
  assert.equal(result.periodSummary.coreExpenseWan, 0, "paused commitments cannot accrue");
  assert.equal(deriveFinancialState({ ledger: result.ledger, employmentStatus: "employed" }).state.annualizedCoreExpenseWan, 0);

  const mortgageLedger = migrateFinancialLedgerV3ToV4(v3Ledger({
    debts: [mortgage()],
    expenses: [{
      id: "mortgage_as_housing",
      type: "housing",
      displayName: "房贷月供",
      monthlyAmountWan: 1.3,
      activeFromAgeInMonths: 300,
      status: "active",
      factStatus: "known",
      evidence: [{ ...evidence[0], excerpt: "每月房贷月供 1.3 万元" }]
    }]
  }));
  assert.equal(mortgageLedger.expenseCommitments[0].status, "ended");
  assert.ok(mortgageLedger.unresolvedIssues.some((item) => item.code === "EXPENSE_DEBT_SERVICE_DOUBLE_COUNT"));
});

test("migration preserves supplied opening responsibility identities and pauses only a duplicate active key", () => {
  const supplied = {
    type: "dependent_support" as const,
    displayName: "父母照护责任",
    monthlyAmountWan: 0.3,
    activeFromAgeInMonths: 360,
    status: "active" as const,
    factStatus: "needs_review" as const,
    responsibilityKind: "elder_care" as const,
    responsibilityKey: "elder_care:opening_parent",
    amountBasis: "contextual_estimate" as const,
    amountSourceIds: ["opening:parent-care"],
    estimationPolicyId: "expense-estimation-policy-v2:elder-care",
    financialScope: "personal" as const,
    accrualReviewStatus: "conservative" as const,
    nextReviewAtAgeInMonths: 372,
    evidence
  };
  const migrated = migrateFinancialLedgerV3ToV4(v3Ledger({ expenses: [
    { id: "parent_care_a", ...supplied },
    { id: "parent_care_duplicate", ...supplied }
  ] }));
  const first = migrated.expenseCommitments.find((item) => item.id === "parent_care_a")!;
  const duplicate = migrated.expenseCommitments.find((item) => item.id === "parent_care_duplicate")!;

  assert.equal(first.responsibilityKey, "elder_care:opening_parent");
  assert.equal(first.amountBasis, "contextual_estimate");
  assert.equal(first.nextReviewAtAgeInMonths, 372);
  assert.equal(duplicate.status, "paused");
  assert.ok(migrated.unresolvedIssues.some((item) => item.code === "EXPENSE_DUPLICATE_RESPONSIBILITY"));
});

test("unknown V3 aggregate coverage never double-accrues migrated rent and healthcare components", () => {
  const migrated = migrateFinancialLedgerV3ToV4(v3Ledger({ expenses: [
    {
      id: "legacy_core_expense",
      type: "basic_living",
      displayName: "旧版核心支出聚合",
      monthlyAmountWan: 1.5,
      activeFromAgeInMonths: 300,
      status: "active",
      factStatus: "estimated",
      evidence: [{ source: "legacy_migration", reasonCode: "LEGACY_CORE_EXPENSE", confidence: 0.5 }]
    },
    {
      id: "legacy_rent",
      type: "housing",
      displayName: "房租",
      monthlyAmountWan: 0.5,
      activeFromAgeInMonths: 300,
      status: "active",
      factStatus: "known",
      evidence
    },
    {
      id: "legacy_parent_medical",
      type: "healthcare",
      displayName: "父母医疗",
      monthlyAmountWan: 0.3,
      activeFromAgeInMonths: 300,
      status: "active",
      factStatus: "known",
      evidence
    }
  ] }));
  const active = migrated.expenseCommitments.filter((item) => item.status === "active");
  const rent = migrated.expenseCommitments.find((item) => item.id === "legacy_rent")!;
  const healthcare = migrated.expenseCommitments.find((item) => item.id === "legacy_parent_medical")!;

  assert.equal(active.length, 1);
  assert.equal(active[0]?.responsibilityKind, "legacy_aggregate");
  assert.equal(deriveFinancialState({ ledger: migrated, employmentStatus: "employed" }).state.annualizedCoreExpenseWan, 18);
  assert.equal(rent.status, "paused");
  assert.equal(healthcare.status, "paused");
  assert.equal(rent.factStatus, "needs_review");
  assert.ok(migrated.unresolvedIssues.some((item) => item.id.includes("aggregate_component_gap")));
});

test("a migration conflict is inspectable but cannot enable V4 at the simulation boundary", () => {
  const input = v3Ledger({ expenses: [{
    id: "mortgage_without_debt",
    type: "housing",
    displayName: "房贷月供",
    monthlyAmountWan: 1.3,
    activeFromAgeInMonths: 300,
    status: "active",
    factStatus: "known",
    evidence: [{ ...evidence[0], excerpt: "每月房贷月供 1.3 万元" }]
  }] });
  const before = structuredClone(input);
  const preflight = preflightFinancialLedgerV3ToV4(input);

  assert.deepEqual(input, before, "preflight never mutates the persisted V3 snapshot");
  assert.equal(preflight.canEnableV4, false);
  assert.ok(preflight.blockingIssues.some((item) => item.code === "EXPENSE_DEBT_SERVICE_DOUBLE_COUNT"));
  assert.equal(preflight.ledger.version, 4, "candidate remains available for an auditable error report only");
});

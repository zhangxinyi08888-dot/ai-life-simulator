import assert from "node:assert/strict";
import test from "node:test";
import { initializeCareerState } from "../career/careerState";
import { emptyWorldState } from "../../utils/simulationTransaction";
import { initializeFinancialLedger } from "./initializeLedger";
import { migrateFinancialLedgerV3ToV4 } from "./migrateFinancialLedgerV3ToV4";
import { PRIMARY_CASH_ACCOUNT_ID } from "./ledgerMath";
import { validateFinancialProposals } from "./validateFinancialProposals";
import { commitFinancialDomainTransaction } from "./commitFinancialDomainTransaction";
import type { ExpenseCommitmentV4, FinancialEventProposal, FinancialLedgerV3 } from "./types";

const evidence = [{ source: "accepted_history" as const, reasonCode: "TEST", confidence: 1 }];

function authorityAt(ageInMonths: number) {
  const career = initializeCareerState({
    id: "career_confirmation_e2e",
    employmentStatus: "not_working",
    effectiveFromAgeInMonths: ageInMonths
  });
  const v3 = initializeFinancialLedger({
    id: "expense_confirmation_e2e",
    asOfAgeInMonths: ageInMonths,
    openingPosition: {
      cashAccounts: [{
        id: PRIMARY_CASH_ACCOUNT_ID,
        type: "bank_deposit",
        balanceWan: 50,
        status: "active",
        factStatus: "known",
        evidence
      }]
    }
  });
  const ledger = migrateFinancialLedgerV3ToV4(v3 as FinancialLedgerV3);
  const basic: ExpenseCommitmentV4 = {
    id: "basic_confirmation_e2e",
    type: "basic_living",
    displayName: "基础生活",
    monthlyAmountWan: 0.35,
    activeFromAgeInMonths: ageInMonths,
    status: "active",
    factStatus: "needs_review",
    evidence: [{ source: "system_policy", reasonCode: "ADULT_BASIC_LIVING_FLOOR", confidence: 1, financialScope: "personal" }],
    responsibilityKey: "adult_basic_living:protagonist",
    responsibilityKind: "adult_basic_living",
    amountBasis: "policy_floor",
    amountSourceIds: ["policy:adult-basic"],
    estimationPolicyId: "expense-estimation-policy-v2",
    financialScope: "personal",
    accrualReviewStatus: "conservative",
    nextReviewAtAgeInMonths: ageInMonths + 60
  };
  const rent: ExpenseCommitmentV4 = {
    id: "rent_confirmation_e2e",
    type: "housing",
    displayName: "当前房租",
    monthlyAmountWan: 0.35,
    activeFromAgeInMonths: ageInMonths,
    status: "active",
    factStatus: "needs_review",
    evidence: [{ source: "system_policy", reasonCode: "HOUSING_CONTEXT_ESTIMATE", confidence: 1, financialScope: "personal" }],
    responsibilityKey: "primary_residence:main",
    responsibilityKind: "primary_residence",
    amountBasis: "contextual_estimate",
    amountSourceIds: ["policy:housing-context"],
    estimationPolicyId: "expense-estimation-policy-v2",
    financialScope: "personal",
    accrualReviewStatus: "review_due",
    nextReviewAtAgeInMonths: ageInMonths
  };
  ledger.expenseCommitments.push(basic, rent);
  ledger.unresolvedIssues.push({
    id: "expense_review_due_rent_confirmation_e2e",
    code: "PENDING_FACT",
    severity: "warning",
    status: "open",
    relatedProposalIds: [],
    relatedAccountIds: [rent.id],
    expenseResolutionKind: "exact_amount",
    expenseResponsibilityKey: rent.responsibilityKey,
    summary: "当前房租金额待权威确认",
    createdAtAgeInMonths: ageInMonths
  });
  return { career, ledger, worldState: { ...emptyWorldState(), careerStates: [career], currentCareerStateId: career.id } };
}

test("F-01/F-12/I-03 same-amount Accepted confirmation closes the typed review and accrues exactly once next period", () => {
  const startAge = 360;
  const current = authorityAt(startAge);
  const narrative = "你现在每月支付房租3500元，这是当前实际账单。";
  const proposal: FinancialEventProposal = {
    id: "confirm_current_rent",
    kind: "expense_commitment_adjusted",
    effectiveAtAgeInMonths: startAge,
    payload: {
      expenseCommitmentId: "rent_confirmation_e2e",
      previousCommitmentId: "rent_confirmation_e2e",
      changeReason: "estimate_superseded_by_exact_fact",
      nextCommitment: {
        ...current.ledger.expenseCommitments.find((item) => item.id === "rent_confirmation_e2e")!,
        factStatus: "known",
        amountBasis: "explicit_known",
        confirmedMonthlyAmountWan: 0.35,
        lastConfirmedAtAgeInMonths: startAge
      }
    },
    evidence: narrative,
    sourceOutcomeId: "outcome_confirm_rent",
    confidence: 0.95,
    financialScope: "personal"
  };
  const validated = validateFinancialProposals({
    proposals: [proposal],
    currentLedger: current.ledger,
    currentCareerState: current.career,
    acceptedOutcomeId: "outcome_confirm_rent",
    narrativeText: narrative,
    periodStartAgeInMonths: startAge,
    periodEndAgeInMonths: startAge,
    simulationTransactionId: "node_confirm_rent",
    enforceExpenseConfirmation: true
  });
  assert.equal(validated.issues.filter((issue) => issue.severity === "blocking").length, 0);
  assert.equal(validated.acceptedEvents.length, 1);
  assert.equal(validated.acceptedEvents[0]!.expenseConfirmationResolution?.resolutionKind, "exact_amount");

  const confirmed = commitFinancialDomainTransaction({
    transactionId: "tx_confirm_rent",
    periodStartAgeInMonths: startAge,
    periodEndAgeInMonths: startAge,
    expectedCareerRevision: 0,
    expectedLedgerRevision: current.ledger.revision,
    currentCareer: { careerStates: [current.career], currentCareerStateId: current.career.id, careerRevision: 0 },
    currentFinancialLedger: current.ledger,
    currentWorldState: current.worldState,
    acceptedCareerTransitions: [],
    acceptedFinancialEvents: validated.acceptedEvents
  });
  const rent = confirmed.financialLedger.expenseCommitments.find((item) => item.id === "rent_confirmation_e2e")!;
  assert.equal(rent.factStatus, "known");
  assert.equal(rent.amountBasis, "explicit_known");
  assert.equal(rent.monthlyAmountWan, 0.35);
  assert.equal(confirmed.financialLedger.unresolvedIssues.find((issue) => (
    issue.id === "expense_review_due_rent_confirmation_e2e"
  ))?.status, "resolved");

  const next = commitFinancialDomainTransaction({
    transactionId: "tx_confirm_rent_next_period",
    periodStartAgeInMonths: startAge,
    periodEndAgeInMonths: startAge + 12,
    expectedCareerRevision: confirmed.career.careerRevision,
    expectedLedgerRevision: confirmed.financialLedger.revision,
    currentCareer: confirmed.career,
    currentFinancialLedger: confirmed.financialLedger,
    currentWorldState: confirmed.worldState,
    acceptedCareerTransitions: [],
    acceptedFinancialEvents: []
  });
  assert.equal(next.financialPeriodSummary.coreExpenseWan, 8.4);
  assert.equal(next.financialPeriodSummary.netCashFlowWan, -8.4);
  assert.equal(next.financialLedger.cashAccounts.find((item) => item.id === PRIMARY_CASH_ACCOUNT_ID)?.balanceWan, 41.6);
});

test("a bound generic-parent amount confirms the unique opening parent-healthcare aggregate", () => {
  const startAge = 383;
  const current = authorityAt(startAge);
  const healthcare: ExpenseCommitmentV4 = {
    id: "opening_recurring_healthcare_opening_parent", type: "healthcare", displayName: "父母医疗",
    monthlyAmountWan: 1.1, activeFromAgeInMonths: 288, status: "active", factStatus: "needs_review", evidence: [],
    responsibilityKey: "recurring_healthcare:opening_parent", responsibilityKind: "recurring_healthcare",
    amountBasis: "last_known", amountSourceIds: ["opening_parent_healthcare"], financialScope: "personal",
    accrualReviewStatus: "review_due", lastReviewedAtAgeInMonths: 300, nextReviewAtAgeInMonths: 312
  };
  current.ledger.expenseCommitments.push(healthcare);
  const narrative = "你重新核对账单后，确认你单独承担父母医疗每月2000元。";
  const proposal: FinancialEventProposal = {
    id: "confirm_generic_parent_healthcare", kind: "expense_commitment_adjusted", effectiveAtAgeInMonths: 416,
    sourceOutcomeId: "selected", evidence: narrative, confidence: 0.95, financialScope: "personal",
    payload: {
      expenseCommitmentId: healthcare.id,
      previousCommitmentId: healthcare.id,
      changeReason: "estimate_superseded_by_exact_fact",
      nextCommitment: { ...healthcare, monthlyAmountWan: 0.2, activeFromAgeInMonths: 288 }
    }
  };
  const validated = validateFinancialProposals({
    proposals: [proposal], currentLedger: current.ledger, currentCareerState: current.career,
    acceptedOutcomeId: "selected", narrativeText: narrative, periodStartAgeInMonths: startAge,
    periodEndAgeInMonths: 416, simulationTransactionId: "generic_parent_healthcare", enforceExpenseConfirmation: true
  });
  assert.deepEqual(validated.issues.filter((issue) => issue.severity === "blocking"), []);
  assert.equal(validated.acceptedEvents.length, 1);
  assert.equal((validated.acceptedEvents[0].payload as any).nextCommitment.responsibilityKey, "recurring_healthcare:opening_parent");
  assert.equal((validated.acceptedEvents[0].payload as any).nextCommitment.monthlyAmountWan, 0.2);
});

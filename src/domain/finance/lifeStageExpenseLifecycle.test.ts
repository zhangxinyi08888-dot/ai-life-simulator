import assert from "node:assert/strict";
import test from "node:test";
import { initializeFinancialLedger } from "./initializeLedger";
import { applyLifeStageExpenseLifecycle, detectLifeStageExpenseTriggers } from "./lifeStageExpenseLifecycle";
import { initializeCareerState } from "../career/careerState";
import { commitFinancialDomainTransaction } from "./commitFinancialDomainTransaction";
import type { WorldStateSnapshot } from "../../types";

test("completed protagonist responsibilities create typed conservative review accounts", () => {
  const ledger = initializeFinancialLedger({ id: "expense_lifecycle", asOfAgeInMonths: 360 });
  const result = applyLifeStageExpenseLifecycle({
    narrativeText: "你们迎来孩子，正式开始承担育儿责任。你开始长期治疗，每月复诊。",
    ledger,
    acceptedFinancialEvents: [],
    ageInMonths: 372
  });

  assert.equal(result.triggers.length, 2);
  assert.deepEqual(result.acceptedEvents.map((event) => event.payload.type).sort(), ["dependent_support", "healthcare"]);
  assert.ok(result.acceptedEvents.every((event) => event.payload.factStatus === "needs_review"));
  assert.ok(result.acceptedEvents.every((event) => event.payload.monthlyAmountWan > 0));
  assert.equal(result.issues.length, 2);
});

test("a completed shared household replaces a stale system living floor with a review baseline", () => {
  const ledger = initializeFinancialLedger({
    id: "shared_household",
    asOfAgeInMonths: 360,
    openingPosition: {
      expenseCommitments: [{
        id: "system_living",
        type: "basic_living",
        displayName: "系统基础生活",
        monthlyAmountWan: 0.35,
        activeFromAgeInMonths: 300,
        status: "active",
        factStatus: "estimated",
        evidence: [{ source: "system_policy", reasonCode: "ADULT_BASIC_LIVING", confidence: 1 }]
      }]
    }
  });
  const result = applyLifeStageExpenseLifecycle({
    narrativeText: "你们正式结婚，开始共同生活。",
    ledger,
    acceptedFinancialEvents: [],
    ageInMonths: 372
  });
  assert.equal(result.acceptedEvents.length, 1);
  assert.equal(result.acceptedEvents[0].payload.type, "basic_living");
  assert.equal(result.acceptedEvents[0].payload.monthlyAmountWan, 0.45);
  assert.equal(result.acceptedEvents[0].payload.factStatus, "needs_review");
});

test("plans, hypothetical housing and third-party responsibilities do not create protagonist expenses", () => {
  assert.deepEqual(detectLifeStageExpenseTriggers("你们开始看房，计划明年生孩子。如果父亲需要护理，他会请护工。"), []);
});

test("an existing responsibility account or accepted explicit expense prevents duplicate policy accrual", () => {
  const first = applyLifeStageExpenseLifecycle({
    narrativeText: "你们迎来孩子，开始承担育儿责任。",
    ledger: initializeFinancialLedger({ id: "first", asOfAgeInMonths: 360 }),
    acceptedFinancialEvents: [],
    ageInMonths: 372
  });
  const ledger = initializeFinancialLedger({
    id: "second",
    asOfAgeInMonths: 372,
    openingPosition: { expenseCommitments: [first.acceptedEvents[0].payload] }
  });
  const repeated = applyLifeStageExpenseLifecycle({
    narrativeText: "你们迎来孩子，开始承担育儿责任。",
    ledger,
    acceptedFinancialEvents: [],
    ageInMonths: 384
  });
  assert.equal(repeated.acceptedEvents.length, 0);
  assert.equal(repeated.coveredTriggerCount, 1);
});

test("housing policy is separate from mortgage principal and never replaces a higher known expense", () => {
  const ledger = initializeFinancialLedger({
    id: "housing",
    asOfAgeInMonths: 360,
    openingPosition: {
      expenseCommitments: [{
        id: "known_housing",
        type: "housing",
        displayName: "已确认房租",
        monthlyAmountWan: 0.8,
        activeFromAgeInMonths: 360,
        status: "active",
        factStatus: "known",
        evidence: [{ source: "user", reasonCode: "USER_RENT", confidence: 1 }]
      }]
    }
  });
  const result = applyLifeStageExpenseLifecycle({
    narrativeText: "你正式搬入新家，开始新的生活。",
    ledger,
    acceptedFinancialEvents: [],
    ageInMonths: 372
  });
  assert.equal(result.acceptedEvents.length, 0);
  assert.equal(ledger.expenseCommitments[0].monthlyAmountWan, 0.8);
});

test("a lifecycle estimate keeps review open until a later exact accepted adjustment", () => {
  const careerState = initializeCareerState({ id: "career_household", employmentStatus: "not_working", effectiveFromAgeInMonths: 360 });
  const career = { careerStates: [careerState], currentCareerStateId: careerState.id, careerRevision: 0 };
  const worldState: WorldStateSnapshot = {
    people: [], directionArcs: [], pressureArcs: [], committedTransactionIds: [], version: 2,
    careerStates: [careerState], currentCareerStateId: careerState.id,
    currentEmploymentStatus: careerState.employmentStatus, careerRevision: 0
  };
  const ledger = initializeFinancialLedger({ id: "review_lifecycle", asOfAgeInMonths: 360 });
  const lifecycle = applyLifeStageExpenseLifecycle({
    narrativeText: "你开始长期治疗，每月复诊。",
    ledger,
    acceptedFinancialEvents: [],
    ageInMonths: 372
  });
  const first = commitFinancialDomainTransaction({
    transactionId: "lifecycle_first",
    periodStartAgeInMonths: 360,
    periodEndAgeInMonths: 372,
    expectedCareerRevision: 0,
    expectedLedgerRevision: 0,
    currentCareer: career,
    currentFinancialLedger: ledger,
    currentWorldState: worldState,
    acceptedCareerTransitions: [],
    acceptedFinancialEvents: lifecycle.acceptedEvents,
    financialIssues: lifecycle.issues,
    liquidityPolicy: "auto_shortfall_debt"
  });
  const review = first.financialLedger.unresolvedIssues.find((issue) => issue.id.startsWith("expense_lifecycle_review_"));
  assert.equal(review?.status, "open");

  const commitment = first.financialLedger.expenseCommitments.find((item) => item.type === "healthcare")!;
  const exactEvidence = [{
    source: "accepted_simulation_outcome" as const,
    excerpt: "你确认每月复诊和用药支出为2000元",
    reasonCode: "EVIDENCE_EXACT_MATCHED",
    confidence: 1,
    financialScope: "personal" as const
  }];
  const second = commitFinancialDomainTransaction({
    transactionId: "lifecycle_confirmed",
    periodStartAgeInMonths: 372,
    periodEndAgeInMonths: 373,
    expectedCareerRevision: first.career.careerRevision,
    expectedLedgerRevision: first.financialLedger.revision,
    currentCareer: first.career,
    currentFinancialLedger: first.financialLedger,
    currentWorldState: first.worldState,
    acceptedCareerTransitions: [],
    acceptedFinancialEvents: [{
      id: "accepted_healthcare_exact",
      kind: "expense_commitment_adjusted",
      effectiveAtAgeInMonths: 372,
      payload: {
        expenseCommitmentId: commitment.id,
        nextCommitment: { ...commitment, monthlyAmountWan: 0.2, factStatus: "known", evidence: exactEvidence }
      },
      evidence: exactEvidence,
      acceptedByReasonCodes: ["EVIDENCE_EXACT_MATCHED"]
    }],
    financialIssues: [],
    liquidityPolicy: "auto_shortfall_debt"
  });
  assert.equal(second.financialLedger.unresolvedIssues.find((issue) => issue.id === review?.id)?.status, "resolved");
  assert.equal(second.financialLedger.expenseCommitments.find((item) => item.id === commitment.id)?.monthlyAmountWan, 0.2);
});

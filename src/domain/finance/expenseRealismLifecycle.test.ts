import assert from "node:assert/strict";
import test from "node:test";
import type { WorldStateSnapshot } from "../../types";
import { initializeCareerState } from "../career/careerState";
import { deriveFinancialState } from "./deriveFinancialState";
import { deriveExpenseResponsibilityCandidates, type ExplicitExpenseResponsibilityFact } from "./expenseResponsibility";
import { initializeFinancialLedger } from "./initializeLedger";
import { assertFinancialLedgerInvariants, PRIMARY_CASH_ACCOUNT_ID } from "./ledgerMath";
import { migrateFinancialLedgerV3ToV4 } from "./migrateFinancialLedgerV3ToV4";
import { reconcileExpenseCommitments } from "./reconcileExpenseCommitments";
import { reduceFinancialLedger } from "./reduceFinancialLedger";
import type { FinancialLedgerV3, FinancialLedgerV4 } from "./types";
import { validateFinancialProposals } from "./validateFinancialProposals";

function world(overrides: Partial<WorldStateSnapshot> = {}): WorldStateSnapshot {
  return {
    people: [],
    directionArcs: [],
    pressureArcs: [],
    committedTransactionIds: [],
    version: 2,
    relationships: [],
    familyRelationships: [],
    ...overrides
  };
}

function openingLedger(): FinancialLedgerV4 {
  const v3 = initializeFinancialLedger({
    id: "expense_realism_lifecycle",
    asOfAgeInMonths: 30 * 12,
    openingPosition: {
      cashAccounts: [{
        id: PRIMARY_CASH_ACCOUNT_ID,
        type: "bank_deposit",
        // This deliberately supplies liquidity only. There is no income source
        // or saving-rate target that can veto a real responsibility expense.
        balanceWan: 2000,
        status: "active",
        factStatus: "known",
        evidence: [{ source: "user", reasonCode: "OPENING_CASH", confidence: 1 }]
      }],
      expenseCommitments: [{
        id: "adult_basic",
        type: "basic_living",
        displayName: "个人基础生活",
        monthlyAmountWan: 0.35,
        activeFromAgeInMonths: 30 * 12,
        status: "active",
        factStatus: "known",
        evidence: [{ source: "user", reasonCode: "OPENING_BASIC_LIVING", confidence: 1 }]
      }]
    }
  });
  return migrateFinancialLedgerV3ToV4(v3 as FinancialLedgerV3);
}

function annualExpense(ledger: FinancialLedgerV4): number {
  return deriveFinancialState({ ledger, employmentStatus: "not_working" }).state.annualizedCoreExpenseWan;
}

function advance(ledger: FinancialLedgerV4, endAgeInMonths: number, id: string): FinancialLedgerV4 {
  assert.ok(endAgeInMonths >= ledger.asOfAgeInMonths);
  const result = reduceFinancialLedger({
    ledger,
    transactionId: id,
    expectedLedgerRevision: ledger.revision,
    periodStartAgeInMonths: ledger.asOfAgeInMonths,
    periodEndAgeInMonths: endAgeInMonths,
    events: []
  });
  assert.equal(result.alreadyCommitted, false);
  return result.ledger as FinancialLedgerV4;
}

function acceptAndCommit(input: {
  ledger: FinancialLedgerV4;
  ageInMonths: number;
  narrativeText: string;
  candidates: ReturnType<typeof deriveExpenseResponsibilityCandidates>["candidates"];
  id: string;
}): FinancialLedgerV4 {
  const reconciled = reconcileExpenseCommitments({
    ledger: input.ledger,
    candidates: input.candidates,
    ageInMonths: input.ageInMonths,
    sourceOutcomeId: `outcome_${input.id}`,
    mode: "enforced"
  });
  assert.equal(reconciled.wouldBlock, false, `unexpected lifecycle blocker: ${reconciled.issues.map((item) => item.code).join(", ")}`);
  assert.ok(reconciled.proposals.length > 0, "a completed personal responsibility must produce a candidate proposal");

  const career = initializeCareerState({
    id: "career_not_working",
    employmentStatus: "not_working",
    effectiveFromAgeInMonths: input.ledger.asOfAgeInMonths
  });
  const validated = validateFinancialProposals({
    proposals: reconciled.proposals,
    currentLedger: input.ledger,
    currentCareerState: career,
    acceptedOutcomeId: `outcome_${input.id}`,
    narrativeText: input.narrativeText,
    periodStartAgeInMonths: input.ledger.asOfAgeInMonths,
    periodEndAgeInMonths: input.ageInMonths + 1,
    simulationTransactionId: input.id
  });
  assert.deepEqual(validated.issues, [], `responsibility proposals must take the normal validator path: ${JSON.stringify(validated.issues)}`);
  assert.equal(validated.acceptedEvents.length, reconciled.proposals.length);

  const committed = reduceFinancialLedger({
    ledger: input.ledger,
    transactionId: input.id,
    expectedLedgerRevision: input.ledger.revision,
    periodStartAgeInMonths: input.ledger.asOfAgeInMonths,
    periodEndAgeInMonths: input.ageInMonths + 1,
    events: validated.acceptedEvents
  });
  assert.equal(committed.alreadyCommitted, false);
  const next = committed.ledger as FinancialLedgerV4;
  assertFinancialLedgerInvariants(next);
  return next;
}

function explicitFact(input: ExplicitExpenseResponsibilityFact): ExplicitExpenseResponsibilityFact {
  return { source: "accepted_outcome", completion: "completed", action: "start", cadence: "monthly", liability: "protagonist", financialScope: "personal", ...input };
}

test("realistic personal expense lifecycle: family responsibilities raise spending; old age alone does not", () => {
  let ledger = openingLedger();
  const youngAdultAnnualExpense = annualExpense(ledger);
  assert.equal(youngAdultAnnualExpense, 4.2, "young adult begins with a real basic-living account, not a saving-rate cap");
  assert.equal(ledger.incomeSources.length, 0, "the scenario intentionally has no income target or saving-rate controller");

  ledger = advance(ledger, 32 * 12, "advance_to_cohabitation");
  const beforeCohabitationAnnualExpense = annualExpense(ledger);
  const cohabitationNarrative = "双方已确认共同居住。";
  const cohabitation = deriveExpenseResponsibilityCandidates({
    ageInMonths: ledger.asOfAgeInMonths,
    currentWorldState: world({ relationships: [{
      id: "partner", participantPersonIds: ["partner"], type: "romantic", stage: "dating", status: "active",
      livingTogether: false, effectiveFromAgeInMonths: 30 * 12, source: "accepted_history", confidence: 1
    }] }),
    candidateWorldState: world({ relationships: [{
      id: "partner", participantPersonIds: ["partner"], type: "romantic", stage: "cohabiting", status: "active",
      livingTogether: true, effectiveFromAgeInMonths: 32 * 12, responsibilitySummary: cohabitationNarrative,
      source: "accepted_history", confidence: 1
    }] }),
    narrativeText: cohabitationNarrative
  });
  ledger = acceptAndCommit({ ledger, ageInMonths: ledger.asOfAgeInMonths, narrativeText: cohabitationNarrative, candidates: cohabitation.candidates, id: "cohabitation" });
  const housing = ledger.expenseCommitments.find((item) => item.responsibilityKey === "primary_residence:main");
  assert.ok(housing);
  assert.equal(housing.type, "housing");
  assert.equal(housing.financialScope, "shared_household");
  assert.ok(housing.monthlyAmountWan > 0, "confirmed cohabitation must not become a free-home assumption");
  assert.ok(annualExpense(ledger) > beforeCohabitationAnnualExpense, "housing responsibility must raise the active annual expense");

  ledger = advance(ledger, 36 * 12, "advance_to_child_support");
  const beforeChildAnnualExpense = annualExpense(ledger);
  const childNarrative = "你已开始每月承担孩子的抚养支出2500元。";
  const child = deriveExpenseResponsibilityCandidates({
    ageInMonths: ledger.asOfAgeInMonths,
    explicitFacts: [explicitFact({
      responsibilityKey: "child_support:child_1",
      responsibilityKind: "child_support",
      proposedType: "dependent_support",
      explicitMonthlyTotalWan: 0.25,
      protagonistShareWan: 0.25,
      amountSourceId: "accepted_child_support_2500",
      evidenceExcerpt: childNarrative
    })]
  });
  ledger = acceptAndCommit({ ledger, ageInMonths: ledger.asOfAgeInMonths, narrativeText: childNarrative, candidates: child.candidates, id: "child_support" });
  const childSupport = ledger.expenseCommitments.find((item) => item.responsibilityKey === "child_support:child_1");
  assert.ok(childSupport);
  assert.equal(childSupport.type, "dependent_support");
  assert.equal(childSupport.financialScope, "personal");
  assert.equal(childSupport.monthlyAmountWan, 0.25);
  assert.ok(annualExpense(ledger) > beforeChildAnnualExpense, "confirmed child support must raise annual expense instead of preserving a generic 4.2 万 baseline");

  ledger = advance(ledger, 50 * 12, "advance_to_parent_support");
  const beforeParentSupportAnnualExpense = annualExpense(ledger);
  const parentNarrative = "你已开始每月向母亲支付赡养与照护费用4000元。";
  const parentSupport = deriveExpenseResponsibilityCandidates({
    ageInMonths: ledger.asOfAgeInMonths,
    explicitFacts: [explicitFact({
      responsibilityKey: "elder_care:mother",
      responsibilityKind: "elder_care",
      proposedType: "dependent_support",
      explicitMonthlyTotalWan: 0.4,
      protagonistShareWan: 0.4,
      amountSourceId: "accepted_mother_support_4000",
      evidenceExcerpt: parentNarrative
    })]
  });
  ledger = acceptAndCommit({ ledger, ageInMonths: ledger.asOfAgeInMonths, narrativeText: parentNarrative, candidates: parentSupport.candidates, id: "parent_support" });
  const elderCare = ledger.expenseCommitments.find((item) => item.responsibilityKey === "elder_care:mother");
  assert.ok(elderCare);
  assert.equal(elderCare.type, "dependent_support");
  assert.equal(elderCare.financialScope, "personal");
  assert.equal(elderCare.monthlyAmountWan, 0.4);
  const beforeHighAgeAnnualExpense = annualExpense(ledger);
  assert.ok(beforeHighAgeAnnualExpense > beforeParentSupportAnnualExpense, "explicit parent support is a separate responsibility, not a replacement for child or housing expenses");

  ledger = advance(ledger, 89 * 12, "advance_to_age_89_without_new_fact");
  const ageOnly = deriveExpenseResponsibilityCandidates({
    ageInMonths: 89 * 12,
    narrativeText: "89岁时你安静地整理旧照片。"
  });
  assert.equal(ageOnly.candidates.length, 0, "age alone must not invent healthcare or care commitments");
  assert.equal(annualExpense(ledger), beforeHighAgeAnnualExpense, "crossing into old age must not silently change any accepted expense amount");

  const treatmentNarrative = "89岁时，你继续每月复诊并长期用药1200元。";
  const treatment = deriveExpenseResponsibilityCandidates({
    ageInMonths: ledger.asOfAgeInMonths,
    explicitFacts: [explicitFact({
      responsibilityKey: "recurring_healthcare:protagonist",
      responsibilityKind: "recurring_healthcare",
      proposedType: "healthcare",
      explicitMonthlyTotalWan: 0.12,
      protagonistShareWan: 0.12,
      amountSourceId: "accepted_treatment_89",
      evidenceExcerpt: treatmentNarrative
    })]
  });
  ledger = acceptAndCommit({ ledger, ageInMonths: ledger.asOfAgeInMonths, narrativeText: treatmentNarrative, candidates: treatment.candidates, id: "ongoing_treatment_at_89" });
  const healthcare = ledger.expenseCommitments.find((item) => item.responsibilityKey === "recurring_healthcare:protagonist");
  assert.ok(healthcare);
  assert.equal(healthcare.type, "healthcare");
  assert.equal(healthcare.financialScope, "personal");
  assert.equal(healthcare.monthlyAmountWan, 0.12);
  assert.ok(annualExpense(ledger) > beforeHighAgeAnnualExpense, "accepted ongoing treatment, rather than age itself, must create the extra medical responsibility");

  const financial = deriveFinancialState({ ledger, employmentStatus: "not_working" }).state;
  assert.equal(financial.annualizedRecurringIncomeWan, 0, "expenses remain authoritative even when there is no recurring income");
  assert.equal(financial.annualizedDisposableCashFlowWan, -financial.annualizedCoreExpenseWan, "the ledger derives cash flow directly; it does not clamp expenses to a saving-rate target");
  assert.deepEqual(
    ledger.expenseCommitments.filter((item) => item.status === "active").map((item) => item.type).sort(),
    ["basic_living", "dependent_support", "dependent_support", "healthcare", "housing"],
    "the final ledger holds typed accounts for basic life, housing, child support, elder care, and healthcare"
  );
});

test("an accepted long-term treatment at high age uses the older-adult medical policy, while age alone still creates no account", () => {
  const ongoingTreatment = "医生已确认需要长期治疗并持续用药。";
  const candidatesAt = (ageInMonths: number) => deriveExpenseResponsibilityCandidates({
    ageInMonths,
    currentWorldState: world(),
    candidateWorldState: world({ healthSummary: ongoingTreatment }),
    narrativeText: ongoingTreatment
  }).candidates;

  let younger = advance(openingLedger(), 32 * 12, "young_treatment_age");
  younger = acceptAndCommit({
    ledger: younger,
    ageInMonths: younger.asOfAgeInMonths,
    narrativeText: ongoingTreatment,
    candidates: candidatesAt(younger.asOfAgeInMonths),
    id: "young_unknown_treatment"
  });
  const youngerMedical = younger.expenseCommitments.find((item) => item.responsibilityKey === "recurring_healthcare:protagonist");

  let older = advance(openingLedger(), 89 * 12, "older_treatment_age");
  const ageOnly = deriveExpenseResponsibilityCandidates({
    ageInMonths: older.asOfAgeInMonths,
    currentWorldState: world(),
    candidateWorldState: world(),
    narrativeText: "89岁时你安静地整理旧照片。"
  });
  assert.equal(ageOnly.candidates.length, 0, "high age alone cannot manufacture a health or care responsibility");
  older = acceptAndCommit({
    ledger: older,
    ageInMonths: older.asOfAgeInMonths,
    narrativeText: ongoingTreatment,
    candidates: candidatesAt(older.asOfAgeInMonths),
    id: "older_unknown_treatment"
  });
  const olderMedical = older.expenseCommitments.find((item) => item.responsibilityKey === "recurring_healthcare:protagonist");

  assert.ok(youngerMedical && olderMedical);
  assert.equal(youngerMedical.monthlyAmountWan, 0.12);
  assert.equal(olderMedical.monthlyAmountWan, 0.24);
  assert.ok(annualExpense(older) > annualExpense(younger), "the same accepted ongoing health responsibility should not be held at a young-adult level at 89");
  assert.equal(olderMedical.factStatus, "needs_review", "policy amount remains visibly estimated rather than fabricated as an exact fact");
});

import assert from "node:assert/strict";
import test from "node:test";
import { initializeCareerState } from "../career/careerState";
import { deriveExpenseResponsibilityCandidates, type ExplicitExpenseResponsibilityFact } from "./expenseResponsibility";
import { initializeFinancialLedger } from "./initializeLedger";
import { migrateFinancialLedgerV3ToV4 } from "./migrateFinancialLedgerV3ToV4";
import { reconcileExpenseCommitments } from "./reconcileExpenseCommitments";
import { reduceFinancialLedger } from "./reduceFinancialLedger";
import type { FinancialLedgerV3, FinancialLedgerV4 } from "./types";
import { validateFinancialProposals } from "./validateFinancialProposals";

function ledger(): FinancialLedgerV4 {
  return migrateFinancialLedgerV3ToV4(initializeFinancialLedger({
    id: "explicit_expense_change",
    asOfAgeInMonths: 400,
    openingPosition: {
      expenseCommitments: [{
        id: "home_main",
        type: "housing",
        displayName: "当前住所房租",
        monthlyAmountWan: 0.3,
        activeFromAgeInMonths: 360,
        status: "active",
        factStatus: "known",
        evidence: [{ source: "user", reasonCode: "OPENING_RENT", confidence: 1, excerpt: "当前每月房租3000元" }]
      }]
    }
  }) as FinancialLedgerV3);
}

function validateExplicitAdjustment(input: {
  fact: ExplicitExpenseResponsibilityFact;
  narrativeText: string;
}): { current: FinancialLedgerV4; proposal: any; accepted: ReturnType<typeof validateFinancialProposals>["acceptedEvents"] } {
  const current = ledger();
  const sourceOutcomeId = "explicit_change_outcome";
  const derived = deriveExpenseResponsibilityCandidates({
    ageInMonths: 401,
    explicitFacts: [{ source: "accepted_outcome", completion: "completed", cadence: "monthly", liability: "protagonist", financialScope: "personal", ...input.fact }]
  });
  assert.equal(derived.candidates.length, 1);
  const reconciled = reconcileExpenseCommitments({
    ledger: current,
    candidates: derived.candidates,
    ageInMonths: 401,
    sourceOutcomeId,
    mode: "enforced"
  });
  assert.equal(reconciled.proposals.length, 1);
  const proposal = reconciled.proposals[0];
  const validation = validateFinancialProposals({
    proposals: [proposal],
    currentLedger: current,
    currentCareerState: initializeCareerState({ id: "not_working", employmentStatus: "not_working", effectiveFromAgeInMonths: 400 }),
    acceptedOutcomeId: sourceOutcomeId,
    narrativeText: input.narrativeText,
    periodStartAgeInMonths: 400,
    periodEndAgeInMonths: 402,
    simulationTransactionId: "explicit_expense_change"
  });
  assert.deepEqual(validation.issues, [], JSON.stringify(validation.issues));
  assert.equal(validation.acceptedEvents.length, 1);
  return { current, proposal, accepted: validation.acceptedEvents };
}

test("an Accepted explicit downward adjustment preserves reason metadata and validates before reducing", () => {
  const narrativeText = "你搬到更小的住所，房租降为每月2000元。";
  const result = validateExplicitAdjustment({
    narrativeText,
    fact: {
      responsibilityKey: "primary_residence:main",
      responsibilityKind: "primary_residence",
      proposedType: "housing",
      action: "adjust",
      explicitMonthlyTotalWan: 0.2,
      protagonistShareWan: 0.2,
      amountSourceId: "accepted_rent_2000",
      changeReason: "explicit_amount_reduced",
      evidenceExcerpt: narrativeText
    }
  });
  assert.equal(result.proposal.payload.previousCommitmentId, "home_main");
  assert.equal(result.proposal.payload.changeReason, "explicit_amount_reduced");
  const reduced = reduceFinancialLedger({
    ledger: result.current,
    transactionId: "explicit_downward_commit",
    expectedLedgerRevision: result.current.revision,
    periodStartAgeInMonths: 400,
    periodEndAgeInMonths: 402,
    events: result.accepted
  }).ledger as FinancialLedgerV4;
  assert.equal(reduced.expenseCommitments.find((item) => item.id === "home_main")?.monthlyAmountWan, 0.2);
});

test("an Accepted temporary third-party payment pause preserves reason metadata and validates before reducing", () => {
  const narrativeText = "本月起暂由伴侣代付房租。";
  const result = validateExplicitAdjustment({
    narrativeText,
    fact: {
      responsibilityKey: "primary_residence:main",
      responsibilityKind: "primary_residence",
      proposedType: "housing",
      action: "adjust",
      nextStatus: "paused",
      changeReason: "temporary_third_party_coverage",
      evidenceExcerpt: narrativeText
    }
  });
  assert.equal(result.proposal.payload.previousCommitmentId, "home_main");
  assert.equal(result.proposal.payload.changeReason, "temporary_third_party_coverage");
  const reduced = reduceFinancialLedger({
    ledger: result.current,
    transactionId: "explicit_pause_commit",
    expectedLedgerRevision: result.current.revision,
    periodStartAgeInMonths: 400,
    periodEndAgeInMonths: 402,
    events: result.accepted
  }).ledger as FinancialLedgerV4;
  assert.equal(reduced.expenseCommitments.find((item) => item.id === "home_main")?.status, "paused");
});

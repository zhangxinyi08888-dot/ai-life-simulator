import assert from "node:assert/strict";
import test from "node:test";
import type { WorldStateSnapshot } from "../types";
import {
  applyLifeStageExpenseLifecycle,
  initializeFinancialLedger,
  migrateFinancialLedgerV3ToV4,
  reconcileExpenseCommitments
} from "../domain/finance";
import type { FinancialLedgerV3 } from "../domain/finance";
import { validateNodeOutcomeProposal } from "./arcLifecycle";
import {
  explicitFactsFromAcceptedExpenseResponsibilityDeltas,
  missingAcceptedExpenseResponsibilityDeltas
} from "./expenseResponsibilityOutcome";
import { normalizeWorldDeltas } from "./normalizeWorldDeltas";

function world(): WorldStateSnapshot {
  return {
    people: [{
      id: "mother", identityKey: { namespace: "user_role", key: "parent:mother" }, displayName: "母亲",
      relation: "parent", lifeStatus: "active", source: "accepted_history", confidence: 1
    }],
    directionArcs: [], pressureArcs: [], committedTransactionIds: [], version: 1
  };
}

test("normalizes the amount-free responsibility delta and binds it to the accepted outcome", () => {
  const normalized = normalizeWorldDeltas({
    acceptedOutcomeIds: ["care_choice"],
    worldDeltas: [{
      deltaType: "expense_responsibility",
      payload: {
        responsibility: {
          responsibilityKind: "elder_care",
          beneficiary: "mother",
          owner: "protagonist",
          cadence: "recurring_unknown",
          evidence: "母亲每周复诊，你固定陪她去医院。",
          confidence: 0.9,
          responsibilityKey: "model_must_not_choose",
          explicitMonthlyTotalWan: 999
        }
      }
    }]
  });
  const delta = normalized.worldDeltas[0];
  assert.equal(delta?.type, "expense_responsibility");
  if (!delta || delta.type !== "expense_responsibility") throw new Error("expected responsibility delta");
  assert.deepEqual(delta.responsibility, {
    responsibilityKind: "elder_care",
    beneficiary: "mother",
    owner: "protagonist",
    cadence: "recurring_unknown",
    evidence: "母亲每周复诊，你固定陪她去医院。",
    confidence: 0.9,
    sourceOutcomeId: "care_choice"
  });
  assert.equal(normalized.audit.some((item) => item.reasonCode === "SOURCE_OUTCOME_FILLED"), true);
});

test("accepts only explicit recurring care or protagonist medication and maps code-owned keys", () => {
  const careText = "母亲每周复诊，你固定陪她去医院。你把其他工作安排在治疗之外。";
  const care = validateNodeOutcomeProposal({
    expectedSourceOutcomeId: "care_choice",
    narrativeText: careText,
    worldDeltas: [{
      type: "expense_responsibility",
      summary: "持续照护母亲",
      responsibility: {
        responsibilityKind: "elder_care", beneficiary: "mother", owner: "protagonist", cadence: "recurring_unknown",
        evidence: "母亲每周复诊，你固定陪她去医院。", confidence: 0.9, sourceOutcomeId: "care_choice"
      }
    }]
  });
  assert.equal(care.worldDeltas.length, 1);
  assert.deepEqual(explicitFactsFromAcceptedExpenseResponsibilityDeltas({ worldDeltas: care.worldDeltas, currentWorldState: world() }), [{
    responsibilityKey: "elder_care:mother", responsibilityKind: "elder_care", proposedType: "dependent_support",
    action: "start", completion: "completed", cadence: "recurring_unknown", liability: "protagonist",
    financialScope: "personal", participantPersonIds: ["mother"], source: "accepted_outcome",
    evidenceExcerpt: "母亲每周复诊，你固定陪她去医院。"
  }]);
  const lifecycle = applyLifeStageExpenseLifecycle({
    narrativeText: "",
    currentWorldState: world(),
    candidateWorldState: world(),
    explicitFacts: explicitFactsFromAcceptedExpenseResponsibilityDeltas({ worldDeltas: care.worldDeltas, currentWorldState: world() }),
    ageInMonths: 74 * 12
  });
  const plan = reconcileExpenseCommitments({
    ledger: migrateFinancialLedgerV3ToV4(initializeFinancialLedger({ id: "structured_care", asOfAgeInMonths: 74 * 12 }) as FinancialLedgerV3),
    candidates: lifecycle.candidates,
    ageInMonths: 74 * 12,
    sourceOutcomeId: "care_choice",
    mode: "enforced"
  });
  const plannedCare = plan.proposals.find((proposal) => proposal.kind === "expense_commitment_started")?.payload as { monthlyAmountWan?: number; factStatus?: string } | undefined;
  assert.ok((plannedCare?.monthlyAmountWan || 0) > 0, "accepted responsibility must not fall back to zero");
  assert.equal(plannedCare?.factStatus, "needs_review");

  const protagonistPaysForCare = validateNodeOutcomeProposal({
    expectedSourceOutcomeId: "care_choice",
    narrativeText: "你每周为母亲支付护工费用，固定陪她复诊。",
    worldDeltas: [{
      type: "expense_responsibility", summary: "持续照护母亲",
      responsibility: {
        responsibilityKind: "elder_care", beneficiary: "mother", owner: "protagonist", cadence: "recurring_unknown",
        evidence: "你每周为母亲支付护工费用，固定陪她复诊。", confidence: 0.9, sourceOutcomeId: "care_choice"
      }
    }]
  });
  assert.equal(protagonistPaysForCare.worldDeltas.length, 1, "protagonist paying for a parent must not look like a parent payer");

  const parentsAggregate = validateNodeOutcomeProposal({
    expectedSourceOutcomeId: "parents_care_choice",
    narrativeText: "父母每周复诊，你固定陪他们去医院。",
    worldDeltas: [{
      type: "expense_responsibility", summary: "持续照护父母",
      responsibility: {
        responsibilityKind: "elder_care", beneficiary: "parents", owner: "protagonist", cadence: "recurring_unknown",
        evidence: "父母每周复诊，你固定陪他们去医院。", confidence: 0.9, sourceOutcomeId: "parents_care_choice"
      }
    }]
  });
  assert.equal(parentsAggregate.worldDeltas.length, 1);
  assert.equal(
    explicitFactsFromAcceptedExpenseResponsibilityDeltas({ worldDeltas: parentsAggregate.worldDeltas, currentWorldState: world() })[0]?.responsibilityKey,
    "elder_care:parents",
    "plural beneficiary must preserve the aggregate account even with one structured parent"
  );

  const unresolvedMother = validateNodeOutcomeProposal({
    expectedSourceOutcomeId: "unresolved_mother_care_choice",
    narrativeText: "母亲每周复诊，你固定陪她去医院。",
    worldDeltas: [{
      type: "expense_responsibility", summary: "持续照护母亲",
      responsibility: {
        responsibilityKind: "elder_care", beneficiary: "mother", owner: "protagonist", cadence: "recurring_unknown",
        evidence: "母亲每周复诊，你固定陪她去医院。", confidence: 0.9, sourceOutcomeId: "unresolved_mother_care_choice"
      }
    }]
  });
  const unresolvedFact = explicitFactsFromAcceptedExpenseResponsibilityDeltas({
    worldDeltas: unresolvedMother.worldDeltas,
    currentWorldState: { people: [], directionArcs: [], pressureArcs: [], committedTransactionIds: [], version: 1 }
  })[0];
  assert.equal(unresolvedFact?.responsibilityKey, "elder_care:mother");
  assert.deepEqual(unresolvedFact?.participantPersonIds, []);
  assert.equal(unresolvedFact?.action, "review");
  assert.equal(unresolvedFact?.liability, "unknown");
  assert.equal(unresolvedFact?.identityResolutionRequired, true);
  const unresolvedLifecycle = applyLifeStageExpenseLifecycle({
    narrativeText: "母亲每周复诊，你固定陪她去医院。",
    currentWorldState: { people: [], directionArcs: [], pressureArcs: [], committedTransactionIds: [], version: 1 },
    candidateWorldState: { people: [], directionArcs: [], pressureArcs: [], committedTransactionIds: [], version: 1 },
    explicitFacts: unresolvedFact ? [unresolvedFact] : [],
    ageInMonths: 74 * 12
  });
  assert.deepEqual(unresolvedLifecycle.candidates.map((item) => [
    item.responsibilityKey,
    item.action,
    item.liability,
    item.identityResolutionRequired
  ]), [["elder_care:mother", "review", "unknown", true]],
  "same-node narrative fallback must not silently widen an unresolved mother into elder_care:parents");
  const unresolvedPlan = reconcileExpenseCommitments({
    ledger: migrateFinancialLedgerV3ToV4(initializeFinancialLedger({ id: "unresolved_parent_identity", asOfAgeInMonths: 74 * 12 }) as FinancialLedgerV3),
    candidates: unresolvedLifecycle.candidates,
    ageInMonths: 74 * 12,
    sourceOutcomeId: "unresolved_mother_care_choice",
    mode: "enforced"
  });
  assert.equal(unresolvedPlan.proposals.length, 0);
  assert.equal(unresolvedPlan.issues.some((item) => item.code === "PENDING_FACT"), true);

  const medicationText = "你不再计算未来的年岁，只按时服药，偶尔散步。";
  const medication = validateNodeOutcomeProposal({
    expectedSourceOutcomeId: "health_choice",
    narrativeText: medicationText,
    worldDeltas: [{
      type: "expense_responsibility",
      summary: "持续用药",
      responsibility: {
        responsibilityKind: "recurring_healthcare", beneficiary: "protagonist", owner: "protagonist", cadence: "recurring_unknown",
        evidence: medicationText, confidence: 0.9, sourceOutcomeId: "health_choice"
      }
    }]
  });
  assert.equal(medication.worldDeltas.length, 1);
  assert.equal(explicitFactsFromAcceptedExpenseResponsibilityDeltas({ worldDeltas: medication.worldDeltas })[0]?.responsibilityKey, "recurring_healthcare:protagonist");
});

test("accepts completed recurring parent checkups and an adjacent daily rehabilitation routine", () => {
  for (const [id, text, beneficiary] of [
    ["regular_checkups", "你定期带父母去县医院做全面体检，报告显示他们身体状况尚可。", "parents"],
    ["daily_rehabilitation", "父亲膝盖的退行性变化需要持续关注。你每天早晚帮他做一轮轻柔的关节活动，并记录下他的血压和膝盖状况。", "father"]
  ] as const) {
    const accepted = validateNodeOutcomeProposal({
      expectedSourceOutcomeId: id,
      narrativeText: text,
      worldDeltas: [{
        type: "expense_responsibility",
        summary: "持续父母照护",
        responsibility: {
          responsibilityKind: "elder_care",
          beneficiary,
          owner: "protagonist",
          cadence: "recurring_unknown",
          evidence: text,
          confidence: 0.9,
          sourceOutcomeId: id
        }
      }]
    });
    assert.equal(accepted.worldDeltas.length, 1, text);
  }
});

test("drops age-only, generic parent illness, third-party, business, planned, and source-mismatched declarations", () => {
  const cases = [
    { text: "89岁时你安静地整理旧照片。", kind: "recurring_healthcare", beneficiary: "protagonist", owner: "protagonist" },
    { text: "父亲长期治疗，每月复诊1200元。", kind: "elder_care", beneficiary: "father", owner: "protagonist" },
    { text: "父亲自己承担全部理疗费用，你每周陪他去医院。", kind: "elder_care", beneficiary: "father", owner: "protagonist" },
    { text: "母亲腰疼，你陪她做了两次理疗。", kind: "elder_care", beneficiary: "mother", owner: "protagonist" },
    { text: "你在木工坊每周照看父亲的治疗器械。", kind: "elder_care", beneficiary: "father", owner: "protagonist" },
    { text: "你计划每周陪母亲复诊。", kind: "elder_care", beneficiary: "mother", owner: "protagonist" },
    { text: "你提醒父亲按时服药。", kind: "recurring_healthcare", beneficiary: "protagonist", owner: "protagonist" },
    { text: "你建议父亲按时服药。", kind: "recurring_healthcare", beneficiary: "protagonist", owner: "protagonist" },
    { text: "你陪父亲按时服药。", kind: "recurring_healthcare", beneficiary: "protagonist", owner: "protagonist" },
    // A model must not smuggle a shared responsibility through the
    // amount-free personal transport by merely setting owner=protagonist.
    { text: "你们每周共同陪诊母亲。", kind: "elder_care", beneficiary: "mother", owner: "protagonist" },
    { text: "我们轮流照护父母。", kind: "elder_care", beneficiary: "parents", owner: "protagonist" },
    { text: "伴侣和你每周陪诊母亲。", kind: "elder_care", beneficiary: "mother", owner: "protagonist" },
    { text: "你们每天按时服药。", kind: "recurring_healthcare", beneficiary: "protagonist", owner: "protagonist" },
    { text: "父亲长期治疗。你每周照料家里的猫。", kind: "elder_care", beneficiary: "father", owner: "protagonist" },
    { text: "你们已同居并各承担一半，每周共同陪母亲复诊。", kind: "elder_care", beneficiary: "mother", owner: "shared_household" }
  ] as const;
  for (const item of cases) {
    const accepted = validateNodeOutcomeProposal({
      expectedSourceOutcomeId: "selected",
      narrativeText: item.text,
      worldDeltas: [{
        type: "expense_responsibility", summary: "不应接受",
        responsibility: {
          responsibilityKind: item.kind, beneficiary: item.beneficiary, owner: item.owner, cadence: "recurring_unknown",
          evidence: item.text, confidence: 0.9, sourceOutcomeId: "selected"
        }
      }]
    });
    assert.equal(accepted.worldDeltas.length, 0, item.text);
  }
  const mismatchedSource = validateNodeOutcomeProposal({
    expectedSourceOutcomeId: "selected",
    narrativeText: "你每天按时服药。",
    worldDeltas: [{
      type: "expense_responsibility", summary: "不应接受",
      responsibility: {
        responsibilityKind: "recurring_healthcare", beneficiary: "protagonist", owner: "protagonist", cadence: "recurring_unknown",
        evidence: "你每天按时服药。", confidence: 0.9, sourceOutcomeId: "unselected"
      }
    }]
  });
  assert.equal(mismatchedSource.worldDeltas.length, 0);
});

test("the Accepted-outcome finance bridge also rejects collective care that bypasses the direct sanitizer", () => {
  for (const evidence of ["你们每周共同陪诊母亲。", "伴侣和你每周陪诊母亲。"] as const) {
    const facts = explicitFactsFromAcceptedExpenseResponsibilityDeltas({
      worldDeltas: [{
        type: "expense_responsibility",
        summary: "不应成为个人责任",
        responsibility: {
          responsibilityKind: "elder_care",
          beneficiary: "mother",
          owner: "protagonist",
          cadence: "recurring_unknown",
          evidence,
          confidence: 0.9,
          sourceOutcomeId: "bypassed_direct_sanitizer"
        }
      }]
    });
    assert.deepEqual(facts, [], evidence);
  }
});

test("a responsibility whose evidence disappears during final narrative repair cannot remain accepted", () => {
  const initial = validateNodeOutcomeProposal({
    expectedSourceOutcomeId: "care_choice",
    narrativeText: "母亲每周复诊，你固定陪她去医院。",
    worldDeltas: [{
      type: "expense_responsibility", summary: "持续照护母亲",
      responsibility: {
        responsibilityKind: "elder_care", beneficiary: "mother", owner: "protagonist", cadence: "recurring_unknown",
        evidence: "母亲每周复诊，你固定陪她去医院。", confidence: 0.9, sourceOutcomeId: "care_choice"
      }
    }]
  });
  const finalWithoutEvidence = validateNodeOutcomeProposal({
    expectedSourceOutcomeId: "care_choice",
    narrativeText: "你把工作安排重新梳理了一遍。",
    worldDeltas: initial.worldDeltas
  });
  assert.equal(finalWithoutEvidence.worldDeltas.length, 0);
  assert.equal(missingAcceptedExpenseResponsibilityDeltas({
    acceptedWorldDeltas: initial.worldDeltas,
    finalWorldDeltas: finalWithoutEvidence.worldDeltas
  }).length, 1);
  assert.equal(missingAcceptedExpenseResponsibilityDeltas({
    acceptedWorldDeltas: initial.worldDeltas,
    finalWorldDeltas: initial.worldDeltas
  }).length, 0);
});

import assert from "node:assert/strict";
import test from "node:test";
import type { SimulationNode, WorldStateSnapshot } from "../../types";
import { initializeFinancialLedger } from "../../domain/finance/initializeLedger";
import { migrateFinancialLedgerV3ToV4 } from "../../domain/finance/migrateFinancialLedgerV3ToV4";
import { reconcileExpenseCommitments } from "../../domain/finance/reconcileExpenseCommitments";
import { deriveExpenseResponsibilityCandidates } from "../../domain/finance/expenseResponsibility";
import type { AcceptedCareerTransition, CareerState } from "../../domain/career/types";
import type { FinancialLedgerV3 } from "../../domain/finance/types";
import { expenseEstimateContextFromAuthority, previewExpenseCandidateWorldState } from "./simulationService";

function career(id: string, employmentStatus: CareerState["employmentStatus"]): CareerState {
  return {
    id,
    employmentStatus,
    activeProjectIds: [],
    effectiveFromAgeInMonths: 720,
    source: "accepted_history",
    confidence: 1
  };
}

function world(overrides: Partial<WorldStateSnapshot> = {}): WorldStateSnapshot {
  const employed = career("career_work", "employed");
  return {
    people: [{
      id: "mother", relation: "parent", lifeStatus: "active", healthStatus: "stable",
      source: "accepted_history", confidence: 1
    }],
    directionArcs: [],
    pressureArcs: [],
    relationships: [],
    familyRelationships: [],
    committedTransactionIds: [],
    careerStates: [employed],
    currentCareerStateId: employed.id,
    currentEmploymentStatus: "employed",
    careerRevision: 0,
    version: 2,
    ...overrides
  };
}

function node(): SimulationNode {
  return {
    age: 61,
    ageInMonths: 732,
    stage: "责任变化",
    title: "家庭与健康的重新安排",
    description: "医生已确认需要长期治疗并持续用药。",
    choices: [],
    attributes: { happiness: 50, intelligence: 50, wealth: 50, relation: 50, health: 45 },
    isEndingNode: false
  };
}

test("production preview turns accepted WorldState/Career deltas into lifecycle candidates before any ledger commit", () => {
  const baseline = world();
  const candidateCurrent = world({
    people: [
      ...baseline.people,
      {
        id: "child_1", relation: "child", lifeStatus: "active", source: "user_fact", confidence: 1,
        relationshipSummary: "已育有一名子女"
      }
    ],
    familyRelationships: [{
      id: "family_mother", participantPersonId: "mother", role: "mother", activation: "active",
      contact: "frequent", emotionalSupport: "mixed", practicalSupport: "unknown", autonomyRespect: "unknown",
      conflictIntensity: "low", topicStances: [], revision: 1
    }]
  });
  const retired = career("career_retired", "retired");
  const acceptedCareerTransitions: AcceptedCareerTransition[] = [{
    id: "accepted_retired",
    proposalId: "retire",
    fromCareerStateId: "career_work",
    nextCareerState: retired,
    effectiveAtAgeInMonths: 732,
    evidence: [{ source: "accepted_simulation_outcome", reasonCode: "ACCEPTED_CAREER_TRANSITION", confidence: 1, excerpt: "你正式退休。" }],
    acceptedByReasonCodes: ["OUTCOME_AUTHORITY"]
  }];
  const preview = previewExpenseCandidateWorldState({
    current: candidateCurrent,
    node: node(),
    acceptedOutcomeId: "retire",
    acceptedCareerTransitions,
    acceptedOutcome: {
      worldDeltas: [
        { type: "person_status", personId: "mother", status: "limited", reason: "需要更多照护" },
        { type: "health_state", summary: "医生已确认需要长期治疗并持续用药。" }
      ],
      arcSignals: []
    },
    ageInMonths: 732
  });
  const derived = deriveExpenseResponsibilityCandidates({
    currentWorldState: baseline,
    candidateWorldState: preview,
    ageInMonths: 732
  });
  assert.deepEqual(
    derived.candidates.map((candidate) => [candidate.responsibilityKey, candidate.action, candidate.liability]),
    [
      ["elder_care:mother", "review", "unknown"],
      ["child_support:child_1", "review", "unknown"],
      ["recurring_healthcare:protagonist", "start", "protagonist"],
      ["adult_basic_living:protagonist", "review", "protagonist"]
    ]
  );

  const ledgerV3 = initializeFinancialLedger({
    id: "production_preview", asOfAgeInMonths: 720,
    openingPosition: { expenseCommitments: [{
      id: "basic", type: "basic_living", displayName: "基础生活", monthlyAmountWan: 0.5,
      activeFromAgeInMonths: 700, status: "active", factStatus: "known", evidence: []
    }] }
  });
  const ledger = migrateFinancialLedgerV3ToV4(ledgerV3 as FinancialLedgerV3);
  const reconciliation = reconcileExpenseCommitments({
    ledger,
    candidates: derived.candidates,
    ageInMonths: 732,
    sourceOutcomeId: "retire",
    mode: "enforced"
  });
  // The health obligation is a nonzero policy-backed needs_review account;
  // child/parent structure alone remains review-only until payer facts exist.
  const healthcare = reconciliation.proposals.find((proposal) => proposal.kind === "expense_commitment_started")?.payload as any;
  assert.equal(healthcare.responsibilityKey, "recurring_healthcare:protagonist");
  assert.equal(healthcare.monthlyAmountWan > 0, true);
  assert.equal(healthcare.factStatus, "needs_review");
  assert.equal(reconciliation.proposals.some((proposal) => String((proposal.payload as any).responsibilityKey || "").startsWith("child_support:")), false);
  assert.equal(reconciliation.proposals.some((proposal) => String((proposal.payload as any).responsibilityKey || "").startsWith("elder_care:")), false);
  assert.equal(reconciliation.reviewEvents.some((event) => event.payload.expenseCommitmentId === "basic"), true);
});

test("accepted location changes enter the same lifecycle candidate WorldState instead of relying on narrative regex", () => {
  const baseline = world();
  const preview = previewExpenseCandidateWorldState({
    current: baseline,
    node: { ...node(), description: "你接受了迁往深圳的安排。" },
    acceptedOutcomeId: "relocate_shenzhen",
    acceptedOutcome: {
      worldDeltas: [{ type: "location_change", summary: "工作与居住地迁至深圳核心城区" }],
      arcSignals: []
    },
    ageInMonths: 732
  });

  assert.equal(preview.locationSummary, "工作与居住地迁至深圳核心城区");
  assert.equal(baseline.locationSummary, undefined, "candidate preview must not mutate the accepted baseline WorldState");
});

test("accepted personal move-in starts a policy-backed primary residence through preview, candidate, and reconciliation", () => {
  const baseline = world();
  const preview = previewExpenseCandidateWorldState({
    current: baseline,
    // Deliberately contains no rent/move-in language.  The lifecycle fact must
    // come from the accepted structured location delta, not the prose fallback.
    node: { ...node(), description: "你完成了本轮工作交接，并整理好手边资料。" },
    acceptedOutcomeId: "accepted_move_in",
    acceptedOutcome: {
      worldDeltas: [{
        type: "location_change",
        summary: "居住安排已完成更新。",
        residence: {
          livingArrangement: "renting",
          financialScope: "personal",
          liability: "protagonist",
          evidence: "你已签订租约并搬入新住所。"
        }
      }],
      arcSignals: []
    },
    ageInMonths: 732
  });

  assert.equal(preview.residence?.livingArrangement, "renting");
  assert.equal(preview.residence?.source, "accepted_history");
  assert.equal(preview.residence?.effectiveFromAgeInMonths, 732);
  assert.equal(baseline.residence, undefined, "candidate preview must not mutate the accepted baseline WorldState");

  const derived = deriveExpenseResponsibilityCandidates({
    currentWorldState: baseline,
    candidateWorldState: preview,
    ageInMonths: 732
  });
  assert.deepEqual(derived.candidates.map((candidate) => [
    candidate.responsibilityKey,
    candidate.action,
    candidate.financialScope,
    candidate.liability,
    candidate.source
  ]), [["primary_residence:main", "start", "personal", "protagonist", "accepted_world_delta"]]);

  const ledger = migrateFinancialLedgerV3ToV4(initializeFinancialLedger({
    id: "accepted_move_in",
    asOfAgeInMonths: 720,
    openingPosition: {}
  }) as FinancialLedgerV3);
  const reconciliation = reconcileExpenseCommitments({
    ledger,
    candidates: derived.candidates,
    ageInMonths: 732,
    sourceOutcomeId: "accepted_move_in",
    mode: "enforced",
    estimateContext: {
      livingArrangement: "renting",
      cityCostBand: "high",
      householdSize: 1,
      lifeStage: "责任变化",
      employmentStatus: "employed"
    }
  });
  const start = reconciliation.proposals.find((proposal) => proposal.kind === "expense_commitment_started");
  const commitment = start?.payload as any;
  assert.equal(commitment.responsibilityKey, "primary_residence:main");
  assert.equal(commitment.monthlyAmountWan > 0, true, "unknown rent must be a nonzero policy estimate");
  assert.equal(commitment.factStatus, "needs_review");
  assert.equal(commitment.amountBasis, "contextual_estimate");
  assert.equal(commitment.evidence.some((item: { reasonCode?: string }) => item.reasonCode === "EXPENSE_PRIMARY_RESIDENCE_WORLD_STATE"), true);
});

test("accepted commercial and third-party occupancy deltas never create a personal housing commitment", () => {
  for (const residence of [
    {
      livingArrangement: "renting" as const,
      financialScope: "business_operating" as const,
      liability: "none" as const,
      evidence: "公司租下独立工坊作为经营场地。"
    },
    {
      livingArrangement: "provided" as const,
      financialScope: "third_party" as const,
      liability: "third_party" as const,
      evidence: "父母提供住处并承担全部房租。"
    }
  ]) {
    const baseline = world();
    const preview = previewExpenseCandidateWorldState({
      current: baseline,
      node: { ...node(), description: "你完成了本轮既定安排。" },
      acceptedOutcomeId: `occupancy_${residence.financialScope}`,
      acceptedOutcome: {
        worldDeltas: [{ type: "location_change", summary: "地点安排已更新。", residence }],
        arcSignals: []
      },
      ageInMonths: 732
    });
    const derived = deriveExpenseResponsibilityCandidates({
      currentWorldState: baseline,
      candidateWorldState: preview,
      ageInMonths: 732
    });
    const ledger = migrateFinancialLedgerV3ToV4(initializeFinancialLedger({
      id: `occupancy_${residence.financialScope}`,
      asOfAgeInMonths: 720,
      openingPosition: {}
    }) as FinancialLedgerV3);
    const reconciliation = reconcileExpenseCommitments({
      ledger,
      candidates: derived.candidates,
      ageInMonths: 732,
      sourceOutcomeId: `occupancy_${residence.financialScope}`,
      mode: "enforced"
    });
    assert.equal(derived.candidates.some((candidate) => candidate.financialScope === "personal"), false);
    assert.equal(reconciliation.proposals.some((proposal) => (
      proposal.kind === "expense_commitment_started"
      && (proposal.payload as { responsibilityKey?: string }).responsibilityKey === "primary_residence:main"
    )), false, `${residence.financialScope} occupancy must not enter the personal ledger`);
  }
});

test("accepted provided housing calibrates a student's basic-living context without becoming personal housing", () => {
  const student = career("career_student", "student");
  const candidateWorldState = world({
    careerStates: [student],
    currentCareerStateId: student.id,
    currentEmploymentStatus: "student",
    locationSummary: "上海高校校区",
    residence: {
      livingArrangement: "provided",
      financialScope: "third_party",
      liability: "third_party",
      effectiveFromAgeInMonths: 264,
      source: "accepted_history",
      evidence: "学校提供宿舍，住宿费由家庭承担。"
    }
  });
  const ledger = migrateFinancialLedgerV3ToV4(initializeFinancialLedger({
    id: "student_provided_housing_context",
    asOfAgeInMonths: 264,
    openingPosition: {}
  }) as FinancialLedgerV3);
  const context = expenseEstimateContextFromAuthority({
    candidateWorldState,
    ledger,
    node: { ...node(), ageInMonths: 264 }
  });
  assert.equal(context.employmentStatus, "student");
  assert.equal(context.livingArrangement, "provided");
  assert.equal(context.cityCostBand, "high");
});

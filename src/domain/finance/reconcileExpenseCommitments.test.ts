import assert from "node:assert/strict";
import test from "node:test";
import { initializeFinancialLedger } from "./initializeLedger";
import { assertFinancialLedgerInvariants } from "./ledgerMath";
import { migrateFinancialLedgerV3ToV4 } from "./migrateFinancialLedgerV3ToV4";
import { reduceFinancialLedger } from "./reduceFinancialLedger";
import { reconcileExpenseCommitments } from "./reconcileExpenseCommitments";
import { deriveExpenseResponsibilityCandidates } from "./expenseResponsibility";
import type {
  AcceptedFinancialEvent,
  ExpenseCommitmentMutationPayload,
  ExpenseResponsibilityCandidate,
  FinancialLedgerV3
} from "./types";
import { isExpenseCommitmentV4 } from "./types";

function ledger() {
  const initial = initializeFinancialLedger({ id: "expense_test", asOfAgeInMonths: 360, openingPosition: { expenseCommitments: [{
    id: "basic", type: "basic_living", displayName: "基础生活", monthlyAmountWan: 0.5,
    activeFromAgeInMonths: 300, status: "active", factStatus: "known",
    evidence: [{ source: "user", reasonCode: "USER_LIVING", confidence: 1 }]
  }] } });
  return migrateFinancialLedgerV3ToV4(initial as FinancialLedgerV3);
}

function legacyAggregateLedger() {
  const initial = initializeFinancialLedger({ id: "legacy_aggregate_test", asOfAgeInMonths: 360, openingPosition: { expenseCommitments: [{
    id: "legacy_core_expense", type: "basic_living", displayName: "旧版总生活支出", monthlyAmountWan: 1.5,
    activeFromAgeInMonths: 300, status: "active", factStatus: "estimated",
    evidence: [{ source: "legacy_migration", reasonCode: "LEGACY_CORE_EXPENSE", confidence: 0.5 }]
  }] } });
  return migrateFinancialLedgerV3ToV4(initial as FinancialLedgerV3);
}

function candidate(overrides: Partial<ExpenseResponsibilityCandidate> = {}): ExpenseResponsibilityCandidate {
  return {
    id: "candidate", responsibilityKey: "primary_residence:main", responsibilityKind: "primary_residence",
    proposedType: "housing", action: "start", completion: "completed", cadence: "monthly",
    liability: "shared", financialScope: "shared_household", explicitMonthlyTotalWan: 0.52,
    protagonistShareWan: 0.26, shareRate: 0.5, amountSourceId: "rent_5200", participantPersonIds: ["partner"],
    source: "accepted_outcome", evidence: [{ source: "accepted_simulation_outcome", reasonCode: "RENT", confidence: 1, excerpt: "月租5200元，两人各半" }],
    ...overrides
  };
}

function confirmedSharedResidenceReview(): ExpenseResponsibilityCandidate {
  return candidate({
    id: "cohabitation_residence_review",
    action: "review",
    completion: "completed",
    source: "accepted_world_delta",
    financialScope: "shared_household",
    liability: "shared",
    explicitMonthlyTotalWan: undefined,
    protagonistShareWan: undefined,
    shareRate: undefined,
    amountSourceId: undefined,
    evidence: [{
      source: "accepted_simulation_outcome",
      reasonCode: "EXPENSE_SHARED_HOUSEHOLD_REVIEW",
      confidence: 1,
      financialScope: "shared_household",
      excerpt: "双方已确认共同居住"
    }]
  });
}

function parentMedicalCandidate(): ExpenseResponsibilityCandidate {
  return candidate({
    id: "parent_medical",
    responsibilityKey: "recurring_healthcare:parent",
    responsibilityKind: "recurring_healthcare",
    proposedType: "healthcare",
    action: "start",
    completion: "completed",
    cadence: "monthly",
    liability: "protagonist",
    financialScope: "personal",
    explicitMonthlyTotalWan: 0.3,
    protagonistShareWan: 0.3,
    shareRate: undefined,
    amountSourceId: "parent-medical-3000",
    participantPersonIds: ["parent"],
    source: "accepted_outcome",
    evidence: [{
      source: "accepted_simulation_outcome",
      reasonCode: "PARENT_MEDICAL",
      confidence: 1,
      financialScope: "personal",
      excerpt: "你开始每月承担父母医疗费3000元。"
    }]
  });
}

function elderCareCandidate(overrides: Partial<ExpenseResponsibilityCandidate> = {}): ExpenseResponsibilityCandidate {
  return candidate({
    id: "elder_care_mother",
    responsibilityKey: "elder_care:mother",
    responsibilityKind: "elder_care",
    proposedType: "dependent_support",
    action: "start",
    completion: "completed",
    cadence: "monthly",
    liability: "protagonist",
    financialScope: "personal",
    explicitMonthlyTotalWan: 0.3,
    protagonistShareWan: 0.3,
    shareRate: undefined,
    amountSourceId: "elder-care-mother-3000",
    participantPersonIds: ["mother"],
    source: "accepted_outcome",
    evidence: [{
      source: "accepted_simulation_outcome",
      reasonCode: "ELDER_CARE_TEST",
      confidence: 1,
      financialScope: "personal",
      excerpt: "你每月承担母亲照护费3000元。"
    }],
    ...overrides
  });
}

function startElderCare(current: ReturnType<typeof ledger>, candidateToStart: ExpenseResponsibilityCandidate, ageInMonths = 372) {
  const start = reconcileExpenseCommitments({
    ledger: current,
    candidates: [candidateToStart],
    ageInMonths,
    sourceOutcomeId: `start_${candidateToStart.id}`,
    mode: "enforced"
  }).proposals.find((proposal) => proposal.kind === "expense_commitment_started")?.payload as any;
  assert.ok(start, "test setup must create an elder-care commitment");
  current.expenseCommitments.push(start);
  return start;
}

test("E-07 shared rent charges only the protagonist's half", () => {
  const result = reconcileExpenseCommitments({ ledger: ledger(), candidates: [candidate()], ageInMonths: 372, sourceOutcomeId: "outcome", mode: "enforced" });
  assert.equal(result.proposals.length, 1);
  const commitment = result.proposals[0].payload as any;
  assert.equal(commitment.monthlyAmountWan, 0.26);
  assert.equal(commitment.grossMonthlyAmountWan, 0.52);
  assert.equal(commitment.householdShareRate, 0.5);
  assert.deepEqual(result.candidateDecisions, [{
    candidateId: "candidate",
    disposition: "planned_start",
    reasonCodes: ["NEW_RESPONSIBILITY_COMMITMENT"],
    relatedProposalIds: ["system_expense_start_candidate"],
    relatedIssueIds: [],
    wouldBlock: false
  }]);
});

test("a malformed lifecycle candidate is blocked with a schema issue instead of throwing before the gate", () => {
  const malformed = {
    ...candidate(),
    id: "missing_evidence",
    evidence: undefined
  } as unknown as ExpenseResponsibilityCandidate;

  const result = reconcileExpenseCommitments({
    ledger: ledger(),
    candidates: [malformed],
    ageInMonths: 372,
    sourceOutcomeId: "malformed_expense_candidate",
    mode: "enforced"
  });

  assert.equal(result.proposals.length, 0);
  assert.equal(result.wouldBlock, true);
  assert.equal(result.issues[0]?.code, "EXPENSE_SCHEMA_FIELD_MISMATCH");
  assert.deepEqual(result.candidateDecisions, [{
    candidateId: "missing_evidence",
    disposition: "blocked",
    reasonCodes: ["MISSING_CANDIDATE_EVIDENCE"],
    relatedProposalIds: [],
    relatedIssueIds: ["expense_candidate_missing_evidence_missing_evidence"],
    wouldBlock: true
  }]);
});

test("new unknown-amount responsibility receives the same accepted Preview context used by the V2 policy", () => {
  const result = reconcileExpenseCommitments({
    ledger: ledger(),
    candidates: [candidate({
      financialScope: "personal",
      liability: "protagonist",
      explicitMonthlyTotalWan: undefined,
      protagonistShareWan: undefined,
      shareRate: undefined,
      amountSourceId: undefined
    })],
    ageInMonths: 372,
    estimateContext: { cityCostBand: "high", livingArrangement: "renting", householdSize: 1 },
    sourceOutcomeId: "high_cost_city_residence",
    mode: "enforced"
  });

  assert.equal(result.wouldBlock, false);
  assert.equal(result.proposals.length, 1);
  const commitment = result.proposals[0].payload as any;
  assert.equal(commitment.monthlyAmountWan, 0.42, "high-cost city residence must not silently use the medium 0.35 estimate");
  assert.equal(commitment.amountBasis, "contextual_estimate");
});

test("an established protagonist rent bill flows from narrative supplement to a nonzero reviewable housing commitment", () => {
  const candidates = deriveExpenseResponsibilityCandidates({
    ageInMonths: 23 * 12,
    narrativeText: "你盘算着下个月要交的房租和日常开销，刚好能覆盖，但几乎没有余量。"
  }).candidates;
  const result = reconcileExpenseCommitments({
    ledger: ledger(),
    candidates,
    ageInMonths: 23 * 12,
    sourceOutcomeId: "established_personal_rent",
    mode: "enforced"
  });
  const commitment = result.proposals.find((proposal) => proposal.kind === "expense_commitment_started")?.payload as any;
  assert.equal(result.wouldBlock, false);
  assert.equal(commitment.responsibilityKey, "primary_residence:main");
  assert.equal(commitment.type, "housing");
  assert.equal(commitment.monthlyAmountWan, 0.35);
  assert.equal(commitment.factStatus, "needs_review");
  assert.equal(commitment.financialScope, "personal");
});

test("shared elder-care and healthcare remain review-only without an Accepted exact protagonist share", () => {
  for (const sharedResponsibility of [
    {
      id: "shared_elder_care_without_share",
      responsibilityKey: "elder_care:mother",
      responsibilityKind: "elder_care" as const,
      proposedType: "dependent_support" as const,
      evidence: "你们每周共同陪诊母亲。"
    },
    {
      id: "shared_healthcare_without_share",
      responsibilityKey: "recurring_healthcare:protagonist",
      responsibilityKind: "recurring_healthcare" as const,
      proposedType: "healthcare" as const,
      evidence: "你们每天按时服药。"
    }
  ]) {
    const current = ledger();
    const result = reconcileExpenseCommitments({
      ledger: current,
      candidates: [candidate({
        ...sharedResponsibility,
        action: "review",
        completion: "completed",
        cadence: "recurring_unknown",
        liability: "shared",
        financialScope: "shared_household",
        explicitMonthlyTotalWan: undefined,
        protagonistShareWan: undefined,
        shareRate: undefined,
        amountSourceId: undefined,
        // Even an Accepted WorldState observation cannot make up a personal
        // cash share; only a direct accepted financial fact may do that.
        source: "accepted_world_delta",
        evidence: [{
          source: "accepted_simulation_outcome",
          reasonCode: "TEST_SHARED_CARE_WITHOUT_SHARE",
          excerpt: sharedResponsibility.evidence,
          confidence: 1,
          financialScope: "shared_household"
        }]
      })],
      ageInMonths: 480,
      mode: "enforced"
    });
    assert.equal(result.proposals.length, 0, `${sharedResponsibility.responsibilityKind} must not open a policy-estimated shared account`);
    assert.equal(result.reviewEvents.some((event) => (
      event.payload.nextCommitment.responsibilityKey === sharedResponsibility.responsibilityKey
    )), false, `${sharedResponsibility.responsibilityKind} must not mutate a nonexistent account`);
    assert.equal(current.expenseCommitments.some((commitment) => commitment.responsibilityKey === sharedResponsibility.responsibilityKey), false);
    assert.equal(result.issues.some((item) => item.code === "EXPENSE_RESPONSIBILITY_SCOPE_CONFLICT"), true);
    assert.ok(result.candidateDecisions[0]?.reasonCodes.includes("SHARED_CARE_REQUIRES_ACCEPTED_PROTAGONIST_SHARE"));
  }
});

test("an Accepted exact protagonist share opens one correctly allocated shared elder-care account", () => {
  const result = reconcileExpenseCommitments({
    ledger: ledger(),
    candidates: [candidate({
      id: "accepted_shared_elder_care_half",
      responsibilityKey: "elder_care:mother",
      responsibilityKind: "elder_care",
      proposedType: "dependent_support",
      action: "start",
      completion: "completed",
      cadence: "monthly",
      liability: "shared",
      financialScope: "shared_household",
      explicitMonthlyTotalWan: 0.4,
      protagonistShareWan: 0.2,
      shareRate: 0.5,
      amountSourceId: "accepted-shared-mother-care-4000",
      source: "accepted_outcome",
      evidence: [{
        source: "accepted_simulation_outcome",
        reasonCode: "TEST_ACCEPTED_SHARED_ELDER_CARE",
        excerpt: "你们每月共同承担母亲照护费4000元，其中你承担2000元。",
        confidence: 1,
        financialScope: "shared_household"
      }]
    })],
    ageInMonths: 480,
    mode: "enforced"
  });
  const starts = result.proposals.filter((proposal) => proposal.kind === "expense_commitment_started");
  assert.equal(starts.length, 1);
  const commitment = starts[0]?.payload as any;
  assert.equal(commitment.monthlyAmountWan, 0.2);
  assert.equal(commitment.grossMonthlyAmountWan, 0.4);
  assert.equal(commitment.householdShareRate, 0.5);
  assert.equal(commitment.amountBasis, "explicit_shared_amount");
  assert.equal(commitment.factStatus, "known");
});

test("an unpriced shared-care observation cannot silently end an existing allocated commitment", () => {
  const current = ledger();
  const initial = reconcileExpenseCommitments({
    ledger: current,
    candidates: [candidate({
      id: "existing_shared_elder_care",
      responsibilityKey: "elder_care:mother",
      responsibilityKind: "elder_care",
      proposedType: "dependent_support",
      liability: "shared",
      financialScope: "shared_household",
      explicitMonthlyTotalWan: 0.4,
      protagonistShareWan: 0.2,
      shareRate: 0.5,
      amountSourceId: "existing-shared-mother-care-4000",
      source: "accepted_outcome",
      evidence: [{
        source: "accepted_simulation_outcome",
        reasonCode: "TEST_EXISTING_ACCEPTED_SHARED_ELDER_CARE",
        excerpt: "你们每月共同承担母亲照护费4000元，其中你承担2000元。",
        confidence: 1,
        financialScope: "shared_household"
      }]
    })],
    ageInMonths: 480,
    mode: "enforced"
  });
  const existing = initial.proposals.find((proposal) => proposal.kind === "expense_commitment_started")?.payload as any;
  assert.ok(existing);
  current.expenseCommitments.push(existing);

  const result = reconcileExpenseCommitments({
    ledger: current,
    candidates: [candidate({
      id: "unpriced_shared_elder_care_end",
      responsibilityKey: existing.responsibilityKey,
      responsibilityKind: "elder_care",
      proposedType: "dependent_support",
      action: "end",
      liability: "shared",
      financialScope: "shared_household",
      explicitMonthlyTotalWan: undefined,
      protagonistShareWan: undefined,
      shareRate: undefined,
      amountSourceId: undefined,
      source: "accepted_world_delta",
      evidence: [{
        source: "accepted_simulation_outcome",
        reasonCode: "TEST_SHARED_CARE_UNPRICED_END",
        excerpt: "你们不再轮流陪诊母亲。",
        confidence: 1,
        financialScope: "shared_household"
      }]
    })],
    ageInMonths: 481,
    mode: "enforced"
  });
  assert.equal(result.proposals.some((proposal) => proposal.kind === "expense_commitment_ended"), false);
  assert.equal(result.proposals.some((proposal) => proposal.kind === "expense_commitment_adjusted"), false);
  assert.equal(current.expenseCommitments.find((commitment) => commitment.id === existing.id)?.status, "active");
  assert.equal(current.expenseCommitments.find((commitment) => commitment.id === existing.id)?.monthlyAmountWan, 0.2);
  assert.equal(result.issues.some((item) => item.code === "EXPENSE_RESPONSIBILITY_SCOPE_CONFLICT"), true);
});

test("missing V2 context policy is a recognizable enforced blocker, never a basic-floor fallback", () => {
  const result = reconcileExpenseCommitments({
    ledger: ledger(),
    candidates: [candidate({
      responsibilityKey: "adult_basic_living:minor",
      responsibilityKind: "adult_basic_living",
      proposedType: "basic_living",
      financialScope: "personal",
      liability: "protagonist",
      explicitMonthlyTotalWan: undefined,
      protagonistShareWan: undefined,
      shareRate: undefined,
      amountSourceId: undefined
    })],
    ageInMonths: 17 * 12,
    sourceOutcomeId: "minor_unmatched_policy",
    mode: "enforced"
  });

  assert.equal(result.proposals.length, 0);
  assert.equal(result.wouldBlock, true);
  const missing = result.issues.find((item) => item.code === "EXPENSE_ESTIMATION_POLICY_MISSING");
  assert.ok(missing);
  assert.equal(missing.severity, "blocking");
  assert.match(missing.summary, /不能回落为零或 basic floor/);
});

test("confirmed structured cohabitation creates an independent nonzero reviewable housing commitment when none exists", () => {
  const current = ledger();
  const result = reconcileExpenseCommitments({
    ledger: current,
    candidates: [confirmedSharedResidenceReview()],
    ageInMonths: 384,
    sourceOutcomeId: "cohabitation",
    mode: "enforced"
  });

  const starts = result.proposals.filter((proposal) => proposal.kind === "expense_commitment_started");
  assert.equal(starts.length, 1);
  const commitment = starts[0].payload as any;
  assert.equal(commitment.responsibilityKey, "primary_residence:main");
  assert.equal(commitment.responsibilityKind, "primary_residence");
  assert.equal(commitment.type, "housing");
  assert.equal(commitment.monthlyAmountWan, 0.35);
  assert.equal(commitment.financialScope, "shared_household");
  assert.equal(commitment.factStatus, "needs_review");
  assert.equal(commitment.amountBasis, "contextual_estimate");
  assert.equal(commitment.estimationPolicyId, "expense-estimation-policy-v2");
  assert.equal(commitment.displayName, "住房持续支出");
  const prospective = structuredClone(current);
  prospective.expenseCommitments.push(commitment);
  assertFinancialLedgerInvariants(prospective);
});

test("a completed narrative joint account for rent starts a policy-based shared housing review without treating its contribution rate as rent", () => {
  const narrative = "43岁过半，你与伴侣正式设立了共同账户，每月按税后收入的30%存入用于房租和家庭共同支出，剩余各自保留。起初的几个月，你们像两个谨慎的合伙人，每笔支出都记录在案，季度复盘时仔细核对每一项。";
  const candidates = deriveExpenseResponsibilityCandidates({
    ageInMonths: 43 * 12 + 6,
    narrativeText: narrative
  }).candidates;
  assert.deepEqual(candidates.map((candidate) => [
    candidate.responsibilityKey,
    candidate.responsibilityKind,
    candidate.proposedType,
    candidate.financialScope,
    candidate.liability,
    candidate.explicitMonthlyTotalWan,
    candidate.protagonistShareWan,
    candidate.shareRate
  ]), [[
    "primary_residence:main",
    "primary_residence",
    "housing",
    "shared_household",
    "shared",
    undefined,
    undefined,
    undefined
  ]]);

  const current = ledger();
  const result = reconcileExpenseCommitments({
    ledger: current,
    candidates,
    ageInMonths: 43 * 12 + 6,
    sourceOutcomeId: "joint_account_shared_residence",
    mode: "enforced"
  });
  const commitment = result.proposals.find((proposal) => (
    proposal.kind === "expense_commitment_started"
  ))?.payload as any;

  assert.equal(result.wouldBlock, false);
  assert.equal(result.issues.some((issue) => issue.code === "EXPENSE_RESPONSIBILITY_SCOPE_CONFLICT"), false);
  assert.equal(commitment?.responsibilityKey, "primary_residence:main");
  assert.equal(commitment?.type, "housing");
  assert.equal(commitment?.financialScope, "shared_household");
  assert.equal(commitment?.monthlyAmountWan, 0.35);
  assert.equal(commitment?.amountBasis, "contextual_estimate");
  assert.equal(commitment?.factStatus, "needs_review");
  assert.equal(commitment?.grossMonthlyAmountWan, undefined);
  assert.equal(commitment?.confirmedMonthlyAmountWan, undefined);
  assert.equal(commitment?.householdShareRate, undefined);
  assert.equal(commitment?.estimationPolicyId, "expense-estimation-policy-v2");
  assertFinancialLedgerInvariants({
    ...current,
    expenseCommitments: [...current.expenseCommitments, commitment]
  });
});

test("retrying the same structured cohabitation fact neither duplicates nor repeatedly reviews housing", () => {
  const current = ledger();
  const first = reconcileExpenseCommitments({
    ledger: current,
    candidates: [confirmedSharedResidenceReview()],
    ageInMonths: 384,
    sourceOutcomeId: "cohabitation",
    mode: "enforced"
  });
  const housing = first.proposals.find((proposal) => proposal.kind === "expense_commitment_started")!.payload as any;
  current.expenseCommitments.push(housing);
  assertFinancialLedgerInvariants(current);

  const retried = reconcileExpenseCommitments({
    ledger: current,
    candidates: [confirmedSharedResidenceReview()],
    ageInMonths: 384,
    sourceOutcomeId: "cohabitation_retry",
    mode: "enforced"
  });
  assert.equal(retried.proposals.filter((proposal) => proposal.kind === "expense_commitment_started").length, 0);
  const housingReviews = retried.reviewEvents.filter((event) => (
    event.payload.expenseCommitmentId === housing.id
  ));
  assert.equal(housingReviews.length, 0, "a retry must not append another needs_review mutation");
});

test("unknown-coverage legacy aggregate holds a cohabitation housing candidate as review instead of double-accruing it", () => {
  const current = legacyAggregateLedger();
  const aggregate = current.expenseCommitments.find((commitment) => commitment.responsibilityKind === "legacy_aggregate")!;
  const result = reconcileExpenseCommitments({
    ledger: current,
    candidates: [confirmedSharedResidenceReview()],
    ageInMonths: 384,
    sourceOutcomeId: "cohabitation_with_legacy_aggregate",
    mode: "enforced"
  });

  assert.equal(result.proposals.filter((proposal) => proposal.kind === "expense_commitment_started").length, 0);
  assert.equal(current.expenseCommitments.filter((commitment) => commitment.status === "active").length, 1);
  assert.equal(aggregate.monthlyAmountWan, 1.5);
  const gap = result.issues.find((item) => item.code === "EXPENSE_OPENING_COMPONENT_GAP")!;
  assert.equal(gap.relatedAccountIds?.[0], aggregate.id);
  assert.match(gap.summary, /primary_residence:main/);
  const aggregateReview = result.reviewEvents.find((event) => event.payload.expenseCommitmentId === aggregate.id);
  assert.equal(aggregateReview?.payload.nextCommitment.monthlyAmountWan, 1.5);
  assert.equal(aggregateReview?.payload.nextCommitment.factStatus, "needs_review");

  const retry = reconcileExpenseCommitments({
    ledger: current,
    candidates: [confirmedSharedResidenceReview()],
    ageInMonths: 384,
    sourceOutcomeId: "cohabitation_with_legacy_aggregate_retry",
    mode: "enforced"
  });
  assert.equal(retry.issues.find((item) => item.code === "EXPENSE_OPENING_COMPONENT_GAP")?.id, gap.id);
});

test("unknown-coverage legacy aggregate holds an explicit parent-medical component candidate rather than adding it beside the aggregate", () => {
  const current = legacyAggregateLedger();
  const aggregate = current.expenseCommitments.find((commitment) => commitment.responsibilityKind === "legacy_aggregate")!;
  const result = reconcileExpenseCommitments({
    ledger: current,
    candidates: [parentMedicalCandidate()],
    ageInMonths: 384,
    sourceOutcomeId: "parent_medical_with_legacy_aggregate",
    mode: "enforced"
  });

  assert.equal(result.proposals.filter((proposal) => proposal.kind === "expense_commitment_started").length, 0);
  assert.equal(current.expenseCommitments.some((commitment) => commitment.responsibilityKind === "recurring_healthcare" && commitment.status === "active"), false);
  assert.equal(aggregate.status, "active");
  assert.equal(aggregate.monthlyAmountWan, 1.5);
  const gap = result.issues.find((item) => item.code === "EXPENSE_OPENING_COMPONENT_GAP")!;
  assert.equal(gap.relatedAccountIds?.[0], aggregate.id);
  assert.match(gap.summary, /recurring_healthcare:parent/);
});

test("an active aggregate parent-care account blocks an individual parent-care start and reviews the aggregate", () => {
  const current = ledger();
  const aggregate = startElderCare(current, elderCareCandidate({
    id: "elder_care_parents",
    responsibilityKey: "elder_care:parents",
    amountSourceId: "elder-care-parents-3000",
    participantPersonIds: [],
    evidence: [{
      source: "accepted_simulation_outcome", reasonCode: "ELDER_CARE_AGGREGATE", confidence: 1,
      financialScope: "personal", excerpt: "你每月承担父母照护费3000元。"
    }]
  }));

  const result = reconcileExpenseCommitments({
    ledger: current,
    candidates: [elderCareCandidate({ id: "elder_care_mother_after_aggregate" })],
    ageInMonths: 384,
    sourceOutcomeId: "mother_after_aggregate",
    mode: "enforced"
  });

  assert.equal(result.proposals.filter((proposal) => proposal.kind === "expense_commitment_started").length, 0);
  const overlap = result.issues.find((item) => item.code === "EXPENSE_DUPLICATE_RESPONSIBILITY");
  assert.equal(overlap?.relatedAccountIds[0], aggregate.id);
  assert.match(overlap?.summary || "", /elder_care:parents/);
  assert.match(overlap?.summary || "", /elder_care:mother/);
  assert.equal(result.candidateDecisions[0]?.disposition, "issue");
  assert.ok(result.candidateDecisions[0]?.reasonCodes.includes("ELDER_CARE_AGGREGATE_INDIVIDUAL_OVERLAP"));
  const review = result.reviewEvents.find((event) => event.payload.expenseCommitmentId === aggregate.id);
  assert.equal(review?.payload.nextCommitment.monthlyAmountWan, aggregate.monthlyAmountWan);
});

test("a paused aggregate parent-care account still blocks an individual start until an Accepted atomic split", () => {
  const current = ledger();
  const aggregate = startElderCare(current, elderCareCandidate({
    id: "paused_elder_care_parents",
    responsibilityKey: "elder_care:parents",
    amountSourceId: "paused-elder-care-parents-3000",
    participantPersonIds: [],
    evidence: [{
      source: "accepted_simulation_outcome", reasonCode: "ELDER_CARE_AGGREGATE", confidence: 1,
      financialScope: "personal", excerpt: "你每月承担父母照护费3000元。"
    }]
  }));
  aggregate.status = "paused";

  const result = reconcileExpenseCommitments({
    ledger: current,
    candidates: [elderCareCandidate({ id: "elder_care_mother_beside_paused_aggregate" })],
    ageInMonths: 384,
    sourceOutcomeId: "mother_beside_paused_aggregate",
    mode: "enforced"
  });

  assert.equal(result.proposals.filter((proposal) => proposal.kind === "expense_commitment_started").length, 0);
  assert.equal(result.issues.some((item) => item.code === "EXPENSE_DUPLICATE_RESPONSIBILITY"), true);
  assert.equal(result.candidateDecisions[0]?.disposition, "issue");
});

test("a protagonist care plan may coexist with an aggregate parent-care responsibility", () => {
  const current = ledger();
  startElderCare(current, elderCareCandidate({
    id: "elder_care_parents",
    responsibilityKey: "elder_care:parents",
    amountSourceId: "elder-care-parents-3000",
    participantPersonIds: [],
    evidence: [{
      source: "accepted_simulation_outcome", reasonCode: "ELDER_CARE_AGGREGATE", confidence: 1,
      financialScope: "personal", excerpt: "你每月承担父母照护费3000元。"
    }]
  }));
  const result = reconcileExpenseCommitments({
    ledger: current,
    candidates: [elderCareCandidate({
      id: "protagonist_care_plan",
      responsibilityKey: "elder_care:care_plan",
      amountSourceId: "protagonist-care-plan-2000",
      participantPersonIds: [],
      evidence: [{
        source: "accepted_simulation_outcome", reasonCode: "PROTAGONIST_CARE_PLAN", confidence: 1,
        financialScope: "personal", excerpt: "你开始每月支付护工费用2000元。"
      }]
    })],
    ageInMonths: 384,
    sourceOutcomeId: "protagonist_care_plan_after_parent_care",
    mode: "enforced"
  });

  assert.deepEqual(
    result.proposals.filter((proposal) => proposal.kind === "expense_commitment_started")
      .map((proposal) => (proposal.payload as { responsibilityKey: string }).responsibilityKey),
    ["elder_care:care_plan"]
  );
  assert.equal(result.issues.some((item) => item.code === "EXPENSE_DUPLICATE_RESPONSIBILITY"), false);
});

test("an active individual parent-care account blocks an aggregate parent-care start and reviews the individual", () => {
  const current = ledger();
  const mother = startElderCare(current, elderCareCandidate());
  const aggregateCandidate = elderCareCandidate({
    id: "elder_care_parents_after_mother",
    responsibilityKey: "elder_care:parents",
    amountSourceId: "elder-care-parents-3000",
    participantPersonIds: [],
    evidence: [{
      source: "accepted_simulation_outcome", reasonCode: "ELDER_CARE_AGGREGATE", confidence: 1,
      financialScope: "personal", excerpt: "你每月承担父母照护费3000元。"
    }]
  });
  const result = reconcileExpenseCommitments({
    ledger: current,
    candidates: [aggregateCandidate],
    ageInMonths: 384,
    sourceOutcomeId: "parents_after_mother",
    mode: "enforced"
  });

  assert.equal(result.proposals.filter((proposal) => proposal.kind === "expense_commitment_started").length, 0);
  const overlap = result.issues.find((item) => item.code === "EXPENSE_DUPLICATE_RESPONSIBILITY");
  assert.equal(overlap?.relatedAccountIds[0], mother.id);
  assert.match(overlap?.summary || "", /elder_care:mother/);
  assert.match(overlap?.summary || "", /elder_care:parents/);
  assert.equal(result.candidateDecisions[0]?.disposition, "issue");
  assert.ok(result.candidateDecisions[0]?.reasonCodes.includes("ELDER_CARE_AGGREGATE_INDIVIDUAL_OVERLAP"));
  assert.equal(result.reviewEvents.some((event) => event.payload.expenseCommitmentId === mother.id), true);
});

test("a same-node direct aggregate elder-care start suppresses a derived individual start", () => {
  const current = ledger();
  const aggregateCandidate = elderCareCandidate({
    id: "direct_aggregate_parents",
    responsibilityKey: "elder_care:parents",
    amountSourceId: "direct-aggregate-3000",
    participantPersonIds: [],
    evidence: [{
      source: "accepted_simulation_outcome", reasonCode: "DIRECT_ELDER_CARE_AGGREGATE", confidence: 1,
      financialScope: "personal", excerpt: "你每月承担父母照护费3000元。"
    }]
  });
  const aggregatePayload = reconcileExpenseCommitments({
    ledger: current,
    candidates: [aggregateCandidate],
    ageInMonths: 372,
    sourceOutcomeId: "direct_aggregate_outcome",
    mode: "enforced"
  }).proposals.find((proposal) => proposal.kind === "expense_commitment_started")?.payload as any;
  assert.ok(aggregatePayload, "test setup must create the direct aggregate payload");
  const directAggregate: AcceptedFinancialEvent<"expense_commitment_started"> = {
    id: "direct_aggregate_event",
    proposalId: "direct_aggregate_proposal",
    kind: "expense_commitment_started",
    effectiveAtAgeInMonths: 372,
    payload: aggregatePayload,
    evidence: aggregateCandidate.evidence,
    acceptedByReasonCodes: ["TEST_DIRECT_ACCEPTED_ELDER_CARE"]
  };

  const result = reconcileExpenseCommitments({
    ledger: current,
    candidates: [elderCareCandidate({ id: "derived_mother_beside_direct_aggregate" })],
    acceptedExpenseEvents: [directAggregate],
    ageInMonths: 372,
    sourceOutcomeId: "derived_mother_beside_direct_aggregate",
    mode: "enforced"
  });

  assert.equal(result.proposals.filter((proposal) => proposal.kind === "expense_commitment_started").length, 0);
  const overlap = result.issues.find((item) => item.code === "EXPENSE_DUPLICATE_RESPONSIBILITY");
  assert.deepEqual(overlap?.relatedProposalIds, ["direct_aggregate_proposal"]);
  assert.match(overlap?.summary || "", /elder_care:parents/);
  assert.match(overlap?.summary || "", /elder_care:mother/);
  assert.equal(result.candidateDecisions[0]?.disposition, "issue");
  assert.ok(result.candidateDecisions[0]?.reasonCodes.includes("DIRECT_ACCEPTED_ELDER_CARE_AGGREGATE_INDIVIDUAL_OVERLAP"));
});

test("a same-node direct individual elder-care start suppresses a derived aggregate start", () => {
  const current = ledger();
  const directMotherCandidate = elderCareCandidate({ id: "direct_mother" });
  const directMotherPayload = reconcileExpenseCommitments({
    ledger: current,
    candidates: [directMotherCandidate],
    ageInMonths: 372,
    sourceOutcomeId: "direct_mother_outcome",
    mode: "enforced"
  }).proposals.find((proposal) => proposal.kind === "expense_commitment_started")?.payload as any;
  assert.ok(directMotherPayload, "test setup must create the direct individual payload");
  const directMother: AcceptedFinancialEvent<"expense_commitment_started"> = {
    id: "direct_mother_event",
    proposalId: "direct_mother_proposal",
    kind: "expense_commitment_started",
    effectiveAtAgeInMonths: 372,
    payload: directMotherPayload,
    evidence: directMotherCandidate.evidence,
    acceptedByReasonCodes: ["TEST_DIRECT_ACCEPTED_ELDER_CARE"]
  };
  const aggregateCandidate = elderCareCandidate({
    id: "derived_parents_beside_direct_mother",
    responsibilityKey: "elder_care:parents",
    amountSourceId: "derived-parents-3000",
    participantPersonIds: [],
    evidence: [{
      source: "accepted_simulation_outcome", reasonCode: "DERIVED_ELDER_CARE_AGGREGATE", confidence: 1,
      financialScope: "personal", excerpt: "你每月承担父母照护费3000元。"
    }]
  });

  const result = reconcileExpenseCommitments({
    ledger: current,
    candidates: [aggregateCandidate],
    acceptedExpenseEvents: [directMother],
    ageInMonths: 372,
    sourceOutcomeId: "derived_parents_beside_direct_mother",
    mode: "enforced"
  });

  assert.equal(result.proposals.filter((proposal) => proposal.kind === "expense_commitment_started").length, 0);
  const overlap = result.issues.find((item) => item.code === "EXPENSE_DUPLICATE_RESPONSIBILITY");
  assert.deepEqual(overlap?.relatedProposalIds, ["direct_mother_proposal"]);
  assert.match(overlap?.summary || "", /elder_care:mother/);
  assert.match(overlap?.summary || "", /elder_care:parents/);
  assert.equal(result.candidateDecisions[0]?.disposition, "issue");
  assert.ok(result.candidateDecisions[0]?.reasonCodes.includes("DIRECT_ACCEPTED_ELDER_CARE_AGGREGATE_INDIVIDUAL_OVERLAP"));
});

test("a same-node Accepted atomic aggregate split permits the derived individual start", () => {
  const current = ledger();
  const aggregate = startElderCare(current, elderCareCandidate({
    id: "parents_before_atomic_split",
    responsibilityKey: "elder_care:parents",
    amountSourceId: "parents-before-split-3000",
    participantPersonIds: [],
    evidence: [{
      source: "accepted_simulation_outcome", reasonCode: "ELDER_CARE_AGGREGATE", confidence: 1,
      financialScope: "personal", excerpt: "你每月承担父母照护费3000元。"
    }]
  }));
  const atomicSplitEnd: AcceptedFinancialEvent<"expense_commitment_ended"> = {
    id: "parents_atomic_split_end_event",
    proposalId: "parents_atomic_split_end_proposal",
    kind: "expense_commitment_ended",
    effectiveAtAgeInMonths: 384,
    payload: {
      expenseCommitmentId: aggregate.id,
      previousCommitmentId: aggregate.id,
      changeReason: "aggregate_atomically_split"
    },
    evidence: [{
      source: "accepted_simulation_outcome", reasonCode: "ELDER_CARE_ATOMIC_SPLIT", confidence: 1,
      financialScope: "personal", excerpt: "你已将原先父母照护费拆分为分项。"
    }],
    acceptedByReasonCodes: ["TEST_ACCEPTED_ATOMIC_SPLIT"]
  };
  const result = reconcileExpenseCommitments({
    ledger: current,
    candidates: [elderCareCandidate({ id: "mother_after_atomic_split" })],
    acceptedExpenseEvents: [atomicSplitEnd],
    ageInMonths: 384,
    sourceOutcomeId: "mother_after_atomic_split",
    mode: "enforced"
  });

  assert.deepEqual(
    result.proposals.filter((proposal) => proposal.kind === "expense_commitment_started")
      .map((proposal) => (proposal.payload as { responsibilityKey: string }).responsibilityKey),
    ["elder_care:mother"]
  );
  assert.equal(result.issues.some((item) => item.code === "EXPENSE_DUPLICATE_RESPONSIBILITY"), false);
});

test("separate mother and father elder-care responsibilities may start together", () => {
  const mother = elderCareCandidate();
  const father = elderCareCandidate({
    id: "elder_care_father",
    responsibilityKey: "elder_care:father",
    amountSourceId: "elder-care-father-3000",
    participantPersonIds: ["father"],
    evidence: [{
      source: "accepted_simulation_outcome", reasonCode: "ELDER_CARE_FATHER", confidence: 1,
      financialScope: "personal", excerpt: "你每月承担父亲照护费3000元。"
    }]
  });
  const result = reconcileExpenseCommitments({
    ledger: ledger(),
    candidates: [mother, father],
    ageInMonths: 372,
    sourceOutcomeId: "two_named_parents",
    mode: "enforced"
  });

  assert.deepEqual(
    result.proposals.filter((proposal) => proposal.kind === "expense_commitment_started")
      .map((proposal) => (proposal.payload as { responsibilityKey: string }).responsibilityKey)
      .sort(),
    ["elder_care:father", "elder_care:mother"]
  );
  assert.equal(result.issues.some((item) => item.code === "EXPENSE_DUPLICATE_RESPONSIBILITY"), false);
});

test("E-27 two children can coexist, while a retried same child does not duplicate", () => {
  const first = candidate({ responsibilityKey: "child_support:one", responsibilityKind: "child_support", proposedType: "dependent_support", explicitMonthlyTotalWan: undefined, protagonistShareWan: undefined, shareRate: undefined, amountSourceId: undefined, financialScope: "personal", liability: "protagonist" });
  const second = candidate({ id: "candidate_two", responsibilityKey: "child_support:two", responsibilityKind: "child_support", proposedType: "dependent_support", explicitMonthlyTotalWan: undefined, protagonistShareWan: undefined, shareRate: undefined, amountSourceId: undefined, financialScope: "personal", liability: "protagonist" });
  const result = reconcileExpenseCommitments({ ledger: ledger(), candidates: [first, second, first], ageInMonths: 372, sourceOutcomeId: "outcome", mode: "enforced" });
  assert.equal(result.proposals.length, 2);
  assert.equal((result.proposals[0].payload as any).monthlyAmountWan > 0, true);
});

test("E-15 workshop candidate is ignored before it can write a personal commitment", () => {
  const result = reconcileExpenseCommitments({
    ledger: ledger(),
    candidates: [candidate({ financialScope: "business_operating", liability: "third_party" })],
    ageInMonths: 372,
    sourceOutcomeId: "outcome",
    mode: "enforced"
  });
  assert.equal(result.proposals.length, 0);
  assert.equal(result.ignoredCandidateIds.length, 1);
  assert.deepEqual(result.candidateDecisions[0], {
    candidateId: "candidate",
    disposition: "ignored",
    reasonCodes: ["NON_ACCRUING_SCOPE_OR_CADENCE"],
    relatedProposalIds: [],
    relatedIssueIds: [],
    wouldBlock: false
  });
});

test("E-12 unknown owner does not become an automatic personal deduction", () => {
  const result = reconcileExpenseCommitments({
    ledger: ledger(),
    candidates: [candidate({ responsibilityKey: "elder_care:mother", responsibilityKind: "elder_care", proposedType: "dependent_support", liability: "unknown", financialScope: "personal", explicitMonthlyTotalWan: undefined, protagonistShareWan: undefined, shareRate: undefined })],
    ageInMonths: 372,
    sourceOutcomeId: "outcome",
    mode: "enforced"
  });
  assert.equal(result.proposals.length, 0);
  assert.equal(result.issues.length > 0, true);
  assert.equal(result.candidateDecisions[0]?.disposition, "issue");
  assert.equal(result.candidateDecisions[0]?.wouldBlock, false);
  assert.ok(result.candidateDecisions[0]?.relatedIssueIds[0]);
});

test("a completed care-intensity fact can only increase an existing contextual elder-care estimate", () => {
  const intensityCandidate = (overrides: Partial<ExpenseResponsibilityCandidate> = {}) => elderCareCandidate({
    id: "elder_care_intensity_uplift",
    action: "adjust",
    cadence: "recurring_unknown",
    explicitMonthlyTotalWan: undefined,
    protagonistShareWan: undefined,
    shareRate: undefined,
    amountSourceId: undefined,
    source: "narrative_supplement",
    policyEstimateAdjustment: "increase_only",
    evidence: [{
      source: "accepted_simulation_outcome",
      reasonCode: "EXPENSE_ELDER_CARE_INTENSITY_ESCALATION",
      confidence: 1,
      financialScope: "personal",
      excerpt: "父亲膝盖的退行性变化需要持续关注。你每天早晚帮他做一轮轻柔的关节活动。"
    }],
    ...overrides
  });

  const current = ledger();
  const contextual = startElderCare(current, elderCareCandidate({
    id: "contextual_elder_care",
    explicitMonthlyTotalWan: undefined,
    protagonistShareWan: undefined,
    shareRate: undefined,
    amountSourceId: undefined,
    cadence: "recurring_unknown",
    source: "accepted_outcome",
    evidence: [{
      source: "accepted_simulation_outcome",
      reasonCode: "CONTEXTUAL_ELDER_CARE",
      confidence: 1,
      financialScope: "personal",
      excerpt: "你定期带母亲去医院体检。"
    }]
  }), 58 * 12);
  assert.equal(contextual.monthlyAmountWan, 0.2);
  assert.equal(contextual.amountBasis, "contextual_estimate");
  assert.equal(contextual.factStatus, "needs_review");

  const uplift = reconcileExpenseCommitments({
    ledger: current,
    candidates: [intensityCandidate()],
    ageInMonths: 66 * 12 + 8,
    sourceOutcomeId: "care_intensity_uplift",
    mode: "enforced"
  });
  const adjusted = uplift.proposals.find((proposal) => proposal.kind === "expense_commitment_adjusted")?.payload as ExpenseCommitmentMutationPayload | undefined;
  assert.ok(adjusted);
  assert.equal(adjusted.nextCommitment.monthlyAmountWan, 0.35);
  assert.equal(adjusted.nextCommitment.amountBasis, "contextual_estimate");
  assert.equal(adjusted.nextCommitment.factStatus, "needs_review");
  assert.equal("previousCommitmentId" in adjusted, false, "an upward policy refinement is not an evidence-free downshift");
  assert.ok(adjusted.nextCommitment.amountSourceIds.some((item) => item.includes("contextual-uplift")));
  assert.ok(adjusted.nextCommitment.evidence.some((item) => item.reasonCode === "EXPENSE_CONTEXTUAL_UPLIFT_ELEVATED_CARE"));

  const noTarget = reconcileExpenseCommitments({
    ledger: ledger(),
    candidates: [intensityCandidate({ id: "uplift_without_target" })],
    ageInMonths: 66 * 12 + 8,
    sourceOutcomeId: "uplift_without_target",
    mode: "enforced"
  });
  assert.equal(noTarget.proposals.length, 0, "an intensity observation cannot create an elder-care account");
  assert.ok(noTarget.candidateDecisions[0]?.reasonCodes.includes("CONTEXTUAL_UPLIFT_TARGET_NOT_ACTIVE"));

  const exact = ledger();
  const known = startElderCare(exact, elderCareCandidate({ id: "known_elder_care" }), 58 * 12);
  const knownResult = reconcileExpenseCommitments({
    ledger: exact,
    candidates: [intensityCandidate({ id: "uplift_known_amount" })],
    ageInMonths: 66 * 12 + 8,
    sourceOutcomeId: "uplift_known_amount",
    mode: "enforced"
  });
  assert.equal(knownResult.proposals.some((proposal) => proposal.kind === "expense_commitment_adjusted"), false, "a known amount cannot be overwritten by a policy estimate");
  assert.equal(exact.expenseCommitments.find((item) => item.id === known.id)?.monthlyAmountWan, 0.3);

  const higherContextual = ledger();
  const higher = startElderCare(higherContextual, elderCareCandidate({
    id: "higher_contextual_elder_care",
    explicitMonthlyTotalWan: undefined,
    protagonistShareWan: undefined,
    shareRate: undefined,
    amountSourceId: undefined,
    cadence: "recurring_unknown",
    source: "accepted_outcome"
  }), 58 * 12);
  higher.monthlyAmountWan = 0.5;
  const lowerPolicy = reconcileExpenseCommitments({
    ledger: higherContextual,
    candidates: [intensityCandidate({ id: "uplift_cannot_lower" })],
    ageInMonths: 66 * 12 + 8,
    sourceOutcomeId: "uplift_cannot_lower",
    mode: "enforced"
  });
  assert.equal(lowerPolicy.proposals.some((proposal) => proposal.kind === "expense_commitment_adjusted"), false, "an elevated policy row below the current amount cannot lower an account");
  assert.equal(higherContextual.expenseCommitments.find((item) => item.id === higher.id)?.monthlyAmountWan, 0.5);

  const repeatedEvidence = ledger();
  const repeatedBase = startElderCare(repeatedEvidence, elderCareCandidate({
    id: "repeated_evidence_contextual_base",
    explicitMonthlyTotalWan: undefined,
    protagonistShareWan: undefined,
    shareRate: undefined,
    amountSourceId: undefined,
    cadence: "recurring_unknown",
    source: "accepted_outcome"
  }), 64 * 12);
  const firstUplift = reconcileExpenseCommitments({
    ledger: repeatedEvidence,
    candidates: [intensityCandidate({ id: "first_intensity_evidence" })],
    ageInMonths: 64 * 12,
    sourceOutcomeId: "first_intensity_evidence",
    mode: "enforced"
  }).proposals.find((proposal) => proposal.kind === "expense_commitment_adjusted")?.payload as ExpenseCommitmentMutationPayload | undefined;
  assert.equal(firstUplift?.nextCommitment.monthlyAmountWan, 0.25);
  const repeatedNextCommitment = firstUplift?.nextCommitment;
  assert.ok(repeatedNextCommitment && isExpenseCommitmentV4(repeatedNextCommitment));
  const repeatedIndex = repeatedEvidence.expenseCommitments.findIndex((item) => item.id === repeatedBase.id);
  repeatedEvidence.expenseCommitments[repeatedIndex] = repeatedNextCommitment;
  const repeatedAtOlderAge = reconcileExpenseCommitments({
    ledger: repeatedEvidence,
    candidates: [intensityCandidate({ id: "same_intensity_evidence_after_65" })],
    ageInMonths: 65 * 12,
    sourceOutcomeId: "same_intensity_evidence_after_65",
    mode: "enforced"
  });
  assert.equal(repeatedAtOlderAge.proposals.some((proposal) => proposal.kind === "expense_commitment_adjusted"), false, "crossing an age band cannot reapply the same old escalation evidence");
  assert.equal(repeatedEvidence.expenseCommitments[repeatedIndex]?.monthlyAmountWan, 0.25);
});

test("Career retired/not_working review reaches every active commitment without lowering or ending any of them", () => {
  const current = ledger();
  const basic = current.expenseCommitments[0]!;
  current.expenseCommitments.push({
    ...structuredClone(basic),
    id: "housing", responsibilityKey: "primary_residence:main", responsibilityKind: "primary_residence",
    type: "housing", displayName: "住房持续支出", monthlyAmountWan: 0.8, amountSourceIds: ["known_housing"]
  });
  const careerExit = candidate({
    id: "retirement_review",
    responsibilityKey: "adult_basic_living:main",
    responsibilityKind: "adult_basic_living",
    proposedType: "basic_living",
    action: "review",
    liability: "protagonist",
    financialScope: "personal",
    explicitMonthlyTotalWan: undefined,
    protagonistShareWan: undefined,
    shareRate: undefined,
    amountSourceId: undefined,
    source: "accepted_world_delta",
    evidence: [{
      source: "accepted_simulation_outcome", reasonCode: "EXPENSE_CAREER_EXIT_REVIEW", confidence: 1,
      financialScope: "personal", excerpt: "已接受 CareerState 从 employed 变为 retired"
    }]
  });
  const result = reconcileExpenseCommitments({
    ledger: current, candidates: [careerExit], ageInMonths: 720, sourceOutcomeId: "retire", mode: "enforced"
  });
  assert.equal(result.proposals.length, 0);
  assert.deepEqual(
    result.reviewEvents.map((event) => [event.payload.expenseCommitmentId, event.payload.nextCommitment.monthlyAmountWan, event.payload.nextCommitment.status]).sort(),
    [["basic", 0.5, "active"], ["housing", 0.8, "active"]]
  );
});

test("E-19 an accepted parent-care end keeps the exact responsibility link and reason", () => {
  const current = ledger();
  const care = candidate({
    id: "mother_care_start",
    responsibilityKey: "elder_care:mother",
    responsibilityKind: "elder_care",
    proposedType: "dependent_support",
    action: "start",
    financialScope: "personal",
    liability: "protagonist",
    explicitMonthlyTotalWan: 0.3,
    protagonistShareWan: 0.3,
    shareRate: undefined,
    amountSourceId: "mother-care-3000",
    participantPersonIds: ["mother"],
    evidence: [{ source: "accepted_simulation_outcome", reasonCode: "MOTHER_CARE", confidence: 1, excerpt: "你每月承担母亲照护费3000元。" }]
  });
  const started = reconcileExpenseCommitments({
    ledger: current,
    candidates: [care],
    ageInMonths: 372,
    sourceOutcomeId: "care_start",
    mode: "enforced"
  }).proposals[0].payload as any;
  current.expenseCommitments.push(started);

  const result = reconcileExpenseCommitments({
    ledger: current,
    candidates: [{
      ...care,
      id: "mother_care_end",
      action: "end",
      evidence: [{ source: "accepted_simulation_outcome", reasonCode: "MOTHER_CARE_ENDED", confidence: 1, excerpt: "母亲去世，你不再承担照护费用。" }]
    }],
    ageInMonths: 384,
    sourceOutcomeId: "care_end",
    mode: "enforced"
  });
  const end = result.proposals.find((proposal) => proposal.kind === "expense_commitment_ended")!;
  assert.deepEqual(end.payload, {
    expenseCommitmentId: started.id,
    previousCommitmentId: started.id,
    changeReason: "care_recipient_deceased"
  });
});

test("a lower or paused V4 responsibility carries authority metadata; an ordinary increase does not need it", () => {
  const current = ledger();
  const started = reconcileExpenseCommitments({
    ledger: current,
    candidates: [candidate({ financialScope: "personal", liability: "protagonist", shareRate: undefined, explicitMonthlyTotalWan: 0.3, protagonistShareWan: 0.3 })],
    ageInMonths: 372,
    sourceOutcomeId: "home_start",
    mode: "enforced"
  }).proposals[0].payload as any;
  current.expenseCommitments.push(started);

  const lower = reconcileExpenseCommitments({
    ledger: current,
    candidates: [candidate({
      id: "home_lower", action: "adjust", financialScope: "personal", liability: "protagonist",
      shareRate: undefined, explicitMonthlyTotalWan: 0.2, protagonistShareWan: 0.2,
      changeReason: "explicit_amount_reduced",
      evidence: [{ source: "accepted_simulation_outcome", reasonCode: "HOME_RENT_REDUCED", confidence: 1, excerpt: "你搬到更小的住所，房租降为每月2000元。" }]
    })],
    ageInMonths: 384,
    sourceOutcomeId: "home_lower",
    mode: "enforced"
  });
  assert.deepEqual(lower.proposals[0].payload, {
    expenseCommitmentId: started.id,
    previousCommitmentId: started.id,
    changeReason: "explicit_amount_reduced",
    nextCommitment: {
      ...started,
      monthlyAmountWan: 0.2,
      grossMonthlyAmountWan: 0.2,
      confirmedMonthlyAmountWan: 0.2,
      amountBasis: "explicit_known",
      amountSourceIds: ["rent_5200"],
      householdShareRate: undefined,
      factStatus: "known",
      accrualReviewStatus: "normal",
      lastConfirmedAtAgeInMonths: 384,
      lastReviewedAtAgeInMonths: 384,
      nextReviewAtAgeInMonths: 420,
      evidence: [...started.evidence, { source: "accepted_simulation_outcome", reasonCode: "HOME_RENT_REDUCED", confidence: 1, excerpt: "你搬到更小的住所，房租降为每月2000元。" }]
    }
  });

  const pause = reconcileExpenseCommitments({
    ledger: current,
    candidates: [candidate({
      id: "home_pause", action: "adjust", financialScope: "personal", liability: "protagonist",
      explicitMonthlyTotalWan: undefined, protagonistShareWan: undefined, shareRate: undefined,
      nextStatus: "paused", changeReason: "temporary_third_party_coverage",
      evidence: [{ source: "accepted_simulation_outcome", reasonCode: "HOME_TEMPORARY_PROXY_PAYER", confidence: 1, excerpt: "本月起暂由伴侣代付房租。" }]
    })],
    ageInMonths: 385,
    sourceOutcomeId: "home_pause",
    mode: "enforced"
  });
  const pausePayload = pause.proposals[0].payload as any;
  assert.equal(pausePayload.previousCommitmentId, started.id);
  assert.equal(pausePayload.changeReason, "temporary_third_party_coverage");
  assert.equal(pausePayload.nextCommitment.status, "paused");

  const increase = reconcileExpenseCommitments({
    ledger: current,
    candidates: [candidate({
      id: "home_increase", action: "adjust", financialScope: "personal", liability: "protagonist",
      shareRate: undefined, explicitMonthlyTotalWan: 0.4, protagonistShareWan: 0.4,
      evidence: [{ source: "accepted_simulation_outcome", reasonCode: "HOME_RENT_INCREASED", confidence: 1, excerpt: "你续租后房租上调到每月4000元。" }]
    })],
    ageInMonths: 386,
    sourceOutcomeId: "home_increase",
    mode: "enforced"
  });
  const increasePayload = increase.proposals[0].payload as any;
  assert.equal("previousCommitmentId" in increasePayload, false);
  assert.equal("changeReason" in increasePayload, false);
});

test("narrative-only explicit amount remains a nonzero reviewable V4 commitment rather than impersonating confirmation", () => {
  const current = ledger();
  const result = reconcileExpenseCommitments({
    ledger: current,
    candidates: [candidate({
      source: "narrative_supplement",
      financialScope: "personal",
      liability: "protagonist",
      explicitMonthlyTotalWan: 0.4,
      protagonistShareWan: 0.4,
      shareRate: undefined
    })],
    ageInMonths: 372,
    sourceOutcomeId: "outcome",
    mode: "enforced"
  });
  const commitment = result.proposals[0].payload as any;
  assert.equal(commitment.monthlyAmountWan, 0.4);
  assert.equal(commitment.factStatus, "needs_review");
  assert.equal(commitment.amountBasis, "last_known");
  assert.equal(commitment.confirmedMonthlyAmountWan, undefined);
  const prospective = structuredClone(current);
  prospective.expenseCommitments.push(commitment);
  assertFinancialLedgerInvariants(prospective);
});

test("a later Accepted start fact adjusts and confirms an existing reviewable healthcare responsibility", () => {
  const current = ledger();
  const tentative = parentMedicalCandidate();
  tentative.id = "parent_medical_tentative";
  tentative.source = "narrative_supplement";
  tentative.explicitMonthlyTotalWan = 0.12;
  tentative.protagonistShareWan = 0.12;
  tentative.amountSourceId = "parent-medical-1200";
  tentative.evidence = [{
    source: "accepted_simulation_outcome",
    reasonCode: "PARENT_MEDICAL_TENTATIVE",
    confidence: 1,
    financialScope: "personal",
    excerpt: "你暂按每月1200元给父母医疗补贴。"
  }];
  const started = reconcileExpenseCommitments({
    ledger: current,
    candidates: [tentative],
    ageInMonths: 372,
    sourceOutcomeId: "parent_medical_tentative",
    mode: "enforced"
  }).proposals[0].payload as any;
  current.expenseCommitments.push(started);

  const confirmed = parentMedicalCandidate();
  confirmed.id = "parent_medical_confirmed";
  confirmed.action = "start";
  confirmed.explicitMonthlyTotalWan = 0.15;
  confirmed.protagonistShareWan = 0.15;
  confirmed.amountSourceId = "parent-medical-1500";
  confirmed.evidence = [{
    source: "accepted_simulation_outcome",
    reasonCode: "PARENT_MEDICAL_RAISED",
    confidence: 1,
    financialScope: "personal",
    excerpt: "你主动把每月医疗补贴从1200元提到1500元。"
  }];
  const result = reconcileExpenseCommitments({
    ledger: current,
    candidates: [confirmed],
    ageInMonths: 384,
    sourceOutcomeId: "parent_medical_confirmed",
    mode: "enforced"
  });
  const adjustment = result.proposals.find((proposal) => proposal.kind === "expense_commitment_adjusted")!;
  const payload = adjustment.payload as ExpenseCommitmentMutationPayload;
  assert.equal(payload.expenseCommitmentId, started.id);
  assert.equal(payload.nextCommitment.monthlyAmountWan, 0.15);
  assert.equal(payload.nextCommitment.factStatus, "known");
  assert.equal(payload.nextCommitment.nextReviewAtAgeInMonths, 396);
  assert.equal(result.reviewEvents.some((event) => event.payload.expenseCommitmentId === started.id), false,
    "the stale review plan must not overwrite an Accepted adjustment in the same node");
});

test("a completed shared-housing start updates an existing residence in place when its amount is still unknown", () => {
  const current = ledger();
  const existing = candidate({
    financialScope: "personal",
    liability: "protagonist",
    explicitMonthlyTotalWan: 0.35,
    protagonistShareWan: 0.35,
    shareRate: undefined,
    participantPersonIds: [],
    source: "accepted_outcome"
  });
  const housing = reconcileExpenseCommitments({
    ledger: current,
    candidates: [existing],
    ageInMonths: 372,
    sourceOutcomeId: "personal_home",
    mode: "enforced"
  }).proposals[0].payload as any;
  current.expenseCommitments.push(housing);

  const sharedStart = confirmedSharedResidenceReview();
  sharedStart.id = "shared_household_start";
  sharedStart.action = "start";
  const result = reconcileExpenseCommitments({
    ledger: current,
    candidates: [sharedStart],
    ageInMonths: 384,
    sourceOutcomeId: "shared_home",
    mode: "enforced"
  });
  const adjustment = result.proposals.find((proposal) => proposal.kind === "expense_commitment_adjusted")!;
  const payload = adjustment.payload as ExpenseCommitmentMutationPayload;
  assert.equal(payload.expenseCommitmentId, housing.id);
  assert.equal(payload.nextCommitment.financialScope, "shared_household");
  assert.equal(payload.nextCommitment.monthlyAmountWan, 0.35,
    "an amount-unknown shared transition cannot silently lower the existing bill");
  assert.equal(payload.nextCommitment.factStatus, "needs_review");
  assert.equal(result.reviewEvents.some((event) => event.payload.expenseCommitmentId === housing.id), false);
});

test("an end action owns its account and suppresses a stale review event in the same node", () => {
  const current = ledger();
  const care = parentMedicalCandidate();
  const started = reconcileExpenseCommitments({
    ledger: current,
    candidates: [care],
    ageInMonths: 372,
    sourceOutcomeId: "care_start",
    mode: "enforced"
  }).proposals[0].payload as any;
  started.nextReviewAtAgeInMonths = 373;
  current.expenseCommitments.push(started);
  const result = reconcileExpenseCommitments({
    ledger: current,
    candidates: [{
      ...care,
      id: "care_end_overdue",
      action: "end",
      evidence: [{
        source: "accepted_simulation_outcome",
        reasonCode: "PARENT_MEDICAL_ENDED",
        confidence: 1,
        financialScope: "personal",
        excerpt: "父母治疗结束，你不再承担这项医疗费用。"
      }]
    }],
    ageInMonths: 384,
    sourceOutcomeId: "care_end",
    mode: "enforced"
  });
  assert.equal(result.proposals.filter((proposal) => proposal.kind === "expense_commitment_ended").length, 1);
  assert.equal(result.reviewEvents.some((event) => event.payload.expenseCommitmentId === started.id), false);
});

test("a direct Accepted expense fact is the sole same-node writer for its responsibility", () => {
  const current = ledger();
  const evidence = [{
    source: "accepted_simulation_outcome" as const,
    reasonCode: "DIRECT_RENT_FACT",
    confidence: 1,
    financialScope: "personal" as const,
    excerpt: "你已经签下个人租约，每月房租6000元。"
  }];
  const directStart: AcceptedFinancialEvent<"expense_commitment_started"> = {
    id: "direct_rent_event",
    proposalId: "direct_rent_proposal",
    kind: "expense_commitment_started",
    effectiveAtAgeInMonths: 360,
    payload: {
      id: "direct_primary_residence",
      type: "housing",
      displayName: "个人租房",
      monthlyAmountWan: 0.6,
      activeFromAgeInMonths: 360,
      status: "active",
      factStatus: "known",
      evidence,
      responsibilityKey: "primary_residence:main",
      responsibilityKind: "primary_residence",
      amountBasis: "explicit_known",
      amountSourceIds: ["direct_rent_6000"],
      financialScope: "personal",
      accrualReviewStatus: "normal",
      confirmedMonthlyAmountWan: 0.6,
      lastConfirmedAtAgeInMonths: 360,
      nextReviewAtAgeInMonths: 372
    },
    evidence,
    acceptedByReasonCodes: ["TEST_DIRECT_ACCEPTED_EXPENSE"]
  };
  const sameResidenceDerived = candidate({
    id: "derived_same_rent",
    financialScope: "personal",
    liability: "protagonist",
    explicitMonthlyTotalWan: 0.6,
    protagonistShareWan: 0.6,
    shareRate: undefined,
    amountSourceId: "narrative_rent_6000",
    participantPersonIds: [],
    source: "narrative_supplement",
    evidence: [{
      source: "accepted_simulation_outcome",
      reasonCode: "EXPENSE_HOUSING_NARRATIVE",
      confidence: 1,
      financialScope: "personal",
      excerpt: "你已经签下个人租约，每月房租6000元。"
    }]
  });
  const startPlan = reconcileExpenseCommitments({
    ledger: current,
    candidates: [sameResidenceDerived],
    acceptedExpenseEvents: [directStart],
    ageInMonths: 360,
    sourceOutcomeId: "direct_rent_outcome",
    mode: "enforced"
  });
  assert.equal(startPlan.proposals.some((proposal) => (
    proposal.kind === "expense_commitment_started"
    && (proposal.payload as { responsibilityKey?: string }).responsibilityKey === "primary_residence:main"
  )), false, "the lifecycle candidate must not mint a sibling housing account");
  assert.deepEqual(startPlan.ignoredCandidateIds, ["derived_same_rent"]);

  const started = reduceFinancialLedger({
    ledger: current,
    transactionId: "direct_same_node_start",
    expectedLedgerRevision: current.revision,
    periodStartAgeInMonths: 360,
    periodEndAgeInMonths: 360,
    events: [directStart]
  });
  if (started.alreadyCommitted) throw new Error("expected a new direct expense transaction");
  assert.equal(started.ledger.expenseCommitments.filter((commitment) => (
    commitment.status === "active" && commitment.responsibilityKey === "primary_residence:main"
  )).length, 1, "only the direct Accepted fact may accrue for this responsibility");
  assertFinancialLedgerInvariants(started.ledger);

  // The same guard also suppresses a stale scheduled review when the direct
  // fact changes or ends an account already present at node entry.
  const currentWithResidence = structuredClone(started.ledger) as ReturnType<typeof ledger>;
  const existing = currentWithResidence.expenseCommitments.find((commitment) => commitment.id === "direct_primary_residence")!;
  existing.nextReviewAtAgeInMonths = 360;
  const directAdjust: AcceptedFinancialEvent<"expense_commitment_adjusted"> = {
    id: "direct_rent_adjust_event",
    proposalId: "direct_rent_adjust_proposal",
    kind: "expense_commitment_adjusted",
    effectiveAtAgeInMonths: 360,
    payload: {
      expenseCommitmentId: existing.id,
      nextCommitment: { ...existing, monthlyAmountWan: 0.65, confirmedMonthlyAmountWan: 0.65, lastConfirmedAtAgeInMonths: 360, nextReviewAtAgeInMonths: 372 }
    },
    evidence,
    acceptedByReasonCodes: ["TEST_DIRECT_ACCEPTED_EXPENSE"]
  };
  const adjustPlan = reconcileExpenseCommitments({
    ledger: currentWithResidence,
    candidates: [{ ...sameResidenceDerived, id: "derived_same_rent_adjust", action: "adjust" }],
    acceptedExpenseEvents: [directAdjust],
    ageInMonths: 360,
    sourceOutcomeId: "direct_rent_adjust_outcome",
    mode: "enforced"
  });
  assert.equal(adjustPlan.proposals.some((proposal) => proposal.kind === "expense_commitment_adjusted"), false);
  assert.equal(adjustPlan.reviewEvents.some((event) => event.payload.expenseCommitmentId === existing.id), false);

  const directEnd: AcceptedFinancialEvent<"expense_commitment_ended"> = {
    id: "direct_rent_end_event",
    proposalId: "direct_rent_end_proposal",
    kind: "expense_commitment_ended",
    effectiveAtAgeInMonths: 360,
    payload: {
      expenseCommitmentId: existing.id,
      previousCommitmentId: existing.id,
      changeReason: "residence_ended"
    },
    evidence,
    acceptedByReasonCodes: ["TEST_DIRECT_ACCEPTED_EXPENSE"]
  };
  const endPlan = reconcileExpenseCommitments({
    ledger: currentWithResidence,
    candidates: [{ ...sameResidenceDerived, id: "derived_same_rent_end", action: "end", changeReason: "residence_ended" }],
    acceptedExpenseEvents: [directEnd],
    ageInMonths: 360,
    sourceOutcomeId: "direct_rent_end_outcome",
    mode: "enforced"
  });
  assert.equal(endPlan.proposals.some((proposal) => proposal.kind === "expense_commitment_ended"), false);
  assert.equal(endPlan.reviewEvents.some((event) => event.payload.expenseCommitmentId === existing.id), false);
});

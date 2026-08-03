import assert from "node:assert/strict";
import test from "node:test";
import type { WorldStateSnapshot } from "../../types";
import { initializeCareerState } from "../career/careerState";
import { deriveExpenseResponsibilityCandidates } from "./expenseResponsibility";
import { initializeFinancialLedger } from "./initializeLedger";
import { migrateFinancialLedgerV3ToV4 } from "./migrateFinancialLedgerV3ToV4";
import { reconcileExpenseCommitments } from "./reconcileExpenseCommitments";
import type { ExpenseCommitmentV4, FinancialLedgerV3 } from "./types";
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

function healthcareCommitment(overrides: Partial<ExpenseCommitmentV4> = {}): ExpenseCommitmentV4 {
  return {
    id: "opening_parent_healthcare",
    responsibilityKey: "recurring_healthcare:opening_parent",
    responsibilityKind: "recurring_healthcare",
    type: "healthcare",
    displayName: "父母医疗",
    monthlyAmountWan: 0.12,
    amountBasis: "explicit_known",
    amountSourceIds: ["opening"],
    financialScope: "personal",
    activeFromAgeInMonths: 300,
    status: "active",
    factStatus: "known",
    accrualReviewStatus: "normal",
    lastConfirmedAtAgeInMonths: 300,
    nextReviewAtAgeInMonths: 360,
    evidence: [],
    ...overrides
  };
}

test("E-09 cohabitation is a structured review of basic and housing, not a generic household charge", () => {
  const current = world({ relationships: [{
    id: "romance", participantPersonIds: ["partner"], type: "romantic", stage: "dating", status: "active",
    livingTogether: false, effectiveFromAgeInMonths: 360, source: "accepted_history", confidence: 1
  }] });
  const candidate = world({ relationships: [{
    id: "romance", participantPersonIds: ["partner"], type: "romantic", stage: "cohabiting", status: "active",
    livingTogether: true, effectiveFromAgeInMonths: 384, responsibilitySummary: "双方已确认共同居住", source: "accepted_history", confidence: 1
  }] });
  const result = deriveExpenseResponsibilityCandidates({ currentWorldState: current, candidateWorldState: candidate, ageInMonths: 384 });
  assert.deepEqual(result.candidates.map((item) => [item.responsibilityKey, item.action, item.proposedType]), [
    ["adult_basic_living:protagonist", "review", "basic_living"],
    ["primary_residence:main", "review", "housing"]
  ]);
  assert.equal(result.candidates.some((item) => item.responsibilityKey.includes("household_transition")), false);
});

test("accepted residence state is the primary start/adjust path and does not require a narrative rent regex", () => {
  const initial = deriveExpenseResponsibilityCandidates({
    currentWorldState: world(),
    candidateWorldState: world({
      residence: {
        livingArrangement: "renting",
        financialScope: "personal",
        liability: "protagonist",
        evidence: "已签订租约并搬入新住所。",
        effectiveFromAgeInMonths: 420,
        source: "accepted_history"
      }
    }),
    ageInMonths: 420
  });
  assert.deepEqual(initial.candidates.map((item) => [
    item.responsibilityKey, item.action, item.financialScope, item.liability, item.source
  ]), [["primary_residence:main", "start", "personal", "protagonist", "accepted_world_delta"]]);

  const current = world({
    residence: {
      livingArrangement: "renting",
      financialScope: "personal",
      liability: "protagonist",
      evidence: "此前个人租住。",
      effectiveFromAgeInMonths: 400,
      source: "accepted_history"
    }
  });
  const movedToSharedHome = deriveExpenseResponsibilityCandidates({
    currentWorldState: current,
    candidateWorldState: world({
      residence: {
        livingArrangement: "renting",
        financialScope: "shared_household",
        liability: "shared",
        evidence: "已搬入共同租住的住所。",
        effectiveFromAgeInMonths: 420,
        source: "accepted_history"
      }
    }),
    ageInMonths: 420
  });
  assert.deepEqual(movedToSharedHome.candidates.map((item) => [
    item.responsibilityKey, item.action, item.financialScope, item.liability
  ]), [["primary_residence:main", "adjust", "shared_household", "shared"]]);
});

test("E-10 a completed child-support responsibility creates a nonzero reviewable candidate, while a plan does not", () => {
  const completed = deriveExpenseResponsibilityCandidates({
    ageInMonths: 400,
    narrativeText: "你们已经开始承担育儿安排。"
  });
  assert.equal(completed.candidates[0]?.responsibilityKey, "child_support:unidentified");
  assert.equal(completed.candidates[0]?.liability, "shared");
  assert.equal(completed.candidates[0]?.financialScope, "shared_household");
  const planned = deriveExpenseResponsibilityCandidates({
    ageInMonths: 400,
    narrativeText: "你们计划明年要孩子，也在讨论育儿安排。"
  });
  assert.equal(planned.candidates.length, 0);
});

test("narrative supplements require an explicit protagonist or shared payer before creating a recurring personal responsibility", () => {
  const partnerRent = deriveExpenseResponsibilityCandidates({
    ageInMonths: 420,
    narrativeText: "伴侣每月支付房租5000元。"
  });
  assert.deepEqual(partnerRent.candidates.map((item) => [item.financialScope, item.liability]), [
    ["third_party", "third_party"]
  ]);

  const parentTreatment = deriveExpenseResponsibilityCandidates({
    ageInMonths: 89 * 12,
    narrativeText: "父亲长期治疗，每月复诊1200元。"
  });
  assert.deepEqual(parentTreatment.candidates.map((item) => [item.action, item.liability, item.responsibilityKey]), [
    ["review", "unknown", "recurring_healthcare:protagonist"]
  ]);

  const personalTreatment = deriveExpenseResponsibilityCandidates({
    ageInMonths: 89 * 12,
    narrativeText: "你继续每月复诊并长期用药1200元。"
  });
  assert.deepEqual(personalTreatment.candidates.map((item) => [item.action, item.liability, item.protagonistShareWan]), [
    ["start", "protagonist", 0.12]
  ]);
});

test("completed personal rent and shared parent care are classified as responsibility candidates", () => {
  const rent = deriveExpenseResponsibilityCandidates({
    ageInMonths: 420,
    narrativeText: "我每月月租1200元，虽然紧张也咬牙付了。"
  }).candidates;
  assert.deepEqual(rent.map((item) => [item.responsibilityKey, item.action, item.liability, item.protagonistShareWan]), [
    ["primary_residence:main", "start", "protagonist", 0.12]
  ]);

  const care = deriveExpenseResponsibilityCandidates({
    ageInMonths: 480,
    narrativeText: "你们开始每月固定给双方父母生活费，也轮流接送父母就医。"
  }).candidates;
  assert.deepEqual(care.map((item) => [item.responsibilityKey, item.action, item.liability, item.financialScope]), [
    ["elder_care:parents", "start", "shared", "shared_household"]
  ]);
  assert.equal(care[0]?.protagonistShareWan, undefined);
});

test("a mixed salary, rent and parent-medical sentence binds each recurring outlay to its own amount", () => {
  const candidates = deriveExpenseResponsibilityCandidates({
    ageInMonths: 288,
    existingExpenseCommitments: [healthcareCommitment({
      factStatus: "needs_review",
      amountBasis: "contextual_estimate"
    })],
    narrativeText: "正式入职后，你的月薪从原来的2.5万元降至1.5万元，年终奖也大幅缩水，每月扣除房租3500元和父母医疗费用约1200元后，现金流明显紧张。"
  }).candidates;
  assert.deepEqual(candidates.map((item) => [
    item.responsibilityKey,
    item.proposedType,
    item.action,
    item.liability,
    item.protagonistShareWan
  ]), [
    ["primary_residence:main", "housing", "start", "protagonist", 0.35],
    ["recurring_healthcare:opening_parent", "healthcare", "adjust", "protagonist", 0.12]
  ]);
  assert.equal(candidates.some((item) => item.protagonistShareWan === 2.5), false);
  assert.equal(candidates.some((item) => item.responsibilityKind === "elder_care"), false);
});

test("local rent and parent-health frequencies are monthlyized without borrowing the salary cadence", () => {
  const annual = deriveExpenseResponsibilityCandidates({
    ageInMonths: 288,
    narrativeText: "正式入职后，你的月薪2.5万元，我每年承担房租12万元和父母医疗年支出1.2万元。"
  }).candidates;
  assert.deepEqual(annual.map((item) => [
    item.responsibilityKey, item.protagonistShareWan
  ]), [
    ["primary_residence:main", 1],
    ["recurring_healthcare:parents", 0.1]
  ]);

  const quarterly = deriveExpenseResponsibilityCandidates({
    ageInMonths: 288,
    narrativeText: "我每季度承担房租3万元。"
  }).candidates;
  assert.deepEqual(quarterly.map((item) => [
    item.responsibilityKey, item.protagonistShareWan
  ]), [["primary_residence:main", 1]]);
});

test("a named parent reuses the unique canonical opening healthcare responsibility", () => {
  const candidateWorldState = world({ people: [{
    id: "mother", displayName: "母亲", relation: "parent", lifeStatus: "active", healthStatus: "stable",
    source: "accepted_history", confidence: 1
  }] });
  const existing = healthcareCommitment({
    monthlyAmountWan: 0.1,
    factStatus: "needs_review",
    amountBasis: "contextual_estimate",
    estimationPolicyId: "test_parent_healthcare"
  });
  const candidates = deriveExpenseResponsibilityCandidates({
    ageInMonths: 288,
    candidateWorldState,
    existingExpenseCommitments: [existing],
    narrativeText: "你的月薪从原来的2.5万元降至1.5万元，每月扣除房租3500元和母亲医疗费用约1200元后，现金流明显紧张。"
  }).candidates;
  assert.deepEqual(candidates.map((item) => [
    item.responsibilityKey, item.action, item.protagonistShareWan
  ]), [
    ["primary_residence:main", "start", 0.35],
    ["recurring_healthcare:opening_parent", "adjust", 0.12]
  ]);

  const current = migrateFinancialLedgerV3ToV4(initializeFinancialLedger({
    id: "opening_parent_reuse", asOfAgeInMonths: 288
  }) as FinancialLedgerV3);
  current.expenseCommitments.push(existing);
  const reconciled = reconcileExpenseCommitments({
    ledger: current,
    candidates,
    ageInMonths: 288,
    sourceOutcomeId: "opening_parent_reuse",
    mode: "enforced"
  });
  const healthcareStarts = reconciled.proposals.filter((proposal) => (
    proposal.kind === "expense_commitment_started"
    && (proposal.payload as ExpenseCommitmentV4).responsibilityKind === "recurring_healthcare"
  ));
  assert.equal(healthcareStarts.length, 0);
  const healthcareAdjustment = reconciled.proposals.find((proposal) => (
    proposal.kind === "expense_commitment_adjusted"
    && (proposal.payload as { expenseCommitmentId?: string }).expenseCommitmentId === existing.id
  ));
  assert.ok(healthcareAdjustment);
});

test("plural care and medication prose remain review-only until an Accepted shared amount proves the protagonist share", () => {
  const cases = [
    "你们每周共同陪诊母亲。我们轮流照护父母。",
    "你们每天按时服药。"
  ] as const;
  for (const narrativeText of cases) {
    const candidates = deriveExpenseResponsibilityCandidates({
      ageInMonths: 74 * 12,
      narrativeText
    }).candidates;
    assert.ok(candidates.length > 0, `${narrativeText} should remain auditable as a responsibility observation`);
    assert.equal(candidates.some((candidate) => (
      candidate.financialScope === "personal"
      && candidate.liability === "protagonist"
      && candidate.action === "start"
    )), false, `${narrativeText} must not impersonate an individual protagonist responsibility`);
    assert.equal(candidates.every((candidate) => (
      candidate.financialScope === "shared_household"
      && candidate.liability === "shared"
      && candidate.protagonistShareWan === undefined
    )), true, `${narrativeText} must retain only an amount-unknown shared observation`);

    const current = migrateFinancialLedgerV3ToV4(initializeFinancialLedger({
      id: `plural_shared_${candidates[0]?.responsibilityKey.replace(/[^a-zA-Z0-9:_-]/gu, "_")}`,
      asOfAgeInMonths: 74 * 12
    }) as FinancialLedgerV3);
    const result = reconcileExpenseCommitments({
      ledger: current,
      candidates,
      ageInMonths: 74 * 12,
      sourceOutcomeId: "plural_shared_narrative",
      mode: "enforced"
    });
    assert.equal(result.proposals.some((proposal) => proposal.kind === "expense_commitment_started"), false,
      `${narrativeText} must not create an unsupported active commitment`);
    assert.equal(result.issues.some((item) => item.code === "EXPENSE_RESPONSIBILITY_SCOPE_CONFLICT"), true,
      `${narrativeText} must remain visible for an Accepted-share follow-up`);
  }
});

test("a material joint caregiver total blocks until prose gives the protagonist share, then creates a reviewable split", () => {
  const ageInMonths = 33 * 12 + 7;
  const withoutShare = deriveExpenseResponsibilityCandidates({
    ageInMonths,
    narrativeText: "你和伴侣商量后，决定请一个白班阿姨，每周来三天，帮忙做饭和打扫，减轻两边老人的负担。这笔开销不小，你算了算，每月要多支出三千多元，但暂时还能承受。"
  }).candidates;
  assert.deepEqual(withoutShare.map((item) => [
    item.responsibilityKey,
    item.responsibilityKind,
    item.proposedType,
    item.financialScope,
    item.liability,
    item.explicitMonthlyTotalWan,
    item.protagonistShareWan,
    item.shareRate
  ]), [["elder_care:parents", "elder_care", "dependent_support", "shared_household", "shared", 0.3, undefined, undefined]]);
  assert.match(withoutShare[0]?.evidence[0]?.excerpt || "", /白班阿姨/u);
  assert.match(withoutShare[0]?.evidence[0]?.excerpt || "", /三千多/u);

  const withoutShareResult = reconcileExpenseCommitments({
    ledger: migrateFinancialLedgerV3ToV4(initializeFinancialLedger({
      id: "joint_caregiver_without_share", asOfAgeInMonths: ageInMonths
    }) as FinancialLedgerV3),
    candidates: withoutShare,
    ageInMonths,
    sourceOutcomeId: "joint_caregiver_without_share",
    mode: "enforced"
  });
  assert.equal(withoutShareResult.proposals.length, 0);
  assert.equal(withoutShareResult.wouldBlock, true);
  assert.deepEqual(withoutShareResult.issues.map((item) => [item.code, item.severity]), [
    ["EXPENSE_RESPONSIBILITY_SCOPE_CONFLICT", "blocking"]
  ]);
  assert.equal(withoutShareResult.candidateDecisions[0]?.disposition, "blocked");
  assert.equal(withoutShareResult.candidateDecisions[0]?.wouldBlock, true);

  const exactSplit = deriveExpenseResponsibilityCandidates({
    ageInMonths,
    narrativeText: "你和伴侣决定请一个白班阿姨，每周来三天照顾双方老人。每月费用3000元，两人各承担一半。"
  }).candidates;
  assert.deepEqual(exactSplit.map((item) => [
    item.explicitMonthlyTotalWan,
    item.protagonistShareWan,
    item.shareRate,
    item.source
  ]), [[0.3, 0.15, 0.5, "narrative_supplement"]]);
  const exactSplitResult = reconcileExpenseCommitments({
    ledger: migrateFinancialLedgerV3ToV4(initializeFinancialLedger({
      id: "joint_caregiver_exact_split", asOfAgeInMonths: ageInMonths
    }) as FinancialLedgerV3),
    candidates: exactSplit,
    ageInMonths,
    sourceOutcomeId: "joint_caregiver_exact_split",
    mode: "enforced"
  });
  const commitment = exactSplitResult.proposals.find((item) => item.kind === "expense_commitment_started")?.payload as ExpenseCommitmentV4 | undefined;
  assert.equal(exactSplitResult.wouldBlock, false);
  assert.equal(commitment?.monthlyAmountWan, 0.15);
  assert.equal(commitment?.grossMonthlyAmountWan, 0.3);
  assert.equal(commitment?.householdShareRate, 0.5);
  assert.equal(commitment?.factStatus, "needs_review");
  assert.equal(commitment?.amountBasis, "last_known");
});

test("fresh release responsibility phrases retain their payer, direction, and responsibility type", () => {
  const openingParent = world({ people: [{
    id: "opening_parent", relation: "parent", lifeStatus: "active", healthStatus: "stable",
    source: "accepted_history", confidence: 1
  }] });
  const medical = deriveExpenseResponsibilityCandidates({
    candidateWorldState: openingParent,
    existingExpenseCommitments: [healthcareCommitment()],
    ageInMonths: 417,
    narrativeText: "你主动把每月医疗补贴从1200元提到1500元。"
  }).candidates;
  assert.deepEqual(medical.map((item) => [
    item.responsibilityKey, item.action, item.proposedType, item.financialScope, item.protagonistShareWan
  ]), [["recurring_healthcare:opening_parent", "adjust", "healthcare", "personal", 0.15]]);

  const householdCare = deriveExpenseResponsibilityCandidates({
    ageInMonths: 480,
    narrativeText: "给家里请了一位每周来三次的钟点工，负责打扫和做晚饭，每月多出两千四的固定开销。"
  }).candidates;
  assert.deepEqual(householdCare.map((item) => [
    item.responsibilityKey, item.action, item.proposedType, item.financialScope, item.protagonistShareWan
  ]), [["elder_care:parents", "start", "dependent_support", "personal", 0.24]]);

  const renewal = deriveExpenseResponsibilityCandidates({
    ageInMonths: 360,
    narrativeText: "年初刚续租了公司附近的房子。"
  }).candidates;
  assert.deepEqual(renewal.map((item) => [
    item.responsibilityKey, item.action, item.proposedType, item.financialScope
  ]), [["primary_residence:main", "start", "housing", "personal"]]);
});

test("medical subsidy requires both a protagonist payer and one accepted parent-health target", () => {
  const openingParent = world({ people: [{
    id: "opening_parent", relation: "parent", lifeStatus: "active", healthStatus: "stable",
    source: "accepted_history", confidence: 1
  }] });
  const noTarget = deriveExpenseResponsibilityCandidates({
    candidateWorldState: openingParent,
    ageInMonths: 417,
    narrativeText: "你主动把每月医疗补贴从1200元提到1500元。"
  }).candidates;
  assert.equal(noTarget.length, 0);

  const companyBenefit = deriveExpenseResponsibilityCandidates({
    candidateWorldState: openingParent,
    ageInMonths: 417,
    narrativeText: "公司把每月医疗补贴从1200元提到1500元。"
  }).candidates;
  assert.equal(companyBenefit.length, 0);
});

test("medical subsidy never retargets a child, ambiguous parent, paused, or ended healthcare commitment", () => {
  const parent = {
    id: "mother", relation: "parent" as const, lifeStatus: "active" as const, healthStatus: "stable" as const,
    source: "accepted_history" as const, confidence: 1
  };
  const child = {
    id: "child", relation: "child" as const, lifeStatus: "active" as const, healthStatus: "stable" as const,
    source: "accepted_history" as const, confidence: 1
  };
  const singleParentWorld = world({ people: [parent, child] });
  const narrativeText = "你主动把每月医疗补贴从1200元提到1500元。";
  const childOnly = deriveExpenseResponsibilityCandidates({
    candidateWorldState: singleParentWorld,
    existingExpenseCommitments: [healthcareCommitment({
      id: "child_healthcare",
      responsibilityKey: "recurring_healthcare:child",
      participantPersonIds: ["child"]
    })],
    ageInMonths: 417,
    narrativeText
  }).candidates;
  assert.equal(childOnly.some((candidate) => (
    candidate.responsibilityKind === "recurring_healthcare" && candidate.action === "adjust"
  )), false);

  const twoParents = world({ people: [
    parent,
    { ...parent, id: "father" }
  ] });
  const ambiguous = deriveExpenseResponsibilityCandidates({
    candidateWorldState: twoParents,
    existingExpenseCommitments: [
      healthcareCommitment({ id: "mother_healthcare", responsibilityKey: "recurring_healthcare:mother", participantPersonIds: ["mother"] }),
      healthcareCommitment({ id: "father_healthcare", responsibilityKey: "recurring_healthcare:father", participantPersonIds: ["father"] })
    ],
    ageInMonths: 417,
    narrativeText
  }).candidates;
  assert.equal(ambiguous.some((candidate) => (
    candidate.responsibilityKind === "recurring_healthcare" && candidate.action === "adjust"
  )), false);

  for (const commitment of [
    healthcareCommitment({ status: "paused" }),
    healthcareCommitment({ status: "ended", activeUntilAgeInMonths: 416 })
  ]) {
    const result = deriveExpenseResponsibilityCandidates({
      candidateWorldState: singleParentWorld,
      existingExpenseCommitments: [commitment],
      ageInMonths: 417,
      narrativeText
    }).candidates;
    assert.equal(result.some((candidate) => (
      candidate.responsibilityKind === "recurring_healthcare" && candidate.action === "adjust"
    )), false, `${commitment.status} parent healthcare must not be an adjustment target`);
  }
});

test("parent care wording preserves personal responsibility without inventing insurance or a third-party bill", () => {
  const review = deriveExpenseResponsibilityCandidates({
    ageInMonths: 89 * 12,
    narrativeText: "父亲血压偏高需要长期监测，医生开了降压药。为了更好照顾父母，我调整了每月回家的频率。"
  }).candidates;
  assert.deepEqual(review.map((item) => [item.responsibilityKey, item.action, item.proposedType, item.financialScope]), [
    ["elder_care:parents", "review", "dependent_support", "personal"]
  ]);

  const start = deriveExpenseResponsibilityCandidates({
    ageInMonths: 100 * 12,
    narrativeText: "父母已过百岁，虽身体尚可，但已需要更多照料。你每隔几周会去看望他们，或请人帮忙照看。"
  }).candidates;
  assert.deepEqual(start.map((item) => [item.responsibilityKey, item.action, item.proposedType, item.financialScope]), [
    ["elder_care:parents", "start", "dependent_support", "personal"]
  ]);

  const increase = deriveExpenseResponsibilityCandidates({
    ageInMonths: 91 * 12,
    narrativeText: "父母已过百岁，请人照护的费用逐年增加。"
  }).candidates;
  assert.deepEqual(increase.map((item) => [item.responsibilityKey, item.action, item.proposedType, item.financialScope]), [
    ["elder_care:parents", "review", "dependent_support", "personal"]
  ]);
  assert.equal([...review, ...start, ...increase].some((item) => item.proposedType === "insurance"), false);
});

test("a repeated first-person parent-care routine creates a nonzero reviewable care commitment without inventing a known payment", () => {
  const parents = world({ people: [{
    id: "mother", displayName: "母亲", relation: "parent", lifeStatus: "limited", healthStatus: "care_dependent",
    source: "accepted_history", confidence: 1
  }] });
  const candidates = deriveExpenseResponsibilityCandidates({
    ageInMonths: 74 * 12,
    candidateWorldState: parents,
    narrativeText: "母亲每周五去县医院做理疗，你陪着她在候诊室等。"
  }).candidates;
  const care = candidates.find((item) => item.responsibilityKey === "elder_care:mother");
  assert.deepEqual(care && [care.action, care.liability, care.financialScope, care.protagonistShareWan], [
    "start", "protagonist", "personal", undefined
  ]);

  const current = migrateFinancialLedgerV3ToV4(initializeFinancialLedger({
    id: "recurring_parent_care", asOfAgeInMonths: 74 * 12
  }) as FinancialLedgerV3);
  const reconciliation = reconcileExpenseCommitments({
    ledger: current,
    candidates,
    ageInMonths: 74 * 12,
    sourceOutcomeId: "weekly_parent_therapy",
    mode: "enforced"
  });
  const commitment = reconciliation.proposals.find((proposal) => proposal.kind === "expense_commitment_started")?.payload as ExpenseCommitmentV4;
  assert.equal(commitment.responsibilityKey, "elder_care:mother");
  assert.equal(commitment.monthlyAmountWan, 0.2);
  assert.equal(commitment.factStatus, "needs_review");
  assert.equal(commitment.amountBasis, "contextual_estimate");

  const deduped = deriveExpenseResponsibilityCandidates({
    ageInMonths: 74 * 12,
    narrativeText: "父母每周都需要更多照护。你每周固定陪父母去理疗。父母血压偏高，需要长期监测。"
  }).candidates;
  assert.deepEqual(deduped.map((item) => [item.responsibilityKey, item.action, item.liability]), [
    ["elder_care:parents", "start", "protagonist"]
  ]);

  const thirdParty = deriveExpenseResponsibilityCandidates({
    ageInMonths: 74 * 12,
    narrativeText: "父亲自己承担全部理疗费用，你每周陪他去医院。"
  }).candidates[0];
  assert.deepEqual(thirdParty && [thirdParty.liability, thirdParty.financialScope], ["third_party", "third_party"]);

  const unrelatedCare = deriveExpenseResponsibilityCandidates({
    ageInMonths: 74 * 12,
    narrativeText: "父亲长期监测血压。你每周照料家里的猫。"
  }).candidates;
  assert.equal(unrelatedCare.some((item) => (
    item.responsibilityKind === "elder_care"
    && item.action === "start"
    && item.liability === "protagonist"
  )), false, "an unrelated care verb must not inherit a parent-care payer");
});

test("regular parent checkups start timely and a later completed high-intensity routine requests only an upward contextual review", () => {
  const firstCareText = "你定期带父母去县医院做全面体检，报告显示他们身体状况尚可。";
  const firstCare = deriveExpenseResponsibilityCandidates({
    ageInMonths: 58 * 12,
    narrativeText: firstCareText
  }).candidates;
  assert.deepEqual(firstCare.map((item) => [
    item.responsibilityKey,
    item.action,
    item.liability,
    item.financialScope,
    item.policyEstimateAdjustment
  ]), [["elder_care:parents", "start", "protagonist", "personal", undefined]]);

  const current = migrateFinancialLedgerV3ToV4(initializeFinancialLedger({
    id: "regular_parent_checkups",
    asOfAgeInMonths: 58 * 12
  }) as FinancialLedgerV3);
  const started = reconcileExpenseCommitments({
    ledger: current,
    candidates: firstCare,
    ageInMonths: 58 * 12,
    sourceOutcomeId: "regular_parent_checkups",
    mode: "enforced"
  }).proposals.find((proposal) => proposal.kind === "expense_commitment_started")?.payload as ExpenseCommitmentV4 | undefined;
  assert.ok(started);
  assert.equal(started.monthlyAmountWan, 0.2);
  assert.equal(started.factStatus, "needs_review");
  assert.equal(started.amountBasis, "contextual_estimate");
  current.expenseCommitments.push(started);

  const escalationText = "父亲膝盖的退行性变化需要持续关注。你每天早晚帮他做一轮轻柔的关节活动，并记录下他的血压和膝盖状况。";
  const escalation = deriveExpenseResponsibilityCandidates({
    ageInMonths: 66 * 12 + 8,
    narrativeText: escalationText,
    existingExpenseCommitments: current.expenseCommitments
  }).candidates;
  assert.deepEqual(escalation.map((item) => [
    item.responsibilityKey,
    item.action,
    item.liability,
    item.financialScope,
    item.policyEstimateAdjustment
  ]), [["elder_care:parents", "adjust", "protagonist", "personal", "increase_only"]]);
  const uplift = reconcileExpenseCommitments({
    ledger: current,
    candidates: escalation,
    ageInMonths: 66 * 12 + 8,
    sourceOutcomeId: "parent_care_intensity_escalated",
    mode: "enforced"
  }).proposals.find((proposal) => proposal.kind === "expense_commitment_adjusted")?.payload as { nextCommitment?: ExpenseCommitmentV4 } | undefined;
  assert.ok(uplift?.nextCommitment);
  assert.equal(uplift.nextCommitment.monthlyAmountWan, 0.35);
  assert.equal(uplift.nextCommitment.amountBasis, "contextual_estimate");
  assert.equal(uplift.nextCommitment.factStatus, "needs_review");
  assert.ok(uplift.nextCommitment.evidence.some((item) => item.reasonCode === "EXPENSE_CONTEXTUAL_UPLIFT_ELEVATED_CARE"));

  const oneOff = deriveExpenseResponsibilityCandidates({
    ageInMonths: 66 * 12 + 9,
    narrativeText: "母亲腰疼，你陪她做了两次理疗。",
    existingExpenseCommitments: current.expenseCommitments
  }).candidates;
  assert.equal(oneOff.some((item) => item.policyEstimateAdjustment === "increase_only"), false, "a one-off treatment cannot raise a recurring care estimate");

  const namedMotherOnly: ExpenseCommitmentV4 = {
    ...structuredClone(started),
    id: "contextual_mother_only",
    responsibilityKey: "elder_care:mother",
    participantPersonIds: ["mother"]
  };
  const fatherCannotRetargetMother = deriveExpenseResponsibilityCandidates({
    ageInMonths: 66 * 12 + 8,
    narrativeText: escalationText,
    existingExpenseCommitments: [namedMotherOnly]
  }).candidates;
  assert.equal(fatherCannotRetargetMother.some((item) => (
    item.responsibilityKey === "elder_care:mother" && item.policyEstimateAdjustment === "increase_only"
  )), false, "father care cannot retarget the sole mother's contextual account");

  const carePlanOnly: ExpenseCommitmentV4 = {
    ...structuredClone(started),
    id: "contextual_care_plan_only",
    responsibilityKey: "elder_care:care_plan"
  };
  const fatherCannotRetargetCarePlan = deriveExpenseResponsibilityCandidates({
    ageInMonths: 66 * 12 + 8,
    narrativeText: escalationText,
    existingExpenseCommitments: [carePlanOnly]
  }).candidates;
  assert.equal(fatherCannotRetargetCarePlan.some((item) => item.policyEstimateAdjustment === "increase_only"), false, "parent-care evidence cannot target an unrelated care-plan account");
});

test("an ongoing first-person medication routine creates the older-adult healthcare estimate, while age alone remains insufficient", () => {
  const candidates = deriveExpenseResponsibilityCandidates({
    ageInMonths: 91 * 12,
    narrativeText: "你不再计算未来的年岁，只按时服药，偶尔散步。"
  }).candidates;
  assert.deepEqual(candidates.map((item) => [item.responsibilityKey, item.action, item.liability]), [
    ["recurring_healthcare:protagonist", "start", "protagonist"]
  ]);

  const current = migrateFinancialLedgerV3ToV4(initializeFinancialLedger({
    id: "older_adult_medication", asOfAgeInMonths: 91 * 12
  }) as FinancialLedgerV3);
  const reconciliation = reconcileExpenseCommitments({
    ledger: current,
    candidates,
    ageInMonths: 91 * 12,
    sourceOutcomeId: "ongoing_medication",
    mode: "enforced"
  });
  const commitment = reconciliation.proposals.find((proposal) => proposal.kind === "expense_commitment_started")?.payload as ExpenseCommitmentV4;
  assert.equal(commitment.responsibilityKey, "recurring_healthcare:protagonist");
  assert.equal(commitment.monthlyAmountWan, 0.24);
  assert.equal(commitment.factStatus, "needs_review");

  for (const sentence of ["你提醒父亲按时服药。", "你建议母亲按时服药。", "你陪父亲按时服药。"] as const) {
    const otherPersonsMedication = deriveExpenseResponsibilityCandidates({
      ageInMonths: 91 * 12,
      narrativeText: sentence
    }).candidates;
    assert.equal(otherPersonsMedication.some((item) => (
      item.responsibilityKey === "recurring_healthcare:protagonist"
      && item.action === "start"
      && item.liability === "protagonist"
    )), false, `${sentence} is not the protagonist's own recurring medication`);
  }
});

test("an accepted parent-care trial with an explicit payer keeps the named caregiver fee as personal elder care", () => {
  // This is intentionally narrative-only: it remains available as the
  // lifecycle fallback when a model-proposed expense is schema-rejected.
  const narrativeText = [
    "73岁4个月，你决定试着说服父母接受每周两次的钟点工服务，费用由你承担，先试一个月。",
    "母亲犹豫后点头，父亲虽摆手但未再坚持。",
    "钟点工王姐是县城熟人介绍的，做事利落，第一次上门就帮母亲做了顿软烂的晚饭。",
    "王姐的费用每月1200元，你在心里盘算，若能固定下来，或许能减轻母亲的劳累。"
  ].join("");
  const candidates = deriveExpenseResponsibilityCandidates({
    ageInMonths: 73 * 12 + 4,
    narrativeText
  }).candidates;
  assert.deepEqual(candidates.map((item) => [
    item.responsibilityKey,
    item.responsibilityKind,
    item.action,
    item.financialScope,
    item.liability,
    item.cadence,
    item.protagonistShareWan
  ]), [["elder_care:parents", "elder_care", "start", "personal", "protagonist", "monthly", 0.12]]);
  assert.equal(candidates[0]?.evidence[0]?.reasonCode, "EXPENSE_EXPLICIT_PARENT_CARE_NARRATIVE");

  const ageInMonths = 73 * 12 + 4;
  const ledger = migrateFinancialLedgerV3ToV4(initializeFinancialLedger({
    id: "narrative_only_parent_care",
    asOfAgeInMonths: ageInMonths
  }) as FinancialLedgerV3);
  const reconciliation = reconcileExpenseCommitments({
    ledger,
    candidates,
    ageInMonths,
    sourceOutcomeId: "parent_care_outcome",
    mode: "enforced"
  });
  const validation = validateFinancialProposals({
    proposals: reconciliation.proposals,
    currentLedger: ledger,
    currentCareerState: initializeCareerState({
      id: "parent_care_not_working",
      employmentStatus: "not_working",
      effectiveFromAgeInMonths: ageInMonths
    }),
    acceptedOutcomeId: "parent_care_outcome",
    narrativeText,
    periodStartAgeInMonths: ageInMonths,
    periodEndAgeInMonths: ageInMonths + 1,
    simulationTransactionId: "narrative_only_parent_care_transaction"
  });
  assert.deepEqual(validation.issues, []);
  assert.deepEqual(validation.acceptedEvents.map((event) => [
    event.kind,
    event.kind === "expense_commitment_started" ? event.payload.responsibilityKey : undefined,
    event.kind === "expense_commitment_started" ? event.payload.monthlyAmountWan : undefined
  ]), [["expense_commitment_started", "elder_care:parents", 0.12]]);

  const parentPaid = deriveExpenseResponsibilityCandidates({
    ageInMonths: 73 * 12 + 4,
    narrativeText: "父母决定请每周两次的钟点工服务，费用由父母承担，每月1200元。"
  }).candidates;
  assert.equal(parentPaid.some((item) => item.liability === "protagonist" && item.responsibilityKind === "elder_care"), false);

  const business = deriveExpenseResponsibilityCandidates({
    ageInMonths: 73 * 12 + 4,
    narrativeText: "公司工作室为父母安排每周两次的钟点工服务，费用由你承担，每月1200元。"
  }).candidates;
  assert.equal(business.some((item) => item.financialScope === "personal" && item.responsibilityKind === "elder_care"), false);
});

test("income and prose-boundary phrases cannot manufacture personal insurance or housing expenses", () => {
  const consultant = deriveExpenseResponsibilityCandidates({
    ageInMonths: 435,
    narrativeText: "36岁10月，你继续保持电子元器件客户的顾问工作，每月1.4万元顾问费勉强维持着生活。"
  }).candidates;
  assert.equal(consultant.length, 0);

  const rentalIncome = deriveExpenseResponsibilityCandidates({
    ageInMonths: 737,
    narrativeText: "接受母亲的提议后，你协助她把老家的房子租了出去，租金定期转入她的账户。"
  }).candidates;
  assert.equal(rentalIncome.length, 0);

  const reflection = deriveExpenseResponsibilityCandidates({
    ageInMonths: 100 * 12,
    narrativeText: "你开始思考，是继续保持现状，还是做出一些微小的调整，让自己在平静中仍能感受到意义。"
  }).candidates;
  assert.equal(reflection.length, 0);

  const actualRenewal = deriveExpenseResponsibilityCandidates({
    ageInMonths: 500,
    narrativeText: "你今年续保了医疗险，每年保费3600元。"
  }).candidates;
  assert.deepEqual(actualRenewal.map((item) => [item.responsibilityKey, item.proposedType, item.action]), [
    ["personal_insurance:main", "insurance", "start"]
  ]);
});

test("a renewed business contract cannot be mistaken for a personal housing renewal", () => {
  const businessRevenue = deriveExpenseResponsibilityCandidates({
    ageInMonths: 33 * 12 + 2,
    narrativeText: "两家客户都续签了年度合同，还各转介绍了一家企业，公司年化经常性收入突破90万元。"
  }).candidates;
  assert.deepEqual(businessRevenue, []);

  const residenceRenewal = deriveExpenseResponsibilityCandidates({
    ageInMonths: 33 * 12 + 2,
    narrativeText: "你已续签公寓租约，房租仍为每月3000元。"
  }).candidates;
  assert.equal(residenceRenewal.some((item) => (
    item.responsibilityKey === "primary_residence:main"
    && item.proposedType === "housing"
  )), true);
});

test("a fixed monthly parent transfer becomes a validator-accepted personal responsibility", () => {
  const ageInMonths = 303;
  const narrativeText = "父母的身体状况相对稳定，你每月固定转给他们三千元作为医疗和日常开销。";
  const candidates = deriveExpenseResponsibilityCandidates({ ageInMonths, narrativeText }).candidates;
  assert.deepEqual(candidates.map((item) => [
    item.responsibilityKey,
    item.responsibilityKind,
    item.action,
    item.protagonistShareWan
  ]), [["elder_care:parents", "elder_care", "start", 0.3]]);

  const ledger = migrateFinancialLedgerV3ToV4(initializeFinancialLedger({
    id: "fixed_monthly_parent_transfer",
    asOfAgeInMonths: ageInMonths
  }) as FinancialLedgerV3);
  const reconciliation = reconcileExpenseCommitments({
    ledger,
    candidates,
    ageInMonths,
    sourceOutcomeId: "fixed_monthly_parent_transfer_outcome",
    mode: "enforced"
  });
  const validation = validateFinancialProposals({
    proposals: reconciliation.proposals,
    currentLedger: ledger,
    currentCareerState: initializeCareerState({
      id: "fixed_monthly_parent_transfer_career",
      employmentStatus: "not_working",
      effectiveFromAgeInMonths: ageInMonths
    }),
    acceptedOutcomeId: "fixed_monthly_parent_transfer_outcome",
    narrativeText,
    periodStartAgeInMonths: ageInMonths,
    periodEndAgeInMonths: ageInMonths + 1,
    simulationTransactionId: "fixed_monthly_parent_transfer_transaction"
  });
  assert.deepEqual(validation.issues, []);
  assert.deepEqual(validation.acceptedEvents.map((event) => [
    event.kind,
    event.kind === "expense_commitment_started" ? event.payload.responsibilityKey : undefined,
    event.kind === "expense_commitment_started" ? event.payload.monthlyAmountWan : undefined
  ]), [["expense_commitment_started", "elder_care:parents", 0.3]]);
});

test("an already-occupied residence with a next-month rent bill is protagonist housing, not an unknown-owner review", () => {
  const rent = deriveExpenseResponsibilityCandidates({
    ageInMonths: 23 * 12,
    narrativeText: "你盘算着下个月要交的房租和日常开销，刚好能覆盖，但几乎没有余量。"
  }).candidates;
  assert.deepEqual(rent.map((item) => [item.responsibilityKey, item.action, item.liability, item.financialScope, item.cadence]), [
    ["primary_residence:main", "start", "protagonist", "personal", "recurring_unknown"]
  ]);
  assert.equal(rent[0]?.protagonistShareWan, undefined);
});

test("completed personal rent and parent rehabilitation source facts create nonzero reviewable responsibilities", () => {
  const ageInMonths = 61 * 12 + 1;
  const personalRent = deriveExpenseResponsibilityCandidates({
    ageInMonths,
    narrativeText: "你租了一个小单间，每月房租、交通、饮食和零碎支出，加上分期偿还的债务，工资到手后很快就所剩无几。"
  }).candidates;
  assert.deepEqual(personalRent.map((item) => [
    item.responsibilityKey, item.action, item.liability, item.financialScope, item.protagonistShareWan
  ]), [["primary_residence:main", "start", "protagonist", "personal", undefined]]);

  const parent = world({ people: [{
    id: "person_parent_unspecified", relation: "parent", lifeStatus: "active", source: "accepted_history", confidence: 1
  }] });
  const rehabilitation = deriveExpenseResponsibilityCandidates({
    ageInMonths,
    candidateWorldState: parent,
    narrativeText: "父亲膝盖的旧疾在持续理疗下保持稳定，但今年春天他走路时偶尔会踉跄，你带他去市里医院做了全面检查，医生建议加强肌肉力量训练，你为他在县城找了一位康复师，每周两次上门指导。"
  }).candidates;
  assert.deepEqual(rehabilitation.map((item) => [
    item.responsibilityKey, item.action, item.liability, item.financialScope, item.protagonistShareWan
  ]), [["elder_care:person_parent_unspecified", "start", "protagonist", "personal", undefined]]);

  const ledger = migrateFinancialLedgerV3ToV4(initializeFinancialLedger({
    id: "rehabilitation_unknown_amount", asOfAgeInMonths: ageInMonths
  }) as FinancialLedgerV3);
  const plan = reconcileExpenseCommitments({
    ledger,
    candidates: rehabilitation,
    ageInMonths,
    sourceOutcomeId: "rehabilitation_outcome",
    mode: "enforced"
  });
  const proposed = plan.proposals.find((item) => item.kind === "expense_commitment_started");
  if (!proposed || proposed.kind !== "expense_commitment_started") throw new Error("expected a rehabilitation commitment start");
  const commitment = proposed.payload as ExpenseCommitmentV4;
  assert.equal(commitment.factStatus, "needs_review");
  assert.ok(commitment.monthlyAmountWan > 0, "unknown care amount must not silently become zero");
});

test("a stable parent update with no increased expense does not create a new elder-care review", () => {
  const result = deriveExpenseResponsibilityCandidates({
    ageInMonths: 33 * 12 + 2,
    narrativeText: "父母那边，你每个月多打两次电话，他们身体还算稳定，医疗支出也没再增加。"
  });
  assert.equal(result.candidates.length, 0);
});

test("E-11 and E-31 split parent transfer once without also retaining a total aggregate", () => {
  const result = deriveExpenseResponsibilityCandidates({
    ageInMonths: 480,
    narrativeText: "你每月给父母转4000元，其中医疗3000元、生活费1000元。"
  });
  assert.deepEqual(result.candidates.map((item) => [item.responsibilityKind, item.protagonistShareWan]), [
    ["recurring_healthcare", 0.3],
    ["elder_care", 0.1]
  ]);
  assert.equal(result.candidates[0]?.amountSourceId?.endsWith(":medical"), true);
  assert.equal(result.candidates[1]?.amountSourceId?.endsWith(":support"), true);
  assert.notEqual(result.candidates[0]?.amountSourceId, result.candidates[1]?.amountSourceId);
  assert.equal(result.candidates.some((item) => item.responsibilityKind === "legacy_aggregate"), false);
});

test("E-12 care-dependent parent without protagonist liability remains an owner-review candidate", () => {
  const current = world({ people: [{
    id: "mother", relation: "parent", lifeStatus: "active", healthStatus: "stable", source: "accepted_history", confidence: 1
  }] });
  const candidate = world({ people: [{
    id: "mother", relation: "parent", lifeStatus: "limited", healthStatus: "care_dependent", source: "accepted_history", confidence: 1
  }] });
  const result = deriveExpenseResponsibilityCandidates({ currentWorldState: current, candidateWorldState: candidate, ageInMonths: 720 });
  assert.equal(result.candidates[0]?.responsibilityKey, "elder_care:mother");
  assert.equal(result.candidates[0]?.liability, "unknown");
  assert.equal(result.diagnostics[0]?.disposition, "owner_review");
});

test("accepted child WorldState is a stable owner-review trigger, while model-inferred or planned children are not", () => {
  const acceptedChild = deriveExpenseResponsibilityCandidates({
    currentWorldState: world(),
    candidateWorldState: world({ people: [{
      id: "child_1", relation: "child", lifeStatus: "active", source: "accepted_history", confidence: 1,
      relationshipSummary: "子女已加入当前家庭"
    }] }),
    ageInMonths: 420
  });
  assert.deepEqual(acceptedChild.candidates.map((item) => [item.responsibilityKey, item.action, item.liability]), [
    ["child_support:child_1", "review", "unknown"]
  ]);
  const unacceptedChild = deriveExpenseResponsibilityCandidates({
    currentWorldState: world(),
    candidateWorldState: world({ people: [{
      id: "child_model_hint", relation: "child", lifeStatus: "active", source: "model_inferred", confidence: 0.55
    }] }),
    ageInMonths: 420
  });
  assert.equal(unacceptedChild.candidates.length, 0);
  const planned = deriveExpenseResponsibilityCandidates({ ageInMonths: 420, narrativeText: "我们计划明年要孩子。" });
  assert.equal(planned.candidates.length, 0);
});

test("completed narrative payer facts bind to accepted child/parent ids instead of creating unidentified sibling accounts", () => {
  const result = deriveExpenseResponsibilityCandidates({
    currentWorldState: world({ people: [{
      id: "mother", relation: "parent", lifeStatus: "active", healthStatus: "stable", source: "accepted_history", confidence: 1
    }] }),
    candidateWorldState: world({ people: [
      { id: "mother", relation: "parent", lifeStatus: "limited", healthStatus: "care_dependent", source: "accepted_history", confidence: 1 },
      { id: "child_1", relation: "child", lifeStatus: "active", source: "accepted_history", confidence: 1, displayName: "女儿" }
    ] }),
    narrativeText: "孩子出生后，你每月承担育儿安排。你每月给母亲转4000元用于照护。",
    ageInMonths: 480
  });
  assert.equal(result.candidates.some((item) => item.responsibilityKey.includes("unidentified")), false);
  const child = result.candidates.find((item) => item.responsibilityKey === "child_support:child_1");
  assert.equal(child?.action, "start");
  assert.deepEqual(child?.participantPersonIds, ["child_1"]);
  const parent = result.candidates.find((item) => item.responsibilityKey === "elder_care:mother");
  assert.equal(parent?.action, "start");
  assert.deepEqual(parent?.participantPersonIds, ["mother"]);
  assert.equal(result.candidates.some((item) => item.action === "review" && item.liability === "unknown"), false);
});

test("active family link plus accepted parent limitation is an owner-review path, not an automatic deduction", () => {
  const parent = {
    id: "father", relation: "parent" as const, lifeStatus: "limited" as const,
    healthStatus: "care_dependent" as const, source: "accepted_history" as const, confidence: 1
  };
  const current = world({ people: [parent] });
  const candidate = world({
    people: [parent],
    familyRelationships: [{
      id: "family_father", participantPersonId: "father", role: "father", activation: "active",
      contact: "frequent", emotionalSupport: "mixed", practicalSupport: "unknown", autonomyRespect: "unknown",
      conflictIntensity: "low", topicStances: [], revision: 1
    }]
  });
  const result = deriveExpenseResponsibilityCandidates({ currentWorldState: current, candidateWorldState: candidate, ageInMonths: 720 });
  assert.equal(result.candidates[0]?.responsibilityKey, "elder_care:father");
  assert.equal(result.candidates[0]?.liability, "unknown");
  assert.equal(result.candidates[0]?.action, "review");
});

test("accepted health and CareerState deltas are structured lifecycle triggers without an age-only charge", () => {
  const employed = {
    id: "career_work", employmentStatus: "employed" as const, activeProjectIds: [],
    effectiveFromAgeInMonths: 720, source: "accepted_history" as const, confidence: 1
  };
  const retired = {
    ...employed, id: "career_retired", employmentStatus: "retired" as const, effectiveFromAgeInMonths: 89 * 12
  };
  const result = deriveExpenseResponsibilityCandidates({
    currentWorldState: world({
      healthSummary: "健康状况稳定",
      careerStates: [employed], currentCareerStateId: employed.id, currentEmploymentStatus: "employed"
    }),
    candidateWorldState: world({
      healthSummary: "医生已确认需要长期治疗并持续用药。",
      careerStates: [employed, retired], currentCareerStateId: retired.id, currentEmploymentStatus: "retired"
    }),
    ageInMonths: 89 * 12
  });
  assert.deepEqual(result.candidates.map((item) => [item.responsibilityKey, item.action, item.source]), [
    ["recurring_healthcare:protagonist", "start", "accepted_world_delta"],
    ["adult_basic_living:protagonist", "review", "accepted_world_delta"]
  ]);
  const ageOnly = deriveExpenseResponsibilityCandidates({
    currentWorldState: world({ healthSummary: "健康状况稳定" }),
    candidateWorldState: world({ healthSummary: "健康状况稳定" }),
    ageInMonths: 89 * 12
  });
  assert.equal(ageOnly.candidates.length, 0);
});

test("E-15 business workshop is classified before housing and cannot become a personal residence", () => {
  const result = deriveExpenseResponsibilityCandidates({
    ageInMonths: 420,
    narrativeText: "你租下了一间50平米的独立木工坊，作为公司工作室。"
  });
  assert.equal(result.candidates[0]?.financialScope, "business_operating");
  assert.equal(result.candidates[0]?.responsibilityKey, "primary_residence:main");
});

test("company business-premises rent never emits a personal or shared primary residence", () => {
  const cases = [
    ["office", "公司租下办公室，每月租金5000元。"],
    ["workshop", "公司租下一间木工坊，每月租金5000元。"],
    ["warehouse", "公司租下仓库，每月租金5000元。"],
    ["store", "公司租下一家门店，每月租金5000元。"],
    ["office site", "公司租下办公场地，每月租金5000元。"],
    ["shop", "公司租下一间商铺，每月租金5000元。"],
    ["shopfront", "公司租下一间店铺，每月租金5000元。"]
  ] as const;

  for (const [label, narrativeText] of cases) {
    const primaryResidenceCandidates = deriveExpenseResponsibilityCandidates({
      ageInMonths: 420,
      narrativeText
    }).candidates.filter((candidate) => candidate.responsibilityKey === "primary_residence:main");

    assert.equal(primaryResidenceCandidates.some((candidate) => (
      candidate.financialScope === "personal" || candidate.financialScope === "shared_household"
    )), false, `${label} rent must not become a personal or shared primary residence`);
    assert.equal(primaryResidenceCandidates.some((candidate) => (
      candidate.financialScope === "business_operating"
    )), true, `${label} rent must remain classified as business operating scope`);
  }
});

test("high age alone creates no health or care expense; accepted ongoing treatment does", () => {
  const empty = deriveExpenseResponsibilityCandidates({ ageInMonths: 89 * 12, narrativeText: "89岁时你安静地整理旧照片。" });
  assert.equal(empty.candidates.length, 0);
  const treatment = deriveExpenseResponsibilityCandidates({
    ageInMonths: 89 * 12,
    explicitFacts: [{
      responsibilityKey: "recurring_healthcare:protagonist",
      responsibilityKind: "recurring_healthcare",
      proposedType: "healthcare",
      cadence: "monthly",
      explicitMonthlyTotalWan: 0.12,
      protagonistShareWan: 0.12,
      amountSourceId: "accepted-treatment-89",
      source: "accepted_outcome",
      evidenceExcerpt: "你继续每月复诊并长期用药1200元。"
    }]
  });
  assert.equal(treatment.candidates[0]?.responsibilityKind, "recurring_healthcare");
  assert.equal(treatment.candidates[0]?.protagonistShareWan, 0.12);
});

test("an explicit adjustment carries its V4 change authority through candidate derivation", () => {
  const result = deriveExpenseResponsibilityCandidates({
    ageInMonths: 500,
    explicitFacts: [{
      responsibilityKey: "primary_residence:main",
      responsibilityKind: "primary_residence",
      proposedType: "housing",
      action: "adjust",
      explicitMonthlyTotalWan: 0.4,
      protagonistShareWan: 0.2,
      shareRate: 0.5,
      nextStatus: "paused",
      changeReason: "temporary_third_party_coverage",
      source: "accepted_outcome",
      evidenceExcerpt: "本月起暂由伴侣代付房租。"
    }]
  });
  assert.equal(result.candidates[0]?.nextStatus, "paused");
  assert.equal(result.candidates[0]?.changeReason, "temporary_third_party_coverage");
});

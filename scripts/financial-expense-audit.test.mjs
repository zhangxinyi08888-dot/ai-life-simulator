import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assessExpenseResponsibilityCorpusCoverage,
  auditExpenseLifecycleDynamics,
  auditExpenseLifecycleCandidateTelemetry,
  auditExpenseResponsibilities,
  collectCommittedResponsibilityCandidates,
  collectExpenseLifecycleCandidateRecords,
  expenseLifecycleReleaseBlockers
} from "./lib/financial-expense-audit.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const gold = JSON.parse(await readFile(path.join(here, "fixtures", "financial-expense-responsibility-gold-v1.json"), "utf8"));

function commitment(input) {
  return {
    id: input.id || input.responsibilityKey.replace(/[^a-z0-9]+/giu, "_"),
    responsibilityKey: input.responsibilityKey,
    responsibilityKind: input.responsibilityKind,
    type: input.type,
    displayName: input.displayName,
    monthlyAmountWan: input.monthlyAmountWan,
    grossMonthlyAmountWan: input.grossMonthlyAmountWan,
    householdShareRate: input.householdShareRate,
    financialScope: input.financialScope || "personal",
    status: input.status || "active",
    factStatus: input.factStatus,
    amountBasis: input.amountBasis,
    amountSourceIds: input.amountSourceIds,
    activeFromAgeInMonths: input.activeFromAgeInMonths,
    nextReviewAtAgeInMonths: input.nextReviewAtAgeInMonths,
    lastConfirmedAtAgeInMonths: input.lastConfirmedAtAgeInMonths,
    lastReviewedAtAgeInMonths: input.lastReviewedAtAgeInMonths,
    evidence: input.evidence || []
  };
}

function node(commitments, ageInMonths, options = {}) {
  return {
    ageInMonths,
    financialLedger: {
      expenseCommitments: commitments,
      unresolvedIssues: options.unresolvedIssues || [],
      debtAccounts: options.debtAccounts || []
    },
    financialState: {
      annualCoreExpenseWan: commitments.reduce((sum, item) => sum + (item.status === "active" ? item.monthlyAmountWan * 12 : 0), 0)
    },
    financialProcessingMeta: options.financialProcessingMeta
  };
}

function dynamicNode(commitments, periodStartAgeInMonths, periodEndAgeInMonths, options = {}) {
  const annualCoreExpenseWan = commitments.reduce((sum, item) => (
    sum + (item.status === "active" ? item.monthlyAmountWan * 12 : 0)
  ), 0);
  const incomeWan = options.incomeWan ?? 20;
  const otherExpenseWan = options.otherExpenseWan ?? 1;
  const debtPrincipalPaidWan = options.debtPrincipalPaidWan ?? 0.5;
  const debtInterestPaidWan = options.debtInterestPaidWan ?? 0.2;
  const coreExpenseWan = annualCoreExpenseWan * (periodEndAgeInMonths - periodStartAgeInMonths) / 12;
  return {
    ...node(commitments, periodEndAgeInMonths, options),
    financialPeriodSummary: {
      periodStartAgeInMonths,
      periodEndAgeInMonths,
      incomeWan,
      coreExpenseWan,
      otherExpenseWan,
      debtPrincipalPaidWan,
      debtInterestPaidWan,
      assetPurchaseWan: 0,
      assetSaleProceedsWan: 0,
      valuationChangeWan: 0,
      netCashFlowWan: incomeWan - coreExpenseWan - otherExpenseWan - debtPrincipalPaidWan - debtInterestPaidWan,
      netWorthChangeWan: incomeWan - coreExpenseWan - otherExpenseWan - debtPrincipalPaidWan - debtInterestPaidWan,
      transactionIds: []
    }
  };
}

function floorCommitment() {
  return commitment({
    responsibilityKey: "adult_basic_living:main", responsibilityKind: "adult_basic_living", type: "basic_living",
    monthlyAmountWan: 0.35, factStatus: "estimated", amountBasis: "policy_floor"
  });
}

function residenceCommitment(input = {}) {
  return commitment({
    responsibilityKey: "primary_residence:main", responsibilityKind: "primary_residence", type: "housing",
    monthlyAmountWan: 0.5, factStatus: "known", amountBasis: "explicit_known",
    nextReviewAtAgeInMonths: 500,
    ...input
  });
}

function childCommitment(input = {}) {
  return commitment({
    responsibilityKey: "child_support:child_1", responsibilityKind: "child_support", type: "dependent_support",
    monthlyAmountWan: 0.3, factStatus: "known", amountBasis: "explicit_known",
    ...input
  });
}

function goldRouteRecords() {
  const housing = (monthlyAmountWan = 0.26) => commitment({
    responsibilityKey: "primary_residence:main", responsibilityKind: "primary_residence", type: "housing",
    monthlyAmountWan, grossMonthlyAmountWan: monthlyAmountWan * 2, householdShareRate: 0.5, financialScope: "shared_household"
  });
  const child = (status = "active") => commitment({
    responsibilityKey: "child_support:child_1", responsibilityKind: "child_support", type: "dependent_support", monthlyAmountWan: 0.3, status
  });
  const elder = (lastReviewedAtAgeInMonths) => commitment({
    responsibilityKey: "elder_care:mother", responsibilityKind: "elder_care", type: "dependent_support", monthlyAmountWan: 0.4,
    lastReviewedAtAgeInMonths, evidence: [{ reasonCode: "EXPENSE_CARE_NARRATIVE", excerpt: "母亲需要护工照护" }]
  });
  const healthcare = (monthlyAmountWan = 0.12, lastReviewedAtAgeInMonths) => commitment({
    responsibilityKey: "recurring_healthcare:protagonist", responsibilityKind: "recurring_healthcare", type: "healthcare", monthlyAmountWan,
    lastReviewedAtAgeInMonths, evidence: [{ reasonCode: "EXPENSE_HEALTH_NARRATIVE", excerpt: "长期用药和复诊" }]
  });
  const insurance = (lastReviewedAtAgeInMonths) => commitment({
    responsibilityKey: "personal_insurance:main", responsibilityKind: "personal_insurance", type: "insurance", monthlyAmountWan: 0.08,
    lastReviewedAtAgeInMonths
  });
  const education = commitment({
    responsibilityKey: "continuing_education:program_1", responsibilityKind: "continuing_education", type: "education", monthlyAmountWan: 0.2
  });
  const ages = Array.from({ length: 12 }, (_, index) => (40 + index) * 12);
  return [
    { caseSlug: "gold-lifecycle", history: [
      node([housing()], ages[0]),
      node([housing(), child()], ages[1]),
      node([housing(), child(), elder()], ages[2]),
      node([housing(), child(), elder(), healthcare()], ages[3]),
      node([housing(), child(), elder(), healthcare(), insurance()], ages[4]),
      node([housing(), child(), elder(), healthcare(), insurance(), education], ages[5]),
      node([housing(0.3), child(), elder(), healthcare(), insurance(), education], ages[6]),
      node([housing(0.3), child(), elder(), healthcare(0.18), insurance(), education], ages[7]),
      node([housing(0.3), child(), elder(), healthcare(0.18), insurance(ages[8]), education], ages[8]),
      node([housing(0.3), child("ended"), elder(), healthcare(0.18), insurance(ages[8]), education], ages[9]),
      node([housing(0.3), child("ended"), elder(ages[10]), healthcare(0.18), insurance(ages[8]), education], ages[10]),
      node([housing(0.3), child("ended"), elder(ages[10]), healthcare(0.18, 89 * 12), insurance(ages[8]), education], 89 * 12)
    ] },
    { caseSlug: "gold-business-negative", history: [node([], 480)] },
    { caseSlug: "gold-third-party-negative", history: [node([], 480)] },
    { caseSlug: "gold-office-negative", history: [node([], 480)] },
    { caseSlug: "gold-warehouse-negative", history: [node([], 480)] }
  ];
}

test("independent annotations never turn an empty sample into 100 percent", () => {
  const result = auditExpenseResponsibilities({ routeRecords: [], annotations: [] });
  const candidateTelemetry = auditExpenseLifecycleCandidateTelemetry({ routeRecords: [], annotations: [] });
  const frozenCorpus = assessExpenseResponsibilityCorpusCoverage({ annotations: [], corpusKind: "frozen_gold" });
  assert.equal(result.coverageStatus, "not_covered");
  assert.equal(result.precisionStatus, "not_covered");
  assert.equal(result.expenseResponsibilityRecallPct, null);
  assert.equal(result.expenseResponsibilityPrecisionPct, null);
  assert.equal(candidateTelemetry.expenseLifecycleCandidateTelemetryStatus, "not_covered");
  assert.equal(candidateTelemetry.expenseLifecycleCandidateTelemetryRecallPct, null);
  assert.equal(candidateTelemetry.expenseLifecycleCandidateTelemetryPrecisionPct, null);
  assert.equal(frozenCorpus.status, "not_covered");
});

test("candidate telemetry matches independent annotations after generation and reports miss plus planned false positive", () => {
  const annotations = [
    {
      caseSlug: "trace", nodeIndex: 1, material: true,
      expectedAction: "start", expectedResponsibilityKey: "primary_residence:main",
      expectedScope: "shared_household", expectedType: "housing",
      expectedMonthlyAmountWan: 0.26, expectedShareRate: 0.5
    },
    {
      caseSlug: "trace", nodeIndex: 2, material: true,
      expectedAction: "start", expectedResponsibilityKey: "elder_care:mother",
      expectedScope: "personal", expectedType: "dependent_support",
      expectedMonthlyAmountWan: 0.3
    },
    {
      caseSlug: "trace", nodeIndex: 1, material: false,
      expectedAction: "ignore", expectedResponsibilityKey: "primary_residence:workshop",
      expectedScope: "business_operating"
    }
  ];
  const candidate = (overrides = {}) => ({
    candidateId: "trace_housing",
    responsibilityKey: "primary_residence:main",
    responsibilityKind: "primary_residence",
    proposedType: "housing",
    financialScope: "shared_household",
    action: "start",
    liability: "shared",
    source: "accepted_world_delta",
    amountBasis: "explicit_shared_amount",
    sourceMonthlyAmountWan: 0.26,
    sourceGrossMonthlyAmountWan: 0.52,
    shareRate: 0.5,
    evidenceReasonCodes: ["EXPENSE_SHARED_HOME"],
    reconcilerDisposition: "planned_start",
    reconcilerReasonCodes: ["NEW_RESPONSIBILITY_COMMITMENT"],
    relatedProposalIds: ["system_expense_start_trace_housing"],
    relatedIssueIds: [],
    wouldBlock: false,
    ...overrides
  });
  const traceNode = node([], 372, {
    financialProcessingMeta: {
      expenseLifecycleTelemetry: {
        mode: "shadow",
        wouldBlock: false,
        candidates: [
          candidate(),
          candidate({
            candidateId: "trace_insurance_false_positive",
            responsibilityKey: "personal_insurance:main",
            responsibilityKind: "personal_insurance",
            proposedType: "insurance",
            financialScope: "personal",
            action: "start",
            liability: "protagonist",
            sourceMonthlyAmountWan: 0.08,
            sourceGrossMonthlyAmountWan: 0.08,
            shareRate: undefined,
            reconcilerDisposition: "planned_start"
          }),
          candidate({
            candidateId: "trace_workshop_ignored",
            responsibilityKey: "primary_residence:workshop",
            financialScope: "business_operating",
            action: "review",
            liability: "third_party",
            sourceMonthlyAmountWan: undefined,
            sourceGrossMonthlyAmountWan: undefined,
            shareRate: undefined,
            reconcilerDisposition: "ignored",
            reconcilerReasonCodes: ["NON_ACCRUING_SCOPE_OR_CADENCE"]
          })
        ]
      }
    }
  });
  const routeRecords = [{ caseSlug: "trace", history: [node([], 360), traceNode, node([], 384)] }];
  const records = collectExpenseLifecycleCandidateRecords({ routeRecords });
  const result = auditExpenseLifecycleCandidateTelemetry({ annotations, routeRecords });

  assert.equal(records.length, 3);
  assert.equal(result.expenseLifecycleCandidateTelemetryStatus, "observed");
  assert.equal(result.expenseLifecycleCandidateTelemetryMatchCount, 1);
  assert.equal(result.expenseLifecycleCandidateTelemetryMissedCount, 1);
  assert.equal(result.expenseLifecycleCandidateTelemetryFalsePositiveCount, 1);
  assert.equal(result.expenseLifecycleCandidateTelemetryRecallPct, 50);
  assert.equal(result.expenseLifecycleCandidateTelemetryPrecisionPct, 50);
  assert.equal(result.expenseLifecycleCandidateTelemetryNegativeAnnotatedCount, 1);
  assert.equal(result.expenseLifecycleCandidateTelemetryNegativeMatchCount, 1);
  assert.equal(result.expenseLifecycleCandidateTelemetryNegativeViolationCount, 0);
  assert.equal(result.expenseLifecycleCandidateTelemetryNegativeStatus, "covered");
  assert.equal(result.details.negativeMatches.length, 1);
  assert.equal(result.details.falsePositives[0].candidateId, "trace_insurance_false_positive");
});

test("candidate telemetry exposes a review or plan that violates an ignore annotation", () => {
  const annotations = [
    {
      caseSlug: "negative", nodeIndex: 1, material: false,
      expectedAction: "ignore", expectedResponsibilityKey: "elder_care:parents",
      expectedScope: "personal", expectedType: "dependent_support"
    },
    {
      caseSlug: "negative", nodeIndex: 1, material: true,
      expectedAction: "start", expectedResponsibilityKey: "primary_residence:main",
      expectedScope: "personal", expectedType: "housing"
    }
  ];
  const routeRecords = [{
    caseSlug: "negative",
    history: [node([], 360), node([], 372, {
      financialProcessingMeta: {
        expenseLifecycleTelemetry: {
          mode: "enforced",
          wouldBlock: false,
          candidates: [
            {
              candidateId: "negative_home",
              responsibilityKey: "primary_residence:main",
              responsibilityKind: "primary_residence",
              proposedType: "housing",
              financialScope: "personal",
              action: "start",
              liability: "protagonist",
              source: "accepted_world_delta",
              reconcilerDisposition: "planned_start"
            },
            {
              candidateId: "negative_parent_review",
              responsibilityKey: "elder_care:parents",
              responsibilityKind: "elder_care",
              proposedType: "dependent_support",
              financialScope: "personal",
              action: "review",
              liability: "unknown",
              source: "narrative_supplement",
              reconcilerDisposition: "issue",
              reconcilerReasonCodes: ["LIABILITY_UNKNOWN_REVIEW_REQUIRED"]
            }
          ]
        }
      }
    })]
  }];
  const result = auditExpenseLifecycleCandidateTelemetry({ annotations, routeRecords });

  assert.equal(result.expenseLifecycleCandidateTelemetryMatchCount, 1);
  assert.equal(result.expenseLifecycleCandidateTelemetryRecallPct, 100);
  assert.equal(result.expenseLifecycleCandidateTelemetryPrecisionPct, 100);
  assert.equal(result.expenseLifecycleCandidateTelemetryNegativeViolationCount, 1);
  assert.equal(result.expenseLifecycleCandidateTelemetryNegativeStatus, "incomplete");
  assert.equal(result.expenseLifecycleCandidateTelemetryPrecisionStatus, "incomplete");
  assert.equal(result.details.negativeViolations[0].candidate.candidateId, "negative_parent_review");
});

test("lifecycle diagnostics expose floor streaks, cumulative flows, responsibility changes and terminal fact status", () => {
  const floor = floorCommitment();
  const history = [
    dynamicNode([floor], 336, 348),
    dynamicNode([floor], 348, 360),
    dynamicNode([floor, residenceCommitment({ activeFromAgeInMonths: 360, nextReviewAtAgeInMonths: 390 })], 360, 372),
    dynamicNode([floor, residenceCommitment({ nextReviewAtAgeInMonths: 390 }), childCommitment({ activeFromAgeInMonths: 372 })], 372, 384),
    dynamicNode([floor, residenceCommitment({ nextReviewAtAgeInMonths: 390 }), childCommitment({ monthlyAmountWan: 0.45 })], 384, 396),
    dynamicNode([
      floor,
      residenceCommitment({ factStatus: "needs_review", nextReviewAtAgeInMonths: 390, lastReviewedAtAgeInMonths: 396 }),
      childCommitment({ monthlyAmountWan: 0.45, status: "ended" })
    ], 396, 408)
  ];
  const result = auditExpenseLifecycleDynamics({ routeRecords: [{ caseSlug: "dynamic", history }] });
  const { summary, details } = result;

  assert.equal(summary.annualCoreExpenseDistributionStatus, "observed");
  assert.equal(summary.annualCoreExpenseObservedNodeCount, 6);
  assert.equal(summary.annualCoreExpenseModeWan, 4.2);
  assert.equal(summary.systemFloorOnlyAdultMonths, 24);
  assert.equal(summary.maxSystemFloorOnlyStreakMonths, 24);
  assert.equal(summary.cumulativeIncomeWan, 120);
  assert.equal(summary.cumulativeOtherExpenseWan, 6);
  assert.equal(summary.cumulativeDebtServiceWan, 4.2);
  assert.equal(summary.routeCumulativeFinancialsStatus, "covered");
  assert.equal(summary.activeExpenseFactStatusSnapshotCounts.estimated, 6);
  assert.equal(summary.activeExpenseFactStatusSnapshotCounts.needs_review, 1);
  assert.equal(summary.familyResponsibilityRunRateWindowCount, 4);
  assert.equal(summary.familyResponsibilityRunRateWindowStatus, "partial");
  assert.equal(summary.overdueExpenseReviewByResponsibilityKind.primary_residence, 1);

  const child = summary.responsibilityLifecycleByKind.find((item) => item.responsibilityKind === "child_support");
  assert.deepEqual(
    { starts: child.starts, adjusts: child.adjusts, ends: child.ends },
    { starts: 1, adjusts: 1, ends: 1 }
  );
  assert.equal(details.routeDiagnostics[0].terminalExpenseState.finalFactStatus, "needs_review");
  assert.equal(details.familyResponsibilityRunRateWindows[1].after.annualizedCoreExpenseRunRateWan > 0, true);
});

test("lifecycle diagnostics keep empty distributions, flows and family windows honestly not_covered", () => {
  const result = auditExpenseLifecycleDynamics({ routeRecords: [] });
  assert.equal(result.summary.annualCoreExpenseDistributionStatus, "not_covered");
  assert.equal(result.summary.annualCoreExpenseConcentrationPct, null);
  assert.equal(result.summary.systemFloorOnlyAdultStatus, "not_covered");
  assert.equal(result.summary.unclassifiedExpenseStatus, "not_covered");
  assert.equal(result.summary.routeCumulativeFinancialsStatus, "not_covered");
  assert.equal(result.summary.cumulativeIncomeWan, null);
  assert.equal(result.summary.familyResponsibilityRunRateWindowStatus, "not_covered");
  assert.equal(result.summary.finalExpenseStateStatus, "not_covered");
  assert.equal(result.summary.expenseInvariantAuditStatus, "not_covered");
  assert.equal(result.summary.expenseBaselineDownwardOverwriteCount, null);
  assert.equal(result.summary.expenseUnknownZeroCount, null);
  assert.equal(result.summary.staleExpenseWithoutReviewCount, null);
  assert.equal(result.summary.expenseAggregateSplitLossCount, null);
  assert.equal(result.summary.expenseAmountSourceDoubleCount, null);
  assert.equal(result.summary.mortgageExpenseDoubleCountCount, null);
});

test("lifecycle diagnostics distinguish accrued unclassified residual from accepted typed expense", () => {
  const unclassified = (monthlyAmountWan) => commitment({
    id: "system_unclassified_core_consumption",
    responsibilityKey: "unclassified_core_consumption:protagonist",
    responsibilityKind: "unclassified_core_consumption",
    type: "other",
    displayName: "未分类核心生活支出估算",
    monthlyAmountWan,
    factStatus: "needs_review",
    amountBasis: "contextual_estimate",
    evidence: [{ source: "system_policy", reasonCode: "EXPENSE_UNCLASSIFIED_CORE_CONSUMPTION", confidence: 1 }]
  });
  const history = [
    dynamicNode([floorCommitment(), unclassified(0.55)], 360, 372),
    dynamicNode([floorCommitment(), unclassified(0.25), residenceCommitment({ monthlyAmountWan: 0.3 })], 372, 384)
  ];

  const { summary } = auditExpenseLifecycleDynamics({ routeRecords: [{ caseSlug: "residual", history }] });

  assert.equal(summary.systemFloorOnlyAdultMonths, 0);
  assert.equal(summary.unclassifiedExpenseStatus, "observed");
  assert.equal(summary.unclassifiedExpenseSnapshotCount, 2);
  assert.equal(summary.unclassifiedExpenseMonths, 24);
  assert.equal(summary.unclassifiedExpenseSharePct > 0, true);
  assert.equal(summary.knownTypedExpenseSharePct > 0, true);
});

test("release review gate keeps policy-owned estimates diagnostic but blocks overdue authoritative amounts", () => {
  const policyOwned = commitment({
    id: "policy_owned_residual",
    responsibilityKey: "unclassified_core_consumption:protagonist",
    responsibilityKind: "unclassified_core_consumption",
    type: "other",
    monthlyAmountWan: 0.55,
    factStatus: "needs_review",
    amountBasis: "contextual_estimate",
    nextReviewAtAgeInMonths: 360
  });
  const authoritative = residenceCommitment({
    id: "accepted_rent_due",
    nextReviewAtAgeInMonths: 360,
    amountBasis: "explicit_known",
    factStatus: "known"
  });
  const { summary, details } = auditExpenseLifecycleDynamics({
    routeRecords: [{ caseSlug: "review-authority", history: [node([policyOwned, authoritative], 372, {
      unresolvedIssues: [{
        id: "expense_review_due_policy_owned_residual",
        code: "PENDING_FACT",
        severity: "warning",
        status: "open",
        relatedProposalIds: [],
        relatedAccountIds: [policyOwned.id],
        summary: "政策估算等待新事实",
        createdAtAgeInMonths: 372
      }, {
        id: "expense_review_due_accepted_rent_due",
        code: "PENDING_FACT",
        severity: "warning",
        status: "open",
        relatedProposalIds: [],
        relatedAccountIds: [authoritative.id],
        summary: "明确房租等待复核",
        createdAtAgeInMonths: 372
      }]
    })] }]
  });

  assert.equal(summary.policyOwnedExpenseReviewOutstandingCount, 1);
  assert.equal(summary.reviewDueWithoutAcceptedDispositionCount, 1);
  assert.equal(details.terminalExpenseStates[0].overdue.find((item) => item.commitmentId === policyOwned.id)?.acceptedDispositionRequired, false);
  assert.equal(details.terminalExpenseStates[0].overdue.find((item) => item.commitmentId === authoritative.id)?.acceptedDispositionRequired, true);
});

test("expense invariant audit catches silent lowering, zero unknowns, stale review, split loss, source duplication and mortgage double count", () => {
  const knownEvidence = [{ source: "user", reasonCode: "EXPLICIT_OPENING_FINANCIAL_FACT", confidence: 1 }];
  const records = [
    {
      caseSlug: "silent-downward",
      history: [
        node([residenceCommitment({ id: "home", monthlyAmountWan: 0.8, evidence: knownEvidence })], 360),
        node([residenceCommitment({ id: "home", monthlyAmountWan: 0.35, amountBasis: "policy_floor", evidence: [{ source: "system_policy", reasonCode: "EXPENSE_POLICY_PRIMARY_RESIDENCE", confidence: 1 }] })], 372)
      ]
    },
    {
      caseSlug: "unknown-zero",
      history: [node([commitment({
        responsibilityKey: "recurring_healthcare:protagonist", responsibilityKind: "recurring_healthcare", type: "healthcare",
        monthlyAmountWan: 0, factStatus: "needs_review", amountBasis: "contextual_estimate"
      })], 480)]
    },
    {
      caseSlug: "stale-without-issue",
      history: [node([residenceCommitment({ id: "stale_home", nextReviewAtAgeInMonths: 360 })], 372)]
    },
    {
      caseSlug: "aggregate-split-loss",
      history: [
        node([commitment({
          id: "legacy_total", responsibilityKey: "legacy_aggregate:main", responsibilityKind: "legacy_aggregate", type: "basic_living",
          monthlyAmountWan: 1.2, factStatus: "needs_review", amountBasis: "legacy_estimate", amountSourceIds: ["legacy-total"]
        })], 360),
        node([residenceCommitment({ id: "split_home", monthlyAmountWan: 0.4, amountSourceIds: ["split-home"] })], 372)
      ]
    },
    {
      caseSlug: "amount-source-duplicate",
      history: [node([
        residenceCommitment({ id: "same_source_home", amountSourceIds: ["accepted-rent-and-care"] }),
        commitment({
          id: "same_source_care", responsibilityKey: "recurring_healthcare:protagonist", responsibilityKind: "recurring_healthcare", type: "healthcare",
          monthlyAmountWan: 0.2, factStatus: "known", amountBasis: "explicit_known", amountSourceIds: ["accepted-rent-and-care"]
        })
      ], 480)]
    },
    {
      caseSlug: "mortgage-duplicated-as-housing",
      history: [dynamicNode([
        residenceCommitment({ id: "mortgage_housing", displayName: "房贷月供", monthlyAmountWan: 0.8, amountSourceIds: ["mortgage_payment_1"] })
      ], 480, 492, {
        debtAccounts: [{
          id: "mortgage_1", type: "mortgage", status: "active", repaymentPolicy: { monthlyPrincipalWan: 0.6, monthlyInterestWan: 0.2 }
        }],
        debtPrincipalPaidWan: 0.6,
        debtInterestPaidWan: 0.2
      })]
    }
  ];
  const result = auditExpenseLifecycleDynamics({ routeRecords: records });
  assert.equal(result.summary.expenseInvariantAuditStatus, "observed");
  assert.equal(result.summary.expenseBaselineDownwardOverwriteCount, 1);
  assert.equal(result.summary.expenseUnknownZeroCount, 1);
  assert.equal(result.summary.staleExpenseWithoutReviewCount, 1);
  assert.equal(result.summary.expenseAggregateSplitLossCount, 1);
  assert.equal(result.summary.expenseAmountSourceDoubleCount, 1);
  assert.equal(result.summary.mortgageExpenseDoubleCountCount, 1);
  assert.equal(result.details.aggregateSplitLosses[0].aggregateCommitmentId, "legacy_total");
});

test("Spec authority audit catches zero confirmed accrual, unaccepted confirmation, orphan review resolution, and annual derivation drift", () => {
  const invalid = commitment({
    id: "invalid_confirmed_rent",
    responsibilityKey: "primary_residence:main",
    responsibilityKind: "primary_residence",
    type: "housing",
    monthlyAmountWan: 0,
    factStatus: "known",
    amountBasis: "explicit_known",
    amountSourceIds: ["unaccepted_exact_rent"],
    nextReviewAtAgeInMonths: 600,
    evidence: [{ source: "model", reasonCode: "MODEL_ECHO", confidence: 1 }]
  });
  const current = dynamicNode([invalid], 480, 492, {
    unresolvedIssues: [{
      id: "expense_review_due_invalid_confirmed_rent",
      code: "EXPENSE_REVIEW_OVERDUE",
      severity: "blocking",
      status: "resolved",
      relatedProposalIds: [],
      relatedAccountIds: [invalid.id],
      summary: "待确认",
      createdAtAgeInMonths: 480,
      resolvedAtAgeInMonths: 492,
      resolvedByEventId: "event_not_in_transaction",
      expenseResolutionKind: "exact_amount",
      expenseResponsibilityKey: invalid.responsibilityKey
    }]
  });
  current.financialState.annualCoreExpenseWan = 4.2;
  const result = auditExpenseLifecycleDynamics({ routeRecords: [{ caseSlug: "authority-invalid", history: [current] }] });
  assert.equal(result.summary.confirmedResponsibilityWithoutNonzeroAccrualCount, 1);
  assert.equal(result.summary.expenseConfirmationAuthorityViolationCount, 1);
  assert.equal(result.summary.reviewResolutionWithoutAcceptedOutcomeCount, 1);
  assert.equal(result.summary.annualCoreExpenseDerivationMismatchCount, 1);
});

test("binding telemetry audit requires clause coordinates, all applicable spans, and final disposition", () => {
  const current = node([floorCommitment()], 480, {
    financialProcessingMeta: {
      expenseLifecycleTelemetry: {
        mode: "enforced",
        narrativeBindingMode: "enforced",
        narrativeBindingSourceIdentityMissingCount: 0,
        expenseConfirmationRejectedAfterSanitizeCount: 0,
        candidates: [{
          candidateId: "candidate_incomplete",
          sourceFactBindingId: "binding_incomplete",
          amountBasis: "explicit_monthly_amount",
          liability: "protagonist",
          cadence: "monthly",
          finalDisposition: "committed",
          sourceSpans: { responsibility: { start: 0, end: 2, excerpt: "房租" } }
        }]
      }
    }
  });
  const result = auditExpenseLifecycleDynamics({ routeRecords: [{ caseSlug: "telemetry-incomplete", history: [current] }] });
  assert.equal(result.summary.expenseBindingTelemetryIncompleteCount, 1);
  assert.equal(result.details.bindingTelemetryIncomplete[0].candidateId, "candidate_incomplete");
});

test("binding telemetry permits a missing completion span when completion is explicitly unresolved", () => {
  const current = node([floorCommitment()], 480, {
    financialProcessingMeta: {
      expenseLifecycleTelemetry: {
        mode: "enforced",
        narrativeBindingMode: "enforced",
        narrativeBindingSourceIdentityMissingCount: 0,
        expenseConfirmationRejectedAfterSanitizeCount: 0,
        candidates: [{
          candidateId: "candidate_completion_review",
          sourceFactBindingId: "binding_completion_review",
          amountBasis: "unknown",
          liability: "unknown",
          cadence: "recurring_unknown",
          unresolvedFields: ["completion", "payer", "amount", "cadence"],
          finalDisposition: "rejected",
          sourceClause: {
            clauseId: "expense_clause:0:0:0-2",
            contextClauseIds: ["expense_clause:0:0:0-2"],
            sentenceIndex: 0,
            clauseIndex: 0
          },
          sourceSpans: { responsibility: { start: 0, end: 2, excerpt: "房租" } }
        }]
      }
    }
  });
  const result = auditExpenseLifecycleDynamics({ routeRecords: [{ caseSlug: "telemetry-review", history: [current] }] });
  assert.equal(result.summary.expenseBindingTelemetryIncompleteCount, 0);
});

test("release expense invariant gate blocks every authority violation and rejects unobserved evidence", () => {
  const clean = {
    expenseInvariantAuditStatus: "observed",
    expenseBaselineDownwardOverwriteCount: 0,
    expenseUnknownZeroCount: 0,
    staleExpenseWithoutReviewCount: 0,
    expenseAggregateSplitLossCount: 0,
    expenseAmountSourceDoubleCount: 0,
    mortgageExpenseDoubleCountCount: 0,
    acceptedNodeWithUnresolvedMaterialExpenseBindingCount: 0,
    expenseBindingSourceIdentityMissingCount: 0,
    expenseBindingTelemetryIncompleteCount: 0,
    expenseConfirmationRejectedAfterSanitizeCount: 0,
    unknownLiabilityPersonalCommitmentCount: 0,
    knownWithoutExplicitAmountEvidenceCount: 0,
    policyFloorPromotedToKnownCount: 0,
    expenseAmountSourceUntraceableCount: 0,
    confirmedResponsibilityWithoutNonzeroAccrualCount: 0,
    expenseConfirmationAuthorityViolationCount: 0,
    reviewResolutionWithoutAcceptedOutcomeCount: 0,
    reviewDueWithoutAcceptedDispositionCount: 0,
    annualCoreExpenseDerivationMismatchCount: 0,
    adultBaselineOnlyAfterResponsibilityStatus: "observed",
    adultBaselineOnlyAfterResponsibilityCount: 0
  };
  assert.deepEqual(expenseLifecycleReleaseBlockers(clean), []);

  for (const field of [
    "expenseBaselineDownwardOverwriteCount",
    "expenseUnknownZeroCount",
    "staleExpenseWithoutReviewCount",
    "expenseAggregateSplitLossCount",
    "expenseAmountSourceDoubleCount",
    "mortgageExpenseDoubleCountCount",
    "acceptedNodeWithUnresolvedMaterialExpenseBindingCount",
    "expenseBindingSourceIdentityMissingCount",
    "expenseBindingTelemetryIncompleteCount",
    "expenseConfirmationRejectedAfterSanitizeCount",
    "unknownLiabilityPersonalCommitmentCount",
    "knownWithoutExplicitAmountEvidenceCount",
    "policyFloorPromotedToKnownCount",
    "expenseAmountSourceUntraceableCount",
    "confirmedResponsibilityWithoutNonzeroAccrualCount",
    "expenseConfirmationAuthorityViolationCount",
    "reviewResolutionWithoutAcceptedOutcomeCount",
    "reviewDueWithoutAcceptedDispositionCount",
    "annualCoreExpenseDerivationMismatchCount"
  ]) {
    const blockers = expenseLifecycleReleaseBlockers({ ...clean, [field]: 1 });
    assert.equal(blockers.length, 1, field);
  }
  assert.equal(expenseLifecycleReleaseBlockers({
    ...clean,
    adultBaselineOnlyAfterResponsibilityCount: 1
  }).length, 1);
  assert.match(expenseLifecycleReleaseBlockers({
    ...clean,
    expenseInvariantAuditStatus: "not_covered"
  })[0], /未被观察到/u);
  assert.match(expenseLifecycleReleaseBlockers({
    ...clean,
    adultBaselineOnlyAfterResponsibilityStatus: "not_covered"
  })[0], /未被观察到/u);
});

test("the frozen human-labelled corpus has 12 material examples and reaches exact precision/recall only when all actions match", () => {
  const annotations = gold.annotations;
  assert.equal(annotations.filter((item) => item.material && item.expectedAction !== "ignore").length, 12);
  assert.equal(annotations.filter((item) => item.expectedAction === "ignore").length, 4);
  const corpus = assessExpenseResponsibilityCorpusCoverage({ annotations, corpusKind: gold.corpusKind });
  assert.equal(corpus.status, "covered");
  assert.equal(corpus.counts.businessOrThirdPartyNegative, 4);
  const result = auditExpenseResponsibilities({ routeRecords: goldRouteRecords(), annotations });
  assert.equal(result.expenseResponsibilityAnnotatedCandidateCount, 12);
  assert.equal(result.expenseResponsibilityDetectedCandidateCount, 12);
  assert.equal(result.expenseResponsibilityRecallPct, 100);
  assert.equal(result.expenseResponsibilityPrecisionPct, 100);
  assert.equal(result.expenseResponsibilityMissedCount, 0);
  assert.equal(result.expenseResponsibilityFalsePositiveCount, 0);
  assert.equal(result.coverageStatus, "covered");
  assert.equal(result.precisionStatus, "covered");
  assert.equal(result.highAgeHealthOrCareResponsibilityCount, 2);
});

test("human_adjudicated is accepted as human review while a machine label remains insufficient", () => {
  const adjudicated = structuredClone(gold.annotations);
  adjudicated[0].reviewer = "human_adjudicated";
  const covered = assessExpenseResponsibilityCorpusCoverage({
    annotations: adjudicated,
    corpusKind: gold.corpusKind
  });
  assert.equal(covered.status, "covered");
  assert.equal(covered.counts.nonHumanReviewer, 0);

  adjudicated[0].reviewer = "machine";
  const invalid = assessExpenseResponsibilityCorpusCoverage({
    annotations: adjudicated,
    corpusKind: gold.corpusKind
  });
  assert.equal(invalid.status, "insufficient_coverage");
  assert.equal(invalid.failures.includes("non_human_reviewer"), true);
});

test("a partial frozen corpus is insufficient_coverage even if its one example matches", () => {
  const corpus = assessExpenseResponsibilityCorpusCoverage({
    corpusKind: "frozen_gold",
    annotations: [gold.annotations[0]]
  });
  assert.equal(corpus.status, "insufficient_coverage");
  assert.equal(corpus.failures.includes("material<12"), true);
});

test("an independent annotation catches a missed/incorrect responsibility instead of trusting detector counts", () => {
  const annotations = structuredClone(gold.annotations);
  const healthcareStart = annotations.find((item) => item.expectedResponsibilityKey === "recurring_healthcare:protagonist" && item.nodeIndex === 3);
  healthcareStart.expectedMonthlyAmountWan = 0.13;
  const result = auditExpenseResponsibilities({ routeRecords: goldRouteRecords(), annotations });
  assert.equal(result.expenseResponsibilityMissedCount, 1);
  assert.equal(result.expenseResponsibilityRecallPct, 91.67);
  assert.equal(result.coverageStatus, "incomplete");
  assert.equal(result.expenseResponsibilityFalsePositiveCount, 1);
  assert.equal(result.expenseResponsibilityPrecisionPct, 91.67);
});

test("a missing material start responsibility is a miss rather than an audit crash", () => {
  const annotations = [{
    caseSlug: "missing-start",
    nodeIndex: 0,
    evidenceExcerpt: "已开始独立租房，但金额待确认。",
    expectedAction: "start",
    expectedType: "housing",
    expectedScope: "personal",
    expectedResponsibilityKey: "primary_residence:main",
    material: true,
    reviewer: "human"
  }];

  const result = auditExpenseResponsibilities({
    routeRecords: [{ caseSlug: "missing-start", history: [node([], 480)] }],
    annotations
  });

  assert.equal(result.expenseResponsibilityAnnotatedCandidateCount, 1);
  assert.equal(result.expenseResponsibilityTruePositiveCount, 0);
  assert.equal(result.expenseResponsibilityMissedCount, 1);
  assert.equal(result.expenseResponsibilityDetectedCandidateCount, 0);
  assert.equal(result.expenseResponsibilityRecallPct, 0);
  assert.equal(result.expenseResponsibilityPrecisionPct, null);
  assert.equal(result.details.missed[0].caseSlug, "missing-start");
});

test("a personal housing account at a business-only negative annotation is a false positive", () => {
  const routeRecords = goldRouteRecords();
  const business = routeRecords.find((record) => record.caseSlug === "gold-business-negative");
  business.history[0] = node([commitment({
    responsibilityKey: "primary_residence:main", responsibilityKind: "primary_residence", type: "housing", monthlyAmountWan: 0.5
  })], 480);
  const result = auditExpenseResponsibilities({ routeRecords, annotations: gold.annotations });
  assert.equal(result.expenseResponsibilityFalsePositiveCount, 1);
  assert.equal(result.expenseResponsibilityPrecisionPct, 92.31);
  assert.equal(result.details.falsePositives[0].caseSlug, "gold-business-negative");
});

test("committed candidate extraction is limited to human-annotated node coordinates", () => {
  const records = [{
    caseSlug: "partial",
    history: [
      node([], 480),
      node([commitment({ responsibilityKey: "primary_residence:main", responsibilityKind: "primary_residence", type: "housing", monthlyAmountWan: 0.5 })], 492)
    ]
  }];
  const candidates = collectCommittedResponsibilityCandidates({
    routeRecords: records,
    annotations: [{
      caseSlug: "partial", nodeIndex: 0, expectedAction: "ignore", expectedScope: "business_operating",
      expectedResponsibilityKey: "primary_residence:main", material: false, reviewer: "human"
    }]
  });
  assert.deepEqual(candidates, []);
});

test("adult baseline after responsibility is a historical check, not an impossible same-node conjunction", () => {
  const history = [
    node([floorCommitment(), residenceCommitment({ id: "home" })], 360),
    // Simulate the exact bad artifact shape: a previously active housing
    // responsibility disappears without an explicit ended snapshot.
    node([floorCommitment()], 372)
  ];
  const result = auditExpenseResponsibilities({
    routeRecords: [{ caseSlug: "historical-floor", history }],
    annotations: []
  });
  assert.equal(result.adultBaselineOnlyAfterResponsibilityStatus, "observed");
  assert.equal(result.adultBaselineOnlyAfterResponsibilityCount, 1);
  assert.deepEqual(result.details.floorOnlyAfterResponsibility[0].materialResponsibilityKeys, ["primary_residence:main"]);
});

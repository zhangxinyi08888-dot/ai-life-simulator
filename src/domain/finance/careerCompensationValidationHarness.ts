import { createHash } from "node:crypto";
import { initializeCareerState } from "../career/careerState";
import type { AcceptedCareerTransition, CareerStateCollection } from "../career/types";
import type { WorldStateSnapshot } from "../../types";
import {
  completeDueCareerCompensationReviewProposals,
  reclassifyBoundedStudentEngagement,
  resolveCareerCompensationEstimate
} from "./careerCompensationPolicy";
import { commitFinancialDomainTransaction } from "./commitFinancialDomainTransaction";
import { initializeFinancialLedger } from "./initializeLedger";
import { PRIMARY_CASH_ACCOUNT_ID } from "./ledgerMath";
import { validateFinancialProposals } from "./validateFinancialProposals";
import type { AcceptedFinancialEvent, FinancialLedger } from "./types";

export interface CareerCompensationValidationCases {
  schemaVersion: number;
  baselineCommit: string;
  periodStartAgeInMonths: number;
  periodEndAgeInMonths: number;
  transitionMonths: number[];
  oldMonthlySalaryWan: number;
  role: {
    occupation: string;
    industry: string;
    organization: string;
    narrative: string;
  };
  metamorphicRoleTexts: string[];
  requiredMutationGuards: string[];
}

interface Snapshot {
  career: CareerStateCollection;
  financialLedger: FinancialLedger;
  worldState: WorldStateSnapshot;
}

const evidence = [{
  source: "accepted_simulation_outcome" as const,
  reasonCode: "ADDITIONAL_VALIDATION",
  confidence: 1
}];

function canonical(value: unknown): string {
  return JSON.stringify(value);
}

function digest(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

function world(career: CareerStateCollection): WorldStateSnapshot {
  const current = career.careerStates.find((item) => item.id === career.currentCareerStateId)!;
  return {
    people: [], directionArcs: [], pressureArcs: [],
    careerStates: structuredClone(career.careerStates),
    currentCareerStateId: career.currentCareerStateId,
    currentEmploymentStatus: current.employmentStatus,
    careerRevision: career.careerRevision,
    committedTransactionIds: [], version: 2
  };
}

function opening(cases: CareerCompensationValidationCases): Snapshot {
  const oldCareer = initializeCareerState({
    id: "career_internship_legacy",
    employmentStatus: "employed",
    occupation: "网页设计实习生",
    effectiveFromAgeInMonths: cases.periodStartAgeInMonths - 12
  });
  const career: CareerStateCollection = {
    careerStates: [oldCareer], currentCareerStateId: oldCareer.id, careerRevision: 0
  };
  return {
    career,
    financialLedger: initializeFinancialLedger({
      id: "additional_validation",
      asOfAgeInMonths: cases.periodStartAgeInMonths,
      openingPosition: {
        cashAccounts: [{
          id: PRIMARY_CASH_ACCOUNT_ID, type: "bank_deposit", balanceWan: 100,
          status: "active", factStatus: "known", evidence
        }],
        incomeSources: [{
          id: "legacy_internship_salary", type: "salary", displayName: "旧实习工资",
          monthlyNetAmountWan: cases.oldMonthlySalaryWan, accrualPolicy: "monthly",
          activeFromAgeInMonths: cases.periodStartAgeInMonths - 12,
          status: "active", linkedCareerStateId: oldCareer.id,
          factStatus: "known", evidence
        }]
      }
    }),
    worldState: world(career)
  };
}

function transitionAt(cases: CareerCompensationValidationCases, transitionMonth: number) {
  const nextCareer = initializeCareerState({
    id: `career_frontend_${transitionMonth}`,
    employmentStatus: "employed",
    occupation: cases.role.occupation,
    industry: cases.role.industry,
    organization: cases.role.organization,
    effectiveFromAgeInMonths: transitionMonth
  });
  const transition: AcceptedCareerTransition = {
    id: `accepted_frontend_${transitionMonth}`,
    proposalId: `frontend_${transitionMonth}`,
    fromCareerStateId: "career_internship_legacy",
    nextCareerState: nextCareer,
    effectiveAtAgeInMonths: transitionMonth,
    evidence: [{ ...evidence[0], excerpt: cases.role.narrative }],
    acceptedByReasonCodes: ["ADDITIONAL_VALIDATION"]
  };
  const estimate = resolveCareerCompensationEstimate({
    careerState: nextCareer,
    narrativeText: cases.role.narrative,
    effectiveAtAgeInMonths: transitionMonth,
    calendarYear: 2026
  });
  const events: AcceptedFinancialEvent[] = [
    {
      id: `end_legacy_salary_${transitionMonth}`,
      kind: "income_source_ended",
      effectiveAtAgeInMonths: transitionMonth,
      payload: { incomeSourceId: "legacy_internship_salary" },
      evidence,
      acceptedByReasonCodes: ["ADDITIONAL_VALIDATION"]
    },
    {
      id: `start_frontend_salary_${transitionMonth}`,
      kind: "income_source_started",
      effectiveAtAgeInMonths: transitionMonth,
      payload: {
        id: `frontend_salary_${transitionMonth}`,
        type: "salary",
        displayName: "职位薪资策略估算",
        monthlyNetAmountWan: estimate.monthlyNetAmountWan,
        accrualPolicy: "monthly",
        activeFromAgeInMonths: transitionMonth,
        status: "active",
        linkedCareerStateId: nextCareer.id,
        factStatus: "estimated",
        compensationEstimate: estimate,
        evidence: [{
          source: "system_policy",
          reasonCode: "VERSIONED_COMPENSATION_POLICY",
          confidence: estimate.confidence,
          excerpt: cases.role.narrative
        }]
      },
      evidence,
      acceptedByReasonCodes: ["ADDITIONAL_VALIDATION"]
    }
  ];
  return { nextCareer, transition, estimate, events };
}

function commitBoundary(cases: CareerCompensationValidationCases, transitionMonth: number) {
  const initial = opening(cases);
  const change = transitionAt(cases, transitionMonth);
  const committed = commitFinancialDomainTransaction({
    transactionId: `boundary_${transitionMonth}`,
    periodStartAgeInMonths: cases.periodStartAgeInMonths,
    periodEndAgeInMonths: cases.periodEndAgeInMonths,
    expectedCareerRevision: initial.career.careerRevision,
    expectedLedgerRevision: initial.financialLedger.revision,
    currentCareer: initial.career,
    currentFinancialLedger: initial.financialLedger,
    currentWorldState: initial.worldState,
    acceptedCareerTransitions: [change.transition],
    acceptedFinancialEvents: change.events,
    liquidityPolicy: "require_explicit"
  });
  return { initial, change, committed };
}

function activeCareerIncomeCount(ledger: FinancialLedger, month: number): number {
  return ledger.incomeSources.filter((source) => (
    Boolean(source.linkedCareerStateId)
    && source.activeFromAgeInMonths <= month
    && (source.activeUntilAgeInMonths === undefined || source.activeUntilAgeInMonths > month)
  )).length;
}

function continueWithReview(cases: CareerCompensationValidationCases, snapshot: Snapshot, transitionMonth: number) {
  const currentCareer = snapshot.career.careerStates.find((item) => item.id === snapshot.career.currentCareerStateId)!;
  const periodStart = cases.periodEndAgeInMonths;
  const periodEnd = periodStart + 12;
  const narrative = `你继续担任${cases.role.occupation}，完成年度薪资复核。`;
  const proposals = completeDueCareerCompensationReviewProposals({
    proposals: [], currentLedger: snapshot.financialLedger, currentCareerState: currentCareer,
    periodStartAgeInMonths: periodStart, periodEndAgeInMonths: periodEnd,
    acceptedOutcomeId: "restore_review", narrativeText: narrative, calendarYear: 2027
  });
  const validated = validateFinancialProposals({
    proposals, currentLedger: snapshot.financialLedger, currentCareerState: currentCareer,
    acceptedOutcomeId: "restore_review", narrativeText: narrative,
    periodStartAgeInMonths: periodStart, periodEndAgeInMonths: periodEnd,
    simulationTransactionId: `restore_review_${transitionMonth}`,
    allowedCareerStateIds: [currentCareer.id], liquidityPolicy: "require_explicit"
  });
  if (validated.issues.some((issue) => issue.severity === "blocking")) {
    throw new Error("RESTORE_REVIEW_VALIDATION_BLOCKED");
  }
  const result = commitFinancialDomainTransaction({
    transactionId: `restore_review_${transitionMonth}`,
    periodStartAgeInMonths: periodStart,
    periodEndAgeInMonths: periodEnd,
    expectedCareerRevision: snapshot.career.careerRevision,
    expectedLedgerRevision: snapshot.financialLedger.revision,
    currentCareer: snapshot.career,
    currentFinancialLedger: snapshot.financialLedger,
    currentWorldState: snapshot.worldState,
    acceptedCareerTransitions: [],
    acceptedFinancialEvents: validated.acceptedEvents,
    liquidityPolicy: "require_explicit"
  });
  return { result, acceptedEvents: validated.acceptedEvents };
}

export function runCareerCompensationAdditionalValidation(cases: CareerCompensationValidationCases) {
  const boundaryMatrix = cases.transitionMonths.map((transitionMonth) => {
    const { change, committed } = commitBoundary(cases, transitionMonth);
    const oldMonths = transitionMonth - cases.periodStartAgeInMonths;
    const newMonths = cases.periodEndAgeInMonths - transitionMonth;
    const expectedIncomeWan = Number((
      oldMonths * cases.oldMonthlySalaryWan
      + newMonths * change.estimate.monthlyNetAmountWan
    ).toFixed(4));
    const actualIncomeWan = committed.financialPeriodSummary?.incomeWan ?? Number.NaN;
    const monthlyCoverage = Array.from(
      { length: cases.periodEndAgeInMonths - cases.periodStartAgeInMonths },
      (_, index) => activeCareerIncomeCount(committed.financialLedger, cases.periodStartAgeInMonths + index)
    );
    return {
      transitionMonth,
      oldIncomeMonths: oldMonths,
      newIncomeMonths: newMonths,
      estimatedMonthlySalaryWan: change.estimate.monthlyNetAmountWan,
      expectedIncomeWan,
      actualIncomeWan,
      incomeMatches: actualIncomeWan === expectedIncomeWan,
      monthlyCoverage,
      exactlyOneCareerIncomePerMonth: monthlyCoverage.every((count) => count === 1),
      noOldSalaryReuse: change.estimate.monthlyNetAmountWan !== cases.oldMonthlySalaryWan,
      sameMonthEffective: change.events[1].effectiveAtAgeInMonths === transitionMonth
    };
  });

  const metamorphicEstimates = cases.metamorphicRoleTexts.map((occupation, index) => {
    const careerState = initializeCareerState({
      id: `metamorphic_${index}`, employmentStatus: "employed", occupation,
      industry: cases.role.industry, organization: cases.role.organization,
      effectiveFromAgeInMonths: cases.periodStartAgeInMonths
    });
    const estimate = resolveCareerCompensationEstimate({
      careerState, effectiveAtAgeInMonths: cases.periodStartAgeInMonths, calendarYear: 2026
    });
    return {
      occupation,
      normalizedInputs: estimate.inputs,
      monthlyNetRangeWan: estimate.monthlyNetRangeWan,
      monthlyNetAmountWan: estimate.monthlyNetAmountWan,
      policyId: estimate.policyId,
      policyVersion: estimate.policyVersion
    };
  });
  const metamorphicEquivalent = metamorphicEstimates.every((item) => (
    canonical(item.normalizedInputs) === canonical(metamorphicEstimates[0].normalizedInputs)
    && canonical(item.monthlyNetRangeWan) === canonical(metamorphicEstimates[0].monthlyNetRangeWan)
    && item.monthlyNetAmountWan === metamorphicEstimates[0].monthlyNetAmountWan
  ));

  const recoveryMonth = cases.transitionMonths.find((month) => (
    month > cases.periodStartAgeInMonths && month < cases.periodEndAgeInMonths
  )) ?? cases.periodStartAgeInMonths;
  const boundary = commitBoundary(cases, recoveryMonth).committed;
  const liveSnapshot: Snapshot = {
    career: boundary.career,
    financialLedger: boundary.financialLedger,
    worldState: boundary.worldState
  };
  const restoredSnapshot = JSON.parse(JSON.stringify(liveSnapshot)) as Snapshot;
  const liveContinuation = continueWithReview(cases, liveSnapshot, recoveryMonth);
  const restoredContinuation = continueWithReview(cases, restoredSnapshot, recoveryMonth);
  const restoreEquivalent = canonical(liveContinuation.result) === canonical(restoredContinuation.result);
  const repeated = commitFinancialDomainTransaction({
    transactionId: `restore_review_${recoveryMonth}`,
    periodStartAgeInMonths: cases.periodEndAgeInMonths,
    periodEndAgeInMonths: cases.periodEndAgeInMonths + 12,
    expectedCareerRevision: restoredContinuation.result.career.careerRevision,
    expectedLedgerRevision: restoredContinuation.result.financialLedger.revision,
    currentCareer: restoredContinuation.result.career,
    currentFinancialLedger: restoredContinuation.result.financialLedger,
    currentWorldState: restoredContinuation.result.worldState,
    acceptedCareerTransitions: [],
    acceptedFinancialEvents: restoredContinuation.acceptedEvents,
    liquidityPolicy: "require_explicit"
  });

  const mutationGuards: Record<string, boolean> = {};
  const missingSalaryInitial = opening(cases);
  const missingSalaryChange = transitionAt(cases, recoveryMonth);
  try {
    commitFinancialDomainTransaction({
      transactionId: "mutant_missing_salary",
      periodStartAgeInMonths: cases.periodStartAgeInMonths,
      periodEndAgeInMonths: cases.periodEndAgeInMonths,
      expectedCareerRevision: 0,
      expectedLedgerRevision: 0,
      currentCareer: missingSalaryInitial.career,
      currentFinancialLedger: missingSalaryInitial.financialLedger,
      currentWorldState: missingSalaryInitial.worldState,
      acceptedCareerTransitions: [missingSalaryChange.transition],
      acceptedFinancialEvents: [],
      liquidityPolicy: "require_explicit"
    });
    mutationGuards.missing_same_month_compensation_rolls_back = false;
  } catch {
    mutationGuards.missing_same_month_compensation_rolls_back = (
      missingSalaryInitial.career.careerRevision === 0
      && missingSalaryInitial.financialLedger.revision === 0
      && missingSalaryInitial.worldState.committedTransactionIds?.length === 0
    );
  }
  mutationGuards.cross_career_salary_is_not_reused = boundaryMatrix.every((item) => item.noOldSalaryReuse);

  const student = initializeCareerState({
    id: "mutation_student", employmentStatus: "student", occupation: "大学生", effectiveFromAgeInMonths: 216
  });
  const intern = initializeCareerState({
    id: "mutation_intern", employmentStatus: "employed", occupation: "前端实习生", effectiveFromAgeInMonths: 251
  });
  const internshipNarrative = "你参加了为期两个月的前端实习，税后月薪0.3万元。";
  const engagement = reclassifyBoundedStudentEngagement({
    currentCareerState: student,
    transitions: [{
      id: "mutation_internship", proposalId: "mutation_internship", fromCareerStateId: student.id,
      nextCareerState: intern, effectiveAtAgeInMonths: 251,
      evidence: [{ ...evidence[0], excerpt: internshipNarrative }],
      acceptedByReasonCodes: ["ADDITIONAL_VALIDATION"]
    }],
    narrativeText: internshipNarrative,
    acceptedOutcomeId: "mutation_internship"
  });
  const engagementSource = engagement.proposals[0]?.payload as { activeFromAgeInMonths?: number; activeUntilAgeInMonths?: number } | undefined;
  mutationGuards.bounded_internship_has_exact_end = engagement.transitions.length === 0
    && engagementSource?.activeUntilAgeInMonths === (engagementSource?.activeFromAgeInMonths ?? 0) + 2;

  const gapCareerState = initializeCareerState({
    id: "mutation_unemployed", employmentStatus: "not_working", effectiveFromAgeInMonths: cases.periodStartAgeInMonths
  });
  const gapCareer: CareerStateCollection = {
    careerStates: [gapCareerState], currentCareerStateId: gapCareerState.id, careerRevision: 0
  };
  const gapLedger = initializeFinancialLedger({
    id: "mutation_gap", asOfAgeInMonths: cases.periodStartAgeInMonths,
    openingPosition: { expenseCommitments: [{
      id: "mutation_living", type: "basic_living", displayName: "生活费", monthlyAmountWan: 1,
      activeFromAgeInMonths: cases.periodStartAgeInMonths, status: "active", factStatus: "known", evidence
    }] }
  });
  try {
    commitFinancialDomainTransaction({
      transactionId: "mutant_auto_shortfall",
      periodStartAgeInMonths: cases.periodStartAgeInMonths,
      periodEndAgeInMonths: cases.periodStartAgeInMonths + 1,
      expectedCareerRevision: 0, expectedLedgerRevision: 0,
      currentCareer: gapCareer, currentFinancialLedger: gapLedger, currentWorldState: world(gapCareer),
      acceptedCareerTransitions: [], acceptedFinancialEvents: [], liquidityPolicy: "require_explicit"
    });
    mutationGuards.strict_gap_creates_no_debt = false;
  } catch (error: any) {
    mutationGuards.strict_gap_creates_no_debt = error?.code === "UNRESOLVED_FUNDING_GAP"
      && gapLedger.debtAccounts.length === 0 && gapLedger.revision === 0;
  }
  mutationGuards.duplicate_transaction_is_idempotent = repeated.alreadyCommitted
    && repeated.financialLedger.revision === restoredContinuation.result.financialLedger.revision;
  const restoredSalary = restoredContinuation.result.financialLedger.incomeSources.find((source) => (
    source.linkedCareerStateId === restoredContinuation.result.career.currentCareerStateId
  ));
  mutationGuards.policy_metadata_survives_json_restore = restoreEquivalent
    && restoredSalary?.compensationEstimate?.policyVersion === 1;

  const requiredMutationGuardsPassed = cases.requiredMutationGuards.every((guard) => mutationGuards[guard] === true);
  const allPassed = boundaryMatrix.every((item) => (
    item.incomeMatches && item.exactlyOneCareerIncomePerMonth
    && item.noOldSalaryReuse && item.sameMonthEffective
  )) && metamorphicEquivalent && restoreEquivalent && requiredMutationGuardsPassed;

  return {
    schemaVersion: 1,
    inputSchemaVersion: cases.schemaVersion,
    baselineCommit: cases.baselineCommit,
    deterministic: true,
    inputDigestSha256: digest(cases),
    allPassed,
    summary: {
      boundaryCases: boundaryMatrix.length,
      metamorphicCases: metamorphicEstimates.length,
      mutationGuards: Object.keys(mutationGuards).length,
      restoredLedgerRevision: restoredContinuation.result.financialLedger.revision,
      restoredLedgerDigestSha256: digest(restoredContinuation.result.financialLedger)
    },
    boundaryMatrix,
    metamorphic: { equivalent: metamorphicEquivalent, estimates: metamorphicEstimates },
    recovery: {
      checkpointAgeInMonths: cases.periodEndAgeInMonths,
      continuationEndAgeInMonths: cases.periodEndAgeInMonths + 12,
      restoreEquivalent,
      duplicateTransactionAlreadyCommitted: repeated.alreadyCommitted,
      finalLedgerDigestSha256: digest(restoredContinuation.result.financialLedger)
    },
    mutationGuards
  };
}

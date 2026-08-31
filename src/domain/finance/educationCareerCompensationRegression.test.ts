import assert from "node:assert/strict";
import test from "node:test";
import { initializeCareerState } from "../career/careerState";
import type { AcceptedCareerTransition, CareerStateCollection } from "../career/types";
import type { WorldStateSnapshot } from "../../types";
import { completeCareerCompensationProposals, completeDueCareerCompensationReviewProposals, reclassifyBoundedStudentEngagement } from "./careerCompensationPolicy";
import { commitFinancialDomainTransaction } from "./commitFinancialDomainTransaction";
import { initializeFinancialLedger } from "./initializeLedger";
import { PRIMARY_CASH_ACCOUNT_ID } from "./ledgerMath";
import { validateFinancialProposals } from "./validateFinancialProposals";
import type { AcceptedFinancialEvent, FinancialLedger } from "./types";

const STUDENT_START = 18 * 12;

function world(career: CareerStateCollection): WorldStateSnapshot {
  const current = career.careerStates.find((item) => item.id === career.currentCareerStateId)!;
  return {
    people: [], directionArcs: [], pressureArcs: [], careerStates: structuredClone(career.careerStates),
    currentCareerStateId: career.currentCareerStateId, currentEmploymentStatus: current.employmentStatus,
    careerRevision: career.careerRevision, committedTransactionIds: [], version: 2
  };
}

function opening() {
  const student = initializeCareerState({
    id: "career_student", employmentStatus: "student", occupation: "计算机与交互设计专业学生",
    effectiveFromAgeInMonths: STUDENT_START
  });
  const career: CareerStateCollection = { careerStates: [student], currentCareerStateId: student.id, careerRevision: 0 };
  const ledger = initializeFinancialLedger({
    id: "education_regression", asOfAgeInMonths: STUDENT_START,
    openingPosition: {
      incomeSources: [{
        id: "student_basic_family_support", type: "family_support", displayName: "家庭生活支持",
        monthlyNetAmountWan: 0.2, accrualPolicy: "monthly", activeFromAgeInMonths: STUDENT_START,
        status: "active", factStatus: "known",
        evidence: [{ source: "accepted_history", reasonCode: "STUDENT_BASIC_LIVING_FAMILY_COVERED", confidence: 1 }]
      }],
      expenseCommitments: [{
        id: "student_living", type: "basic_living", displayName: "学生生活费", monthlyAmountWan: 0.2,
        activeFromAgeInMonths: STUDENT_START, status: "active", factStatus: "known",
        evidence: [{ source: "accepted_history", reasonCode: "STUDENT_LIVING", confidence: 1 }]
      }]
    }
  });
  return { career, ledger, world: world(career) };
}

function commit(input: {
  transactionId: string;
  start: number;
  end: number;
  career: CareerStateCollection;
  ledger: FinancialLedger;
  world: WorldStateSnapshot;
  transitions?: AcceptedCareerTransition[];
  events?: AcceptedFinancialEvent[];
}) {
  return commitFinancialDomainTransaction({
    transactionId: input.transactionId,
    periodStartAgeInMonths: input.start,
    periodEndAgeInMonths: input.end,
    expectedCareerRevision: input.career.careerRevision,
    expectedLedgerRevision: input.ledger.revision,
    currentCareer: input.career,
    currentFinancialLedger: input.ledger,
    currentWorldState: input.world,
    acceptedCareerTransitions: input.transitions || [],
    acceptedFinancialEvents: input.events || [],
    liquidityPolicy: "require_explicit"
  });
}

function replayEducationRoute() {
  const initial = opening();
  const freelance: AcceptedFinancialEvent<"one_off_income_received"> = {
    id: "accepted_remote_design_receipt", proposalId: "remote_design_receipt", kind: "one_off_income_received",
    effectiveAtAgeInMonths: 230,
    payload: { destinationCashAccountId: PRIMARY_CASH_ACCOUNT_ID, amountWan: 1 },
    evidence: [{ source: "accepted_simulation_outcome", reasonCode: "REMOTE_DESIGN_RECEIPT", confidence: 1, excerpt: "远程网页设计项目结算了1万元。" }],
    acceptedByReasonCodes: ["TEST"]
  };
  const afterFreelance = commit({
    transactionId: "education_freelance", start: STUDENT_START, end: 238,
    career: initial.career, ledger: initial.ledger, world: initial.world, events: [freelance]
  });

  const internCareer = initializeCareerState({
    id: "career_intern", employmentStatus: "employed", occupation: "网页设计实习生", effectiveFromAgeInMonths: 251
  });
  const internshipNarrative = "你参加了为期两个月的暑期网页设计实习，税后月薪0.3万元。";
  const internshipTransition: AcceptedCareerTransition = {
    id: "accepted_internship", proposalId: "internship", fromCareerStateId: "career_student",
    nextCareerState: internCareer, effectiveAtAgeInMonths: 251,
    evidence: [{ source: "accepted_simulation_outcome", reasonCode: "INTERNSHIP", confidence: 1, excerpt: internshipNarrative }],
    acceptedByReasonCodes: ["TEST"]
  };
  const engagement = reclassifyBoundedStudentEngagement({
    currentCareerState: afterFreelance.career.careerStates[0], transitions: [internshipTransition],
    narrativeText: internshipNarrative, acceptedOutcomeId: "internship_outcome"
  });
  const validatedInternship = validateFinancialProposals({
    proposals: engagement.proposals,
    currentLedger: afterFreelance.financialLedger,
    currentCareerState: afterFreelance.career.careerStates[0],
    acceptedOutcomeId: "internship_outcome",
    narrativeText: internshipNarrative,
    periodStartAgeInMonths: 238,
    periodEndAgeInMonths: 264,
    simulationTransactionId: "education_internship",
    allowedCareerStateIds: ["career_student"],
    liquidityPolicy: "require_explicit"
  });
  assert.equal(validatedInternship.issues.filter((issue) => issue.severity === "blocking").length, 0);
  const afterInternship = commit({
    transactionId: "education_internship", start: 238, end: 264,
    career: afterFreelance.career, ledger: afterFreelance.financialLedger, world: afterFreelance.worldState,
    transitions: engagement.transitions, events: validatedInternship.acceptedEvents
  });

  const fullTime = initializeCareerState({
    id: "career_head_internet_frontend", employmentStatus: "employed",
    occupation: "应届前端工程师", industry: "互联网", organization: "头部互联网公司",
    effectiveFromAgeInMonths: 264
  });
  const fullTimeNarrative = "毕业后，你正式加入头部互联网公司，担任应届前端工程师。";
  const graduation: AcceptedCareerTransition = {
    id: "accepted_graduation", proposalId: "graduation", fromCareerStateId: "career_student",
    nextCareerState: fullTime, effectiveAtAgeInMonths: 264,
    evidence: [{ source: "accepted_simulation_outcome", reasonCode: "GRADUATION", confidence: 1, excerpt: fullTimeNarrative }],
    acceptedByReasonCodes: ["TEST"]
  };
  const compensationProposals = completeCareerCompensationProposals({
    proposals: [], currentLedger: afterInternship.financialLedger, transition: graduation,
    acceptedOutcomeId: "graduation_outcome", narrativeText: fullTimeNarrative, calendarYear: 2026
  });
  const validatedCompensation = validateFinancialProposals({
    proposals: compensationProposals,
    currentLedger: afterInternship.financialLedger,
    currentCareerState: afterInternship.career.careerStates.find((item) => item.id === "career_student")!,
    acceptedOutcomeId: "graduation_outcome", narrativeText: fullTimeNarrative,
    periodStartAgeInMonths: 264, periodEndAgeInMonths: 276,
    simulationTransactionId: "education_full_time", allowedCareerStateIds: [fullTime.id],
    liquidityPolicy: "require_explicit"
  });
  assert.equal(validatedCompensation.issues.filter((issue) => issue.severity === "blocking").length, 0);
  const afterEmploymentStart = commit({
    transactionId: "education_full_time_start", start: 264, end: 276,
    career: afterInternship.career, ledger: afterInternship.financialLedger, world: afterInternship.worldState,
    transitions: [graduation], events: validatedCompensation.acceptedEvents
  });
  const reviewProposals = completeDueCareerCompensationReviewProposals({
    proposals: [], currentLedger: afterEmploymentStart.financialLedger,
    currentCareerState: afterEmploymentStart.career.careerStates.find((item) => item.id === fullTime.id)!,
    periodStartAgeInMonths: 276, periodEndAgeInMonths: 388,
    acceptedOutcomeId: "career_review_outcome",
    narrativeText: "你继续在头部互联网公司担任前端工程师，完成了年度薪资复核。",
    calendarYear: 2027
  });
  const validatedReviews = validateFinancialProposals({
    proposals: reviewProposals,
    currentLedger: afterEmploymentStart.financialLedger,
    currentCareerState: afterEmploymentStart.career.careerStates.find((item) => item.id === fullTime.id)!,
    acceptedOutcomeId: "career_review_outcome",
    narrativeText: "你继续在头部互联网公司担任前端工程师，完成了年度薪资复核。",
    periodStartAgeInMonths: 276, periodEndAgeInMonths: 388,
    simulationTransactionId: "education_full_time_reviews",
    allowedCareerStateIds: [fullTime.id], liquidityPolicy: "require_explicit"
  });
  assert.equal(validatedReviews.issues.filter((issue) => issue.severity === "blocking").length, 0);
  const afterFullTime = commit({
    transactionId: "education_full_time_reviews", start: 276, end: 388,
    career: afterEmploymentStart.career, ledger: afterEmploymentStart.financialLedger,
    world: afterEmploymentStart.worldState, events: validatedReviews.acceptedEvents
  });
  return { afterFreelance, afterInternship, afterEmploymentStart, afterFullTime };
}

test("education regression replays freelance, bounded internship, graduation estimate, and 124 paid months without automatic debt", () => {
  const first = replayEducationRoute();
  const second = replayEducationRoute();
  const internship = first.afterInternship.financialLedger.incomeSources.find((source) => source.id.startsWith("student_engagement_"))!;
  const supportBeforeGraduation = first.afterInternship.financialLedger.incomeSources.find((source) => source.id === "student_basic_family_support")!;
  const fullTimeIncome = first.afterFullTime.financialLedger.incomeSources.find((source) => source.linkedCareerStateId === "career_head_internet_frontend")!;
  const supportAfterGraduation = first.afterFullTime.financialLedger.incomeSources.find((source) => source.id === "student_basic_family_support")!;

  assert.equal(first.afterFreelance.financialPeriodSummary?.incomeWan, 5.4);
  assert.equal(first.afterInternship.financialPeriodSummary?.incomeWan, 5.8);
  assert.equal(internship.activeFromAgeInMonths, 251);
  assert.equal(internship.activeUntilAgeInMonths, 253);
  assert.equal(internship.monthlyNetAmountWan, 0.3);
  assert.equal(supportBeforeGraduation.status, "active");
  assert.equal(first.afterInternship.worldState.currentEmploymentStatus, "student");
  assert.equal(fullTimeIncome.factStatus, "estimated");
  assert.equal(fullTimeIncome.activeFromAgeInMonths, 264);
  assert.notEqual(fullTimeIncome.monthlyNetAmountWan, 0.3);
  assert.equal(fullTimeIncome.compensationEstimate?.policyVersion, 1);
  assert.equal(supportAfterGraduation.status, "ended");
  assert.equal(supportAfterGraduation.activeUntilAgeInMonths, 264);
  const paidIncomeWan = Number((first.afterEmploymentStart.financialPeriodSummary!.incomeWan
    + first.afterFullTime.financialPeriodSummary!.incomeWan).toFixed(4));
  const baselineMonthlyWan = fullTimeIncome.compensationEstimate!.baselineMonthlyNetAmountWan!;
  let expectedPaidIncomeWan = 0;
  for (let month = 264; month < 388; month += 1) {
    const completedReviewCount = Math.max(0, Math.floor((month - 264) / 12));
    const growthRate = Math.min(0.2, completedReviewCount * 0.04);
    expectedPaidIncomeWan += Math.round(baselineMonthlyWan * (1 + growthRate) * 100) / 100;
  }
  assert.equal(paidIncomeWan, Number(expectedPaidIncomeWan.toFixed(4)));
  assert.equal(fullTimeIncome.compensationEstimate?.cumulativeGrowthRate, 0.2);
  assert.equal(fullTimeIncome.compensationEstimate?.reviewAtAgeInMonths, 396);
  assert.equal(first.afterFullTime.financialLedger.debtAccounts.some((debt) => debt.origin === "system_auto_shortfall"), false);
  assert.deepEqual(first.afterFullTime.financialLedger, second.afterFullTime.financialLedger);
  assert.deepEqual(first.afterFullTime.financialPeriodSummary, second.afterFullTime.financialPeriodSummary);
});

test("fault injection: a paid CareerState without same-month compensation rolls back the entire transaction", () => {
  const initial = opening();
  const next = initializeCareerState({ id: "career_missing_salary", employmentStatus: "employed", occupation: "前端工程师", effectiveFromAgeInMonths: 240 });
  const transition: AcceptedCareerTransition = {
    id: "accepted_missing_salary", proposalId: "missing_salary", fromCareerStateId: "career_student",
    nextCareerState: next, effectiveAtAgeInMonths: 240, evidence: [{ source: "accepted_simulation_outcome", reasonCode: "TEST", confidence: 1 }],
    acceptedByReasonCodes: ["TEST"]
  };
  const beforeCareer = structuredClone(initial.career);
  const beforeLedger = structuredClone(initial.ledger);
  const beforeWorld = structuredClone(initial.world);
  assert.throws(() => commit({
    transactionId: "incomplete_paid_transition", start: STUDENT_START, end: 240,
    career: initial.career, ledger: initial.ledger, world: initial.world, transitions: [transition]
  }), /缺少同月 known\/estimated 收入决议/);
  assert.deepEqual(initial.career, beforeCareer);
  assert.deepEqual(initial.ledger, beforeLedger);
  assert.deepEqual(initial.world, beforeWorld);
});

test("fault injection: strict recurring settlement creates no debt and reports an unresolved funding gap", () => {
  const student = initializeCareerState({ id: "student", employmentStatus: "student", effectiveFromAgeInMonths: STUDENT_START });
  const career: CareerStateCollection = { careerStates: [student], currentCareerStateId: student.id, careerRevision: 0 };
  const ledger = initializeFinancialLedger({
    id: "unfunded", asOfAgeInMonths: STUDENT_START,
    openingPosition: { expenseCommitments: [{
      id: "living", type: "basic_living", displayName: "生活费", monthlyAmountWan: 0.2,
      activeFromAgeInMonths: STUDENT_START, status: "active", factStatus: "known", evidence: []
    }] }
  });
  assert.throws(() => commit({
    transactionId: "unresolved_gap", start: STUDENT_START, end: STUDENT_START + 1,
    career, ledger, world: world(career)
  }), (error: any) => error?.code === "UNRESOLVED_FUNDING_GAP");
  assert.equal(ledger.debtAccounts.length, 0);
  assert.equal(ledger.revision, 0);
  assert.equal(ledger.asOfAgeInMonths, STUDENT_START);
});

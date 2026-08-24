import assert from "node:assert/strict";
import test from "node:test";
import { initializeCareerState } from "../../domain/career/careerState";
import type { AcceptedCareerTransition, CareerState, CareerStateCollection } from "../../domain/career/types";
import {
  completeCareerCompensationProposals,
  completeDueCareerCompensationReviewProposals,
  reclassifyBoundedStudentEngagement
} from "../../domain/finance/careerCompensationPolicy";
import { commitFinancialDomainTransaction } from "../../domain/finance/commitFinancialDomainTransaction";
import type { CommittedFinancialDomainTransaction } from "../../domain/finance/commitFinancialDomainTransaction";
import { completeCareerIncomeReplacementProposals } from "../../domain/finance/completeCareerIncomeReplacement";
import { initializeFinancialLedger } from "../../domain/finance/initializeLedger";
import { PRIMARY_CASH_ACCOUNT_ID } from "../../domain/finance/ledgerMath";
import { reconcileCareerIncomeAtomicity } from "../../domain/finance/reconcileCareerIncomeAtomicity";
import { validateFinancialProposals } from "../../domain/finance/validateFinancialProposals";
import type {
  AcceptedFinancialEvent,
  FinancialEventProposal,
  FinancialEvidence,
  FinancialLedger,
  IncomeSource
} from "../../domain/finance/types";
import type { FinalLifeOutcome, HistoryItem, WorldStateSnapshot } from "../../types";
import {
  collectFinalFinancialNarrativeIssues
} from "../../utils/finalFinancialNarrativeAuthority";
import { getAuthoritativeFinalFinancialContext } from "../../utils/finalOutcomeFinancialContext";

const ROUTE_START = 276;
const evidence: FinancialEvidence[] = [{
  source: "accepted_simulation_outcome",
  sourceEventId: "cca_route_outcome",
  reasonCode: "CCA_END_TO_END",
  confidence: 1
}];

interface Snapshot {
  career: CareerStateCollection;
  ledger: FinancialLedger;
  world: WorldStateSnapshot;
}

function state(input: {
  id: string;
  status: CareerState["employmentStatus"];
  at: number;
  occupation?: string;
  industry?: string;
  organization?: string;
}): CareerState {
  return initializeCareerState({
    id: input.id,
    employmentStatus: input.status,
    effectiveFromAgeInMonths: input.at,
    occupation: input.occupation,
    industry: input.industry,
    organization: input.organization
  });
}

function world(career: CareerStateCollection): WorldStateSnapshot {
  const current = career.careerStates.find((item) => item.id === career.currentCareerStateId)!;
  return {
    people: [],
    directionArcs: [],
    pressureArcs: [],
    careerStates: structuredClone(career.careerStates),
    currentCareerStateId: career.currentCareerStateId,
    currentEmploymentStatus: current.employmentStatus,
    careerRevision: career.careerRevision,
    committedTransactionIds: [],
    version: 2
  };
}

function acceptedTransition(input: {
  id: string;
  from: CareerState;
  to: CareerState;
  at: number;
  excerpt: string;
}): AcceptedCareerTransition {
  return {
    id: `accepted_${input.id}`,
    proposalId: input.id,
    fromCareerStateId: input.from.id,
    nextCareerState: input.to,
    effectiveAtAgeInMonths: input.at,
    evidence: [{ ...evidence[0], excerpt: input.excerpt }],
    acceptedByReasonCodes: ["CCA_END_TO_END"]
  };
}

function validate(input: {
  proposals: FinancialEventProposal[];
  snapshot: Snapshot;
  currentCareer: CareerState;
  narrative: string;
  start: number;
  end: number;
  transactionId: string;
  allowedCareerStateIds: string[];
}): AcceptedFinancialEvent[] {
  const result = validateFinancialProposals({
    proposals: input.proposals,
    currentLedger: input.snapshot.ledger,
    currentCareerState: input.currentCareer,
    acceptedOutcomeId: "cca_route_outcome",
    narrativeText: input.narrative,
    periodStartAgeInMonths: input.start,
    periodEndAgeInMonths: input.end,
    simulationTransactionId: input.transactionId,
    allowedCareerStateIds: input.allowedCareerStateIds,
    liquidityPolicy: "require_explicit"
  });
  assert.equal(
    result.issues.some((issue) => issue.severity === "blocking"),
    false,
    result.issues.map((issue) => `${issue.code}:${issue.summary}`).join("\n")
  );
  return result.acceptedEvents;
}

function commit(input: {
  transactionId: string;
  start: number;
  end: number;
  snapshot: Snapshot;
  transitions?: AcceptedCareerTransition[];
  events?: AcceptedFinancialEvent[];
}): CommittedFinancialDomainTransaction {
  return commitFinancialDomainTransaction({
    transactionId: input.transactionId,
    periodStartAgeInMonths: input.start,
    periodEndAgeInMonths: input.end,
    expectedCareerRevision: input.snapshot.career.careerRevision,
    expectedLedgerRevision: input.snapshot.ledger.revision,
    currentCareer: input.snapshot.career,
    currentFinancialLedger: input.snapshot.ledger,
    currentWorldState: input.snapshot.world,
    acceptedCareerTransitions: input.transitions || [],
    acceptedFinancialEvents: input.events || [],
    liquidityPolicy: "require_explicit"
  });
}

function snapshot(result: CommittedFinancialDomainTransaction, roundTrip: boolean): Snapshot {
  const next = { career: result.career, ledger: result.financialLedger, world: result.worldState };
  return roundTrip ? JSON.parse(JSON.stringify(next)) as Snapshot : next;
}

function activeCareerIncomeCount(ledger: FinancialLedger, month: number): number {
  return ledger.incomeSources.filter((source) => (
    Boolean(source.linkedCareerStateId)
    && ["salary", "contract", "self_employment_draw"].includes(source.type)
    && source.activeFromAgeInMonths <= month
    && (source.activeUntilAgeInMonths === undefined || source.activeUntilAgeInMonths > month)
  )).length;
}

function opening(): Snapshot {
  const student = state({ id: "career_student", status: "student", at: ROUTE_START, occupation: "计算机专业学生" });
  const career: CareerStateCollection = {
    careerStates: [student],
    currentCareerStateId: student.id,
    careerRevision: 0
  };
  const ledger = initializeFinancialLedger({
    id: "cca_main_route",
    asOfAgeInMonths: ROUTE_START,
    openingPosition: {
      cashAccounts: [{
        id: PRIMARY_CASH_ACCOUNT_ID,
        type: "bank_deposit",
        balanceWan: 0,
        status: "active",
        factStatus: "known",
        evidence
      }],
      incomeSources: [{
        id: "student_basic_family_support",
        type: "family_support",
        displayName: "家庭生活支持",
        monthlyNetAmountWan: 0.2,
        accrualPolicy: "monthly",
        activeFromAgeInMonths: ROUTE_START,
        status: "active",
        factStatus: "known",
        evidence: [{ source: "accepted_history", reasonCode: "STUDENT_BASIC_LIVING_FAMILY_COVERED", confidence: 1 }]
      }],
      expenseCommitments: [{
        id: "student_living",
        type: "basic_living",
        displayName: "学生生活费",
        monthlyAmountWan: 0.2,
        activeFromAgeInMonths: ROUTE_START,
        status: "active",
        factStatus: "known",
        evidence
      }]
    }
  });
  return { career, ledger, world: world(career) };
}

function runDeterministicRoute(roundTripEveryCheckpoint: boolean) {
  const initial = opening();
  const student = initial.career.careerStates[0];
  const internshipNarrative = "你开始为期两个月的前端实习，税后月薪0.3万元。";
  const internshipCareer = state({ id: "career_intern", status: "employed", at: 278, occupation: "前端实习生" });
  const internshipTransition = acceptedTransition({
    id: "internship",
    from: student,
    to: internshipCareer,
    at: 278,
    excerpt: internshipNarrative
  });
  const engagement = reclassifyBoundedStudentEngagement({
    currentCareerState: student,
    transitions: [internshipTransition],
    narrativeText: internshipNarrative,
    acceptedOutcomeId: "cca_route_outcome"
  });
  const internshipEvents = validate({
    proposals: engagement.proposals,
    snapshot: initial,
    currentCareer: student,
    narrative: internshipNarrative,
    start: 276,
    end: 278,
    transactionId: "cca_route_freelance_internship_start",
    allowedCareerStateIds: [student.id]
  });
  const freelance: AcceptedFinancialEvent<"one_off_income_received"> = {
    id: "accepted_freelance_receipt",
    proposalId: "freelance_receipt",
    kind: "one_off_income_received",
    effectiveAtAgeInMonths: 277,
    payload: { destinationCashAccountId: PRIMARY_CASH_ACCOUNT_ID, amountWan: 1.2 },
    evidence: [{ ...evidence[0], excerpt: "你收到一次性自由职业收入1.2万元。" }],
    acceptedByReasonCodes: ["CCA_END_TO_END"]
  };
  const afterInternshipStartResult = commit({
    transactionId: "cca_route_freelance_internship_start",
    start: 276,
    end: 278,
    snapshot: initial,
    transitions: engagement.transitions,
    events: [freelance, ...internshipEvents]
  });
  const afterInternshipStart = snapshot(afterInternshipStartResult, roundTripEveryCheckpoint);

  const fullTimeNarrative = "毕业后，你正式加入大型互联网公司担任应届前端工程师。";
  const fullTimeCareer = state({
    id: "career_full_time",
    status: "employed",
    at: 282,
    occupation: "应届前端工程师",
    industry: "互联网",
    organization: "大型互联网公司"
  });
  const graduation = acceptedTransition({
    id: "graduation",
    from: student,
    to: fullTimeCareer,
    at: 282,
    excerpt: fullTimeNarrative
  });
  let graduationProposals = completeCareerCompensationProposals({
    proposals: [],
    currentLedger: afterInternshipStart.ledger,
    transition: graduation,
    acceptedOutcomeId: "cca_route_outcome",
    narrativeText: fullTimeNarrative,
    calendarYear: 2026
  });
  graduationProposals = completeCareerIncomeReplacementProposals({
    proposals: graduationProposals,
    currentLedger: afterInternshipStart.ledger,
    currentCareerStateId: student.id,
    transition: graduation,
    acceptedOutcomeId: "cca_route_outcome"
  });
  const graduationEvents = validate({
    proposals: graduationProposals,
    snapshot: afterInternshipStart,
    currentCareer: student,
    narrative: fullTimeNarrative,
    start: 278,
    end: 282,
    transactionId: "cca_route_graduation",
    allowedCareerStateIds: [fullTimeCareer.id]
  });
  const graduationAtomic = reconcileCareerIncomeAtomicity({
    currentCareerStateId: student.id,
    currentLedger: afterInternshipStart.ledger,
    careerTransitions: [graduation],
    financialEvents: graduationEvents,
    ageInMonths: 282
  });
  assert.equal(graduationAtomic.issues.length, 0);
  const afterGraduationResult = commit({
    transactionId: "cca_route_graduation",
    start: 278,
    end: 282,
    snapshot: afterInternshipStart,
    transitions: graduationAtomic.acceptedCareerTransitions,
    events: graduationAtomic.acceptedFinancialEvents
  });
  const afterGraduation = snapshot(afterGraduationResult, roundTripEveryCheckpoint);

  const reviewNarrative = "你继续担任前端工程师，并完成第一次政策薪资复核。";
  const reviewProposals = completeDueCareerCompensationReviewProposals({
    proposals: [],
    currentLedger: afterGraduation.ledger,
    currentCareerState: afterGraduation.career.careerStates.find((item) => item.id === fullTimeCareer.id)!,
    periodStartAgeInMonths: 282,
    periodEndAgeInMonths: 294,
    acceptedOutcomeId: "cca_route_outcome",
    narrativeText: reviewNarrative,
    calendarYear: 2027
  });
  const reviewEvents = validate({
    proposals: reviewProposals,
    snapshot: afterGraduation,
    currentCareer: fullTimeCareer,
    narrative: reviewNarrative,
    start: 282,
    end: 294,
    transactionId: "cca_route_review_294",
    allowedCareerStateIds: [fullTimeCareer.id]
  });
  const afterReviewResult = commit({
    transactionId: "cca_route_review_294",
    start: 282,
    end: 294,
    snapshot: afterGraduation,
    events: reviewEvents
  });
  const afterReview = snapshot(afterReviewResult, roundTripEveryCheckpoint);

  const promotionNarrative = "你在晋升为高级前端工程师时明确确认税后月薪2.2万元。";
  const promotionCareer = state({
    id: "career_promoted",
    status: "employed",
    at: 306,
    occupation: "高级前端工程师",
    industry: "互联网",
    organization: "大型互联网公司"
  });
  const promotion = acceptedTransition({
    id: "promotion",
    from: fullTimeCareer,
    to: promotionCareer,
    at: 306,
    excerpt: promotionNarrative
  });
  const estimatedSalary = afterReview.ledger.incomeSources.find((source) => source.linkedCareerStateId === fullTimeCareer.id)!;
  const salaryWithoutEstimate = structuredClone(estimatedSalary);
  delete salaryWithoutEstimate.compensationEstimate;
  const promotedSalary: IncomeSource = {
    ...salaryWithoutEstimate,
    monthlyNetAmountWan: 2.2,
    linkedCareerStateId: promotionCareer.id,
    factStatus: "known",
    lastConfirmedAtAgeInMonths: 306
  };
  let promotionProposals: FinancialEventProposal[] = [{
    id: "promotion_salary",
    kind: "income_source_adjusted",
    effectiveAtAgeInMonths: 306,
    payload: { incomeSourceId: estimatedSalary.id, nextSource: promotedSalary },
    sourceOutcomeId: "cca_route_outcome",
    financialScope: "personal",
    evidence: promotionNarrative,
    confidence: 1
  }];
  promotionProposals = completeCareerIncomeReplacementProposals({
    proposals: promotionProposals,
    currentLedger: afterReview.ledger,
    currentCareerStateId: fullTimeCareer.id,
    transition: promotion,
    acceptedOutcomeId: "cca_route_outcome"
  });
  const promotionEvents = validate({
    proposals: promotionProposals,
    snapshot: afterReview,
    currentCareer: fullTimeCareer,
    narrative: promotionNarrative,
    start: 294,
    end: 306,
    transactionId: "cca_route_promotion_306",
    allowedCareerStateIds: [promotionCareer.id]
  });
  const promotionAtomic = reconcileCareerIncomeAtomicity({
    currentCareerStateId: fullTimeCareer.id,
    currentLedger: afterReview.ledger,
    careerTransitions: [promotion],
    financialEvents: promotionEvents,
    ageInMonths: 306
  });
  assert.equal(promotionAtomic.issues.length, 0);
  const finalResult = commit({
    transactionId: "cca_route_promotion_306",
    start: 294,
    end: 306,
    snapshot: afterReview,
    transitions: promotionAtomic.acceptedCareerTransitions,
    events: promotionAtomic.acceptedFinancialEvents
  });
  const final = snapshot(finalResult, roundTripEveryCheckpoint);
  return {
    initial,
    afterInternshipStart,
    afterInternshipStartResult,
    afterGraduation,
    afterGraduationResult,
    afterReview,
    afterReviewResult,
    final,
    finalResult,
    promotionEvents: promotionAtomic.acceptedFinancialEvents
  };
}

test("CCA-01 deterministic student-to-internship-to-employment route preserves funding and compensation authority", () => {
  const live = runDeterministicRoute(false);
  const restoredAtEveryCheckpoint = runDeterministicRoute(true);
  const internship = live.final.ledger.incomeSources.find((source) => source.id.startsWith("student_engagement_"))!;
  const familySupport = live.final.ledger.incomeSources.find((source) => source.id === "student_basic_family_support")!;
  const promotedSalary = live.final.ledger.incomeSources.find((source) => source.linkedCareerStateId === "career_promoted")!;
  const estimatedAtGraduation = live.afterGraduation.ledger.incomeSources.find((source) => source.linkedCareerStateId === "career_full_time")!;

  assert.equal(internship.monthlyNetAmountWan! * (internship.activeUntilAgeInMonths! - internship.activeFromAgeInMonths), 0.6);
  assert.equal(internship.activeFromAgeInMonths, 278);
  assert.equal(internship.activeUntilAgeInMonths, 280);
  assert.equal(live.afterInternshipStart.world.currentEmploymentStatus, "student");
  assert.equal(live.afterInternshipStart.ledger.incomeSources.find((source) => source.id === "student_basic_family_support")?.status, "active");
  assert.equal(familySupport.status, "ended");
  assert.equal(familySupport.activeUntilAgeInMonths, 282);
  assert.ok(["known", "estimated"].includes(estimatedAtGraduation.factStatus));
  assert.equal(estimatedAtGraduation.factStatus, "estimated");
  assert.equal(estimatedAtGraduation.compensationEstimate?.policyVersion, 1);
  assert.notEqual(estimatedAtGraduation.monthlyNetAmountWan, 0.3);
  assert.equal(promotedSalary.monthlyNetAmountWan, 2.2);
  assert.equal(promotedSalary.factStatus, "known");
  assert.equal(live.final.ledger.recentTransactions.some((transaction) => (
    transaction.eventIds.some((eventId) => eventId.includes("policy_compensation_review") && eventId.includes("294"))
  )), true);
  assert.equal(live.final.ledger.debtAccounts.some((debt) => debt.origin === "system_auto_shortfall"), false);
  assert.equal(Array.from({ length: 306 - ROUTE_START }, (_, index) => (
    activeCareerIncomeCount(live.final.ledger, ROUTE_START + index)
  )).every((count) => count <= 1), true);
  assert.equal(JSON.stringify(restoredAtEveryCheckpoint.final.ledger), JSON.stringify(live.final.ledger));
  assert.equal(JSON.stringify(restoredAtEveryCheckpoint.final.career), JSON.stringify(live.final.career));
  assert.equal(JSON.stringify(restoredAtEveryCheckpoint.final.world), JSON.stringify(live.final.world));

  const duplicate = commitFinancialDomainTransaction({
    transactionId: "cca_route_promotion_306",
    periodStartAgeInMonths: 294,
    periodEndAgeInMonths: 306,
    expectedCareerRevision: live.final.career.careerRevision,
    expectedLedgerRevision: live.final.ledger.revision,
    currentCareer: live.final.career,
    currentFinancialLedger: live.final.ledger,
    currentWorldState: live.final.world,
    acceptedCareerTransitions: [],
    acceptedFinancialEvents: live.promotionEvents,
    liquidityPolicy: "require_explicit"
  });
  assert.equal(duplicate.alreadyCommitted, true);
  assert.deepEqual(duplicate.financialLedger, live.final.ledger);
});

test("CCA-02 an explicit new salary atomically replaces the old salary in the effective month", () => {
  const oldCareer = state({ id: "cca_02_old", status: "employed", at: 280, occupation: "产品经理" });
  const nextCareer = state({ id: "cca_02_new", status: "employed", at: 306, occupation: "高级产品经理" });
  const career: CareerStateCollection = { careerStates: [oldCareer], currentCareerStateId: oldCareer.id, careerRevision: 0 };
  const ledger = initializeFinancialLedger({
    id: "cca_02",
    asOfAgeInMonths: 300,
    openingPosition: {
      cashAccounts: [{ id: PRIMARY_CASH_ACCOUNT_ID, type: "bank_deposit", balanceWan: 100, status: "active", factStatus: "known", evidence }],
      incomeSources: [{
        id: "old_salary", type: "salary", displayName: "旧工资", monthlyNetAmountWan: 1.2,
        accrualPolicy: "monthly", activeFromAgeInMonths: 280, status: "active",
        linkedCareerStateId: oldCareer.id, factStatus: "known", evidence
      }]
    }
  });
  const current: Snapshot = { career, ledger, world: world(career) };
  const narrative = "你在306月正式加入新公司担任高级产品经理，明确税后月薪2.2万元。";
  const accepted = acceptedTransition({ id: "cca_02_switch", from: oldCareer, to: nextCareer, at: 306, excerpt: narrative });
  let proposals: FinancialEventProposal[] = [{
    id: "new_known_salary",
    kind: "income_source_started",
    effectiveAtAgeInMonths: 306,
    payload: {
      id: "new_salary", type: "salary", displayName: "新工资", monthlyNetAmountWan: 2.2,
      accrualPolicy: "monthly", activeFromAgeInMonths: 306, status: "active",
      linkedCareerStateId: nextCareer.id, factStatus: "known", evidence: []
    },
    sourceOutcomeId: "cca_route_outcome",
    financialScope: "personal",
    evidence: narrative,
    confidence: 1
  }];
  proposals = completeCareerIncomeReplacementProposals({
    proposals,
    currentLedger: ledger,
    currentCareerStateId: oldCareer.id,
    transition: accepted,
    acceptedOutcomeId: "cca_route_outcome"
  });
  const events = validate({
    proposals,
    snapshot: current,
    currentCareer: oldCareer,
    narrative,
    start: 300,
    end: 312,
    transactionId: "cca_02_switch",
    allowedCareerStateIds: [nextCareer.id]
  });
  const atomic = reconcileCareerIncomeAtomicity({
    currentCareerStateId: oldCareer.id,
    currentLedger: ledger,
    careerTransitions: [accepted],
    financialEvents: events,
    ageInMonths: 312
  });
  assert.equal(atomic.issues.length, 0);
  const result = commit({
    transactionId: "cca_02_switch",
    start: 300,
    end: 312,
    snapshot: current,
    transitions: atomic.acceptedCareerTransitions,
    events: atomic.acceptedFinancialEvents
  });
  assert.equal(result.financialPeriodSummary?.incomeWan, 1.2 * 6 + 2.2 * 6);
  assert.equal(result.financialLedger.incomeSources.find((source) => source.id === "old_salary")?.activeUntilAgeInMonths, 306);
  assert.equal(result.financialLedger.incomeSources.find((source) => source.id === "new_salary")?.activeFromAgeInMonths, 306);
  assert.equal(result.financialLedger.incomeSources.find((source) => source.id === "new_salary")?.factStatus, "known");
  assert.equal(Array.from({ length: 12 }, (_, index) => activeCareerIncomeCount(result.financialLedger, 300 + index)).every((count) => count === 1), true);
  assert.deepEqual(
    atomic.acceptedFinancialEvents.filter((event) => event.kind === "income_source_ended" || event.kind === "income_source_started")
      .map((event) => event.effectiveAtAgeInMonths),
    [306, 306]
  );
});

test("CCA-12 final state, report authority, and numeric validation all read the terminal ledger only", () => {
  const route = runDeterministicRoute(false);
  const staleLedger = structuredClone(route.afterGraduation.ledger);
  staleLedger.incomeSources.push({
    id: "unaccepted_company_revenue",
    type: "other",
    displayName: "公司客户回款",
    monthlyNetAmountWan: 99,
    accrualPolicy: "monthly",
    activeFromAgeInMonths: 282,
    status: "active",
    factStatus: "known",
    evidence
  });
  const attributes = { happiness: 50, intelligence: 70, wealth: 50, relation: 55, health: 65 };
  const history: HistoryItem[] = [
    {
      age: 23,
      ageInMonths: 282,
      stage: "毕业",
      title: "旧快照",
      description: "公司客户回款曾出现在旧叙事中。",
      selectedChoice: "继续",
      attributes,
      choices: [],
      isEndingNode: false,
      financialLedger: staleLedger,
      financialPeriodSummary: route.afterGraduationResult.financialPeriodSummary,
      worldStateSnapshot: route.afterGraduation.world
    },
    {
      age: 25.5,
      ageInMonths: 306,
      stage: "晋升",
      title: "最终快照",
      description: "你晋升并确认了个人工资。",
      selectedChoice: "生成报告",
      attributes,
      choices: [],
      isEndingNode: true,
      financialLedger: route.final.ledger,
      financialPeriodSummary: route.finalResult.financialPeriodSummary,
      worldStateSnapshot: route.final.world
    }
  ];
  const context = getAuthoritativeFinalFinancialContext(history);
  const finalCash = route.final.ledger.cashAccounts.find((account) => account.id === PRIMARY_CASH_ACCOUNT_ID)?.balanceWan;
  assert.equal(context.state?.cashWan, finalCash);
  assert.equal(context.state?.totalDebtWan, 0);
  assert.equal(context.state?.ledgerRevision, route.final.ledger.revision);
  assert.equal(context.narrativeAuthority?.sourceLedgerRevision, route.final.ledger.revision);
  assert.equal(context.narrativeAuthority?.numericClaims.find((claim) => claim.kind === "personal_annual_income")?.valueWan, 26.4);
  assert.equal(context.allowedWanValues.includes(99), false);

  const unsupported = {
    share: {
      viralTitle: "我靠公司99万元回款实现财务自由",
      oneLineSummary: "最终个人收入达到99万元，并且债务已经清零。"
    },
    report: {
      finalLifeReading: {
        paragraphs: ["最终账外公司收入99万元已经进入个人现金，所有债务都已还清。"]
      }
    },
    meta: {}
  } as unknown as FinalLifeOutcome;
  const issues = collectFinalFinancialNarrativeIssues({
    outcome: unsupported,
    authority: context.narrativeAuthority
  });
  assert.equal(issues.some((issue) => issue.code === "REPORT_UNSUPPORTED_FINANCIAL_AMOUNT"), true);
  assert.equal(issues.some((issue) => issue.code === "REPORT_DEBT_COMPLETION_CONFLICT"), true);
});

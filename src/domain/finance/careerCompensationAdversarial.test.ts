import assert from "node:assert/strict";
import test from "node:test";
import { initializeCareerState } from "../career/careerState";
import type { AcceptedCareerTransition, CareerState, CareerStateCollection } from "../career/types";
import type { WorldStateSnapshot } from "../../types";
import {
  completeCareerCompensationProposals,
  completeDueCareerCompensationReviewProposals,
  parseBoundedEngagementMonths,
  reclassifyBoundedStudentEngagement,
  resolveCareerCompensationEstimate
} from "./careerCompensationPolicy";
import { commitFinancialDomainTransaction } from "./commitFinancialDomainTransaction";
import { completeCareerIncomeReplacementProposals } from "./completeCareerIncomeReplacement";
import { initializeFinancialLedger } from "./initializeLedger";
import { FinancialLedgerInvariantError, PRIMARY_CASH_ACCOUNT_ID } from "./ledgerMath";
import {
  narrativeClaimsNewPersonalIncomeActivity,
  reconcileCareerIncomeAtomicity
} from "./reconcileCareerIncomeAtomicity";
import { reduceFinancialLedger } from "./reduceFinancialLedger";
import { validateFinancialProposals } from "./validateFinancialProposals";
import type {
  AcceptedFinancialEvent,
  FinancialEventProposal,
  FinancialEvidence,
  FinancialLedger,
  IncomeSource
} from "./types";

const evidence: FinancialEvidence[] = [{
  source: "accepted_simulation_outcome",
  sourceEventId: "cca_outcome",
  reasonCode: "CCA_ADVERSARIAL",
  confidence: 1
}];

function career(input: {
  id: string;
  employmentStatus: CareerState["employmentStatus"];
  effectiveAt: number;
  occupation?: string;
  industry?: string;
  organization?: string;
}): CareerState {
  return initializeCareerState({
    id: input.id,
    employmentStatus: input.employmentStatus,
    effectiveFromAgeInMonths: input.effectiveAt,
    occupation: input.occupation,
    industry: input.industry,
    organization: input.organization
  });
}

function collection(current: CareerState): CareerStateCollection {
  return { careerStates: [current], currentCareerStateId: current.id, careerRevision: 0 };
}

function world(current: CareerStateCollection): WorldStateSnapshot {
  const active = current.careerStates.find((item) => item.id === current.currentCareerStateId)!;
  return {
    people: [],
    directionArcs: [],
    pressureArcs: [],
    careerStates: structuredClone(current.careerStates),
    currentCareerStateId: current.currentCareerStateId,
    currentEmploymentStatus: active.employmentStatus,
    careerRevision: current.careerRevision,
    committedTransactionIds: [],
    version: 2
  };
}

function transition(input: {
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
    acceptedByReasonCodes: ["CCA_ADVERSARIAL"]
  };
}

function validate(input: {
  proposals: FinancialEventProposal[];
  ledger: FinancialLedger;
  currentCareer: CareerState;
  narrative: string;
  start: number;
  end: number;
  allowedCareerStateIds: string[];
  transactionId: string;
}) {
  return validateFinancialProposals({
    proposals: input.proposals,
    currentLedger: input.ledger,
    currentCareerState: input.currentCareer,
    acceptedOutcomeId: "cca_outcome",
    narrativeText: input.narrative,
    periodStartAgeInMonths: input.start,
    periodEndAgeInMonths: input.end,
    simulationTransactionId: input.transactionId,
    allowedCareerStateIds: input.allowedCareerStateIds,
    liquidityPolicy: "require_explicit"
  });
}

function activeCareerIncomeCount(ledger: FinancialLedger, month: number): number {
  return ledger.incomeSources.filter((source) => (
    Boolean(source.linkedCareerStateId)
    && source.activeFromAgeInMonths <= month
    && (source.activeUntilAgeInMonths === undefined || source.activeUntilAgeInMonths > month)
  )).length;
}

test("CCA-03 explicit unpaid employment closes the old wage, creates no estimate, and cannot invent debt", () => {
  const oldCareer = career({ id: "career_paid", employmentStatus: "employed", effectiveAt: 288, occupation: "运营经理" });
  const unpaidCareer = career({ id: "career_unpaid", employmentStatus: "employed", effectiveAt: 300, occupation: "公益项目驻场负责人" });
  const narrative = "你转入公益组织的明确无薪岗位，并确认本阶段不领取工资。";
  const acceptedTransition = transition({ id: "unpaid_role", from: oldCareer, to: unpaidCareer, at: 300, excerpt: narrative });
  const currentCareer = collection(oldCareer);
  const ledger = initializeFinancialLedger({
    id: "cca_03",
    asOfAgeInMonths: 300,
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
        id: "old_salary",
        type: "salary",
        displayName: "原岗位工资",
        monthlyNetAmountWan: 1.8,
        accrualPolicy: "monthly",
        activeFromAgeInMonths: 288,
        status: "active",
        linkedCareerStateId: oldCareer.id,
        factStatus: "known",
        evidence
      }],
      expenseCommitments: [{
        id: "living",
        type: "basic_living",
        displayName: "生活费",
        monthlyAmountWan: 0.8,
        activeFromAgeInMonths: 288,
        status: "active",
        factStatus: "known",
        evidence
      }]
    }
  });

  const withoutEstimate = completeCareerCompensationProposals({
    proposals: [],
    currentLedger: ledger,
    transition: acceptedTransition,
    acceptedOutcomeId: "cca_outcome",
    narrativeText: narrative,
    explicitUnpaid: true
  });
  const proposals = completeCareerIncomeReplacementProposals({
    proposals: withoutEstimate,
    currentLedger: ledger,
    currentCareerStateId: oldCareer.id,
    transition: acceptedTransition,
    acceptedOutcomeId: "cca_outcome"
  });
  assert.equal(proposals.some((proposal) => proposal.kind === "income_source_started"), false);
  assert.deepEqual(
    proposals.filter((proposal) => proposal.kind === "income_source_ended")
      .map((proposal) => (proposal.payload as { incomeSourceId: string }).incomeSourceId),
    ["old_salary"]
  );
  const validated = validate({
    proposals,
    ledger,
    currentCareer: oldCareer,
    narrative,
    start: 300,
    end: 301,
    allowedCareerStateIds: [unpaidCareer.id],
    transactionId: "cca_03_unpaid"
  });
  const atomic = reconcileCareerIncomeAtomicity({
    currentCareerStateId: oldCareer.id,
    currentLedger: ledger,
    careerTransitions: [acceptedTransition],
    financialEvents: validated.acceptedEvents,
    ageInMonths: 301,
    explicitUnpaid: true,
    personalIncomeClaimed: false
  });
  assert.equal(atomic.acceptedCareerTransitions.length, 1);
  assert.deepEqual(atomic.acceptedFinancialEvents.map((event) => event.kind), ["income_source_ended"]);

  const before = structuredClone({ currentCareer, ledger, currentWorld: world(currentCareer) });
  assert.throws(() => commitFinancialDomainTransaction({
    transactionId: "cca_03_unpaid",
    periodStartAgeInMonths: 300,
    periodEndAgeInMonths: 301,
    expectedCareerRevision: 0,
    expectedLedgerRevision: 0,
    currentCareer,
    currentFinancialLedger: ledger,
    currentWorldState: before.currentWorld,
    acceptedCareerTransitions: atomic.acceptedCareerTransitions,
    acceptedFinancialEvents: atomic.acceptedFinancialEvents,
    liquidityPolicy: "require_explicit"
  }), (error: unknown) => error instanceof FinancialLedgerInvariantError && error.code === "UNRESOLVED_FUNDING_GAP");
  assert.deepEqual(currentCareer, before.currentCareer);
  assert.deepEqual(ledger, before.ledger);
  assert.equal(ledger.debtAccounts.length, 0);
});

test("CCA-04 two career changes cannot partially commit only the first compensation transaction", () => {
  const original = career({ id: "career_original", employmentStatus: "employed", effectiveAt: 280, occupation: "设计师" });
  const first = career({ id: "career_first", employmentStatus: "employed", effectiveAt: 304, occupation: "产品设计师" });
  const second = career({ id: "career_second", employmentStatus: "employed", effectiveAt: 308, occupation: "设计负责人" });
  const firstText = "你在304月加入甲公司担任产品设计师。";
  const secondText = "你在308月又加入乙公司担任设计负责人。";
  const transitions = [
    transition({ id: "first_switch", from: original, to: first, at: 304, excerpt: firstText }),
    transition({ id: "second_switch", from: first, to: second, at: 308, excerpt: secondText })
  ];
  const ledger = initializeFinancialLedger({
    id: "cca_04",
    asOfAgeInMonths: 300,
    openingPosition: {
      cashAccounts: [{ id: PRIMARY_CASH_ACCOUNT_ID, type: "bank_deposit", balanceWan: 30, status: "active", factStatus: "known", evidence }],
      incomeSources: [{
        id: "original_salary", type: "salary", displayName: "原工资", monthlyNetAmountWan: 1.5,
        accrualPolicy: "monthly", activeFromAgeInMonths: 280, status: "active",
        linkedCareerStateId: original.id, factStatus: "known", evidence
      }]
    }
  });
  const onlyFirstCompleted: AcceptedFinancialEvent[] = [
    {
      id: "accepted_end_original",
      proposalId: "end_original",
      kind: "income_source_ended",
      effectiveAtAgeInMonths: 304,
      payload: { incomeSourceId: "original_salary" },
      evidence: [{ ...evidence[0], excerpt: firstText }],
      acceptedByReasonCodes: ["CCA_ADVERSARIAL"]
    },
    {
      id: "accepted_first_salary",
      proposalId: "first_salary",
      kind: "income_source_started",
      effectiveAtAgeInMonths: 304,
      payload: {
        id: "first_salary", type: "salary", displayName: "甲公司工资", monthlyNetAmountWan: 2,
        accrualPolicy: "monthly", activeFromAgeInMonths: 304, status: "active",
        linkedCareerStateId: first.id, factStatus: "known", evidence
      },
      evidence: [{ ...evidence[0], excerpt: firstText }],
      acceptedByReasonCodes: ["CCA_ADVERSARIAL"]
    }
  ];

  const result = reconcileCareerIncomeAtomicity({
    currentCareerStateId: original.id,
    currentLedger: ledger,
    careerTransitions: transitions,
    financialEvents: onlyFirstCompleted,
    ageInMonths: 312
  });
  assert.deepEqual(result.acceptedCareerTransitions, []);
  assert.deepEqual(result.acceptedFinancialEvents, []);
  assert.equal(result.issues.length, 1);
  assert.match(result.issues[0].summary, /同一节点.*两次.*整体回滚/u);
});

test("CCA-05 a historical two-month internship cannot downgrade the current full-time transition", () => {
  const student = career({ id: "career_student", employmentStatus: "student", effectiveAt: 216, occupation: "计算机专业学生" });
  const fullTime = career({
    id: "career_full_time",
    employmentStatus: "employed",
    effectiveAt: 282,
    occupation: "应届前端工程师",
    industry: "互联网",
    organization: "大型科技公司"
  });
  const currentEvidence = "毕业后，你正式加入大型科技公司担任应届前端工程师。";
  const narrative = "你曾实习两个月。毕业后，你正式加入大型科技公司担任应届前端工程师。";
  const acceptedTransition = transition({ id: "graduate", from: student, to: fullTime, at: 282, excerpt: currentEvidence });
  const result = reclassifyBoundedStudentEngagement({
    currentCareerState: student,
    transitions: [acceptedTransition],
    narrativeText: narrative,
    acceptedOutcomeId: "cca_outcome"
  });
  assert.equal(result.reclassified, false);
  assert.deepEqual(result.transitions, [acceptedTransition]);
  assert.deepEqual(result.proposals, []);

  const proposals = completeCareerCompensationProposals({
    proposals: [],
    currentLedger: initializeFinancialLedger({ id: "cca_05", asOfAgeInMonths: 282 }),
    transition: acceptedTransition,
    acceptedOutcomeId: "cca_outcome",
    narrativeText: narrative
  });
  const source = proposals[0].payload as IncomeSource;
  assert.equal(source.compensationEstimate?.inputs.employmentType, "full_time");
  assert.equal(source.factStatus, "estimated");
  assert.equal(source.activeUntilAgeInMonths, undefined);
});

test("CCA-06 Arabic, Chinese, whitespace, and punctuation duration variants produce exact internship ends", () => {
  const variants = [
    ["2个月", 2],
    ["两个月", 2],
    ["12个月", 12],
    ["十二个月", 12],
    ["这份实习，为期： 12 个月。", 12],
    ["这份实习期（十 二 个 月）。", 12]
  ] as const;
  const student = career({ id: "cca_06_student", employmentStatus: "student", effectiveAt: 216, occupation: "大学生" });

  for (const [narrative, expectedMonths] of variants) {
    assert.equal(parseBoundedEngagementMonths(narrative), expectedMonths, narrative);
    const internship = career({ id: `cca_06_intern_${expectedMonths}`, employmentStatus: "employed", effectiveAt: 300, occupation: "前端实习生" });
    const result = reclassifyBoundedStudentEngagement({
      currentCareerState: student,
      transitions: [transition({ id: `intern_${expectedMonths}`, from: student, to: internship, at: 300, excerpt: narrative })],
      narrativeText: narrative,
      acceptedOutcomeId: "cca_outcome"
    });
    const source = result.proposals[0]?.payload as IncomeSource | undefined;
    assert.equal(result.reclassified, true, narrative);
    assert.equal(source?.activeUntilAgeInMonths, 300 + expectedMonths, narrative);
  }

  const ambiguous = "你开始一段期限尚未确定的前端实习。";
  const ambiguousInternship = career({ id: "cca_06_ambiguous", employmentStatus: "employed", effectiveAt: 300, occupation: "前端实习生" });
  const blocked = reclassifyBoundedStudentEngagement({
    currentCareerState: student,
    transitions: [transition({ id: "ambiguous_intern", from: student, to: ambiguousInternship, at: 300, excerpt: ambiguous })],
    narrativeText: ambiguous,
    acceptedOutcomeId: "cca_outcome"
  });
  assert.equal(blocked.unboundedEngagementBlocked, true);
  assert.deepEqual(blocked.transitions, []);
  assert.deepEqual(blocked.proposals, []);
});

test("CCA-07 long review windows emit each boundary once and survive JSON restore and retry", () => {
  const current = career({
    id: "cca_07_career",
    employmentStatus: "employed",
    effectiveAt: 282,
    occupation: "高级前端工程师",
    industry: "互联网",
    organization: "大型科技公司"
  });
  const estimate = resolveCareerCompensationEstimate({ careerState: current, effectiveAtAgeInMonths: 282, calendarYear: 2026 });
  const currentCareer = collection(current);
  const ledger = initializeFinancialLedger({
    id: "cca_07",
    asOfAgeInMonths: 282,
    openingPosition: {
      cashAccounts: [{ id: PRIMARY_CASH_ACCOUNT_ID, type: "bank_deposit", balanceWan: 100, status: "active", factStatus: "known", evidence }],
      incomeSources: [{
        id: "estimated_salary", type: "salary", displayName: "估算工资",
        monthlyNetAmountWan: estimate.monthlyNetAmountWan, accrualPolicy: "monthly",
        activeFromAgeInMonths: 282, status: "active", linkedCareerStateId: current.id,
        factStatus: "estimated", compensationEstimate: estimate, evidence
      }]
    }
  });
  const narrative = "你继续担任高级前端工程师，并按年度完成薪资政策复核。";
  const proposals = completeDueCareerCompensationReviewProposals({
    proposals: [], currentLedger: ledger, currentCareerState: current,
    periodStartAgeInMonths: 282, periodEndAgeInMonths: 318,
    acceptedOutcomeId: "cca_outcome", narrativeText: narrative, calendarYear: 2026
  });
  assert.deepEqual(proposals.map((proposal) => proposal.effectiveAtAgeInMonths), [294, 306, 318]);
  assert.equal(new Set(proposals.map((proposal) => proposal.id)).size, proposals.length);
  assert.deepEqual(proposals.map((proposal) => (
    (proposal.payload as { nextSource: IncomeSource }).nextSource.compensationEstimate?.reviewAtAgeInMonths
  )), [306, 318, 330]);

  const catchUp = completeDueCareerCompensationReviewProposals({
    proposals: [], currentLedger: ledger, currentCareerState: current,
    periodStartAgeInMonths: 310, periodEndAgeInMonths: 330,
    acceptedOutcomeId: "cca_outcome", narrativeText: narrative, calendarYear: 2028
  });
  assert.deepEqual(catchUp.map((proposal) => proposal.effectiveAtAgeInMonths), [310, 322]);
  assert.equal(new Set(catchUp.map((proposal) => proposal.effectiveAtAgeInMonths)).size, catchUp.length);

  const validated = validate({
    proposals,
    ledger,
    currentCareer: current,
    narrative,
    start: 282,
    end: 318,
    allowedCareerStateIds: [current.id],
    transactionId: "cca_07_reviews"
  });
  assert.equal(validated.issues.some((issue) => issue.severity === "blocking"), false);
  const committed = commitFinancialDomainTransaction({
    transactionId: "cca_07_reviews",
    periodStartAgeInMonths: 282,
    periodEndAgeInMonths: 318,
    expectedCareerRevision: 0,
    expectedLedgerRevision: 0,
    currentCareer,
    currentFinancialLedger: ledger,
    currentWorldState: world(currentCareer),
    acceptedCareerTransitions: [],
    acceptedFinancialEvents: validated.acceptedEvents,
    liquidityPolicy: "require_explicit"
  });
  const restored = JSON.parse(JSON.stringify(committed)) as typeof committed;
  const retry = commitFinancialDomainTransaction({
    transactionId: "cca_07_reviews",
    periodStartAgeInMonths: 282,
    periodEndAgeInMonths: 318,
    expectedCareerRevision: restored.career.careerRevision,
    expectedLedgerRevision: restored.financialLedger.revision,
    currentCareer: restored.career,
    currentFinancialLedger: restored.financialLedger,
    currentWorldState: restored.worldState,
    acceptedCareerTransitions: [],
    acceptedFinancialEvents: validated.acceptedEvents,
    liquidityPolicy: "require_explicit"
  });
  assert.equal(retry.alreadyCommitted, true);
  assert.deepEqual(retry.financialLedger, restored.financialLedger);
});

test("CCA-08 company receipts stay outside the personal ledger until an explicit owner draw", () => {
  const founder = career({ id: "cca_08_founder", employmentStatus: "self_employed", effectiveAt: 360, occupation: "创始人" });
  const companyNarrative = "公司签下客户，4.8万元年费已经回款，但全部留在公司运营账户。";
  assert.equal(narrativeClaimsNewPersonalIncomeActivity(companyNarrative), false);
  const ledger = initializeFinancialLedger({
    id: "cca_08",
    asOfAgeInMonths: 360,
    openingPosition: {
      cashAccounts: [{ id: PRIMARY_CASH_ACCOUNT_ID, type: "bank_deposit", balanceWan: 10, status: "active", factStatus: "known", evidence }]
    }
  });
  const rejectedCompanyDraw = validate({
    proposals: [{
      id: "company_receipt_is_not_draw",
      kind: "income_source_started",
      effectiveAtAgeInMonths: 360,
      payload: {
        id: "false_owner_draw", type: "self_employment_draw", displayName: "错误业主提款",
        monthlyNetAmountWan: 4.8, accrualPolicy: "monthly", activeFromAgeInMonths: 360,
        status: "active", linkedCareerStateId: founder.id, factStatus: "known", evidence: []
      },
      sourceOutcomeId: "cca_outcome",
      financialScope: "business_operating",
      evidence: companyNarrative,
      confidence: 1
    }],
    ledger,
    currentCareer: founder,
    narrative: companyNarrative,
    start: 360,
    end: 361,
    allowedCareerStateIds: [founder.id],
    transactionId: "cca_08_company"
  });
  assert.deepEqual(rejectedCompanyDraw.acceptedEvents, []);

  const companyPeriod = reduceFinancialLedger({
    ledger,
    transactionId: "cca_08_company",
    expectedLedgerRevision: 0,
    periodStartAgeInMonths: 360,
    periodEndAgeInMonths: 361,
    events: [],
    liquidityPolicy: "require_explicit"
  });
  assert.equal(companyPeriod.ledger.cashAccounts[0].balanceWan, 10);
  assert.deepEqual(companyPeriod.ledger.incomeSources, []);

  const drawNarrative = "你从本月起每月领取2万元业主提款。";
  const acceptedDraw = validate({
    proposals: [{
      id: "explicit_owner_draw",
      kind: "income_source_started",
      effectiveAtAgeInMonths: 361,
      payload: {
        id: "owner_draw", type: "self_employment_draw", displayName: "业主提款",
        monthlyNetAmountWan: 2, accrualPolicy: "monthly", activeFromAgeInMonths: 361,
        status: "active", linkedCareerStateId: founder.id, factStatus: "known", evidence: []
      },
      sourceOutcomeId: "cca_outcome",
      financialScope: "personal",
      evidence: drawNarrative,
      confidence: 1
    }],
    ledger: companyPeriod.ledger,
    currentCareer: founder,
    narrative: drawNarrative,
    start: 361,
    end: 362,
    allowedCareerStateIds: [founder.id],
    transactionId: "cca_08_draw"
  });
  assert.equal(acceptedDraw.acceptedEvents.length, 1);
  const drawPeriod = reduceFinancialLedger({
    ledger: companyPeriod.ledger,
    transactionId: "cca_08_draw",
    expectedLedgerRevision: companyPeriod.ledger.revision,
    periodStartAgeInMonths: 361,
    periodEndAgeInMonths: 362,
    events: acceptedDraw.acceptedEvents,
    liquidityPolicy: "require_explicit"
  });
  if (!("periodSummary" in drawPeriod)) throw new Error("CCA-08 owner draw must create a new ledger transaction");
  assert.equal(drawPeriod.periodSummary.incomeWan, 2);
  assert.equal(drawPeriod.ledger.cashAccounts[0].balanceWan, 12);
  assert.deepEqual(drawPeriod.ledger.incomeSources.map((source) => source.id), ["owner_draw"]);
});

test("CCA-09 zero cash rolls back without funding, while an accepted loan creates exactly one sourced debt", () => {
  const ledger = initializeFinancialLedger({
    id: "cca_09",
    asOfAgeInMonths: 300,
    openingPosition: {
      cashAccounts: [{ id: PRIMARY_CASH_ACCOUNT_ID, type: "bank_deposit", balanceWan: 0, status: "active", factStatus: "known", evidence }]
    }
  });
  const expense: AcceptedFinancialEvent<"one_off_expense_paid"> = {
    id: "accepted_living_expense",
    proposalId: "living_expense",
    kind: "one_off_expense_paid",
    effectiveAtAgeInMonths: 301,
    payload: { sourceCashAccountId: PRIMARY_CASH_ACCOUNT_ID, amountWan: 1 },
    evidence: [{ ...evidence[0], excerpt: "你支付了1万元生活费。" }],
    acceptedByReasonCodes: ["CCA_ADVERSARIAL"],
    liquidityTreatment: "require_explicit"
  };
  const before = structuredClone(ledger);
  assert.throws(() => reduceFinancialLedger({
    ledger,
    transactionId: "cca_09_unfunded",
    expectedLedgerRevision: 0,
    periodStartAgeInMonths: 300,
    periodEndAgeInMonths: 301,
    events: [expense],
    liquidityPolicy: "require_explicit"
  }), (error: unknown) => error instanceof FinancialLedgerInvariantError && error.code === "UNRESOLVED_FUNDING_GAP");
  assert.deepEqual(ledger, before);
  assert.equal(ledger.debtAccounts.length, 0);

  const loan: AcceptedFinancialEvent<"debt_drawn"> = {
    id: "accepted_personal_loan",
    proposalId: "personal_loan",
    kind: "debt_drawn",
    effectiveAtAgeInMonths: 300,
    payload: {
      debtAccount: {
        id: "friend_loan",
        type: "family_or_personal_loan",
        displayName: "朋友周转借款",
        principalWan: 1,
        openedAtAgeInMonths: 300,
        status: "active",
        repaymentPolicy: { mode: "event_driven" },
        factStatus: "known",
        origin: "explicit",
        evidence: [{ ...evidence[0], excerpt: "朋友借给你1万元，约定有收入后归还。" }]
      },
      destinationCashAccountId: PRIMARY_CASH_ACCOUNT_ID,
      principalDrawnWan: 1
    },
    evidence: [{ ...evidence[0], excerpt: "朋友借给你1万元，约定有收入后归还。" }],
    acceptedByReasonCodes: ["CCA_ADVERSARIAL"]
  };
  const funded = reduceFinancialLedger({
    ledger,
    transactionId: "cca_09_funded",
    expectedLedgerRevision: 0,
    periodStartAgeInMonths: 300,
    periodEndAgeInMonths: 301,
    events: [loan, expense],
    liquidityPolicy: "require_explicit"
  });
  assert.equal(funded.ledger.cashAccounts[0].balanceWan, 0);
  assert.equal(funded.ledger.debtAccounts.length, 1);
  assert.equal(funded.ledger.debtAccounts[0].origin, "explicit");
  assert.deepEqual(funded.ledger.debtAccounts[0].repaymentPolicy, { mode: "event_driven" });
  assert.match(funded.ledger.debtAccounts[0].evidence[0]?.excerpt || "", /朋友.*约定/u);
  assert.equal(funded.ledger.debtAccounts.some((debt) => debt.origin === "system_auto_shortfall"), false);
});

test("CCA-10 start, middle, and end-month career boundaries settle exact monthly slices", () => {
  const periodStart = 300;
  const periodEnd = 312;
  for (const boundary of [periodStart, 306, periodEnd]) {
    const ledger = initializeFinancialLedger({
      id: `cca_10_${boundary}`,
      asOfAgeInMonths: periodStart,
      openingPosition: {
        cashAccounts: [{ id: PRIMARY_CASH_ACCOUNT_ID, type: "bank_deposit", balanceWan: 10, status: "active", factStatus: "known", evidence }],
        incomeSources: [{
          id: "old_salary", type: "salary", displayName: "旧工资", monthlyNetAmountWan: 1,
          accrualPolicy: "monthly", activeFromAgeInMonths: 280, status: "active",
          linkedCareerStateId: "career_old", factStatus: "known", evidence
        }]
      }
    });
    const events: AcceptedFinancialEvent[] = [
      {
        id: `accepted_end_${boundary}`, proposalId: `end_${boundary}`, kind: "income_source_ended",
        effectiveAtAgeInMonths: boundary, payload: { incomeSourceId: "old_salary" }, evidence,
        acceptedByReasonCodes: ["CCA_ADVERSARIAL"]
      },
      {
        id: `accepted_start_${boundary}`, proposalId: `start_${boundary}`, kind: "income_source_started",
        effectiveAtAgeInMonths: boundary,
        payload: {
          id: "new_salary", type: "salary", displayName: "新工资", monthlyNetAmountWan: 2,
          accrualPolicy: "monthly", activeFromAgeInMonths: boundary, status: "active",
          linkedCareerStateId: "career_new", factStatus: "known", evidence
        },
        evidence,
        acceptedByReasonCodes: ["CCA_ADVERSARIAL"]
      }
    ];
    const result = reduceFinancialLedger({
      ledger,
      transactionId: `cca_10_${boundary}`,
      expectedLedgerRevision: 0,
      periodStartAgeInMonths: periodStart,
      periodEndAgeInMonths: periodEnd,
      events,
      liquidityPolicy: "require_explicit"
    });
    if (!("periodSummary" in result)) throw new Error(`CCA-10 boundary ${boundary} must create a new transaction`);
    const expected = (boundary - periodStart) * 1 + (periodEnd - boundary) * 2;
    assert.equal(result.periodSummary.incomeWan, expected, `boundary=${boundary}`);
    assert.equal(result.ledger.incomeSources.find((source) => source.id === "old_salary")?.activeUntilAgeInMonths, boundary);
    assert.equal(result.ledger.incomeSources.find((source) => source.id === "new_salary")?.activeFromAgeInMonths, boundary);
    assert.equal(Array.from({ length: periodEnd - periodStart }, (_, index) => (
      activeCareerIncomeCount(result.ledger, periodStart + index)
    )).every((count) => count === 1), true, `boundary=${boundary}`);
  }
});

test("CCA-11 ungrounded outliers are repaired while user-authored and exceptional amounts remain authoritative", () => {
  const oldCareer = career({ id: "cca_11_old", employmentStatus: "employed", effectiveAt: 280, occupation: "开发工程师" });
  const nextCareer = career({
    id: "cca_11_next",
    employmentStatus: "employed",
    effectiveAt: 300,
    occupation: "应届前端工程师",
    industry: "互联网",
    organization: "大型科技公司"
  });
  const acceptedTransition = transition({
    id: "outlier_switch",
    from: oldCareer,
    to: nextCareer,
    at: 300,
    excerpt: "你正式加入大型科技公司担任应届前端工程师。"
  });
  const ledger = initializeFinancialLedger({ id: "cca_11", asOfAgeInMonths: 300 });
  const outlier = (id: string, proposalEvidence: string): FinancialEventProposal => ({
    id,
    kind: "income_source_started",
    effectiveAtAgeInMonths: 300,
    payload: {
      id: `${id}_source`, type: "salary", displayName: "新工资", monthlyNetAmountWan: 30,
      accrualPolicy: "monthly", activeFromAgeInMonths: 300, status: "active",
      linkedCareerStateId: nextCareer.id, factStatus: "known", evidence: []
    },
    sourceOutcomeId: "cca_outcome",
    financialScope: "personal",
    evidence: proposalEvidence,
    confidence: 1
  });

  const modelOutlier = outlier("model_outlier", "你正式加入大型科技公司担任应届前端工程师，月薪30万元。");
  const repaired = completeCareerCompensationProposals({
    proposals: [modelOutlier], currentLedger: ledger, transition: acceptedTransition,
    acceptedOutcomeId: "cca_outcome", narrativeText: "你正式加入大型科技公司担任应届前端工程师。"
  });
  assert.equal(repaired.length, 1);
  assert.equal(repaired[0].id, "policy_compensation_outlier_switch");
  assert.notEqual((repaired[0].payload as IncomeSource).monthlyNetAmountWan, 30);
  assert.equal((repaired[0].payload as IncomeSource).factStatus, "estimated");

  const userOutlier = outlier("user_outlier", "我接受这份工作，明确税后月薪30万元。");
  const userPreserved = completeCareerCompensationProposals({
    proposals: [userOutlier], currentLedger: ledger, transition: acceptedTransition,
    acceptedOutcomeId: "cca_outcome", narrativeText: userOutlier.evidence,
    userEvidenceText: userOutlier.evidence
  });
  assert.deepEqual(userPreserved, [userOutlier]);

  const exceptionalOutlier = outlier("exceptional_outlier", "你因海外挖角和特殊津贴，明确税后月薪30万元。");
  const exceptionalPreserved = completeCareerCompensationProposals({
    proposals: [exceptionalOutlier], currentLedger: ledger, transition: acceptedTransition,
    acceptedOutcomeId: "cca_outcome", narrativeText: exceptionalOutlier.evidence
  });
  assert.deepEqual(exceptionalPreserved, [exceptionalOutlier]);
  assert.match(exceptionalPreserved[0].evidence, /海外挖角|特殊津贴/u);
});

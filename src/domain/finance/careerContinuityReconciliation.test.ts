import assert from "node:assert/strict";
import test from "node:test";
import { initializeCareerState } from "../career/careerState";
import {
  buildCareerContinuityCatchUpEvent,
  buildCareerContinuityReconciliation,
  findEarliestCareerContinuityEvidence
} from "./careerContinuityReconciliation";
import { initializeFinancialLedger } from "./initializeLedger";
import { PRIMARY_CASH_ACCOUNT_ID } from "./ledgerMath";
import { validateFinancialProposals } from "./validateFinancialProposals";
import type { FinancialEvidence, IncomeSource } from "./types";
import type { HistoryItem } from "../../types";

const evidence: FinancialEvidence[] = [{
  source: "accepted_history",
  reasonCode: "STUDENT_BASIC_LIVING_FAMILY_COVERED",
  confidence: 1
}];

function history(ageInMonths: number, description: string): HistoryItem {
  return {
    age: Math.floor(ageInMonths / 12),
    ageInMonths,
    stage: "测试",
    title: "测试节点",
    description,
    selectedChoice: "继续",
    attributes: { happiness: 50, intelligence: 50, wealth: 50, relation: 50, health: 50 },
    choices: [],
    isEndingNode: false
  };
}

test("finds the earliest accepted continuing-employment evidence and ignores plans", () => {
  const result = findEarliestCareerContinuityEvidence({
    history: [
      history(264, "你计划去互联网公司求职，但尚未获得职位。"),
      history(276, "你继续在互联网公司做技术岗，白天写代码，晚上学习动画。"),
      history(288, "你仍在互联网公司负责软件开发。")
    ],
    narrativeText: "你继续在互联网公司做技术岗。",
    periodStartAgeInMonths: 288
  });
  assert.equal(result?.effectiveFromAgeInMonths, 264);
  assert.equal(result?.organization, "互联网公司");
  assert.equal(result?.occupation, "技术岗");
});

test("reconciles a stale student state into employed with one estimated salary", () => {
  const student = initializeCareerState({
    id: "career_student",
    employmentStatus: "student",
    occupation: "计算机专业学生",
    effectiveFromAgeInMonths: 240
  });
  const result = buildCareerContinuityReconciliation({
    history: [
      history(264, "你完成毕业设计。"),
      history(276, "你继续在互联网公司做技术岗，开始独立负责小功能。")
    ],
    narrativeText: "你继续在互联网公司做技术岗，白天写代码。",
    currentCareerState: student,
    periodStartAgeInMonths: 300,
    acceptedOutcomeId: "selected",
    transactionId: "continuity_tx"
  });
  assert.ok(result);
  assert.equal(result.transition.nextCareerState.employmentStatus, "employed");
  assert.equal(result.transition.nextCareerState.effectiveFromAgeInMonths, 264);
  const salary = result.salaryProposal.payload as IncomeSource;
  assert.equal(salary.linkedCareerStateId, result.transition.nextCareerState.id);
  assert.equal(salary.status, "active");
  assert.equal(salary.factStatus, "estimated");
  assert.equal(salary.compensationEstimate?.cumulativeGrowthRate, 0.12);
});

test("catch-up is net of student support and is deterministic", () => {
  const student = initializeCareerState({
    id: "career_student",
    employmentStatus: "student",
    effectiveFromAgeInMonths: 240
  });
  const reconciliation = buildCareerContinuityReconciliation({
    history: [history(276, "你继续在互联网公司做技术岗。")],
    narrativeText: "你继续在互联网公司做技术岗。",
    currentCareerState: student,
    periodStartAgeInMonths: 288,
    acceptedOutcomeId: "selected",
    transactionId: "catch_up_tx"
  })!;
  const ledger = initializeFinancialLedger({
    id: "catch_up",
    asOfAgeInMonths: 288,
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
        activeFromAgeInMonths: 240,
        status: "active",
        factStatus: "known",
        evidence
      }]
    }
  });
  const salary = reconciliation.salaryProposal.payload as IncomeSource;
  const first = buildCareerContinuityCatchUpEvent({
    reconciliation,
    ledger,
    salarySource: salary,
    periodStartAgeInMonths: 288,
    transactionId: "catch_up_tx"
  });
  const second = buildCareerContinuityCatchUpEvent({
    reconciliation: JSON.parse(JSON.stringify(reconciliation)),
    ledger: JSON.parse(JSON.stringify(ledger)),
    salarySource: JSON.parse(JSON.stringify(salary)),
    periodStartAgeInMonths: 288,
    transactionId: "catch_up_tx"
  });
  assert.ok(first);
  assert.deepEqual(second, first);
  assert.equal(
    (first.payload as { amountWan: number }).amountWan,
    Math.round(((salary.compensationEstimate!.baselineMonthlyNetAmountWan! - 0.2) * 12) * 100) / 100
  );
});

test("does not manufacture another transition for an already employed CareerState", () => {
  const employed = initializeCareerState({
    id: "career_employed",
    employmentStatus: "employed",
    occupation: "技术岗",
    effectiveFromAgeInMonths: 264
  });
  assert.equal(buildCareerContinuityReconciliation({
    history: [history(276, "你继续在互联网公司做技术岗。")],
    narrativeText: "你继续在互联网公司做技术岗。",
    currentCareerState: employed,
    periodStartAgeInMonths: 288,
    acceptedOutcomeId: "selected",
    transactionId: "already_employed"
  }), undefined);
});

test("an explicit historical salary remains authoritative instead of being replaced by an estimate", () => {
  const student = initializeCareerState({
    id: "career_student_explicit",
    employmentStatus: "student",
    effectiveFromAgeInMonths: 240
  });
  const result = buildCareerContinuityReconciliation({
    history: [history(276, "你继续在互联网公司做技术岗，税后月薪1.8万元。")],
    narrativeText: "你继续在互联网公司做技术岗。",
    currentCareerState: student,
    periodStartAgeInMonths: 288,
    acceptedOutcomeId: "selected",
    transactionId: "explicit_salary"
  })!;
  const salary = result.salaryProposal.payload as IncomeSource;
  assert.equal(salary.monthlyNetAmountWan, 1.8);
  assert.equal(salary.factStatus, "known");
  assert.equal(salary.compensationEstimate, undefined);
  const validation = validateFinancialProposals({
    proposals: [result.salaryProposal],
    currentLedger: initializeFinancialLedger({ id: "explicit_salary_validation", asOfAgeInMonths: 288 }),
    currentCareerState: student,
    acceptedOutcomeId: "selected",
    narrativeText: "你继续在互联网公司做技术岗。",
    periodStartAgeInMonths: 288,
    periodEndAgeInMonths: 300,
    simulationTransactionId: "explicit_salary",
    allowedCareerStateIds: [student.id, result.transition.nextCareerState.id],
    liquidityPolicy: "require_explicit"
  });
  assert.equal(validation.acceptedEvents.length, 1);
  assert.equal(validation.issues.some((issue) => issue.severity === "blocking"), false);
  const forgedProposal = structuredClone(result.salaryProposal);
  (forgedProposal.payload as IncomeSource).monthlyNetAmountWan = 2.8;
  const forged = validateFinancialProposals({
    proposals: [forgedProposal],
    currentLedger: initializeFinancialLedger({ id: "forged_salary_validation", asOfAgeInMonths: 288 }),
    currentCareerState: student,
    acceptedOutcomeId: "selected",
    narrativeText: "你继续在互联网公司做技术岗。",
    periodStartAgeInMonths: 288,
    periodEndAgeInMonths: 300,
    simulationTransactionId: "forged_salary",
    allowedCareerStateIds: [student.id, result.transition.nextCareerState.id],
    liquidityPolicy: "require_explicit"
  });
  assert.equal(forged.acceptedEvents.length, 0);
  assert.equal(forged.issues.some((issue) => issue.code === "CAREER_INCOME_CONFLICT"), true);
});

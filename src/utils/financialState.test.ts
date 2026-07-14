import assert from "node:assert/strict";
import test from "node:test";
import {
  applyFinancialChange,
  applyFinancialSignals,
  calculateFinancialChange,
  calculateNetWorth,
  deriveWealthScore,
  estimateFinancialStateFromWealth,
  formatNetWorthWan,
  getFinancialChangeInputIssues,
  inferFinancialSignalsFromNarrative,
  normalizeInitialFinancialState
} from "./financialState";

test("calculates cumulative net worth from assets minus debt", () => {
  assert.equal(calculateNetWorth({
    cashWan: 96,
    investmentAssetsWan: 22,
    propertyMarketValueWan: 380,
    businessAndOtherAssetsWan: 0,
    totalDebtWan: 70
  }), 428);
});

test("calculates the stage change instead of trusting an AI total", () => {
  const change = calculateFinancialChange({
    periodMonths: 12,
    afterTaxIncomeWan: 96,
    livingExpenseWan: 42,
    medicalEducationExpenseWan: 18,
    interestAndFeesWan: 4,
    assetValueChangeWan: -6,
    otherNetChangeWan: 0,
    netWorthChangeWan: 999,
    reasons: ["收入下降", "治疗支出增加"]
  }, 12);

  assert.equal(change.netWorthChangeWan, 26);
  assert.deepEqual(change.reasons, ["收入下降", "治疗支出增加"]);
});

test("rejects incomplete or time-mismatched AI financial changes", () => {
  const issues = getFinancialChangeInputIssues({
    periodMonths: 24,
    afterTaxIncomeWan: 20,
    livingExpenseWan: 10,
    reasons: []
  }, 12);

  assert.ok(issues.some((issue) => issue.includes("assetValueChangeWan")));
  assert.ok(issues.some((issue) => issue.includes("periodMonths")));
  assert.ok(issues.some((issue) => issue.includes("reasons")));
});

test("applies a multi-month change and annualizes the current cash flow", () => {
  const previous = normalizeInitialFinancialState({
    cashWan: 40,
    investmentAssetsWan: 60,
    propertyMarketValueWan: 400,
    businessAndOtherAssetsWan: 0,
    totalDebtWan: 80,
    annualAfterTaxIncomeWan: 80,
    annualDisposableIncomeWan: 30,
    annualCoreExpenseWan: 40,
    incomeStability: "stable",
    isEstimated: false
  }, 40 * 12, 70);

  const result = applyFinancialChange(previous, {
    afterTaxIncomeWan: 80,
    livingExpenseWan: 40,
    medicalEducationExpenseWan: 10,
    interestAndFeesWan: 4,
    assetValueChangeWan: 6,
    otherNetChangeWan: 0,
    incomeStability: "volatile",
    reasons: ["两年内完成岗位调整"]
  }, 24, 42 * 12);

  assert.equal(previous.netWorthWan, 420);
  assert.equal(result.financialChange.netWorthChangeWan, 32);
  assert.equal(result.financialState.netWorthWan, 452);
  assert.equal(result.financialState.annualAfterTaxIncomeWan, 40);
  assert.equal(result.financialState.incomeStability, "volatile");
});

test("wealth score is deterministic and responds to financial capacity", () => {
  const low = estimateFinancialStateFromWealth(20, 25 * 12);
  const high = normalizeInitialFinancialState({
    cashWan: 300,
    investmentAssetsWan: 500,
    propertyMarketValueWan: 1000,
    businessAndOtherAssetsWan: 200,
    totalDebtWan: 100,
    annualAfterTaxIncomeWan: 200,
    annualDisposableIncomeWan: 120,
    annualCoreExpenseWan: 60,
    incomeStability: "very_stable",
    isEstimated: false
  }, 45 * 12, 80);

  assert.equal(deriveWealthScore(high), deriveWealthScore(high));
  assert.ok(deriveWealthScore(high) > deriveWealthScore(low));
  assert.ok(deriveWealthScore(high) <= 100);
});

test("supports negative wealth and compact display units", () => {
  const state = normalizeInitialFinancialState({
    cashWan: 10,
    investmentAssetsWan: 0,
    propertyMarketValueWan: 100,
    businessAndOtherAssetsWan: 0,
    totalDebtWan: 195,
    annualAfterTaxIncomeWan: 15,
    annualDisposableIncomeWan: -2,
    annualCoreExpenseWan: 17,
    incomeStability: "unstable",
    isEstimated: false
  }, 30 * 12, 20);

  assert.equal(state.netWorthWan, -85);
  assert.equal(formatNetWorthWan(state.netWorthWan), "-85万");
  assert.equal(formatNetWorthWan(12000), "1.2亿");
});

test("uses explicit monthly salary and recurring family transfers without another AI estimate", () => {
  const previous = normalizeInitialFinancialState({
    cashWan: 5,
    investmentAssetsWan: 0,
    propertyMarketValueWan: 0,
    businessAndOtherAssetsWan: 0,
    totalDebtWan: 0,
    annualAfterTaxIncomeWan: 0,
    annualDisposableIncomeWan: -2.4,
    annualCoreExpenseWan: 2.4,
    employmentStatus: "student",
    incomeStability: "unstable",
    isEstimated: true
  }, 20 * 12, 40);
  const signals = inferFinancialSignalsFromNarrative({
    description: "接下来的十四个月，你月入能到3000元，每月寄1000元回家。",
    previousState: previous,
    periodMonths: 14,
    targetAgeInMonths: 21 * 12 + 2
  });
  const result = applyFinancialSignals(previous, signals, 14, 21 * 12 + 2);

  assert.equal(signals.monthlyNetIncomeWan, 0.3);
  assert.equal(signals.incomeMonths, 14);
  assert.equal(signals.monthlyLivingExpenseWan, 0.3);
  assert.equal(result.financialChange.netWorthChangeWan, 0);
});

test("initial legacy estimates are age-aware instead of mapping a student score to millions", () => {
  const student = estimateFinancialStateFromWealth(50, 20 * 12);
  const midCareer = estimateFinancialStateFromWealth(50, 40 * 12);

  assert.equal(student.netWorthWan, 5);
  assert.ok(midCareer.netWorthWan > student.netWorthWan);
  assert.equal(student.employmentStatus, "student");
});

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
  getPropertyTransactionSignalIssues,
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

test("reconciles the student startup and interest-free loan narrative round by round", () => {
  const initial = normalizeInitialFinancialState({
    cashWan: 0,
    investmentAssetsWan: 0,
    propertyMarketValueWan: 0,
    businessAndOtherAssetsWan: 0,
    totalDebtWan: 4.3,
    annualAfterTaxIncomeWan: 0,
    annualDisposableIncomeWan: -1.2,
    annualCoreExpenseWan: 1.2,
    employmentStatus: "student",
    incomeStability: "unstable",
    isEstimated: true
  }, 20 * 12, 31);

  const startupRound = applyFinancialSignals(initial, {
    employmentStatus: "student",
    monthlyNetIncomeWan: 0,
    incomeMonths: 0,
    monthlyLivingExpenseWan: 0.1,
    oneOffIncomeWan: 0,
    oneOffExpenseWan: 0.2,
    assetValueChangeWan: 0,
    propertyMarketValueChangeWan: 0,
    personalDebtChangeWan: 0,
    incomeStability: "unstable",
    confidence: 0.9,
    reasons: ["十个月没有收入，承担基本生活费和项目杂费"]
  }, 10, 20 * 12 + 10);

  assert.equal(startupRound.financialChange.netWorthChangeWan, -1.2);
  assert.equal(startupRound.financialState.netWorthWan, -5.5);
  assert.equal(
    Math.round((startupRound.financialState.netWorthWan - initial.netWorthWan) * 10) / 10,
    startupRound.financialChange.netWorthChangeWan
  );

  const loanRefinanceRound = applyFinancialSignals(startupRound.financialState, {
    employmentStatus: "self_employed",
    monthlyNetIncomeWan: 0,
    incomeMonths: 0,
    monthlyLivingExpenseWan: 0.1,
    oneOffIncomeWan: 5,
    oneOffExpenseWan: 5,
    assetValueChangeWan: 0,
    propertyMarketValueChangeWan: 0,
    personalDebtChangeWan: 0,
    incomeStability: "unstable",
    confidence: 0.9,
    reasons: ["五万元无息贷款到账并用于置换等额信用卡债务", "四个月基本生活支出"]
  }, 4, 21 * 12 + 2);

  assert.equal(loanRefinanceRound.financialChange.netWorthChangeWan, -0.4);
  assert.equal(loanRefinanceRound.financialState.netWorthWan, -5.9);
  assert.equal(
    Math.round((loanRefinanceRound.financialState.netWorthWan - startupRound.financialState.netWorthWan) * 10) / 10,
    loanRefinanceRound.financialChange.netWorthChangeWan
  );
});

test("reconciles annual salary plus side-income narrative for a one-month stage", () => {
  const previous = normalizeInitialFinancialState({
    cashWan: 1.2,
    investmentAssetsWan: 0,
    propertyMarketValueWan: 0,
    businessAndOtherAssetsWan: 0,
    totalDebtWan: 0,
    annualAfterTaxIncomeWan: 20,
    annualDisposableIncomeWan: 10,
    annualCoreExpenseWan: 10,
    employmentStatus: "employed",
    incomeStability: "stable",
    isEstimated: true
  }, 32 * 12 + 9, 45);

  const result = applyFinancialSignals(previous, {
    employmentStatus: "employed",
    monthlyNetIncomeWan: 3.1,
    incomeMonths: 1,
    monthlyLivingExpenseWan: 0.7,
    oneOffIncomeWan: 0,
    oneOffExpenseWan: 0,
    assetValueChangeWan: 0,
    propertyMarketValueChangeWan: 0,
    personalDebtChangeWan: 0,
    incomeStability: "volatile",
    confidence: 0.9,
    reasons: ["年薪三十二万元折合月收入约二点七万元", "副业当月收入四千元"]
  }, 1, 32 * 12 + 10);

  assert.equal(result.financialChange.afterTaxIncomeWan, 3.1);
  assert.equal(result.financialChange.livingExpenseWan, 0.7);
  assert.equal(result.financialChange.netWorthChangeWan, 2.4);
  assert.equal(result.financialState.netWorthWan, 3.6);
});

test("reconciles a fourteen-month salary and community-income accumulation", () => {
  const previous = normalizeInitialFinancialState({
    cashWan: 40,
    investmentAssetsWan: 0,
    propertyMarketValueWan: 0,
    businessAndOtherAssetsWan: 0,
    totalDebtWan: 0,
    annualAfterTaxIncomeWan: 32,
    annualDisposableIncomeWan: 24,
    annualCoreExpenseWan: 8,
    employmentStatus: "employed",
    incomeStability: "volatile",
    isEstimated: true
  }, 39 * 12, 55);

  const result = applyFinancialSignals(previous, {
    employmentStatus: "employed",
    monthlyNetIncomeWan: 3.5,
    incomeMonths: 14,
    monthlyLivingExpenseWan: 0.4,
    oneOffIncomeWan: 0.3,
    oneOffExpenseWan: 0,
    assetValueChangeWan: 0,
    propertyMarketValueChangeWan: 0,
    personalDebtChangeWan: 0,
    incomeStability: "volatile",
    confidence: 0.9,
    reasons: ["月薪二点五万元", "社群月收入一万元", "阶段内另有三千元项目结算"]
  }, 14, 40 * 12 + 2);

  assert.equal(result.financialChange.afterTaxIncomeWan, 49.3);
  assert.equal(result.financialChange.livingExpenseWan, 5.6);
  assert.equal(result.financialChange.netWorthChangeWan, 43.7);
  assert.equal(result.financialState.netWorthWan, 83.7);
  assert.equal(
    Math.round((result.financialState.netWorthWan - previous.netWorthWan) * 10) / 10,
    result.financialChange.netWorthChangeWan
  );
});

test("keeps cumulative wealth and stage change aligned when health costs exceed income", () => {
  const previous = normalizeInitialFinancialState({
    cashWan: 115.8,
    investmentAssetsWan: 0,
    propertyMarketValueWan: 0,
    businessAndOtherAssetsWan: 0,
    totalDebtWan: 0,
    annualAfterTaxIncomeWan: 30,
    annualDisposableIncomeWan: 15.6,
    annualCoreExpenseWan: 14.4,
    employmentStatus: "employed",
    incomeStability: "volatile",
    isEstimated: true
  }, 39 * 12 + 6, 60);

  const result = applyFinancialSignals(previous, {
    employmentStatus: "medical_leave",
    monthlyNetIncomeWan: 2.5,
    incomeMonths: 3,
    monthlyLivingExpenseWan: 1.2,
    oneOffIncomeWan: 0,
    oneOffExpenseWan: 5.1,
    assetValueChangeWan: 0,
    propertyMarketValueChangeWan: 0,
    personalDebtChangeWan: 0,
    incomeStability: "unstable",
    confidence: 0.9,
    reasons: ["六个月中只有三个月取得工资", "生活与治疗支出增加"]
  }, 6, 40 * 12);

  assert.equal(result.financialChange.afterTaxIncomeWan, 7.5);
  assert.equal(result.financialChange.livingExpenseWan, 7.2);
  assert.equal(result.financialChange.netWorthChangeWan, -4.8);
  assert.equal(result.financialState.netWorthWan, 111);
});

function propertyTestState() {
  return normalizeInitialFinancialState({
    cashWan: 391,
    investmentAssetsWan: 0,
    propertyMarketValueWan: 0,
    businessAndOtherAssetsWan: 0,
    totalDebtWan: 0,
    annualAfterTaxIncomeWan: 0,
    annualDisposableIncomeWan: 0,
    annualCoreExpenseWan: 0,
    employmentStatus: "employed",
    incomeStability: "stable",
    isEstimated: false
  }, 50 * 12, 70);
}

function propertySignals(overrides: Partial<Parameters<typeof applyFinancialSignals>[1]>) {
  return {
    employmentStatus: "employed" as const,
    monthlyNetIncomeWan: 0,
    incomeMonths: 0,
    monthlyLivingExpenseWan: 0,
    oneOffIncomeWan: 0,
    oneOffExpenseWan: 0,
    assetValueChangeWan: 0,
    propertyMarketValueChangeWan: 0,
    personalDebtChangeWan: 0,
    incomeStability: "stable" as const,
    confidence: 0.9,
    reasons: ["房产交易"],
    ...overrides
  };
}

test("records a mortgaged home purchase as an asset transfer plus fees", () => {
  const previous = propertyTestState();
  const result = applyFinancialSignals(previous, propertySignals({
    oneOffExpenseWan: 63,
    propertyMarketValueChangeWan: 180,
    personalDebtChangeWan: 120
  }), 1, 50 * 12 + 1);

  assert.equal(result.financialState.cashWan, 328);
  assert.equal(result.financialState.propertyMarketValueWan, 180);
  assert.equal(result.financialState.totalDebtWan, 120);
  assert.equal(result.financialChange.netWorthChangeWan, -3);
  assert.equal(result.financialState.netWorthWan, 388);
});

test("keeps net worth stable for full-cash property purchases and sales", () => {
  const purchase = applyFinancialSignals(propertyTestState(), propertySignals({
    oneOffExpenseWan: 100,
    propertyMarketValueChangeWan: 100
  }), 1, 50 * 12 + 1);
  assert.equal(purchase.financialChange.netWorthChangeWan, 0);
  assert.equal(purchase.financialState.netWorthWan, 391);

  const sale = applyFinancialSignals(purchase.financialState, propertySignals({
    oneOffIncomeWan: 100,
    propertyMarketValueChangeWan: -100
  }), 1, 50 * 12 + 2);
  assert.equal(sale.financialChange.netWorthChangeWan, 0);
  assert.equal(sale.financialState.netWorthWan, 391);
});

test("adds property appreciation to cumulative net worth", () => {
  const result = applyFinancialSignals(propertyTestState(), propertySignals({
    propertyMarketValueChangeWan: 10,
    reasons: ["房产升值十万元"]
  }), 12, 51 * 12);
  assert.equal(result.financialChange.netWorthChangeWan, 10);
  assert.equal(result.financialState.netWorthWan, 401);
});

test("requires property value direction for completed purchases and sales", () => {
  assert.deepEqual(
    getPropertyTransactionSignalIssues("你支付了60万首付并办理房贷，房产已经完成过户。", propertySignals({})),
    ["正文已发生购房，但 propertyMarketValueChangeWan 未填写正数房产价值"]
  );
  assert.deepEqual(
    getPropertyTransactionSignalIssues("你出售了名下房产并完成交割。", propertySignals({})),
    ["正文已发生卖房，但 propertyMarketValueChangeWan 未填写负数房产价值"]
  );
  assert.deepEqual(
    getPropertyTransactionSignalIssues("你支付了60万首付并办理房贷。", propertySignals({ propertyMarketValueChangeWan: 180 })),
    []
  );
  assert.deepEqual(
    getPropertyTransactionSignalIssues("你卖出旧房后又买下一套新房。", propertySignals({ propertyMarketValueChangeWan: 0 })),
    []
  );
});

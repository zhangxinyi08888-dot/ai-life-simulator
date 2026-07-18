import assert from "node:assert/strict";
import test from "node:test";
import type { FinancialState, UserInitialData } from "../../types";
import { applyOpeningFactsToFinancialState, extractOpeningFinancialFacts } from "./openingFinancialFacts";

const userData: UserInitialData = {
  birthday: "1998-01-01", birthtime: "08:00", gender: "女", currentSituation: "准备重新选择职业",
  isReturnToPast: true, targetAgeNode: "24岁", regressionNodeKey: "career", regressionAge: 24,
  regressionSituation: "刚背上房贷", regressionChoices: "创业或留职", coreStoryFocus: "career"
};

test("extracts explicit opening cash, mortgage, payment and salary without inventing a property value", () => {
  const facts = extractOpeningFinancialFacts(userData, [{
    id: 1,
    question: "当时财务情况？",
    answer: "我年薪税后约38万元，房贷余额210万元，每月还款1.3万元，家庭备用金约35万元。"
  }]);
  assert.equal(facts.cashWan, 35);
  assert.equal(facts.mortgagePrincipalWan, 210);
  assert.equal(facts.mortgageMonthlyPaymentWan, 1.3);
  assert.equal(facts.annualAfterTaxIncomeWan, 38);
  assert.equal(facts.ownsProperty, true);
  assert.equal(facts.propertyMarketValueWan, undefined);
});

test("negative mortgage wording does not create an opening debt", () => {
  const facts = extractOpeningFinancialFacts(userData, [{ id: 1, question: "财务？", answer: "存款25万元，没有房贷。" }]);
  assert.equal(facts.cashWan, 25);
  assert.equal(facts.mortgagePrincipalWan, undefined);
});

test("explicit user facts override only matching aggregate fields", () => {
  const state: FinancialState = {
    currencyUnit: "CNY_WAN_REAL", asOfAgeInMonths: 288, cashWan: 5, investmentAssetsWan: 5,
    propertyMarketValueWan: 0, businessAndOtherAssetsWan: 0, totalDebtWan: 0, netWorthWan: 10,
    annualAfterTaxIncomeWan: 20, annualCoreExpenseWan: 18, annualDisposableIncomeWan: 2,
    employmentStatus: "employed", incomeStability: "stable", isEstimated: true
  };
  const facts = extractOpeningFinancialFacts(userData, [{ id: 1, question: "财务？", answer: "备用金35万，房贷余额210万，税后年薪38万。" }]);
  const merged = applyOpeningFactsToFinancialState(state, facts);
  assert.equal(merged.cashWan, 35);
  assert.equal(merged.investmentAssetsWan, 5);
  assert.equal(merged.totalDebtWan, 210);
  assert.equal(merged.annualAfterTaxIncomeWan, 38);
  assert.equal(merged.netWorthWan, -170);
});

import assert from "node:assert/strict";
import test from "node:test";
import type { FinancialState, UserInitialData } from "../../types";
import { migrateLegacyFinancialState } from "./migrateLegacyFinancialState";
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

test("captures compact free-text mortgage wording and preserves every known opening fact", () => {
  const facts = extractOpeningFinancialFacts({
    ...userData,
    regressionSituation: "刚背上210万元房贷、月供1.3万元，住进自有住房。"
  }, []);
  assert.equal(facts.mortgagePrincipalWan, 210);
  assert.equal(facts.mortgageMonthlyPaymentWan, 1.3);
  assert.equal(facts.ownsProperty, true);

  const state: FinancialState = {
    currencyUnit: "CNY_WAN_REAL", asOfAgeInMonths: 288, cashWan: 10, investmentAssetsWan: 0,
    propertyMarketValueWan: 0, businessAndOtherAssetsWan: 0, totalDebtWan: 210, netWorthWan: -200,
    annualAfterTaxIncomeWan: 30, annualCoreExpenseWan: 0, annualDisposableIncomeWan: 30,
    employmentStatus: "employed", incomeStability: "stable", isEstimated: true
  };
  const ledger = migrateLegacyFinancialState({ id: "opening", legacyState: state, openingFacts: facts });
  assert.equal(ledger.debtAccounts[0]?.id, "opening_mortgage");
  assert.equal(ledger.debtAccounts[0]?.repaymentPolicy.monthlyPaymentWan, 1.3);
  assert.ok(ledger.assetAccounts.some((account) => account.type === "property" && account.factStatus === "needs_review"));
});

test("creates deterministic estimated basic living for an adult opening with zero expenses", () => {
  const state: FinancialState = {
    currencyUnit: "CNY_WAN_REAL", asOfAgeInMonths: 300, cashWan: 10, investmentAssetsWan: 0,
    propertyMarketValueWan: 0, businessAndOtherAssetsWan: 0, totalDebtWan: 0, netWorthWan: 10,
    annualAfterTaxIncomeWan: 30, annualCoreExpenseWan: 0, annualDisposableIncomeWan: 30,
    employmentStatus: "employed", incomeStability: "stable", isEstimated: true
  };
  const first = migrateLegacyFinancialState({ id: "first", legacyState: state });
  const second = migrateLegacyFinancialState({ id: "second", legacyState: state });
  const commitment = first.expenseCommitments.find((item) => item.type === "basic_living");
  assert.equal(commitment?.monthlyAmountWan, 0.35);
  assert.equal(commitment?.factStatus, "estimated");
  assert.equal(commitment?.evidence[0]?.source, "system_policy");
  assert.deepEqual(first.expenseCommitments, second.expenseCommitments);
});

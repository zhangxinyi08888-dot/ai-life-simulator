import assert from "node:assert/strict";
import test from "node:test";
import type { FinancialState, UserInitialData } from "../../types";
import { migrateLegacyFinancialState } from "./migrateLegacyFinancialState";
import { applyOpeningFactsToFinancialState, extractOpeningExpenseFacts, extractOpeningFinancialFacts } from "./openingFinancialFacts";

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

test("a parent transfer is not misclassified as a mortgage payment", () => {
  const facts = extractOpeningFinancialFacts(userData, [{
    id: 1,
    question: "财务？",
    answer: "我每月给父母转4000元作为生活费，没有房贷。"
  }]);
  assert.equal(facts.mortgageMonthlyPaymentWan, undefined);
  assert.equal(facts.expenseFacts?.find((item) => item.type === "dependent_support")?.monthlyAmountWan, 0.4);
});

test("opening parent support ignores a nearby savings balance and repeated questionnaire wording", () => {
  const sentence = "我来自普通家庭，当时存款只有5万元，每月还要给父母2000元，没有房贷。";
  const facts = extractOpeningExpenseFacts(`${sentence}\n${sentence}\n${sentence}`)
    .filter((item) => item.type === "dependent_support");
  assert.equal(facts.length, 1);
  assert.equal(facts[0]?.monthlyAmountWan, 0.2);
  assert.equal(facts[0]?.evidenceText, sentence.slice(0, -1));
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

test("captures compact mortgage wording without using debt balance as property value", () => {
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
  const property = ledger.assetAccounts.find((account) => account.type === "property");
  assert.equal(property?.id, "opening_property_value_pending");
  assert.equal(property?.factStatus, "needs_review");
  assert.equal(property?.marketValueWan, 0);
  assert.equal(property?.evidence[0]?.source, "user");
  assert.equal(
    ledger.unresolvedIssues.find((issue) => issue.id === "opening_property_value_pending_288")?.severity,
    "warning"
  );
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

test("O-01/O-02 deterministically extracts typed opening rent and parent medical responsibilities", () => {
  const facts = extractOpeningExpenseFacts("我每月房租5000元，父母医疗费3000元，另外还有日常开销。");
  const housing = facts.find((item) => item.type === "housing");
  const healthcare = facts.find((item) => item.type === "healthcare");
  assert.equal(housing?.monthlyAmountWan, 0.5);
  assert.equal(housing?.responsibilityKey, "primary_residence:main");
  assert.equal(housing?.factStatus, "known");
  assert.equal(healthcare?.monthlyAmountWan, 0.3);
  assert.equal(healthcare?.responsibilityKey, "recurring_healthcare:opening_parent");
  assert.equal(healthcare?.factStatus, "known");
});

test("opening binds mixed-payer expense clauses independently", () => {
  const facts = extractOpeningExpenseFacts("我已经每月支付房租5000元，伴侣承担父母医疗1200元；未来只考虑搬家。");
  const housing = facts.find((item) => item.type === "housing");
  const healthcare = facts.find((item) => item.type === "healthcare");
  assert.equal(housing?.monthlyAmountWan, 0.5);
  assert.equal(housing?.factStatus, "known");
  assert.equal(healthcare, undefined);
});

test("opening converts an explicit protagonist-paid quarterly parent rehabilitation course into monthly healthcare", () => {
  const facts = extractOpeningExpenseFacts("我已经每月支付个人房租5000元，并开始承担父亲康复课程，每季度3600元。");
  const housing = facts.find((item) => item.type === "housing");
  const care = facts.find((item) => item.responsibilityKind === "recurring_healthcare");
  assert.equal(housing?.monthlyAmountWan, 0.5);
  assert.equal(care?.responsibilityKey, "recurring_healthcare:opening_parent");
  assert.equal(care?.type, "healthcare");
  assert.equal(care?.cadence, "quarterly");
  assert.equal(care?.monthlyAmountWan, 0.12);
  assert.equal(care?.factStatus, "known");
  assert.equal(care?.financialScope, "personal");
});

test("O-02 records a shared rental as the protagonist share rather than the household total", () => {
  const facts = extractOpeningExpenseFacts("月租5200元，两人各承担一半。");
  const housing = facts.find((item) => item.type === "housing");
  assert.equal(housing?.grossMonthlyAmountWan, 0.52);
  assert.equal(housing?.protagonistShareRate, 0.5);
  assert.equal(housing?.monthlyAmountWan, 0.26);
  assert.equal(housing?.financialScope, "shared_household");
});

test("O-01 leaves explicit but unpriced responsibilities reviewable and never collapses them into basic living", () => {
  const facts = extractOpeningExpenseFacts("目前有房租，也在承担父母医疗支出。");
  const housing = facts.find((item) => item.type === "housing");
  const healthcare = facts.find((item) => item.type === "healthcare");
  assert.equal(housing?.factStatus, "needs_review");
  assert.equal(housing?.monthlyAmountWan, undefined);
  assert.equal(healthcare?.factStatus, "needs_review");
  assert.equal(healthcare?.monthlyAmountWan, undefined);
  assert.equal(facts.some((item) => item.type === "basic_living"), false);
});

test("opening third-party tuition promise never becomes a protagonist education commitment", () => {
  const inputs = [
    "家里明确表示承担国内学费没问题，但希望你毕业后尽快稳定就业。",
    "我自学过一点网页制作，美术基础不错，家里愿意承担国内学费，但希望我毕业后尽快稳定就业。"
  ];
  for (const input of inputs) {
    const facts = extractOpeningExpenseFacts(input);
    assert.equal(facts.some((item) => item.type === "education"), false, input);
  }
});

test("E-31 allocates a parent transfer into its medical and living components without a duplicate aggregate", () => {
  const facts = extractOpeningExpenseFacts("我每月给父母转4000元，其中医疗3000元、生活费1000元。");
  const healthcare = facts.filter((item) => item.type === "healthcare");
  const support = facts.filter((item) => item.type === "dependent_support");
  assert.deepEqual(healthcare.map((item) => item.monthlyAmountWan), [0.3]);
  assert.deepEqual(support.map((item) => item.monthlyAmountWan), [0.1]);
  assert.equal([...healthcare, ...support].reduce((sum, item) => sum + (item.monthlyAmountWan || 0), 0), 0.4);
});

test("opening business premises are not misclassified as personal housing", () => {
  const facts = extractOpeningExpenseFacts("公司租下一间木工坊，每月租金5000元。");
  assert.equal(facts.some((item) => item.type === "housing"), false);
});

test("opening compatibility aggregate is cleared before the accepted expense-account path", () => {
  const state: FinancialState = {
    currencyUnit: "CNY_WAN_REAL", asOfAgeInMonths: 288, cashWan: 5, investmentAssetsWan: 0,
    propertyMarketValueWan: 0, businessAndOtherAssetsWan: 0, totalDebtWan: 0, netWorthWan: 5,
    annualAfterTaxIncomeWan: 20, annualCoreExpenseWan: 18, annualDisposableIncomeWan: 2,
    employmentStatus: "employed", incomeStability: "stable", isEstimated: true
  };
  const facts = extractOpeningFinancialFacts({ ...userData, currentSituation: "没有说明任何持续支出" }, []);
  const merged = applyOpeningFactsToFinancialState(state, facts);
  assert.equal(merged.annualCoreExpenseWan, 0);
  assert.equal(merged.annualDisposableIncomeWan, 20);
});

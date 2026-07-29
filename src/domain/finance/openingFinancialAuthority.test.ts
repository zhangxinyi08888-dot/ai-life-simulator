import assert from "node:assert/strict";
import test from "node:test";
import type { FinancialState, UserInitialData } from "../../types";
import { deriveDebtHealthState } from "./debtHealth";
import { deriveFinancialState } from "./deriveFinancialState";
import { isDebtCrisisEligibleAccount, isNarrativeEligibleFinancialFact, isReportEligibleFinancialFact } from "./financialFactEligibility";
import { migrateLegacyFinancialState } from "./migrateLegacyFinancialState";
import { applyAuthoritativeOpeningFactsToFinancialState, extractOpeningFinancialFacts } from "./openingFinancialFacts";

const userData: UserInitialData = {
  birthday: "1990-01-01", birthtime: "08:00", gender: "女", currentSituation: "手里有20万元存款",
  isReturnToPast: true, targetAgeNode: "30岁", regressionNodeKey: "career", regressionAge: 30,
  regressionSituation: "准备换工作", regressionChoices: "继续尝试", coreStoryFocus: "career"
};

function modelState(): FinancialState {
  return {
    currencyUnit: "CNY_WAN_REAL", asOfAgeInMonths: 360, cashWan: 20, investmentAssetsWan: 10,
    propertyMarketValueWan: 200, businessAndOtherAssetsWan: 30, totalDebtWan: 120, netWorthWan: 140,
    annualAfterTaxIncomeWan: 30, annualCoreExpenseWan: 18, annualDisposableIncomeWan: 12,
    employmentStatus: "employed", incomeStability: "stable", isEstimated: true
  };
}

test("PB-OPEN-01 and PB-OPEN-02 user cash survives while model assets and debt are ignored", () => {
  const facts = extractOpeningFinancialFacts(userData, []);
  const result = applyAuthoritativeOpeningFactsToFinancialState(modelState(), facts);
  assert.equal(result.ignoredModelBalance, true);
  assert.deepEqual({
    cash: result.state.cashWan,
    investments: result.state.investmentAssetsWan,
    property: result.state.propertyMarketValueWan,
    business: result.state.businessAndOtherAssetsWan,
    debt: result.state.totalDebtWan
  }, { cash: 20, investments: 0, property: 0, business: 0, debt: 0 });
  const ledger = migrateLegacyFinancialState({ id: "opening", legacyState: result.state, openingFacts: facts });
  assert.equal(ledger.cashAccounts[0].balanceWan, 20);
  assert.equal(ledger.assetAccounts.length, 0);
  assert.equal(ledger.debtAccounts.length, 0);
});

test("PB-OPEN-03 explicit property and mortgage carry user evidence", () => {
  const explicitUser = { ...userData, currentSituation: "名下房产市值200万元，房贷余额120万元，存款20万元" };
  const facts = extractOpeningFinancialFacts(explicitUser, []);
  const result = applyAuthoritativeOpeningFactsToFinancialState(modelState(), facts);
  const ledger = migrateLegacyFinancialState({ id: "opening_explicit", legacyState: result.state, openingFacts: facts });
  const property = ledger.assetAccounts.find((account) => account.type === "property")!;
  const mortgage = ledger.debtAccounts.find((account) => account.type === "mortgage")!;
  assert.equal(property.evidence[0].source, "user");
  assert.equal(mortgage.evidence[0].source, "user");
  assert.equal(mortgage.origin, "explicit");
  assert.equal(isNarrativeEligibleFinancialFact(property), true);
  assert.equal(isDebtCrisisEligibleAccount(mortgage), true);
});

test("PB-OPEN-04 legacy-only property and debt stay in audit but not narrative, report or debt crisis", () => {
  const ledger = migrateLegacyFinancialState({ id: "legacy", legacyState: modelState() });
  const property = ledger.assetAccounts.find((account) => account.type === "property")!;
  const debt = ledger.debtAccounts[0];
  assert.equal(isNarrativeEligibleFinancialFact(property), false);
  assert.equal(isReportEligibleFinancialFact(property), false);
  assert.equal(isDebtCrisisEligibleAccount(debt), false);
  const derived = deriveFinancialState({ ledger, employmentStatus: "employed" });
  assert.equal(deriveDebtHealthState({ ledger, derivedFinancialState: derived.state }).level, "none");
});

test("accepted estimated debt remains eligible while legacy estimated debt stays isolated", () => {
  const ledger = migrateLegacyFinancialState({ id: "accepted_estimate", legacyState: modelState() });
  const debt = ledger.debtAccounts[0];
  debt.evidence = [{ source: "accepted_simulation_outcome", sourceEventId: "accepted_choice", reasonCode: "ACCEPTED_ESTIMATE", confidence: 0.7 }];
  assert.equal(debt.factStatus, "estimated");
  assert.equal(isNarrativeEligibleFinancialFact(debt), true);
  assert.equal(isDebtCrisisEligibleAccount(debt), true);
});

import assert from "node:assert/strict";
import test from "node:test";
import { initializeOpeningFinancialLedger } from "./initializeOpeningFinancialLedger";

test("opening facts become accepted events before the ledger is authoritative", () => {
  const result = initializeOpeningFinancialLedger({
    id: "opening", linkedCareerStateId: "career",
    proposedState: {
      currencyUnit: "CNY_WAN_REAL", asOfAgeInMonths: 288, cashWan: 35, investmentAssetsWan: 0,
      propertyMarketValueWan: 0, businessAndOtherAssetsWan: 0, totalDebtWan: 210, netWorthWan: -175,
      annualAfterTaxIncomeWan: 38, annualCoreExpenseWan: 0, annualDisposableIncomeWan: 38,
      employmentStatus: "employed", incomeStability: "stable", isEstimated: true
    },
    openingFacts: {
      evidenceText: "刚背上210万元房贷，月供1.3万元，存款35万元",
      cashWan: 35, ownsProperty: true, mortgagePrincipalWan: 210, mortgageMonthlyPaymentWan: 1.3
    }
  });
  assert.deepEqual(result.ledger.openingAcceptedEventIds, result.acceptedEvents.map((event) => event.id));
  assert.ok(result.acceptedEvents.some((event) => event.kind === "asset" && event.payload.factStatus === "estimated"));
  assert.ok(result.acceptedEvents.some((event) => event.kind === "debt"));
  assert.ok(result.acceptedEvents.some((event) => event.kind === "expense_commitment"));
  assert.equal(result.ledger.debtAccounts[0].principalWan, 210);
  assert.equal(result.ledger.assetAccounts.find((item) => item.type === "property")?.marketValueWan, 210);
});

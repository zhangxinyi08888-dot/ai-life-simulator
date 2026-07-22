import assert from "node:assert/strict";
import test from "node:test";
import { deriveFinancialState } from "./deriveFinancialState";
import { initializeFinancialLedger } from "./initializeLedger";
import { ledgerNetWorthWan, PRIMARY_CASH_ACCOUNT_ID, totalAssetWan } from "./ledgerMath";
import { reduceFinancialLedger } from "./reduceFinancialLedger";
import type { AcceptedFinancialEvent, FinancialEvidence } from "./types";

const evidence: FinancialEvidence[] = [{ source: "accepted_simulation_outcome", sourceEventId: "exchange", reasonCode: "TEST", confidence: 1 }];

test("PB-ASSET-03 and PB-ASSET-04 a home exchange is atomic and all summaries share the same asset set", () => {
  const ledger = initializeFinancialLedger({
    id: "home_exchange", asOfAgeInMonths: 480,
    openingPosition: {
      cashAccounts: [{ id: PRIMARY_CASH_ACCOUNT_ID, type: "bank_deposit", balanceWan: 10, status: "active", factStatus: "known", evidence }],
      assetAccounts: [{ id: "city_home", type: "property", displayName: "城市公寓", marketValueWan: 100, liquidity: "illiquid", status: "active", factStatus: "known", openedAtAgeInMonths: 360, evidence }]
    }
  });
  const events: AcceptedFinancialEvent[] = [{
    id: "sold_city_home", kind: "asset_sold", effectiveAtAgeInMonths: 481,
    payload: { assetAccountId: "city_home", destinationCashAccountId: PRIMARY_CASH_ACCOUNT_ID, assetValueRemovedWan: 100, cashReceivedWan: 80, transactionFeeWan: 2 },
    evidence, acceptedByReasonCodes: ["TEST"]
  }, {
    id: "bought_country_home", kind: "asset_purchased", effectiveAtAgeInMonths: 481,
    payload: {
      sourceCashAccountId: PRIMARY_CASH_ACCOUNT_ID, cashPaidWan: 80, transactionFeeWan: 1,
      assetAccount: { id: "country_home", type: "property", displayName: "郊区平房", marketValueWan: 80, liquidity: "illiquid", status: "active", factStatus: "known", openedAtAgeInMonths: 481, evidence }
    },
    evidence, acceptedByReasonCodes: ["TEST"]
  }];
  const result = reduceFinancialLedger({
    ledger, transactionId: "home_exchange_tx", expectedLedgerRevision: 0,
    periodStartAgeInMonths: 480, periodEndAgeInMonths: 481, events,
    liquidityPolicy: "require_explicit"
  });
  if (!("periodSummary" in result)) assert.fail("fresh transaction must return a period summary");
  const derived = deriveFinancialState({ ledger: result.ledger, periodSummary: result.periodSummary, employmentStatus: "not_working" });
  assert.equal(result.ledger.cashAccounts[0].balanceWan, 7);
  assert.equal(result.ledger.assetAccounts.find((account) => account.id === "city_home")?.status, "disposed");
  assert.equal(result.ledger.assetAccounts.find((account) => account.id === "country_home")?.marketValueWan, 80);
  assert.equal(totalAssetWan(result.ledger), 80);
  assert.equal(derived.state.propertyMarketValueWan, 80);
  assert.equal(derived.state.netWorthWan, ledgerNetWorthWan(result.ledger));
});

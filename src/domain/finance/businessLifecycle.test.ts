import assert from "node:assert/strict";
import test from "node:test";
import { deriveFinancialState } from "./deriveFinancialState";
import { initializeFinancialLedger } from "./initializeLedger";
import { FinancialLedgerInvariantError, PRIMARY_CASH_ACCOUNT_ID } from "./ledgerMath";
import { reduceFinancialLedger } from "./reduceFinancialLedger";
import type {
  AcceptedFinancialEvent,
  BusinessHolding,
  FinancialEventKind,
  FinancialEventPayloadMap,
  FinancialEvidence
} from "./types";

const evidence: FinancialEvidence[] = [{ source: "accepted_history", reasonCode: "BUSINESS_FACT_CONFIRMED", confidence: 1 }];

function accepted<K extends FinancialEventKind>(
  id: string,
  kind: K,
  effectiveAtAgeInMonths: number,
  payload: FinancialEventPayloadMap[K]
): AcceptedFinancialEvent<K> {
  return { id, kind, effectiveAtAgeInMonths, payload, evidence, acceptedByReasonCodes: ["ENTITY_BOUNDARY_CONFIRMED"] } as AcceptedFinancialEvent<K>;
}

function holding(overrides: Partial<BusinessHolding> = {}): BusinessHolding {
  return {
    id: "founder_holding",
    business: {
      id: "company",
      displayName: "创业公司",
      status: "operating",
      factStatus: "known",
      evidence
    },
    ownershipRate: 0.2,
    attributableValueWan: 20,
    liquidityDiscountRate: 0.5,
    personalCarryingValueWan: 10,
    status: "active",
    factStatus: "known",
    evidence,
    ...overrides
  };
}

function businessLedger(businessHolding = holding(), cashWan = 10) {
  return initializeFinancialLedger({
    id: "ledger_business_lifecycle",
    asOfAgeInMonths: 360,
    openingPosition: {
      cashAccounts: [{ id: PRIMARY_CASH_ACCOUNT_ID, type: "bank_deposit", balanceWan: cashWan, status: "active", factStatus: "known", evidence }],
      assetAccounts: [{
        id: "fund",
        type: "investment",
        displayName: "个人基金",
        marketValueWan: 5,
        liquidity: "liquid",
        status: "active",
        factStatus: "known",
        openedAtAgeInMonths: 350,
        evidence
      }],
      businessHoldings: [businessHolding]
    }
  });
}

test("a confirmed founder stake creates a holding even when valuation is pending", () => {
  const ledger = initializeFinancialLedger({
    id: "founder_start", asOfAgeInMonths: 360,
    openingPosition: { cashAccounts: [{ id: PRIMARY_CASH_ACCOUNT_ID, type: "bank_deposit", balanceWan: 5, status: "active", factStatus: "known", evidence }] }
  });
  const result = reduceFinancialLedger({
    ledger, transactionId: "founder_start", expectedLedgerRevision: 0,
    periodStartAgeInMonths: 360, periodEndAgeInMonths: 361,
    events: [accepted("holding_started", "business_holding_started", 361, holding({
      instrumentType: "equity", ownershipRate: undefined, attributableValueWan: undefined,
      personalCarryingValueWan: 0, factStatus: "needs_review"
    }))]
  });
  assert.equal(result.ledger.businessHoldings.length, 1);
  assert.equal(result.ledger.businessHoldings[0].factStatus, "needs_review");
  assert.equal(result.ledger.businessHoldings[0].personalCarryingValueWan, 0);
});

test("company financing remains a company fact and does not change personal cash or carrying value", () => {
  const result = reduceFinancialLedger({
    ledger: businessLedger(),
    transactionId: "tx_company_financing",
    expectedLedgerRevision: 0,
    periodStartAgeInMonths: 360,
    periodEndAgeInMonths: 361,
    events: [accepted("financing", "business_financing_recorded", 361, {
      businessHoldingId: "founder_holding",
      financingAmountWan: 500,
      postMoneyValuationWan: 1000,
      ownershipRateAfterFinancing: 0.15,
      personalCashReceivedWan: 0
    })]
  });
  assert.equal(result.alreadyCommitted, false);
  const updated = result.ledger.businessHoldings[0];
  assert.equal(result.ledger.cashAccounts[0].balanceWan, 10);
  assert.equal(updated.personalCarryingValueWan, 10);
  assert.equal(updated.business.latestFinancingAmountWan, 500);
  assert.equal(updated.business.latestPostMoneyValuationWan, 1000);
  assert.equal(updated.ownershipRate, 0.15);
  assert.equal(result.periodSummary.incomeWan, 0);
  assert.equal(result.periodSummary.netWorthChangeWan, 0);
});

test("personal business value requires valuation, ownership and the recorded liquidity discount", () => {
  const result = reduceFinancialLedger({
    ledger: businessLedger(),
    transactionId: "tx_holding_revalue",
    expectedLedgerRevision: 0,
    periodStartAgeInMonths: 360,
    periodEndAgeInMonths: 361,
    events: [accepted("revalue", "business_holding_revalued", 361, {
      businessHoldingId: "founder_holding",
      previousCarryingValueWan: 10,
      newCarryingValueWan: 100,
      postMoneyValuationWan: 1000,
      ownershipRate: 0.2,
      valuationEvidence: evidence
    })]
  });
  assert.equal(result.alreadyCommitted, false);
  assert.equal(result.ledger.cashAccounts[0].balanceWan, 10);
  assert.equal(result.ledger.businessHoldings[0].attributableValueWan, 200);
  assert.equal(result.ledger.businessHoldings[0].personalCarryingValueWan, 100);
  assert.equal(result.periodSummary.valuationChangeWan, 90);
  assert.equal(result.periodSummary.netWorthChangeWan, 90);

  assert.throws(() => reduceFinancialLedger({
    ledger: businessLedger(),
    transactionId: "tx_invalid_revalue",
    expectedLedgerRevision: 0,
    periodStartAgeInMonths: 360,
    periodEndAgeInMonths: 361,
    events: [accepted("invalid_revalue", "business_holding_revalued", 361, {
      businessHoldingId: "founder_holding",
      previousCarryingValueWan: 10,
      newCarryingValueWan: 1000,
      postMoneyValuationWan: 1000,
      ownershipRate: 0.2,
      valuationEvidence: evidence
    })]
  }), (error: unknown) => error instanceof FinancialLedgerInvariantError && error.code === "UNBALANCED_TRANSACTION");
});

test("a business distribution is personal cash income without changing equity value", () => {
  const result = reduceFinancialLedger({
    ledger: businessLedger(),
    transactionId: "tx_distribution",
    expectedLedgerRevision: 0,
    periodStartAgeInMonths: 360,
    periodEndAgeInMonths: 361,
    events: [accepted("distribution", "business_distribution_received", 361, {
      businessHoldingId: "founder_holding",
      destinationCashAccountId: PRIMARY_CASH_ACCOUNT_ID,
      amountWan: 5
    })]
  });
  assert.equal(result.alreadyCommitted, false);
  assert.equal(result.ledger.cashAccounts[0].balanceWan, 15);
  assert.equal(result.ledger.businessHoldings[0].personalCarryingValueWan, 10);
  assert.equal(result.periodSummary.incomeWan, 5);
  assert.equal(result.periodSummary.netWorthChangeWan, 5);
});

test("selling founder equity pairs personal cash proceeds with equity and ownership reduction", () => {
  const result = reduceFinancialLedger({
    ledger: businessLedger(holding({ attributableValueWan: 200, personalCarryingValueWan: 100 })),
    transactionId: "tx_holding_sale",
    expectedLedgerRevision: 0,
    periodStartAgeInMonths: 360,
    periodEndAgeInMonths: 361,
    events: [accepted("sale", "business_holding_sold", 361, {
      businessHoldingId: "founder_holding",
      destinationCashAccountId: PRIMARY_CASH_ACCOUNT_ID,
      holdingValueRemovedWan: 50,
      ownershipRateSold: 0.1,
      cashReceivedWan: 60,
      transactionFeeWan: 1
    })]
  });
  assert.equal(result.alreadyCommitted, false);
  assert.equal(result.ledger.cashAccounts[0].balanceWan, 69);
  assert.equal(result.ledger.businessHoldings[0].personalCarryingValueWan, 50);
  assert.equal(result.ledger.businessHoldings[0].ownershipRate, 0.1);
  assert.equal(result.ledger.businessHoldings[0].status, "partially_sold");
  assert.equal(result.transaction.nonCashGainLossWan, 10);
  assert.equal(result.periodSummary.netWorthChangeWan, 9);
});

test("derived state keeps liquid investments and illiquid business equity in separate fields", () => {
  const derived = deriveFinancialState({ ledger: businessLedger(), employmentStatus: "self_employed" }).state;
  assert.equal(derived.investmentAssetsWan, 5);
  assert.equal(derived.businessAndOtherAssetsWan, 10);
  assert.equal(derived.cashWan, 10);
  assert.equal(derived.netWorthWan, 25);
});

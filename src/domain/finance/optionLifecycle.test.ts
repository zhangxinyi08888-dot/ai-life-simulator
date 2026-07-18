import assert from "node:assert/strict";
import test from "node:test";
import { deriveFinancialState } from "./deriveFinancialState";
import { initializeFinancialLedger } from "./initializeLedger";
import { FinancialLedgerInvariantError, PRIMARY_CASH_ACCOUNT_ID } from "./ledgerMath";
import { reduceFinancialLedger } from "./reduceFinancialLedger";
import type { AcceptedFinancialEvent, BusinessHolding, FinancialEventKind, FinancialEventPayloadMap, FinancialEvidence } from "./types";

const evidence: FinancialEvidence[] = [{ source: "accepted_history", reasonCode: "OPTION_FACT_CONFIRMED", confidence: 1 }];

function accepted<K extends FinancialEventKind>(id: string, kind: K, payload: FinancialEventPayloadMap[K]): AcceptedFinancialEvent<K> {
  return { id, kind, effectiveAtAgeInMonths: 361, payload, evidence, acceptedByReasonCodes: ["OPTION_FACT_CONFIRMED"] } as AcceptedFinancialEvent<K>;
}

function option(overrides: Partial<BusinessHolding> = {}): BusinessHolding {
  return {
    id: "employee_options",
    instrumentType: "stock_option",
    business: { id: "company", displayName: "任职公司", status: "operating", factStatus: "known", evidence },
    liquidityDiscountRate: 0.2,
    optionTerms: { grantedUnits: 100, vestedUnits: 0, exercisedUnits: 0, strikePriceWanPerUnit: 0.01 },
    personalCarryingValueWan: 0,
    status: "active",
    factStatus: "needs_review",
    evidence,
    ...overrides
  };
}

function equity(): BusinessHolding {
  return {
    id: "exercised_equity",
    instrumentType: "equity",
    business: { id: "company", displayName: "任职公司", status: "operating", factStatus: "known", evidence },
    attributableValueWan: 0.8,
    liquidityDiscountRate: 0.2,
    personalCarryingValueWan: 0.64,
    status: "active",
    factStatus: "known",
    evidence
  };
}

function ledger(holding?: BusinessHolding) {
  return initializeFinancialLedger({
    id: "option_lifecycle",
    asOfAgeInMonths: 360,
    openingPosition: {
      cashAccounts: [{ id: PRIMARY_CASH_ACCOUNT_ID, type: "bank_deposit", balanceWan: 10, status: "active", factStatus: "known", evidence }],
      businessHoldings: holding ? [holding] : []
    }
  });
}

function reduce(holding: BusinessHolding | undefined, id: string, event: AcceptedFinancialEvent) {
  return reduceFinancialLedger({ ledger: ledger(holding), transactionId: id, expectedLedgerRevision: 0, periodStartAgeInMonths: 360, periodEndAgeInMonths: 361, events: [event] });
}

test("grant and company financing never turn nominal option facts into personal wealth", () => {
  const grant = reduce(undefined, "option_grant", accepted("grant", "business_option_granted", { optionHolding: option() }));
  assert.equal(grant.ledger.businessHoldings[0].personalCarryingValueWan, 0);
  assert.equal(deriveFinancialState({ ledger: grant.ledger, employmentStatus: "employed" }).state.netWorthWan, 10);
  const financed = reduceFinancialLedger({
    ledger: grant.ledger, transactionId: "option_financing", expectedLedgerRevision: 1,
    periodStartAgeInMonths: 361, periodEndAgeInMonths: 362,
    events: [{ ...accepted("financing", "business_financing_recorded", { businessHoldingId: "employee_options", financingAmountWan: 500, postMoneyValuationWan: 1000, personalCashReceivedWan: 0 }), effectiveAtAgeInMonths: 362 }]
  });
  assert.equal(financed.ledger.businessHoldings[0].personalCarryingValueWan, 0);
});

test("only reliably valued vested options contribute discounted intrinsic value", () => {
  const vested = reduce(option(), "option_vest", accepted("vest", "business_option_vested", { businessHoldingId: "employee_options", unitsVested: 40 }));
  assert.equal(vested.ledger.businessHoldings[0].personalCarryingValueWan, 0);
  const revalued = reduceFinancialLedger({
    ledger: vested.ledger, transactionId: "option_revalue", expectedLedgerRevision: 1,
    periodStartAgeInMonths: 361, periodEndAgeInMonths: 362,
    events: [{ ...accepted("revalue", "business_option_revalued", {
      businessHoldingId: "employee_options", previousCarryingValueWan: 0, fairValueWanPerUnit: 0.04,
      liquidityDiscountRate: 0.2, realizationRiskDiscountRate: 0.25, newCarryingValueWan: 0.72, valuationEvidence: evidence
    }), effectiveAtAgeInMonths: 362 }]
  });
  const state = deriveFinancialState({ ledger: revalued.ledger, employmentStatus: "employed" }).state;
  assert.equal(state.businessAndOtherAssetsWan, 0.72);
  assert.equal(state.netWorthWan, 10.72);
  assert.throws(() => reduceFinancialLedger({
    ledger: vested.ledger, transactionId: "option_nominal_value", expectedLedgerRevision: 1,
    periodStartAgeInMonths: 361, periodEndAgeInMonths: 362,
    events: [{ ...accepted("bad_revalue", "business_option_revalued", {
      businessHoldingId: "employee_options", previousCarryingValueWan: 0, fairValueWanPerUnit: 0.04,
      liquidityDiscountRate: 0.2, realizationRiskDiscountRate: 0.25, newCarryingValueWan: 500, valuationEvidence: evidence
    }), effectiveAtAgeInMonths: 362 }]
  }), (error: unknown) => error instanceof FinancialLedgerInvariantError && error.code === "UNBALANCED_TRANSACTION");
});

test("exercise atomically deducts strike cash, reduces options and creates same-company equity", () => {
  const valued = option({
    personalCarryingValueWan: 0.72, factStatus: "known",
    optionTerms: { grantedUnits: 100, vestedUnits: 40, exercisedUnits: 0, strikePriceWanPerUnit: 0.01, fairValueWanPerUnit: 0.04, realizationRiskDiscountRate: 0.25 }
  });
  const result = reduce(valued, "option_exercise", accepted("exercise", "business_option_exercised", {
    businessHoldingId: "employee_options", unitsExercised: 20, sourceCashAccountId: PRIMARY_CASH_ACCOUNT_ID,
    exerciseCostWan: 0.2, resultingEquityHolding: equity()
  }));
  assert.equal(result.ledger.cashAccounts[0].balanceWan, 9.8);
  assert.equal(result.ledger.businessHoldings.find((item) => item.id === "employee_options")?.personalCarryingValueWan, 0.36);
  assert.equal(result.ledger.businessHoldings.find((item) => item.id === "exercised_equity")?.personalCarryingValueWan, 0.64);
  assert.equal(deriveFinancialState({ ledger: result.ledger, employmentStatus: "employed" }).state.netWorthWan, 10.8);
});

test("expiry and cancellation write off all remaining option value", () => {
  const valued = option({
    personalCarryingValueWan: 0.72,
    optionTerms: { grantedUnits: 100, vestedUnits: 40, exercisedUnits: 0, strikePriceWanPerUnit: 0.01, fairValueWanPerUnit: 0.04, realizationRiskDiscountRate: 0.25 }
  });
  for (const kind of ["business_option_expired", "business_option_cancelled"] as const) {
    const result = reduce(valued, kind, accepted(kind, kind, { businessHoldingId: "employee_options" }));
    assert.equal(result.ledger.businessHoldings[0].personalCarryingValueWan, 0);
    assert.equal(result.ledger.businessHoldings[0].status, kind === "business_option_expired" ? "expired" : "cancelled");
  }
});

test("fixed vesting policy settles deterministically and valued vested units enter wealth", () => {
  const scheduled = option({
    factStatus: "known",
    optionTerms: {
      grantedUnits: 100, vestedUnits: 0, exercisedUnits: 0, strikePriceWanPerUnit: 0.01,
      fairValueWanPerUnit: 0.04, realizationRiskDiscountRate: 0.25,
      grantedAtAgeInMonths: 360, vestingPolicy: { totalMonths: 48, frequencyMonths: 12 }
    }
  });
  const result = reduceFinancialLedger({
    ledger: ledger(scheduled), transactionId: "scheduled_vest", expectedLedgerRevision: 0,
    periodStartAgeInMonths: 360, periodEndAgeInMonths: 372, events: []
  });
  assert.equal(result.alreadyCommitted, false);
  if (!("periodSummary" in result)) throw new Error("expected a committed option vest transaction");
  const holding = result.ledger.businessHoldings[0];
  assert.equal(holding.optionTerms?.vestedUnits, 25);
  assert.equal(holding.personalCarryingValueWan, 0.45);
  assert.equal(result.periodSummary?.valuationChangeWan, 0.45);
  assert.equal(deriveFinancialState({ ledger: result.ledger, employmentStatus: "employed" }).state.businessAndOtherAssetsWan, 0.45);
});

test("option expiry is settled at the recorded age even without another model proposal", () => {
  const expiring = option({
    personalCarryingValueWan: 0.72,
    optionTerms: {
      grantedUnits: 100, vestedUnits: 40, exercisedUnits: 0, strikePriceWanPerUnit: 0.01,
      fairValueWanPerUnit: 0.04, realizationRiskDiscountRate: 0.25, expiresAtAgeInMonths: 408
    }
  });
  const current = ledger(expiring);
  current.asOfAgeInMonths = 400;
  const result = reduceFinancialLedger({
    ledger: current, transactionId: "automatic_expiry", expectedLedgerRevision: 0,
    periodStartAgeInMonths: 400, periodEndAgeInMonths: 409, events: []
  });
  assert.equal(result.alreadyCommitted, false);
  if (!("periodSummary" in result)) throw new Error("expected a committed option expiry transaction");
  assert.equal(result.ledger.businessHoldings[0].status, "expired");
  assert.equal(result.ledger.businessHoldings[0].personalCarryingValueWan, 0);
  assert.equal(result.periodSummary?.valuationChangeWan, -0.72);
});

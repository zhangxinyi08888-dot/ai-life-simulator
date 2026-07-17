import assert from "node:assert/strict";
import test from "node:test";
import type { FinancialSignals, FinancialState } from "../../types";
import { initializeCareerState } from "../career/careerState";
import { runFinancialShadowTransition } from "./runFinancialShadow";

const career = initializeCareerState({
  id: "career_shadow",
  employmentStatus: "employed",
  effectiveFromAgeInMonths: 360
});

function state(overrides: Partial<FinancialState> = {}): FinancialState {
  return {
    currencyUnit: "CNY_WAN_REAL",
    asOfAgeInMonths: 360,
    cashWan: 10,
    investmentAssetsWan: 0,
    propertyMarketValueWan: 0,
    businessAndOtherAssetsWan: 0,
    totalDebtWan: 0,
    netWorthWan: 10,
    annualAfterTaxIncomeWan: 24,
    annualDisposableIncomeWan: 12,
    annualCoreExpenseWan: 12,
    employmentStatus: "employed",
    incomeStability: "stable",
    isEstimated: false,
    ...overrides
  };
}

function signals(overrides: Partial<FinancialSignals> = {}): FinancialSignals {
  return {
    employmentStatus: "student",
    monthlyNetIncomeWan: 2,
    incomeMonths: 99,
    monthlyLivingExpenseWan: 1,
    oneOffIncomeWan: 0,
    oneOffExpenseWan: 0,
    assetValueChangeWan: 0,
    propertyMarketValueChangeWan: 0,
    personalDebtChangeWan: 0,
    incomeStability: "stable",
    confidence: 0.95,
    reasons: ["本阶段明确发生"],
    ...overrides
  };
}

test("shadow ledger advances independently and continues across periods", () => {
  const firstLegacy = state({ asOfAgeInMonths: 366, cashWan: 16, netWorthWan: 16 });
  const first = runFinancialShadowTransition({
    previousLegacyState: state(),
    nextLegacyState: firstLegacy,
    currentCareerState: career,
    legacySignals: signals(),
    acceptedOutcomeId: "continue_job",
    narrativeText: "你继续工作，并维持原有生活安排。",
    periodStartAgeInMonths: 360,
    periodEndAgeInMonths: 366,
    simulationTransactionId: "shadow_1"
  });
  assert.equal(first.ledger.asOfAgeInMonths, 366);
  assert.equal(first.ledger.revision, 1);
  assert.equal(first.derivedState.cashWan, 16);
  assert.equal(first.comparison.status, "matched");
  assert.equal(firstLegacy.cashWan, 16);

  const second = runFinancialShadowTransition({
    previousLegacyState: firstLegacy,
    nextLegacyState: state({ asOfAgeInMonths: 372, cashWan: 22, netWorthWan: 22 }),
    currentLedger: first.ledger,
    currentCareerState: career,
    legacySignals: signals(),
    acceptedOutcomeId: "continue_job",
    narrativeText: "你继续工作，并维持原有生活安排。",
    periodStartAgeInMonths: 366,
    periodEndAgeInMonths: 372,
    simulationTransactionId: "shadow_2"
  });
  assert.equal(second.ledger.asOfAgeInMonths, 372);
  assert.equal(second.ledger.revision, 2);
  assert.equal(second.derivedState.cashWan, 22);
  assert.equal(second.comparison.status, "matched");
});

test("shadow reports differences without changing the V1 result", () => {
  const nextLegacy = state({ asOfAgeInMonths: 366, cashWan: 99, netWorthWan: 99 });
  const result = runFinancialShadowTransition({
    previousLegacyState: state(),
    nextLegacyState: nextLegacy,
    currentCareerState: career,
    legacySignals: signals({ oneOffIncomeWan: 3 }),
    acceptedOutcomeId: "bonus",
    narrativeText: "你收到三万元一次性奖金。",
    periodStartAgeInMonths: 360,
    periodEndAgeInMonths: 366,
    simulationTransactionId: "shadow_diff"
  });
  assert.equal(result.derivedState.cashWan, 19);
  assert.equal(result.comparison.status, "different");
  assert.ok(result.comparison.differences.some((difference) => difference.field === "cashWan"));
  assert.equal(nextLegacy.cashWan, 99);
});

test("ambiguous legacy balance changes are blocked while deterministic accrual continues", () => {
  const result = runFinancialShadowTransition({
    previousLegacyState: state(),
    nextLegacyState: state({ asOfAgeInMonths: 366, cashWan: 16, netWorthWan: 16, totalDebtWan: 20 }),
    currentCareerState: career,
    legacySignals: signals({ personalDebtChangeWan: 20 }),
    acceptedOutcomeId: "ambiguous_debt",
    narrativeText: "财务状况发生变化。",
    periodStartAgeInMonths: 360,
    periodEndAgeInMonths: 366,
    simulationTransactionId: "shadow_blocked_proposal"
  });
  assert.equal(result.derivedState.cashWan, 16);
  assert.equal(result.derivedState.totalDebtWan, 0);
  assert.equal(result.comparison.status, "different");
  assert.equal(result.comparison.acceptedEventCount, 0);
  assert.ok(result.comparison.issueCodes.includes("LEGACY_UNCERTAINTY"));
});

test("unfunded deterministic period resets the shadow ledger from the V1 snapshot", () => {
  const previous = state({ cashWan: 0, netWorthWan: 0, annualAfterTaxIncomeWan: 0, annualCoreExpenseWan: 24 });
  const next = state({ asOfAgeInMonths: 366, cashWan: 0, netWorthWan: -12, annualAfterTaxIncomeWan: 0, annualCoreExpenseWan: 24, totalDebtWan: 12 });
  const result = runFinancialShadowTransition({
    previousLegacyState: previous,
    nextLegacyState: next,
    currentCareerState: career,
    narrativeText: "你继续支付必要生活费用。",
    periodStartAgeInMonths: 360,
    periodEndAgeInMonths: 366,
    simulationTransactionId: "shadow_fallback"
  });
  assert.equal(result.comparison.status, "blocked");
  assert.equal(result.comparison.resetFromLegacy, true);
  assert.ok(result.comparison.issueCodes.includes("MISSING_FUNDING_SOURCE"));
  assert.equal(result.ledger.asOfAgeInMonths, 366);
});

test("time discontinuity rebuilds a baseline instead of failing the simulation", () => {
  const first = runFinancialShadowTransition({
    previousLegacyState: state(),
    nextLegacyState: state({ asOfAgeInMonths: 366, cashWan: 16, netWorthWan: 16 }),
    currentCareerState: career,
    legacySignals: signals(),
    acceptedOutcomeId: "continue_job",
    narrativeText: "你继续工作。",
    periodStartAgeInMonths: 360,
    periodEndAgeInMonths: 366,
    simulationTransactionId: "shadow_before_gap"
  });
  const reset = runFinancialShadowTransition({
    previousLegacyState: state({ asOfAgeInMonths: 370, cashWan: 20, netWorthWan: 20 }),
    nextLegacyState: state({ asOfAgeInMonths: 376, cashWan: 26, netWorthWan: 26 }),
    currentLedger: first.ledger,
    currentCareerState: career,
    legacySignals: signals(),
    acceptedOutcomeId: "continue_job",
    narrativeText: "你继续工作。",
    periodStartAgeInMonths: 370,
    periodEndAgeInMonths: 376,
    simulationTransactionId: "shadow_after_gap"
  });
  assert.equal(reset.comparison.resetFromLegacy, true);
  assert.equal(reset.ledger.asOfAgeInMonths, 376);
  assert.ok(reset.comparison.issueCodes.includes("LEGACY_UNCERTAINTY"));
});

import assert from "node:assert/strict";
import test from "node:test";
import { initializeCareerState } from "../career/careerState";
import { emptyWorldState } from "../../utils/simulationTransaction";
import { commitPreparedOpeningFinancialAuthority, prepareOpeningFinancialAuthority } from "./initializeOpeningFinancialLedger";
import type { OpeningFinancialFacts } from "./openingFinancialFacts";
import type { FinancialState } from "../../types";

function openingState(overrides: Partial<FinancialState> = {}) {
  return {
    currencyUnit: "CNY_WAN_REAL" as const, asOfAgeInMonths: 360, cashWan: 20, investmentAssetsWan: 0,
    propertyMarketValueWan: 0, businessAndOtherAssetsWan: 0, totalDebtWan: 0, netWorthWan: 20,
    annualAfterTaxIncomeWan: 30, annualCoreExpenseWan: 18, annualDisposableIncomeWan: 12,
    employmentStatus: "employed" as const, incomeStability: "stable" as const, isEstimated: true,
    ...overrides
  };
}

function initializeOpeningFinancialLedger(input: {
  id: string;
  linkedCareerStateId: string;
  proposedState: FinancialState;
  openingFacts: OpeningFinancialFacts;
}) {
  const career = initializeCareerState({
    id: input.linkedCareerStateId,
    employmentStatus: input.proposedState.employmentStatus,
    effectiveFromAgeInMonths: input.proposedState.asOfAgeInMonths
  });
  const worldState = emptyWorldState();
  worldState.careerStates = [career];
  worldState.currentCareerStateId = career.id;
  worldState.currentEmploymentStatus = career.employmentStatus;
  const prepared = prepareOpeningFinancialAuthority({
    ...input,
    currentCareer: { careerStates: [career], currentCareerStateId: career.id, careerRevision: 0 },
    currentWorldState: worldState,
    mode: "enforced"
  });
  assert.equal(prepared.gateDecision.allowDomainCommit, true, prepared.gateDecision.reasonCodes.join(","));
  return commitPreparedOpeningFinancialAuthority(prepared);
}

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
  assert.ok(result.acceptedEvents.some((event) => event.kind === "asset" && event.payload.factStatus === "needs_review"));
  assert.ok(result.acceptedEvents.some((event) => event.kind === "debt"));
  assert.ok(result.acceptedEvents.some((event) => event.kind === "expense_commitment"));
  assert.equal(result.ledger.debtAccounts[0].principalWan, 210);
  assert.equal(result.ledger.assetAccounts.find((item) => item.type === "property")?.marketValueWan, 0);
});

test("O-01 initializes distinct nonzero review commitments for an unpriced rent and parent medical responsibility", () => {
  const openingFacts: OpeningFinancialFacts = {
    evidenceText: "有房租，也在承担父母医疗支出。",
    ownsProperty: false,
    expenseFacts: [
      {
        id: "rent_unknown", type: "housing", responsibilityKey: "primary_residence:main", responsibilityKind: "primary_residence",
        cadence: "recurring_unknown", financialScope: "personal", factStatus: "needs_review", amountBasis: "contextual_estimate",
        amountSourceId: "user_rent_unknown", evidenceText: "有房租"
      },
      {
        id: "parent_medical_unknown", type: "healthcare", responsibilityKey: "recurring_healthcare:opening_parent", responsibilityKind: "recurring_healthcare",
        cadence: "recurring_unknown", financialScope: "personal", factStatus: "needs_review", amountBasis: "contextual_estimate",
        amountSourceId: "user_parent_medical_unknown", evidenceText: "承担父母医疗支出"
      }
    ]
  };
  const result = initializeOpeningFinancialLedger({ id: "opening_unknown_components", linkedCareerStateId: "career", proposedState: openingState(), openingFacts });
  assert.equal(result.ledger.version, 4);
  const housing = result.ledger.expenseCommitments.find((item) => item.responsibilityKey === "primary_residence:main");
  const healthcare = result.ledger.expenseCommitments.find((item) => item.responsibilityKey === "recurring_healthcare:opening_parent");
  assert.equal(housing?.factStatus, "needs_review");
  assert.ok((housing?.monthlyAmountWan || 0) > 0);
  assert.equal(healthcare?.factStatus, "needs_review");
  assert.ok((healthcare?.monthlyAmountWan || 0) > 0);
  assert.notEqual(result.ledger.expenseCommitments.filter((item) => item.status === "active").length, 1);
});

test("O-02 only accrues the protagonist half of a shared rent", () => {
  const openingFacts: OpeningFinancialFacts = {
    evidenceText: "月租5200元，两人各承担一半。",
    ownsProperty: false,
    expenseFacts: [{
      id: "shared_rent", type: "housing", responsibilityKey: "primary_residence:main", responsibilityKind: "primary_residence",
      cadence: "monthly", monthlyAmountWan: 0.26, grossMonthlyAmountWan: 0.52, protagonistShareRate: 0.5,
      financialScope: "shared_household", factStatus: "known", amountBasis: "explicit_shared_amount",
      amountSourceId: "user_shared_rent", evidenceText: "月租5200元，两人各承担一半。"
    }]
  };
  const result = initializeOpeningFinancialLedger({ id: "opening_shared_rent", linkedCareerStateId: "career", proposedState: openingState(), openingFacts });
  assert.equal(result.ledger.version, 4);
  const housing = result.ledger.expenseCommitments.find((item) => item.responsibilityKey === "primary_residence:main");
  assert.equal(housing?.monthlyAmountWan, 0.26);
  assert.equal(housing?.grossMonthlyAmountWan, 0.52);
  assert.equal(housing?.householdShareRate, 0.5);
  assert.equal(housing?.financialScope, "shared_household");
});

test("O-03 retains exactly one conservative legacy aggregate when its coverage of known components is unknown", () => {
  const openingFacts: OpeningFinancialFacts = {
    evidenceText: "每月总开销1.5万，房租5000元，父母医疗3000元。",
    ownsProperty: false,
    expenseFacts: [
      {
        id: "aggregate", type: "aggregate", responsibilityKey: "legacy_aggregate:opening", responsibilityKind: "legacy_aggregate",
        cadence: "monthly", monthlyAmountWan: 1.5, financialScope: "personal", factStatus: "needs_review", amountBasis: "legacy_estimate",
        amountSourceId: "user_total", evidenceText: "每月总开销1.5万，房租5000元，父母医疗3000元。", coverage: "unknown"
      },
      {
        id: "rent", type: "housing", responsibilityKey: "primary_residence:main", responsibilityKind: "primary_residence",
        cadence: "monthly", monthlyAmountWan: 0.5, financialScope: "personal", factStatus: "known", amountBasis: "explicit_known",
        amountSourceId: "user_rent", evidenceText: "房租5000元"
      },
      {
        id: "parent_medical", type: "healthcare", responsibilityKey: "recurring_healthcare:opening_parent", responsibilityKind: "recurring_healthcare",
        cadence: "monthly", monthlyAmountWan: 0.3, financialScope: "personal", factStatus: "known", amountBasis: "explicit_known",
        amountSourceId: "user_parent_medical", evidenceText: "父母医疗3000元"
      }
    ]
  };
  const result = initializeOpeningFinancialLedger({ id: "opening_unknown_coverage", linkedCareerStateId: "career", proposedState: openingState(), openingFacts });
  const active = result.ledger.expenseCommitments.filter((item) => item.status === "active");
  assert.equal(active.length, 1);
  assert.equal(active[0].responsibilityKind, "legacy_aggregate");
  assert.equal(active[0].monthlyAmountWan, 1.5);
  assert.equal(active[0].factStatus, "needs_review");
  assert.ok(result.ledger.unresolvedIssues.some((item) => item.code === "EXPENSE_OPENING_COMPONENT_GAP"));
});

test("O-03 applies max(P, T, F) to one unknown-coverage aggregate without double-accruing components", () => {
  const openingFacts: OpeningFinancialFacts = {
    evidenceText: "每月总开销2000元，房租5000元，父母医疗3000元。",
    ownsProperty: false,
    expenseFacts: [
      {
        id: "aggregate", type: "aggregate", responsibilityKey: "legacy_aggregate:opening", responsibilityKind: "legacy_aggregate",
        cadence: "monthly", monthlyAmountWan: 0.2, financialScope: "personal", factStatus: "needs_review", amountBasis: "legacy_estimate",
        amountSourceId: "user_total", evidenceText: "每月总开销2000元，房租5000元，父母医疗3000元。", coverage: "unknown"
      },
      {
        id: "rent", type: "housing", responsibilityKey: "primary_residence:main", responsibilityKind: "primary_residence",
        cadence: "monthly", monthlyAmountWan: 0.5, financialScope: "personal", factStatus: "known", amountBasis: "explicit_known",
        amountSourceId: "user_rent", evidenceText: "房租5000元"
      },
      {
        id: "parent_medical", type: "healthcare", responsibilityKey: "recurring_healthcare:opening_parent", responsibilityKind: "recurring_healthcare",
        cadence: "monthly", monthlyAmountWan: 0.3, financialScope: "personal", factStatus: "known", amountBasis: "explicit_known",
        amountSourceId: "user_parent_medical", evidenceText: "父母医疗3000元"
      }
    ]
  };
  const result = initializeOpeningFinancialLedger({ id: "opening_unknown_coverage_topup", linkedCareerStateId: "career", proposedState: openingState(), openingFacts });
  const active = result.ledger.expenseCommitments.filter((item) => item.status === "active");

  assert.equal(active.length, 1);
  assert.equal(active[0].responsibilityKind, "legacy_aggregate");
  assert.equal(active[0].monthlyAmountWan, 0.8, "T=0.8 must lift P=0.2 above the F=0.35 floor");
  assert.equal(result.ledger.expenseCommitments.some((item) => item.responsibilityKey === "primary_residence:main"), false);
  assert.equal(result.ledger.expenseCommitments.some((item) => item.responsibilityKey === "recurring_healthcare:opening_parent"), false);
});

test("O-04 ignores a model aggregate state and uses only accepted opening facts", () => {
  const result = initializeOpeningFinancialLedger({
    id: "opening_model_aggregate", linkedCareerStateId: "career", proposedState: openingState({ annualCoreExpenseWan: 18 }),
    openingFacts: { evidenceText: "无持续支出金额事实", ownsProperty: false }
  });
  const active = result.ledger.expenseCommitments.filter((item) => item.status === "active");
  assert.equal(active.length, 1);
  assert.equal(active[0].responsibilityKey, "adult_basic_living:protagonist");
  assert.equal(active[0].monthlyAmountWan, 0.35);
  assert.notEqual(active[0].monthlyAmountWan, 1.5);
});

test("opening schema blocker is evaluated before materialization and leaves candidate inputs unchanged", () => {
  const state = openingState();
  const facts = {
    evidenceText: "公司租下一间木工坊，每月租金 8000 元。",
    ownsProperty: false,
    expenseFacts: [{
      id: "workshop_rent", type: "housing", responsibilityKey: "primary_residence:main", responsibilityKind: "primary_residence",
      cadence: "monthly", monthlyAmountWan: 0.8,
      financialScope: "business_operating", factStatus: "known", amountBasis: "explicit_known",
      amountSourceId: "opening_workshop", evidenceText: "公司租下一间木工坊，每月租金 8000 元。"
    }]
  } as unknown as OpeningFinancialFacts;
  const career = initializeCareerState({ id: "career_opening_blocked", employmentStatus: "employed", effectiveFromAgeInMonths: 360 });
  const worldState = emptyWorldState();
  worldState.careerStates = [career];
  worldState.currentCareerStateId = career.id;
  worldState.currentEmploymentStatus = career.employmentStatus;
  const beforeState = structuredClone(state);
  const beforeFacts = structuredClone(facts);
  const beforeWorld = structuredClone(worldState);
  const prepared = prepareOpeningFinancialAuthority({
    id: "opening_blocked", linkedCareerStateId: career.id, proposedState: state, openingFacts: facts,
    currentCareer: { careerStates: [career], currentCareerStateId: career.id, careerRevision: 0 },
    currentWorldState: worldState,
    mode: "shadow"
  });

  assert.equal(prepared.gateDecision.allowDomainCommit, false, "opening schema conflicts are never shadow-materialized");
  assert.ok(prepared.gateDecision.reasonCodes.includes("UNSATISFIED_OPENING_FACT_PROVENANCE"));
  assert.deepEqual(state, beforeState);
  assert.deepEqual(facts, beforeFacts);
  assert.deepEqual(worldState, beforeWorld);
  assert.throws(() => commitPreparedOpeningFinancialAuthority(prepared), /acceptance gate rejected/);
});

import assert from "node:assert/strict";
import test from "node:test";
import { initializeCareerState } from "../career/careerState";
import { resolveAuthoritativeEmploymentStatus } from "../../utils/employmentState";
import { formatFinancialStateForPrompt } from "../../utils/financialState";
import { deriveFinancialState } from "./deriveFinancialState";
import { initializeFinancialLedger } from "./initializeLedger";
import { FinancialLedgerInvariantError, PRIMARY_CASH_ACCOUNT_ID } from "./ledgerMath";
import { reduceFinancialLedger } from "./reduceFinancialLedger";
import type { AcceptedFinancialEvent, FinancialEventKind, FinancialEventPayloadMap, FinancialEvidence } from "./types";

const evidence: FinancialEvidence[] = [{ source: "accepted_history", reasonCode: "M5_COVERAGE_FACT", confidence: 1 }];

function accepted<K extends FinancialEventKind>(
  id: string,
  kind: K,
  effectiveAtAgeInMonths: number,
  payload: FinancialEventPayloadMap[K]
): AcceptedFinancialEvent<K> {
  return { id, kind, effectiveAtAgeInMonths, payload, evidence, acceptedByReasonCodes: ["M5_COVERAGE"] } as AcceptedFinancialEvent<K>;
}

test("M5-1 identity drift: CareerState overrides narrative-era compatibility fields", () => {
  const career = initializeCareerState({ id: "career_authority", employmentStatus: "employed", effectiveFromAgeInMonths: 360 });
  assert.equal(resolveAuthoritativeEmploymentStatus({
    currentCareerState: career,
    worldState: { currentEmploymentStatus: "student" },
    legacyFinancialState: { employmentStatus: "retired" },
    isInitialization: false
  }), "employed");
});

test("M5-2 low-expense ratchet: durable housing and dependent commitments remain annualized", () => {
  const ledger = initializeFinancialLedger({
    id: "coverage_expenses",
    asOfAgeInMonths: 360,
    openingPosition: {
      cashAccounts: [{ id: PRIMARY_CASH_ACCOUNT_ID, type: "bank_deposit", balanceWan: 20, status: "active", factStatus: "known", evidence }],
      expenseCommitments: [
        { id: "housing", type: "housing", displayName: "住房", monthlyAmountWan: 0.8, activeFromAgeInMonths: 300, status: "active", factStatus: "known", evidence },
        { id: "dependent", type: "dependent_support", displayName: "抚养", monthlyAmountWan: 0.4, activeFromAgeInMonths: 300, status: "active", factStatus: "known", evidence }
      ]
    }
  });
  assert.equal(deriveFinancialState({ ledger, employmentStatus: "student" }).state.annualizedCoreExpenseWan, 14.4);
});

test("M5-3 business boundary: company financing changes neither personal cash nor personal income", () => {
  const ledger = initializeFinancialLedger({
    id: "coverage_business",
    asOfAgeInMonths: 360,
    openingPosition: {
      cashAccounts: [{ id: PRIMARY_CASH_ACCOUNT_ID, type: "bank_deposit", balanceWan: 10, status: "active", factStatus: "known", evidence }],
      businessHoldings: [{
        id: "holding",
        business: { id: "company", displayName: "公司", status: "operating", factStatus: "known", evidence },
        ownershipRate: 0.5,
        personalCarryingValueWan: 5,
        status: "active",
        factStatus: "known",
        evidence
      }]
    }
  });
  const result = reduceFinancialLedger({
    ledger,
    transactionId: "coverage_financing",
    expectedLedgerRevision: 0,
    periodStartAgeInMonths: 360,
    periodEndAgeInMonths: 361,
    events: [accepted("financing", "business_financing_recorded", 361, {
      businessHoldingId: "holding",
      financingAmountWan: 800,
      postMoneyValuationWan: 2000,
      ownershipRateAfterFinancing: 0.4,
      personalCashReceivedWan: 0
    })]
  });
  assert.equal(result.alreadyCommitted, false);
  assert.equal(result.ledger.cashAccounts[0].balanceWan, 10);
  assert.equal(result.periodSummary.incomeWan, 0);
});

test("M5-4 static debt: scheduled principal consumes equal cash while interest alone reduces wealth", () => {
  const ledger = initializeFinancialLedger({
    id: "coverage_debt",
    asOfAgeInMonths: 360,
    openingPosition: {
      cashAccounts: [{ id: PRIMARY_CASH_ACCOUNT_ID, type: "bank_deposit", balanceWan: 10, status: "active", factStatus: "known", evidence }],
      debtAccounts: [{
        id: "mortgage",
        type: "mortgage",
        displayName: "房贷",
        principalWan: 10,
        openedAtAgeInMonths: 360,
        status: "active",
        repaymentPolicy: { mode: "known_schedule", monthlyPrincipalWan: 1, monthlyInterestWan: 0.1 },
        factStatus: "known",
        evidence
      }]
    }
  });
  const result = reduceFinancialLedger({
    ledger,
    transactionId: "coverage_debt_payment",
    expectedLedgerRevision: 0,
    periodStartAgeInMonths: 360,
    periodEndAgeInMonths: 361,
    events: []
  });
  assert.equal(result.alreadyCommitted, false);
  assert.equal(result.ledger.cashAccounts[0].balanceWan, 8.9);
  assert.equal(result.ledger.debtAccounts[0].principalWan, 9);
  assert.equal(result.periodSummary.netWorthChangeWan, -0.1);
});

test("M5-5 liquidity: negative disposable cash flow is valid while negative cash is rejected", () => {
  const opening = (cashWan: number) => initializeFinancialLedger({
    id: `coverage_liquidity_${cashWan}`,
    asOfAgeInMonths: 360,
    openingPosition: {
      cashAccounts: [{ id: PRIMARY_CASH_ACCOUNT_ID, type: "bank_deposit", balanceWan: cashWan, status: "active", factStatus: "known", evidence }],
      expenseCommitments: [{ id: "living", type: "basic_living", displayName: "生活", monthlyAmountWan: 2, activeFromAgeInMonths: 360, status: "active", factStatus: "known", evidence }]
    }
  });
  const valid = reduceFinancialLedger({
    ledger: opening(12),
    transactionId: "coverage_negative_disposable",
    expectedLedgerRevision: 0,
    periodStartAgeInMonths: 360,
    periodEndAgeInMonths: 361,
    events: []
  });
  assert.equal(valid.alreadyCommitted, false);
  assert.equal(valid.ledger.cashAccounts[0].balanceWan, 10);
  assert.equal(deriveFinancialState({ ledger: valid.ledger, employmentStatus: "not_working" }).state.annualizedDisposableCashFlowWan, -24);
  assert.throws(() => reduceFinancialLedger({
    ledger: opening(1),
    transactionId: "coverage_negative_cash",
    expectedLedgerRevision: 0,
    periodStartAgeInMonths: 360,
    periodEndAgeInMonths: 361,
    events: []
  }), (error: unknown) => error instanceof FinancialLedgerInvariantError && error.code === "MISSING_FUNDING_SOURCE");
});

test("M5-6 retirement semantics: pension and rent define the run rate independently of status", () => {
  const ledger = initializeFinancialLedger({
    id: "coverage_retirement",
    asOfAgeInMonths: 720,
    openingPosition: {
      cashAccounts: [{ id: PRIMARY_CASH_ACCOUNT_ID, type: "bank_deposit", balanceWan: 10, status: "active", factStatus: "known", evidence }],
      incomeSources: [
        { id: "salary", type: "salary", displayName: "历史工资", monthlyNetAmountWan: 2, accrualPolicy: "monthly", activeFromAgeInMonths: 600, activeUntilAgeInMonths: 720, status: "ended", factStatus: "known", evidence },
        { id: "pension", type: "pension", displayName: "养老金", monthlyNetAmountWan: 0.8, accrualPolicy: "monthly", activeFromAgeInMonths: 720, status: "active", factStatus: "known", evidence },
        { id: "rent", type: "rent", displayName: "租金", monthlyNetAmountWan: 0.5, accrualPolicy: "monthly", activeFromAgeInMonths: 700, status: "active", factStatus: "known", evidence }
      ]
    }
  });
  const state = deriveFinancialState({ ledger, employmentStatus: "retired" }).state;
  assert.equal(state.employmentStatus, "retired");
  assert.equal(state.annualizedRecurringIncomeWan, 15.6);
});

test("M5-7 report semantics: the compatibility snapshot preserves the exact authoritative net worth", () => {
  const ledger = initializeFinancialLedger({
    id: "coverage_report",
    asOfAgeInMonths: 960,
    openingPosition: {
      cashAccounts: [{ id: PRIMARY_CASH_ACCOUNT_ID, type: "bank_deposit", balanceWan: 1500, status: "active", factStatus: "known", evidence }],
      assetAccounts: [{ id: "property", type: "property", displayName: "房产", marketValueWan: 500, liquidity: "illiquid", status: "active", factStatus: "known", openedAtAgeInMonths: 500, evidence }],
      debtAccounts: [{ id: "private_debt", type: "family_or_personal_loan", displayName: "个人债务", principalWan: 100, openedAtAgeInMonths: 900, status: "active", repaymentPolicy: { mode: "event_driven" }, factStatus: "known", evidence }]
    }
  });
  const derived = deriveFinancialState({ ledger, employmentStatus: "retired" });
  assert.equal(derived.state.netWorthWan, 1900);
  assert.equal(derived.compatibilityState.netWorthWan, 1900);
  assert.match(formatFinancialStateForPrompt(derived.compatibilityState), /累计净财富：1900 万元（已确认）/);
});

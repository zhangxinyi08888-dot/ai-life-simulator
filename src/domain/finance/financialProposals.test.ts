import assert from "node:assert/strict";
import test from "node:test";
import type { FinancialSignals } from "../../types";
import { initializeCareerState } from "../career/careerState";
import { adaptLegacyFinancialSignalsToProposals } from "./adaptLegacyFinancialSignals";
import { initializeFinancialLedger } from "./initializeLedger";
import { PRIMARY_CASH_ACCOUNT_ID } from "./ledgerMath";
import { validateFinancialProposals } from "./validateFinancialProposals";
import type { DebtAccount, FinancialEventProposal, FinancialEvidence } from "./types";

const evidence: FinancialEvidence[] = [{ source: "accepted_history", reasonCode: "OPENING_FACT", confidence: 1 }];
const career = initializeCareerState({ id: "career_current", employmentStatus: "employed", effectiveFromAgeInMonths: 360 });

function ledger(cashWan = 10) {
  return initializeFinancialLedger({
    id: "proposal_ledger",
    asOfAgeInMonths: 360,
    openingPosition: {
      cashAccounts: [{ id: PRIMARY_CASH_ACCOUNT_ID, type: "bank_deposit", balanceWan: cashWan, status: "active", factStatus: "known", evidence }],
      incomeSources: [{
        id: "salary",
        type: "salary",
        displayName: "工资",
        monthlyNetAmountWan: 2,
        accrualPolicy: "monthly",
        activeFromAgeInMonths: 350,
        status: "active",
        linkedCareerStateId: career.id,
        factStatus: "known",
        evidence
      }],
      expenseCommitments: [{
        id: "living",
        type: "basic_living",
        displayName: "生活",
        monthlyAmountWan: 1,
        activeFromAgeInMonths: 350,
        status: "active",
        factStatus: "known",
        evidence
      }]
    }
  });
}

function signals(overrides: Partial<FinancialSignals> = {}): FinancialSignals {
  return {
    employmentStatus: "student",
    monthlyNetIncomeWan: 3,
    incomeMonths: 99,
    monthlyLivingExpenseWan: 0.1,
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

test("legacy adapter ignores model employmentStatus and incomeMonths while preserving durable expenses", () => {
  const adapted = adaptLegacyFinancialSignalsToProposals({
    signals: signals(),
    narrativeEvidence: "你在本阶段完成调薪，新的税后月收入为三万元。",
    currentCareerState: career,
    currentLedger: ledger(),
    periodStartAgeInMonths: 360,
    periodEndAgeInMonths: 366,
    sourceOutcomeId: "accept_raise",
    simulationTransactionId: "tx_legacy"
  });
  assert.equal(adapted.issues.length, 0);
  assert.deepEqual(adapted.proposals.map((proposal) => proposal.kind), ["income_source_adjusted"]);
  const payload = adapted.proposals[0].payload as { nextSource: { monthlyNetAmountWan?: number } };
  assert.equal(payload.nextSource.monthlyNetAmountWan, 3);
  assert.equal(adapted.proposals.some((proposal) => JSON.stringify(proposal).includes("student")), false);
  assert.equal(adapted.proposals.some((proposal) => JSON.stringify(proposal).includes("99")), false);
});

test("legacy ambiguous debt, asset and business values become blocking issues instead of balance writes", () => {
  const adapted = adaptLegacyFinancialSignalsToProposals({
    signals: signals({ personalDebtChangeWan: -20, assetValueChangeWan: 50, oneOffIncomeWan: 800 }),
    narrativeEvidence: "公司完成融资。",
    currentCareerState: career,
    currentLedger: ledger(),
    periodStartAgeInMonths: 360,
    periodEndAgeInMonths: 366,
    sourceOutcomeId: "company_financing",
    simulationTransactionId: "tx_ambiguous",
    hasStructuredBusinessActivity: true
  });
  assert.deepEqual(new Set(adapted.issues.map((issue) => issue.code)), new Set([
    "BUSINESS_PERSONAL_BOUNDARY_CONFLICT",
    "LEGACY_UNCERTAINTY",
    "UNSUPPORTED_LARGE_VALUE_CHANGE"
  ]));
  assert.equal(adapted.proposals.some((proposal) => proposal.kind === "one_off_income_received"), false);
});

test("validator accepts an explicitly funded expense batch without mutating the trial ledger", () => {
  const currentLedger = ledger(1);
  const shortfallDebt: DebtAccount = {
    id: "shortfall",
    type: "liquidity_shortfall",
    displayName: "短期周转",
    principalWan: 2,
    openedAtAgeInMonths: 361,
    status: "active",
    repaymentPolicy: { mode: "event_driven" },
    factStatus: "known",
    evidence
  };
  const proposals: FinancialEventProposal[] = [
    {
      id: "expense",
      kind: "one_off_expense_paid",
      effectiveAtAgeInMonths: 361,
      payload: { sourceCashAccountId: PRIMARY_CASH_ACCOUNT_ID, amountWan: 3 },
      evidence: "你支付了三万元必要费用",
      sourceOutcomeId: "pay_and_borrow",
      confidence: 0.95
    },
    {
      id: "shortfall",
      kind: "liquidity_shortfall_created",
      effectiveAtAgeInMonths: 361,
      payload: { debtAccount: shortfallDebt, destinationCashAccountId: PRIMARY_CASH_ACCOUNT_ID, principalDrawnWan: 2 },
      evidence: "你办理了两万元短期周转借款",
      sourceOutcomeId: "pay_and_borrow",
      confidence: 0.95
    }
  ];
  const result = validateFinancialProposals({
    proposals,
    currentLedger,
    currentCareerState: career,
    acceptedOutcomeId: "pay_and_borrow",
    narrativeText: "你支付了三万元必要费用；你办理了两万元短期周转借款。",
    periodStartAgeInMonths: 360,
    periodEndAgeInMonths: 361,
    simulationTransactionId: "tx_validation"
  });
  assert.equal(result.issues.length, 0);
  assert.equal(result.acceptedEvents.length, 2);
  assert.equal(currentLedger.cashAccounts[0].balanceWan, 1);
  assert.equal(currentLedger.debtAccounts.length, 0);
  assert.equal(currentLedger.revision, 0);
});

test("validator rejects unselected, unsupported large and business-personal proposals atomically", () => {
  const base: Omit<FinancialEventProposal, "id" | "payload" | "sourceOutcomeId"> = {
    kind: "one_off_income_received",
    effectiveAtAgeInMonths: 361,
    evidence: "你收到款项",
    confidence: 0.95
  };
  const proposals: FinancialEventProposal[] = [
    { ...base, id: "wrong_outcome", sourceOutcomeId: "other", payload: { destinationCashAccountId: PRIMARY_CASH_ACCOUNT_ID, amountWan: 1 } },
    { ...base, id: "huge", sourceOutcomeId: "accepted", payload: { destinationCashAccountId: PRIMARY_CASH_ACCOUNT_ID, amountWan: 1000 } },
    { ...base, id: "company_as_income", sourceOutcomeId: "accepted", payload: { destinationCashAccountId: PRIMARY_CASH_ACCOUNT_ID, amountWan: 5, financingAmountWan: 5 } }
  ];
  const result = validateFinancialProposals({
    proposals,
    currentLedger: ledger(),
    currentCareerState: career,
    acceptedOutcomeId: "accepted",
    narrativeText: "你收到款项",
    periodStartAgeInMonths: 360,
    periodEndAgeInMonths: 361,
    simulationTransactionId: "tx_reject"
  });
  assert.equal(result.acceptedEvents.length, 0);
  assert.deepEqual(new Set(result.issues.map((issue) => issue.code)), new Set([
    "UNBALANCED_TRANSACTION",
    "UNSUPPORTED_LARGE_VALUE_CHANGE",
    "BUSINESS_PERSONAL_BOUNDARY_CONFLICT"
  ]));
});

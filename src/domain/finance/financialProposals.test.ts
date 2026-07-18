import assert from "node:assert/strict";
import test from "node:test";
import { initializeCareerState } from "../career/careerState";
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
        id: "salary", type: "salary", displayName: "工资", monthlyNetAmountWan: 2,
        accrualPolicy: "monthly", activeFromAgeInMonths: 350, status: "active",
        linkedCareerStateId: career.id, factStatus: "known", evidence
      }],
      expenseCommitments: [{
        id: "living", type: "basic_living", displayName: "生活", monthlyAmountWan: 1,
        activeFromAgeInMonths: 350, status: "active", factStatus: "known", evidence
      }]
    }
  });
}

test("validator accepts an explicitly funded expense batch without mutating the trial ledger", () => {
  const currentLedger = ledger(1);
  const shortfallDebt: DebtAccount = {
    id: "shortfall", type: "liquidity_shortfall", displayName: "短期周转", principalWan: 2,
    openedAtAgeInMonths: 361, status: "active", repaymentPolicy: { mode: "event_driven" },
    factStatus: "known", evidence
  };
  const proposals: FinancialEventProposal[] = [
    {
      id: "expense", kind: "one_off_expense_paid", effectiveAtAgeInMonths: 361,
      payload: { sourceCashAccountId: PRIMARY_CASH_ACCOUNT_ID, amountWan: 3 },
      evidence: "你支付了三万元必要费用", sourceOutcomeId: "pay_and_borrow", confidence: 0.95
    },
    {
      id: "shortfall", kind: "liquidity_shortfall_created", effectiveAtAgeInMonths: 361,
      payload: { debtAccount: shortfallDebt, destinationCashAccountId: PRIMARY_CASH_ACCOUNT_ID, principalDrawnWan: 2 },
      evidence: "你办理了两万元短期周转借款", sourceOutcomeId: "pay_and_borrow", confidence: 0.95
    }
  ];
  const result = validateFinancialProposals({
    proposals, currentLedger, currentCareerState: career, acceptedOutcomeId: "pay_and_borrow",
    narrativeText: "你支付了三万元必要费用；你办理了两万元短期周转借款。",
    periodStartAgeInMonths: 360, periodEndAgeInMonths: 361, simulationTransactionId: "tx_validation"
  });
  assert.equal(result.issues.length, 0);
  assert.equal(result.acceptedEvents.length, 2);
  assert.equal(currentLedger.cashAccounts[0].balanceWan, 1);
  assert.equal(currentLedger.debtAccounts.length, 0);
  assert.equal(currentLedger.revision, 0);
});

test("validator rejects unselected, unsupported large and business-personal proposals atomically", () => {
  const base: Omit<FinancialEventProposal, "id" | "payload" | "sourceOutcomeId"> = {
    kind: "one_off_income_received", effectiveAtAgeInMonths: 361, evidence: "你收到款项", confidence: 0.95
  };
  const result = validateFinancialProposals({
    proposals: [
      { ...base, id: "wrong_outcome", sourceOutcomeId: "other", payload: { destinationCashAccountId: PRIMARY_CASH_ACCOUNT_ID, amountWan: 1 } },
      { ...base, id: "huge", sourceOutcomeId: "accepted", payload: { destinationCashAccountId: PRIMARY_CASH_ACCOUNT_ID, amountWan: 1000 } },
      { ...base, id: "company_as_income", sourceOutcomeId: "accepted", payload: { destinationCashAccountId: PRIMARY_CASH_ACCOUNT_ID, amountWan: 5, financingAmountWan: 5 } }
    ],
    currentLedger: ledger(), currentCareerState: career, acceptedOutcomeId: "accepted", narrativeText: "你收到款项",
    periodStartAgeInMonths: 360, periodEndAgeInMonths: 361, simulationTransactionId: "tx_reject"
  });
  assert.equal(result.acceptedEvents.length, 0);
  assert.deepEqual(new Set(result.issues.map((issue) => issue.code)), new Set([
    "UNBALANCED_TRANSACTION", "UNSUPPORTED_LARGE_VALUE_CHANGE", "BUSINESS_PERSONAL_BOUNDARY_CONFLICT"
  ]));
});

test("validator prevents a new career wage from stacking on an active career income", () => {
  const newSalary: FinancialEventProposal = {
    id: "new_salary",
    kind: "income_source_started",
    effectiveAtAgeInMonths: 361,
    sourceOutcomeId: "switch_job",
    evidence: "你正式换工作，新岗位月薪3万元",
    confidence: 0.95,
    payload: {
      id: "new_salary_source",
      type: "salary",
      displayName: "新岗位工资",
      monthlyNetAmountWan: 3,
      accrualPolicy: "monthly",
      activeFromAgeInMonths: 361,
      status: "active",
      linkedCareerStateId: career.id,
      factStatus: "known",
      evidence
    }
  };
  const rejected = validateFinancialProposals({
    proposals: [newSalary], currentLedger: ledger(), currentCareerState: career, acceptedOutcomeId: "switch_job",
    narrativeText: "你正式换工作，新岗位月薪3万元。", periodStartAgeInMonths: 360, periodEndAgeInMonths: 361,
    simulationTransactionId: "tx_wage_stack"
  });
  assert.equal(rejected.acceptedEvents.length, 0);
  assert.equal(rejected.issues[0].code, "CAREER_INCOME_CONFLICT");

  const acceptedReplacement = validateFinancialProposals({
    proposals: [{
      id: "end_old_salary", kind: "income_source_ended", effectiveAtAgeInMonths: 361,
      sourceOutcomeId: "switch_job", evidence: "你正式结束旧工作", confidence: 0.95,
      payload: { incomeSourceId: "salary" }
    }, newSalary],
    currentLedger: ledger(), currentCareerState: career, acceptedOutcomeId: "switch_job",
    narrativeText: "你正式结束旧工作，并正式换工作，新岗位月薪3万元。", periodStartAgeInMonths: 360, periodEndAgeInMonths: 361,
    simulationTransactionId: "tx_wage_replacement"
  });
  assert.equal(acceptedReplacement.issues.length, 0);
  assert.equal(acceptedReplacement.acceptedEvents.length, 2);
});

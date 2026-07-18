import assert from "node:assert/strict";
import test from "node:test";
import { initializeCareerState } from "../career/careerState";
import { initializeFinancialLedger } from "./initializeLedger";
import { PRIMARY_CASH_ACCOUNT_ID } from "./ledgerMath";
import { validateFinancialProposals } from "./validateFinancialProposals";
import type { FinancialEventProposal, FinancialEvidence } from "./types";

const evidence: FinancialEvidence[] = [{ source: "accepted_history", reasonCode: "TEST", confidence: 1 }];

function setup() {
  return {
    currentCareerState: initializeCareerState({ id: "career_current", employmentStatus: "employed", effectiveFromAgeInMonths: 300 }),
    currentLedger: initializeFinancialLedger({
      id: "proposal_test",
      asOfAgeInMonths: 300,
      openingPosition: {
        cashAccounts: [{ id: PRIMARY_CASH_ACCOUNT_ID, type: "bank_deposit", balanceWan: 10, status: "active", factStatus: "known", evidence }]
      }
    })
  };
}

function proposal(overrides: Partial<FinancialEventProposal> = {}): FinancialEventProposal {
  return {
    id: "bonus",
    kind: "one_off_income_received",
    effectiveAtAgeInMonths: 312,
    payload: { destinationCashAccountId: PRIMARY_CASH_ACCOUNT_ID, amountWan: 2 },
    sourceOutcomeId: "accepted_choice",
    evidence: "你已经收到2万元项目奖金。",
    confidence: 0.9,
    ...overrides
  };
}

function validate(proposals: FinancialEventProposal[], narrativeText = "这一年，你已经收到2万元项目奖金。") {
  return validateFinancialProposals({
    ...setup(),
    proposals,
    acceptedOutcomeId: "accepted_choice",
    narrativeText,
    periodStartAgeInMonths: 300,
    periodEndAgeInMonths: 312,
    simulationTransactionId: "proposal_validation",
    liquidityPolicy: "require_explicit"
  });
}

test("accepts valid proposals independently when an unrelated proposal is blocking", () => {
  const result = validate([
    proposal(),
    proposal({ id: "wrong_outcome", sourceOutcomeId: "other_choice" })
  ]);
  assert.deepEqual(result.acceptedEvents.map((event) => event.proposalId), ["bonus"]);
  assert.equal(result.issues.length, 1);
  assert.deepEqual(result.issues[0].relatedProposalIds, ["wrong_outcome"]);
});

test("rolls back only the event that fails incremental ledger trial", () => {
  const result = validate([
    proposal(),
    proposal({
      id: "unfunded",
      kind: "one_off_expense_paid",
      payload: { sourceCashAccountId: PRIMARY_CASH_ACCOUNT_ID, amountWan: 50 },
      evidence: "你已经支付50万元费用。"
    })
  ], "这一年，你已经收到2万元项目奖金。你已经支付50万元费用。");
  assert.deepEqual(result.acceptedEvents.map((event) => event.proposalId), ["bonus"]);
  assert.equal(result.issues.some((issue) => issue.code === "MISSING_FUNDING_SOURCE" && issue.relatedProposalIds.includes("unfunded")), true);
});

test("uses normalized and amount-anchored evidence without accepting another subject", () => {
  const normalized = validate([
    proposal({ evidence: "你 已经 收到 2 万元项目奖金" })
  ]);
  assert.equal(normalized.acceptedEvents.length, 1);
  assert.equal(normalized.acceptedEvents[0].acceptedByReasonCodes.includes("EVIDENCE_NORMALIZED_MATCHED"), true);

  const fuzzy = validate([
    proposal({ evidence: "你获得了2万元奖金" })
  ], "项目结算后，你的账户实际收到2万元项目奖金。公司另获得200万元融资。");
  assert.equal(fuzzy.acceptedEvents.length, 1);
  assert.equal(fuzzy.acceptedEvents[0].acceptedByReasonCodes.includes("EVIDENCE_FUZZY_MATCHED"), true);

  const wrongSubject = validate([
    proposal({ evidence: "公司获得了2万元奖金" })
  ], "公司获得了2万元奖金，你继续正常工作。");
  assert.equal(wrongSubject.acceptedEvents.length, 0);
});

test("low-confidence but otherwise determinate facts are accepted as estimated", () => {
  const result = validate([proposal({
    id: "estimated_income",
    kind: "income_source_started",
    confidence: 0.7,
    evidence: "你开始每月获得1万元顾问收入。",
    payload: {
      id: "consulting",
      type: "contract",
      displayName: "顾问收入",
      monthlyNetAmountWan: 1,
      accrualPolicy: "monthly",
      activeFromAgeInMonths: 312,
      status: "active",
      factStatus: "known",
      evidence
    }
  })], "你开始每月获得1万元顾问收入。");
  assert.equal(result.acceptedEvents.length, 1);
  assert.equal((result.acceptedEvents[0].payload as { factStatus: string }).factStatus, "estimated");
});

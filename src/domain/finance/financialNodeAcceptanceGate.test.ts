import assert from "node:assert/strict";
import test from "node:test";
import { initializeCareerState } from "../career/careerState";
import type { CareerStateCollection } from "../career/types";
import type { WorldStateSnapshot } from "../../types";
import { commitFinancialDomainTransaction, type FinancialDomainTransactionInput } from "./commitFinancialDomainTransaction";
import {
  buildRequiredFinancialFactGroups,
  evaluateFinancialNodeAcceptance
} from "./financialNodeAcceptanceGate";
import { initializeFinancialLedger } from "./initializeLedger";
import { PRIMARY_CASH_ACCOUNT_ID } from "./ledgerMath";
import { previewFinancialDomainTransaction } from "./previewFinancialDomainTransaction";
import type { FinancialEvidence } from "./types";

const evidence: FinancialEvidence[] = [{
  source: "accepted_simulation_outcome",
  sourceEventId: "test",
  reasonCode: "TEST",
  confidence: 1
}];

function transactionInput(employmentStatus: "employed" | "not_working" = "not_working"): FinancialDomainTransactionInput {
  const careerState = initializeCareerState({
    id: `career_${employmentStatus}`,
    employmentStatus,
    effectiveFromAgeInMonths: 360
  });
  const career: CareerStateCollection = {
    careerStates: [careerState],
    currentCareerStateId: careerState.id,
    careerRevision: 0
  };
  const ledger = initializeFinancialLedger({
    id: "gate_ledger",
    asOfAgeInMonths: 360,
    openingPosition: {
      cashAccounts: [{
        id: PRIMARY_CASH_ACCOUNT_ID,
        type: "bank_deposit",
        balanceWan: 20,
        status: "active",
        factStatus: "known",
        evidence
      }],
      incomeSources: employmentStatus === "employed" ? [{
        id: "salary",
        type: "salary",
        displayName: "工资",
        monthlyNetAmountWan: 1,
        accrualPolicy: "monthly",
        activeFromAgeInMonths: 360,
        status: "active",
        linkedCareerStateId: careerState.id,
        factStatus: "known",
        evidence
      }] : [],
      expenseCommitments: [{
        id: "living",
        type: "basic_living",
        displayName: "生活费",
        monthlyAmountWan: 0.4,
        activeFromAgeInMonths: 360,
        status: "active",
        factStatus: "known",
        evidence
      }]
    }
  });
  const worldState: WorldStateSnapshot = {
    people: [],
    directionArcs: [],
    pressureArcs: [],
    careerStates: [careerState],
    currentCareerStateId: careerState.id,
    currentEmploymentStatus: careerState.employmentStatus,
    careerRevision: 0,
    committedTransactionIds: [],
    version: 2
  };
  return {
    transactionId: "gate_transaction",
    periodStartAgeInMonths: 360,
    periodEndAgeInMonths: 372,
    expectedCareerRevision: 0,
    expectedLedgerRevision: 0,
    currentCareer: career,
    currentFinancialLedger: ledger,
    currentWorldState: worldState,
    acceptedCareerTransitions: [],
    acceptedFinancialEvents: [],
    financialIssues: [],
    liquidityPolicy: "auto_shortfall_debt"
  };
}

test("Preview runs the production transaction without mutating any input", () => {
  const input = transactionInput("employed");
  const before = structuredClone(input);
  const preview = previewFinancialDomainTransaction(input);

  assert.deepEqual(input, before);
  assert.equal(input.currentFinancialLedger.asOfAgeInMonths, 360);
  assert.equal(input.currentFinancialLedger.committedTransactionIds.length, 0);
  assert.equal(preview.financialLedger.asOfAgeInMonths, 372);
  assert.equal(preview.financialPeriodSummary?.incomeWan, 12);

  const committed = commitFinancialDomainTransaction(input);
  assert.deepEqual(preview, committed);
  assert.deepEqual(input, before);
});

test("shadow and enforced make the same blocking decision but only enforced rejects commit", () => {
  const input = transactionInput();
  const preview = previewFinancialDomainTransaction(input);
  const groups = buildRequiredFinancialFactGroups({
    issues: [{
      id: "narrative_coverage_property_gate",
      code: "PENDING_FACT",
      severity: "blocking",
      status: "open",
      relatedProposalIds: ["property_proposal"],
      summary: "正文购房但没有房产事件",
      createdAtAgeInMonths: 372
    }],
    rejectedCompletedProposals: [],
    ageInMonths: 372
  });
  const shadow = evaluateFinancialNodeAcceptance({ mode: "shadow", preview, requiredFactGroups: groups, expectedAgeInMonths: 372 });
  const enforced = evaluateFinancialNodeAcceptance({ mode: "enforced", preview, requiredFactGroups: groups, expectedAgeInMonths: 372 });

  assert.equal(shadow.wouldBlock, true);
  assert.equal(enforced.wouldBlock, true);
  assert.deepEqual(shadow.reasonCodes, enforced.reasonCodes);
  assert.equal(shadow.allowDomainCommit, true);
  assert.equal(enforced.allowDomainCommit, false);
  assert.equal(enforced.disposition, "regenerate");
});

test("an enforced EXPENSE blocker regenerates and leaves the authoritative transaction input untouched", () => {
  const input = transactionInput("employed");
  const before = structuredClone(input);
  const preview = previewFinancialDomainTransaction(input);
  const groups = buildRequiredFinancialFactGroups({
    issues: [{
      id: "expense_mortgage_payment_misrouted",
      code: "EXPENSE_DEBT_SERVICE_DOUBLE_COUNT",
      severity: "blocking",
      status: "open",
      relatedProposalIds: ["mortgage_payment_as_housing"],
      summary: "房贷月供被错误提交为住房持续消费",
      createdAtAgeInMonths: 372
    }],
    rejectedCompletedProposals: [],
    ageInMonths: 372
  });
  const decision = evaluateFinancialNodeAcceptance({
    mode: "enforced",
    preview,
    requiredFactGroups: groups,
    expectedAgeInMonths: 372,
    transactionId: "expense_gate_rejection"
  });

  assert.equal(groups.length, 1);
  assert.equal(groups[0]?.kind, "expense_lifecycle");
  assert.equal(groups[0]?.materiality, "critical");
  assert.equal(decision.disposition, "regenerate");
  assert.equal(decision.allowDomainCommit, false);
  assert.equal(decision.wouldBlock, true);
  assert.deepEqual(decision.relatedIssueIds, ["expense_mortgage_payment_misrouted"]);
  assert.deepEqual(decision.relatedProposalIds, ["mortgage_payment_as_housing"]);
  assert.deepEqual(input, before, "expense rejection must not advance ledger, period accrual, career or WorldState");
  assert.equal(input.currentFinancialLedger.asOfAgeInMonths, 360);
  assert.equal(input.currentFinancialLedger.cashAccounts[0]?.balanceWan, 20);
  assert.equal(input.currentWorldState.committedTransactionIds.length, 0);
});

test("a rejected system lifecycle proposal with a generic validator code is still critical", () => {
  const input = transactionInput();
  const preview = previewFinancialDomainTransaction(input);
  const groups = buildRequiredFinancialFactGroups({
    issues: [{
      id: "proposal_issue_system_expense_start_elder_care_372",
      code: "UNBALANCED_TRANSACTION",
      severity: "blocking",
      status: "open",
      relatedProposalIds: ["system_expense_start_elder_care_372"],
      summary: "持续赡养支出缺少可靠正文证据",
      createdAtAgeInMonths: 372
    }],
    rejectedCompletedProposals: [],
    ageInMonths: 372
  });
  const decision = evaluateFinancialNodeAcceptance({
    mode: "enforced",
    preview,
    requiredFactGroups: groups,
    expectedAgeInMonths: 372
  });

  assert.deepEqual(groups.map((group) => [group.kind, group.materiality]), [["expense_lifecycle", "critical"]]);
  assert.equal(decision.allowDomainCommit, false);
  assert.equal(decision.disposition, "regenerate");
  assert.equal(decision.wouldBlock, true);
});

test("an enforced rejection leaves time, income, ledger, career and world state unchanged", () => {
  const input = transactionInput("employed");
  const before = structuredClone(input);
  const preview = previewFinancialDomainTransaction(input);
  const groups = buildRequiredFinancialFactGroups({
    issues: [{
      id: "career_transition_missing_gate",
      code: "CAREER_INCOME_CONFLICT",
      severity: "blocking",
      status: "open",
      relatedProposalIds: [],
      summary: "职业转换缺少权威事件",
      createdAtAgeInMonths: 372
    }],
    rejectedCompletedProposals: [],
    ageInMonths: 372
  });
  const decision = evaluateFinancialNodeAcceptance({
    mode: "enforced",
    preview,
    requiredFactGroups: groups,
    expectedAgeInMonths: 372
  });

  assert.equal(decision.allowDomainCommit, false);
  assert.equal(preview.financialPeriodSummary?.incomeWan, 12, "preview may calculate candidate accrual");
  assert.deepEqual(input, before, "rejected candidate never replaces authoritative inputs");
  assert.equal(input.currentFinancialLedger.asOfAgeInMonths, 360);
  assert.equal(input.currentFinancialLedger.cashAccounts[0].balanceWan, 20);
  assert.equal(input.currentCareer.careerRevision, 0);
  assert.deepEqual(input.currentWorldState.committedTransactionIds, []);
});

test("unrelated third-party or optional issues do not become protagonist critical fact groups", () => {
  const groups = buildRequiredFinancialFactGroups({
    issues: [{
      id: "proposal_issue_spouse_salary",
      code: "BUSINESS_PERSONAL_BOUNDARY_CONFLICT",
      severity: "blocking",
      status: "open",
      relatedProposalIds: ["spouse_salary"],
      summary: "配偶工资不得进入主角账本",
      createdAtAgeInMonths: 372
    }],
    rejectedCompletedProposals: [],
    ageInMonths: 372
  });
  assert.deepEqual(groups, []);
});

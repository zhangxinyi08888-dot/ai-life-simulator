import assert from "node:assert/strict";
import test from "node:test";
import { initializeFinancialLedger } from "../../domain/finance/initializeLedger";
import { PRIMARY_CASH_ACCOUNT_ID } from "../../domain/finance/ledgerMath";
import type { FinancialEvidence } from "../../domain/finance/types";
import { buildFinancialProposalRepairPrompt, formatRestrictedFinancialLedger } from "./prompts";
import { resolveSelectedOutcomeId } from "./simulationService";
import type { HistoryItem } from "../../types";

const evidence: FinancialEvidence[] = [{ source: "accepted_history", reasonCode: "TEST", confidence: 1 }];
const ledger = initializeFinancialLedger({
  id: "repair_ledger",
  asOfAgeInMonths: 300,
  openingPosition: {
    cashAccounts: [{ id: PRIMARY_CASH_ACCOUNT_ID, type: "bank_deposit", balanceWan: 10, status: "active", factStatus: "known", evidence }],
    incomeSources: [{
      id: "salary_main",
      type: "salary",
      displayName: "工资",
      monthlyNetAmountWan: 2,
      accrualPolicy: "monthly",
      activeFromAgeInMonths: 300,
      status: "active",
      factStatus: "known",
      evidence
    }]
  }
});

test("restricted ledger summary exposes stable ids without exposing transaction history", () => {
  const summary = formatRestrictedFinancialLedger(ledger);
  assert.match(summary, /salary_main/);
  assert.match(summary, /primary_cash/);
  assert.doesNotMatch(summary, /recentTransactions/);
});

test("repair prompt supplies rejection reasons, period bounds and the unique outcome id", () => {
  const prompt = buildFinancialProposalRepairPrompt({
    rejectedProposals: [{
      id: "adjust_salary",
      kind: "income_source_adjusted",
      effectiveAtAgeInMonths: 312,
      payload: { incomeSourceId: undefined },
      sourceOutcomeId: "choice_1",
      evidence: "你正式涨薪到每月3万元。",
      confidence: 0.9
    }],
    issues: [{
      id: "issue_adjust_salary",
      code: "UNBALANCED_TRANSACTION",
      severity: "blocking",
      relatedProposalIds: ["adjust_salary"],
      summary: "收入来源调整必须引用同一账户: undefined",
      createdAtAgeInMonths: 312
    }],
    ledger,
    acceptedOutcomeId: "choice_1",
    narrativeText: "你正式涨薪到每月3万元。",
    periodStartAgeInMonths: 300,
    periodEndAgeInMonths: 312
  });
  assert.match(prompt, /salary_main/);
  assert.match(prompt, /choice_1/);
  assert.match(prompt, /300 到 312/);
  assert.match(prompt, /收入来源调整必须引用同一账户/);
  assert.match(prompt, /不得省略 confidence/);
  assert.match(prompt, /逐字复制当前正文/);
  assert.match(prompt, /正文候选原句与金额锚/);
  assert.match(prompt, /你正式涨薪到每月3万元/);
  assert.match(prompt, /confidence 必须在 0.6-1 之间/);
  assert.match(prompt, /employmentTransition/);
  assert.match(prompt, /原子组/);
});

test("selected choices without eventOutcomeId receive a deterministic fallback authority id", () => {
  const history = [{
    age: 30,
    ageInMonths: 360,
    stage: "转折",
    title: "选择",
    description: "描述",
    selectedChoice: "此前选择",
    choices: [{ id: "A", text: "接受新的工作", impactSummary: "职业变化" }],
    attributes: { happiness: 50, intelligence: 50, wealth: 50, relation: 50, health: 50 },
    isEndingNode: false
  }] as HistoryItem[];
  const first = resolveSelectedOutcomeId(history, "接受新的工作");
  const second = resolveSelectedOutcomeId(history, "接受新的工作");
  assert.match(first || "", /^choice_fallback_/);
  assert.equal(first, second);
});

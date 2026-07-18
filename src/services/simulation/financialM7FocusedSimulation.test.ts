import assert from "node:assert/strict";
import test from "node:test";
import type { HistoryItem, LifeAttributes, UserInitialData, WorldStateSnapshot } from "../../types";
import { initializeCareerState } from "../../domain/career/careerState";
import { deriveFinancialState, initializeFinancialLedger } from "../../domain/finance";
import { generateNextNodeWithEventOutcomes } from "./testEventOutcomeAdapter";

const attributes: LifeAttributes = { happiness: 60, intelligence: 70, wealth: 50, relation: 60, health: 65 };
const userData: UserInitialData = {
  birthday: "1990-01-01", birthtime: "08:00", gender: "男", currentSituation: "继续职业发展",
  isReturnToPast: true, targetAgeNode: "30岁", regressionNodeKey: "career", regressionAge: 30,
  regressionSituation: "在稳定岗位继续发展", regressionChoices: "继续工作", coreStoryFocus: "career"
};

test("M7 focused generation applies deterministic living cost without an unnecessary repair call", async () => {
  const age = 30 * 12;
  const career = initializeCareerState({ id: "career", employmentStatus: "employed", effectiveFromAgeInMonths: age, confidence: 1 });
  const ledger = initializeFinancialLedger({
    id: "missing_expense", asOfAgeInMonths: age,
    openingPosition: {
      cashAccounts: [{ id: "cash_primary", type: "bank_deposit", balanceWan: 20, status: "active", factStatus: "known", evidence: [] }],
      incomeSources: [{
        id: "salary", type: "salary", displayName: "工资", monthlyNetAmountWan: 2,
        accrualPolicy: "monthly", activeFromAgeInMonths: age, status: "active",
        linkedCareerStateId: career.id, factStatus: "known", accrualReviewStatus: "normal",
        lastConfirmedAtAgeInMonths: age, evidence: []
      }]
    }
  });
  const world: WorldStateSnapshot = {
    people: [], directionArcs: [], pressureArcs: [], careerStates: [career], currentCareerStateId: career.id,
    currentEmploymentStatus: "employed", careerRevision: 0, committedTransactionIds: [], version: 2
  };
  const history: HistoryItem[] = [{
    age: 30, ageInMonths: age, stage: "稳定工作", title: "继续推进", description: "他继续当前工作。",
    selectedChoice: "继续工作", attributes, choices: [{ id: "A", text: "继续工作", impactSummary: "继续积累", eventOutcomeId: "continue_work" }],
    financialLedger: ledger, financialLedgerMode: "authoritative",
    financialState: deriveFinancialState({ ledger, employmentStatus: "employed" }).compatibilityState,
    worldStateSnapshot: world, isEndingNode: false
  }];
  let primaryCalls = 0;
  let repairCalls = 0;
  const node = await generateNextNodeWithEventOutcomes({
    userData, answers: [], history, currentAttributes: attributes, selectedDecision: "继续工作", nodeIndex: 1, simulationSeed: "focused-latency"
  }, {
    callAiJson: async (prompt) => {
      if (prompt.startsWith("你只修复财务 Proposal")) {
        repairCalls += 1;
        return { text: JSON.stringify({ financialEventProposals: [] }) };
      }
      primaryCalls += 1;
      const target = Number(prompt.match(/ageInMonths=(\d+)/)?.[1] || age + 12);
      return { text: JSON.stringify({
        age: Math.floor(target / 12), ageInMonths: target, stage: "工作延续", title: "项目进入下一阶段",
        description: "他继续当前工作并推进项目，但本阶段没有提供可核验的生活支出金额。",
        choices: [
          { id: "A", text: "继续深耕项目", impactSummary: "继续积累" },
          { id: "B", text: "调整职责边界", impactSummary: "降低负荷" },
          { id: "C", text: "寻找新的岗位", impactSummary: "探索机会" }
        ],
        attributes, financialEventProposals: [], isEndingNode: false
      }) };
    }
  });
  assert.equal(primaryCalls, 1);
  assert.equal(repairCalls, 0);
  assert.equal(node.financialProcessingMeta?.repairTriggered, false);
  assert.equal(node.financialProcessingMeta?.proposalCount, 0);
  assert.equal(node.financialProcessingMeta?.blockingIssueCount, 0);
  assert.ok((node.financialProcessingMeta?.totalProcessingLatencyMs || -1) >= 0);
  assert.equal(node.financialLedger?.incomeSources.find((source) => source.id === "salary")?.accrualReviewStatus, "normal");
  assert.ok(node.financialLedger?.expenseCommitments.some((item) => item.type === "basic_living" && item.factStatus === "estimated"));
  assert.equal(node.financialLedger?.unresolvedIssues.some((issue) => issue.id === "pending_fact_missing_adult_expense"), false);
});

import assert from "node:assert/strict";
import test from "node:test";
import type { FinalLifeOutcome, HistoryItem } from "../types";
import { initializeCareerState } from "../domain/career/careerState";
import { initializeFinancialLedger } from "../domain/finance/initializeLedger";
import { PRIMARY_CASH_ACCOUNT_ID } from "../domain/finance/ledgerMath";
import type { FinancialEvidence } from "../domain/finance/types";
import { collectFinalFinancialNarrativeIssues } from "./finalFinancialNarrativeAuthority";
import { getAuthoritativeFinalFinancialContext } from "./finalOutcomeFinancialContext";

const evidence: FinancialEvidence[] = [{ source: "accepted_history", reasonCode: "TEST", confidence: 1 }];

test("final financial context validates model prose without replacing it", () => {
  const career = initializeCareerState({ id: "career", employmentStatus: "self_employed", effectiveFromAgeInMonths: 360 });
  const ledger = initializeFinancialLedger({
    id: "report_ledger",
    asOfAgeInMonths: 480,
    openingPosition: {
      cashAccounts: [{ id: PRIMARY_CASH_ACCOUNT_ID, type: "bank_deposit", balanceWan: 20, status: "active", factStatus: "known", evidence }],
      businessHoldings: [{
        id: "holding",
        business: { id: "company", displayName: "测试公司", status: "operating", factStatus: "needs_review", evidence },
        personalCarryingValueWan: 0,
        status: "active",
        factStatus: "needs_review",
        evidence
      }]
    }
  });
  const history = [{
    age: 40,
    ageInMonths: 480,
    stage: "中年",
    title: "终局",
    description: "公司收购带来100万元收益。",
    selectedChoice: "继续",
    attributes: { happiness: 50, intelligence: 50, wealth: 50, relation: 50, health: 50 },
    choices: [],
    isEndingNode: true,
    financialLedger: ledger,
    worldStateSnapshot: { people: [], directionArcs: [], pressureArcs: [], careerStates: [career], currentCareerStateId: career.id, currentEmploymentStatus: "self_employed", careerRevision: 0, committedTransactionIds: [], version: 2 }
  }] as HistoryItem[];
  const outcome = {
    share: { viralTitle: "我留下20万元现金", oneLineSummary: "公司获利100万元并取得3倍回报" },
    report: { finalLifeReading: { paragraphs: ["你的净资产为20万元，公司估值达到100万元，回报率达到300%。"] } },
    meta: {}
  } as unknown as FinalLifeOutcome;
  const before = JSON.stringify(outcome);
  const context = getAuthoritativeFinalFinancialContext(history);
  const issues = collectFinalFinancialNarrativeIssues({ outcome, authority: context.narrativeAuthority });
  assert.equal(context.allowedWanValues.includes(20), true);
  assert.equal(issues.some((issue) => issue.code === "REPORT_UNSUPPORTED_FINANCIAL_AMOUNT"), true);
  assert.equal(JSON.stringify(outcome), before);
});

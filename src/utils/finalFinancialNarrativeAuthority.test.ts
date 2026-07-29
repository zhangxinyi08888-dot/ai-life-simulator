import assert from "node:assert/strict";
import test from "node:test";
import { initializeFinancialLedger } from "../domain/finance/initializeLedger";
import { PRIMARY_CASH_ACCOUNT_ID } from "../domain/finance/ledgerMath";
import type { DebtAccount, FinancialEvidence } from "../domain/finance/types";
import type { FinalLifeOutcome, HistoryItem } from "../types";
import { sanitizeFinalOutcomeFinancialClaims } from "./finalOutcomeFinancialSanitizer";
import { applyFinalFinancialNarrativeFallback, collectFinalFinancialNarrativeIssues, deriveFinalFinancialNarrativeAuthority, formatFinalFinancialNarrativeAuthorityForPrompt } from "./finalFinancialNarrativeAuthority";

const evidence: FinancialEvidence[] = [{ source: "accepted_history", reasonCode: "TEST", confidence: 1 }];

function debt(status: DebtAccount["status"] = "active", principalWan = 100): DebtAccount {
  return {
    id: "debt_1", type: "consumer_loan", displayName: "个人借款",
    principalWan: status === "repaid" ? 0 : principalWan, openedAtAgeInMonths: 360,
    closedAtAgeInMonths: status === "repaid" ? 480 : undefined, status,
    repaymentPolicy: { mode: "known_schedule", monthlyPaymentWan: 1, monthlyPrincipalWan: 1, monthlyInterestWan: 0, remainingTermMonths: 100 }, factStatus: "known", evidence,
    origin: "explicit", accruedUnpaidInterestWan: 0, servicingStatus: "current",
    consecutiveMissedPaymentMonths: 0, totalMissedPaymentMonths: 0, recentMissedPaymentAgeInMonths: []
  };
}

function historyWith(input: { debt?: DebtAccount; cashWan?: number; property?: boolean }): HistoryItem[] {
  const ledger = initializeFinancialLedger({
    id: "ledger", asOfAgeInMonths: 480,
    openingPosition: {
      cashAccounts: [{ id: PRIMARY_CASH_ACCOUNT_ID, type: "bank_deposit", balanceWan: input.cashWan ?? 10, status: "active", factStatus: "known", evidence }],
      debtAccounts: input.debt ? [input.debt] : [],
      assetAccounts: input.property ? [{ id: "home", type: "property", displayName: "已确认住宅", marketValueWan: 200, liquidity: "illiquid", status: "active", factStatus: "known", openedAtAgeInMonths: 360, evidence }] : []
    }
  });
  return [{
    age: 40, ageInMonths: 480, stage: "终局", title: "回望", description: "生活继续向前。", selectedChoice: "继续生活",
    attributes: { happiness: 50, intelligence: 50, wealth: 50, relation: 50, health: 50 }, choices: [], isEndingNode: true,
    financialLedger: ledger,
    worldStateSnapshot: { people: [], directionArcs: [], pressureArcs: [], careerStates: [], currentEmploymentStatus: "not_working", careerRevision: 0, committedTransactionIds: [], version: 2 }
  }];
}

function outcome(text: string): FinalLifeOutcome {
  return {
    share: { viralTitle: text, covenantTitle: "长期生活者", oneLineSummary: "你保留了自己的生活节奏。", timeline: [], closingLine: "生活仍在继续。", posterTheme: "warm_realistic", downloadFileName: "人生终章.png", imageAlt: "人生报告" },
    report: {
      executiveSummary: { headline: "你持续调整生活。", patterns: [], closingLine: "选择形成了路径。" },
      repeatedPatterns: [], patternEffects: [], futureTrends: [], patternsToKeep: [], patternsToAdjust: [],
      finalLifeReading: { title: "回望", paragraphs: ["你仍在认真生活。"], finalSentence: "生活没有停止。" }
    },
    meta: { generatedAt: new Date(0).toISOString(), modelProvider: "mock", posterVersion: "web-v1", reportVersion: "life-pattern-v2", closureType: "mortality" }
  };
}

test("PB-REPORT-01 outstanding debt forbids a paid-off poster claim", () => {
  const authority = deriveFinalFinancialNarrativeAuthority(historyWith({ debt: debt(), cashWan: 10 }));
  assert.equal(authority?.debt.kind, "debt_outstanding");
  assert.deepEqual(collectFinalFinancialNarrativeIssues({ outcome: outcome("我用25年还清了全部债务"), authority }).map((item) => item.code), ["REPORT_DEBT_COMPLETION_CONFLICT"]);
});

test("PB-REPORT-02 negative net worth forbids financial-freedom claims", () => {
  const authority = deriveFinalFinancialNarrativeAuthority(historyWith({ debt: debt(), cashWan: 10 }));
  assert.equal(authority?.netWorth.kind, "negative_net_worth");
  assert.equal(collectFinalFinancialNarrativeIssues({ outcome: outcome("我终于实现了财务自由"), authority })[0]?.code, "REPORT_NEGATIVE_NET_WORTH_CONFLICT");
});

test("PB-REPORT-03 absent confirmed property forbids ownership and sale claims", () => {
  const authority = deriveFinalFinancialNarrativeAuthority(historyWith({ cashWan: 10 }));
  assert.equal(authority?.property.kind, "no_confirmed_property");
  assert.equal(collectFinalFinancialNarrativeIssues({ outcome: outcome("我卖掉自己的公寓后重新出发"), authority })[0]?.code, "REPORT_PROPERTY_CONFLICT");
});

test("PB-REPORT-04 reliable repaid account permits debt-completion semantics", () => {
  const authority = deriveFinalFinancialNarrativeAuthority(historyWith({ debt: debt("repaid"), cashWan: 10 }));
  assert.equal(authority?.debt.kind, "debt_fully_repaid");
  assert.equal(collectFinalFinancialNarrativeIssues({ outcome: outcome("我终于还清了债务"), authority }).length, 0);
});

test("PB-REPORT-05 fallback repairs only the conflicting report field", () => {
  const authority = deriveFinalFinancialNarrativeAuthority(historyWith({ debt: debt(), cashWan: 10 }))!;
  const value = outcome("我用25年还清了债务");
  value.report.finalLifeReading.paragraphs = ["你一直认真照顾家人。"];
  const repaired = applyFinalFinancialNarrativeFallback({ outcome: value, authority, issues: collectFinalFinancialNarrativeIssues({ outcome: value, authority }) });
  assert.doesNotMatch(repaired.share.viralTitle, /还清/u);
  assert.equal(repaired.report.finalLifeReading.paragraphs[0], "你一直认真照顾家人。");
  assert.equal(collectFinalFinancialNarrativeIssues({ outcome: repaired, authority }).length, 0);
});

test("PB-REPORT-06 prompt authority is a closed structured fact set", () => {
  const prompt = formatFinalFinancialNarrativeAuthorityForPrompt(deriveFinalFinancialNarrativeAuthority(historyWith({ debt: debt(), cashWan: 10 }))!);
  assert.match(prompt, /"kind": "debt_outstanding"/u);
  assert.match(prompt, /"kind": "negative_net_worth"/u);
  assert.match(prompt, /"kind": "no_confirmed_property"/u);
  assert.match(prompt, /"debt_fully_repaid"/u);
});

test("PB-REPORT-07 only reliably evidenced property is exposed", () => {
  assert.equal(deriveFinalFinancialNarrativeAuthority(historyWith({ property: true }))?.property.kind, "confirmed_property_holdings");
  const unreliableHistory = historyWith({ property: true });
  const property = unreliableHistory[0].financialLedger!.assetAccounts[0];
  property.factStatus = "estimated";
  property.evidence = [{ source: "legacy_migration", reasonCode: "ESTIMATE", confidence: 0.5 }];
  assert.equal(deriveFinalFinancialNarrativeAuthority(unreliableHistory)?.property.kind, "no_confirmed_property");
});

test("PB-REPORT-08 poster title may use the canonical terminal debt numeric claim", () => {
  const history = historyWith({ debt: debt("active", 839.6358), cashWan: 0 });
  const authority = deriveFinalFinancialNarrativeAuthority(history)!;
  assert.deepEqual(
    authority.numericClaims.find((claim) => claim.kind === "total_debt"),
    { kind: "total_debt", valueWan: 839.6358, displayText: "839.6万", sourceLedgerRevision: 0 }
  );
  const sanitized = sanitizeFinalOutcomeFinancialClaims(outcome("我走到终点时仍有839.6358万元债务"), history);
  assert.equal(sanitized.share.viralTitle, "我走到终点时仍有839.6万元债务");
});

test("PB-REPORT-09 no internal financial placeholder may reach any final-outcome surface", () => {
  const history = historyWith({ debt: debt("active", 100), cashWan: 0 });
  const value = outcome("我把公司做到月入46万元，却仍要处理债务");
  value.report.finalLifeReading.paragraphs = ["负债金额待账本确认，回报率待账本确认。"];
  const sanitized = sanitizeFinalOutcomeFinancialClaims(value, history);
  assert.doesNotMatch(JSON.stringify(sanitized), /金额待账本确认|回报幅度待账本确认|回报率待账本确认|价值待确认|账本确认/u);
});

test("PB-REPORT-10 invalid title amount is rewritten as a whole sentence without an orphan prefix", () => {
  const history = historyWith({ debt: debt("active", 100), cashWan: 0 });
  const sanitized = sanitizeFinalOutcomeFinancialClaims(outcome("我月入46万元，却还是负债8…"), history);
  assert.doesNotMatch(sanitized.share.viralTitle, /46|负债\s*8…|待账本确认/u);
  assert.match(sanitized.share.viralTitle, /^我/u);
});

test("PB-REPORT-11 user-visible financial amounts never expose long floating-point tails", () => {
  const history = historyWith({ cashWan: 54.9996 });
  const sanitized = sanitizeFinalOutcomeFinancialClaims(outcome("我留下54.9996万元现金"), history);
  assert.equal(sanitized.share.viralTitle, "我留下55万元现金");
  assert.doesNotMatch(JSON.stringify(sanitized), /\d+\.\d{3,}\s*万/u);
});

test("PB-REPORT-12 terminal debt includes every active liability shown in the financial panel", () => {
  const history = historyWith({ debt: debt("active", 20), cashWan: 0 });
  const ledgerDebt = history[0].financialLedger!.debtAccounts[0];
  ledgerDebt.factStatus = "needs_review";
  ledgerDebt.evidence = [{ source: "accepted_simulation_outcome", reasonCode: "PENDING_REVIEW", confidence: 0.5 }];
  ledgerDebt.accruedUnpaidInterestWan = 3.6;
  const authority = deriveFinalFinancialNarrativeAuthority(history)!;
  assert.equal(authority.debt.kind, "debt_outstanding");
  assert.equal(authority.numericClaims.find((claim) => claim.kind === "total_debt")?.valueWan, 23.6);
  assert.equal(authority.numericClaims.find((claim) => claim.kind === "net_worth")?.valueWan, -23.6);
});

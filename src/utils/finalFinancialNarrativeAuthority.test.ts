import assert from "node:assert/strict";
import test from "node:test";
import { initializeFinancialLedger } from "../domain/finance/initializeLedger";
import { PRIMARY_CASH_ACCOUNT_ID } from "../domain/finance/ledgerMath";
import { migrateFinancialLedgerV3ToV4 } from "../domain/finance/migrateFinancialLedgerV3ToV4";
import type { DebtAccount, FinancialEvidence, FinancialLedgerV3 } from "../domain/finance/types";
import type { FinalLifeOutcome, HistoryItem } from "../types";
import { buildFinalOutcomePrompt } from "../services/finalOutcome/prompts";
import { collectFinalFinancialNarrativeIssues, deriveFinalFinancialNarrativeAuthority, formatFinalFinancialNarrativeAuthorityForPrompt, removeUnsupportedDebtCompletionClauses } from "./finalFinancialNarrativeAuthority";

assert.deepEqual(
  removeUnsupportedDebtCompletionClauses("你终于还清了全部债务，也学会把生活放回自己的节奏。"),
  { text: "学会把生活放回自己的节奏。", removalCount: 1 }
);
assert.deepEqual(
  removeUnsupportedDebtCompletionClauses("你仍未还清债务，但已经不再让焦虑替你选择。"),
  { text: "你仍未还清债务，但已经不再让焦虑替你选择。", removalCount: 0 }
);

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

function debtSettlementTransaction(input: { forgiven?: boolean; debtAccountId?: string } = {}) {
  const debtAccountId = input.debtAccountId ?? "debt_1";
  return {
    id: input.forgiven ? "tx_debt_forgiven" : "tx_debt_repaid",
    simulationTransactionId: input.forgiven ? "sim_debt_forgiven" : "sim_debt_repaid",
    eventIds: [input.forgiven ? "accepted_debt_forgiven" : "accepted_debt_principal_repaid"],
    periodStartAgeInMonths: 468,
    periodEndAgeInMonths: 480,
    cashDeltaWan: input.forgiven ? 0 : -100,
    assetDeltaWan: 0,
    debtDeltaWan: -100,
    incomeWan: 0,
    expenseWan: 0,
    valuationChangeWan: 0,
    nonCashGainLossWan: 0,
    netWorthDeltaWan: input.forgiven ? 100 : 0,
    debtPrincipalDrawnWan: 0,
    debtPrincipalPaidWan: input.forgiven ? 0 : 100,
    debtPrincipalForgivenWan: input.forgiven ? 100 : 0,
    debtInterestAccruedWan: 0,
    debtInterestPaidWan: 0,
    debtInterestLiabilityPaidWan: 0,
    debtInterestForgivenWan: 0,
    debtCapitalizedInterestWan: 0,
    automaticLiquidityShortfallIncreaseWan: 0,
    automaticLiquidityShortfallRecoveryWan: 0,
    debtSettlementAccountIds: [debtAccountId],
    evidence
  };
}

function historyWith(input: { debt?: DebtAccount; cashWan?: number; property?: boolean; debtSettlement?: "repaid" | "forgiven" }): HistoryItem[] {
  const ledger = initializeFinancialLedger({
    id: "ledger", asOfAgeInMonths: 480,
    openingPosition: {
      cashAccounts: [{ id: PRIMARY_CASH_ACCOUNT_ID, type: "bank_deposit", balanceWan: input.cashWan ?? 10, status: "active", factStatus: "known", evidence }],
      debtAccounts: input.debt ? [input.debt] : [],
      assetAccounts: input.property ? [{ id: "home", type: "property", displayName: "已确认住宅", marketValueWan: 200, liquidity: "illiquid", status: "active", factStatus: "known", openedAtAgeInMonths: 360, evidence }] : []
    }
  });
  if (input.debtSettlement) {
    ledger.recentTransactions = [debtSettlementTransaction({ forgiven: input.debtSettlement === "forgiven" })];
  }
  const terminal: HistoryItem = {
    age: 40, ageInMonths: 480, stage: "终局", title: "回望", description: "生活继续向前。", selectedChoice: "继续生活",
    attributes: { happiness: 50, intelligence: 50, wealth: 50, relation: 50, health: 50 }, choices: [], isEndingNode: true,
    financialLedger: ledger,
    worldStateSnapshot: { people: [], directionArcs: [], pressureArcs: [], careerStates: [], currentEmploymentStatus: "not_working", careerRevision: 0, committedTransactionIds: [], version: 2 }
  };
  if (!input.debtSettlement || !input.debt) return [terminal];
  const predecessorDebt: DebtAccount = {
    ...input.debt,
    principalWan: input.debt.principalWan > 0 ? input.debt.principalWan : 100,
    status: "active",
    closedAtAgeInMonths: undefined
  };
  const predecessorLedger = initializeFinancialLedger({
    id: "ledger_before_settlement", asOfAgeInMonths: 468,
    openingPosition: {
      cashAccounts: [{ id: PRIMARY_CASH_ACCOUNT_ID, type: "bank_deposit", balanceWan: input.cashWan ?? 10, status: "active", factStatus: "known", evidence }],
      debtAccounts: [predecessorDebt]
    }
  });
  return [{
    ...terminal,
    age: 39,
    ageInMonths: 468,
    title: "偿债前",
    isEndingNode: false,
    financialLedger: predecessorLedger
  }, terminal];
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

test("PB-REPORT-04 accepted ledger repayment permits debt-completion semantics", () => {
  const authority = deriveFinalFinancialNarrativeAuthority(historyWith({ debt: debt("repaid"), cashWan: 10, debtSettlement: "repaid" }));
  assert.equal(authority?.debt.kind, "debt_fully_repaid");
  assert.equal(collectFinalFinancialNarrativeIssues({ outcome: outcome("我终于还清了债务"), authority }).length, 0);
});

test("PB-REPORT-04B a raw repaid account cannot authorize terminal payoff copy", () => {
  const authority = deriveFinalFinancialNarrativeAuthority(historyWith({ debt: debt("repaid"), cashWan: 10 }));
  assert.equal(authority?.debt.kind, "no_active_debt");
  const value = outcome("我终于还清了债务");
  value.report.executiveSummary.headline = "你终于结清了全部债务。";
  const issues = collectFinalFinancialNarrativeIssues({ outcome: value, authority });
  assert.deepEqual(
    issues.map((item) => item.code),
    ["REPORT_DEBT_COMPLETION_CONFLICT", "REPORT_DEBT_COMPLETION_CONFLICT"]
  );
});

test("PB-REPORT-04B2 raw repaid status cannot authorize debt-clear title wording", () => {
  const authority = deriveFinalFinancialNarrativeAuthority(historyWith({ debt: debt("repaid"), cashWan: 10 }));
  const value = outcome("我终于让债务归零，重新开始生活");
  const issues = collectFinalFinancialNarrativeIssues({ outcome: value, authority });
  assert.deepEqual(issues.map((item) => item.code), ["REPORT_DEBT_COMPLETION_CONFLICT"]);
});

test("PB-REPORT-04C accepted ledger remission permits debt-completion semantics", () => {
  const authority = deriveFinalFinancialNarrativeAuthority(historyWith({ debt: debt("repaid"), cashWan: 10, debtSettlement: "forgiven" }));
  assert.equal(authority?.debt.kind, "debt_fully_repaid");
  assert.equal(collectFinalFinancialNarrativeIssues({ outcome: outcome("我终于还清了债务"), authority }).length, 0);
});

test("PB-REPORT-04D every terminal repaid account needs its own recorded settlement", () => {
  const history = historyWith({ debt: debt("repaid"), cashWan: 10, debtSettlement: "repaid" });
  history.at(-1)!.financialLedger!.debtAccounts.push({ ...debt("repaid"), id: "debt_unproved" });
  const authority = deriveFinalFinancialNarrativeAuthority(history);
  assert.equal(authority?.debt.kind, "no_active_debt");
  assert.equal(collectFinalFinancialNarrativeIssues({ outcome: outcome("我终于还清了全部债务"), authority })[0]?.code, "REPORT_DEBT_COMPLETION_CONFLICT");
});

test("PB-REPORT-04E a payment for debt A cannot authorize payoff copy for raw-repaid debt B", () => {
  const history = historyWith({ debt: debt("repaid"), cashWan: 10, debtSettlement: "repaid" });
  history[0]!.financialLedger!.debtAccounts.push({ ...debt("active"), id: "debt_b", displayName: "第二笔个人借款" });
  history.at(-1)!.financialLedger!.debtAccounts.push({ ...debt("repaid"), id: "debt_b", displayName: "第二笔个人借款" });

  const authority = deriveFinalFinancialNarrativeAuthority(history);
  assert.equal(authority?.debt.kind, "no_active_debt");
  const value = outcome("我终于还清了全部债务");
  assert.equal(
    collectFinalFinancialNarrativeIssues({ outcome: value, authority })[0]?.code,
    "REPORT_DEBT_COMPLETION_CONFLICT"
  );
});

test("PB-REPORT-05 validation reports conflicts without rewriting model prose", () => {
  const authority = deriveFinalFinancialNarrativeAuthority(historyWith({ debt: debt(), cashWan: 10 }))!;
  const value = outcome("我用25年还清了债务");
  value.report.finalLifeReading.paragraphs = ["你一直认真照顾家人。"];
  const before = JSON.stringify(value);
  assert.equal(collectFinalFinancialNarrativeIssues({ outcome: value, authority })[0]?.code, "REPORT_DEBT_COMPLETION_CONFLICT");
  assert.equal(JSON.stringify(value), before);
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
  assert.equal(
    collectFinalFinancialNarrativeIssues({ outcome: outcome("我走到终点时仍有839.6万元债务"), authority }).length,
    0
  );
  const promptAuthority = formatFinalFinancialNarrativeAuthorityForPrompt(authority);
  assert.match(promptAuthority, /839\.6万/u);
  assert.doesNotMatch(promptAuthority, /839\.6358/u);
});

test("PB-REPORT-09 no internal financial placeholder may reach any final-outcome surface", () => {
  const history = historyWith({ debt: debt("active", 100), cashWan: 0 });
  const value = outcome("我把公司做到月入46万元，却仍要处理债务");
  value.report.finalLifeReading.paragraphs = ["负债金额待账本确认，回报率待账本确认。"];
  const authority = deriveFinalFinancialNarrativeAuthority(history)!;
  assert.equal(
    collectFinalFinancialNarrativeIssues({ outcome: value, authority })
      .some((issue) => issue.code === "REPORT_INTERNAL_PLACEHOLDER"),
    true
  );
});

test("PB-REPORT-10 invalid title amount is rejected without rewriting model prose", () => {
  const history = historyWith({ debt: debt("active", 100), cashWan: 0 });
  const authority = deriveFinalFinancialNarrativeAuthority(history)!;
  const value = outcome("我月入46万元，却还是负债8…");
  const before = value.share.viralTitle;
  const issues = collectFinalFinancialNarrativeIssues({ outcome: value, authority });
  assert.equal(issues.some((issue) => issue.code === "REPORT_UNSUPPORTED_FINANCIAL_AMOUNT"), true);
  assert.equal(issues.some((issue) => issue.code === "REPORT_ORPHAN_FINANCIAL_AMOUNT"), true);
  assert.equal(value.share.viralTitle, before);
});

test("PB-REPORT-11 long financial precision is rejected instead of silently rounded", () => {
  const history = historyWith({ cashWan: 54.9996 });
  const authority = deriveFinalFinancialNarrativeAuthority(history)!;
  const value = outcome("我留下54.9996万元现金");
  assert.equal(
    collectFinalFinancialNarrativeIssues({ outcome: value, authority })
      .some((issue) => issue.code === "REPORT_FINANCIAL_PRECISION"),
    true
  );
  assert.equal(value.share.viralTitle, "我留下54.9996万元现金");
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

test("PB-REPORT-13 final report and poster prompt consume the same V4 classified personal expense authority", () => {
  const history = historyWith({ cashWan: 10 });
  const opening = history[0].financialLedger! as FinancialLedgerV3;
  opening.expenseCommitments = [{
    id: "shared_home",
    type: "housing",
    displayName: "共同租住公寓",
    monthlyAmountWan: 0.3,
    grossMonthlyAmountWan: 0.6,
    householdShareRate: 0.5,
    confirmedMonthlyAmountWan: 0.3,
    amountBasis: "explicit_shared_amount",
    amountSourceIds: ["lease:shared_home"],
    financialScope: "shared_household",
    activeFromAgeInMonths: 470,
    status: "active",
    factStatus: "known",
    evidence: [{ ...evidence[0], financialScope: "shared_household" }]
  }];
  history[0].financialLedger = migrateFinancialLedgerV3ToV4(opening);

  const authority = deriveFinalFinancialNarrativeAuthority(history)!;
  assert.equal(authority.personalExpenseSummary.availability, "available");
  if (authority.personalExpenseSummary.availability !== "available") throw new Error("expected V4 expense authority");
  assert.deepEqual(authority.personalExpenseSummary.activeCommitments.map((item) => ({
    responsibilityKey: item.responsibilityKey,
    kind: item.responsibilityKind,
    scope: item.financialScope,
    monthly: item.monthlyAmountWan,
    basis: item.amountBasis,
    factStatus: item.factStatus,
    review: item.reviewStatus
  })), [{
    responsibilityKey: "primary_residence:main",
    kind: "primary_residence",
    scope: "shared_household",
    monthly: 0.3,
    basis: "explicit_shared_amount",
    factStatus: "known",
    review: "normal"
  }]);
  assert.equal(authority.numericClaims.find((claim) => claim.kind === "personal_annual_expense")?.valueWan, 3.6);

  const prompt = buildFinalOutcomePrompt({
    birthday: "1990-01-01", birthtime: "08:00", gender: "女", currentSituation: "测试", isReturnToPast: true,
    targetAgeNode: "毕业", regressionNodeKey: "career", regressionAge: 22, regressionSituation: "测试", regressionChoices: "测试", coreStoryFocus: "career"
  }, [], history, { happiness: 50, intelligence: 50, wealth: 50, relation: 50, health: 50 }, { closureType: "mortality" });
  assert.match(prompt, /V4 个人持续支出分类摘要（报告与海报唯一支出事实源）/u);
  assert.match(prompt, /responsibilityKey=primary_residence:main/u);
  assert.match(prompt, /"personalExpenseSummary"/u, "the report/poster semantic authority must carry the same V4 object");
});

test("PB-REPORT-14 negative net worth cannot be romanticized as a worthwhile exchange", () => {
  const history = historyWith({ debt: debt("active", 100), cashWan: 10 });
  const authority = deriveFinalFinancialNarrativeAuthority(history)!;
  const value = outcome("我仍在安排生活");
  value.report.finalLifeReading.finalSentence = "你以负净资产换来了丰盈的生命，这是一场值得的交换。";
  const issues = collectFinalFinancialNarrativeIssues({ outcome: value, authority });
  assert.equal(issues.some((issue) => issue.code === "REPORT_NEGATIVE_NET_WORTH_ROMANTICIZATION"), true);
});

test("PB-REPORT-15 unsupported report amounts are detected before generic sanitization", () => {
  const history = historyWith({ debt: debt("active", 100), cashWan: 10 });
  const authority = deriveFinalFinancialNarrativeAuthority(history)!;
  const value = outcome("我留下46万元现金继续生活");
  assert.equal(
    collectFinalFinancialNarrativeIssues({ outcome: value, authority })
      .some((issue) => issue.code === "REPORT_UNSUPPORTED_FINANCIAL_AMOUNT"),
    true
  );
});

test("PB-REPORT-16 debt cannot be minimized with poetic or anti-financial framing", () => {
  const history = historyWith({ debt: debt("active", 100), cashWan: 10 });
  const authority = deriveFinalFinancialNarrativeAuthority(history)!;
  for (const text of [
    "真正的财富不在账户数字，而在内心的丰盈。",
    "债务是音符，但旋律悠扬。",
    "你留下的读本是比债务更重要的遗产。",
    "你愿意背负债务，也要让项目延续。",
    "你的一生里，债务是选择意义的代价。",
    "即使负债，你也未曾后悔。",
    "你背负着债务，但也背负着希望。"
  ]) {
    const value = outcome("我仍在安排生活");
    value.report.finalLifeReading.finalSentence = text;
    assert.equal(
      collectFinalFinancialNarrativeIssues({ outcome: value, authority })
        .some((issue) => issue.code === "REPORT_NEGATIVE_NET_WORTH_ROMANTICIZATION"),
      true,
      text
    );
  }
});

test("PB-REPORT-17 absent property authority forbids a mortgage claim", () => {
  const history = historyWith({ debt: debt("active", 100), cashWan: 10 });
  const authority = deriveFinalFinancialNarrativeAuthority(history)!;
  const value = outcome("我仍在安排生活");
  value.report.repeatedPatterns[0] = {
    name: "投入项目",
    title: "你持续投入项目",
    paragraphs: ["你甚至抵押房产来维持项目。"],
    keyMomentIndexes: [0],
    closingLine: "投入形成了长期代价。"
  };
  assert.equal(
    collectFinalFinancialNarrativeIssues({ outcome: value, authority })
      .some((issue) => issue.code === "REPORT_PROPERTY_CONFLICT"),
    true
  );
});

test("PB-REPORT-18 mortality financial conflicts are rejected without deterministic fallback prose", () => {
  const history = historyWith({ debt: debt("active", 100), cashWan: 10 });
  const authority = deriveFinalFinancialNarrativeAuthority(history)!;
  const value = outcome("我仍在安排生活");
  value.report.futureTrends = [{
    title: "债务遗留",
    trend: "你留下46万元债务，未来继续按计划偿还。",
    reason: "债务仍在偿还过程中，你开始用更可持续的方式安排生活。",
    keyMomentIndexes: [0]
  }];
  const issues = collectFinalFinancialNarrativeIssues({ outcome: value, authority });
  assert.equal(issues.some((issue) => issue.code === "REPORT_UNSUPPORTED_FINANCIAL_AMOUNT"), true);
  assert.match(value.report.futureTrends[0].trend, /继续按计划偿还/u);
});

test("PB-REPORT-19 debt cannot be offset by legacy or lack of regret", () => {
  const history = historyWith({ debt: debt("active", 100), cashWan: 10 });
  const authority = deriveFinalFinancialNarrativeAuthority(history)!;
  for (const text of [
    "你的债务是你的代价，但你的作品是你的传承。",
    "你留下了未偿债务。但你没有遗憾。"
  ]) {
    const value = outcome("我仍在安排生活");
    value.report.finalLifeReading.finalSentence = text;
    assert.equal(
      collectFinalFinancialNarrativeIssues({ outcome: value, authority })
        .some((issue) => issue.code === "REPORT_NEGATIVE_NET_WORTH_ROMANTICIZATION"),
      true,
      text
    );
  }
});

test("PB-REPORT-20 r6 poetic debt offsets are rejected as fixed regressions", () => {
  const history = historyWith({ debt: debt("active", 100), cashWan: 10 });
  const authority = deriveFinalFinancialNarrativeAuthority(history)!;
  for (const text of [
    "你留下的不是债务，而是种子。",
    "我用了半生还一笔68.56万的债，却换来了内心的河堤。",
    "你从害怕履历中断到甘愿背负债务。",
    "我用一生还债，却在河堤上吹响了一首曲子。"
  ]) {
    const value = outcome("我仍在安排生活");
    value.report.finalLifeReading.finalSentence = text;
    assert.equal(
      collectFinalFinancialNarrativeIssues({ outcome: value, authority })
        .some((issue) => issue.code === "REPORT_NEGATIVE_NET_WORTH_ROMANTICIZATION"),
      true,
      text
    );
  }
});

test("PB-REPORT-21 outstanding debt accepts explicit non-completion wording", () => {
  const authority = deriveFinalFinancialNarrativeAuthority(historyWith({ debt: debt("active", 100), cashWan: 10 }))!;
  for (const text of [
    "直到去世，债务仍未还清。",
    "你没有还清全部欠款。",
    "离真正还清债务仍有距离。",
    "历史记录显示你始终未还清债务，债务的后续处理未在生前完成。",
    "报告唯一财务事实源显示，总债务仍然存在，且未显示债务已结清。",
    "尚无记录证明债务已经清偿。",
    "不能确认全部欠款已经还清。"
  ]) {
    assert.equal(
      collectFinalFinancialNarrativeIssues({ outcome: outcome(text), authority })
        .some((issue) => issue.code === "REPORT_DEBT_COMPLETION_CONFLICT"),
      false,
      text
    );
  }
  for (const text of [
    "经过长期分期偿还，你终于还清了全部债务。",
    "欠款已经结清，从此无债一身轻。",
    "债务清偿完毕。",
    "早年仍未还清债务，晚年却终于还清了全部债务。"
  ]) {
    assert.equal(
      collectFinalFinancialNarrativeIssues({ outcome: outcome(text), authority })
        .some((issue) => issue.code === "REPORT_DEBT_COMPLETION_CONFLICT"),
      true,
      text
    );
  }
});

test("PB-REPORT-22 missing property evidence is unknown, not confirmed absence", () => {
  const authority = deriveFinalFinancialNarrativeAuthority(historyWith({ debt: debt("active", 100), cashWan: 10 }))!;
  assert.equal(
    collectFinalFinancialNarrativeIssues({ outcome: outcome("没有已确认房产事实。"), authority })
      .some((issue) => issue.code === "REPORT_PROPERTY_ABSENCE_OVERCLAIM"),
    false
  );
  for (const text of ["你没有房产。", "你没有房产或其他可变现资产。"] ) {
    const issues = collectFinalFinancialNarrativeIssues({ outcome: outcome(text), authority });
    assert.equal(
      issues.some((issue) => issue.code === "REPORT_PROPERTY_ABSENCE_OVERCLAIM" || issue.code === "REPORT_ASSET_ABSENCE_OVERCLAIM"),
      true,
      text
    );
  }
});

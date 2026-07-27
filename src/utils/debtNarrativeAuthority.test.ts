import assert from "node:assert/strict";
import test from "node:test";
import { initializeFinancialLedger } from "../domain/finance/initializeLedger";
import type { DebtHealthState } from "../domain/finance/debtHealth";
import type { FinancialLedger } from "../domain/finance/types";
import type { SimulationNode } from "../types";
import {
  applyDebtNarrativeAuthorityToNode,
  applyDebtNarrativeFallback,
  collectDebtNarrativeSurfaceIssues,
  deriveDebtNarrativeAuthority,
  repairDebtNarrativeSurfaces
} from "./debtNarrativeAuthority";

function debtLedger(input: { status?: "active" | "defaulted"; missed?: number } = {}): FinancialLedger {
  return {
    ...initializeFinancialLedger({ id: "debt_narrative_authority", asOfAgeInMonths: 400 }),
    cashAccounts: [{
      id: "cash_primary",
      type: "bank_deposit",
      balanceWan: 0,
      status: "active",
      factStatus: "known",
      evidence: []
    }],
    debtAccounts: [{
      id: "loan_1",
      type: "consumer_loan",
      displayName: "个人经营贷款",
      principalWan: 20,
      openedAtAgeInMonths: 360,
      status: input.status ?? "active",
      repaymentPolicy: { mode: "known_schedule", monthlyPaymentWan: 1 },
      factStatus: "known",
      evidence: [],
      origin: "explicit",
      accruedUnpaidInterestWan: 0.5,
      servicingStatus: "delinquent",
      consecutiveMissedPaymentMonths: input.missed ?? 10,
      totalMissedPaymentMonths: input.missed ?? 10,
      recentMissedPaymentAgeInMonths: [397, 398, 399, 400]
    }],
    recentTransactions: [{
      id: "tx_pressure",
      simulationTransactionId: "sim_pressure",
      eventIds: [],
      periodStartAgeInMonths: 396,
      periodEndAgeInMonths: 400,
      cashDeltaWan: 0,
      assetDeltaWan: 0,
      debtDeltaWan: 0.5,
      incomeWan: 0,
      expenseWan: 0,
      valuationChangeWan: 0,
      nonCashGainLossWan: -0.5,
      netWorthDeltaWan: -0.5,
      debtServiceRecords: [397, 398, 399, 400].map((ageInMonths) => ({
        id: `service_${ageInMonths}`,
        debtAccountId: "loan_1",
        ageInMonths,
        interestDueWan: 0.1,
        interestPaidWan: 0,
        interestUnpaidWan: 0.1,
        principalDueWan: 0.9,
        principalPaidWan: 0,
        principalUnpaidWan: 0.9,
        outcome: "missed" as const,
        reasonCodes: ["DEBT_PAYMENT_MISSED" as const]
      })),
      debtPrincipalDrawnWan: 0,
      debtPrincipalPaidWan: 0,
      debtPrincipalForgivenWan: 0,
      debtInterestAccruedWan: 0.5,
      debtInterestPaidWan: 0,
      debtInterestLiabilityPaidWan: 0,
      debtInterestForgivenWan: 0,
      debtCapitalizedInterestWan: 0,
      automaticLiquidityShortfallIncreaseWan: 0,
      automaticLiquidityShortfallRecoveryWan: 0,
      evidence: []
    }]
  };
}

function debtHealth(level: DebtHealthState["level"] = "default_risk"): DebtHealthState {
  return {
    asOfAgeInMonths: 400,
    level,
    trend: "worsening",
    totalDebtWan: 20.5,
    scheduledDebtServiceNext12MonthsWan: 12,
    availableCashForDebtNext12MonthsWan: 0,
    debtServiceCoverageRatio: 0,
    cashBufferMonths: 0,
    liquidityShortfallDebtWan: 0,
    consecutiveMissedPaymentMonths: 10,
    missedPaymentMonthsLast12: 10,
    activeDefaultedDebtCount: level === "defaulted" ? 1 : 0,
    reasonCodes: ["CONSECUTIVE_MISSED_PAYMENTS"],
    source: "authoritative_ledger",
    sourceLedgerRevision: 0
  };
}

function node(overrides: Partial<SimulationNode> = {}): SimulationNode {
  return {
    age: 33,
    ageInMonths: 400,
    stage: "债务压力",
    title: "还款安排需要调整",
    description: "银行要求补充材料，你开始核对必要支出。",
    descriptionParagraphs: ["银行要求补充材料，你开始核对必要支出。"],
    choices: [
      { id: "A", text: "申请调整还款安排", impactSummary: "等待审核", eventOutcomeId: "request_debt_restructuring" },
      { id: "B", text: "出售非必要资产", impactSummary: "补充现金", eventOutcomeId: "sell_nonessential_asset" },
      { id: "C", text: "接受并记录当前拖欠", impactSummary: "核对事实", eventOutcomeId: "accept_and_record_payment_arrears" }
    ],
    attributes: { happiness: 40, intelligence: 50, wealth: 20, relation: 50, health: 50 },
    isEndingNode: false,
    narrativeMeta: {
      elapsedMonths: 4,
      elapsedYears: 4 / 12,
      lifeIntensity: "high_tension",
      nodeMateriality: "decision_checkpoint",
      storyEpisode: {
        id: "episode_debt",
        startAgeInMonths: 396,
        endAgeInMonths: 400,
        internalTransitions: [],
        decisionCheckpointId: "checkpoint_debt",
        summary: "还款安排需要重新核对。"
      },
      recoveryState: "depleted",
      recoveryEvidence: [],
      arcSignals: [],
      activeCharacters: [],
      worldDeltas: []
    },
    ...overrides
  };
}

test("D4.5-01 non-defaulted default-risk authority exposes only ordinary servicing interactions", () => {
  const authority = deriveDebtNarrativeAuthority({
    ledger: debtLedger(),
    debtHealthState: debtHealth(),
    periodStartAgeInMonths: 396
  });

  assert.equal(authority.lifecycle, "delinquent");
  assert.deepEqual(authority.permittedInstitutionActions, [
    "payment_reminder",
    "documents_requested",
    "negotiation_invited",
    "internal_account_review"
  ]);
  assert.equal(authority.canonicalFacts.some((fact) => fact.kind === "formal_default_recorded"), false);
  assert.equal(authority.canonicalFacts.find((fact) => fact.kind === "missed_payments_continue")?.text.includes("10个月"), true);
});

test("D4.5-02 monthly authority timeline is sourced from debt service records", () => {
  const authority = deriveDebtNarrativeAuthority({
    ledger: debtLedger(),
    debtHealthState: debtHealth(),
    periodStartAgeInMonths: 396
  });
  assert.deepEqual(authority.timeline.map((fact) => [fact.ageInMonths, fact.kind]), [
    [397, "payment_missed"],
    [398, "payment_missed"],
    [399, "payment_missed"],
    [400, "payment_missed"]
  ]);
});

test("D4.5-03 authority validates description, choices, summaries and evidence as one surface", () => {
  const authority = deriveDebtNarrativeAuthority({ ledger: debtLedger(), debtHealthState: debtHealth(), periodStartAgeInMonths: 396 });
  const unsafe = node({
    description: "贷款已经移交贷后处置团队。",
    descriptionParagraphs: ["贷款已经移交贷后处置团队。"],
    choices: [{ id: "A", text: "在银行起诉前四处借钱", impactSummary: "避免法务处置" }],
    narrativeMeta: {
      ...node().narrativeMeta!,
      storyEpisode: {
        ...node().narrativeMeta!.storyEpisode,
        summary: "征信记录已经影响未来贷款。",
        internalTransitions: [{ atAgeInMonths: 399, materiality: "transition", summary: "催收升级开始。", worldDeltas: [] }]
      },
      arcSignals: [{ type: "debt_pressure_persists", evidence: "法务部门已经介入。", confidence: 0.9 }]
    }
  });
  const issues = collectDebtNarrativeSurfaceIssues({ node: unsafe, authority });
  assert.ok(issues.some((issue) => issue.surface === "description"));
  assert.ok(issues.some((issue) => issue.surface === "choice.text"));
  assert.ok(issues.some((issue) => issue.surface === "storyEpisode.summary"));
  assert.ok(issues.some((issue) => issue.surface === "storyEpisode.internalTransition"));
  assert.ok(issues.some((issue) => issue.surface === "arcSignal.evidence"));
});

test("D4.5-04 deterministic fallback preserves safe story text and records telemetry", () => {
  const ledger = debtLedger();
  const health = debtHealth();
  const authority = deriveDebtNarrativeAuthority({ ledger, debtHealthState: health, periodStartAgeInMonths: 396 });
  const original = node({ financialLedger: ledger, debtHealthState: health });
  const fallback = applyDebtNarrativeFallback({
    node: original,
    authority,
    reasonCodes: ["UNAUTHORIZED_COLLECTION", "UNAUTHORIZED_LEGAL_ACTION"]
  });

  assert.match(fallback.description, /银行要求补充材料/);
  assert.doesNotMatch(fallback.description, /催收|法务|诉讼|征信/);
  assert.doesNotMatch(fallback.description, /权威账本|账本确认|Accepted Event|Proposal/);
  assert.equal(fallback.financialProcessingMeta?.narrativeFallback, true);
  assert.equal(fallback.financialProcessingMeta?.narrativeRepairAttempts, 1);
  assert.deepEqual(fallback.financialProcessingMeta?.rejectedDebtClaimKinds, [
    "UNAUTHORIZED_COLLECTION",
    "UNAUTHORIZED_LEGAL_ACTION"
  ]);
  assert.deepEqual(fallback.financialLedger, ledger);
  assert.deepEqual(fallback.debtHealthState, health);
});

test("D4.5-05 rejected restructure is rendered as attempted but not completed", () => {
  const authority = deriveDebtNarrativeAuthority({ ledger: debtLedger(), debtHealthState: debtHealth(), periodStartAgeInMonths: 396 });
  const fallback = applyDebtNarrativeFallback({
    node: node({ description: "银行已经批准重组协议。", descriptionParagraphs: ["银行已经批准重组协议。"] }),
    authority,
    reasonCodes: ["REJECTED_RESTRUCTURE_COMPLETION"],
    rejectedCompletionKinds: ["debt_restructured"]
  });
  assert.match(fallback.description, /提交调整还款安排的申请/);
  assert.match(fallback.description, /结果仍待确认/);
  assert.doesNotMatch(fallback.description, /已经批准|已经生效/);
});

test("D4.5-06 a narrative cannot deny debt that exists in the closing ledger", () => {
  const authority = deriveDebtNarrativeAuthority({ ledger: debtLedger(), debtHealthState: debtHealth(), periodStartAgeInMonths: 396 });
  const issues = collectDebtNarrativeSurfaceIssues({
    node: node({
      description: "你最终没有申请那笔贷款，现在无任何个人负债。",
      descriptionParagraphs: ["你最终没有申请那笔贷款，现在无任何个人负债。"]
    }),
    authority
  });
  assert.deepEqual([...new Set(issues.map((issue) => issue.reasonCode))], ["DENIED_EXISTING_DEBT"]);
});

test("D4.5-07 opening missed count and debt amount cannot survive a closing-ledger check", () => {
  const authority = deriveDebtNarrativeAuthority({ ledger: debtLedger(), debtHealthState: debtHealth(), periodStartAgeInMonths: 396 });
  const issues = collectDebtNarrativeSurfaceIssues({
    node: node({
      description: "你已经连续8个月未能足额偿还，也不得不直面这笔19万元的债务。",
      descriptionParagraphs: ["你已经连续8个月未能足额偿还，也不得不直面这笔19万元的债务。"]
    }),
    authority
  });
  assert.deepEqual([...new Set(issues.map((issue) => issue.reasonCode))], [
    "MISMATCHED_MISSED_PAYMENT_COUNT",
    "MISMATCHED_DEBT_AMOUNT"
  ]);
});

test("D4.5-08 debt choice copy is rendered from eventOutcomeId rather than model prose", () => {
  const authority = deriveDebtNarrativeAuthority({ ledger: debtLedger(), debtHealthState: debtHealth(), periodStartAgeInMonths: 396 });
  const result = applyDebtNarrativeAuthorityToNode({
    node: node({
      choices: [{
        id: "C",
        text: "找一位律师朋友聊聊",
        impactSummary: "专业建议",
        eventOutcomeId: "seek_verified_family_support"
      }]
    }),
    authority
  });
  assert.equal(result.choices[0].text, "核对可验证的家庭支持");
  assert.equal(result.choices[0].impactSummary, "确认支持是否真实可用");
  assert.equal(result.choices[0].decisionIntent, "financial:seek_verified_support");
});

test("D4.5-09 a single unauthorized claim is repaired locally without whole-node fallback", () => {
  const authority = deriveDebtNarrativeAuthority({ ledger: debtLedger(), debtHealthState: debtHealth(), periodStartAgeInMonths: 396 });
  const unsafe = node({
    description: "你继续工作。银行已经开始计算罚息。你也准备核对材料。",
    descriptionParagraphs: ["你继续工作。银行已经开始计算罚息。你也准备核对材料。"],
    financialProcessingMeta: {
      proposalCount: 0,
      acceptedEventCount: 0,
      acceptedCareerTransitionCount: 0,
      blockingIssueCount: 0,
      repairTriggered: false,
      repairLatencyMs: 0,
      totalProcessingLatencyMs: 0
    }
  });
  const issues = collectDebtNarrativeSurfaceIssues({ node: unsafe, authority });
  const repaired = repairDebtNarrativeSurfaces({ node: unsafe, authority, issues });
  assert.match(repaired.description, /你继续工作/);
  assert.match(repaired.description, /材料核对和协商准备/);
  assert.doesNotMatch(repaired.description, /罚息/);
  assert.equal(collectDebtNarrativeSurfaceIssues({ node: repaired, authority }).length, 0);
  assert.equal(repaired.financialProcessingMeta?.narrativeFallback, false);
  assert.deepEqual(repaired.financialProcessingMeta?.rejectedDebtClaimKinds, ["UNAUTHORIZED_PENALTY"]);
});

test("PB-NARR-01 fallback replaces only unsafe sentences and never emits internal ledger prose", () => {
  const authority = deriveDebtNarrativeAuthority({ ledger: debtLedger(), debtHealthState: debtHealth(), periodStartAgeInMonths: 396 });
  const original = node({
    description: "你白天继续完成项目。贷款已经移交催收部门。晚上你和家人一起吃饭。",
    descriptionParagraphs: ["你白天继续完成项目。贷款已经移交催收部门。晚上你和家人一起吃饭。"]
  });
  const fallback = applyDebtNarrativeFallback({
    node: original,
    authority,
    reasonCodes: ["UNAUTHORIZED_COLLECTION"]
  });
  assert.match(fallback.description, /你白天继续完成项目/);
  assert.match(fallback.description, /晚上你和家人一起吃饭/);
  assert.doesNotMatch(fallback.description, /催收部门|权威账本|账本确认/);
  assert.deepEqual(fallback.financialProcessingMeta?.narrativeFallbackSurfacePaths, ["description"]);
});

test("PB-NARR-02 debt delta breakdown explains newly accrued interest", () => {
  const authority = deriveDebtNarrativeAuthority({ ledger: debtLedger(), debtHealthState: debtHealth(), periodStartAgeInMonths: 396 });
  assert.equal(authority.deltaBreakdown.openingDebtWan, 20);
  assert.equal(authority.deltaBreakdown.closingDebtWan, 20.5);
  assert.equal(authority.deltaBreakdown.currentInterestAccruedWan, 0.5);
  assert.equal(authority.deltaBreakdown.unexplainedDeltaWan, 0);
  assert.match(authority.canonicalFacts.find((fact) => fact.kind === "debt_interest_accrued")?.text ?? "", /0.5万元利息/);
});

test("debt delta breakdown treats a discovered prior balance as an explained non-cash correction", () => {
  const ledger = debtLedger();
  ledger.debtAccounts[0].principalWan = 210;
  ledger.debtAccounts[0].accruedUnpaidInterestWan = 0;
  ledger.recentTransactions = [{
    ...ledger.recentTransactions[0],
    debtDeltaWan: 210,
    netWorthDeltaWan: -210,
    priorFactCorrectionWan: -210,
    nonCashGainLossWan: 0,
    debtBalanceDiscoveredWan: 210,
    debtInterestAccruedWan: 0
  }];
  const authority = deriveDebtNarrativeAuthority({
    ledger,
    debtHealthState: { ...debtHealth(), totalDebtWan: 210 },
    periodStartAgeInMonths: 396
  });
  assert.equal(authority.deltaBreakdown.balanceDiscoveredWan, 210);
  assert.equal(authority.deltaBreakdown.unexplainedDeltaWan, 0);
});

test("debt surface repair supplies deterministic copy when an optional choice summary is absent", () => {
  const authority = deriveDebtNarrativeAuthority({ ledger: debtLedger(), debtHealthState: debtHealth(), periodStartAgeInMonths: 396 });
  const unsafe = node({
    description: "银行已经开始计算罚息。",
    descriptionParagraphs: ["银行已经开始计算罚息。"],
    choices: [{ id: "A", text: "继续核对", impactSummary: undefined } as any]
  });
  const issues = collectDebtNarrativeSurfaceIssues({ node: unsafe, authority });
  const repaired = repairDebtNarrativeSurfaces({ node: unsafe, authority, issues });
  assert.equal(repaired.choices[0].impactSummary, "现实影响仍需观察");
  assert.equal(collectDebtNarrativeSurfaceIssues({ node: repaired, authority }).length, 0);
});

test("PB-NARR-08 mortgage payoff prose is rejected while the closing account remains active", () => {
  const authority = deriveDebtNarrativeAuthority({ ledger: debtLedger(), debtHealthState: debtHealth(), periodStartAgeInMonths: 396 });
  const unsafe = node({
    description: "项目逐渐稳定，房贷已经清零，你开始重新安排生活。",
    descriptionParagraphs: ["项目逐渐稳定，房贷已经清零，你开始重新安排生活。"]
  });
  const issues = collectDebtNarrativeSurfaceIssues({ node: unsafe, authority });
  assert.equal(issues.some((issue) => issue.reasonCode === "UNACCEPTED_DEBT_COMPLETION"), true);
  const repaired = repairDebtNarrativeSurfaces({ node: unsafe, authority, issues });
  assert.doesNotMatch(repaired.description, /清零|还清|结清/u);
  assert.match(repaired.description, /仍有.*需要处理|仍需继续处理|偿还/u);
});

test("PB-NARR-08 debt-free idiom is rejected while the closing account remains active", () => {
  const authority = deriveDebtNarrativeAuthority({ ledger: debtLedger(), debtHealthState: debtHealth(), periodStartAgeInMonths: 396 });
  const unsafe = node({
    description: "虽然存款几乎为零，但无债一身轻的感觉让你松了口气。",
    descriptionParagraphs: ["虽然存款几乎为零，但无债一身轻的感觉让你松了口气。"]
  });
  const issues = collectDebtNarrativeSurfaceIssues({ node: unsafe, authority });
  assert.equal(issues.some((issue) => issue.reasonCode === "UNACCEPTED_DEBT_COMPLETION"), true);
  const repaired = repairDebtNarrativeSurfaces({ node: unsafe, authority, issues });
  assert.doesNotMatch(repaired.description, /无债一身轻|不再欠债/u);
  assert.match(repaired.description, /仍有.*需要处理|仍需继续处理|偿还/u);
});

test("PB-NARR-18 a payoff claim is rejected when debt was already zero before the period", () => {
  const ledger = initializeFinancialLedger({ id: "already_debt_free", asOfAgeInMonths: 593 });
  ledger.recentTransactions = [{
    id: "tx_no_debt", simulationTransactionId: "sim_no_debt", eventIds: [],
    periodStartAgeInMonths: 587, periodEndAgeInMonths: 593,
    cashDeltaWan: 7, assetDeltaWan: 0, debtDeltaWan: 0, incomeWan: 18, expenseWan: 11,
    valuationChangeWan: 0, nonCashGainLossWan: 0, netWorthDeltaWan: 7,
    debtPrincipalDrawnWan: 0, debtPrincipalPaidWan: 0, debtPrincipalForgivenWan: 0,
    debtInterestAccruedWan: 0, debtInterestPaidWan: 0, debtInterestLiabilityPaidWan: 0,
    debtInterestForgivenWan: 0, debtCapitalizedInterestWan: 0,
    automaticLiquidityShortfallIncreaseWan: 0, automaticLiquidityShortfallRecoveryWan: 0,
    evidence: []
  }];
  const authority = deriveDebtNarrativeAuthority({ ledger, debtHealthState: { ...debtHealth(), level: "none", consecutiveMissedPaymentMonths: 0 }, periodStartAgeInMonths: 587 });
  const unsafe = node({
    description: "你的个人税后分成10万元，其中8万元用于还清最后一笔个人债务。",
    descriptionParagraphs: ["你的个人税后分成10万元，其中8万元用于还清最后一笔个人债务。"]
  });
  const issues = collectDebtNarrativeSurfaceIssues({ node: unsafe, authority });
  assert.equal(issues.some((issue) => issue.reasonCode === "UNACCEPTED_DEBT_COMPLETION"), true);
  const repaired = repairDebtNarrativeSurfaces({ node: unsafe, authority, issues });
  assert.doesNotMatch(repaired.description, /还清|结清|清偿/u);
  assert.match(repaired.description, /现金缓冲与生活安排/u);
});

test("PB-NARR-18 a hypothetical future payoff is not a completed claim", () => {
  const authority = deriveDebtNarrativeAuthority({ ledger: debtLedger(), debtHealthState: debtHealth(), periodStartAgeInMonths: 396 });
  const hypothetical = node({ description: "这10万元意味着你可以提前还清计划中的个人债务。", descriptionParagraphs: ["这10万元意味着你可以提前还清计划中的个人债务。"] });
  assert.equal(collectDebtNarrativeSurfaceIssues({ node: hypothetical, authority }).some((issue) => issue.reasonCode === "UNACCEPTED_DEBT_COMPLETION"), false);
});

test("PB-NARR-11 arrears catch-up requires an accepted principal repayment event", () => {
  const authority = deriveDebtNarrativeAuthority({ ledger: debtLedger(), debtHealthState: debtHealth(), periodStartAgeInMonths: 396 });
  const unsafe = node({
    description: "你恢复了每月房贷，并补上了上月欠款。",
    descriptionParagraphs: ["你恢复了每月房贷，并补上了上月欠款。"]
  });
  const issues = collectDebtNarrativeSurfaceIssues({ node: unsafe, authority });
  assert.equal(issues.some((issue) => issue.reasonCode === "UNACCEPTED_ARREARS_CATCHUP"), true);
  const repaired = repairDebtNarrativeSurfaces({ node: unsafe, authority, issues });
  assert.doesNotMatch(repaired.description, /补上|补齐/u);
  assert.match(repaired.description, /仍按账本继续处理/u);
  const mortgageGap = node({
    description: "你用其中2.6万元补上了最近四个月的房贷差额，并恢复当月还款。",
    descriptionParagraphs: ["你用其中2.6万元补上了最近四个月的房贷差额，并恢复当月还款。"]
  });
  assert.equal(
    collectDebtNarrativeSurfaceIssues({ node: mortgageGap, authority }).some((issue) => issue.reasonCode === "UNACCEPTED_ARREARS_CATCHUP"),
    true
  );
});

test("PB-NARR-12 exact mortgage balance is checked against total closing debt", () => {
  const authority = deriveDebtNarrativeAuthority({ ledger: debtLedger(), debtHealthState: debtHealth(), periodStartAgeInMonths: 396 });
  const unsafe = node({
    description: "房贷余额降至195万元，你继续按月偿还。",
    descriptionParagraphs: ["房贷余额降至195万元，你继续按月偿还。"]
  });
  const issues = collectDebtNarrativeSurfaceIssues({ node: unsafe, authority });
  assert.equal(issues.some((issue) => issue.reasonCode === "MISMATCHED_DEBT_AMOUNT"), true);
  const repaired = repairDebtNarrativeSurfaces({ node: unsafe, authority, issues });
  assert.doesNotMatch(repaired.description, /195/u);
  assert.match(repaired.description, /20\.5万元/u);
  const remaining = node({
    description: "房贷还剩190万元，你继续按月偿还。",
    descriptionParagraphs: ["房贷还剩190万元，你继续按月偿还。"]
  });
  assert.equal(
    collectDebtNarrativeSurfaceIssues({ node: remaining, authority }).some((issue) => issue.reasonCode === "MISMATCHED_DEBT_AMOUNT"),
    true
  );
  const remainingBeforePrincipal = node({
    description: "房贷还有190万元本金，你继续按月偿还。",
    descriptionParagraphs: ["房贷还有190万元本金，你继续按月偿还。"]
  });
  assert.equal(
    collectDebtNarrativeSurfaceIssues({ node: remainingBeforePrincipal, authority }).some((issue) => issue.reasonCode === "MISMATCHED_DEBT_AMOUNT"),
    true
  );
});

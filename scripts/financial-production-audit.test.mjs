import assert from "node:assert/strict";
import test from "node:test";
import {
  auditFinancialProductionRecords,
  containsPersonalHoldingClaim,
  collectFinalReportFinancialConflicts,
  extractFinancialNarrativeAuditMeta,
  extractPersonalMonthlyIncomeWan
} from "./lib/financial-production-audit.mjs";

function ledger({ debt = 0, assets = [], evidence = [{ source: "system_policy", reasonCode: "LEGACY_FINANCIAL_STATE_MIGRATION", confidence: 0.5 }] } = {}) {
  return {
    debtAccounts: debt > 0 ? [{
      id: "legacy_debt",
      type: "mortgage",
      principalWan: debt,
      accruedUnpaidInterestWan: 0,
      status: "active",
      evidence
    }] : [],
    assetAccounts: assets,
    recentTransactions: []
  };
}

function node({ title, ageInMonths, debt = 0, cash = 0, netWorth = cash - debt, description = "普通生活继续。", fallback = false, assets = [] }) {
  return {
    title,
    ageInMonths,
    description,
    financialLedger: ledger({ debt, assets }),
    financialState: { cashWan: cash, totalDebtWan: debt, netWorthWan: netWorth, propertyMarketValueWan: 0 },
    financialProcessingMeta: fallback ? {
      narrativeFallback: true,
      narrativeFallbackReasonCodes: ["FINANCIAL_COMPLETION_ROLLBACK"]
    } : { narrativeFallback: false }
  };
}

const educationHistory = [
  node({ title: "起点", ageInMonths: 300, debt: 0, cash: 20 }),
  node({ title: "新的节奏", ageInMonths: 499, debt: 8.54, cash: 0, fallback: true, description: "本期末个人总负债为8.54万元。本期账本没有记录未足额偿付。现有还款仍按账本记录执行。" }),
  node({ title: "认证与深耕", ageInMonths: 548, debt: 8.54, cash: 50, fallback: true, description: "当前没有可由权威账本确认的债务完成事实。" }),
  node({ title: "职业跃迁", ageInMonths: 566, debt: 8.54, cash: 143.66, fallback: true, description: "现有还款仍按账本记录执行，下一步需要继续核对现金缓冲和未来到期安排。" })
];

const unsupportedProperty = {
  id: "legacy_property",
  type: "property",
  displayName: "系统估算房产",
  marketValueWan: 200,
  status: "active",
  factStatus: "estimated",
  evidence: [{ source: "system_policy", reasonCode: "LEGACY_FINANCIAL_STATE_MIGRATION", confidence: 0.5 }]
};

const invalidProperty = {
  id: "suburban_house",
  type: "real_estate",
  displayName: "郊区平房",
  marketValueWan: 80,
  status: "active",
  factStatus: "estimated",
  evidence: []
};

const records = [{
  caseSlug: "real-education-second",
  finalState: {
    history: educationHistory,
    outcome: {
      share: { viralTitle: "我终于还清了所有债务" },
      report: { finalLifeReading: { paragraphs: ["你已经无债一身轻。"] } }
    }
  }
}, {
  caseSlug: "real-relationship-first",
  finalState: {
    history: [
      node({ title: "开局", ageInMonths: 360, debt: 120, cash: 20, netWorth: 100, assets: [unsupportedProperty] }),
      node({ title: "房贷落地", ageInMonths: 603, debt: 0, cash: 607.1, netWorth: 807.1, assets: [unsupportedProperty], fallback: true, description: "当前没有可由权威账本确认的债务完成事实。" })
    ],
    outcome: { share: { viralTitle: "我卖掉了自己的房屋" }, report: {} }
  }
}, {
  caseSlug: "real-balance-second",
  finalState: {
    history: [node({ title: "换房", ageInMonths: 768, cash: 444.7, netWorth: 524.7, assets: [invalidProperty], description: "你卖掉城市公寓，买下郊区平房。" })],
    outcome: { share: { viralTitle: "我的新生活" }, report: {} }
  }
}];

test("PB-AUDIT-01 known-bad fixture reports the four real fallback chapters", () => {
  const audit = auditFinancialProductionRecords(records);
  assert.equal(audit.summary.narrativeFallbackNodeCount, 4);
  assert.equal(audit.summary.narrativeFallbackCaseCount, 2);
  assert.equal(audit.summary.fallbackWithoutRepairRecordCount, 4);
  assert.equal(audit.summary.userVisibleInternalLedgerTextCount, 4);
});

test("PB-AUDIT-02 extractor reads financialProcessingMeta and ignores narrativeMeta lookalikes", () => {
  assert.deepEqual(extractFinancialNarrativeAuditMeta({
    narrativeMeta: { narrativeFallback: true },
    financialProcessingMeta: { narrativeFallback: false }
  }), {
    narrativeFallback: false,
    fallbackReasonCodes: [],
    repairAttempts: 0,
    repairSucceeded: false,
    fallbackSurfacePaths: []
  });
});

test("PB-AUDIT-03 terminal debt completion language conflicts with authoritative debt", () => {
  const conflicts = collectFinalReportFinancialConflicts(records[0]);
  assert.equal(conflicts.some((item) => item.code === "REPORT_DEBT_COMPLETION_CONFLICT"), true);
});

test("PB-AUDIT-04 invalid asset type exposes ledger-summary mismatch", () => {
  const audit = auditFinancialProductionRecords(records);
  assert.equal(audit.summary.assetSummaryMismatchNodeCount >= 1, true);
});

test("PB-AUDIT-05 unsupported legacy opening assets and debts are not counted as user facts", () => {
  const audit = auditFinancialProductionRecords(records);
  assert.equal(audit.summary.fabricatedOpeningAccountCount >= 2, true);
});

test("PB-AUDIT-06 unexplained debt increase is reported instead of treated as narrative coverage", () => {
  const audit = auditFinancialProductionRecords(records);
  assert.equal(audit.summary.unexplainedDebtDeltaNodeCount >= 1, true);
});

test("PB-AUDIT-07 production debt gates detect conservation, frozen recovery, interest, and unsupported completion failures", () => {
  const bad = node({ title: "错误偿债", ageInMonths: 312, debt: 5, cash: 10, description: "你终于还清了全部债务。" });
  bad.financialLedger.cashAccounts = [{ id: "cash", status: "active", balanceWan: 10 }];
  bad.financialLedger.expenseCommitments = [{ id: "living", status: "active", activeFromAgeInMonths: 300, monthlyAmountWan: 1 }];
  bad.financialLedger.debtAccounts[0].origin = "system_auto_shortfall";
  bad.financialLedger.debtAccounts[0].repaymentPolicy = { mode: "event_driven", annualInterestRate: 0.12 };
  bad.financialLedger.recentTransactions = [{
    id: "bad_tx", debtDeltaWan: 2, debtPrincipalDrawnWan: 1, debtPrincipalPaidWan: 0,
    debtPrincipalForgivenWan: 0, debtInterestAccruedWan: 0, debtInterestLiabilityPaidWan: 0,
    debtInterestForgivenWan: 0, automaticLiquidityShortfallRecoveryWan: 0
  }];
  const previous = structuredClone(bad);
  previous.ageInMonths = 300;
  previous.financialLedger.debtAccounts[0].principalWan = 4;
  const audit = auditFinancialProductionRecords([{ caseSlug: "bad-gates", finalState: { history: [previous, bad] } }]);
  assert.equal(audit.summary.debtConservationFailureCount > 0, true);
  assert.equal(audit.summary.autoShortfallFrozenAboveReserveNodeCount > 0, true);
  assert.equal(audit.summary.knownRateInterestOmissionNodeCount > 0, true);
  assert.equal(audit.summary.unsupportedRepaymentCompletionNodeCount > 0, true);
});

test("PB-AUDIT-08 placeholder, orphan amount, and long-float output are hard failures", () => {
  const audit = auditFinancialProductionRecords([{
    caseSlug: "bad-final-copy",
    finalState: {
      history: [node({ title: "终局", ageInMonths: 600 })],
      outcome: {
        share: { viralTitle: "我做到月入金额待账本确认，却仍有负债8…" },
        report: { finalLifeReading: { paragraphs: ["年薪54.9996万元起步。"] } }
      }
    }
  }]);
  assert.equal(audit.summary.userVisibleFinancialPlaceholderCount, 1);
  assert.equal(audit.summary.orphanFinancialAmountCount, 1);
  assert.equal(audit.summary.financialAmountPrecisionViolationCount, 1);
});

test("PB-AUDIT-09 cross-journey invitation and Arc entries cannot pass evidence audit", () => {
  const auditedNode = node({ title: "邀请", ageInMonths: 600 });
  auditedNode.worldStateSnapshot = { pressureArcs: [{ id: "new-arc" }] };
  const audit = auditFinancialProductionRecords([{
    caseSlug: "mixed-invitations",
    journeyId: "journey-new",
    interactionLog: [
      { type: "invitation_shown", journeyId: "journey-old", invitation: { id: "old-invitation", pressureArcId: "old-arc" } }
    ],
    finalState: {
      history: [auditedNode],
      invitations: [{ id: "new-invitation", pressureArcId: "new-arc", status: "accepted" }]
    }
  }]);
  assert.equal(audit.summary.crossJourneyInvitationEntryCount >= 3, true);
});

test("PB-AUDIT-10 company cash flow is not mistaken for personal monthly income", () => {
  assert.deepEqual(extractPersonalMonthlyIncomeWan("公司现金流缺口缩小到每月1.2万元，月支出降至4.8万元。"), []);
  assert.deepEqual(extractPersonalMonthlyIncomeWan("公司向你的个人账户每月支付4万元税后工资。"), [4]);
  assert.deepEqual(extractPersonalMonthlyIncomeWan("你从本月起每月向自己支付4.5万元税后工资。"), [4.5]);
  assert.deepEqual(extractPersonalMonthlyIncomeWan("你拿到一份offer，开出的税后月薪4.8万元，但还没有决定是否接受。"), []);
  assert.deepEqual(extractPersonalMonthlyIncomeWan("你已经正式入职，现在税后月薪4.8万元。"), [4.8]);
  assert.deepEqual(extractPersonalMonthlyIncomeWan("当月营收低于15万元时，你的工资降至2万元。"), []);
});

test("PB-AUDIT-11 partner and employee equity do not create a personal holding claim", () => {
  assert.equal(containsPersonalHoldingClaim("合伙人的股份从40%调整到35%，员工可获得5%的期权。"), false);
  assert.equal(containsPersonalHoldingClaim("你持股30%，并继续参与董事会。"), true);
  assert.equal(containsPersonalHoldingClaim("你的股权比例达到55%。"), true);
});

test("PB-AUDIT-12 a hypothetical future payoff is not reported as an unsupported completion", () => {
  const audit = auditFinancialProductionRecords([
    {
      caseSlug: "future-payoff",
      finalState: { history: [node({ title: "计划", ageInMonths: 500, debt: 20, description: "这10万元意味着你可以提前还清计划中的个人债务。" })] }
    },
    {
      caseSlug: "far-from-payoff",
      finalState: { history: [node({ title: "仍在负债", ageInMonths: 500, debt: 56.27, description: "你心里清楚，这离还清债务还差得很远。" })] }
    }
  ]);
  assert.equal(audit.summary.unsupportedRepaymentCompletionNodeCount, 0);
});

test("PB-AUDIT-13 a zero-debt state may describe a historically grounded payoff", () => {
  const audit = auditFinancialProductionRecords([{
    caseSlug: "historical-payoff",
    finalState: { history: [
      node({ title: "曾有债务", ageInMonths: 500, debt: 8.54, cash: 2 }),
      node({ title: "完成偿付", ageInMonths: 512, debt: 0, cash: 3, description: "债务归零后，你开始建立新的现金缓冲。" }),
      node({ title: "稳定生活", ageInMonths: 524, debt: 0, cash: 5, description: "债务归零后，你继续按月储蓄。" })
    ] }
  }]);
  assert.equal(audit.summary.unsupportedRepaymentCompletionNodeCount, 0);
});

test("PB-AUDIT-14 generation telemetry exposes visible pauses, unknown calls, and retry budget violations", () => {
  const audit = auditFinancialProductionRecords([{
    caseSlug: "generation-gate",
    finalState: {
      history: [node({ title: "节点", ageInMonths: 500 })],
      generationEvents: [{ type: "visible_pause", message: "生成暂停" }],
      generationCallTraces: [
        { transactionId: "tx-1", kind: "initial_generation", outcome: "succeeded" },
        { transactionId: "tx-1", kind: "candidate_patch", outcome: "succeeded" },
        { transactionId: "tx-1", kind: "candidate_patch", outcome: "failed" },
        { transactionId: "tx-2", kind: "unknown", outcome: "failed" }
      ]
    }
  }]);
  assert.equal(audit.summary.visibleGenerationPauseCount, 1);
  assert.equal(audit.summary.unclassifiedGenerationCallCount, 1);
  assert.equal(audit.summary.excessivePatchNodeCount, 1);
  assert.equal(audit.summary.completedGenerationNodeCount, 2);
});

test("PB-AUDIT-15 generation telemetry groups one node across transaction id changes", () => {
  const audit = auditFinancialProductionRecords([{
    caseSlug: "transaction-switch",
    finalState: {
      history: [node({ title: "节点", ageInMonths: 500 })],
      generationCallTraces: [
        { nodeIndex: 0, transactionId: "tx-initial", kind: "initial_generation", outcome: "succeeded" },
        { nodeIndex: 0, transactionId: "tx-retry", kind: "full_regeneration", outcome: "succeeded" }
      ]
    }
  }]);
  assert.equal(audit.summary.completedGenerationNodeCount, 1);
  assert.equal(audit.summary.singleFullGenerationNodeRate, 0);
});

test("PB-AUDIT-16 rejected financial completion cannot survive after a deterministic failed-attempt fallback", () => {
  const contradiction = node({
    title: "资金安排",
    ageInMonths: 500,
    fallback: true,
    description: "你尝试申请借款，但这次尚未形成已经到账的结果。这笔钱到账后，你暂时缓解了年底护工费和物业费的压力。"
  });
  const audit = auditFinancialProductionRecords([{
    caseSlug: "rejected-completion",
    finalState: { history: [contradiction] }
  }]);
  assert.equal(audit.summary.rejectedCompletionContradictionNodeCount, 1);
  assert.equal(audit.rejectedCompletionContradictionNodes[0].node, 1);

  const falseRelief = node({
    title: "协商未果却声称减压",
    ageInMonths: 512,
    fallback: true,
    description: "你已经尝试申请调整还款安排，但尚未形成生效协议。你松了一口气，虽然月供仍不轻松，但压力减轻了不少。"
  });
  const reliefAudit = auditFinancialProductionRecords([{
    caseSlug: "rejected-relief",
    finalState: { history: [falseRelief] }
  }]);
  assert.equal(reliefAudit.summary.rejectedCompletionContradictionNodeCount, 1);

  const delayedCompletion = node({
    title: "协商仍在推进",
    ageInMonths: 518,
    fallback: true,
    description: "你已经尝试申请调整还款安排，但尚未形成生效协议。你继续整理材料并等待回复。两个月后，你签了补充协议。"
  });
  const delayedCompletionAudit = auditFinancialProductionRecords([{
    caseSlug: "rejected-delayed-completion",
    finalState: { history: [delayedCompletion] }
  }]);
  assert.equal(delayedCompletionAudit.summary.rejectedCompletionContradictionNodeCount, 1);

  const rejectedCompensation = node({
    title: "融资交割与股权确认",
    ageInMonths: 520,
    fallback: true,
    description: "你已经尝试推进这项财务安排，但它暂时还没有形成确定结果。领投方资金到账。创始人补发了过去14个月的税后工资，并签署了5%的股权协议。"
  });
  const compensationAudit = auditFinancialProductionRecords([{
    caseSlug: "rejected-compensation",
    finalState: { history: [rejectedCompensation] }
  }]);
  assert.equal(compensationAudit.summary.rejectedCompletionContradictionNodeCount, 1);

  const delayedRestructureBenefit = node({
    title: "协商仍在审核",
    ageInMonths: 522,
    fallback: true,
    description: "你已经尝试申请调整还款安排，但尚未形成生效协议。你继续工作。你算了一下，每月多出来的4000元现金流能缓解压力。"
  });
  const delayedBenefitAudit = auditFinancialProductionRecords([{
    caseSlug: "rejected-delayed-benefit",
    finalState: { history: [delayedRestructureBenefit] }
  }]);
  assert.equal(delayedBenefitAudit.summary.rejectedCompletionContradictionNodeCount, 1);

  const shortRelief = node({
    title: "安排仍未落地",
    ageInMonths: 522,
    fallback: true,
    description: "你已经尝试推进这项财务安排，但它暂时还没有形成确定结果。你松了口气，但知道这只是把压力往后推。"
  });
  const shortReliefAudit = auditFinancialProductionRecords([{
    caseSlug: "rejected-short-relief",
    finalState: { history: [shortRelief] }
  }]);
  assert.equal(shortReliefAudit.summary.rejectedCompletionContradictionNodeCount, 1);

  const rejectedSideIncomeBenefit = node({
    title: "副业仍在验证",
    ageInMonths: 523,
    fallback: true,
    description: "这段时间的工作安排仍在继续，但实际到账的个人收入尚待确认。副业带来的收入暂时缓解了经济紧张。"
  });
  const sideIncomeAudit = auditFinancialProductionRecords([{
    caseSlug: "rejected-side-income-benefit",
    finalState: { history: [rejectedSideIncomeBenefit] }
  }]);
  assert.equal(sideIncomeAudit.summary.rejectedCompletionContradictionNodeCount, 1);

  const falseTitle = node({
    title: "债务重组与业务转机",
    ageInMonths: 524,
    fallback: true,
    description: "你已经尝试申请调整还款安排，但尚未形成生效协议。"
  });
  const titleAudit = auditFinancialProductionRecords([{
    caseSlug: "rejected-title",
    finalState: { history: [falseTitle] }
  }]);
  assert.equal(titleAudit.summary.rejectedCompletionContradictionNodeCount, 1);
});

test("PB-AUDIT-17 malformed transitions, duplicate choices, and repeated canonical copy are hard failures", () => {
  const malformed = node({
    title: "结构错误",
    ageInMonths: 500,
    description: "这段时间的工作安排仍在继续，但实际到账的个人收入尚待确认。这段时间的工作安排仍在继续，但实际到账的个人收入尚待确认。"
  });
  malformed.choices = [{ id: "B" }, { id: "C" }, { id: "C" }];
  malformed.narrativeMeta = {
    storyEpisode: {
      internalTransitions: ["前三个月适应新的节奏"]
    }
  };
  const audit = auditFinancialProductionRecords([{
    caseSlug: "malformed-history",
    finalState: { history: [malformed] }
  }]);
  assert.equal(audit.summary.invalidInternalTransitionNodeCount, 1);
  assert.equal(audit.summary.duplicateChoiceIdNodeCount, 1);
  assert.equal(audit.summary.duplicateCanonicalFallbackNodeCount, 1);
});

test("PB-AUDIT-18 financial narrative claims must remain valid and visible", () => {
  const invalid = node({
    title: "结构化财务事实失配",
    ageInMonths: 500,
    description: "你继续处理当前工作。"
  });
  invalid.financialNarrativeClaims = [{
    id: "claim_missing_surface",
    proposalId: "income_rejected",
    kind: "income_source_started",
    surfaceText: "每月新增0.5万元税后收入。"
  }];
  invalid.financialProcessingMeta = {
    proposalCount: 1,
    acceptedEventCount: 0,
    blockingIssueCount: 0,
    repairTriggered: false,
    repairLatencyMs: 0,
    totalProcessingLatencyMs: 0,
    financialNarrativeAuthorityVersion: "financial_narrative_claims_v1",
    invalidFinancialNarrativeClaimCount: 1
  };
  const audit = auditFinancialProductionRecords([{
    caseSlug: "invalid-financial-claim",
    finalState: { history: [invalid] }
  }]);
  assert.equal(audit.summary.invalidFinancialNarrativeClaimNodeCount, 1);
  assert.deepEqual(audit.invalidFinancialNarrativeClaimNodes[0].danglingClaimIds, ["claim_missing_surface"]);
});

test("PB-AUDIT-19 repeated rejected-debt fallback copy is a hard failure", () => {
  const sentence = "你尝试申请借款，但这次尚未形成已经到账的结果。";
  const repeated = node({
    title: "重复借款回退",
    ageInMonths: 500,
    description: `${sentence}你继续安排生活。${sentence}`
  });
  const audit = auditFinancialProductionRecords([{
    caseSlug: "repeated-debt-fallback",
    finalState: { history: [repeated] }
  }]);
  assert.equal(audit.summary.duplicateCanonicalFallbackNodeCount, 1);
});

test("PB-AUDIT-18 a same-journey shown and declined invitation is not cross-journey pollution", () => {
  const audit = auditFinancialProductionRecords([{
    caseSlug: "declined-invitation",
    journeyId: "journey-current",
    interactionLog: [
      { type: "invitation_shown", journeyId: "journey-current", invitation: { id: "invitation-1" } },
      { type: "invitation_declined", journeyId: "journey-current", invitation: { id: "invitation-1" } }
    ],
    finalState: {
      history: [node({ title: "节点", ageInMonths: 500 })],
      invitations: []
    }
  }]);
  assert.equal(audit.summary.crossJourneyInvitationEntryCount, 0);
});

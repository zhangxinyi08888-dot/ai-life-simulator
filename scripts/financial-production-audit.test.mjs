import assert from "node:assert/strict";
import test from "node:test";
import {
  auditFinancialProductionRecords,
  collectRestrictedProjectFundingInPersonalCash,
  collectRestrictedProjectFundingAttributionGaps,
  containsPersonalHoldingClaim,
  collectFinalReportFinancialConflicts,
  extractFinancialNarrativeAuditMeta,
  extractPersonalMonthlyIncomeWan
} from "./lib/financial-production-audit.mjs";

function ledger({
  debt = 0,
  debtStatus = "active",
  assets = [],
  evidence = [{ source: "system_policy", reasonCode: "LEGACY_FINANCIAL_STATE_MIGRATION", confidence: 0.5 }],
  recentTransactions = []
} = {}) {
  return {
    debtAccounts: debt > 0 ? [{
      id: "legacy_debt",
      type: "mortgage",
      principalWan: debtStatus === "repaid" ? 0 : debt,
      accruedUnpaidInterestWan: 0,
      status: debtStatus,
      evidence
    }] : [],
    assetAccounts: assets,
    recentTransactions
  };
}

function node({ title, ageInMonths, debt = 0, debtStatus = "active", cash = 0, netWorth = cash - debt, description = "普通生活继续。", fallback = false, assets = [], evidence, recentTransactions = [] }) {
  return {
    title,
    ageInMonths,
    description,
    financialLedger: ledger({ debt, debtStatus, assets, evidence, recentTransactions }),
    financialState: { cashWan: cash, totalDebtWan: debt, netWorthWan: netWorth, propertyMarketValueWan: 0 },
    financialProcessingMeta: fallback ? {
      narrativeFallback: true,
      narrativeFallbackReasonCodes: ["FINANCIAL_COMPLETION_ROLLBACK"]
    } : { narrativeFallback: false }
  };
}

function restrictedProjectFundingTransaction({
  id = "restricted_project_fund_tx",
  evidenceExcerpt = "你申请到一笔10万元的项目基金，用于为5所村小提供硬件和教师津贴",
  incomeWan = 10,
  cashDeltaWan = 10,
  financialScope = "personal",
  eventKind = "one_off_income_received"
} = {}) {
  const evidence = {
    source: "accepted_simulation_outcome",
    sourceEventId: "accepted_grant_received",
    excerpt: evidenceExcerpt,
    financialScope
  };
  return {
    id,
    simulationTransactionId: id.replace(/^financial_/u, ""),
    eventIds: ["accepted_grant_received"],
    incomeWan,
    cashDeltaWan,
    evidence: [evidence],
    acceptedEventAudit: [{
      eventId: "accepted_grant_received",
      kind: eventKind,
      evidence: [evidence]
    }]
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
  const audit = auditFinancialProductionRecords([{
    caseSlug: "future-payoff",
    finalState: { history: [node({ title: "计划", ageInMonths: 500, debt: 20, description: "这10万元意味着你可以提前还清计划中的个人债务。" })] }
  }]);
  assert.equal(audit.summary.unsupportedRepaymentCompletionNodeCount, 0);
});

test("PB-AUDIT-13 a zero-debt state may describe a historically grounded payoff", () => {
  const acceptedRepayment = {
    id: "accepted_repayment_tx", debtPrincipalPaidWan: 8.54, debtPrincipalForgivenWan: 0,
    debtInterestLiabilityPaidWan: 0, debtInterestForgivenWan: 0, automaticLiquidityShortfallRecoveryWan: 0
  };
  const audit = auditFinancialProductionRecords([{
    caseSlug: "historical-payoff",
    finalState: { history: [
      node({ title: "曾有债务", ageInMonths: 500, debt: 8.54, cash: 2 }),
      node({
        title: "完成偿付", ageInMonths: 512, debt: 8.54, debtStatus: "repaid", cash: 3,
        evidence: [{ source: "accepted_history", reasonCode: "DEBT_REPAYMENT", confidence: 1 }],
        recentTransactions: [acceptedRepayment],
        description: "债务归零后，你开始建立新的现金缓冲。"
      }),
      node({
        title: "稳定生活", ageInMonths: 524, debt: 8.54, debtStatus: "repaid", cash: 5,
        evidence: [{ source: "accepted_history", reasonCode: "DEBT_REPAYMENT", confidence: 1 }],
        recentTransactions: [acceptedRepayment],
        description: "债务归零后，你继续按月储蓄。"
      })
    ] }
  }]);
  assert.equal(audit.summary.unsupportedRepaymentCompletionNodeCount, 0);
});

test("PB-AUDIT-14 an opening backstory payoff is not treated as a current ledger completion", () => {
  const audit = auditFinancialProductionRecords([{
    caseSlug: "opening-backstory-payoff",
    finalState: {
      history: [node({
        title: "开局", ageInMonths: 288, debt: 0, cash: 18,
        description: "你刚攒下十八万，还清了信用卡分期，手头略有积蓄。"
      })]
    }
  }]);
  assert.equal(audit.summary.unsupportedRepaymentCompletionNodeCount, 0);
});

test("PB-AUDIT-15 zero terminal debt without a ledger settlement cannot support report payoff copy", () => {
  const audit = auditFinancialProductionRecords([{
    caseSlug: "unsupported-terminal-payoff",
    finalState: {
      history: [
        node({ title: "曾有债务", ageInMonths: 500, debt: 8.54, cash: 2 }),
        node({
          title: "账面归零", ageInMonths: 512, debt: 8.54, debtStatus: "repaid", cash: 3,
          evidence: [{ source: "accepted_history", reasonCode: "UNVERIFIED_STATUS", confidence: 1 }]
        })
      ],
      outcome: { share: { viralTitle: "我终于还清了全部债务" }, report: {} }
    }
  }]);
  assert.equal(audit.summary.finalReportFinancialConflictCount, 1);
});

test("PB-AUDIT-16 a settlement for one account cannot authorize a payoff claim for an unproved second account", () => {
  const acceptedRepayment = {
    id: "accepted_repayment_tx", debtPrincipalPaidWan: 8.54, debtPrincipalForgivenWan: 0,
    debtInterestLiabilityPaidWan: 0, debtInterestForgivenWan: 0, automaticLiquidityShortfallRecoveryWan: 0
  };
  const settled = node({
    title: "一笔偿付完成", ageInMonths: 512, debt: 8.54, debtStatus: "repaid", cash: 3,
    evidence: [{ source: "accepted_history", reasonCode: "DEBT_REPAYMENT", confidence: 1 }],
    recentTransactions: [acceptedRepayment]
  });
  settled.financialLedger.debtAccounts.push({
    id: "unproved_debt", type: "consumer_loan", principalWan: 0, accruedUnpaidInterestWan: 0, status: "repaid",
    evidence: [{ source: "accepted_history", reasonCode: "UNVERIFIED_STATUS", confidence: 1 }]
  });
  const audit = auditFinancialProductionRecords([{
    caseSlug: "partially-proved-terminal-payoff",
    finalState: {
      history: [node({ title: "曾有债务", ageInMonths: 500, debt: 8.54, cash: 2 }), settled],
      outcome: { share: { viralTitle: "我终于还清了全部债务" }, report: {} }
    }
  }]);
  assert.equal(audit.summary.finalReportFinancialConflictCount, 1);
});

test("PB-AUDIT-17 restricted project funding in personal cash is transaction-deduplicated and excludes a freely disposable personal award", () => {
  const restricted = restrictedProjectFundingTransaction();
  const repeatedSnapshots = [
    node({ title: "基金到账", ageInMonths: 416, cash: 30, recentTransactions: [restricted] }),
    node({ title: "后续生活", ageInMonths: 428, cash: 32, recentTransactions: [restricted] })
  ];
  const restrictedAudit = auditFinancialProductionRecords([{
    caseSlug: "restricted-funding",
    finalState: { history: repeatedSnapshots }
  }]);
  assert.equal(collectRestrictedProjectFundingInPersonalCash([{
    caseSlug: "restricted-funding",
    finalState: { history: repeatedSnapshots }
  }]).length, 1);
  assert.equal(restrictedAudit.summary.restrictedProjectFundingInPersonalCashCount, 1);
  assert.equal(restrictedAudit.restrictedProjectFundingInPersonalCash[0].transactionId, "restricted_project_fund_tx");

  const businessScopedGrant = restrictedProjectFundingTransaction({
    id: "business_scoped_but_personal_cash_tx",
    financialScope: "business_operating"
  });
  const businessScopedAudit = auditFinancialProductionRecords([{
    caseSlug: "business-scoped-grant-still-personal-cash",
    finalState: { history: [node({ title: "错误记入个人现金", ageInMonths: 417, cash: 40, recentTransactions: [businessScopedGrant] })] }
  }]);
  assert.equal(
    businessScopedAudit.summary.restrictedProjectFundingInPersonalCashCount,
    1,
    "a business evidence tag cannot exempt an event kind that credited the personal ledger"
  );

  const restrictedDistribution = restrictedProjectFundingTransaction({
    id: "restricted_project_distribution_tx",
    eventKind: "business_distribution_received"
  });
  const distributionAudit = auditFinancialProductionRecords([{
    caseSlug: "restricted-distribution",
    finalState: { history: [node({ title: "错误分配项目款", ageInMonths: 418, cash: 50, recentTransactions: [restrictedDistribution] })] }
  }]);
  assert.equal(distributionAudit.summary.restrictedProjectFundingInPersonalCashCount, 1);

  const freelyDisposableAward = restrictedProjectFundingTransaction({
    id: "freely_disposable_award_tx",
    evidenceExcerpt: "你从乡村教育项目资助中获得10万元个人自由支配奖金，不限定用于学校、教师或硬件。"
  });
  const awardAudit = auditFinancialProductionRecords([{
    caseSlug: "freely-disposable-award",
    finalState: { history: [node({ title: "个人奖励", ageInMonths: 416, cash: 30, recentTransactions: [freelyDisposableAward] })] }
  }]);
  assert.equal(awardAudit.summary.restrictedProjectFundingInPersonalCashCount, 0);
});

test("PB-AUDIT-18 event-level audit keeps a non-cash organisation grant separate from same-period personal salary", () => {
  const restrictedOrganisationEvidence = {
    source: "accepted_simulation_outcome",
    sourceEventId: "organisation_grant",
    excerpt: "公益基金10万元专款用于为村小提供硬件和教师津贴。",
    financialScope: "business_operating"
  };
  const personalSalaryEvidence = {
    source: "accepted_simulation_outcome",
    sourceEventId: "personal_salary",
    excerpt: "你继续在原公司工作，年税后收入稳定在32万元。",
    financialScope: "personal"
  };
  const mixedTransaction = {
    id: "mixed_grant_and_salary",
    simulationTransactionId: "mixed_grant_and_salary",
    eventIds: ["organisation_grant", "personal_salary"],
    incomeWan: 2,
    cashDeltaWan: 2,
    evidence: [restrictedOrganisationEvidence, personalSalaryEvidence],
    acceptedEventAudit: [
      { eventId: "organisation_grant", kind: "business_financing_recorded", evidence: [restrictedOrganisationEvidence] },
      { eventId: "personal_salary", kind: "income_source_adjusted", evidence: [personalSalaryEvidence] }
    ]
  };
  const audit = auditFinancialProductionRecords([{
    caseSlug: "mixed-grant-and-salary",
    finalState: { history: [node({ title: "混合期间", ageInMonths: 416, cash: 30, recentTransactions: [mixedTransaction] })] }
  }]);
  assert.equal(audit.summary.restrictedProjectFundingInPersonalCashCount, 0);
  assert.equal(audit.summary.restrictedProjectFundingAttributionGapCount, 0);

  const legacyMixedTransaction = { ...mixedTransaction };
  delete legacyMixedTransaction.acceptedEventAudit;
  const legacyAudit = auditFinancialProductionRecords([{
    caseSlug: "legacy-mixed-grant-and-salary",
    finalState: { history: [node({ title: "旧快照混合期间", ageInMonths: 416, cash: 30, recentTransactions: [legacyMixedTransaction] })] }
  }]);
  assert.equal(legacyAudit.summary.restrictedProjectFundingInPersonalCashCount, 0, "unattributed legacy aggregate must not assert a personal-cash violation");
  assert.equal(collectRestrictedProjectFundingAttributionGaps([{
    caseSlug: "legacy-mixed-grant-and-salary",
    finalState: { history: [node({ title: "旧快照混合期间", ageInMonths: 416, cash: 30, recentTransactions: [legacyMixedTransaction] })] }
  }]).length, 1);
  assert.equal(legacyAudit.summary.restrictedProjectFundingAttributionGapCount, 1, "missing event attribution is a distinct release-proof failure");
});

test("PB-AUDIT-19 a personal commercial project payment is not a restricted public fund", () => {
  const personalProjectPayment = restrictedProjectFundingTransaction({
    id: "personal_consulting_project_payment",
    evidenceExcerpt: "你收到10万元个人咨询项目款，作为本次软件开发服务的个人报酬，专门用于后续项目执行。"
  });
  const audit = auditFinancialProductionRecords([{
    caseSlug: "personal-commercial-project-payment",
    finalState: { history: [node({ title: "咨询项目回款", ageInMonths: 416, cash: 30, recentTransactions: [personalProjectPayment] })] }
  }]);
  assert.equal(audit.summary.restrictedProjectFundingInPersonalCashCount, 0);
  assert.equal(audit.summary.restrictedProjectFundingAttributionGapCount, 0);
});

test("PB-AUDIT-20 a public project execution earmark remains a restricted personal-cash violation", () => {
  const publicProjectFund = restrictedProjectFundingTransaction({
    id: "public_project_execution_fund",
    evidenceExcerpt: "你收到10万元公益项目款，仅限用于项目执行。"
  });
  const audit = auditFinancialProductionRecords([{
    caseSlug: "public-project-execution-fund",
    finalState: { history: [node({ title: "公益项目执行", ageInMonths: 416, cash: 30, recentTransactions: [publicProjectFund] })] }
  }]);
  assert.equal(audit.summary.restrictedProjectFundingInPersonalCashCount, 1);
});

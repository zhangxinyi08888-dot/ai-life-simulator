import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { createRealBrowserJourneyRunner } from "./real-browser-journey-runner.mjs";

const AGE_IN_MONTHS = 480;
const evidence = [{ source: "accepted_history", reasonCode: "BROWSER_ROUTE_SEED", confidence: 1 }];

const baseUserData = {
  birthday: "1986-03-18",
  birthtime: "09:00",
  gender: "女",
  currentSituation: "家庭现金流承压，希望处理个人债务",
  isReturnToPast: true,
  targetAgeNode: "债务压力出现",
  regressionNodeKey: "wealth",
  regressionAge: 40,
  regressionSituation: "收入与必要生活支出变化后，需要重新安排长期债务",
  regressionChoices: "不借新债还旧债，优先保障生活并诚实处理逾期",
  coreStoryFocus: "wealth"
};

function debtAccount(overrides = {}) {
  return {
    id: "mortgage_1",
    type: "mortgage",
    displayName: "住房贷款",
    principalWan: 60,
    accruedUnpaidInterestWan: 0,
    openedAtAgeInMonths: 300,
    status: "active",
    origin: "explicit",
    repaymentPolicy: { mode: "known_schedule", monthlyPrincipalWan: 0.5, monthlyInterestWan: 0.2, remainingTermMonths: 120 },
    factStatus: "known",
    servicingStatus: "current",
    consecutiveMissedPaymentMonths: 0,
    totalMissedPaymentMonths: 0,
    recentMissedPaymentAgeInMonths: [],
    evidence,
    ...overrides
  };
}

function ledger({ cashWan, monthlyIncomeWan, monthlyExpenseWan, debt, issues = [], recentTransactions = [] }) {
  return {
    id: "ledger_debt_browser_route",
    version: 3,
    revision: 8,
    owner: "protagonist",
    currencyUnit: "CNY_WAN_REAL",
    asOfAgeInMonths: AGE_IN_MONTHS,
    cashAccounts: [{ id: "primary_cash", type: "bank_deposit", balanceWan: cashWan, status: "active", factStatus: "known", evidence }],
    assetAccounts: [{ id: "home", type: "property", displayName: "自住房", marketValueWan: 120, liquidity: "illiquid", status: "active", factStatus: "known", openedAtAgeInMonths: 300, evidence }],
    debtAccounts: [debt],
    incomeSources: monthlyIncomeWan > 0 ? [{ id: "salary", type: "salary", displayName: "工资", monthlyNetAmountWan: monthlyIncomeWan, accrualPolicy: "monthly", activeFromAgeInMonths: 360, status: "active", linkedCareerStateId: "career_employed", factStatus: "known", evidence }] : [],
    expenseCommitments: [{ id: "living", type: "basic_living", displayName: "家庭基本生活", monthlyAmountWan: monthlyExpenseWan, activeFromAgeInMonths: 360, status: "active", factStatus: "known", evidence }],
    businessHoldings: [],
    recentTransactions,
    committedTransactionIds: [],
    unresolvedIssues: issues
  };
}

function financialState({ cashWan, debtWan, monthlyIncomeWan, monthlyExpenseWan }) {
  return {
    currencyUnit: "CNY_WAN_REAL",
    asOfAgeInMonths: AGE_IN_MONTHS,
    cashWan,
    investmentAssetsWan: 0,
    propertyMarketValueWan: 120,
    businessAndOtherAssetsWan: 0,
    totalDebtWan: debtWan,
    netWorthWan: 120 + cashWan - debtWan,
    annualAfterTaxIncomeWan: monthlyIncomeWan * 12,
    annualDisposableIncomeWan: (monthlyIncomeWan - monthlyExpenseWan) * 12,
    annualCoreExpenseWan: monthlyExpenseWan * 12,
    employmentStatus: monthlyIncomeWan > 0 ? "employed" : "not_working",
    incomeStability: monthlyIncomeWan > 0 ? "stable" : "unstable",
    isEstimated: false
  };
}

function debtHealth(overrides) {
  return {
    asOfAgeInMonths: AGE_IN_MONTHS,
    level: "manageable",
    trend: "stable",
    totalDebtWan: 60,
    scheduledDebtServiceNext12MonthsWan: 8.4,
    availableCashForDebtNext12MonthsWan: 34.4,
    debtServiceCoverageRatio: 4.0952,
    cashBufferMonths: 25,
    liquidityShortfallDebtWan: 0,
    consecutiveMissedPaymentMonths: 0,
    missedPaymentMonthsLast12: 0,
    activeDefaultedDebtCount: 0,
    reasonCodes: ["PAYMENTS_CURRENT"],
    source: "authoritative_ledger",
    sourceLedgerRevision: 8,
    latestDebtServiceHasUnpaidAmount: false,
    hasOpenDelinquentIssue: false,
    ...overrides
  };
}

function worldState({ debtArc, foreground = true, employmentStatus = "employed" } = {}) {
  const pressureArcs = debtArc ? [debtArc] : [];
  return {
    people: [],
    directionArcs: [],
    pressureArcs,
    foregroundPressureArcId: debtArc && foreground ? debtArc.id : undefined,
    currentEmploymentStatus: employmentStatus,
    careerStates: [{ id: "career_employed", employmentStatus, activeProjectIds: [], effectiveFromAgeInMonths: 360, confidence: 1, source: "accepted_history" }],
    currentCareerStateId: "career_employed",
    careerRevision: 1,
    committedTransactionIds: [],
    version: 2
  };
}

function currentNode({ slug, title, description, attributes, ledgerValue, state, world, choice }) {
  const health = slug === "manageable-mortgage"
    ? debtHealth({})
    : slug === "distress-to-default-risk"
      ? debtHealth({ level: "distressed", trend: "worsening", availableCashForDebtNext12MonthsWan: 0, debtServiceCoverageRatio: 0, cashBufferMonths: 0.1667, consecutiveMissedPaymentMonths: 1, missedPaymentMonthsLast12: 1, reasonCodes: ["RECENT_PARTIAL_PAYMENT", "LOW_DEBT_SERVICE_COVERAGE"], latestDebtServiceHasUnpaidAmount: true })
      : debtHealth({ level: "default_risk", trend: "worsening", availableCashForDebtNext12MonthsWan: 0, debtServiceCoverageRatio: 0, cashBufferMonths: 0.1667, consecutiveMissedPaymentMonths: 2, missedPaymentMonthsLast12: 2, reasonCodes: ["CONSECUTIVE_MISSED_PAYMENTS"], latestDebtServiceHasUnpaidAmount: true, hasOpenDelinquentIssue: true });
  return {
    age: 40,
    ageInMonths: AGE_IN_MONTHS,
    stage: "中年现实",
    title,
    description,
    choices: [{ id: choice.id, text: choice.text, impactSummary: choice.impactSummary, decisionIntent: choice.decisionIntent, expectedWorldDeltaTypes: ["career_state"] }],
    attributes,
    financialLedger: ledgerValue,
    financialLedgerMode: "authoritative",
    financialState: state,
    debtHealthState: health,
    isEndingNode: false,
    eventMeta: { eventId: `debt_route_seed_${slug}`, eventCategory: "financial", eventTags: ["financial"], eventIntensity: "minor", eventMode: "stability_meaning", eventSemanticFamily: "financial_debt_seed" },
    worldStateSnapshot: world
  };
}

const currentDebtArc = {
  id: "debt_arc_browser",
  eventId: "financial_payment_strain",
  eventIntentType: "financial_payment_strain",
  phasePolicyId: "financial_debt_v1",
  phaseId: "response",
  status: "active",
  startedAtAgeInMonths: 474,
  phaseStartedAtAgeInMonths: 477,
  phaseCheckpointCount: 1,
  totalCheckpointCount: 2,
  unresolvedSummary: "连续两个月无法覆盖计划还款"
};

export const DEBT_REAL_BROWSER_CASES = [
  {
    slug: "manageable-mortgage",
    scenario: "manageable_debt_no_false_crisis",
    description: "正常房贷有充足偿付能力，不应误触发债务压力或债务 Arc。",
    steps: [{ type: "choice", value: "keep_schedule" }],
    seed: {
      attributes: { happiness: 58, intelligence: 65, wealth: 62, relation: 60, health: 68 },
      cashWan: 20, monthlyIncomeWan: 2.5, monthlyExpenseWan: 0.8,
      debt: debtAccount(), world: worldState(),
      choice: { id: "keep_schedule", text: "继续按期还款并保留应急金", impactSummary: "维持可持续偿债", decisionIntent: "finance:maintain_sustainable_debt_service" }
    }
  },
  {
    slug: "distress-to-default-risk",
    scenario: "persistent_shortfall_escalates",
    description: "首次部分还款后仍无可用现金，下一期应形成真实 missed，再由确定性事件进入债务压力线。",
    steps: [{ type: "choice", value: "protect_essentials" }, { type: "custom", value: "继续优先保障基本生活，承认本月仍无力偿债，记录未支付款项，不借新债偿还旧债。" }],
    seed: {
      attributes: { happiness: 38, intelligence: 63, wealth: 28, relation: 52, health: 55 },
      cashWan: 0.2, monthlyIncomeWan: 0, monthlyExpenseWan: 1.2,
      debt: debtAccount({ servicingStatus: "partial", consecutiveMissedPaymentMonths: 1, totalMissedPaymentMonths: 1, recentMissedPaymentAgeInMonths: [480], lastMissedPaymentAtAgeInMonths: 480 }),
      world: worldState({ employmentStatus: "not_working" }),
      choice: { id: "protect_essentials", text: "优先保障基本生活并如实记录未付债务", impactSummary: "不再以债养债", decisionIntent: "finance:protect_essentials_record_missed_payment" }
    }
  },
  {
    slug: "debt-arc-health-preemption",
    scenario: "acute_health_preempts_debt_arc",
    description: "债务 Arc 进行中发生急性健康危机，健康线应成为唯一前台，债务线暂停而不丢失。",
    steps: [{ type: "choice", value: "seek_health_support" }],
    seed: {
      attributes: { happiness: 32, intelligence: 62, wealth: 27, relation: 48, health: 28 },
      cashWan: 0.2, monthlyIncomeWan: 0, monthlyExpenseWan: 1.2,
      debt: debtAccount({ servicingStatus: "delinquent", consecutiveMissedPaymentMonths: 2, totalMissedPaymentMonths: 2, recentMissedPaymentAgeInMonths: [479, 480], lastMissedPaymentAtAgeInMonths: 480 }),
      world: worldState({ debtArc: currentDebtArc, employmentStatus: "not_working" }),
      choice: { id: "seek_health_support", text: "先接受急性健康支持，同时保留债务协商记录", impactSummary: "健康优先，债务暂停", decisionIntent: "health:seek_acute_support" }
    }
  }
];

export function createDebtBrowserCheckpoint(slug) {
  const config = DEBT_REAL_BROWSER_CASES.find((item) => item.slug === slug);
  if (!config) throw new Error(`Unknown debt browser route: ${slug}`);
  const { seed } = config;
  const ledgerValue = ledger(seed);
  const state = financialState({ cashWan: seed.cashWan, debtWan: seed.debt.principalWan + (seed.debt.accruedUnpaidInterestWan || 0), monthlyIncomeWan: seed.monthlyIncomeWan, monthlyExpenseWan: seed.monthlyExpenseWan });
  const node = currentNode({ slug: config.slug, title: config.slug === "manageable-mortgage" ? "按计划偿还的房贷" : config.slug === "distress-to-default-risk" ? "第一次没有还足" : "债务压力中的健康警报", description: config.description, attributes: seed.attributes, ledgerValue, state, world: seed.world, choice: seed.choice });
  const userData = {
    ...baseUserData,
    currentSituation: config.description,
    regressionSituation: config.description,
    regressionChoices: seed.choice.text
  };
  return { step: "simulating", userName: "负债路线测试者", userData, questions: [], answers: [], history: [], currentNode: node, currentAttributes: seed.attributes, nodeCount: 1, simulationSeed: `real-debt-${config.slug}-2026-07-19`, outcome: null };
}

function validate(config, state) {
  const nodes = [...(state.history || []), state.currentNode].filter(Boolean);
  const eventIds = nodes.map((node) => node.eventMeta?.eventId).filter(Boolean);
  const debtLevels = nodes.map((node) => node.debtHealthState?.level).filter(Boolean);
  const arcs = state.currentNode?.worldStateSnapshot?.pressureArcs || [];
  const foregroundId = state.currentNode?.worldStateSnapshot?.foregroundPressureArcId;
  const debtArc = arcs.find((arc) => arc.phasePolicyId === "financial_debt_v1");
  const healthArc = arcs.find((arc) => arc.phasePolicyId === "health_crisis_v1");
  const common = {
    realAiBrowserSource: state.testDataSource === "real_ai_browser" && !state.e2eCase,
    completeLedgerSnapshots: nodes.every((node) => node.financialLedger?.version === 3 && node.financialLedgerMode === "authoritative"),
    debtHealthSnapshotsPresent: nodes.every((node) => node.debtHealthState?.source === "authoritative_ledger"),
    noGenerationError: !state.errorMsg && !state.nextGenerationError
  };
  if (config.slug === "manageable-mortgage") return { ...common, stayedSustainable: debtLevels.every((level) => ["manageable", "watch"].includes(level)), noDebtCrisisEvent: !eventIds.includes("financial_payment_strain"), noDebtArc: !debtArc };
  if (config.slug === "distress-to-default-risk") return {
    ...common,
    recordedDefaultRisk: debtLevels.some((level) => ["default_risk", "defaulted"].includes(level)),
    paymentStrainTriggered: eventIds.includes("financial_payment_strain"),
    debtArcCreated: Boolean(debtArc),
    oneAutomaticShortfallAccount: (state.currentNode?.financialLedger?.debtAccounts || [])
      .filter((debt) => debt.origin === "system_auto_shortfall" && debt.status === "active").length === 1,
    noDebtServiceShortfallBorrowing: nodes.every((node) => (node.financialLedger?.recentTransactions || [])
      .flatMap((tx) => tx.debtServiceRecords || [])
      .filter((record) => record.outcome !== "paid")
      .every((record) => record.interestPaidWan === 0 && record.principalPaidWan === 0)),
    narrativeUsesCommittedDebtFacts: !/罚息|复利|彻底失败|人生失败|连续(?:\d+|[零一二两三四五六七八九十百]+)个?月(?:未还|逾期|拖欠)/u.test(state.currentNode?.description || "")
  };
  return {
    ...common,
    healthPressureTriggered: eventIds.includes("health_forced_pause"),
    debtArcSuspended: debtArc?.status === "suspended",
    debtCheckpointPreserved: debtArc?.phaseId === "response" && debtArc?.phaseCheckpointCount === 1 && debtArc?.totalCheckpointCount === 2,
    healthArcForeground: Boolean(healthArc && foregroundId === healthArc.id),
    exactlyOneForeground: arcs.filter((arc) => arc.id === foregroundId && ["active", "stabilizing"].includes(arc.status)).length === 1,
    narrativeKeepsDebtOutcomePending: /申请|协商/.test(state.currentNode?.description || "") && !/已经减免|债务已重组|正式违约/.test(state.currentNode?.description || "")
  };
}

export async function runDebtRealBrowserRoute({ tab, recordRoot, slug }) {
  const config = DEBT_REAL_BROWSER_CASES.find((item) => item.slug === slug);
  if (!config) throw new Error(`Unknown debt browser route: ${slug}`);
  await tab.goto(`http://127.0.0.1:5174/?recordTestRun=2026-07-19-financial-debt-routes-${slug}&resetRecordTestRun=1&importTestState=1&runNonce=${Date.now()}`);
  await tab.playwright.domSnapshot();
  const runner = await createRealBrowserJourneyRunner({ tab, recordRoot, config });
  const checkpoint = createDebtBrowserCheckpoint(slug);
  await mkdir(path.dirname(runner.workingPath), { recursive: true });
  await writeFile(runner.workingPath, `${JSON.stringify({ latestState: checkpoint, interactionLog: [{ type: "debt_route_seeded", slug, at: new Date().toISOString() }] }, null, 2)}\n`, "utf8");
  let state = await runner.importCheckpoint();
  for (const step of config.steps) {
    if (state.currentNode?.reportInvitation?.status === "pending") await runner.declineInvitation();
    state = step.type === "custom" ? await runner.advanceCustomOnce(step.value) : await runner.advanceOnce(step.value);
  }
  const validation = validate(config, state);
  const imagesDir = path.join(recordRoot, "images", slug);
  await mkdir(imagesDir, { recursive: true });
  const screenshotPath = path.join(imagesDir, "final-page.png");
  await writeFile(screenshotPath, await tab.screenshot({}));
  const result = { schemaVersion: 1, runId: path.basename(recordRoot), dataSource: "real_ai_browser", slug, scenario: config.scenario, description: config.description, completedAt: new Date().toISOString(), interactionLog: runner.trace, validation, passed: Object.values(validation).every(Boolean), screenshotPath, finalState: state };
  await mkdir(path.join(recordRoot, "cases"), { recursive: true });
  await writeFile(path.join(recordRoot, "cases", `${slug}.json`), `${JSON.stringify(result, null, 2)}\n`, "utf8");
  return { slug, passed: result.passed, validation, screenshotPath, historyLength: state.history?.length || 0 };
}

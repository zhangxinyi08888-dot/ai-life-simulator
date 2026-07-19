import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { duplicateSingletonExpenseTypes, personalLedgerBusinessBoundaryViolations } from "./financial-real-browser-audit-helpers.mjs";

function runGit(args) {
  return new Promise((resolve, reject) => execFile("git", args, { cwd: process.cwd() }, (error, stdout) => (
    error ? reject(error) : resolve(stdout.trim())
  )));
}

const root = path.resolve(process.argv[2]);
const casesDir = path.join(root, "cases");
const files = (await readdir(casesDir)).filter((name) => name.endsWith(".json")).sort();
const records = await Promise.all(files.map(async (name) => JSON.parse(await readFile(path.join(casesDir, name), "utf8"))));
const round = (value) => Math.round(Number(value || 0) * 10000) / 10000;
const percent = (part, whole) => whole ? round((part / whole) * 100) : 0;
const close = (a, b, tolerance = 0.02) => Math.abs(Number(a || 0) - Number(b || 0)) <= tolerance;
const financeText = /(?:月薪|工资|薪资|收入|支出|房租|租金|房贷|贷款|债务|存款|现金|融资|估值|期权|股权|万元|万\/月|每月|年薪|买房|卖房|投资|顾问费|稿费|退休金)/;
const personalOptionText = /(?:你(?:获得|获授|被授予|持有|拥有|行使|行权)[^。；]{0,24}期权|(?:授予|发放)[^。；]{0,12}(?:给)?你[^。；]{0,12}期权|你的[^。；]{0,16}期权)/u;
const personalEquityText = /(?:你(?:持有|拥有|获得|接受)[^。；]{0,20}(?:股权|股份|持股|干股)|(?:股权|持股)结构[^。；]{0,32}你占\s*\d|你(?:成为|是|作为)[^。；]{0,12}(?:联合创始人|合伙人)|你的(?:创始人股权|干股))/u;
const personalPropertyText = /(?:你(?:买下|买了|购买|购置|拥有|持有|还清|提前还)[^。；]{0,24}(?:房|公寓|房贷|按揭)|你们(?:买下|买了|购买|购置|拥有|持有|还清|提前还)[^。；]{0,24}(?:房|公寓|房贷|按揭)|(?:你|你们)(?:的)?(?:自住房|住房|房产|公寓|房贷|按揭|月供)|名下[^。；]{0,16}(?:住房|房产|公寓)|房贷每月|每月还完房贷|提前还清(?:部分|剩余)?房贷)/u;
const openingPropertyText = /(?:房产(?:市值|价值)?|住房(?:市值|价值)?|房贷余额|按揭余额|贷款余额)[^0-9]{0,12}\d/;
const monthlyAmountPatterns = [
  /(?:税后)?(?:月薪|月收入|月工资|月薪资)(?:达到|提升至|升至|降至|恢复至|稳定在|约为|为|约|从[^，。]{0,12}到)?\s*(\d+(?:\.\d+)?)\s*万/g,
  /每月(?:收入|工资|薪资|顾问收入|咨询收入|稿费)(?:达到|提升至|升至|约为|为|约)?\s*(\d+(?:\.\d+)?)\s*万/g
];

const cases = [];
const latestIssues = new Map();
let totalNodes = 0;
let invariantFailures = 0;
let financeNarrativeNodes = 0;
let acceptedCoverageNodes = 0;
let staleFinanceNodes = 0;
let salaryMismatchNodes = 0;
let missingHoldingNodes = 0;
let missingOptionHoldingNodes = 0;
let missingPropertyNodes = 0;
let wealthDirectionMismatches = 0;
let adultZeroExpenseNodes = 0;
let employedAt80PlusWithoutEvidenceNodes = 0;
let openingFactMismatchCases = 0;
let duplicateActiveShortfallNodes = 0;
let systemShortfallScheduleIssueNodes = 0;
let issueUndefinedNodes = 0;
let reportPlaceholderCases = 0;
let valuedOptionOmittedNodes = 0;
let contingentOptionInflatedNodes = 0;
let staleOptionLifecycleNodes = 0;
let adultBelowPolicyExpenseNodes = 0;
let invalidHoldingInstrumentNodes = 0;
let personalLedgerBusinessBoundaryNodes = 0;
let duplicateSingletonExpenseNodes = 0;

for (const record of records) {
  const history = record.finalState?.history || [];
  totalNodes += history.length;
  const nodes = [];
  let previous;
  for (let index = 0; index < history.length; index += 1) {
    const node = history[index];
    const fs = node.financialState || {};
    const ledger = node.financialLedger || {};
    const annualDebtInterestWan = round((ledger.debtAccounts || [])
      .filter((debt) => debt.status === "active" || debt.status === "defaulted")
      .reduce((sum, debt) => {
        if (Number.isFinite(debt.repaymentPolicy?.monthlyInterestWan)) return sum + debt.repaymentPolicy.monthlyInterestWan * 12;
        if (Number.isFinite(debt.repaymentPolicy?.annualInterestRate)) return sum + Number(debt.principalWan || 0) * debt.repaymentPolicy.annualInterestRate;
        return sum;
      }, 0));
    const assets = round(fs.cashWan + fs.investmentAssetsWan + fs.propertyMarketValueWan + fs.businessAndOtherAssetsWan);
    const expectedNetWorth = round(assets - fs.totalDebtWan);
    const identityOk = close(expectedNetWorth, fs.netWorthWan);
    const annualCashInflowWan = round((ledger.incomeSources || [])
      .filter((source) => source.status === "active"
        && source.accrualReviewStatus !== "quarantined"
        && source.accrualPolicy !== "event_only"
        && Number(source.activeFromAgeInMonths || 0) <= Number(ledger.asOfAgeInMonths || node.ageInMonths)
        && (source.activeUntilAgeInMonths == null || Number(source.activeUntilAgeInMonths) > Number(ledger.asOfAgeInMonths || node.ageInMonths)))
      .reduce((sum, source) => sum + (source.accrualPolicy === "annual"
        ? Number(source.annualNetAmountWan || 0)
        : Number(source.monthlyNetAmountWan || 0) * 12), 0));
    const disposableOk = close(annualCashInflowWan - Number(fs.annualCoreExpenseWan || 0) - annualDebtInterestWan, fs.annualDisposableIncomeWan);
    const cashFloorOk = Number(fs.cashWan || 0) >= -0.001;
    const ageOk = fs.asOfAgeInMonths == null || Number(fs.asOfAgeInMonths) === Number(node.ageInMonths);
    const ledgerAgeOk = ledger.asOfAgeInMonths == null || Number(ledger.asOfAgeInMonths) === Number(node.ageInMonths);
    const invariantOk = identityOk && disposableOk && cashFloorOk && ageOk && ledgerAgeOk;
    if (!invariantOk) invariantFailures += 1;

    const description = String(node.description || "");
    const hasFinanceNarrative = financeText.test(description);
    if (hasFinanceNarrative) financeNarrativeNodes += 1;
    const signature = [fs.annualAfterTaxIncomeWan, fs.annualCoreExpenseWan, fs.investmentAssetsWan, fs.propertyMarketValueWan, fs.businessAndOtherAssetsWan, fs.totalDebtWan, fs.employmentStatus].join("|");
    const transactionCount = Array.isArray(ledger.committedTransactionIds) ? ledger.committedTransactionIds.length : 0;
    const previousTransactionCount = previous?.transactionCount || 0;
    const acceptedCoverage = Boolean(hasFinanceNarrative && (transactionCount > previousTransactionCount || (previous && signature !== previous.signature)));
    if (acceptedCoverage) acceptedCoverageNodes += 1;
    const stale = Boolean(previous && hasFinanceNarrative && signature === previous.signature && transactionCount === previousTransactionCount);
    if (stale) staleFinanceNodes += 1;

    const monthlyAmounts = [];
    for (const pattern of monthlyAmountPatterns) {
      pattern.lastIndex = 0;
      for (const match of description.matchAll(pattern)) monthlyAmounts.push(Number(match[1]));
    }
    const impliedAnnual = monthlyAmounts.map((value) => round(value * 12));
    const activeIncomeAnnuals = (ledger.incomeSources || [])
      .filter((source) => source.status === "active")
      .map((source) => round(source.accrualPolicy === "annual" ? source.annualNetAmountWan : Number(source.monthlyNetAmountWan || 0) * 12));
    const salaryMismatch = impliedAnnual.length > 0 && !impliedAnnual.every((value) => activeIncomeAnnuals
      .some((candidate) => Math.abs(value - candidate) <= Math.max(2, value * 0.12)));
    if (salaryMismatch) salaryMismatchNodes += 1;
    const holdingMissing = (personalOptionText.test(description) || personalEquityText.test(description))
      && (ledger.businessHoldings?.length || 0) === 0 && Number(fs.businessAndOtherAssetsWan || 0) === 0;
    const optionHoldingMissing = personalOptionText.test(description)
      && !(ledger.businessHoldings || []).some((holding) => holding.instrumentType === "stock_option");
    const propertyMissing = personalPropertyText.test(description) && (ledger.assetAccounts?.filter((item) => item.type === "property").length || 0) === 0 && Number(fs.propertyMarketValueWan || 0) === 0;
    if (holdingMissing) missingHoldingNodes += 1;
    if (optionHoldingMissing) missingOptionHoldingNodes += 1;
    if (propertyMissing) missingPropertyNodes += 1;

    const ageYears = Number(node.ageInMonths || 0) / 12;
    const adultZeroExpense = ageYears >= 18 && Number(fs.annualCoreExpenseWan || 0) === 0;
    const adultBelowPolicyExpense = ageYears >= 23 && fs.employmentStatus !== "student"
      && Number(fs.annualCoreExpenseWan || 0) + 0.02 < 4.2;
    const careerIncomeSources = (ledger.incomeSources || []).filter((source) => source.status === "active" && source.linkedCareerStateId);
    const hasRecentCareerEvidence = careerIncomeSources.some((source) => Number.isFinite(source.lastConfirmedAtAgeInMonths)
      && Number(node.ageInMonths) - Number(source.lastConfirmedAtAgeInMonths) <= 36);
    const hasAccruingCareerIncome = careerIncomeSources.some((source) => source.accrualPolicy !== "event_only" && source.accrualReviewStatus !== "quarantined");
    const employedAt80PlusWithoutEvidence = ageYears >= 80 && fs.employmentStatus === "employed" && hasAccruingCareerIncome && !hasRecentCareerEvidence;
    if (adultZeroExpense) adultZeroExpenseNodes += 1;
    if (adultBelowPolicyExpense) adultBelowPolicyExpenseNodes += 1;
    if (employedAt80PlusWithoutEvidence) employedAt80PlusWithoutEvidenceNodes += 1;
    const activeShortfalls = (ledger.debtAccounts || []).filter((debt) => debt.status === "active" && debt.type === "liquidity_shortfall");
    const duplicateActiveShortfall = activeShortfalls.length > 1;
    const systemShortfallScheduleIssue = (ledger.unresolvedIssues || []).some((issue) => issue.status !== "resolved"
      && issue.code === "UNKNOWN_DEBT_SCHEDULE"
      && (issue.relatedDebtAccountIds || []).some((id) => activeShortfalls.some((debt) => debt.id === id)));
    const issueUndefined = (ledger.unresolvedIssues || []).some((issue) => /undefined|Cannot read properties|TypeError/u.test(String(issue.summary || "")));
    const activeOptions = (ledger.businessHoldings || []).filter((holding) => holding.instrumentType === "stock_option"
      && (holding.status === "active" || holding.status === "partially_sold"));
    const valuedOptionCarryingWan = round(activeOptions.reduce((sum, holding) => sum + Number(holding.personalCarryingValueWan || 0), 0));
    const valuedOptionOmitted = valuedOptionCarryingWan > 0
      && Number(fs.businessAndOtherAssetsWan || 0) + 0.02 < valuedOptionCarryingWan;
    const contingentOptionInflated = activeOptions.some((holding) => {
      const terms = holding.optionTerms || {};
      const remainingVestedUnits = Number(terms.vestedUnits || 0) - Number(terms.exercisedUnits || 0);
      return Number(holding.personalCarryingValueWan || 0) > 0
        && (remainingVestedUnits <= 0 || !Number.isFinite(terms.fairValueWanPerUnit));
    });
    const staleOptionLifecycle = activeOptions.some((holding) => {
      const expiresAt = holding.optionTerms?.expiresAtAgeInMonths ?? holding.expirationDateInMonths;
      return Number.isFinite(expiresAt) && Number(expiresAt) < Number(node.ageInMonths);
    });
    const invalidHoldingInstrument = (ledger.businessHoldings || []).some((holding) => (
      holding.instrumentType !== undefined && !["equity", "stock_option"].includes(holding.instrumentType)
    ));
    const businessBoundaryViolations = personalLedgerBusinessBoundaryViolations(ledger);
    const personalLedgerBusinessBoundary = businessBoundaryViolations.incomeSourceIds.length > 0
      || businessBoundaryViolations.expenseCommitmentIds.length > 0;
    const duplicateSingletonExpenses = duplicateSingletonExpenseTypes(ledger);
    const duplicateSingletonExpense = duplicateSingletonExpenses.length > 0;
    if (duplicateActiveShortfall) duplicateActiveShortfallNodes += 1;
    if (systemShortfallScheduleIssue) systemShortfallScheduleIssueNodes += 1;
    if (issueUndefined) issueUndefinedNodes += 1;
    if (valuedOptionOmitted) valuedOptionOmittedNodes += 1;
    if (contingentOptionInflated) contingentOptionInflatedNodes += 1;
    if (staleOptionLifecycle) staleOptionLifecycleNodes += 1;
    if (invalidHoldingInstrument) invalidHoldingInstrumentNodes += 1;
    if (personalLedgerBusinessBoundary) personalLedgerBusinessBoundaryNodes += 1;
    if (duplicateSingletonExpense) duplicateSingletonExpenseNodes += 1;

    const netWorthDelta = previous ? round(Number(fs.netWorthWan || 0) - Number(previous.fs.netWorthWan || 0)) : 0;
    const wealthDelta = previous ? Number(node.attributes?.wealth || 0) - Number(previous.node.attributes?.wealth || 0) : 0;
    const wealthDirectionMismatch = Boolean(previous && ((netWorthDelta > 0.02 && wealthDelta < 0) || (netWorthDelta < -0.02 && wealthDelta > 0)));
    if (wealthDirectionMismatch) wealthDirectionMismatches += 1;

    for (const issue of ledger.unresolvedIssues || []) {
      const key = `${record.caseSlug}:${issue.id}`;
      latestIssues.set(key, { caseSlug: record.caseSlug, ...issue });
    }
    nodes.push({
      node: index + 1,
      ageInMonths: node.ageInMonths,
      age: round(ageYears),
      title: node.title,
      selectedChoice: node.selectedChoice,
      financialState: fs,
      attributes: node.attributes,
      invariantChecks: { identityOk, disposableOk, cashFloorOk, ageOk, ledgerAgeOk, expectedNetWorth, annualDebtInterestWan, annualCashInflowWan },
      narrativeChecks: { hasFinanceNarrative, acceptedCoverage, stale, monthlyAmounts, impliedAnnual, activeIncomeAnnuals, salaryMismatch, holdingMissing, optionHoldingMissing, propertyMissing, adultZeroExpense, adultBelowPolicyExpense, employedAt80PlusWithoutEvidence, duplicateActiveShortfall, systemShortfallScheduleIssue, issueUndefined, valuedOptionCarryingWan, valuedOptionOmitted, contingentOptionInflated, staleOptionLifecycle, invalidHoldingInstrument, personalLedgerBusinessBoundary, businessBoundaryViolations, duplicateSingletonExpense, duplicateSingletonExpenses, wealthDirectionMismatch },
      issueIds: (ledger.unresolvedIssues || []).map((issue) => issue.id)
    });
    previous = { node, fs, signature, transactionCount };
  }

  const first = history[0]?.financialState || {};
  const last = history.at(-1)?.financialState || {};
  const openingText = JSON.stringify({ answers: record.finalState?.answers, config: record.config });
  const openingFactMismatch = openingPropertyText.test(openingText)
    && Number(first.propertyMarketValueWan || 0) === 0
    && Number(first.totalDebtWan || 0) === 0;
  if (openingFactMismatch) openingFactMismatchCases += 1;
  if (/金额待账本确认|回报幅度待账本确认|回报率待账本确认/u.test(JSON.stringify(record.finalState?.outcome || {}))) reportPlaceholderCases += 1;
  const invitationSequence = (record.interactionLog || [])
    .filter((item) => ["invitation_declined", "invitation_accepted"].includes(item.type))
    .map((item) => `${item.invitation?.id || "unknown"}:${item.type === "invitation_accepted" ? "accepted" : "declined"}`);
  const recoverableEvents = (record.interactionLog || [])
    .filter((item) => item.type === "recoverable_error" || item.type === "recoverable_timeout");
  const realityMetrics = {
    invariantFailures: nodes.filter((item) => !item.invariantChecks.identityOk || !item.invariantChecks.disposableOk
      || !item.invariantChecks.cashFloorOk || !item.invariantChecks.ageOk || !item.invariantChecks.ledgerAgeOk).length,
    salaryMismatchNodes: nodes.filter((item) => item.narrativeChecks.salaryMismatch).length,
    adultZeroExpenseNodes: nodes.filter((item) => item.narrativeChecks.adultZeroExpense).length,
    personalLedgerBusinessBoundaryNodes: nodes.filter((item) => item.narrativeChecks.personalLedgerBusinessBoundary).length,
    duplicateSingletonExpenseNodes: nodes.filter((item) => item.narrativeChecks.duplicateSingletonExpense).length,
    missingPropertyNodes: nodes.filter((item) => item.narrativeChecks.propertyMissing).length,
    missingOptionHoldingNodes: nodes.filter((item) => item.narrativeChecks.optionHoldingMissing).length,
    valuedOptionOmittedNodes: nodes.filter((item) => item.narrativeChecks.valuedOptionOmitted).length,
    employedAt80PlusWithoutEvidenceNodes: nodes.filter((item) => item.narrativeChecks.employedAt80PlusWithoutEvidence).length,
    openIssues: (history.at(-1)?.financialLedger?.unresolvedIssues || []).filter((issue) => (issue.status || "open") === "open").length
  };
  cases.push({
    caseSlug: record.caseSlug,
    scenario: record.scenario,
    closureType: record.finalState?.outcome?.meta?.closureType,
    passed: record.passed,
    nodeCount: history.length,
    finalAgeInMonths: history.at(-1)?.ageInMonths,
    invitationCount: record.finalState?.invitations?.length || 0,
    invitationSequence,
    recoverableEvents,
    firstFinancialState: first,
    finalFinancialState: last,
    openingFactMismatch,
    realityMetrics,
    change: {
      cashWan: round(Number(last.cashWan || 0) - Number(first.cashWan || 0)),
      netWorthWan: round(Number(last.netWorthWan || 0) - Number(first.netWorthWan || 0)),
      debtWan: round(Number(last.totalDebtWan || 0) - Number(first.totalDebtWan || 0))
    },
    nodes
  });
}

const issues = [...latestIssues.values()];
const openIssues = issues.filter((issue) => (issue.status || "open") === "open");
const resolvedIssues = issues.filter((issue) => issue.status === "resolved");
const issueCodeCounts = openIssues.reduce((acc, issue) => {
  acc[issue.code] = (acc[issue.code] || 0) + 1;
  return acc;
}, {});
const summary = {
  caseCount: cases.length,
  totalNodes,
  invariantFailures,
  financeNarrativeNodes,
  acceptedCoverageNodes,
  acceptedCoverageRatePct: percent(acceptedCoverageNodes, financeNarrativeNodes),
  staleFinanceNodes,
  staleFinanceRatePct: percent(staleFinanceNodes, financeNarrativeNodes),
  salaryMismatchNodes,
  salaryMismatchRatePct: percent(salaryMismatchNodes, financeNarrativeNodes),
  missingHoldingNodes,
  missingOptionHoldingNodes,
  missingPropertyNodes,
  wealthDirectionMismatches,
  adultZeroExpenseNodes,
  employedAt80PlusWithoutEvidenceNodes,
  openingFactMismatchCases,
  duplicateActiveShortfallNodes,
  systemShortfallScheduleIssueNodes,
  issueUndefinedNodes,
  reportPlaceholderCases,
  valuedOptionOmittedNodes,
  contingentOptionInflatedNodes,
  staleOptionLifecycleNodes,
  adultBelowPolicyExpenseNodes,
  invalidHoldingInstrumentNodes,
  personalLedgerBusinessBoundaryNodes,
  duplicateSingletonExpenseNodes,
  openIssues: openIssues.length,
  resolvedIssues: resolvedIssues.length,
  issueCodeCounts
};
const audit = { generatedAt: new Date().toISOString(), root, summary, cases, issues };
await writeFile(path.join(root, "finance-audit.json"), `${JSON.stringify(audit, null, 2)}\n`);

const routeRows = cases.map((item) => {
  const last = item.finalFinancialState;
  return `| ${item.caseSlug} | ${item.scenario} | ${item.closureType} | ${item.nodeCount} | ${item.invitationCount} | ${last.cashWan} | ${last.netWorthWan} | ${last.totalDebtWan} | ${last.annualAfterTaxIncomeWan} | ${last.annualCoreExpenseWan} | ${last.employmentStatus} |`;
}).join("\n");
const routeEvidenceRows = cases.map((item) => {
  const ageYears = Math.floor(Number(item.finalAgeInMonths || 0) / 12);
  const ageMonths = Number(item.finalAgeInMonths || 0) % 12;
  const age = `${ageYears}岁${ageMonths ? `${ageMonths}个月` : ""}`;
  return `| ${item.caseSlug} | ${item.scenario} | ${item.nodeCount} | ${age} | ${item.invitationSequence.join(" → ") || "无"} | ${item.closureType} | ${item.recoverableEvents.length} | ${item.passed ? "通过" : "失败"} |`;
}).join("\n");
const routeRealityRows = cases.map((item) => {
  const metrics = item.realityMetrics;
  const blockerCount = metrics.invariantFailures + metrics.salaryMismatchNodes + metrics.adultZeroExpenseNodes
    + metrics.personalLedgerBusinessBoundaryNodes + metrics.duplicateSingletonExpenseNodes + metrics.missingPropertyNodes
    + metrics.missingOptionHoldingNodes + metrics.valuedOptionOmittedNodes + metrics.employedAt80PlusWithoutEvidenceNodes
    + Number(item.openingFactMismatch);
  return `| ${item.caseSlug} | ${metrics.invariantFailures} | ${metrics.salaryMismatchNodes} | ${metrics.adultZeroExpenseNodes} | ${metrics.personalLedgerBusinessBoundaryNodes} | ${metrics.duplicateSingletonExpenseNodes} | ${metrics.missingPropertyNodes} | ${metrics.missingOptionHoldingNodes} | ${metrics.valuedOptionOmittedNodes} | ${metrics.employedAt80PlusWithoutEvidenceNodes} | ${metrics.openIssues} | ${blockerCount === 0 ? "核心现实性门禁通过" : "存在阻断"} |`;
}).join("\n");
const recoverableRows = cases.flatMap((item) => item.recoverableEvents.map((event) => (
  `| ${item.caseSlug} | ${event.type} | ${event.historyLength ?? 0} | ${String(event.message || "页面可恢复错误").replace(/\|/g, "\\|")} |`
))).join("\n") || "| 无 | — | — | 无 |";
const issueRows = Object.entries(issueCodeCounts).map(([code, count]) => `| ${code} | ${count} |`).join("\n") || "| 无 | 0 |";
const blockers = [
  adultZeroExpenseNodes > 0 && `成年节点年核心支出为 0：${adultZeroExpenseNodes} 个`,
  openingFactMismatchCases > 0 && `人物明确提供房产/房贷但开局账本资产和负债均为 0：${openingFactMismatchCases} 组`,
  employedAt80PlusWithoutEvidenceNodes > 0 && `80 岁以后无近期工作证据仍为 employed：${employedAt80PlusWithoutEvidenceNodes} 个节点`,
  duplicateActiveShortfallNodes > 0 && `单路线同时存在多个活跃 shortfall 账户：${duplicateActiveShortfallNodes} 个节点`,
  systemShortfallScheduleIssueNodes > 0 && `系统 shortfall 自触发 UNKNOWN_DEBT_SCHEDULE：${systemShortfallScheduleIssueNodes} 个节点`,
  issueUndefinedNodes > 0 && `业务 issue 泄漏程序异常或 undefined：${issueUndefinedNodes} 个节点`,
  reportPlaceholderCases > 0 && `终局报告泄漏内部占位符：${reportPlaceholderCases} 组`,
  salaryMismatchNodes > 0 && `正文月收入与活跃收入来源不一致：${salaryMismatchNodes} 个节点`,
  missingPropertyNodes > 0 && `正文主人公房产或房贷事实没有房产账户：${missingPropertyNodes} 个节点`,
  valuedOptionOmittedNodes > 0 && `已归属且有账面价值的期权未进入用户财富：${valuedOptionOmittedNodes} 个节点`,
  contingentOptionInflatedNodes > 0 && `未归属或缺可靠估值的期权被计入用户财富：${contingentOptionInflatedNodes} 个节点`,
  missingOptionHoldingNodes > 0 && `正文出现期权但没有 stock_option holding：${missingOptionHoldingNodes} 个节点`,
  staleOptionLifecycleNodes > 0 && `期权超过到期月仍保持 active：${staleOptionLifecycleNodes} 个节点`,
  invalidHoldingInstrumentNodes > 0 && `持股 instrumentType 不在权威枚举内：${invalidHoldingInstrumentNodes} 个节点`,
  personalLedgerBusinessBoundaryNodes > 0 && `公司营收或经营成本进入个人收支：${personalLedgerBusinessBoundaryNodes} 个节点`,
  duplicateSingletonExpenseNodes > 0 && `basic_living 或 housing 存在重复 active 基线：${duplicateSingletonExpenseNodes} 个节点`,
  adultBelowPolicyExpenseNodes > 0 && `23 岁后生活支出仍低于成年保守政策下限：${adultBelowPolicyExpenseNodes} 个节点`,
  openIssues.length > 0 && `终局仍存在 open issue：${openIssues.length} 个`,
  summary.acceptedCoverageRatePct < 80 && `财务叙述节点 Accepted 覆盖率 ${summary.acceptedCoverageRatePct}%，低于 80% 目标`
].filter(Boolean);
const routeContractPassed = records.length === 5 && records.every((record) => record.passed);
const m7Ready = routeContractPassed && blockers.length === 0 && invariantFailures === 0;
const report = `# 五组真实网页测试：财务完整审计报告

## 结论

本轮五条全新真实网页路线的 **2/2/1 路径契约${routeContractPassed ? "全部通过" : "未全部通过"}**，账本恒等式、可支配收入恒等式、现金 floor 与年龄对齐共 ${totalNodes} 个节点、${invariantFailures} 个失败。入口层修复必须让合法事实进入账本；报告中的无来源金额必须被重写成自然的定性结论，不能泄漏内部占位符。

**M7 ${m7Ready ? "满足本轮动态放行条件" : "仍不允许切换唯一写入者"}**。静态代码门禁通过并不代表动态事实完整；本轮${blockers.length ? "存在以下阻断项" : "没有检测到动态阻断项"}：

${blockers.length ? blockers.map((item) => `- ${item}`).join("\n") : "- 无"}

## 路径矩阵与邀请序列

| 人物 | 路径 | 节点 | 终局年龄 | 邀请决策序列 | 收束 | 可恢复错误 | 结果 |
|---|---|---:|---|---|---|---:|---|
${routeEvidenceRows}

本轮没有失败后替换人物；所有完成记录均来自同一新 run。页面可恢复错误如下，均通过可见重试流程继续：

| 人物 | 类型 | 当时历史节点 | 错误 |
|---|---|---:|---|
${recoverableRows}

## 核心指标

| 指标 | 结果 | 判断 |
|---|---:|---|
| 算术/现金/年龄不变量失败 | ${invariantFailures} | ${invariantFailures === 0 ? "通过" : "失败"} |
| 财务叙述节点 | ${financeNarrativeNodes} | 样本基数 |
| Accepted 覆盖率 | ${summary.acceptedCoverageRatePct}%（${acceptedCoverageNodes}/${financeNarrativeNodes}） | 目标 ≥80% |
| stale 节点率 | ${summary.staleFinanceRatePct}%（${staleFinanceNodes}/${financeNarrativeNodes}） | 越低越好 |
| 薪资不匹配率 | ${summary.salaryMismatchRatePct}%（${salaryMismatchNodes}/${financeNarrativeNodes}） | 目标 0 |
| 正文持股但无持股账户 | ${missingHoldingNodes} | 目标 0 |
| 正文期权但无 stock_option holding | ${missingOptionHoldingNodes} | 目标 0 |
| 正文房产/房贷但无房产账户 | ${missingPropertyNodes} | 目标 0 |
| 成年支出为 0 | ${adultZeroExpenseNodes} | 目标 0 |
| 80 岁后无近期工作证据仍 employed | ${employedAt80PlusWithoutEvidenceNodes} | 目标 0 |
| 开局重大资产负债漏入账 | ${openingFactMismatchCases} 组 | 目标 0 |
| 多个活跃 shortfall 账户节点 | ${duplicateActiveShortfallNodes} | 目标 0 |
| 系统 shortfall 自触发计划噪音 | ${systemShortfallScheduleIssueNodes} | 目标 0 |
| issue 泄漏异常/undefined | ${issueUndefinedNodes} | 目标 0 |
| 报告内部占位符 | ${reportPlaceholderCases} 组 | 目标 0 |
| 有价值期权未计入用户财富 | ${valuedOptionOmittedNodes} | 目标 0 |
| 或有/缺估值期权错误计入财富 | ${contingentOptionInflatedNodes} | 目标 0 |
| 过期但仍 active 的期权节点 | ${staleOptionLifecycleNodes} | 目标 0 |
| 非法持股 instrumentType 节点 | ${invalidHoldingInstrumentNodes} | 目标 0 |
| 公司营收或经营成本进入个人收支 | ${personalLedgerBusinessBoundaryNodes} | 目标 0 |
| basic_living / housing 重复 active | ${duplicateSingletonExpenseNodes} | 目标 0 |
| 23 岁后仍低于成年支出政策下限 | ${adultBelowPolicyExpenseNodes} | 目标 0 |
| open / resolved issue | ${openIssues.length} / ${resolvedIssues.length} | 必须有关闭路径且终局可控 |

Accepted 覆盖率以“包含财务叙述的节点中，本节点新增已提交交易或核心财务签名发生变化”为可审计代理口径；它不把纯时间计提误算为新事实接受。

## 五条路线终局快照

| 人物 | 路径 | 终局 | 节点 | 邀请 | 现金 | 净资产 | 债务 | 年收入 | 年支出 | 身份 |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---|
${routeRows}

## 逐组现实性结论

以下结论直接从本轮各节点账本与正文计算，不复用旧批次的路线描述：

| 人物 | 不变量失败 | 薪资错配 | 成年零支出 | 企业事实污染 | 重复生活/住房基线 | 房产缺口 | 期权 holding 缺口 | 有价值期权漏计 | 80+ stale 工资 | 终局 open issue | 判断 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
${routeRealityRows}

## issue 代码统计

| 代码 | open 数量 |
|---|---:|
${issueRows}

## 下一步

1. 逐项处理上方动态生成的阻断项；不得用旧批次的固定结论替代本轮证据。
2. 入口事实修复继续使用原句、类型化账户 ID 和一次结构化重试，不降低 Validator 标准。
3. 期权验收保持双向门禁：可靠折后 carrying value 必须进入企业及其他资产、净资产和财富分；未归属或缺可靠估值期权只保留 contingent holding。
4. 所有阻断归零后仍需再跑全新的 2/2/1，不能复用本轮 JSON。

逐节点的完整正文、全部选择、用户选择、五项状态、账本快照和终局报告见 \`full-test-data.md\`；机器可读审计见 \`finance-audit.json\`。

证据索引：\`cases/\` 保存五组完整 JSON，\`working/\` 保存同轮 checkpoint，\`images/<case>/report-page.jpg\` 与 \`poster.jpg\` 保存终局页面和海报，\`visual-inspection.json\` 保存人工视觉复核结果。
`;
await writeFile(path.join(root, "evaluation-report.md"), report);

const aggregate = {
  generatedAt: new Date().toISOString(),
  caseCount: records.length,
  allCasesPassed: routeContractPassed,
  m7Ready,
  scenarioCounts: records.reduce((acc, record) => ({ ...acc, [record.scenario]: (acc[record.scenario] || 0) + 1 }), {}),
  totalHistoryNodes: totalNodes,
  totalInvitations: records.reduce((sum, record) => sum + (record.finalState?.invitations?.length || 0), 0),
  cases: cases.map(({ nodes, ...item }) => item)
};
await writeFile(path.join(root, "aggregate.json"), `${JSON.stringify(aggregate, null, 2)}\n`);
const runStartedAt = records.map((record) => record.startedAt).sort()[0];
const runCompletedAt = records.map((record) => record.completedAt).filter(Boolean).sort().at(-1);
const repositoryCommit = await runGit(["rev-parse", "HEAD"]);
const repositoryDirty = Boolean(await runGit(["status", "--short"]));
const manifest = {
  runId: path.basename(root),
  runStartedAt,
  runCompletedAt,
  generatedAt: new Date().toISOString(),
  repositoryPath: process.cwd(),
  repositoryCommit,
  repositoryDirty,
  launchUrl: "http://127.0.0.1:4173/",
  commands: [
    "pnpm exec tsx scripts/render-full-browser-test-data-markdown.ts <root>/cases <root>/full-test-data.md",
    "node scripts/analyze-financial-real-browser-run.mjs <root>",
    "node $HOME/.codex/skills/run-real-browser-ending-routes/scripts/verify-five-route-run.mjs --root <root> --started-after <runStartedAt> --full-data <root>/full-test-data.md --report <root>/evaluation-report.md"
  ],
  artifacts: ["aggregate.json", "finance-audit.json", "full-test-data.md", "evaluation-report.md", "visual-inspection.json", "cases/", "working/", "images/"],
  cases: records.map((record) => ({ caseSlug: record.caseSlug, scenario: record.scenario, path: `cases/${record.caseSlug}.json` }))
};
await writeFile(path.join(root, "run-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);

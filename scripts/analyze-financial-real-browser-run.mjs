import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  auditFinancialProductionRecords,
  containsPersonalHoldingClaim,
  extractFinancialNarrativeAuditMeta,
  extractPersonalMonthlyIncomeWan
} from "./lib/financial-production-audit.mjs";

const root = path.resolve(process.argv[2]);
const casesDir = path.join(root, "cases");
const files = (await readdir(casesDir)).filter((name) => name.endsWith(".json")).sort();
const records = await Promise.all(files.map(async (name) => JSON.parse(await readFile(path.join(casesDir, name), "utf8"))));
const productionAudit = auditFinancialProductionRecords(records);
const posterEvidence = await Promise.all(records.map(async (record) => {
  const posterPath = record.imagePaths?.posterPath;
  const reportPagePath = record.imagePaths?.pagePath;
  if (!posterPath || !reportPagePath) {
    return {
      caseSlug: record.caseSlug,
      posterPath,
      reportPagePath,
      byteSize: 0,
      nonBlank: false,
      distinctFromReportPage: false
    };
  }
  try {
    const [info, posterBytes, reportPageBytes] = await Promise.all([
      stat(posterPath),
      readFile(posterPath),
      readFile(reportPagePath)
    ]);
    // A 1280x720 JPEG containing the rendered poster is consistently tens of
    // kilobytes. The clipped all-black regression compressed below 10 KiB.
    return {
      caseSlug: record.caseSlug,
      posterPath,
      reportPagePath,
      byteSize: info.size,
      nonBlank: info.size >= 20_000,
      distinctFromReportPage: !posterBytes.equals(reportPageBytes)
    };
  } catch {
    return {
      caseSlug: record.caseSlug,
      posterPath,
      reportPagePath,
      byteSize: 0,
      nonBlank: false,
      distinctFromReportPage: false
    };
  }
}));
productionAudit.posterEvidence = posterEvidence;
productionAudit.summary.blackOrEmptyPosterExportCount = posterEvidence.filter((item) => !item.nonBlank).length;
productionAudit.summary.duplicateFinalImageEvidenceCount = posterEvidence.filter((item) => !item.distinctFromReportPage).length;
const round = (value) => Math.round(Number(value || 0) * 10000) / 10000;
const percent = (part, whole) => whole ? round((part / whole) * 100) : 0;
const close = (a, b, tolerance = 0.02) => Math.abs(Number(a || 0) - Number(b || 0)) <= tolerance;
const financeText = /(?:月薪|工资|薪资|收入|支出|房租|租金|房贷|贷款|债务|存款|现金|融资|估值|期权|股权|万元|万\/月|每月|年薪|买房|卖房|投资|顾问费|稿费|退休金)/;
const propertyText = /(?:买房|房产|住房|公寓|房屋|房贷|按揭|投资房)/;
const openingPropertyText = /(?:房产(?:市值|价值)?|住房(?:市值|价值)?|房贷余额|按揭余额|贷款余额)[^0-9]{0,12}\d/;

function annualizedFamilySupport(ledger, ageInMonths) {
  return round((ledger?.incomeSources || [])
    .filter((source) => source.status === "active"
      && source.type === "family_support"
      && source.accrualReviewStatus !== "quarantined"
      && source.accrualPolicy !== "event_only"
      && Number(source.activeFromAgeInMonths) <= ageInMonths
      && (source.activeUntilAgeInMonths === undefined || Number(source.activeUntilAgeInMonths) > ageInMonths))
    .reduce((sum, source) => sum + (source.accrualPolicy === "annual"
      ? Number(source.annualNetAmountWan || 0)
      : Number(source.monthlyNetAmountWan || 0) * 12), 0));
}

function annualizedDebtInterest(ledger) {
  return round((ledger?.debtAccounts || [])
    .filter((debt) => debt.status === "active" || debt.status === "defaulted")
    .reduce((sum, debt) => {
      if (debt.repaymentPolicy?.monthlyInterestWan !== undefined) return sum + Number(debt.repaymentPolicy.monthlyInterestWan) * 12;
      if (debt.repaymentPolicy?.annualInterestRate !== undefined) return sum + Number(debt.principalWan || 0) * Number(debt.repaymentPolicy.annualInterestRate);
      return sum;
    }, 0));
}

const cases = [];
const latestIssues = new Map();
let totalNodes = 0;
let invariantFailures = 0;
let financeNarrativeNodes = 0;
let acceptedCoverageNodes = 0;
let staleFinanceNodes = 0;
let salaryMismatchNodes = 0;
let missingHoldingNodes = 0;
let missingPropertyNodes = 0;
let wealthDirectionMismatches = 0;
let adultZeroExpenseNodes = 0;
let employedAt80PlusNodes = 0;
let openingFactMismatchCases = 0;

for (const record of records) {
  const history = record.finalState?.history || [];
  totalNodes += history.length;
  const nodes = [];
  let previous;
  for (let index = 0; index < history.length; index += 1) {
    const node = history[index];
    const fs = node.financialState || {};
    const ledger = node.financialLedger || {};
    const assets = round(fs.cashWan + fs.investmentAssetsWan + fs.propertyMarketValueWan + fs.businessAndOtherAssetsWan);
    const expectedNetWorth = round(assets - fs.totalDebtWan);
    const identityOk = close(expectedNetWorth, fs.netWorthWan);
    const expectedDisposableWan = round(
      Number(fs.annualAfterTaxIncomeWan || 0)
      + annualizedFamilySupport(ledger, Number(node.ageInMonths || 0))
      - Number(fs.annualCoreExpenseWan || 0)
      - annualizedDebtInterest(ledger)
    );
    const disposableOk = close(expectedDisposableWan, fs.annualDisposableIncomeWan);
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

    const monthlyAmounts = extractPersonalMonthlyIncomeWan(description);
    const impliedAnnual = monthlyAmounts.map((value) => round(value * 12));
    const authoritativeAnnualIncomeAmounts = (ledger.incomeSources || []).filter((source) => (
      source.status === "active"
      && source.accrualPolicy !== "event_only"
      && source.accrualReviewStatus !== "quarantined"
      && (source.factStatus === "known" || source.factStatus === "estimated")
    )).map((source) => round(source.accrualPolicy === "annual"
      ? Number(source.annualNetAmountWan || 0)
      : Number(source.monthlyNetAmountWan || 0) * 12));
    const salaryMismatch = impliedAnnual.length > 0 && !impliedAnnual.some((value) => (
      [Number(fs.annualAfterTaxIncomeWan || 0), ...authoritativeAnnualIncomeAmounts]
        .some((authorityValue) => Math.abs(value - authorityValue) <= Math.max(2, value * 0.12))
    ));
    if (salaryMismatch) salaryMismatchNodes += 1;
    const holdingMissing = containsPersonalHoldingClaim(description) && (ledger.businessHoldings?.length || 0) === 0 && Number(fs.businessAndOtherAssetsWan || 0) === 0;
    const propertyMissing = propertyText.test(description) && (ledger.assetAccounts?.filter((item) => item.type === "property").length || 0) === 0 && Number(fs.propertyMarketValueWan || 0) === 0;
    if (holdingMissing) missingHoldingNodes += 1;
    if (propertyMissing) missingPropertyNodes += 1;

    const ageYears = Number(node.ageInMonths || 0) / 12;
    const adultZeroExpense = ageYears >= 18 && Number(fs.annualCoreExpenseWan || 0) === 0;
    const employedAt80Plus = ageYears >= 80 && fs.employmentStatus === "employed";
    if (adultZeroExpense) adultZeroExpenseNodes += 1;
    if (employedAt80Plus) employedAt80PlusNodes += 1;

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
      invariantChecks: { identityOk, disposableOk, cashFloorOk, ageOk, ledgerAgeOk, expectedNetWorth, expectedDisposableWan },
      narrativeChecks: { hasFinanceNarrative, acceptedCoverage, stale, monthlyAmounts, impliedAnnual, salaryMismatch, holdingMissing, propertyMissing, adultZeroExpense, employedAt80Plus, wealthDirectionMismatch },
      financialNarrativeAudit: extractFinancialNarrativeAuditMeta(node),
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
  cases.push({
    caseSlug: record.caseSlug,
    scenario: record.scenario,
    closureType: record.finalState?.outcome?.meta?.closureType,
    passed: record.passed,
    nodeCount: history.length,
    invitationCount: record.finalState?.invitations?.length || 0,
    firstFinancialState: first,
    finalFinancialState: last,
    openingFactMismatch,
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
  missingPropertyNodes,
  wealthDirectionMismatches,
  adultZeroExpenseNodes,
  employedAt80PlusNodes,
  openingFactMismatchCases,
  openIssues: openIssues.length,
  resolvedIssues: resolvedIssues.length,
  issueCodeCounts,
  ...productionAudit.summary
};
const audit = { generatedAt: new Date().toISOString(), root, summary, cases, issues, productionAudit };
await writeFile(path.join(root, "finance-audit.json"), `${JSON.stringify(audit, null, 2)}\n`);

const routeRows = cases.map((item) => {
  const last = item.finalFinancialState;
  return `| ${item.caseSlug} | ${item.scenario} | ${item.closureType} | ${item.nodeCount} | ${item.invitationCount} | ${last.cashWan} | ${last.netWorthWan} | ${last.totalDebtWan} | ${last.annualAfterTaxIncomeWan} | ${last.annualCoreExpenseWan} | ${last.employmentStatus} |`;
}).join("\n");
const issueRows = Object.entries(issueCodeCounts).map(([code, count]) => `| ${code} | ${count} |`).join("\n") || "| 无 | 0 |";
const blockers = [
  invariantFailures > 0 && `账本/派生状态不变量失败：${invariantFailures} 个节点`,
  openingFactMismatchCases > 0 && `人物明确提供房产/房贷但开局账本资产和负债均为 0：${openingFactMismatchCases} 组`,
  // Late-life employment remains an explicit diagnostic until the retirement
  // lifecycle is implemented; it is not part of this debt release slice.
  salaryMismatchNodes > 0 && `正文个人薪资/收入与权威个人账本不一致：${salaryMismatchNodes} 个节点`,
  missingHoldingNodes > 0 && `正文持股但缺少结构化 BusinessHolding/公司事实：${missingHoldingNodes} 个节点`,
  productionAudit.summary.fallbackWithoutRepairRecordCount > 0 && `fallback 缺少 repair/fallback 审计记录：${productionAudit.summary.fallbackWithoutRepairRecordCount} 个`,
  productionAudit.summary.userVisibleInternalLedgerTextCount > 0 && `用户可见内部账本文本：${productionAudit.summary.userVisibleInternalLedgerTextCount} 个`,
  productionAudit.summary.finalReportFinancialConflictCount > 0 && `终局报告与权威财务事实冲突：${productionAudit.summary.finalReportFinancialConflictCount} 个`,
  productionAudit.summary.unexplainedDebtDeltaNodeCount > 0 && `无法由叙事或结构化 breakdown 解释的债务跳变：${productionAudit.summary.unexplainedDebtDeltaNodeCount} 个`,
  productionAudit.summary.fabricatedOpeningAccountCount > 0 && `缺少用户证据的开局资产/债务账户：${productionAudit.summary.fabricatedOpeningAccountCount} 个`,
  productionAudit.summary.assetSummaryMismatchNodeCount > 0 && `账本资产类型与汇总表不一致：${productionAudit.summary.assetSummaryMismatchNodeCount} 个`,
  productionAudit.summary.debtConservationFailureCount > 0 && `债务守恒失败：${productionAudit.summary.debtConservationFailureCount} 个`,
  productionAudit.summary.autoShortfallFrozenAboveReserveNodeCount > 0 && `现金超过三个月缓冲但缺口债冻结：${productionAudit.summary.autoShortfallFrozenAboveReserveNodeCount} 个`,
  productionAudit.summary.knownRateInterestOmissionNodeCount > 0 && `已知利率债务漏计息：${productionAudit.summary.knownRateInterestOmissionNodeCount} 个`,
  productionAudit.summary.unsupportedRepaymentCompletionNodeCount > 0 && `正文声称还清但没有偿还/减免权威事实：${productionAudit.summary.unsupportedRepaymentCompletionNodeCount} 个`,
  productionAudit.summary.userVisibleFinancialPlaceholderCount > 0 && `用户可见财务占位符：${productionAudit.summary.userVisibleFinancialPlaceholderCount} 处`,
  productionAudit.summary.orphanFinancialAmountCount > 0 && `截断或孤立财务金额：${productionAudit.summary.orphanFinancialAmountCount} 处`,
  productionAudit.summary.financialAmountPrecisionViolationCount > 0 && `财务金额长浮点泄漏：${productionAudit.summary.financialAmountPrecisionViolationCount} 处`,
  productionAudit.summary.crossJourneyInvitationEntryCount > 0 && `邀请或压力 Arc 跨 journey 串线：${productionAudit.summary.crossJourneyInvitationEntryCount} 条`,
  productionAudit.summary.companyOperatingFlowInPersonalLedgerCount > 0 && `公司经营收支进入个人账本：${productionAudit.summary.companyOperatingFlowInPersonalLedgerCount} 个账户节点`,
  productionAudit.summary.blackOrEmptyPosterExportCount > 0 && `海报导出为空或全黑：${productionAudit.summary.blackOrEmptyPosterExportCount} 张`,
  productionAudit.summary.duplicateFinalImageEvidenceCount > 0 && `海报与报告页证据重复：${productionAudit.summary.duplicateFinalImageEvidenceCount} 组`,
  (!records.every((record) => record.passed) || records.length !== 5) && `固定五路线契约未全部通过：${records.filter((record) => record.passed).length}/${records.length}`
].filter(Boolean);
const releaseCandidate = blockers.length === 0;
const report = `# 五组真实网页测试：财务完整审计报告

## 结论

本轮五条全新真实网页路线的 **2/2/1 路径契约${records.length === 5 && records.every((record) => record.passed) ? "全部通过" : "未全部通过"}**，账本恒等式、含家庭支持与债务利息的可支配现金流恒等式、现金 floor 与年龄对齐共 ${totalNodes} 个节点、${invariantFailures} 个失败。

本轮动态发布判断：**${releaseCandidate ? "通过真实路线财务门禁" : "不允许发布"}**。${releaseCandidate ? "以下 P0 动态阻断项均为 0。" : "存在以下阻断项："}

${blockers.length ? blockers.map((item) => `- ${item}`).join("\n") : "- 无"}

## 核心指标

| 指标 | 结果 | 判断 |
|---|---:|---|
| 算术/现金/年龄不变量失败 | ${invariantFailures} | ${invariantFailures === 0 ? "通过" : "失败"} |
| 财务叙述节点 | ${financeNarrativeNodes} | 样本基数 |
| Accepted 覆盖率 | ${summary.acceptedCoverageRatePct}%（${acceptedCoverageNodes}/${financeNarrativeNodes}） | 目标 ≥80% |
| stale 节点率 | ${summary.staleFinanceRatePct}%（${staleFinanceNodes}/${financeNarrativeNodes}） | 越低越好 |
| 薪资不匹配率 | ${summary.salaryMismatchRatePct}%（${salaryMismatchNodes}/${financeNarrativeNodes}） | 目标 0 |
| 正文持股但无持股账户 | ${missingHoldingNodes} | 目标 0 |
| 正文房产/房贷但无房产账户 | ${missingPropertyNodes} | 目标 0 |
| 成年支出为 0 | ${adultZeroExpenseNodes} | 非阻断诊断；缺失时收入必须隔离 |
| 80 岁后仍 employed | ${employedAt80PlusNodes} | 目标 0 |
| 开局重大资产负债漏入账 | ${openingFactMismatchCases} 组 | 目标 0 |
| narrative fallback | ${productionAudit.summary.narrativeFallbackNodeCount} 个 / ${productionAudit.summary.narrativeFallbackCaseCount} 组 | 必须如实统计，残章目标 0 |
| 用户可见内部账本文本 | ${productionAudit.summary.userVisibleInternalLedgerTextCount} | 目标 0 |
| 终局报告财务冲突 | ${productionAudit.summary.finalReportFinancialConflictCount} | 目标 0 |
| 无解释债务跳变 | ${productionAudit.summary.unexplainedDebtDeltaNodeCount} | 目标 0 |
| 无用户证据开局账户 | ${productionAudit.summary.fabricatedOpeningAccountCount} | 目标 0 |
| 资产汇总不一致 | ${productionAudit.summary.assetSummaryMismatchNodeCount} | 目标 0 |
| 债务守恒失败 | ${productionAudit.summary.debtConservationFailureCount} | 目标 0 |
| 缓冲以上缺口债冻结 | ${productionAudit.summary.autoShortfallFrozenAboveReserveNodeCount} | 目标 0 |
| 已知利率漏计息 | ${productionAudit.summary.knownRateInterestOmissionNodeCount}/${productionAudit.summary.knownRateDebtExposureNodeCount} | ${productionAudit.summary.knownRateDebtExposureNodeCount === 0 ? "未覆盖，不得视为已验证" : "目标 0"} |
| 无事实却声称还清 | ${productionAudit.summary.unsupportedRepaymentCompletionNodeCount} | 目标 0 |
| 用户可见财务占位符 | ${productionAudit.summary.userVisibleFinancialPlaceholderCount} | 目标 0 |
| 截断/孤立财务金额 | ${productionAudit.summary.orphanFinancialAmountCount} | 目标 0 |
| 财务金额长浮点 | ${productionAudit.summary.financialAmountPrecisionViolationCount} | 目标 0 |
| 跨 journey 邀请/Arc | ${productionAudit.summary.crossJourneyInvitationEntryCount} | 目标 0 |
| 公司经营收支进入个人账本 | ${productionAudit.summary.companyOperatingFlowInPersonalLedgerCount} | 目标 0 |
| 空白/全黑海报导出 | ${productionAudit.summary.blackOrEmptyPosterExportCount} | 目标 0 |
| 海报与报告页证据重复 | ${productionAudit.summary.duplicateFinalImageEvidenceCount} | 目标 0 |
| open / resolved issue | ${openIssues.length} / ${resolvedIssues.length} | 必须有关闭路径且终局可控 |

Accepted 覆盖率以“包含财务叙述的节点中，本节点新增已提交交易或核心财务签名发生变化”为可审计代理口径；它不把纯时间计提误算为新事实接受。

## 五条路线终局快照

| 人物 | 路径 | 终局 | 节点 | 邀请 | 现金 | 净资产 | 债务 | 年收入 | 年支出 | 身份 |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---|
${routeRows}

## 逐组可复核结果

${cases.map((item) => `- **${item.caseSlug}**：${item.nodeCount} 个节点，${item.invitationCount} 次邀请；终局现金 ${item.finalFinancialState.cashWan} 万、债务 ${item.finalFinancialState.totalDebtWan} 万、净资产 ${item.finalFinancialState.netWorthWan} 万，就业状态 ${item.finalFinancialState.employmentStatus}；路线契约${item.passed ? "通过" : "失败"}。`).join("\n")}

## issue 代码统计

| 代码 | open 数量 |
|---|---:|
${issueRows}

## 下一步

${releaseCandidate
  ? "1. 继续执行静态 M5/M7、全量单测、lint、typecheck/build 与十张图片检查；全部通过后才可判定发布候选。\n2. open issue、薪资措辞偏差与持股/房产叙述代理指标保留为非阻断质量 backlog，不得伪装为 0。"
  : blockers.map((item, index) => `${index + 1}. 修复并用全新数据复验：${item}`).join("\n")}

## 生产阻断明细

- narrative fallback 节点：${productionAudit.fallbackNodes.map((item) => `${item.caseSlug}#${item.node}`).join("、") || "无"}
- 终局报告冲突：${productionAudit.finalReportConflicts.map((item) => `${item.caseSlug}:${item.code}`).join("、") || "无"}
- 无解释债务跳变：${productionAudit.unexplainedDebtDeltaNodes.map((item) => `${item.caseSlug}#${item.node}`).join("、") || "无"}
- 缺少用户证据的开局账户：${productionAudit.fabricatedOpeningAccounts.map((item) => `${item.caseSlug}:${item.accountId}`).join("、") || "无"}
- 资产汇总不一致：${productionAudit.assetSummaryMismatchNodes.map((item) => `${item.caseSlug}#${item.node}`).join("、") || "无"}
- 债务守恒失败：${productionAudit.debtConservationFailures.map((item) => `${item.caseSlug}#${item.node}`).join("、") || "无"}
- 缓冲以上缺口债冻结：${productionAudit.frozenAutomaticShortfallNodes.map((item) => `${item.caseSlug}#${item.node}`).join("、") || "无"}
- 已知利率漏计息：${productionAudit.knownRateInterestOmissionNodes.map((item) => `${item.caseSlug}#${item.node}`).join("、") || "无"}
- 无事实却声称还清：${productionAudit.unsupportedRepaymentCompletionNodes.map((item) => `${item.caseSlug}#${item.node}`).join("、") || "无"}
- 用户可见财务占位符：${productionAudit.userVisibleFinancialPlaceholders.map((item) => `${item.caseSlug}:${item.path}`).join("、") || "无"}
- 截断/孤立财务金额：${productionAudit.orphanFinancialAmounts.map((item) => `${item.caseSlug}:${item.path}`).join("、") || "无"}
- 财务金额长浮点：${productionAudit.financialPrecisionViolations.map((item) => `${item.caseSlug}:${item.path}`).join("、") || "无"}
- 跨 journey 邀请/Arc：${productionAudit.crossJourneyInvitationEntries.map((item) => `${item.caseSlug}:${item.code}:${item.id}`).join("、") || "无"}
- 公司经营收支进入个人账本：${productionAudit.companyOperatingFlowsInPersonalLedger.map((item) => `${item.caseSlug}#${item.node}:${item.accountId}`).join("、") || "无"}
- 空白/全黑海报：${productionAudit.posterEvidence.filter((item) => !item.nonBlank).map((item) => item.caseSlug).join("、") || "无"}
- 海报与报告页证据重复：${productionAudit.posterEvidence.filter((item) => !item.distinctFromReportPage).map((item) => item.caseSlug).join("、") || "无"}

逐节点的完整正文、全部选择、用户选择、五项状态、账本快照和终局报告见 \`full-test-data.md\`；机器可读审计见 \`finance-audit.json\`。
`;
await writeFile(path.join(root, "evaluation-report.md"), report);

const aggregate = {
  generatedAt: new Date().toISOString(),
  caseCount: records.length,
  allCasesPassed: records.length === 5 && records.every((record) => record.passed),
  scenarioCounts: records.reduce((acc, record) => ({ ...acc, [record.scenario]: (acc[record.scenario] || 0) + 1 }), {}),
  totalHistoryNodes: totalNodes,
  totalInvitations: records.reduce((sum, record) => sum + (record.finalState?.invitations?.length || 0), 0),
  releaseCandidate,
  blockers,
  cases: cases.map(({ nodes, ...item }) => item)
};
await writeFile(path.join(root, "aggregate.json"), `${JSON.stringify(aggregate, null, 2)}\n`);
const runStartedAt = records.map((record) => record.startedAt).sort()[0];
const manifest = {
  runId: path.basename(root),
  runStartedAt,
  generatedAt: new Date().toISOString(),
  cases: records.map((record) => ({ caseSlug: record.caseSlug, scenario: record.scenario, path: `cases/${record.caseSlug}.json` }))
};
await writeFile(path.join(root, "run-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);

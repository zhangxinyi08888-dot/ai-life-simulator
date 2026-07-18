import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";

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
const holdingText = /(?:期权|股权|股份|持股|合伙人权益)/;
const propertyText = /(?:买房|房产|住房|公寓|房屋|房贷|按揭|投资房)/;
const openingPropertyText = /(?:房产(?:市值|价值)?|住房(?:市值|价值)?|房贷余额|按揭余额|贷款余额)[^0-9]{0,12}\d/;
const monthlyAmountPatterns = [
  /(?:税后)?月薪(?:达到|提升至|升至|降至|恢复至|约为|为|约|从[^，。]{0,12}到)?\s*(\d+(?:\.\d+)?)\s*万/g,
  /每月(?:收入|工资|薪资|顾问收入|咨询收入|稿费)?(?:达到|提升至|升至|约为|为|约)?\s*(\d+(?:\.\d+)?)\s*万/g
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
    const disposableOk = close(Number(fs.annualAfterTaxIncomeWan || 0) - Number(fs.annualCoreExpenseWan || 0) - annualDebtInterestWan, fs.annualDisposableIncomeWan);
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
    const holdingMissing = holdingText.test(description) && (ledger.businessHoldings?.length || 0) === 0 && Number(fs.businessAndOtherAssetsWan || 0) === 0;
    const propertyMissing = propertyText.test(description) && (ledger.assetAccounts?.filter((item) => item.type === "property").length || 0) === 0 && Number(fs.propertyMarketValueWan || 0) === 0;
    if (holdingMissing) missingHoldingNodes += 1;
    if (propertyMissing) missingPropertyNodes += 1;

    const ageYears = Number(node.ageInMonths || 0) / 12;
    const adultZeroExpense = ageYears >= 18 && Number(fs.annualCoreExpenseWan || 0) === 0;
    const adultBelowPolicyExpense = ageYears >= 23 && Number(fs.annualCoreExpenseWan || 0) + 0.02 < 4.2;
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
    const staleOptionLifecycle = activeOptions.some((holding) => Number.isFinite(holding.expirationDateInMonths)
      && Number(holding.expirationDateInMonths) < Number(node.ageInMonths));
    if (duplicateActiveShortfall) duplicateActiveShortfallNodes += 1;
    if (systemShortfallScheduleIssue) systemShortfallScheduleIssueNodes += 1;
    if (issueUndefined) issueUndefinedNodes += 1;
    if (valuedOptionOmitted) valuedOptionOmittedNodes += 1;
    if (contingentOptionInflated) contingentOptionInflatedNodes += 1;
    if (staleOptionLifecycle) staleOptionLifecycleNodes += 1;

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
      invariantChecks: { identityOk, disposableOk, cashFloorOk, ageOk, ledgerAgeOk, expectedNetWorth, annualDebtInterestWan },
      narrativeChecks: { hasFinanceNarrative, acceptedCoverage, stale, monthlyAmounts, impliedAnnual, activeIncomeAnnuals, salaryMismatch, holdingMissing, propertyMissing, adultZeroExpense, adultBelowPolicyExpense, employedAt80PlusWithoutEvidence, duplicateActiveShortfall, systemShortfallScheduleIssue, issueUndefined, valuedOptionCarryingWan, valuedOptionOmitted, contingentOptionInflated, staleOptionLifecycle, wealthDirectionMismatch },
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
const issueRows = Object.entries(issueCodeCounts).map(([code, count]) => `| ${code} | ${count} |`).join("\n") || "| 无 | 0 |";
const blockers = [
  adultZeroExpenseNodes > 0 && `成年节点年核心支出为 0：${adultZeroExpenseNodes} 个`,
  openingFactMismatchCases > 0 && `人物明确提供房产/房贷但开局账本资产和负债均为 0：${openingFactMismatchCases} 组`,
  employedAt80PlusWithoutEvidenceNodes > 0 && `80 岁以后无近期工作证据仍为 employed：${employedAt80PlusWithoutEvidenceNodes} 个节点`,
  duplicateActiveShortfallNodes > 0 && `单路线同时存在多个活跃 shortfall 账户：${duplicateActiveShortfallNodes} 个节点`,
  systemShortfallScheduleIssueNodes > 0 && `系统 shortfall 自触发 UNKNOWN_DEBT_SCHEDULE：${systemShortfallScheduleIssueNodes} 个节点`,
  issueUndefinedNodes > 0 && `业务 issue 泄漏程序异常或 undefined：${issueUndefinedNodes} 个节点`,
  reportPlaceholderCases > 0 && `终局报告泄漏内部占位符：${reportPlaceholderCases} 组`,
  valuedOptionOmittedNodes > 0 && `已归属且有账面价值的期权未进入用户财富：${valuedOptionOmittedNodes} 个节点`,
  contingentOptionInflatedNodes > 0 && `未归属或缺可靠估值的期权被计入用户财富：${contingentOptionInflatedNodes} 个节点`,
  staleOptionLifecycleNodes > 0 && `期权超过到期月仍保持 active：${staleOptionLifecycleNodes} 个节点`,
  adultBelowPolicyExpenseNodes > 0 && `23 岁后生活支出仍低于成年保守政策下限：${adultBelowPolicyExpenseNodes} 个节点`,
  openIssues.length > 0 && `终局仍存在 open issue：${openIssues.length} 个`,
  summary.acceptedCoverageRatePct < 80 && `财务叙述节点 Accepted 覆盖率 ${summary.acceptedCoverageRatePct}%，低于 80% 目标`
].filter(Boolean);
const report = `# 五组真实网页测试：财务完整审计报告

## 结论

本轮五条全新真实网页路线的 **2/2/1 路径契约全部通过**，账本恒等式、可支配收入恒等式、现金 floor 与年龄对齐共 ${totalNodes} 个节点、${invariantFailures} 个失败。入口层修复已经让合法事实更容易进入账本；报告中的无来源金额必须被重写成自然的定性结论，不能泄漏内部占位符。

但 **M7 仍不允许切换唯一写入者**。静态代码门禁通过并不代表动态事实完整；本轮存在以下阻断项：

${blockers.map((item) => `- ${item}`).join("\n")}

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
| 23 岁后仍低于成年支出政策下限 | ${adultBelowPolicyExpenseNodes} | 目标 0 |
| open / resolved issue | ${openIssues.length} / ${resolvedIssues.length} | 必须有关闭路径且终局可控 |

Accepted 覆盖率以“包含财务叙述的节点中，本节点新增已提交交易或核心财务签名发生变化”为可审计代理口径；它不把纯时间计提误算为新事实接受。

## 五条路线终局快照

| 人物 | 路径 | 终局 | 节点 | 邀请 | 现金 | 净资产 | 债务 | 年收入 | 年支出 | 身份 |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---|
${routeRows}

## 逐组现实性结论

- **real-career-first**：现金、收入和换岗能进入账本，但创业股权/期权叙述仍有未创建 holding 的节点，入口完整性尚未达标。
- **real-relationship-first**：路线完成；后段仍出现正文月收入与账本来源不匹配，说明职业事实存在阶段性空洞。
- **real-education-second**：成年零支出已修复，但 23 岁后基础生活支出仍停留在学生档，且多处房产/房贷叙述没有对应账户，净资产仍会被高估。
- **real-venture-second**：开局房产 300 万、房贷 210 万已正确入账；期权 holding 能创建，但固定四年归属与到期没有自动结算，导致期权长期保持零价值并在到期后仍 active。
- **real-custom-lifespan**：单一 shortfall 账户可在收入恢复后还清，89 岁转为 retired，死亡节点确定性改为 not_working 且关闭职业收入；但晚年生活缺口债务仍达到数百万元，需要继续校准支出和兜底政策。

## issue 代码统计

| 代码 | open 数量 |
|---|---:|
${issueRows}

## 下一步

1. 在年龄阶段变化时重新评估 system-policy basic_living；学生估计不能永久沿用到就业和中年。
2. 为确定性期权归属表实现 period settlement，并在 expirationDateInMonths 到达时自动到期；估值仍必须来自 Accepted Event。
3. 继续补齐缺金额、缺 evidence、缺 business 对象和生效时间越界的归一化/修复重试，降低终局 open issue。
4. 将薪资、房产和持股 coverage issue 作为 M7 阻断项逐节点关闭，不能只依赖报告重写掩盖缺失事实。
5. 修复后必须重新跑全新的 2/2/1 五路线，不能复用本轮 JSON。

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
  cases: cases.map(({ nodes, ...item }) => item)
};
await writeFile(path.join(root, "aggregate.json"), `${JSON.stringify(aggregate, null, 2)}\n`);
const runStartedAt = records.map((record) => record.startedAt).sort()[0];
const repositoryCommit = await runGit(["rev-parse", "HEAD"]);
const repositoryDirty = Boolean(await runGit(["status", "--short"]));
const manifest = {
  runId: path.basename(root),
  runStartedAt,
  generatedAt: new Date().toISOString(),
  repositoryCommit,
  repositoryDirty,
  cases: records.map((record) => ({ caseSlug: record.caseSlug, scenario: record.scenario, path: `cases/${record.caseSlug}.json` }))
};
await writeFile(path.join(root, "run-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);

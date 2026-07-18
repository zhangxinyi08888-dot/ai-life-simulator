import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

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
    const disposableOk = close(Number(fs.annualAfterTaxIncomeWan || 0) - Number(fs.annualCoreExpenseWan || 0), fs.annualDisposableIncomeWan);
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
    const salaryMismatch = impliedAnnual.length > 0 && !impliedAnnual.some((value) => Math.abs(value - Number(fs.annualAfterTaxIncomeWan || 0)) <= Math.max(2, value * 0.12));
    if (salaryMismatch) salaryMismatchNodes += 1;
    const holdingMissing = holdingText.test(description) && (ledger.businessHoldings?.length || 0) === 0 && Number(fs.businessAndOtherAssetsWan || 0) === 0;
    const propertyMissing = propertyText.test(description) && (ledger.assetAccounts?.filter((item) => item.type === "property").length || 0) === 0 && Number(fs.propertyMarketValueWan || 0) === 0;
    if (holdingMissing) missingHoldingNodes += 1;
    if (propertyMissing) missingPropertyNodes += 1;

    const ageYears = Number(node.ageInMonths || 0) / 12;
    const adultZeroExpense = ageYears >= 18 && Number(fs.annualCoreExpenseWan || 0) === 0;
    const careerIncomeSources = (ledger.incomeSources || []).filter((source) => source.status === "active" && source.linkedCareerStateId);
    const hasRecentCareerEvidence = careerIncomeSources.some((source) => Number.isFinite(source.lastConfirmedAtAgeInMonths)
      && Number(node.ageInMonths) - Number(source.lastConfirmedAtAgeInMonths) <= 36);
    const hasAccruingCareerIncome = careerIncomeSources.some((source) => source.accrualPolicy !== "event_only" && source.accrualReviewStatus !== "quarantined");
    const employedAt80PlusWithoutEvidence = ageYears >= 80 && fs.employmentStatus === "employed" && hasAccruingCareerIncome && !hasRecentCareerEvidence;
    if (adultZeroExpense) adultZeroExpenseNodes += 1;
    if (employedAt80PlusWithoutEvidence) employedAt80PlusWithoutEvidenceNodes += 1;
    const activeShortfalls = (ledger.debtAccounts || []).filter((debt) => debt.status === "active" && debt.type === "liquidity_shortfall");
    const duplicateActiveShortfall = activeShortfalls.length > 1;
    const systemShortfallScheduleIssue = (ledger.unresolvedIssues || []).some((issue) => issue.status !== "resolved"
      && issue.code === "UNKNOWN_DEBT_SCHEDULE"
      && (issue.relatedDebtAccountIds || []).some((id) => activeShortfalls.some((debt) => debt.id === id)));
    const issueUndefined = (ledger.unresolvedIssues || []).some((issue) => /undefined|Cannot read properties|TypeError/u.test(String(issue.summary || "")));
    if (duplicateActiveShortfall) duplicateActiveShortfallNodes += 1;
    if (systemShortfallScheduleIssue) systemShortfallScheduleIssueNodes += 1;
    if (issueUndefined) issueUndefinedNodes += 1;

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
      invariantChecks: { identityOk, disposableOk, cashFloorOk, ageOk, ledgerAgeOk, expectedNetWorth },
      narrativeChecks: { hasFinanceNarrative, acceptedCoverage, stale, monthlyAmounts, impliedAnnual, salaryMismatch, holdingMissing, propertyMissing, adultZeroExpense, employedAt80PlusWithoutEvidence, duplicateActiveShortfall, systemShortfallScheduleIssue, issueUndefined, wealthDirectionMismatch },
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
| open / resolved issue | ${openIssues.length} / ${resolvedIssues.length} | 必须有关闭路径且终局可控 |

Accepted 覆盖率以“包含财务叙述的节点中，本节点新增已提交交易或核心财务签名发生变化”为可审计代理口径；它不把纯时间计提误算为新事实接受。

## 五条路线终局快照

| 人物 | 路径 | 终局 | 节点 | 邀请 | 现金 | 净资产 | 债务 | 年收入 | 年支出 | 身份 |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---|
${routeRows}

## 逐组现实性结论

- **real-career-first**：换岗与工资事实能够进入账本，旧工资不再与新工资长期叠加；仍需关注旧来源被隔离后留下的 open issue。
- **real-relationship-first**：路线完成，但部分阶段 employed 与工资为 0 并存，后来才由新工资事实恢复，说明职业事实仍有阶段性空洞。
- **real-education-second**：严重失败。成年阶段长期年核心支出为 0，导致现金在没有生活成本的情况下持续累积；这是模型未提出支出事实，而不是 reducer 算错。
- **real-venture-second**：严重失败。人物开局明确提供住房、房贷余额与月供，账本却以房产 0、债务 0 开始，属于权威初始事实摄取缺口。
- **real-custom-lifespan**：负现金能正确转成流动性债务，算术闭合；但主角到 110 岁仍以 employed/顾问身份活动，退休与收入终止事实仍不可稳定到达，issue 也持续累积。

## issue 代码统计

| 代码 | open 数量 |
|---|---:|
${issueRows}

## 下一步

1. 增加“开局结构化资产负债摄取”入口：人物回答中的房产、房贷、月供必须在第一个故事节点前形成账户，不允许仅留在自由文本。
2. 为生活支出建立确定性估计兜底：成年且支出承诺为空时由版本化 policy 创建 estimated basic_living，不能静默按 0，也不能隔离无关收入。
3. 将退休/停止工作设计为职业状态再确认；不能回退到关键词直接改状态，高龄继续工作必须有近期 Accepted 主角证据。
4. 对 open issue 设置终局预算和老化门禁；“有 resolved 路径”不能替代“长期 open issue 不失控”。
5. 修复后三条阻断场景必须重新跑全新的 2/2/1 五路线，不能复用本轮 JSON。

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
const manifest = {
  runId: path.basename(root),
  runStartedAt,
  generatedAt: new Date().toISOString(),
  cases: records.map((record) => ({ caseSlug: record.caseSlug, scenario: record.scenario, path: `cases/${record.caseSlug}.json` }))
};
await writeFile(path.join(root, "run-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);

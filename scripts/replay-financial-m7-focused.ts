import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { HistoryItem, UserInitialData, WorldStateSnapshot } from "../src/types";
import { currentCareerState } from "../src/domain/career/careerState";
import {
  applyOpeningFactsToFinancialState,
  commitFinancialDomainTransaction,
  extractOpeningFinancialFacts,
  migrateLegacyFinancialState
} from "../src/domain/finance";

const root = path.resolve(process.argv[2]);
const casesDir = path.join(root, "cases");
const files = (await readdir(casesDir)).filter((name) => name.endsWith(".json")).sort();
const records = await Promise.all(files.map(async (name) => JSON.parse(await readFile(path.join(casesDir, name), "utf8"))));

const cases = [];
let totalNodes = 0;
let openingMortgageFacts = 0;
let openingMortgageCaptured = 0;
let missingExpenseNodes = 0;
let missingExpensePolicyFailures = 0;
let staleLateCareerNodes = 0;
let staleLateCareerPolicyFailures = 0;

for (const record of records) {
  const history: HistoryItem[] = record.finalState?.history || [];
  totalNodes += history.length;
  const userData = record.finalState?.userData as UserInitialData;
  const answers = record.finalState?.answers || [];
  const facts = extractOpeningFinancialFacts(userData, answers);
  const first = history[0];
  const firstCareerId = first?.worldStateSnapshot?.currentCareerStateId;
  let projectedOpening;
  if (first?.financialState) {
    const merged = applyOpeningFactsToFinancialState(first.financialState, facts);
    projectedOpening = migrateLegacyFinancialState({
      id: `replay_opening_${record.caseSlug}`,
      legacyState: merged,
      linkedCareerStateId: firstCareerId,
      openingFacts: facts
    });
  }
  if (facts.mortgagePrincipalWan !== undefined) {
    openingMortgageFacts += 1;
    if (projectedOpening?.debtAccounts.some((debt) => debt.type === "mortgage" && debt.principalWan === facts.mortgagePrincipalWan)
      && projectedOpening.assetAccounts.some((asset) => asset.type === "property")) openingMortgageCaptured += 1;
  }

  const nodeResults = [];
  for (const [index, node] of history.entries()) {
    const ledger = node.financialLedger;
    const world = node.worldStateSnapshot;
    if (!ledger || !world) continue;
    const activeExpense = ledger.expenseCommitments.some((item) => item.status === "active");
    const adultMissingExpense = (node.ageInMonths || node.age * 12) >= 18 * 12 && !activeExpense;
    const staleSources = ledger.incomeSources.filter((source) => (
      source.status === "active"
      && Boolean(source.linkedCareerStateId)
      && (node.ageInMonths || node.age * 12) >= 55 * 12
      && ledger.asOfAgeInMonths - (source.lastConfirmedAtAgeInMonths ?? source.activeFromAgeInMonths) >= 36
    ));
    if (adultMissingExpense) missingExpenseNodes += 1;
    if (staleSources.length) staleLateCareerNodes += 1;
    if (!adultMissingExpense && !staleSources.length) continue;

    const currentCareer = currentCareerState(world);
    if (!currentCareer) continue;
    try {
      const replayWorld: WorldStateSnapshot = structuredClone(world);
      const result = commitFinancialDomainTransaction({
        transactionId: `m7_focused_replay_${record.caseSlug}_${index}`,
        periodStartAgeInMonths: ledger.asOfAgeInMonths,
        periodEndAgeInMonths: ledger.asOfAgeInMonths + 1,
        expectedCareerRevision: replayWorld.careerRevision || 0,
        expectedLedgerRevision: ledger.revision,
        currentCareer: {
          careerStates: replayWorld.careerStates || [currentCareer],
          currentCareerStateId: currentCareer.id,
          careerRevision: replayWorld.careerRevision || 0
        },
        currentFinancialLedger: structuredClone(ledger),
        currentWorldState: replayWorld,
        acceptedCareerTransitions: [],
        acceptedFinancialEvents: [],
        liquidityPolicy: "auto_shortfall_debt"
      });
      if (adultMissingExpense) {
        const hasIssue = result.financialLedger.unresolvedIssues.some((issue) => issue.id === "pending_fact_missing_adult_expense" && issue.status !== "resolved");
        const unsafeIncome = result.financialLedger.incomeSources.some((source) => source.status === "active" && source.accrualPolicy !== "event_only" && source.accrualReviewStatus !== "quarantined");
        if (!hasIssue || unsafeIncome) missingExpensePolicyFailures += 1;
      }
      if (staleSources.length) {
        const unsafeStale = staleSources.some((source) => result.financialLedger.incomeSources.find((item) => item.id === source.id)?.accrualReviewStatus !== "quarantined");
        if (unsafeStale) staleLateCareerPolicyFailures += 1;
      }
      nodeResults.push({ node: index + 1, adultMissingExpense, staleCareerSourceIds: staleSources.map((source) => source.id), replayPassed: true });
    } catch (error) {
      if (adultMissingExpense) missingExpensePolicyFailures += 1;
      if (staleSources.length) staleLateCareerPolicyFailures += 1;
      nodeResults.push({ node: index + 1, adultMissingExpense, staleCareerSourceIds: staleSources.map((source) => source.id), replayPassed: false, error: error instanceof Error ? error.message : String(error) });
    }
  }
  cases.push({
    caseSlug: record.caseSlug,
    openingFacts: facts,
    projectedOpening: projectedOpening ? {
      cashWan: projectedOpening.cashAccounts.reduce((sum, item) => sum + item.balanceWan, 0),
      propertyAccounts: projectedOpening.assetAccounts.filter((item) => item.type === "property"),
      debtAccounts: projectedOpening.debtAccounts
    } : null,
    nodeResults
  });
}

const summary = {
  caseCount: cases.length,
  totalNodes,
  openingMortgageFacts,
  openingMortgageCaptured,
  missingExpenseNodes,
  missingExpensePolicyFailures,
  staleLateCareerNodes,
  staleLateCareerPolicyFailures,
  passed: openingMortgageCaptured === openingMortgageFacts
    && missingExpensePolicyFailures === 0
    && staleLateCareerPolicyFailures === 0
};
const output = { generatedAt: new Date().toISOString(), sourceRoot: root, summary, cases };
await writeFile(path.join(root, "m7-focused-replay.json"), `${JSON.stringify(output, null, 2)}\n`);
const markdown = `# 财务 M7 定向重放报告

## 结论

本报告使用上一轮 ${totalNodes} 个真实网页节点的完整账本快照作为输入，逐个调用当前版本的开局事实摄取和结算前完整性政策；它验证政策能否拦截旧数据中的已知缺口，不把旧结果冒充新网页结果。

| 指标 | 结果 |
|---|---:|
| 路线 | ${cases.length} |
| 节点 | ${totalNodes} |
| 明确房贷开局 / 新入口成功摄取 | ${openingMortgageFacts} / ${openingMortgageCaptured} |
| 成年支出缺失节点 / 政策失败 | ${missingExpenseNodes} / ${missingExpensePolicyFailures} |
| 晚年工资过期节点 / 政策失败 | ${staleLateCareerNodes} / ${staleLateCareerPolicyFailures} |

重放结论：**${summary.passed ? "通过" : "失败"}**。

注意：重放只能证明旧缺口会被新政策捕获；Prompt 的真实输出质量仍由三组短网页测试验证。
`;
await writeFile(path.join(root, "m7-focused-replay.md"), markdown);
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);

import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeFinancialBaseline,
  compareBaselineManifest
} from "./analyze-financial-ledger-baseline.mjs";

function node(overrides = {}) {
  const { financialState: financialOverrides, ...nodeOverrides } = overrides;
  return {
    age: 36,
    title: "测试节点",
    description: "普通生活继续",
    financialState: {
      cashWan: 10,
      investmentAssetsWan: 5,
      propertyMarketValueWan: 0,
      businessAndOtherAssetsWan: 0,
      totalDebtWan: 0,
      netWorthWan: 15,
      annualAfterTaxIncomeWan: 12,
      annualDisposableIncomeWan: 6,
      annualCoreExpenseWan: 6,
      employmentStatus: "employed",
      ...financialOverrides
    },
    ...nodeOverrides
  };
}

function record(caseSlug, history, report = {}) {
  return { caseSlug, finalState: { history, outcome: { report } } };
}

test("counts the P0 financial baseline categories", () => {
  const history = [
    node({
      age: 38,
      description: "你在职攻读在线MBA，公司工作照常。",
      financialState: {
        employmentStatus: "student",
        annualCoreExpenseWan: 1.2,
        annualDisposableIncomeWan: -1,
        cashWan: -2,
        investmentAssetsWan: 0,
        totalDebtWan: 0,
        netWorthWan: -2
      }
    }),
    node({
      description: "公司完成A轮融资，估值提升。",
      financialState: { totalDebtWan: 3, netWorthWan: 12 }
    }),
    node({ financialState: { totalDebtWan: 3, netWorthWan: 12 } }),
    node({ financialState: { totalDebtWan: 3, netWorthWan: 12 } })
  ];
  const analysis = analyzeFinancialBaseline([
    record("case-a", history, { summary: "你留下的不是巨额财富" }),
    record("case-b", [node({
      age: 36,
      financialState: { employmentStatus: "retired", cashWan: 1001, netWorthWan: 1006 }
    })], { summary: "你留下的不是巨额财富" })
  ]);

  assert.equal(analysis.metrics.caseCount, 2);
  assert.equal(analysis.metrics.totalNodes, 5);
  assert.equal(analysis.metrics.employment.studentNodes, 1);
  assert.equal(analysis.metrics.employment.retiredUnder50Nodes, 1);
  assert.equal(analysis.metrics.expenses.annualCoreExpense1_2Nodes, 1);
  assert.equal(analysis.metrics.cashFlow.negativeCashWithoutDebtNodes, 1);
  assert.equal(analysis.metrics.debt.staticDebtRunCases, 1);
  assert.equal(analysis.metrics.business.narrativeNodes, 1);
  assert.equal(analysis.metrics.business.positiveBusinessAssetNodes, 0);
  assert.equal(analysis.metrics.accounting.netWorthIdentityMismatchNodes, 0);
  assert.equal(analysis.metrics.reports.highNetWorthDenialCases, 1);
});

test("detects net worth identity mismatches", () => {
  const analysis = analyzeFinancialBaseline([
    record("case-a", [node({ financialState: { netWorthWan: 999 } })])
  ]);

  assert.equal(analysis.metrics.accounting.netWorthIdentityMismatchNodes, 1);
  assert.equal(analysis.evidence.netWorthIdentityMismatchNodes[0].calculatedNetWorthWan, 15);
});

test("manifest comparison locks both source hashes and expected metrics", () => {
  const current = {
    sourceFiles: [{ file: "cases/a.json", sha256: "abc", historyNodeCount: 1 }],
    metrics: { totalNodes: 1 }
  };
  const manifest = { sourceFiles: current.sourceFiles, expectedMetrics: current.metrics };

  assert.deepEqual(compareBaselineManifest(manifest, current), []);
  assert.deepEqual(
    compareBaselineManifest(manifest, { ...current, metrics: { totalNodes: 2 } }),
    ["expectedMetrics changed"]
  );
  assert.deepEqual(
    compareBaselineManifest(manifest, { ...current, sourceFiles: [] }),
    ["sourceFiles or hashes changed"]
  );
});

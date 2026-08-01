import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, "analyze-financial-real-browser-run.mjs");

function runNode(args, cwd) {
  return new Promise((resolve, reject) => execFile(process.execPath, args, { cwd }, (error, stdout, stderr) => (
    error ? reject(Object.assign(error, { stdout, stderr })) : resolve({ stdout, stderr })
  )));
}

function responsibilityCommitment() {
  return {
    id: "housing_main",
    responsibilityKey: "primary_residence:main",
    responsibilityKind: "primary_residence",
    type: "housing",
    monthlyAmountWan: 0.5,
    financialScope: "personal",
    status: "active",
    activeFromAgeInMonths: 360,
    evidence: [{ source: "user", reasonCode: "OPENING_RENT", confidence: 1, financialScope: "personal" }]
  };
}

function record() {
  return {
    caseSlug: "audit-responsibility-case",
    scenario: "accept-first",
    passed: true,
    startedAt: "2026-08-01T00:00:00.000Z",
    completedAt: "2026-08-01T00:01:00.000Z",
    finalState: {
      invitations: [],
      history: [{
        title: "起点",
        description: "日常生活继续。",
        ageInMonths: 360,
        attributes: { wealth: 50 },
        financialLedger: {
          asOfAgeInMonths: 360,
          version: 4,
          cashAccounts: [{ id: "cash", status: "active", balanceWan: 10, evidence: [] }],
          assetAccounts: [], debtAccounts: [], incomeSources: [], businessHoldings: [],
          expenseCommitments: [responsibilityCommitment()],
          recentTransactions: [], committedTransactionIds: [], unresolvedIssues: []
        },
        financialState: {
          asOfAgeInMonths: 360,
          cashWan: 10, investmentAssetsWan: 0, propertyMarketValueWan: 0, businessAndOtherAssetsWan: 0,
          totalDebtWan: 0, netWorthWan: 10,
          annualAfterTaxIncomeWan: 0, annualCoreExpenseWan: 6, annualDisposableIncomeWan: -6,
          employmentStatus: "not_working"
        },
        financialProcessingMeta: { expenseLifecycleTriggerCount: 0, expenseLifecycleCoveredTriggerCount: 0 }
      }]
    }
  };
}

function recordWithGeneratedGateMode(mode) {
  const result = record();
  const opening = result.finalState.history[0];
  result.finalState.history.push({
    ...opening,
    ageInMonths: 372,
    financialLedger: { ...opening.financialLedger, asOfAgeInMonths: 372 },
    financialState: { ...opening.financialState, asOfAgeInMonths: 372 },
    financialProcessingMeta: {
      expenseLifecycleTriggerCount: 0,
      expenseLifecycleCoveredTriggerCount: 0,
      ...(mode === undefined ? {} : { financialGateMode: mode })
    }
  });
  return result;
}

test("real-browser analyzer reports responsibility 0/0 as not_covered, never 100", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "financial-expense-audit-"));
  try {
    await mkdir(path.join(root, "cases"));
    await writeFile(path.join(root, "cases", "case.json"), `${JSON.stringify(record())}\n`);
    await writeFile(path.join(root, "expense-responsibility-annotations.json"), `${JSON.stringify({ annotations: [] })}\n`);
    await runNode([script, root], here);
    const audit = JSON.parse(await readFile(path.join(root, "finance-audit.json"), "utf8"));
    assert.equal(audit.summary.machineDetectedResponsibilityHandlingRatePct, null);
    assert.equal(audit.summary.machineDetectedResponsibilityHandlingStatus, "not_covered");
    assert.equal(audit.summary.coverageStatus, "not_covered");
    assert.equal(audit.summary.precisionStatus, "not_covered");
    assert.equal(audit.summary.expenseResponsibilityRecallPct, null);
    assert.equal(audit.summary.expenseResponsibilityPrecisionPct, null);
    assert.equal("adultResponsibilityExpenseCoverageRatePct" in audit.summary, false);
    assert.equal(audit.summary.annualCoreExpenseDistributionStatus, "observed");
    assert.equal(audit.summary.annualCoreExpenseModeWan, 6);
    assert.equal(audit.summary.routeCumulativeFinancialsStatus, "not_covered");
    assert.equal(audit.summary.cumulativeIncomeWan, null);
    assert.equal(audit.summary.familyResponsibilityRunRateWindowStatus, "not_covered");
    assert.equal(audit.expenseLifecycleDynamicAudit.details.routeDiagnostics[0].terminalExpenseState.finalFactStatus, "unknown");
    const report = await readFile(path.join(root, "evaluation-report.md"), "utf8");
    assert.match(report, /独立责任覆盖状态\s*\| not_covered \/ not_covered/u);
    assert.doesNotMatch(report, /成年责任支出覆盖率/u);
    assert.match(report, /长期支出与财富诊断/u);
    assert.match(report, /按路线累计现金流/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("real-browser analyzer blocks generated commits that were not processed by the enforced gate", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "financial-expense-audit-"));
  try {
    await mkdir(path.join(root, "cases"));
    await writeFile(path.join(root, "cases", "case.json"), `${JSON.stringify(recordWithGeneratedGateMode("shadow"))}\n`);
    await writeFile(path.join(root, "expense-responsibility-annotations.json"), `${JSON.stringify({ annotations: [] })}\n`);
    await runNode([script, root], here);
    const audit = JSON.parse(await readFile(path.join(root, "finance-audit.json"), "utf8"));
    const aggregate = JSON.parse(await readFile(path.join(root, "aggregate.json"), "utf8"));
    assert.equal(audit.summary.financialGateEnforcedCommittedNodeCount, 0);
    assert.equal(audit.summary.financialGateNonEnforcedCommittedNodeCount, 1);
    assert.equal(audit.summary.financialGateModeMissingCommittedNodeCount, 0);
    assert.equal(aggregate.releaseCandidate, false);
    assert.ok(aggregate.blockers.some((blocker) => blocker.includes("未使用 enforced 财务接受门")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("real-browser analyzer blocks a generated node with no gate-mode evidence", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "financial-expense-audit-"));
  try {
    await mkdir(path.join(root, "cases"));
    await writeFile(path.join(root, "cases", "case.json"), `${JSON.stringify(recordWithGeneratedGateMode(undefined))}\n`);
    await writeFile(path.join(root, "expense-responsibility-annotations.json"), `${JSON.stringify({ annotations: [] })}\n`);
    await runNode([script, root], here);
    const audit = JSON.parse(await readFile(path.join(root, "finance-audit.json"), "utf8"));
    const aggregate = JSON.parse(await readFile(path.join(root, "aggregate.json"), "utf8"));
    assert.equal(audit.summary.financialGateEnforcedCommittedNodeCount, 0);
    assert.equal(audit.summary.financialGateNonEnforcedCommittedNodeCount, 0);
    assert.equal(audit.summary.financialGateModeMissingCommittedNodeCount, 1);
    assert.ok(aggregate.blockers.some((blocker) => blocker.includes("缺少财务接受门模式证据")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("real-browser analyzer loads independent annotations and reports their recall/precision", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "financial-expense-audit-"));
  try {
    await mkdir(path.join(root, "cases"));
    await writeFile(path.join(root, "cases", "case.json"), `${JSON.stringify(record())}\n`);
    await writeFile(path.join(root, "expense-responsibility-annotations.json"), `${JSON.stringify({
      corpusId: "fresh-diagnostic",
      corpusKind: "fresh_diagnostic",
      annotations: [{
        caseSlug: "audit-responsibility-case", nodeIndex: 0, evidenceExcerpt: "承担房租",
        expectedAction: "start", expectedType: "housing", expectedScope: "personal",
        expectedResponsibilityKey: "primary_residence:main", expectedMonthlyAmountWan: 0.5,
        material: true, reviewer: "human"
      }]
    })}\n`);
    await runNode([script, root], here);
    const audit = JSON.parse(await readFile(path.join(root, "finance-audit.json"), "utf8"));
    assert.equal(audit.summary.expenseResponsibilityAnnotatedCandidateCount, 1);
    assert.equal(audit.summary.expenseResponsibilityDetectedCandidateCount, 1);
    assert.equal(audit.summary.expenseResponsibilityRecallPct, 100);
    assert.equal(audit.summary.expenseResponsibilityPrecisionPct, 100);
    assert.equal(audit.summary.coverageStatus, "covered");
    assert.equal(audit.expenseResponsibilityAudit.annotationSource.corpusId, "fresh-diagnostic");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("real-browser analyzer emits lifecycle candidate trace match diagnostics without using annotations at generation time", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "financial-expense-audit-"));
  try {
    await mkdir(path.join(root, "cases"));
    const traceRecord = record();
    traceRecord.finalState.history[0].financialProcessingMeta = {
      expenseLifecycleTriggerCount: 1,
      expenseLifecycleCoveredTriggerCount: 0,
      expenseLifecycleTelemetry: {
        mode: "shadow",
        wouldBlock: false,
        candidates: [{
          candidateId: "trace_housing",
          responsibilityKey: "primary_residence:main",
          responsibilityKind: "primary_residence",
          proposedType: "housing",
          financialScope: "personal",
          action: "start",
          liability: "protagonist",
          source: "accepted_outcome",
          amountBasis: "explicit_protagonist_share",
          sourceMonthlyAmountWan: 0.5,
          sourceGrossMonthlyAmountWan: 0.5,
          evidenceReasonCodes: ["OPENING_RENT"],
          reconcilerDisposition: "planned_start",
          reconcilerReasonCodes: ["NEW_RESPONSIBILITY_COMMITMENT"],
          relatedProposalIds: ["system_expense_start_trace_housing"],
          relatedIssueIds: [],
          wouldBlock: false
        }]
      }
    };
    await writeFile(path.join(root, "cases", "case.json"), `${JSON.stringify(traceRecord)}\n`);
    await writeFile(path.join(root, "expense-responsibility-annotations.json"), `${JSON.stringify({
      corpusId: "trace-diagnostic",
      corpusKind: "fresh_diagnostic",
      annotations: [{
        caseSlug: "audit-responsibility-case", nodeIndex: 0, evidenceExcerpt: "承担房租",
        expectedAction: "start", expectedType: "housing", expectedScope: "personal",
        expectedResponsibilityKey: "primary_residence:main", expectedMonthlyAmountWan: 0.5,
        material: true, reviewer: "human"
      }]
    })}\n`);
    await runNode([script, root], here);
    const audit = JSON.parse(await readFile(path.join(root, "finance-audit.json"), "utf8"));
    assert.equal(audit.summary.expenseLifecycleCandidateTelemetryStatus, "observed");
    assert.equal(audit.summary.expenseLifecycleCandidateTelemetryRecordCount, 1);
    assert.equal(audit.summary.expenseLifecycleCandidateTelemetryMatchCount, 1);
    assert.equal(audit.summary.expenseLifecycleCandidateTelemetryMissedCount, 0);
    assert.equal(audit.summary.expenseLifecycleCandidateTelemetryFalsePositiveCount, 0);
    assert.equal(audit.summary.expenseLifecycleCandidateTelemetryRecallPct, 100);
    assert.equal(audit.expenseLifecycleCandidateTelemetryAudit.details.matches[0].candidate.candidateId, "trace_housing");
    const report = await readFile(path.join(root, "evaluation-report.md"), "utf8");
    assert.match(report, /V4 候选 trace 与独立标注对照/u);
    assert.match(report, /shadow 和 enforced 使用同一套候选与判定/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("real-browser analyzer rejects a partial frozen corpus instead of treating its green sample as release coverage", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "financial-expense-audit-"));
  try {
    await mkdir(path.join(root, "cases"));
    await writeFile(path.join(root, "cases", "case.json"), `${JSON.stringify(record())}\n`);
    await writeFile(path.join(root, "expense-responsibility-annotations.json"), `${JSON.stringify({
      corpusId: "partial-gold",
      corpusKind: "frozen_gold",
      annotations: [{
        caseSlug: "audit-responsibility-case", nodeIndex: 0, evidenceExcerpt: "承担房租",
        expectedAction: "start", expectedType: "housing", expectedScope: "personal",
        expectedResponsibilityKey: "primary_residence:main", expectedMonthlyAmountWan: 0.5,
        material: true, reviewer: "human"
      }]
    })}\n`);
    await runNode([script, root], here);
    const audit = JSON.parse(await readFile(path.join(root, "finance-audit.json"), "utf8"));
    assert.equal(audit.summary.expenseResponsibilityCorpusCoverageStatus, "insufficient_coverage");
    assert.equal(audit.summary.expenseResponsibilityRecallPct, 100);
    const aggregate = JSON.parse(await readFile(path.join(root, "aggregate.json"), "utf8"));
    assert.equal(aggregate.releaseCandidate, false);
    const report = await readFile(path.join(root, "evaluation-report.md"), "utf8");
    assert.match(report, /冻结支出责任语料样本不足/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

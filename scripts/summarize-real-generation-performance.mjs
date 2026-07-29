import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { auditFinancialProductionRecords } from "./lib/financial-production-audit.mjs";

const [recordRoot, baselinePath] = process.argv.slice(2);
if (!recordRoot || !baselinePath) {
  throw new Error("Usage: node scripts/summarize-real-generation-performance.mjs <record-root> <baseline-comparison.json>");
}

const expectedCases = [
  "real-career-first-r1",
  "real-career-first-r2",
  "real-career-first-r3",
  "real-relationship-first-r1",
  "real-relationship-first-r2",
  "real-relationship-first-r3",
  "real-venture-second-r1",
  "real-venture-second-r2",
  "real-venture-second-r3"
];

function percentile(values, ratio) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
}

const caseDir = path.join(recordRoot, "cases");
const caseNames = (await readdir(caseDir)).filter((name) => name.endsWith(".json"));
const missingCases = expectedCases.filter((slug) => !caseNames.includes(`${slug}.json`));
if (missingCases.length) throw new Error(`Missing completed cases: ${missingCases.join(", ")}`);

const records = await Promise.all(expectedCases.map(async (slug) => (
  JSON.parse(await readFile(path.join(caseDir, `${slug}.json`), "utf8"))
)));
const productionAudit = auditFinancialProductionRecords(records.map((record) => ({
  ...record,
  finalState: record.latestState
})));
const baselineRecord = JSON.parse(await readFile(baselinePath, "utf8"));
const samples = records.flatMap((record) => record.performanceNodeSamples ?? []);
const traces = records.flatMap((record) => (record.latestState?.generationCallTraces ?? [])
  .filter((trace) => trace.outcome !== "started")
  .map((trace) => ({ ...trace, caseSlug: record.caseSlug })));
const patchTraces = traces.filter((trace) => trace.kind === "candidate_patch" || trace.kind === "proposal_repair");
const candidatePatchTraces = traces.filter((trace) => trace.kind === "candidate_patch");
const transactionPatchCounts = new Map();
for (const trace of patchTraces) {
  const key = `${trace.caseSlug}:${trace.transactionId ?? trace.nodeIndex}`;
  transactionPatchCounts.set(key, (transactionPatchCounts.get(key) ?? 0) + 1);
}

const fullGenerationCount = (sample) => (sample.callKinds ?? [])
  .filter((kind) => kind === "initial_generation" || kind === "full_regeneration").length;
const fullRegenerationNodes = samples.filter((sample) => fullGenerationCount(sample) > 1).length;
const singleFullGenerationNodes = samples.filter((sample) => fullGenerationCount(sample) === 1).length;
const latencies = samples.map((sample) => Number(sample.elapsedMs ?? 0));
const baseline = {
  source: baselinePath,
  nodeCount: Number(baselineRecord.summaries?.main?.nodeCount ?? 0),
  p90LatencyMs: Number(baselineRecord.summaries?.main?.p90ModelSpanMs ?? 0),
  fullRegenerationRate: Number(baselineRecord.summaries?.main?.regenerationNodeRate ?? 0) / 100,
  visiblePauseCount: Number(baselineRecord.summaries?.main?.visiblePauseCount ?? 0)
};
const candidatePatchSucceeded = candidatePatchTraces.filter((trace) => trace.outcome === "succeeded").length;
const candidate = {
  routeCount: records.length,
  nodeCount: samples.length,
  p50LatencyMs: percentile(latencies, 0.5),
  p90LatencyMs: percentile(latencies, 0.9),
  maxLatencyMs: Math.max(...latencies),
  fullRegenerationNodeCount: fullRegenerationNodes,
  fullRegenerationRate: samples.length ? fullRegenerationNodes / samples.length : 0,
  singleFullGenerationNodeCount: singleFullGenerationNodes,
  singleFullGenerationRate: samples.length ? singleFullGenerationNodes / samples.length : 0,
  maxModelPatchCallsPerTransaction: Math.max(0, ...transactionPatchCounts.values()),
  candidatePatchCallCount: candidatePatchTraces.length,
  candidatePatchSucceeded,
  candidatePatchFailed: candidatePatchTraces.length - candidatePatchSucceeded,
  candidatePatchSuccessRate: candidatePatchTraces.length ? candidatePatchSucceeded / candidatePatchTraces.length : 1,
  proposalRepairCallCount: traces.filter((trace) => trace.kind === "proposal_repair").length,
  visiblePauseCount: records.reduce((sum, record) => sum + (record.latestState?.generationEvents ?? [])
    .filter((event) => event.type === "visible_pause").length, 0),
  unclassifiedCallCount: samples.reduce((sum, sample) => sum + (sample.callKinds ?? [])
    .filter((kind) => kind === "unknown").length, 0)
};
const authorityRegressionKeys = [
  "userVisibleInternalLedgerTextCount",
  "finalReportFinancialConflictCount",
  "unexplainedDebtDeltaNodeCount",
  "fabricatedOpeningAccountCount",
  "assetSummaryMismatchNodeCount",
  "debtConservationFailureCount",
  "autoShortfallFrozenAboveReserveNodeCount",
  "knownRateInterestOmissionNodeCount",
  "unsupportedRepaymentCompletionNodeCount",
  "userVisibleFinancialPlaceholderCount",
  "orphanFinancialAmountCount",
  "financialAmountPrecisionViolationCount",
  "crossJourneyInvitationEntryCount",
  "companyOperatingFlowInPersonalLedgerCount",
  "visibleGenerationPauseCount",
  "unclassifiedGenerationCallCount",
  "excessivePatchNodeCount"
];
const authorityRegressionCount = authorityRegressionKeys.reduce((sum, key) => (
  sum + Number(productionAudit.summary[key] ?? 0)
), 0);
const checks = {
  routeAndNodeCount: candidate.routeCount === 9 && candidate.nodeCount === 180,
  p90Latency: candidate.p90LatencyMs <= baseline.p90LatencyMs * 1.1,
  fullRegenerationRate: candidate.fullRegenerationRate <= baseline.fullRegenerationRate + 0.05,
  singleFullGenerationRate: candidate.singleFullGenerationRate >= 0.9,
  modelPatchBudget: candidate.maxModelPatchCallsPerTransaction <= 1,
  patchSuccessRate: candidate.candidatePatchSuccessRate >= 0.5,
  visiblePause: candidate.visiblePauseCount === 0,
  unclassifiedCalls: candidate.unclassifiedCallCount === 0,
  authorityRegressions: authorityRegressionCount === 0
};
const result = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  runId: path.basename(recordRoot),
  methodology: {
    dataSource: "real_ai_browser",
    personas: ["ordinary_career", "relationship_health", "financial_venture"],
    roundsPerPersona: 3,
    nodesPerRound: 20,
    candidateTiming: "visible node advance elapsed time",
    baselineTiming: "first model request start through last model request end"
  },
  baseline,
  candidate,
  productionAudit: {
    authorityRegressionCount,
    summary: productionAudit.summary
  },
  checks,
  passed: Object.values(checks).every(Boolean),
  routes: records.map((record) => ({
    caseSlug: record.caseSlug,
    historyLength: record.latestState?.history?.length ?? 0,
    sampleCount: record.performanceNodeSamples?.length ?? 0,
    updatedAt: record.updatedAt,
    complete: record.complete === true
  }))
};

await writeFile(path.join(recordRoot, "performance-summary.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
if (!result.passed) process.exitCode = 1;
console.log(JSON.stringify(result, null, 2));

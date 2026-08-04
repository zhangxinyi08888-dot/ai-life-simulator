import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

function percent(value) {
  return typeof value === "number" && Number.isFinite(value) ? `${(value * 100).toFixed(2)}%` : "—";
}

function numeric(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function comparison(name, actual, expected, passes) {
  return { name, actual, expected, status: actual === undefined ? "missing" : passes ? "pass" : "fail" };
}

/**
 * Evaluate a fresh Cache Prefix V1 browser run against a separately collected
 * baseline. Missing request-level usage is a failure, never a silent pass.
 */
export function evaluateCachePrefixAcceptance(baselineTelemetry, candidateTelemetry) {
  const baseline = baselineTelemetry?.summary ?? {};
  const candidate = candidateTelemetry?.summary ?? {};
  const candidateWarm = candidate.warmCache ?? {};
  const baselineMissPerNode = numeric(baseline.cacheMissTokensPerAcceptedNode);
  const candidateMissPerNode = numeric(candidate.cacheMissTokensPerAcceptedNode);
  const baselinePromptPerNode = numeric(baseline.promptTokensPerAcceptedNode);
  const candidatePromptPerNode = numeric(candidate.promptTokensPerAcceptedNode);
  const baselineFirstPass = numeric(baseline.firstGenerationPassRate);
  const candidateFirstPass = numeric(candidate.firstGenerationPassRate);
  const baselineRetry = numeric(baseline.fullRetryPerAcceptedNode);
  const candidateRetry = numeric(candidate.fullRetryPerAcceptedNode);
  const baselineFailure = numeric(baseline.validationFailureRate);
  const candidateFailure = numeric(candidate.validationFailureRate);
  const baselineP95 = numeric(baseline.firstTokenP95Ms);
  const candidateP95 = numeric(candidate.firstTokenP95Ms);
  const candidateRouteCount = numeric(candidate.routeCount);
  const baselineRouteCompletion = numeric(baseline.routeCompletionRate);
  const candidateRouteCompletion = numeric(candidate.routeCompletionRate);
  const checks = [
    comparison("candidate next-node calls >= 30", numeric(candidate.callCount), 30, (numeric(candidate.callCount) ?? -1) >= 30),
    comparison("candidate has >= 2 completed real-browser routes", candidateRouteCount, 2, (candidateRouteCount ?? -1) >= 2 && candidateRouteCompletion === 1),
    comparison("warm-cache input hit rate >= 70%", numeric(candidateWarm.inputCacheHitRate), 0.7, (numeric(candidateWarm.inputCacheHitRate) ?? -1) >= 0.7),
    comparison("cache miss tokens per accepted node reduces >= 40%", candidateMissPerNode, baselineMissPerNode === undefined ? undefined : baselineMissPerNode * 0.6, baselineMissPerNode !== undefined && candidateMissPerNode !== undefined && candidateMissPerNode <= baselineMissPerNode * 0.6),
    comparison("prompt tokens per accepted node grows <= 2%", candidatePromptPerNode, baselinePromptPerNode === undefined ? undefined : baselinePromptPerNode * 1.02, baselinePromptPerNode !== undefined && candidatePromptPerNode !== undefined && candidatePromptPerNode <= baselinePromptPerNode * 1.02),
    comparison("first-generation pass rate no worse than baseline -5pp", candidateFirstPass, baselineFirstPass === undefined ? undefined : baselineFirstPass - 0.05, baselineFirstPass !== undefined && candidateFirstPass !== undefined && candidateFirstPass >= baselineFirstPass - 0.05),
    comparison("full retry rate does not increase", candidateRetry, baselineRetry, baselineRetry !== undefined && candidateRetry !== undefined && candidateRetry <= baselineRetry),
    comparison("validation failure rate does not increase", candidateFailure, baselineFailure, baselineFailure !== undefined && candidateFailure !== undefined && candidateFailure <= baselineFailure),
    comparison("first-token p95 does not worsen", candidateP95, baselineP95, baselineP95 !== undefined && candidateP95 !== undefined && candidateP95 <= baselineP95),
    comparison("route completion rate does not decrease", candidateRouteCompletion, baselineRouteCompletion, baselineRouteCompletion !== undefined && candidateRouteCompletion !== undefined && candidateRouteCompletion >= baselineRouteCompletion)
  ];
  return {
    verdict: checks.every((check) => check.status === "pass") ? "pass" : "fail",
    checks,
    metrics: {
      baseline: {
        inputCacheHitRate: baseline.inputCacheHitRate,
        cacheMissTokensPerAcceptedNode: baselineMissPerNode,
        promptTokensPerAcceptedNode: baselinePromptPerNode,
        firstGenerationPassRate: baselineFirstPass,
        fullRetryPerAcceptedNode: baselineRetry,
        validationFailureRate: baselineFailure,
        firstTokenP95Ms: baselineP95,
        routeCompletionRate: baselineRouteCompletion
      },
      candidate: {
        warmCacheInputHitRate: candidateWarm.inputCacheHitRate,
        cacheMissTokensPerAcceptedNode: candidateMissPerNode,
        promptTokensPerAcceptedNode: candidatePromptPerNode,
        firstGenerationPassRate: candidateFirstPass,
        fullRetryPerAcceptedNode: candidateRetry,
        validationFailureRate: candidateFailure,
        firstTokenP95Ms: candidateP95,
        routeCompletionRate: candidateRouteCompletion
      }
    }
  };
}

async function loadTelemetry(root) {
  const cachePath = path.join(root, "cache-telemetry.json");
  try {
    return JSON.parse(await readFile(cachePath, "utf8"));
  } catch {
    const financialAudit = JSON.parse(await readFile(path.join(root, "finance-audit.json"), "utf8"));
    if (!financialAudit.cacheTelemetry) throw new Error(`missing cache telemetry at ${root}`);
    return financialAudit.cacheTelemetry;
  }
}

function cliArgument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const baselineRoot = cliArgument("--baseline");
  const candidateRoot = cliArgument("--candidate");
  if (!baselineRoot || !candidateRoot) {
    throw new Error("usage: node scripts/analyze-cache-prefix-acceptance.mjs --baseline <run-root> --candidate <run-root>");
  }
  const [baseline, candidate] = await Promise.all([loadTelemetry(path.resolve(baselineRoot)), loadTelemetry(path.resolve(candidateRoot))]);
  const report = evaluateCachePrefixAcceptance(baseline, candidate);
  const outputPath = path.join(path.resolve(candidateRoot), "cache-prefix-acceptance.json");
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${report.verdict.toUpperCase()} Cache Prefix V1\n`);
  for (const check of report.checks) {
    process.stdout.write(`${check.status.toUpperCase()} ${check.name}: actual=${typeof check.actual === "number" && check.name.includes("rate") ? percent(check.actual) : check.actual ?? "—"}, expected=${typeof check.expected === "number" && check.name.includes("rate") ? percent(check.expected) : check.expected ?? "—"}\n`);
  }
  if (report.verdict !== "pass") process.exitCode = 1;
}

function percentile(values, percentileValue) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(percentileValue * sorted.length) - 1));
  return sorted[index];
}

function traceGroupKey(trace) {
  return `${trace.caseSlug ?? "unknown"}:${trace.transactionId ?? trace.nodeIndex ?? trace.traceId ?? "unknown"}`;
}

export function summarizeCandidatePatchEffectiveness(inputTraces) {
  const traces = inputTraces.filter((trace) => trace.outcome !== "started");
  const groups = new Map();
  for (const trace of traces) {
    const key = traceGroupKey(trace);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(trace);
  }
  const patches = traces.filter((trace) => trace.kind === "candidate_patch");
  const contractSucceeded = patches.filter((trace) => trace.outcome === "succeeded").length;
  const effective = patches.filter((patch) => (
    patch.outcome === "succeeded"
    && !(groups.get(traceGroupKey(patch)) ?? []).some((trace) => (
      trace.kind === "full_regeneration"
      && Date.parse(trace.startedAt ?? "") >= Date.parse(patch.startedAt ?? "")
    ))
  )).length;
  const fullRegenerations = traces.filter((trace) => trace.kind === "full_regeneration");
  const fullRegenerationWithoutReasonCount = fullRegenerations
    .filter((trace) => !Array.isArray(trace.issueCodes) || trace.issueCodes.length === 0)
    .length;
  return {
    candidatePatchCallCount: patches.length,
    candidatePatchContractSucceeded: contractSucceeded,
    candidatePatchContractSuccessRate: patches.length ? contractSucceeded / patches.length : 1,
    candidatePatchEffectiveCount: effective,
    candidatePatchEffectiveRate: patches.length ? effective / patches.length : 1,
    fullRegenerationWithoutReasonCount
  };
}

export function summarizeGenerationPerformance(records) {
  const nodes = records.flatMap((record) => record.nodes || []);
  const latencies = nodes.map((node) => Number(node.totalModelLatencyMs || 0));
  const fullRegenerated = nodes.filter((node) => Number(node.fullGenerationCount || 0) > 1).length;
  const singleFull = nodes.filter((node) => Number(node.fullGenerationCount || 0) === 1).length;
  return {
    nodeCount: nodes.length,
    p90LatencyMs: percentile(latencies, 0.9),
    fullRegenerationRate: nodes.length ? fullRegenerated / nodes.length : 0,
    singleFullGenerationRate: nodes.length ? singleFull / nodes.length : 1,
    maxModelPatchCount: nodes.reduce((maximum, node) => Math.max(maximum, Number(node.modelPatchCount || 0)), 0),
    visiblePauseCount: nodes.filter((node) => node.visiblePause === true).length,
    unclassifiedCallCount: nodes.reduce((sum, node) => sum + Number(node.unclassifiedCallCount || 0), 0)
  };
}

export function evaluateGenerationPerformanceGate({ baseline, candidate }) {
  const failures = [];
  if (candidate.p90LatencyMs > baseline.p90LatencyMs * 1.1) failures.push("P90_LATENCY_REGRESSION");
  if (candidate.fullRegenerationRate > baseline.fullRegenerationRate + 0.05) failures.push("FULL_REGENERATION_RATE_REGRESSION");
  if (candidate.singleFullGenerationRate < 0.9) failures.push("SINGLE_FULL_GENERATION_RATE_LOW");
  if (candidate.maxModelPatchCount > 1) failures.push("MODEL_PATCH_BUDGET_EXCEEDED");
  if (candidate.visiblePauseCount > 0) failures.push("VISIBLE_GENERATION_PAUSE");
  if (candidate.unclassifiedCallCount > 0) failures.push("UNCLASSIFIED_GENERATION_CALL");
  if (Number(candidate.candidatePatchCallCount || 0) > 0 && candidate.candidatePatchEffectiveRate < 0.5) {
    failures.push("CANDIDATE_PATCH_EFFECTIVE_RATE_LOW");
  }
  if (Number(candidate.fullRegenerationWithoutReasonCount || 0) > 0) {
    failures.push("FULL_REGENERATION_REASON_MISSING");
  }
  return { passed: failures.length === 0, failures };
}

function percentile(values, percentileValue) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(percentileValue * sorted.length) - 1));
  return sorted[index];
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
  return { passed: failures.length === 0, failures };
}

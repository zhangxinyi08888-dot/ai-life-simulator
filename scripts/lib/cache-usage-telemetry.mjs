function finite(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function percentile(values, ratio) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((left, right) => left - right);
  if (sorted.length === 0) return undefined;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return sorted[index];
}

function latencyMs(trace) {
  if (finite(trace.firstTokenLatencyMs) !== undefined) return trace.firstTokenLatencyMs;
  if (!trace.startedAt || !trace.firstTokenAt) return undefined;
  const started = Date.parse(trace.startedAt);
  const firstToken = Date.parse(trace.firstTokenAt);
  return Number.isFinite(started) && Number.isFinite(firstToken) ? Math.max(0, firstToken - started) : undefined;
}

function completedTraces(record) {
  const terminalById = new Map();
  for (const trace of record?.finalState?.generationCallTraces ?? record?.latestState?.generationCallTraces ?? []) {
    if (!trace || trace.outcome === "started") continue;
    const key = trace.traceId || `${trace.transactionId || "unknown"}:${trace.nodeIndex ?? "unknown"}:${trace.kind || "unknown"}:${terminalById.size}`;
    terminalById.set(key, trace);
  }
  return [...terminalById.values()];
}

function traceGroupKey(trace) {
  return [trace.kind || "unknown", trace.promptFamily || "unclassified", trace.promptPrefixVersion || "unversioned"].join("|");
}

function aggregateTraces(traces, acceptedNextNodeCount) {
  const usageTraces = traces.filter((trace) => finite(trace.promptTokens) !== undefined);
  const sum = (field) => usageTraces.reduce((total, trace) => total + (finite(trace[field]) ?? 0), 0);
  const promptTokens = sum("promptTokens");
  const cacheHitTokens = sum("cacheHitTokens");
  const cacheMissTokens = sum("cacheMissTokens");
  const completionTokens = sum("completionTokens");
  const firstTokenLatencies = traces.map(latencyMs).filter((value) => value !== undefined);
  const nextNodeCalls = traces.filter((trace) => trace.kind === "initial_generation" || trace.kind === "full_regeneration");
  const failedNextNodeCallCount = nextNodeCalls.filter((trace) => trace.outcome === "failed" || trace.outcome === "aborted").length;
  const fullRetryCount = traces.filter((trace) => trace.kind === "full_regeneration").length;
  return {
    callCount: traces.length,
    usageCallCount: usageTraces.length,
    promptTokens,
    cacheHitTokens,
    cacheMissTokens,
    completionTokens,
    inputCacheHitRate: cacheHitTokens + cacheMissTokens > 0
      ? cacheHitTokens / (cacheHitTokens + cacheMissTokens)
      : undefined,
    promptTokensPerAcceptedNode: acceptedNextNodeCount > 0 ? promptTokens / acceptedNextNodeCount : undefined,
    cacheMissTokensPerAcceptedNode: acceptedNextNodeCount > 0 ? cacheMissTokens / acceptedNextNodeCount : undefined,
    fullRetryCount,
    fullRetryPerAcceptedNode: acceptedNextNodeCount > 0 ? fullRetryCount / acceptedNextNodeCount : undefined,
    failedNextNodeCallCount,
    validationFailureRate: nextNodeCalls.length > 0 ? failedNextNodeCallCount / nextNodeCalls.length : undefined,
    firstTokenP50Ms: percentile(firstTokenLatencies, 0.5),
    firstTokenP95Ms: percentile(firstTokenLatencies, 0.95)
  };
}

/**
 * Aggregate browser-recorded generation traces without copying raw prompts or
 * user content into the evidence. `acceptedNextNodeCount` only includes a
 * traced node index that appears in the final accepted history.
 */
export function summarizeCacheUsage(records) {
  const all = [];
  const acceptedNextNodeKeys = new Set();
  const nodeTraceGroups = new Map();

  for (const record of records) {
    const caseSlug = record?.caseSlug || "unknown-case";
    const history = record?.finalState?.history ?? record?.latestState?.history ?? [];
    for (const trace of completedTraces(record)) {
      const entry = { ...trace, caseSlug };
      all.push(entry);
      if ((trace.kind === "initial_generation" || trace.kind === "full_regeneration")
        && Number.isInteger(trace.nodeIndex)
        && history.length > trace.nodeIndex) {
        const nodeKey = `${caseSlug}:${trace.nodeIndex}`;
        acceptedNextNodeKeys.add(nodeKey);
        const tracesForNode = nodeTraceGroups.get(nodeKey) ?? [];
        tracesForNode.push(entry);
        nodeTraceGroups.set(nodeKey, tracesForNode);
      }
    }
  }

  const acceptedNextNodeCount = acceptedNextNodeKeys.size;
  const byKindMap = new Map();
  for (const trace of all) {
    const key = traceGroupKey(trace);
    const traces = byKindMap.get(key) ?? [];
    traces.push(trace);
    byKindMap.set(key, traces);
  }
  const byKind = [...byKindMap.entries()].map(([key, traces]) => {
    const [kind, promptFamily, promptPrefixVersion] = key.split("|");
    return {
      kind,
      promptFamily,
      promptPrefixVersion,
      ...aggregateTraces(traces, acceptedNextNodeCount)
    };
  }).sort((left, right) => `${left.kind}:${left.promptFamily}:${left.promptPrefixVersion}`.localeCompare(`${right.kind}:${right.promptFamily}:${right.promptPrefixVersion}`));

  const nextNodeTraces = all.filter((trace) => trace.kind === "initial_generation" || trace.kind === "full_regeneration");
  const warmNextNodeTraces = nextNodeTraces.filter((trace) => (finite(trace.cacheHitTokens) ?? 0) > 0);
  const coldNextNodeTraces = nextNodeTraces.filter((trace) => (finite(trace.cacheHitTokens) ?? 0) === 0);
  const firstPassNodeCount = [...nodeTraceGroups.values()].filter((traces) => (
    traces.filter((trace) => trace.kind === "initial_generation" || trace.kind === "full_regeneration").length === 1
    && traces.some((trace) => trace.kind === "initial_generation" && trace.outcome === "succeeded")
  )).length;
  const summary = {
    ...aggregateTraces(nextNodeTraces, acceptedNextNodeCount),
    acceptedNextNodeCount,
    firstGenerationPassNodeCount: firstPassNodeCount,
    firstGenerationPassRate: acceptedNextNodeCount > 0 ? firstPassNodeCount / acceptedNextNodeCount : undefined,
    warmCache: aggregateTraces(warmNextNodeTraces, acceptedNextNodeCount),
    coldCache: aggregateTraces(coldNextNodeTraces, acceptedNextNodeCount),
    routeCount: records.length,
    routeCompletionCount: records.filter((record) => record?.passed === true).length,
    routeCompletionRate: records.length > 0 ? records.filter((record) => record?.passed === true).length / records.length : undefined
  };
  return { summary, byKind };
}

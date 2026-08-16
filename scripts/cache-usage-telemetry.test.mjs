import assert from "node:assert/strict";
import test from "node:test";
import { summarizeCacheUsage } from "./lib/cache-usage-telemetry.mjs";

test("cache usage evidence groups terminal traces and measures accepted next nodes", () => {
  const telemetry = summarizeCacheUsage([{
    caseSlug: "cache-route",
    passed: true,
    finalState: {
      history: [{ title: "start" }, { title: "accepted node" }],
      generationCallTraces: [
        { traceId: "started", nodeIndex: 1, kind: "initial_generation", outcome: "started" },
        {
          traceId: "next-1", nodeIndex: 1, kind: "initial_generation", outcome: "succeeded",
          promptFamily: "next_node", promptPrefixVersion: "next_node_cache_prefix_v1",
          promptTokens: 100, cacheHitTokens: 72, cacheMissTokens: 28, completionTokens: 15,
          startedAt: "2026-08-04T00:00:00.000Z", firstTokenAt: "2026-08-04T00:00:00.120Z"
        },
        {
          traceId: "patch-1", nodeIndex: 1, kind: "candidate_patch", outcome: "succeeded",
          promptFamily: "candidate_patch", promptTokens: 20, cacheHitTokens: 5, cacheMissTokens: 15, completionTokens: 4
        },
        {
          traceId: "retry-1", nodeIndex: 1, kind: "full_regeneration", outcome: "failed",
          promptFamily: "next_node", promptPrefixVersion: "next_node_cache_prefix_v1",
          promptTokens: 80, cacheHitTokens: 40, cacheMissTokens: 40, completionTokens: 0
        }
      ]
    }
  }]);

  assert.equal(telemetry.summary.acceptedNextNodeCount, 1);
  assert.equal(telemetry.summary.usageCallCount, 2);
  assert.equal(telemetry.summary.promptTokens, 180);
  assert.equal(telemetry.summary.cacheHitTokens, 112);
  assert.equal(telemetry.summary.cacheMissTokens, 68);
  assert.equal(telemetry.summary.inputCacheHitRate, 112 / 180);
  assert.equal(telemetry.summary.cacheMissTokensPerAcceptedNode, 68);
  assert.equal(telemetry.summary.firstGenerationPassRate, 0);
  assert.equal(telemetry.summary.fullRetryCount, 1);
  assert.equal(telemetry.summary.validationFailureRate, 0.5);
  assert.equal(telemetry.summary.firstTokenP95Ms, 120);
  assert.equal(telemetry.summary.routeCompletionRate, 1);
  assert.deepEqual(telemetry.byKind.map((item) => item.kind), ["candidate_patch", "full_regeneration", "initial_generation"]);
});

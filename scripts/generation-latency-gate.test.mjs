import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateGenerationPerformanceGate,
  summarizeGenerationPerformance
} from "./lib/generation-latency-gate.mjs";

test("generation performance summary calculates release metrics per node", () => {
  const summary = summarizeGenerationPerformance([{ nodes: [
    { totalModelLatencyMs: 100, fullGenerationCount: 1, modelPatchCount: 0 },
    { totalModelLatencyMs: 120, fullGenerationCount: 1, modelPatchCount: 1 },
    { totalModelLatencyMs: 150, fullGenerationCount: 2, modelPatchCount: 1 }
  ] }]);
  assert.equal(summary.nodeCount, 3);
  assert.equal(summary.p90LatencyMs, 150);
  assert.equal(summary.maxModelPatchCount, 1);
  assert.equal(summary.singleFullGenerationRate, 2 / 3);
});

test("release gate rejects latency, retry, patch, pause, and classification regressions", () => {
  const result = evaluateGenerationPerformanceGate({
    baseline: { p90LatencyMs: 100, fullRegenerationRate: 0.1 },
    candidate: {
      p90LatencyMs: 111,
      fullRegenerationRate: 0.16,
      singleFullGenerationRate: 0.89,
      maxModelPatchCount: 2,
      visiblePauseCount: 1,
      unclassifiedCallCount: 1
    }
  });
  assert.equal(result.passed, false);
  assert.deepEqual(result.failures, [
    "P90_LATENCY_REGRESSION",
    "FULL_REGENERATION_RATE_REGRESSION",
    "SINGLE_FULL_GENERATION_RATE_LOW",
    "MODEL_PATCH_BUDGET_EXCEEDED",
    "VISIBLE_GENERATION_PAUSE",
    "UNCLASSIFIED_GENERATION_CALL"
  ]);
});

test("release gate accepts a faster candidate with one bounded patch", () => {
  const result = evaluateGenerationPerformanceGate({
    baseline: { p90LatencyMs: 20000, fullRegenerationRate: 0.12 },
    candidate: {
      p90LatencyMs: 19000,
      fullRegenerationRate: 0.08,
      singleFullGenerationRate: 0.92,
      maxModelPatchCount: 1,
      visiblePauseCount: 0,
      unclassifiedCallCount: 0
    }
  });
  assert.deepEqual(result, { passed: true, failures: [] });
});

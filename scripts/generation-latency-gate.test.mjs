import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateGenerationPerformanceGate,
  summarizeCandidatePatchEffectiveness,
  summarizeGenerationPerformance
} from "./lib/generation-latency-gate.mjs";

test("candidate patch effectiveness requires avoiding a later full regeneration", () => {
  const traces = [
    { caseSlug: "a", transactionId: "tx-1", kind: "candidate_patch", outcome: "succeeded", startedAt: "2026-01-01T00:00:01Z", issueCodes: ["STORY"] },
    { caseSlug: "a", transactionId: "tx-1", kind: "full_regeneration", outcome: "succeeded", startedAt: "2026-01-01T00:00:02Z", issueCodes: [] },
    { caseSlug: "a", transactionId: "tx-2", kind: "candidate_patch", outcome: "succeeded", startedAt: "2026-01-01T00:00:03Z", issueCodes: ["DEBT"] },
    { caseSlug: "a", transactionId: "tx-3", kind: "candidate_patch", outcome: "failed", startedAt: "2026-01-01T00:00:04Z", issueCodes: ["DECISION"] }
  ];
  assert.deepEqual(summarizeCandidatePatchEffectiveness(traces), {
    candidatePatchCallCount: 3,
    candidatePatchContractSucceeded: 2,
    candidatePatchContractSuccessRate: 2 / 3,
    candidatePatchEffectiveCount: 1,
    candidatePatchEffectiveRate: 1 / 3,
    fullRegenerationWithoutReasonCount: 1
  });
});

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
      unclassifiedCallCount: 0,
      candidatePatchCallCount: 1,
      candidatePatchEffectiveRate: 1,
      fullRegenerationWithoutReasonCount: 0
    }
  });
  assert.deepEqual(result, { passed: true, failures: [] });
});

test("release gate rejects ineffective patches and missing regeneration reasons", () => {
  const result = evaluateGenerationPerformanceGate({
    baseline: { p90LatencyMs: 20000, fullRegenerationRate: 0.1 },
    candidate: {
      p90LatencyMs: 19000,
      fullRegenerationRate: 0.1,
      singleFullGenerationRate: 0.9,
      maxModelPatchCount: 1,
      visiblePauseCount: 0,
      unclassifiedCallCount: 0,
      candidatePatchCallCount: 7,
      candidatePatchEffectiveRate: 1 / 7,
      fullRegenerationWithoutReasonCount: 2
    }
  });
  assert.deepEqual(result.failures, [
    "CANDIDATE_PATCH_EFFECTIVE_RATE_LOW",
    "FULL_REGENERATION_REASON_MISSING"
  ]);
});

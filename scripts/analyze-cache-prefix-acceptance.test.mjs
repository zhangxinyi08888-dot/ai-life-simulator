import assert from "node:assert/strict";
import test from "node:test";
import { evaluateCachePrefixAcceptance } from "./analyze-cache-prefix-acceptance.mjs";

const baseline = {
  summary: {
    callCount: 30,
    cacheMissTokensPerAcceptedNode: 100,
    promptTokensPerAcceptedNode: 200,
    firstGenerationPassRate: 0.8,
    fullRetryPerAcceptedNode: 0.2,
    validationFailureRate: 0.05,
    firstTokenP95Ms: 900,
    routeCount: 2,
    routeCompletionRate: 1
  }
};

test("cache acceptance passes only when every non-regression gate has evidence", () => {
  const candidate = {
    summary: {
      callCount: 31,
      inputCacheHitRate: 0.72,
      warmCache: { inputCacheHitRate: 0.72 },
      cacheMissTokensPerAcceptedNode: 60,
      promptTokensPerAcceptedNode: 204,
      firstGenerationPassRate: 0.76,
      fullRetryPerAcceptedNode: 0.2,
      validationFailureRate: 0.05,
      firstTokenP95Ms: 900,
      routeCount: 2,
      routeCompletionRate: 1
    },
    provenance: {
      expectedPromptPrefixVersion: "next_node_cache_prefix_v2_reference_context_r4"
    }
  };
  const report = evaluateCachePrefixAcceptance(baseline, candidate, {
    expectedCandidatePromptPrefixVersion: "next_node_cache_prefix_v2_reference_context_r4"
  });
  assert.equal(report.verdict, "pass");
  assert.equal(report.checks.every((check) => check.status === "pass"), true);
  assert.equal(report.observations.find((item) => item.name.includes("warm-cache"))?.status, "observed");
});

test("cache acceptance rejects a candidate whose layout provenance differs from the requested layout", () => {
  const candidate = {
    summary: {
      callCount: 31,
      inputCacheHitRate: 0.01,
      warmCache: { inputCacheHitRate: 0.01 },
      cacheMissTokensPerAcceptedNode: 60,
      promptTokensPerAcceptedNode: 200,
      firstGenerationPassRate: 0.8,
      fullRetryPerAcceptedNode: 0.2,
      validationFailureRate: 0.05,
      firstTokenP95Ms: 900,
      routeCount: 2,
      routeCompletionRate: 1
    },
    provenance: {
      expectedPromptPrefixVersion: "next_node_cache_prefix_v1_full_context_system_r1"
    }
  };
  const report = evaluateCachePrefixAcceptance(baseline, candidate, {
    expectedCandidatePromptPrefixVersion: "next_node_cache_prefix_v2_reference_context_r4"
  });
  assert.equal(report.verdict, "fail");
  assert.equal(report.checks.find((check) => check.name.includes("expected next-node prompt prefix"))?.status, "fail");
});

test("cache acceptance rejects missing usage and a prompt growth regression", () => {
  const candidate = {
    summary: {
      callCount: 31,
      warmCache: {},
      cacheMissTokensPerAcceptedNode: 70,
      promptTokensPerAcceptedNode: 205,
      firstGenerationPassRate: 0.75,
      fullRetryPerAcceptedNode: 0.2,
      validationFailureRate: 0.05,
      firstTokenP95Ms: 899,
      routeCount: 2,
      routeCompletionRate: 1
    }
  };
  const report = evaluateCachePrefixAcceptance(baseline, candidate);
  assert.equal(report.verdict, "fail");
  assert.equal(report.checks.find((check) => check.name.includes("input-cache usage"))?.status, "missing");
  assert.equal(report.observations.find((item) => item.name.includes("warm-cache"))?.status, "missing");
  assert.equal(report.checks.find((check) => check.name.includes("prompt tokens"))?.status, "fail");
});

test("cache acceptance does not make a low warm-cache rate a hard gate", () => {
  const candidate = {
    summary: {
      callCount: 31,
      inputCacheHitRate: 0.01,
      warmCache: { inputCacheHitRate: 0.01 },
      cacheMissTokensPerAcceptedNode: 60,
      promptTokensPerAcceptedNode: 200,
      firstGenerationPassRate: 0.8,
      fullRetryPerAcceptedNode: 0.2,
      validationFailureRate: 0.05,
      firstTokenP95Ms: 900,
      routeCount: 2,
      routeCompletionRate: 1
    }
  };
  const report = evaluateCachePrefixAcceptance(baseline, candidate);
  assert.equal(report.verdict, "pass");
  assert.equal(report.observations.find((item) => item.name.includes("warm-cache"))?.actual, 0.01);
});

test("cache acceptance rejects an otherwise-good unfinished or single-route sample", () => {
  const candidate = {
    summary: {
      callCount: 31,
      warmCache: { inputCacheHitRate: 0.72 },
      cacheMissTokensPerAcceptedNode: 60,
      promptTokensPerAcceptedNode: 200,
      firstGenerationPassRate: 0.8,
      fullRetryPerAcceptedNode: 0.2,
      validationFailureRate: 0.05,
      firstTokenP95Ms: 900,
      routeCount: 1,
      routeCompletionRate: 0
    }
  };
  const report = evaluateCachePrefixAcceptance(baseline, candidate);
  assert.equal(report.verdict, "fail");
  assert.equal(report.checks.find((check) => check.name.includes("completed real-browser"))?.status, "fail");
});

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
      warmCache: { inputCacheHitRate: 0.72 },
      cacheMissTokensPerAcceptedNode: 60,
      promptTokensPerAcceptedNode: 204,
      firstGenerationPassRate: 0.76,
      fullRetryPerAcceptedNode: 0.2,
      validationFailureRate: 0.05,
      firstTokenP95Ms: 900,
      routeCount: 2,
      routeCompletionRate: 1
    }
  };
  const report = evaluateCachePrefixAcceptance(baseline, candidate);
  assert.equal(report.verdict, "pass");
  assert.equal(report.checks.every((check) => check.status === "pass"), true);
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
  assert.equal(report.checks.find((check) => check.name.includes("warm-cache"))?.status, "missing");
  assert.equal(report.checks.find((check) => check.name.includes("prompt tokens"))?.status, "fail");
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

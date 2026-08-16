import assert from "node:assert/strict";
import test from "node:test";
import { summarizeCachePrefixRun } from "./summarize-cache-prefix-run.mjs";

function completedRecord(slug) {
  return {
    caseSlug: slug,
    passed: true,
    dataSource: "real_ai_browser",
    finalState: {
      testDataSource: "real_ai_browser",
      e2eCase: null,
      history: [{ id: "node-0" }, { id: "node-1" }],
      generationCallTraces: [
        {
          traceId: `${slug}-trace`,
          kind: "initial_generation",
          promptFamily: "next_node",
          promptPrefixVersion: "next_node_cache_prefix_v2_reference_context_r4",
          nodeIndex: 0,
          outcome: "succeeded",
          promptTokens: 100,
          cacheHitTokens: 30,
          cacheMissTokens: 70,
          completionTokens: 10
        }
      ]
    }
  };
}

test("cache-prefix summary only accepts completed real-browser records", () => {
  const telemetry = summarizeCachePrefixRun([completedRecord("real-a"), completedRecord("real-b")]);
  assert.equal(telemetry.summary.routeCount, 2);
  assert.equal(telemetry.summary.acceptedNextNodeCount, 2);
  assert.equal(telemetry.summary.inputCacheHitRate, 0.3);
  const fixture = completedRecord("fixture");
  fixture.finalState.e2eCase = "fixture";
  assert.throws(() => summarizeCachePrefixRun([fixture]), /completed real-AI browser record/);
});

test("cache-prefix summary can require one prompt layout for all successful next nodes", () => {
  const record = completedRecord("real-v2");
  const options = { expectedPromptPrefixVersion: "next_node_cache_prefix_v2_reference_context_r4" };
  const telemetry = summarizeCachePrefixRun([record], options);
  assert.equal(telemetry.summary.callCount, 1);
  assert.deepEqual(telemetry.provenance, {
    expectedPromptPrefixVersion: "next_node_cache_prefix_v2_reference_context_r4",
    completedRealBrowserRecordCount: 1
  });
  record.finalState.generationCallTraces[0].promptPrefixVersion = "next_node_cache_prefix_v1_full_context_system_r1";
  assert.throws(() => summarizeCachePrefixRun([record], options), /next-node evidence/);
});

import assert from "node:assert/strict";
import test from "node:test";
import { buildCacheProbeRequests, runCacheProbe, summarizeCacheProbe } from "./probe-cache-prefix-layout.mjs";

test("cache probe builds a stable system prefix while each user turn advances", () => {
  const v1 = buildCacheProbeRequests("v1", 3);
  const v2 = buildCacheProbeRequests("v2", 3);
  assert.equal(v1.every((request) => typeof request !== "string"), true);
  assert.equal(v2.every((request) => typeof request !== "string"), true);
  const v1Prefixes = v1.map((request) => typeof request === "string" ? "" : request.systemPrefix);
  const v2Prefixes = v2.map((request) => typeof request === "string" ? "" : request.systemPrefix);
  assert.equal(new Set(v1Prefixes).size, 1);
  assert.equal(new Set(v2Prefixes).size, 1);
  assert.notEqual(v1Prefixes[0], v2Prefixes[0]);
  assert.equal(new Set(v2.map((request) => typeof request === "string" ? "" : request.userPrompt)).size, 3);
});

test("cache probe reports provider usage as observations without a score gate", async () => {
  let clock = 0;
  const result = await runCacheProbe({
    layout: "v2",
    callCount: 3,
    now: () => ++clock * 10,
    call: async (_prompt, onFirstToken) => {
      onFirstToken();
      return {
        usage: {
          promptTokens: 100,
          cacheHitTokens: 60,
          cacheMissTokens: 40,
          completionTokens: 10,
          totalTokens: 110
        }
      };
    }
  });
  assert.equal(result.summary.callCount, 3);
  assert.equal(result.summary.inputCacheHitRate, 0.6);
  assert.equal(result.summary.postFirstInputCacheHitRate, 0.6);
  assert.equal(result.samples.every((sample) => sample.firstTokenMs === 10), true);

  const noHit = summarizeCacheProbe([{ usage: { promptTokens: 100, cacheHitTokens: 0, cacheMissTokens: 100, completionTokens: 1 } }]);
  assert.equal(noHit.inputCacheHitRate, 0);
});

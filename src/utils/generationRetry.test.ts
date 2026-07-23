import assert from "node:assert/strict";
import test from "node:test";
import { runWithInvalidAiResponseRetry } from "./generationRetry";

test("malformed structured output is retried once before becoming visible", async () => {
  let attempts = 0;
  const result = await runWithInvalidAiResponseRetry(async () => {
    attempts += 1;
    if (attempts === 1) {
      throw Object.assign(new Error("invalid JSON"), { code: "AI_RESPONSE_INVALID" });
    }
    return "recovered";
  });
  assert.equal(result, "recovered");
  assert.equal(attempts, 2);
});

test("network failures are not hidden behind automatic retries", async () => {
  let attempts = 0;
  await assert.rejects(runWithInvalidAiResponseRetry(async () => {
    attempts += 1;
    throw Object.assign(new Error("network"), { code: "AI_NETWORK_FAILED" });
  }), /network/);
  assert.equal(attempts, 1);
});

test("a second malformed response is surfaced", async () => {
  let attempts = 0;
  await assert.rejects(runWithInvalidAiResponseRetry(async () => {
    attempts += 1;
    throw Object.assign(new Error(`invalid ${attempts}`), { code: "AI_RESPONSE_INVALID" });
  }), /invalid 2/);
  assert.equal(attempts, 2);
});

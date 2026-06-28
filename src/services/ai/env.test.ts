import assert from "node:assert/strict";
import { AiClientError } from "./errors";
import { getBrowserAiEnvFromRecord } from "./env";

const defaults = getBrowserAiEnvFromRecord({
  VITE_DEEPSEEK_API_KEY: "test-key"
});

assert.equal(defaults.apiKey, "test-key");
assert.equal(defaults.baseUrl, "https://api.deepseek.com");
assert.equal(defaults.model, "deepseek-v4-flash");

const custom = getBrowserAiEnvFromRecord({
  VITE_DEEPSEEK_API_KEY: "custom-key",
  VITE_DEEPSEEK_BASE_URL: "https://example.test/",
  VITE_DEEPSEEK_MODEL: "custom-model"
});

assert.equal(custom.apiKey, "custom-key");
assert.equal(custom.baseUrl, "https://example.test");
assert.equal(custom.model, "custom-model");

assert.throws(
  () => getBrowserAiEnvFromRecord({}),
  (error) => error instanceof AiClientError && error.code === "API_KEY_MISSING"
);

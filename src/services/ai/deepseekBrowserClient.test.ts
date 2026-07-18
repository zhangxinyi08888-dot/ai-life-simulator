import assert from "node:assert/strict";
import { AiClientError } from "./errors";
import { callDeepSeekJsonFromBrowser, callDeepSeekJsonStreamFromBrowser } from "./deepseekBrowserClient";

const calls: { url: string; body: any; headers: Record<string, string> }[] = [];
const okFetch = async (url: string, init?: RequestInit) => {
  calls.push({
    url,
    body: JSON.parse(String(init?.body)),
    headers: init?.headers as Record<string, string>
  });

  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify({
      choices: [{ message: { content: "```json\n{\"ok\":true}\n```" } }]
    })
  } as Response;
};

const result = await callDeepSeekJsonFromBrowser(
  { apiKey: "test-key", baseUrl: "https://api.deepseek.com/", model: "deepseek-v4-flash" },
  "只输出 JSON",
  okFetch as typeof fetch
);

assert.equal(result.text, "{\"ok\":true}");
assert.equal(calls[0].url, "https://api.deepseek.com/chat/completions");
assert.equal(calls[0].headers.Authorization, "Bearer test-key");
assert.equal(calls[0].body.model, "deepseek-v4-flash");
assert.deepEqual(calls[0].body.response_format, { type: "json_object" });
assert.equal(calls[0].body.thinking.type, "disabled");

await assert.rejects(
  () => callDeepSeekJsonFromBrowser(
    { apiKey: "bad", baseUrl: "https://api.deepseek.com", model: "deepseek-v4-flash" },
    "x",
    async () => ({ ok: false, status: 401, text: async () => "unauthorized" } as Response)
  ),
  (error) => error instanceof AiClientError && error.code === "AI_AUTH_FAILED"
);

await assert.rejects(
  () => callDeepSeekJsonFromBrowser(
    { apiKey: "limited", baseUrl: "https://api.deepseek.com", model: "deepseek-v4-flash" },
    "x",
    async () => ({ ok: false, status: 429, text: async () => "rate limit" } as Response)
  ),
  (error) => error instanceof AiClientError && error.code === "AI_RATE_LIMITED"
);

await assert.rejects(
  () => callDeepSeekJsonFromBrowser(
    { apiKey: "network", baseUrl: "https://api.deepseek.com", model: "deepseek-v4-flash" },
    "x",
    async () => {
      throw new TypeError("Failed to fetch");
    }
  ),
  (error) => error instanceof AiClientError && error.code === "AI_NETWORK_FAILED"
);

await assert.rejects(
  () => callDeepSeekJsonStreamFromBrowser(
    { apiKey: "", baseUrl: "https://api.deepseek.com", model: "deepseek-v4-flash" },
    "x"
  ),
  (error) => error instanceof AiClientError && error.code === "API_KEY_MISSING"
);

await assert.rejects(
  () => callDeepSeekJsonStreamFromBrowser(
    { apiKey: "stoppable", baseUrl: "https://api.deepseek.com", model: "deepseek-v4-flash" },
    "x",
    {},
    async () => {
      throw new DOMException("Generation aborted", "AbortError");
    }
  ),
  (error) => error instanceof AiClientError && error.code === "AI_REQUEST_ABORTED"
);

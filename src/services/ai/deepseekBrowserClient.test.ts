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
      id: "browser-non-stream",
      model: "deepseek-v4-flash",
      usage: {
        prompt_tokens: 11,
        prompt_cache_hit_tokens: 7,
        prompt_cache_miss_tokens: 4,
        completion_tokens: 2,
        total_tokens: 13
      },
      choices: [{ message: { content: "```json\n{\"ok\":true}\n```" } }]
    })
  } as Response;
};

const result = await callDeepSeekJsonFromBrowser(
  { apiKey: "test-key", baseUrl: "https://api.deepseek.com/", model: "deepseek-v4-flash" },
  { systemPrefix: "BROWSER_CACHE_STABLE_SYSTEM", userPrompt: "BROWSER_CACHE_DYNAMIC_USER" },
  okFetch as typeof fetch
);

assert.equal(result.text, "{\"ok\":true}");
assert.equal(calls[0].url, "https://api.deepseek.com/chat/completions");
assert.equal(calls[0].headers.Authorization, "Bearer test-key");
assert.equal(calls[0].body.model, "deepseek-v4-flash");
assert.deepEqual(calls[0].body.response_format, { type: "json_object" });
assert.equal(calls[0].body.thinking.type, "disabled");
assert.match(calls[0].body.messages[0].content, /BROWSER_CACHE_STABLE_SYSTEM$/);
assert.deepEqual(calls[0].body.messages[1], { role: "user", content: "BROWSER_CACHE_DYNAMIC_USER" });
assert.deepEqual(result.usage, {
  promptTokens: 11,
  cacheHitTokens: 7,
  cacheMissTokens: 4,
  completionTokens: 2,
  totalTokens: 13
});
assert.equal(result.providerRequestId, "browser-non-stream");

const streamedUsages: any[] = [];
const streamResult = await callDeepSeekJsonStreamFromBrowser(
  { apiKey: "test-key", baseUrl: "https://api.deepseek.com", model: "deepseek-v4-flash" },
  "流式 JSON",
  { onUsage: (usage) => streamedUsages.push(usage) },
  async (_url, init) => {
    calls.push({
      url: String(_url),
      body: JSON.parse(String(init?.body)),
      headers: init?.headers as Record<string, string>
    });
    return new Response([
      'data: {"id":"browser-stream","model":"deepseek-v4-flash","choices":[{"delta":{"content":"{\\\"ok\\\":true}"}}]}\n\n',
      'data: {"choices":[],"usage":{"prompt_tokens":12,"prompt_cache_hit_tokens":8,"prompt_cache_miss_tokens":4,"completion_tokens":2,"total_tokens":14}}\n\n',
      "data: [DONE]\n\n"
    ].join(""), { status: 200 });
  }
);

assert.equal(streamResult.text, '{"ok":true}');
assert.deepEqual(calls.at(-1)?.body.stream_options, { include_usage: true });
assert.deepEqual(streamResult.usage, {
  promptTokens: 12,
  cacheHitTokens: 8,
  cacheMissTokens: 4,
  completionTokens: 2,
  totalTokens: 14
});
assert.deepEqual(streamedUsages, [streamResult.usage]);

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

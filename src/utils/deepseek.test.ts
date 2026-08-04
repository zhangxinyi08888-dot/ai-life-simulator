import assert from "node:assert/strict";
import { callDeepSeekJson, callDeepSeekJsonStream, extractJsonText, flattenAiPromptInput } from "./deepseek";

assert.equal(extractJsonText('```json\n{"ok":true}\n```'), '{"ok":true}');
assert.equal(extractJsonText('{"ok":true}'), '{"ok":true}');

const calls: any[] = [];
const fetchImpl = async (_url: string, init?: RequestInit) => {
  calls.push(JSON.parse(String(init?.body)));
  return {
    ok: true,
    text: async () => JSON.stringify({
      id: "chatcmpl-non-stream",
      model: "deepseek-v4-flash",
      usage: {
        prompt_tokens: 120,
        prompt_cache_hit_tokens: 80,
        prompt_cache_miss_tokens: 40,
        completion_tokens: 24,
        total_tokens: 144
      },
      choices: [{ message: { content: '{"questions":[{"question":"Q","suggestions":["A","B","C"]}]}' } }]
    })
  } as Response;
};

const response = await callDeepSeekJson(
  {
    apiKey: "test-key",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-v4-flash"
  },
  "只输出 JSON",
  fetchImpl
);

assert.equal(response.text, '{"questions":[{"question":"Q","suggestions":["A","B","C"]}]}');
assert.equal(calls[0].model, "deepseek-v4-flash");
assert.deepEqual(calls[0].response_format, { type: "json_object" });
assert.equal(calls[0].thinking.type, "disabled");
assert.equal(calls[0].temperature, 0.85);
assert.equal(calls[0].max_tokens, 8192);
assert.deepEqual(response.usage, {
  promptTokens: 120,
  cacheHitTokens: 80,
  cacheMissTokens: 40,
  completionTokens: 24,
  totalTokens: 144
});
assert.equal(response.providerRequestId, "chatcmpl-non-stream");
assert.equal(response.model, "deepseek-v4-flash");

const segmentedResponse = await callDeepSeekJson(
  {
    apiKey: "test-key",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-v4-flash"
  },
  { systemPrefix: "CACHE_STABLE_SYSTEM", userPrompt: "CACHE_DYNAMIC_USER" },
  fetchImpl
);
const segmentedBody = calls.at(-1)!;
assert.equal(flattenAiPromptInput({ systemPrefix: "CACHE_STABLE_SYSTEM", userPrompt: "CACHE_DYNAMIC_USER" }), "CACHE_STABLE_SYSTEM\n\nCACHE_DYNAMIC_USER");
assert.equal(segmentedBody.messages[0].role, "system");
assert.match(segmentedBody.messages[0].content, /^你是一个严格的 JSON 生成器。/);
assert.match(segmentedBody.messages[0].content, /CACHE_STABLE_SYSTEM$/);
assert.deepEqual(segmentedBody.messages[1], { role: "user", content: "CACHE_DYNAMIC_USER" });
assert.equal(segmentedBody.thinking.type, "disabled");
assert.equal(segmentedBody.temperature, 0.85);
assert.equal(segmentedBody.max_tokens, 8192);
assert.equal(segmentedResponse.text, response.text);

const streamedBodies: any[] = [];
const encoder = new TextEncoder();
const streamedContents: string[] = [];
const streamedUsages: any[] = [];
const streamResponse = await callDeepSeekJsonStream(
  {
    apiKey: "test-key",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-v4-flash"
  },
  { systemPrefix: "CACHE_STABLE_STREAM", userPrompt: "CACHE_DYNAMIC_STREAM" },
  {
    onContent: (content) => streamedContents.push(content),
    onUsage: (usage) => streamedUsages.push(usage)
  },
  async (_url, init) => {
    streamedBodies.push(JSON.parse(String(init?.body)));
    const chunks = [
      'data: {"id":"chatcmpl-stream","model":"deepseek-v4-flash","choices":[{"delta":{"content":"{\\\"title\\\":\\\"新章\\\","}}]}\n',
      '\ndata: {"choices":[{"delta":{"content":"\\\"description\\\":\\\"第一段。\\\\n\\\\n"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"第二段。\\\"}"}}]}\n\n',
      'data: {"id":"chatcmpl-stream","model":"deepseek-v4-flash","choices":[],"usage":{"prompt_tokens":180,"prompt_cache_hit_tokens":130,"prompt_cache_miss_tokens":50,"completion_tokens":33,"total_tokens":213}}\n\n',
      'data: [DONE]\n\n'
    ];
    return new Response(new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      }
    }), { status: 200 });
  }
);

assert.equal(streamResponse.text, '{"title":"新章","description":"第一段。\\n\\n第二段。"}');
assert.equal(streamedBodies[0].stream, true);
assert.deepEqual(streamedBodies[0].stream_options, { include_usage: true });
assert.equal(streamedBodies[0].temperature, 0.85);
assert.equal(streamedBodies[0].max_tokens, 8192);
assert.match(streamedBodies[0].messages[0].content, /CACHE_STABLE_STREAM$/);
assert.deepEqual(streamedBodies[0].messages[1], { role: "user", content: "CACHE_DYNAMIC_STREAM" });
assert.equal(streamedContents.at(-1), streamResponse.text);
assert.deepEqual(streamResponse.usage, {
  promptTokens: 180,
  cacheHitTokens: 130,
  cacheMissTokens: 50,
  completionTokens: 33,
  totalTokens: 213
});
assert.deepEqual(streamedUsages, [streamResponse.usage]);
assert.equal(streamResponse.providerRequestId, "chatcmpl-stream");
assert.equal(streamResponse.model, "deepseek-v4-flash");

const noUsageResponse = await callDeepSeekJson(
  {
    apiKey: "test-key",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-v4-flash"
  },
  "兼容没有 usage 的响应",
  async () => ({
    ok: true,
    text: async () => JSON.stringify({
      choices: [{ message: { content: '{"ok":true}' } }]
    })
  } as Response)
);

assert.equal(noUsageResponse.text, '{"ok":true}');
assert.equal(noUsageResponse.usage, undefined);

const noUsageStreamResponse = await callDeepSeekJsonStream(
  {
    apiKey: "test-key",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-v4-flash"
  },
  "兼容没有流式 usage 的响应",
  {},
  async () => new Response('data: {"choices":[{"delta":{"content":"{\\\"ok\\\":true}"}}]}\n\ndata: [DONE]\n\n', { status: 200 })
);
assert.equal(noUsageStreamResponse.text, '{"ok":true}');
assert.equal(noUsageStreamResponse.usage, undefined);

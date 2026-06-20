import assert from "node:assert/strict";
import { callDeepSeekJson, extractJsonText } from "./deepseek";

assert.equal(extractJsonText('```json\n{"ok":true}\n```'), '{"ok":true}');
assert.equal(extractJsonText('{"ok":true}'), '{"ok":true}');

const calls: any[] = [];
const fetchImpl = async (_url: string, init?: RequestInit) => {
  calls.push(JSON.parse(String(init?.body)));
  return {
    ok: true,
    text: async () => JSON.stringify({
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

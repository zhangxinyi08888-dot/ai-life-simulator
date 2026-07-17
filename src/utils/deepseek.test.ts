import assert from "node:assert/strict";
import { callDeepSeekJson, callDeepSeekJsonStream, extractJsonText } from "./deepseek";

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

const streamedBodies: any[] = [];
const encoder = new TextEncoder();
const streamedContents: string[] = [];
const streamResponse = await callDeepSeekJsonStream(
  {
    apiKey: "test-key",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-v4-flash"
  },
  "生成下一章",
  { onContent: (content) => streamedContents.push(content) },
  async (_url, init) => {
    streamedBodies.push(JSON.parse(String(init?.body)));
    const chunks = [
      'data: {"choices":[{"delta":{"content":"{\\\"title\\\":\\\"新章\\\","}}]}\n',
      '\ndata: {"choices":[{"delta":{"content":"\\\"description\\\":\\\"第一段。\\\\n\\\\n"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"第二段。\\\"}"}}]}\n\n',
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
assert.equal(streamedContents.at(-1), streamResponse.text);

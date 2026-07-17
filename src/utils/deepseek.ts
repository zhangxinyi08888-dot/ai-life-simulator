export interface DeepSeekClientConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export interface DeepSeekStreamOptions {
  signal?: AbortSignal;
  onContent?: (content: string) => void;
}

export function extractJsonText(content: string): string {
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return (fenced?.[1] || trimmed).trim();
}

export async function callDeepSeekJson(
  config: DeepSeekClientConfig,
  prompt: string,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal
): Promise<{ text: string }> {
  const endpoint = `${config.baseUrl.replace(/\/$/, "")}/chat/completions`;
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${config.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        {
          role: "system",
          content: "你是一个严格的 JSON 生成器。只返回一个合法 JSON 对象，不要输出 Markdown、解释文字或代码围栏。"
        },
        {
          role: "user",
          content: prompt
        }
      ],
      response_format: { type: "json_object" },
      thinking: { type: "disabled" },
      temperature: 0.85,
      max_tokens: 8192,
      stream: false
    }),
    signal
  });

  const bodyText = await response.text();
  let body: any = null;

  try {
    body = bodyText ? JSON.parse(bodyText) : null;
  } catch {
    body = null;
  }

  if (!response.ok) {
    throw new Error(bodyText || `DeepSeek API request failed with status ${response.status}`);
  }

  const content = body?.choices?.[0]?.message?.content;
  if (!content || typeof content !== "string") {
    throw new Error(`DeepSeek API response did not include JSON content: ${bodyText}`);
  }

  return { text: extractJsonText(content) };
}

export async function callDeepSeekJsonStream(
  config: DeepSeekClientConfig,
  prompt: string,
  options: DeepSeekStreamOptions = {},
  fetchImpl: typeof fetch = fetch
): Promise<{ text: string }> {
  const endpoint = `${config.baseUrl.replace(/\/$/, "")}/chat/completions`;
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${config.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        {
          role: "system",
          content: "你是一个严格的 JSON 生成器。只返回一个合法 JSON 对象，不要输出 Markdown、解释文字或代码围栏。"
        },
        {
          role: "user",
          content: prompt
        }
      ],
      response_format: { type: "json_object" },
      thinking: { type: "disabled" },
      temperature: 0.85,
      max_tokens: 8192,
      stream: true
    }),
    signal: options.signal
  });

  if (!response.ok) {
    const bodyText = await response.text();
    throw new Error(bodyText || `DeepSeek API request failed with status ${response.status}`);
  }

  let content = "";
  let lineBuffer = "";
  const consumeLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) return;
    const data = trimmed.slice(5).trim();
    if (!data || data === "[DONE]") return;
    const chunk = JSON.parse(data);
    const delta = chunk?.choices?.[0]?.delta?.content;
    if (typeof delta !== "string" || delta.length === 0) return;
    content += delta;
    options.onContent?.(content);
  };
  const consumeText = (text: string, flush = false) => {
    lineBuffer += text;
    const lines = lineBuffer.split(/\r?\n/);
    lineBuffer = flush ? "" : lines.pop() || "";
    for (const line of lines) consumeLine(line);
    if (flush && lineBuffer.trim()) consumeLine(lineBuffer);
  };

  if (response.body) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      consumeText(decoder.decode(value, { stream: true }));
    }
    consumeText(decoder.decode(), true);
  } else {
    const bodyText = await response.text();
    if (bodyText.trim().startsWith("data:")) {
      consumeText(bodyText, true);
    } else {
      const body = JSON.parse(bodyText || "null");
      const completeContent = body?.choices?.[0]?.message?.content;
      if (typeof completeContent === "string") {
        content = completeContent;
        options.onContent?.(content);
      }
    }
  }

  if (!content.trim()) {
    throw new Error("DeepSeek API response did not include streamed JSON content");
  }

  return { text: extractJsonText(content) };
}

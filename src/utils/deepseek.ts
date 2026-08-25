export interface DeepSeekClientConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export interface AiUsage {
  promptTokens: number;
  cacheHitTokens: number;
  cacheMissTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface AiJsonResult {
  text: string;
  usage?: AiUsage;
  providerRequestId?: string;
  model?: string;
}

/**
 * A cache-aware request may put an already-stable prefix in the system
 * message while retaining the mutable turn material in the user message.
 * `flattenAiPromptInput` is deliberately available to tests and local mocks
 * so the visible prompt text can be proven unchanged by this transport split.
 */
export interface AiPromptSegments {
  systemPrefix: string;
  userPrompt: string;
}

export type AiPromptInput = string | AiPromptSegments;

const JSON_OUTPUT_SYSTEM_INSTRUCTION = "你是一个严格的 JSON 生成器。只返回一个合法 JSON 对象，不要输出 Markdown、解释文字或代码围栏。";

export function flattenAiPromptInput(prompt: AiPromptInput): string {
  return typeof prompt === "string"
    ? prompt
    : [prompt.systemPrefix, prompt.userPrompt].filter(Boolean).join("\n\n");
}

function messagesForPrompt(prompt: AiPromptInput): Array<{ role: "system" | "user"; content: string }> {
  if (typeof prompt === "string") {
    return [
      { role: "system", content: JSON_OUTPUT_SYSTEM_INSTRUCTION },
      { role: "user", content: prompt }
    ];
  }

  return [
    {
      role: "system",
      content: [JSON_OUTPUT_SYSTEM_INSTRUCTION, prompt.systemPrefix].filter(Boolean).join("\n\n")
    },
    { role: "user", content: prompt.userPrompt }
  ];
}

export interface DeepSeekStreamOptions {
  signal?: AbortSignal;
  onContent?: (content: string) => void;
  onUsage?: (usage: AiUsage) => void;
}

export function extractJsonText(content: string): string {
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return (fenced?.[1] || trimmed).trim();
}

function finiteTokenCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

/**
 * DeepSeek follows the OpenAI-compatible field names. Keep the conversion at
 * the API boundary so the rest of the app does not depend on provider-shaped
 * JSON or accidentally log a response body.
 */
export function parseDeepSeekUsage(value: unknown): AiUsage | undefined {
  if (!value || typeof value !== "object") return undefined;
  const usage = value as Record<string, unknown>;
  const promptTokens = finiteTokenCount(usage.prompt_tokens);
  const promptTokenDetails = usage.prompt_tokens_details && typeof usage.prompt_tokens_details === "object"
    ? usage.prompt_tokens_details as Record<string, unknown>
    : undefined;
  const hasDeepSeekCacheUsage = Object.prototype.hasOwnProperty.call(usage, "prompt_cache_hit_tokens")
    || Object.prototype.hasOwnProperty.call(usage, "prompt_cache_miss_tokens");
  const hasOpenAiCacheUsage = !!promptTokenDetails
    && Object.prototype.hasOwnProperty.call(promptTokenDetails, "cached_tokens");
  const cacheHitTokens = hasDeepSeekCacheUsage
    ? finiteTokenCount(usage.prompt_cache_hit_tokens)
    : finiteTokenCount(promptTokenDetails?.cached_tokens);
  const cacheMissTokens = hasDeepSeekCacheUsage
    ? finiteTokenCount(usage.prompt_cache_miss_tokens)
    : hasOpenAiCacheUsage
      ? Math.max(0, promptTokens - cacheHitTokens)
      : 0;
  return {
    promptTokens,
    cacheHitTokens,
    cacheMissTokens,
    completionTokens: finiteTokenCount(usage.completion_tokens),
    totalTokens: finiteTokenCount(usage.total_tokens)
  };
}

function responseMetadata(body: unknown): Pick<AiJsonResult, "usage" | "providerRequestId" | "model"> {
  const response = body && typeof body === "object" ? body as Record<string, unknown> : {};
  return {
    usage: parseDeepSeekUsage(response.usage),
    providerRequestId: typeof response.id === "string" ? response.id : undefined,
    model: typeof response.model === "string" ? response.model : undefined
  };
}

export async function callDeepSeekJson(
  config: DeepSeekClientConfig,
  prompt: AiPromptInput,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal
): Promise<AiJsonResult> {
  const endpoint = `${config.baseUrl.replace(/\/$/, "")}/chat/completions`;
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${config.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: config.model,
      messages: messagesForPrompt(prompt),
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

  return { text: extractJsonText(content), ...responseMetadata(body) };
}

export async function callDeepSeekJsonStream(
  config: DeepSeekClientConfig,
  prompt: AiPromptInput,
  options: DeepSeekStreamOptions = {},
  fetchImpl: typeof fetch = fetch
): Promise<AiJsonResult> {
  const endpoint = `${config.baseUrl.replace(/\/$/, "")}/chat/completions`;
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${config.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: config.model,
      messages: messagesForPrompt(prompt),
      response_format: { type: "json_object" },
      thinking: { type: "disabled" },
      temperature: 0.85,
      max_tokens: 8192,
      stream: true,
      stream_options: { include_usage: true }
    }),
    signal: options.signal
  });

  if (!response.ok) {
    const bodyText = await response.text();
    throw new Error(bodyText || `DeepSeek API request failed with status ${response.status}`);
  }

  let content = "";
  let lineBuffer = "";
  let usage: AiUsage | undefined;
  let providerRequestId: string | undefined;
  let model: string | undefined;
  const captureMetadata = (chunk: unknown) => {
    const metadata = responseMetadata(chunk);
    if (metadata.usage) {
      usage = metadata.usage;
      options.onUsage?.(metadata.usage);
    }
    if (metadata.providerRequestId) providerRequestId = metadata.providerRequestId;
    if (metadata.model) model = metadata.model;
  };
  const consumeLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) return;
    const data = trimmed.slice(5).trim();
    if (!data || data === "[DONE]") return;
    const chunk = JSON.parse(data);
    captureMetadata(chunk);
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

  const responseContentType = response.headers?.get("content-type")?.toLowerCase() || "";
  if (responseContentType.includes("application/json")) {
    const body = JSON.parse(await response.text() || "null");
    captureMetadata(body);
    const completeContent = body?.choices?.[0]?.message?.content;
    if (typeof completeContent === "string") {
      content = completeContent;
      options.onContent?.(content);
    }
  } else if (response.body) {
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
      captureMetadata(body);
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

  return { text: extractJsonText(content), usage, providerRequestId, model };
}

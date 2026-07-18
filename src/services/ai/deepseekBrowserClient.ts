import { callDeepSeekJson, callDeepSeekJsonStream, DeepSeekClientConfig, DeepSeekStreamOptions } from "../../utils/deepseek";
import { AiClientError } from "./errors";

export interface BrowserDeepSeekConfig extends DeepSeekClientConfig {}

function toClientError(error: unknown): AiClientError {
  if (error instanceof AiClientError) return error;

  const message = error instanceof Error ? error.message : String(error);
  if ((error instanceof DOMException && error.name === "AbortError") || /generation aborted|request aborted/i.test(message)) {
    return new AiClientError("AI_REQUEST_ABORTED", "本次生成已暂停，已生成内容会继续保留。", { cause: error });
  }
  if (error instanceof TypeError || /failed to fetch|network|cors/i.test(message)) {
    return new AiClientError("AI_NETWORK_FAILED", "网络异常：无法连接 DeepSeek API，请检查网络环境。", { cause: error });
  }

  if (/\b401\b|\b403\b|unauthorized|forbidden|invalid api key/i.test(message)) {
    return new AiClientError("AI_AUTH_FAILED", "DeepSeek API Key 校验失败，请检查 VITE_DEEPSEEK_API_KEY。", { cause: error });
  }

  if (/\b429\b|rate limit|too many requests/i.test(message)) {
    return new AiClientError("AI_RATE_LIMITED", "DeepSeek 请求过于频繁，请稍后重试。", { cause: error });
  }

  if (/response did not include JSON content|unexpected end of json|json/i.test(message)) {
    return new AiClientError("AI_RESPONSE_INVALID", "DeepSeek 返回内容格式异常，请重试。", { cause: error });
  }

  return new AiClientError("AI_REQUEST_FAILED", message || "DeepSeek 请求失败，请重试。", { cause: error });
}

function assertApiKey(config: BrowserDeepSeekConfig): void {
  if (config.apiKey?.trim()) return;
  throw new AiClientError(
    "API_KEY_MISSING",
    "未检测到 VITE_DEEPSEEK_API_KEY，请在本地或构建环境中配置 DeepSeek API Key。"
  );
}

export async function callDeepSeekJsonFromBrowser(
  config: BrowserDeepSeekConfig,
  prompt: string,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal
): Promise<{ text: string }> {
  assertApiKey(config);

  try {
    return await callDeepSeekJson(
      {
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        model: config.model
      },
      prompt,
      fetchImpl,
      signal
    );
  } catch (error) {
    throw toClientError(error);
  }
}

export async function callDeepSeekJsonStreamFromBrowser(
  config: BrowserDeepSeekConfig,
  prompt: string,
  options: DeepSeekStreamOptions = {},
  fetchImpl: typeof fetch = fetch
): Promise<{ text: string }> {
  assertApiKey(config);

  try {
    return await callDeepSeekJsonStream(
      {
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        model: config.model
      },
      prompt,
      options,
      fetchImpl
    );
  } catch (error) {
    throw toClientError(error);
  }
}

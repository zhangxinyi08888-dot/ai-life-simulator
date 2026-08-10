import { AiClientError } from "./errors";

export interface BrowserAiEnv {
  apiKey: string;
  baseUrl: string;
  model: string;
  cacheAwarePromptV1: boolean;
  cacheAwarePromptV2: boolean;
}

type BrowserAiEnvRecord = Partial<Record<
  "VITE_DEEPSEEK_API_KEY" | "VITE_DEEPSEEK_BASE_URL" | "VITE_DEEPSEEK_MODEL" | "VITE_CACHE_AWARE_PROMPT_V1" | "VITE_CACHE_AWARE_PROMPT_V2",
  string
>>;

function readTrimmed(value: string | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

export function cacheAwarePromptV1FromRecord(env: BrowserAiEnvRecord): boolean {
  return readTrimmed(env.VITE_CACHE_AWARE_PROMPT_V1).toLowerCase() !== "false";
}

/** V2 stays opt-in until fresh real-AI and human blind-review evidence exists. */
export function cacheAwarePromptV2FromRecord(env: BrowserAiEnvRecord): boolean {
  return readTrimmed(env.VITE_CACHE_AWARE_PROMPT_V2).toLowerCase() === "true";
}

export function getBrowserAiEnvFromRecord(env: BrowserAiEnvRecord): BrowserAiEnv {
  const apiKey = readTrimmed(env.VITE_DEEPSEEK_API_KEY);
  if (!apiKey) {
    throw new AiClientError(
      "API_KEY_MISSING",
      "未检测到 VITE_DEEPSEEK_API_KEY，请在本地或构建环境中配置 DeepSeek API Key。"
    );
  }

  return {
    apiKey,
    baseUrl: trimTrailingSlash(readTrimmed(env.VITE_DEEPSEEK_BASE_URL) || "https://api.deepseek.com"),
    model: readTrimmed(env.VITE_DEEPSEEK_MODEL) || "deepseek-v4-flash",
    cacheAwarePromptV1: cacheAwarePromptV1FromRecord(env),
    cacheAwarePromptV2: cacheAwarePromptV2FromRecord(env)
  };
}

export function getBrowserCacheAwarePromptV1(): boolean {
  return cacheAwarePromptV1FromRecord({
    VITE_CACHE_AWARE_PROMPT_V1: import.meta.env.VITE_CACHE_AWARE_PROMPT_V1
  });
}

export function getBrowserCacheAwarePromptV2(): boolean {
  return cacheAwarePromptV2FromRecord({
    VITE_CACHE_AWARE_PROMPT_V2: import.meta.env.VITE_CACHE_AWARE_PROMPT_V2
  });
}

export function getBrowserAiEnv(): BrowserAiEnv {
  return getBrowserAiEnvFromRecord({
    VITE_DEEPSEEK_API_KEY: import.meta.env.VITE_DEEPSEEK_API_KEY,
    VITE_DEEPSEEK_BASE_URL: import.meta.env.VITE_DEEPSEEK_BASE_URL,
    VITE_DEEPSEEK_MODEL: import.meta.env.VITE_DEEPSEEK_MODEL,
    VITE_CACHE_AWARE_PROMPT_V1: import.meta.env.VITE_CACHE_AWARE_PROMPT_V1,
    VITE_CACHE_AWARE_PROMPT_V2: import.meta.env.VITE_CACHE_AWARE_PROMPT_V2
  });
}

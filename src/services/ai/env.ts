import { AiClientError } from "./errors";

export interface BrowserAiEnv {
  apiKey: string;
  baseUrl: string;
  model: string;
}

type BrowserAiEnvRecord = Partial<Record<
  "VITE_DEEPSEEK_API_KEY" | "VITE_DEEPSEEK_BASE_URL" | "VITE_DEEPSEEK_MODEL",
  string
>>;

function readTrimmed(value: string | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
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
    model: readTrimmed(env.VITE_DEEPSEEK_MODEL) || "deepseek-v4-flash"
  };
}

export function getBrowserAiEnv(): BrowserAiEnv {
  return getBrowserAiEnvFromRecord({
    VITE_DEEPSEEK_API_KEY: import.meta.env.VITE_DEEPSEEK_API_KEY,
    VITE_DEEPSEEK_BASE_URL: import.meta.env.VITE_DEEPSEEK_BASE_URL,
    VITE_DEEPSEEK_MODEL: import.meta.env.VITE_DEEPSEEK_MODEL
  });
}

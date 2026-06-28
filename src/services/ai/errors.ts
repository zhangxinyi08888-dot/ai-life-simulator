export type AiClientErrorCode =
  | "API_KEY_MISSING"
  | "AI_AUTH_FAILED"
  | "AI_RATE_LIMITED"
  | "AI_NETWORK_FAILED"
  | "AI_RESPONSE_INVALID"
  | "AI_REQUEST_FAILED";

export class AiClientError extends Error {
  readonly code: AiClientErrorCode;
  readonly status?: number;

  constructor(code: AiClientErrorCode, message: string, options: { status?: number; cause?: unknown } = {}) {
    super(message, { cause: options.cause });
    this.name = "AiClientError";
    this.code = code;
    this.status = options.status;
  }
}

export function isAiClientError(error: unknown): error is AiClientError {
  return error instanceof AiClientError;
}

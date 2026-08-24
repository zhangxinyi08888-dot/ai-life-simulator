export type AiClientErrorCode =
  | "API_KEY_MISSING"
  | "AI_AUTH_FAILED"
  | "AI_RATE_LIMITED"
  | "AI_REQUEST_ABORTED"
  | "AI_NETWORK_FAILED"
  | "AI_RESPONSE_INVALID"
  | "AI_REQUEST_FAILED";

const aiClientErrorCodes = new Set<AiClientErrorCode>([
  "API_KEY_MISSING",
  "AI_AUTH_FAILED",
  "AI_RATE_LIMITED",
  "AI_REQUEST_ABORTED",
  "AI_NETWORK_FAILED",
  "AI_RESPONSE_INVALID",
  "AI_REQUEST_FAILED"
]);

export class AiClientError extends Error {
  readonly code: AiClientErrorCode;
  readonly status?: number;
  /**
   * A transport failure is safe to replay only when no model request has been
   * accepted. This prevents a dropped socket after send() from causing a
   * duplicate, billable generation in the page-level retry wrapper.
   */
  readonly safeToRetry?: boolean;

  constructor(
    code: AiClientErrorCode,
    message: string,
    options: { status?: number; cause?: unknown; safeToRetry?: boolean } = {}
  ) {
    super(message, { cause: options.cause });
    // 小程序运行时和 Promise 回调可能跨 JS realm 传递 Error。修正本地
    // Error 子类原型，同时让下方的守卫可以识别序列化后的同类错误。
    // Preserve the actual subclass prototype as well. New financial-gate
    // errors extend AiClientError and rely on instanceof at the transaction
    // boundary to perform their bounded, zero-commit regeneration.
    Object.setPrototypeOf(this, new.target.prototype);
    this.name = new.target === AiClientError ? "AiClientError" : new.target.name;
    this.code = code;
    this.status = options.status;
    this.safeToRetry = options.safeToRetry;
  }
}

export function isAiClientError(error: unknown): error is AiClientError {
  if (error instanceof AiClientError) return true;
  if (!error || typeof error !== "object") return false;
  const candidate = error as { name?: unknown; code?: unknown; message?: unknown };
  return (candidate.name === "AiClientError" || candidate.name === "FinancialNodeGateError")
    && typeof candidate.message === "string"
    && typeof candidate.code === "string"
    && aiClientErrorCodes.has(candidate.code as AiClientErrorCode);
}

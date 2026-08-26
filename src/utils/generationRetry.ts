export function isRetryableGenerationError(error: unknown): boolean {
  return Boolean(error)
    && typeof error === "object"
    && (
      (error as { code?: unknown }).code === "AI_RESPONSE_INVALID"
      || (error as { code?: unknown }).code === "AI_NETWORK_FAILED"
      || (
        typeof (error as { message?: unknown }).message === "string"
        && (error as { message: string }).message.startsWith("SIMULATION_NODE_INCOMPLETE:")
      )
    );
}

export function isFinancialGateGenerationError(error: unknown): boolean {
  return Boolean(error)
    && typeof error === "object"
    && (error as { retryScope?: unknown }).retryScope === "financial_gate";
}

export interface GenerationRetryOptions {
  /** Ordinary malformed/temporary-response recovery budget. */
  maxAttempts?: number;
  /**
   * A rejected financial Preview has not committed any state. It may use one
   * additional outer generation attempt so the user does not have to resume a
   * normal, recoverable acceptance-gate regeneration manually.
   */
  maxFinancialGateAttempts?: number;
  isFinancialGateError?: (error: unknown) => boolean;
}

/**
 * The service spends two full candidates inside the first next-node attempt.
 * Two caller-level financial recoveries add one reason-guided candidate each,
 * keeping the total bounded at four before a pause can become visible.
 */
export const NEXT_NODE_FINANCIAL_GATE_ATTEMPTS = 3;

/**
 * Retries malformed/incomplete structured output and one transient network
 * failure before either becomes a user-visible pause. A rejected financial
 * Preview is different: it has not mutated the authoritative node, so the
 * caller may grant it a separately bounded final regeneration while retaining
 * every gate-decision audit event. Authentication, rate-limit, quota and
 * abort failures remain immediately visible.
 */
export async function runWithInvalidAiResponseRetry<T>(
  operation: (attempt: number) => Promise<T>,
  maxAttemptsOrOptions: number | GenerationRetryOptions = 2
): Promise<T> {
  const options = typeof maxAttemptsOrOptions === "number"
    ? { maxAttempts: maxAttemptsOrOptions }
    : maxAttemptsOrOptions;
  const maxAttempts = Math.max(1, options.maxAttempts ?? 2);
  const maxFinancialGateAttempts = Math.max(maxAttempts, options.maxFinancialGateAttempts ?? maxAttempts);
  const isFinancialGateError = options.isFinancialGateError ?? isFinancialGateGenerationError;
  const absoluteMaxAttempts = maxFinancialGateAttempts;
  let lastError: unknown;
  for (let attempt = 1; attempt <= absoluteMaxAttempts; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      const allowedAttempts = isFinancialGateError(error)
        ? maxFinancialGateAttempts
        : maxAttempts;
      if (!isRetryableGenerationError(error) || attempt === allowedAttempts) throw error;
    }
  }
  throw lastError;
}

export function isRetryableInvalidAiResponse(error: unknown): boolean {
  return Boolean(error)
    && typeof error === "object"
    && (error as { code?: unknown }).code === "AI_RESPONSE_INVALID";
}

/**
 * Retries malformed structured AI output before it becomes a user-visible
 * pause. Network, authentication, rate-limit, and abort failures remain
 * immediately visible because repeating them would hide an external problem.
 */
export async function runWithInvalidAiResponseRetry<T>(
  operation: (attempt: number) => Promise<T>,
  maxAttempts = 2
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      if (!isRetryableInvalidAiResponse(error) || attempt === maxAttempts) throw error;
    }
  }
  throw lastError;
}

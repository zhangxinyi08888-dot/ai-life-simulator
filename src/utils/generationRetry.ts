export function isRetryableGenerationError(error: unknown): boolean {
  return Boolean(error)
    && typeof error === "object"
    && (
      (error as { code?: unknown }).code === "AI_RESPONSE_INVALID"
      || (error as { code?: unknown }).code === "AI_NETWORK_FAILED"
    );
}

/**
 * Retries malformed structured output and one transient network failure before
 * either becomes a user-visible pause. Authentication, rate-limit, quota, and
 * abort failures remain immediately visible because retrying them cannot heal
 * the underlying condition.
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
      if (!isRetryableGenerationError(error) || attempt === maxAttempts) throw error;
    }
  }
  throw lastError;
}

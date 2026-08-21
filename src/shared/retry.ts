import { ExternalApiError } from './errors.js';

export interface RetryOptions {
  attempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  sleep?: (ms: number) => Promise<void>;
}

export async function withRetry<T>(operation: () => Promise<T>, options: RetryOptions): Promise<T> {
  const sleep =
    options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  let lastError: unknown;
  for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const retryable = error instanceof ExternalApiError ? error.retryable : false;
      if (!retryable || attempt === options.attempts) throw error;
      const retryAfterMs =
        typeof error === 'object' &&
        error !== null &&
        error instanceof ExternalApiError &&
        typeof error.context.retry_after_ms === 'number'
          ? error.context.retry_after_ms
          : null;
      await sleep(
        retryAfterMs ?? Math.min(options.maxDelayMs, options.baseDelayMs * 2 ** (attempt - 1)),
      );
    }
  }
  throw lastError;
}

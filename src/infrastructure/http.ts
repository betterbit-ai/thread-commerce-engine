import { ExternalApiError } from '../shared/errors.js';
import { withRetry } from '../shared/retry.js';

export interface HttpOptions {
  timeoutMs: number;
  attempts: number;
  fetchFn?: typeof fetch;
  allowUnsafeRetries?: boolean;
}

export async function requestJson(
  url: string,
  init: RequestInit,
  options: HttpOptions,
): Promise<{ data: unknown; headers: Headers }> {
  const fetchFn = options.fetchFn ?? fetch;
  return withRetry(
    async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
      try {
        const response = await fetchFn(url, { ...init, signal: controller.signal });
        const text = await response.text();
        let data: unknown;
        try {
          data = text ? JSON.parse(text) : null;
        } catch {
          data = { unparseable: true };
        }
        if (!response.ok) {
          const retryAfterSeconds = Number(response.headers.get('retry-after'));
          throw new ExternalApiError(
            `External API returned HTTP ${response.status}`,
            response.status,
            response.status === 429 || response.status >= 500,
            {
              endpoint: new URL(url).origin,
              response: data,
              ...(Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0
                ? { retry_after_ms: retryAfterSeconds * 1000 }
                : {}),
            },
          );
        }
        return { data, headers: response.headers };
      } catch (error) {
        if (error instanceof ExternalApiError) throw error;
        throw new ExternalApiError('External request failed', null, true, {
          cause: error instanceof Error ? error.message : 'unknown',
        });
      } finally {
        clearTimeout(timeout);
      }
    },
    {
      attempts:
        init.method && init.method.toUpperCase() !== 'GET' && !options.allowUnsafeRetries
          ? 1
          : options.attempts,
      baseDelayMs: 500,
      maxDelayMs: 5000,
    },
  );
}

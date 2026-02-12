import { log } from './logger.js';

export interface RetryOptions {
  maxAttempts: number;
  backoffMs: number;
}

/**
 * Retry an async function with exponential backoff + jitter.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  opts: RetryOptions,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < opts.maxAttempts) {
        const jitter = Math.random() * opts.backoffMs * 0.5;
        const delay = opts.backoffMs * attempt + jitter;
        log.warn(`Retry ${attempt}/${opts.maxAttempts} for ${label}, waiting ${Math.round(delay)}ms`, {
          attempt,
          error: err instanceof Error ? err.message : String(err),
        });
        await sleep(delay);
      }
    }
  }

  throw lastError;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

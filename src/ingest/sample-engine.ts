import type { ExchangeKey, RawSample, IngestionConfig } from '../types.js';
import { FETCH_REGISTRY } from '../exchanges/index.js';
import { normalizeBook, analyzeBook } from '../metrics/slippage.js';
import { fetchHyperliquidAdaptive } from './hyperliquid-strategy.js';
import { fetchLighterWithFallback } from './lighter-strategy.js';
import { resolveSymbol, isTickerSupportedOnExchange } from '../pair-mapping.js';
import { withRetry } from '../util/retry.js';
import { classifyError } from '../util/errors.js';
import { log } from '../util/logger.js';
import { appendSampleErrorLog } from '../storage/error-log.js';

/**
 * Collect a single sample for one exchange+ticker pair.
 */
async function collectOneSample(
  exchange: ExchangeKey,
  ticker: string,
  sampleIndex: number,
  config: IngestionConfig,
): Promise<RawSample> {
  const start = Date.now();

  try {
    const symbol = resolveSymbol(ticker, exchange);
    const depthLimit = config.depth_limit_by_exchange[exchange];
    const timeoutMs = config.fetch_timeout_ms;

    const analysis = await withRetry(
      async () => {
        // Special strategies for Hyperliquid and Lighter
        if (exchange === 'hyperliquid' && config.enable_hyperliquid_adaptive_sigfigs) {
          return fetchHyperliquidAdaptive(symbol, timeoutMs);
        }

        if (exchange === 'lighter') {
          return fetchLighterWithFallback(
            symbol,
            depthLimit,
            timeoutMs,
            config.enable_lighter_ws_fallback,
          );
        }

        // Standard exchanges: fetch + normalize + analyze
        const fetchFn = FETCH_REGISTRY[exchange];
        const rawBook = await fetchFn(symbol, depthLimit, timeoutMs);
        const book = normalizeBook(rawBook.bids, rawBook.asks, rawBook.timestamp);

        if (!book) {
          throw new Error(`Empty book for ${exchange}:${symbol}`);
        }

        return analyzeBook(book, exchange, ticker);
      },
      `${exchange}:${ticker}:sample${sampleIndex}`,
      { maxAttempts: config.retry_max_attempts, backoffMs: config.retry_backoff_ms },
    );

    return {
      exchange,
      ticker,
      sampleIndex,
      collectedAtMs: Date.now(),
      analysis,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    const classified = classifyError(err, exchange);
    log.warn(`Sample failed: ${exchange}:${ticker}[${sampleIndex}] - ${classified.code}: ${classified.message}`);
    appendSampleErrorLog({
      ts: new Date().toISOString(),
      exchange,
      ticker,
      sample_index: sampleIndex,
      code: classified.code,
      message: classified.message,
    });

    return {
      exchange,
      ticker,
      sampleIndex,
      collectedAtMs: Date.now(),
      analysis: null,
      error: `${classified.code}: ${classified.message}`,
      durationMs: Date.now() - start,
    };
  }
}

/**
 * Collect one round of samples for all exchange+ticker pairs.
 * Fires all fetches concurrently.
 */
export async function collectSampleRound(
  sampleIndex: number,
  config: IngestionConfig,
): Promise<RawSample[]> {
  const tasks: Promise<RawSample>[] = [];

  for (const ticker of config.pairs) {
    for (const exchange of config.exchanges) {
      if (!isTickerSupportedOnExchange(ticker, exchange)) {
        log.debug(`Skipping unsupported pair ${exchange}:${ticker}`);
        continue;
      }
      tasks.push(collectOneSample(exchange, ticker, sampleIndex, config));
    }
  }

  return Promise.all(tasks);
}

import type { ExchangeKey, RawSample, IngestionConfig } from './types.ts';
import { FETCH_REGISTRY } from './exchanges/index.ts';
import { normalizeBook, analyzeBook } from './slippage.ts';
import { fetchHyperliquidAdaptive } from './strategies/hyperliquid-strategy.ts';
import { fetchLighterWithFallback } from './strategies/lighter-strategy.ts';
import { resolveSymbol, isTickerSupportedOnExchange } from './pair-mapping.ts';
import { withRetry } from './retry.ts';
import { classifyError } from './errors.ts';

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
        if (exchange === 'hyperliquid' && config.enable_hyperliquid_adaptive_sigfigs) {
          return fetchHyperliquidAdaptive(symbol, timeoutMs);
        }

        if (exchange === 'lighter') {
          return fetchLighterWithFallback(
            symbol, depthLimit, timeoutMs,
            config.enable_lighter_ws_fallback,
          );
        }

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
    console.warn(`Sample failed: ${exchange}:${ticker}[${sampleIndex}] - ${classified.code}: ${classified.message}`);

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

export async function collectSampleRound(
  sampleIndex: number,
  config: IngestionConfig,
): Promise<RawSample[]> {
  const tasks: Promise<RawSample>[] = [];

  for (const ticker of config.pairs) {
    for (const exchange of config.exchanges) {
      if (!isTickerSupportedOnExchange(ticker, exchange)) {
        continue;
      }
      tasks.push(collectOneSample(exchange, ticker, sampleIndex, config));
    }
  }

  return Promise.all(tasks);
}

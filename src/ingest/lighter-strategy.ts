import type { LiquidityAnalysis } from '../types.js';
import { fetchLighterRest, resolveMarketId } from '../exchanges/lighter-rest.js';
import { fetchLighterWs } from '../exchanges/lighter-ws.js';
import { normalizeBook, analyzeBook } from '../metrics/slippage.js';
import { log } from '../util/logger.js';

/**
 * Lighter REST -> WS fallback strategy.
 *
 * Algorithm (from plan section 4.3):
 * 1. Fetch/analyze REST order book (limit=250).
 * 2. If any slippage tier on either side is partial (filled=false),
 *    attempt WS snapshot fallback.
 * 3. If WS success, use WS analysis and set lighterWsFallback=true.
 * 4. If WS fails, keep REST analysis.
 */
export async function fetchLighterWithFallback(
  symbol: string,
  depthLimit: number,
  timeoutMs: number,
  enableWsFallback: boolean,
): Promise<LiquidityAnalysis> {
  // Step 1: REST fetch
  const restRaw = await fetchLighterRest(symbol, depthLimit, timeoutMs);
  const restBook = normalizeBook(restRaw.bids, restRaw.asks, restRaw.timestamp);

  if (!restBook) {
    throw new Error(`Lighter REST: empty book for ${symbol}`);
  }

  const restAnalysis = analyzeBook(restBook, 'lighter', symbol);

  // Step 2: Check for partial fills
  const hasPartial =
    restAnalysis.asks.some((t) => !t.filled) ||
    restAnalysis.bids.some((t) => !t.filled);

  if (!hasPartial || !enableWsFallback) {
    restAnalysis.lighterWsFallback = false;
    return restAnalysis;
  }

  // Step 3: WS fallback
  log.info(`Lighter: REST partial for ${symbol}, attempting WS fallback`);

  try {
    const marketId = await resolveMarketId(symbol, timeoutMs);
    const wsRaw = await fetchLighterWs(marketId, timeoutMs);
    const wsBook = normalizeBook(wsRaw.bids, wsRaw.asks, wsRaw.timestamp);

    if (!wsBook) {
      log.warn(`Lighter WS: empty book for ${symbol}, keeping REST analysis`);
      restAnalysis.lighterWsFallback = false;
      return restAnalysis;
    }

    const wsAnalysis = analyzeBook(wsBook, 'lighter', symbol);
    wsAnalysis.lighterWsFallback = true;

    log.info(`Lighter WS fallback success for ${symbol}: ${wsBook.bids.length} bids, ${wsBook.asks.length} asks`);
    return wsAnalysis;
  } catch (err) {
    log.warn(`Lighter WS fallback failed for ${symbol}: ${err}. Using REST analysis.`);
    restAnalysis.lighterWsFallback = false;
    return restAnalysis;
  }
}

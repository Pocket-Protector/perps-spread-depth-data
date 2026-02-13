import type { LiquidityAnalysis } from '../types.ts';
import { fetchLighterRest, resolveMarketId } from '../exchanges/lighter-rest.ts';
import { fetchLighterWs } from '../exchanges/lighter-ws.ts';
import { normalizeBook, analyzeBook } from '../slippage.ts';

export async function fetchLighterWithFallback(
  symbol: string,
  depthLimit: number,
  timeoutMs: number,
  enableWsFallback: boolean,
): Promise<LiquidityAnalysis> {
  const restRaw = await fetchLighterRest(symbol, depthLimit, timeoutMs);
  const restBook = normalizeBook(restRaw.bids, restRaw.asks, restRaw.timestamp);

  if (!restBook) {
    throw new Error(`Lighter REST: empty book for ${symbol}`);
  }

  const restAnalysis = analyzeBook(restBook, 'lighter', symbol);

  const hasPartial =
    restAnalysis.asks.some((t) => !t.filled) ||
    restAnalysis.bids.some((t) => !t.filled);

  if (!hasPartial || !enableWsFallback) {
    restAnalysis.lighterWsFallback = false;
    return restAnalysis;
  }

  console.info(`Lighter: REST partial for ${symbol}, attempting WS fallback`);

  try {
    const marketId = await resolveMarketId(symbol, timeoutMs);
    const wsRaw = await fetchLighterWs(marketId, timeoutMs);
    const wsBook = normalizeBook(wsRaw.bids, wsRaw.asks, wsRaw.timestamp);

    if (!wsBook) {
      console.warn(`Lighter WS: empty book for ${symbol}, keeping REST analysis`);
      restAnalysis.lighterWsFallback = false;
      return restAnalysis;
    }

    const wsAnalysis = analyzeBook(wsBook, 'lighter', symbol);
    wsAnalysis.lighterWsFallback = true;
    return wsAnalysis;
  } catch (err) {
    console.warn(`Lighter WS fallback failed for ${symbol}:`, err, 'Using REST analysis.');
    restAnalysis.lighterWsFallback = false;
    return restAnalysis;
  }
}

import type { ExchangeKey, NormalizedBook } from '../types.js';
import { fetchHyperliquid } from './hyperliquid.js';
import { fetchDydx } from './dydx.js';
import { fetchLighterRest } from './lighter-rest.js';
import { fetchBinance, fetchAsterdex } from './binance.js';
import { fetchBybit } from './bybit.js';

export type FetchFn = (
  symbol: string,
  depthLimit: number,
  timeoutMs: number,
) => Promise<NormalizedBook>;

/**
 * Registry of basic fetch functions for each exchange.
 * Hyperliquid and Lighter have special strategies built on top of these
 * (see ingest/hyperliquid-strategy.ts and ingest/lighter-strategy.ts).
 */
export const FETCH_REGISTRY: Record<ExchangeKey, FetchFn> = {
  hyperliquid: (symbol, _depth, timeout) => fetchHyperliquid(symbol, timeout),
  dydx: (symbol, _depth, timeout) => fetchDydx(symbol, timeout),
  lighter: (symbol, depth, timeout) => fetchLighterRest(symbol, depth, timeout),
  asterdex: fetchAsterdex,
  binance: fetchBinance,
  bybit: fetchBybit,
};

// Re-export individual fetchers for direct use
export { fetchHyperliquid } from './hyperliquid.js';
export { fetchDydx } from './dydx.js';
export { fetchLighterRest, resolveMarketId } from './lighter-rest.js';
export { fetchLighterWs } from './lighter-ws.js';
export { fetchBinance, fetchAsterdex } from './binance.js';
export { fetchBybit } from './bybit.js';

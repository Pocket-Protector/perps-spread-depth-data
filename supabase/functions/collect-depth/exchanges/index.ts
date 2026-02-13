import type { ExchangeKey, NormalizedBook } from '../types.ts';
import { fetchHyperliquid } from './hyperliquid.ts';
import { fetchDydx } from './dydx.ts';
import { fetchLighterRest } from './lighter-rest.ts';
import { fetchBinance, fetchAsterdex } from './binance.ts';
import { fetchBybit } from './bybit.ts';

export type FetchFn = (
  symbol: string,
  depthLimit: number,
  timeoutMs: number,
) => Promise<NormalizedBook>;

export const FETCH_REGISTRY: Record<ExchangeKey, FetchFn> = {
  hyperliquid: (symbol, _depth, timeout) => fetchHyperliquid(symbol, timeout),
  dydx: (symbol, _depth, timeout) => fetchDydx(symbol, timeout),
  lighter: (symbol, depth, timeout) => fetchLighterRest(symbol, depth, timeout),
  asterdex: fetchAsterdex,
  binance: fetchBinance,
  bybit: fetchBybit,
};

export { fetchHyperliquid } from './hyperliquid.ts';
export { fetchDydx } from './dydx.ts';
export { fetchLighterRest, resolveMarketId } from './lighter-rest.ts';
export { fetchLighterWs } from './lighter-ws.ts';
export { fetchBinance, fetchAsterdex } from './binance.ts';
export { fetchBybit } from './bybit.ts';

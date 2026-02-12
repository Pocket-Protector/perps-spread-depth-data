import type { NormalizedBook, OrderBookLevel } from '../types.js';
import { EXCHANGE_BASE_URLS } from '../constants.js';
import { FetchError } from '../util/errors.js';
import { buildExchangeRequestUrl } from '../util/http-proxy.js';

/**
 * Shared fetcher for Binance-compatible /fapi/v1/depth endpoints.
 * Works for both Binance and AsterDEX (identical interface).
 *
 * Response: { bids: [[price, qty]], asks: [[price, qty]], lastUpdateId, E, T }
 */
export async function fetchBinanceStyle(
  baseUrl: string,
  exchangeName: 'binance' | 'asterdex',
  symbol: string,
  depthLimit: number,
  timeoutMs: number,
): Promise<NormalizedBook> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const targetUrl = `${baseUrl}/fapi/v1/depth?symbol=${symbol}&limit=${depthLimit}`;
    const requestUrl = buildExchangeRequestUrl(exchangeName, targetUrl);
    const res = await fetch(requestUrl, { signal: controller.signal });

    if (!res.ok) {
      throw new FetchError('http_error', exchangeName, `HTTP ${res.status}`, res.status);
    }

    const data = await res.json() as {
      bids: [string, string][];
      asks: [string, string][];
    };

    const bids: OrderBookLevel[] = data.bids.map(([p, s]) => ({
      price: parseFloat(p),
      size: parseFloat(s),
    }));

    const asks: OrderBookLevel[] = data.asks.map(([p, s]) => ({
      price: parseFloat(p),
      size: parseFloat(s),
    }));

    return { bids, asks, timestamp: Date.now() };
  } finally {
    clearTimeout(timer);
  }
}

/** Fetch Binance Futures orderbook */
export async function fetchBinance(
  symbol: string,
  depthLimit: number,
  timeoutMs: number,
): Promise<NormalizedBook> {
  return fetchBinanceStyle(
    EXCHANGE_BASE_URLS.binance,
    'binance',
    symbol,
    depthLimit,
    timeoutMs,
  );
}

/** Fetch AsterDEX orderbook (identical interface to Binance) */
export async function fetchAsterdex(
  symbol: string,
  depthLimit: number,
  timeoutMs: number,
): Promise<NormalizedBook> {
  return fetchBinanceStyle(
    EXCHANGE_BASE_URLS.asterdex,
    'asterdex',
    symbol,
    depthLimit,
    timeoutMs,
  );
}

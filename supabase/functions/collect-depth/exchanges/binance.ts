import type { NormalizedBook, OrderBookLevel } from '../types.ts';
import { EXCHANGE_BASE_URLS } from '../constants.ts';
import { FetchError } from '../errors.ts';

async function fetchBinanceStyle(
  baseUrl: string,
  exchangeName: 'binance' | 'asterdex',
  symbol: string,
  depthLimit: number,
  timeoutMs: number,
): Promise<NormalizedBook> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const url = `${baseUrl}/fapi/v1/depth?symbol=${symbol}&limit=${depthLimit}`;
    const res = await fetch(url, { signal: controller.signal });

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

export async function fetchBinance(
  symbol: string,
  depthLimit: number,
  timeoutMs: number,
): Promise<NormalizedBook> {
  return fetchBinanceStyle(EXCHANGE_BASE_URLS.binance, 'binance', symbol, depthLimit, timeoutMs);
}

export async function fetchAsterdex(
  symbol: string,
  depthLimit: number,
  timeoutMs: number,
): Promise<NormalizedBook> {
  return fetchBinanceStyle(EXCHANGE_BASE_URLS.asterdex, 'asterdex', symbol, depthLimit, timeoutMs);
}

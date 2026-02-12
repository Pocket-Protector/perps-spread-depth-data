import type { NormalizedBook, OrderBookLevel } from '../types.js';
import { EXCHANGE_BASE_URLS } from '../constants.js';
import { FetchError } from '../util/errors.js';
import { buildExchangeRequestUrl } from '../util/http-proxy.js';

const BASE = EXCHANGE_BASE_URLS.bybit;

/**
 * Fetch Bybit V5 orderbook.
 *
 * GET /v5/market/orderbook?category=linear&symbol={symbol}&limit={limit}
 * Response: { result: { b: [[price, size]], a: [[price, size]], u, seq, cts } }
 */
export async function fetchBybit(
  symbol: string,
  depthLimit: number,
  timeoutMs: number,
): Promise<NormalizedBook> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const targetUrl = `${BASE}/v5/market/orderbook?category=linear&symbol=${symbol}&limit=${depthLimit}`;
    const requestUrl = buildExchangeRequestUrl('bybit', targetUrl);
    const res = await fetch(requestUrl, { signal: controller.signal });

    if (!res.ok) {
      throw new FetchError('http_error', 'bybit', `HTTP ${res.status}`, res.status);
    }

    const data = await res.json() as {
      retCode: number;
      result: {
        b: [string, string][];
        a: [string, string][];
        ts: string;
      };
    };

    if (data.retCode !== 0) {
      throw new FetchError('http_error', 'bybit', `Bybit retCode ${data.retCode}`);
    }

    const bids: OrderBookLevel[] = data.result.b.map(([p, s]) => ({
      price: parseFloat(p),
      size: parseFloat(s),
    }));

    const asks: OrderBookLevel[] = data.result.a.map(([p, s]) => ({
      price: parseFloat(p),
      size: parseFloat(s),
    }));

    const timestamp = data.result.ts ? parseInt(data.result.ts, 10) : undefined;

    return { bids, asks, timestamp };
  } finally {
    clearTimeout(timer);
  }
}

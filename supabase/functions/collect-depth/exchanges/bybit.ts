import type { NormalizedBook, OrderBookLevel } from '../types.ts';
import { EXCHANGE_BASE_URLS } from '../constants.ts';
import { FetchError } from '../errors.ts';

const BASE = EXCHANGE_BASE_URLS.bybit;

export async function fetchBybit(
  symbol: string,
  depthLimit: number,
  timeoutMs: number,
): Promise<NormalizedBook> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const url = `${BASE}/v5/market/orderbook?category=linear&symbol=${symbol}&limit=${depthLimit}`;
    const res = await fetch(url, { signal: controller.signal });

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

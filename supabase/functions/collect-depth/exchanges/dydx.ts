import type { NormalizedBook, OrderBookLevel } from '../types.ts';
import { EXCHANGE_BASE_URLS } from '../constants.ts';
import { FetchError } from '../errors.ts';

const BASE = EXCHANGE_BASE_URLS.dydx;

export async function fetchDydx(
  ticker: string,
  timeoutMs: number,
): Promise<NormalizedBook> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const url = `${BASE}/v4/orderbooks/perpetualMarket/${ticker}`;
    const res = await fetch(url, { signal: controller.signal });

    if (!res.ok) {
      throw new FetchError('http_error', 'dydx', `HTTP ${res.status}`, res.status);
    }

    const data = await res.json() as {
      bids: Array<{ price: string; size: string }>;
      asks: Array<{ price: string; size: string }>;
    };

    const bids: OrderBookLevel[] = data.bids.map((l) => ({
      price: parseFloat(l.price),
      size: parseFloat(l.size),
    }));

    const asks: OrderBookLevel[] = data.asks.map((l) => ({
      price: parseFloat(l.price),
      size: parseFloat(l.size),
    }));

    return { bids, asks };
  } finally {
    clearTimeout(timer);
  }
}

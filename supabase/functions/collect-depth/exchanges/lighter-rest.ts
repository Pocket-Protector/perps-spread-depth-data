import type { NormalizedBook, OrderBookLevel } from '../types.ts';
import { EXCHANGE_BASE_URLS, LIGHTER_MARKET_CACHE_TTL_MS } from '../constants.ts';
import { FetchError } from '../errors.ts';

const BASE = EXCHANGE_BASE_URLS.lighter;

// ── Market ID cache ──

interface MarketEntry {
  marketId: number;
  cachedAt: number;
}

const marketIdCache = new Map<string, MarketEntry>();

export async function resolveMarketId(
  symbol: string,
  timeoutMs: number,
): Promise<number> {
  const cached = marketIdCache.get(symbol);
  if (cached && Date.now() - cached.cachedAt < LIGHTER_MARKET_CACHE_TTL_MS) {
    return cached.marketId;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${BASE}/api/v1/orderBooks`, { signal: controller.signal });
    if (!res.ok) {
      throw new FetchError('http_error', 'lighter', `Market list HTTP ${res.status}`, res.status);
    }

    const data = await res.json() as {
      order_books: Array<{ market_id: number; symbol: string }>;
    };

    const now = Date.now();
    for (const ob of data.order_books) {
      marketIdCache.set(ob.symbol, { marketId: ob.market_id, cachedAt: now });
    }

    const entry = marketIdCache.get(symbol);
    if (!entry) {
      throw new FetchError('parse_error', 'lighter', `Symbol ${symbol} not found in Lighter markets`);
    }

    return entry.marketId;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchLighterRest(
  symbol: string,
  depthLimit: number,
  timeoutMs: number,
): Promise<NormalizedBook> {
  const marketId = await resolveMarketId(symbol, timeoutMs);
  const limit = Math.min(depthLimit, 250);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const url = `${BASE}/api/v1/orderBookOrders?market_id=${marketId}&limit=${limit}`;
    const res = await fetch(url, { signal: controller.signal });

    if (!res.ok) {
      throw new FetchError('http_error', 'lighter', `HTTP ${res.status}`, res.status);
    }

    const data = await res.json() as {
      bids: Array<{ price: string; remaining_base_amount: string }>;
      asks: Array<{ price: string; remaining_base_amount: string }>;
    };

    const bids = aggregateLevels(data.bids);
    const asks = aggregateLevels(data.asks);

    return { bids, asks };
  } finally {
    clearTimeout(timer);
  }
}

function aggregateLevels(
  orders: Array<{ price: string; remaining_base_amount: string }>,
): OrderBookLevel[] {
  const map = new Map<number, number>();
  for (const o of orders) {
    const price = parseFloat(o.price);
    const size = parseFloat(o.remaining_base_amount);
    map.set(price, (map.get(price) ?? 0) + size);
  }
  return Array.from(map.entries()).map(([price, size]) => ({ price, size }));
}

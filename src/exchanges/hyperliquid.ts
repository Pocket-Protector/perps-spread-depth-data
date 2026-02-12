import type { NormalizedBook, OrderBookLevel } from '../types.js';
import { EXCHANGE_BASE_URLS } from '../constants.js';
import { FetchError } from '../util/errors.js';

const BASE = EXCHANGE_BASE_URLS.hyperliquid;

/**
 * Fetch Hyperliquid l2Book.
 *
 * POST /info with { type: "l2Book", coin, nSigFigs? }
 * Returns up to 20 levels per side.
 * Response: { levels: [[{px,sz,n}...], [{px,sz,n}...]] }
 *   levels[0] = bids (descending), levels[1] = asks (ascending)
 */
export async function fetchHyperliquid(
  coin: string,
  timeoutMs: number,
  nSigFigs?: number,
): Promise<NormalizedBook> {
  const body: Record<string, unknown> = { type: 'l2Book', coin };
  if (nSigFigs !== undefined) body.nSigFigs = nSigFigs;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${BASE}/info`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new FetchError('http_error', 'hyperliquid', `HTTP ${res.status}`, res.status);
    }

    const data = await res.json() as {
      levels: Array<Array<{ px: string; sz: string; n: number }>>;
    };

    if (!data.levels || data.levels.length < 2) {
      throw new FetchError('parse_error', 'hyperliquid', 'Missing levels in response');
    }

    const bids: OrderBookLevel[] = data.levels[0].map((l) => ({
      price: parseFloat(l.px),
      size: parseFloat(l.sz),
    }));

    const asks: OrderBookLevel[] = data.levels[1].map((l) => ({
      price: parseFloat(l.px),
      size: parseFloat(l.sz),
    }));

    return { bids, asks };
  } finally {
    clearTimeout(timer);
  }
}

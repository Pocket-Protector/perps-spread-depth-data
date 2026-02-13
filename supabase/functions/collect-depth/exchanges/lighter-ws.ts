import type { NormalizedBook, OrderBookLevel } from '../types.ts';
import { LIGHTER_WS_URL, LIGHTER_WS_TIMEOUT_MS } from '../constants.ts';
import { FetchError } from '../errors.ts';

/**
 * One-shot WebSocket fetch of the full Lighter order book.
 * Uses native Deno WebSocket (no npm ws package needed).
 */
export async function fetchLighterWs(
  marketId: number,
  timeoutMs: number = LIGHTER_WS_TIMEOUT_MS,
): Promise<NormalizedBook> {
  return new Promise<NormalizedBook>((resolve, reject) => {
    const ws = new WebSocket(LIGHTER_WS_URL);
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        ws.close();
        reject(new FetchError('ws_error', 'lighter', `WS timeout after ${timeoutMs}ms`));
      }
    }, timeoutMs);

    ws.onopen = () => {
      ws.send(JSON.stringify({
        type: 'subscribe',
        channel: `order_book/${marketId}`,
      }));
    };

    ws.onmessage = (event) => {
      if (settled) return;
      try {
        const msg = JSON.parse(typeof event.data === 'string' ? event.data : '');

        // Look for the snapshot that contains order_book data
        if (msg.order_book || msg.data?.order_book) {
          const ob = msg.order_book ?? msg.data.order_book;

          const bids: OrderBookLevel[] = (ob.bids ?? []).map(
            (l: { price: string; size: string }) => ({
              price: parseFloat(l.price),
              size: parseFloat(l.size),
            }),
          );

          const asks: OrderBookLevel[] = (ob.asks ?? []).map(
            (l: { price: string; size: string }) => ({
              price: parseFloat(l.price),
              size: parseFloat(l.size),
            }),
          );

          settled = true;
          clearTimeout(timer);
          ws.close();
          resolve({ bids, asks });
          return;
        }

        // Also handle if bids/asks at root
        if (msg.bids && msg.asks) {
          const bids: OrderBookLevel[] = msg.bids.map(
            (l: { price: string; size: string }) => ({
              price: parseFloat(l.price),
              size: parseFloat(l.size),
            }),
          );

          const asks: OrderBookLevel[] = msg.asks.map(
            (l: { price: string; size: string }) => ({
              price: parseFloat(l.price),
              size: parseFloat(l.size),
            }),
          );

          settled = true;
          clearTimeout(timer);
          ws.close();
          resolve({ bids, asks });
          return;
        }
      } catch {
        // Ignore non-orderbook messages
      }
    };

    ws.onerror = (event) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        ws.close();
        const msg = event instanceof ErrorEvent ? event.message : 'WebSocket error';
        reject(new FetchError('ws_error', 'lighter', `WS error: ${msg}`));
      }
    };
  });
}

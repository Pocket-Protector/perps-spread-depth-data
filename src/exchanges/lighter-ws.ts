import WebSocket from 'ws';
import type { NormalizedBook, OrderBookLevel } from '../types.js';
import { LIGHTER_WS_URL, LIGHTER_WS_TIMEOUT_MS } from '../constants.js';
import { FetchError } from '../util/errors.js';
import { log } from '../util/logger.js';

/**
 * One-shot WebSocket fetch of the full Lighter order book.
 *
 * Opens a WS connection, subscribes to order_book/{marketId},
 * captures the first snapshot, then closes.
 * Timeout after LIGHTER_WS_TIMEOUT_MS (default 8s).
 *
 * The WS returns L2-aggregated levels with { price, size }.
 */
export async function fetchLighterWs(
  marketId: number,
  timeoutMs: number = LIGHTER_WS_TIMEOUT_MS,
): Promise<NormalizedBook> {
  return new Promise<NormalizedBook>((resolve, reject) => {
    const ws = new WebSocket(LIGHTER_WS_URL);
    const timer = setTimeout(() => {
      ws.close();
      reject(new FetchError('ws_error', 'lighter', `WS timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    ws.on('open', () => {
      ws.send(JSON.stringify({
        type: 'subscribe',
        channel: `order_book/${marketId}`,
      }));
    });

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());

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

          clearTimeout(timer);
          ws.close();
          resolve({ bids, asks });
          return;
        }

        // Also handle if the snapshot is directly in bids/asks at root
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

          clearTimeout(timer);
          ws.close();
          resolve({ bids, asks });
          return;
        }
      } catch (err) {
        log.debug('Lighter WS: ignoring non-orderbook message');
      }
    });

    ws.on('error', (err) => {
      clearTimeout(timer);
      ws.close();
      reject(new FetchError('ws_error', 'lighter', `WS error: ${err.message}`));
    });
  });
}

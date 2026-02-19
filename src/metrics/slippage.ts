import type {
  ExchangeKey,
  NormalizedBook,
  OrderBookLevel,
  SlippageTierResult,
  LiquidityAnalysis,
} from '../types.js';
import { NOTIONAL_TIERS } from '../constants.js';
import { round } from '../util/round.js';

// ── Book normalization ──

/**
 * Normalize a raw order book into a clean NormalizedBook.
 *
 * Rules (from plan section 3.2):
 * - Parse numeric fields to floats
 * - Drop invalid levels (NaN, non-finite, <= 0 price or size)
 * - Sort bids descending by price
 * - Sort asks ascending by price
 * - Reject empty-side books (returns null)
 */
export function normalizeBook(
  rawBids: OrderBookLevel[],
  rawAsks: OrderBookLevel[],
  timestamp?: number,
): NormalizedBook | null {
  const filterValid = (levels: OrderBookLevel[]): OrderBookLevel[] =>
    levels.filter(
      (l) =>
        Number.isFinite(l.price) &&
        Number.isFinite(l.size) &&
        l.price > 0 &&
        l.size > 0,
    );

  const bids = filterValid(rawBids).sort((a, b) => b.price - a.price);
  const asks = filterValid(rawAsks).sort((a, b) => a.price - b.price);

  if (bids.length === 0 || asks.length === 0) {
    return null;
  }

  return { bids, asks, timestamp };
}

// ── Slippage for one side at one notional tier ──

/**
 * Walk the order book from best price outward, filling `targetNotional`.
 *
 * Rules (from plan section 3.3):
 * - Walk levels from best price outward
 * - Fill notional until exhausted or levels end
 * - vwap = totalCost / totalQty when totalQty > 0, else 0
 * - filled = remainingNotional <= 0
 * - filledNotional = totalCost
 * - Slippage bps:
 *     Ask: ((vwap - midPrice) / midPrice) * 10000
 *     Bid: ((midPrice - vwap) / midPrice) * 10000
 *
 * Rounding:
 * - vwap: 6 decimals
 * - slippageBps: 2 decimals
 * - filledNotional: 2 decimals
 */
export function computeSlippage(
  levels: OrderBookLevel[],
  targetNotional: number,
  midPrice: number,
  side: 'bid' | 'ask',
): SlippageTierResult {
  let remainingNotional = targetNotional;
  let totalCost = 0;
  let totalQty = 0;

  for (const level of levels) {
    if (remainingNotional <= 0) break;

    const levelNotional = level.price * level.size;
    const fillNotional = Math.min(levelNotional, remainingNotional);
    const fillQty = fillNotional / level.price;

    totalCost += fillNotional;
    totalQty += fillQty;
    remainingNotional -= fillNotional;
  }

  const vwap = totalQty > 0 ? totalCost / totalQty : 0;
  const filled = remainingNotional <= 0;
  const filledNotional = totalCost;

  let slippageBps = 0;
  if (vwap > 0 && midPrice > 0) {
    if (side === 'ask') {
      slippageBps = ((vwap - midPrice) / midPrice) * 10_000;
    } else {
      slippageBps = ((midPrice - vwap) / midPrice) * 10_000;
    }
  }

  return {
    notional: targetNotional,
    vwap: round(vwap, 6),
    slippageBps: round(slippageBps, 2),
    filled,
    filledNotional: round(filledNotional, 2),
  };
}

// ── Full analysis of one order book ──

/**
 * Analyze a normalized book: compute mid, spread, and slippage at all tiers.
 *
 * Metrics (from plan section 3.4):
 * - bestBid, bestAsk
 * - midPrice = (bestBid + bestAsk) / 2
 * - spreadUsd = bestAsk - bestBid
 * - spreadBps = (spreadUsd / midPrice) * 10000
 * - Slippage arrays for each notional tier, both sides
 */
export function analyzeBook(
  book: NormalizedBook,
  exchange: ExchangeKey,
  ticker: string,
  tiers: readonly number[] = NOTIONAL_TIERS,
): LiquidityAnalysis {
  const bestBid = book.bids[0].price;
  const bestAsk = book.asks[0].price;

  // Use full float precision for all calculations; round only for stored output.
  const rawMid      = (bestBid + bestAsk) / 2;
  const rawSpreadUsd = bestAsk - bestBid;

  const midPrice  = round(rawMid, 10);
  const spreadUsd = round(rawSpreadUsd, 10);
  const spreadBps = round((rawSpreadUsd / rawMid) * 10_000, 2);

  const asks = tiers.map((notional) =>
    computeSlippage(book.asks, notional, rawMid, 'ask'),
  );
  const bids = tiers.map((notional) =>
    computeSlippage(book.bids, notional, rawMid, 'bid'),
  );

  return {
    exchange,
    ticker,
    midPrice,
    bestBid: round(bestBid, 10),
    bestAsk: round(bestAsk, 10),
    spreadUsd,
    spreadBps,
    asks,
    bids,
    timestamp: book.timestamp,
  };
}

import type {
  ExchangeKey,
  NormalizedBook,
  OrderBookLevel,
  SlippageTierResult,
  LiquidityAnalysis,
} from './types.ts';
import { NOTIONAL_TIERS } from './constants.ts';
import { round } from './round.ts';

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

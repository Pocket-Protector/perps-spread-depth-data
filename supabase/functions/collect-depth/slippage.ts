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
  const midPrice = round((bestBid + bestAsk) / 2, 6);
  const spreadUsd = round(bestAsk - bestBid, 6);
  const spreadBps = round((spreadUsd / midPrice) * 10_000, 6);

  const asks = tiers.map((notional) =>
    computeSlippage(book.asks, notional, midPrice, 'ask'),
  );
  const bids = tiers.map((notional) =>
    computeSlippage(book.bids, notional, midPrice, 'bid'),
  );

  return {
    exchange,
    ticker,
    midPrice,
    bestBid: round(bestBid, 6),
    bestAsk: round(bestAsk, 6),
    spreadUsd,
    spreadBps,
    asks,
    bids,
    timestamp: book.timestamp,
  };
}

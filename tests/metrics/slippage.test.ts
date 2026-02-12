import { describe, it, expect } from 'vitest';
import {
  normalizeBook,
  computeSlippage,
  analyzeBook,
} from '../../src/metrics/slippage.js';
import type { OrderBookLevel, NormalizedBook } from '../../src/types.js';

// ── Helper to build a quick book ──

function makeBook(
  bids: [number, number][],
  asks: [number, number][],
): NormalizedBook {
  return {
    bids: bids.map(([price, size]) => ({ price, size })),
    asks: asks.map(([price, size]) => ({ price, size })),
  };
}

// ══════════════════════════════════════════════════════════════════════
//  normalizeBook
// ══════════════════════════════════════════════════════════════════════

describe('normalizeBook', () => {
  it('sorts bids descending and asks ascending', () => {
    const book = normalizeBook(
      [
        { price: 100, size: 1 },
        { price: 102, size: 1 },
        { price: 101, size: 1 },
      ],
      [
        { price: 105, size: 1 },
        { price: 103, size: 1 },
        { price: 104, size: 1 },
      ],
    );
    expect(book).not.toBeNull();
    expect(book!.bids.map((l) => l.price)).toEqual([102, 101, 100]);
    expect(book!.asks.map((l) => l.price)).toEqual([103, 104, 105]);
  });

  it('drops invalid levels (NaN, zero, negative)', () => {
    const book = normalizeBook(
      [
        { price: 100, size: 1 },
        { price: NaN, size: 1 },
        { price: 99, size: 0 },
        { price: -1, size: 1 },
        { price: 98, size: -5 },
        { price: Infinity, size: 1 },
      ],
      [
        { price: 101, size: 1 },
        { price: 102, size: NaN },
      ],
    );
    expect(book).not.toBeNull();
    expect(book!.bids).toHaveLength(1);
    expect(book!.bids[0].price).toBe(100);
    expect(book!.asks).toHaveLength(1);
    expect(book!.asks[0].price).toBe(101);
  });

  it('returns null when bids are empty after filtering', () => {
    const book = normalizeBook(
      [{ price: NaN, size: 1 }],
      [{ price: 100, size: 1 }],
    );
    expect(book).toBeNull();
  });

  it('returns null when asks are empty after filtering', () => {
    const book = normalizeBook(
      [{ price: 100, size: 1 }],
      [{ price: 0, size: 1 }],
    );
    expect(book).toBeNull();
  });

  it('preserves timestamp', () => {
    const book = normalizeBook(
      [{ price: 100, size: 1 }],
      [{ price: 101, size: 1 }],
      1700000000000,
    );
    expect(book!.timestamp).toBe(1700000000000);
  });
});

// ══════════════════════════════════════════════════════════════════════
//  computeSlippage
// ══════════════════════════════════════════════════════════════════════

describe('computeSlippage', () => {
  describe('full fill', () => {
    it('fills $1000 from a single level with enough liquidity', () => {
      // One ask level at $100 with 20 units = $2000 notional
      const levels: OrderBookLevel[] = [{ price: 100, size: 20 }];
      const result = computeSlippage(levels, 1000, 99.5, 'ask');

      expect(result.filled).toBe(true);
      expect(result.filledNotional).toBe(1000);
      expect(result.vwap).toBe(100); // only one price level
      // slippage = ((100 - 99.5) / 99.5) * 10000 = 50.25..
      expect(result.slippageBps).toBeCloseTo(50.25, 1);
    });

    it('fills across multiple levels (ask side)', () => {
      // Two ask levels: $100 x 5 ($500), $101 x 10 ($1010)
      const levels: OrderBookLevel[] = [
        { price: 100, size: 5 },
        { price: 101, size: 10 },
      ];
      const midPrice = 99.5;
      const result = computeSlippage(levels, 1000, midPrice, 'ask');

      expect(result.filled).toBe(true);
      expect(result.filledNotional).toBe(1000);

      // First level: fill $500 → 5 units at $100
      // Second level: fill $500 → 500/101 ≈ 4.9505 units at $101
      // totalQty = 5 + 4.9505 = 9.9505
      // vwap = 1000 / 9.9505 ≈ 100.4975
      expect(result.vwap).toBeCloseTo(100.4975, 3);
    });

    it('fills across multiple levels (bid side)', () => {
      // Two bid levels: $100 x 5 ($500), $99 x 10 ($990)
      const levels: OrderBookLevel[] = [
        { price: 100, size: 5 },
        { price: 99, size: 10 },
      ];
      const midPrice = 100.5;
      const result = computeSlippage(levels, 1000, midPrice, 'bid');

      expect(result.filled).toBe(true);
      expect(result.filledNotional).toBe(1000);

      // First level: fill $500 → 5 units at $100
      // Second level: fill $500 → 500/99 ≈ 5.0505 units at $99
      // totalQty = 5 + 5.0505 = 10.0505
      // vwap = 1000 / 10.0505 ≈ 99.4975
      expect(result.vwap).toBeCloseTo(99.4975, 3);

      // bid slippage = ((100.5 - 99.4975) / 100.5) * 10000 ≈ 99.75
      expect(result.slippageBps).toBeCloseTo(99.75, 0);
    });
  });

  describe('partial fill', () => {
    it('returns partial when book has insufficient liquidity', () => {
      // Only $500 available on the book
      const levels: OrderBookLevel[] = [{ price: 100, size: 5 }];
      const result = computeSlippage(levels, 1000, 99.5, 'ask');

      expect(result.filled).toBe(false);
      expect(result.filledNotional).toBe(500);
      expect(result.vwap).toBe(100);
    });

    it('returns partial from multiple levels with insufficient total', () => {
      const levels: OrderBookLevel[] = [
        { price: 100, size: 2 },  // $200
        { price: 101, size: 3 },  // $303
      ];
      const result = computeSlippage(levels, 1000, 99.5, 'ask');

      expect(result.filled).toBe(false);
      expect(result.filledNotional).toBe(503);
    });
  });

  describe('edge cases', () => {
    it('handles empty levels array', () => {
      const result = computeSlippage([], 1000, 100, 'ask');
      expect(result.filled).toBe(false);
      expect(result.filledNotional).toBe(0);
      expect(result.vwap).toBe(0);
      expect(result.slippageBps).toBe(0);
    });

    it('exact fill at level boundary', () => {
      // Exactly $1000 available
      const levels: OrderBookLevel[] = [{ price: 100, size: 10 }];
      const result = computeSlippage(levels, 1000, 99.5, 'ask');

      expect(result.filled).toBe(true);
      expect(result.filledNotional).toBe(1000);
    });

    it('handles very small notional', () => {
      const levels: OrderBookLevel[] = [{ price: 50000, size: 1 }];
      const result = computeSlippage(levels, 1, 49999, 'ask');

      expect(result.filled).toBe(true);
      expect(result.filledNotional).toBe(1);
    });
  });

  describe('rounding', () => {
    it('rounds vwap to 6 decimals', () => {
      // Create a scenario with a non-terminating vwap
      const levels: OrderBookLevel[] = [
        { price: 100.1234567, size: 3 },
        { price: 100.9876543, size: 7 },
      ];
      const result = computeSlippage(levels, 500, 100, 'ask');
      const vwapStr = result.vwap.toString();
      const decimals = vwapStr.includes('.') ? vwapStr.split('.')[1].length : 0;
      expect(decimals).toBeLessThanOrEqual(6);
    });

    it('rounds slippageBps to 2 decimals', () => {
      const levels: OrderBookLevel[] = [
        { price: 100.333, size: 5 },
        { price: 101.777, size: 5 },
      ];
      const result = computeSlippage(levels, 800, 100, 'ask');
      const bpsStr = result.slippageBps.toString();
      const decimals = bpsStr.includes('.') ? bpsStr.split('.')[1].length : 0;
      expect(decimals).toBeLessThanOrEqual(2);
    });

    it('rounds filledNotional to 2 decimals', () => {
      const levels: OrderBookLevel[] = [{ price: 33.333, size: 10 }];
      const result = computeSlippage(levels, 100, 33, 'ask');
      const notionalStr = result.filledNotional.toString();
      const decimals = notionalStr.includes('.')
        ? notionalStr.split('.')[1].length
        : 0;
      expect(decimals).toBeLessThanOrEqual(2);
    });
  });

  describe('slippage direction', () => {
    it('ask slippage is positive when vwap > mid', () => {
      const levels: OrderBookLevel[] = [{ price: 101, size: 100 }];
      const result = computeSlippage(levels, 1000, 100, 'ask');
      expect(result.slippageBps).toBeGreaterThan(0);
    });

    it('bid slippage is positive when vwap < mid', () => {
      const levels: OrderBookLevel[] = [{ price: 99, size: 100 }];
      const result = computeSlippage(levels, 1000, 100, 'bid');
      expect(result.slippageBps).toBeGreaterThan(0);
    });
  });
});

// ══════════════════════════════════════════════════════════════════════
//  analyzeBook
// ══════════════════════════════════════════════════════════════════════

describe('analyzeBook', () => {
  it('computes correct mid, spread, and slippage for a simple book', () => {
    const book = makeBook(
      [[99, 10], [98, 10], [97, 10]],  // bids
      [[101, 10], [102, 10], [103, 10]], // asks
    );

    const analysis = analyzeBook(book, 'binance', 'BTC');

    expect(analysis.exchange).toBe('binance');
    expect(analysis.ticker).toBe('BTC');
    expect(analysis.bestBid).toBe(99);
    expect(analysis.bestAsk).toBe(101);
    expect(analysis.midPrice).toBe(100);
    expect(analysis.spreadUsd).toBe(2);
    // spreadBps = (2 / 100) * 10000 = 200
    expect(analysis.spreadBps).toBe(200);

    // 4 tiers on each side
    expect(analysis.asks).toHaveLength(4);
    expect(analysis.bids).toHaveLength(4);

    // $1k ask: 101 * 10 = $1010, so fills entirely at $101
    expect(analysis.asks[0].filled).toBe(true);
    expect(analysis.asks[0].vwap).toBe(101);
  });

  it('handles custom tiers', () => {
    const book = makeBook(
      [[100, 100]],
      [[101, 100]],
    );
    const analysis = analyzeBook(book, 'dydx', 'ETH', [500, 5000]);
    expect(analysis.asks).toHaveLength(2);
    expect(analysis.bids).toHaveLength(2);
    expect(analysis.asks[0].notional).toBe(500);
    expect(analysis.asks[1].notional).toBe(5000);
  });

  it('marks partial fills correctly', () => {
    // Very thin book: only $990 on asks, $495 on bids
    const book = makeBook(
      [[99, 5]],    // $495
      [[101, 10]],  // $1010
    );

    const analysis = analyzeBook(book, 'hyperliquid', 'SOL');

    // $1k tier on asks: 101 * 10 = $1010 >= $1000 → filled
    expect(analysis.asks[0].filled).toBe(true);
    // $10k tier on asks: only $1010 → not filled
    expect(analysis.asks[1].filled).toBe(false);

    // $1k tier on bids: only $495 → not filled
    expect(analysis.bids[0].filled).toBe(false);
  });

  it('uses correct mid price for slippage of both sides', () => {
    const book = makeBook(
      [[99.5, 1000]],
      [[100.5, 1000]],
    );

    const analysis = analyzeBook(book, 'binance', 'BTC', [1000]);
    expect(analysis.midPrice).toBe(100);

    // Ask vwap = 100.5, slippage = ((100.5 - 100) / 100) * 10000 = 50
    expect(analysis.asks[0].slippageBps).toBe(50);

    // Bid vwap = 99.5, slippage = ((100 - 99.5) / 100) * 10000 = 50
    expect(analysis.bids[0].slippageBps).toBe(50);
  });
});

// ══════════════════════════════════════════════════════════════════════
//  Deterministic regression tests
// ══════════════════════════════════════════════════════════════════════

describe('deterministic regression', () => {
  it('BTC-like book produces expected values', () => {
    // Simulate a realistic BTC book at ~$100,000
    const book = makeBook(
      [
        [99_999, 0.5],   // $49,999.50
        [99_998, 1.0],   // $99,998
        [99_995, 2.0],   // $199,990
        [99_990, 5.0],   // $499,950
        [99_980, 10.0],  // $999,800
      ],
      [
        [100_001, 0.5],  // $50,000.50
        [100_002, 1.0],  // $100,002
        [100_005, 2.0],  // $200,010
        [100_010, 5.0],  // $500,050
        [100_020, 10.0], // $1,000,200
      ],
    );

    const analysis = analyzeBook(book, 'binance', 'BTC');

    expect(analysis.midPrice).toBe(100_000);
    expect(analysis.spreadUsd).toBe(2);
    expect(analysis.spreadBps).toBeCloseTo(0.2, 4);

    // $1k ask: fills 0.5 units at $100,001 → $50,000.50, then remainder
    // from $100,002
    expect(analysis.asks[0].filled).toBe(true);
    expect(analysis.asks[0].filledNotional).toBe(1000);

    // $1M ask: total available = 50000.50 + 100002 + 200010 + 500050 + 1000200 = $1,850,262.50
    // → fully filled
    expect(analysis.asks[3].filled).toBe(true);
    expect(analysis.asks[3].filledNotional).toBe(1_000_000);
  });
});

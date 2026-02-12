import { describe, it, expect } from 'vitest';
import { aggregateMinute } from '../../src/ingest/minute-aggregate.js';
import type { RawSample, LiquidityAnalysis } from '../../src/types.js';

function makeSample(
  exchange: 'binance',
  ticker: string,
  sampleIndex: number,
  overrides: Partial<LiquidityAnalysis> = {},
): RawSample {
  return {
    exchange,
    ticker,
    sampleIndex,
    collectedAtMs: Date.now(),
    durationMs: 100,
    analysis: {
      exchange,
      ticker,
      midPrice: 100000,
      bestBid: 99999,
      bestAsk: 100001,
      spreadUsd: 2,
      spreadBps: 0.2,
      asks: [
        { notional: 1000, vwap: 100001, slippageBps: 0.1, filled: true, filledNotional: 1000 },
        { notional: 10000, vwap: 100005, slippageBps: 0.5, filled: true, filledNotional: 10000 },
        { notional: 100000, vwap: 100020, slippageBps: 2.0, filled: true, filledNotional: 100000 },
        { notional: 1000000, vwap: 100100, slippageBps: 10.0, filled: true, filledNotional: 1000000 },
      ],
      bids: [
        { notional: 1000, vwap: 99999, slippageBps: 0.1, filled: true, filledNotional: 1000 },
        { notional: 10000, vwap: 99995, slippageBps: 0.5, filled: true, filledNotional: 10000 },
        { notional: 100000, vwap: 99980, slippageBps: 2.0, filled: true, filledNotional: 100000 },
        { notional: 1000000, vwap: 99900, slippageBps: 10.0, filled: false, filledNotional: 800000 },
      ],
      ...overrides,
    },
  };
}

function makeFailedSample(exchange: 'binance', ticker: string, idx: number): RawSample {
  return {
    exchange,
    ticker,
    sampleIndex: idx,
    collectedAtMs: Date.now(),
    durationMs: 100,
    analysis: null,
    error: 'timeout: request timed out',
  };
}

describe('aggregateMinute', () => {
  it('produces one row per exchange+ticker', () => {
    const samples = [
      makeSample('binance', 'BTC', 0),
      makeSample('binance', 'BTC', 1),
      makeSample('binance', 'BTC', 2),
      makeSample('binance', 'BTC', 3),
    ];

    const rows = aggregateMinute(samples, '2026-02-12T10:00:00Z');
    expect(rows).toHaveLength(1);
    expect(rows[0].exchange).toBe('binance');
    expect(rows[0].ticker).toBe('BTC');
    expect(rows[0].samples_total).toBe(4);
    expect(rows[0].samples_success).toBe(4);
  });

  it('computes median for numeric fields', () => {
    const samples = [
      makeSample('binance', 'BTC', 0, { spreadBps: 0.1 }),
      makeSample('binance', 'BTC', 1, { spreadBps: 0.3 }),
      makeSample('binance', 'BTC', 2, { spreadBps: 0.2 }),
      makeSample('binance', 'BTC', 3, { spreadBps: 0.4 }),
    ];

    const rows = aggregateMinute(samples, '2026-02-12T10:00:00Z');
    // Sorted: [0.1, 0.2, 0.3, 0.4] → median = (0.2 + 0.3) / 2 = 0.25
    expect(rows[0].spread_bps).toBe(0.25);
  });

  it('majority vote for boolean fields (tie → false)', () => {
    const samples = [
      makeSample('binance', 'BTC', 0), // bid_fill_1m: false
      makeSample('binance', 'BTC', 1), // bid_fill_1m: false
      makeSample('binance', 'BTC', 2, {
        bids: [
          { notional: 1000, vwap: 99999, slippageBps: 0.1, filled: true, filledNotional: 1000 },
          { notional: 10000, vwap: 99995, slippageBps: 0.5, filled: true, filledNotional: 10000 },
          { notional: 100000, vwap: 99980, slippageBps: 2.0, filled: true, filledNotional: 100000 },
          { notional: 1000000, vwap: 99900, slippageBps: 10.0, filled: true, filledNotional: 1000000 },
        ],
      }),
      makeSample('binance', 'BTC', 3, {
        bids: [
          { notional: 1000, vwap: 99999, slippageBps: 0.1, filled: true, filledNotional: 1000 },
          { notional: 10000, vwap: 99995, slippageBps: 0.5, filled: true, filledNotional: 10000 },
          { notional: 100000, vwap: 99980, slippageBps: 2.0, filled: true, filledNotional: 100000 },
          { notional: 1000000, vwap: 99900, slippageBps: 10.0, filled: true, filledNotional: 1000000 },
        ],
      }),
    ];

    const rows = aggregateMinute(samples, '2026-02-12T10:00:00Z');
    // 2 true, 2 false → tie → false
    expect(rows[0].bid_fill_1m).toBe(false);
  });

  it('handles full failure with null metrics and error', () => {
    const samples = [
      makeFailedSample('binance', 'BTC', 0),
      makeFailedSample('binance', 'BTC', 1),
      makeFailedSample('binance', 'BTC', 2),
      makeFailedSample('binance', 'BTC', 3),
    ];

    const rows = aggregateMinute(samples, '2026-02-12T10:00:00Z');
    expect(rows).toHaveLength(1);
    expect(rows[0].samples_success).toBe(0);
    expect(rows[0].mid_price).toBeNull();
    expect(rows[0].spread_bps).toBeNull();
    expect(rows[0].error).toContain('timeout');
  });

  it('partial success keeps successful samples only', () => {
    const samples = [
      makeSample('binance', 'BTC', 0),
      makeFailedSample('binance', 'BTC', 1),
      makeSample('binance', 'BTC', 2),
      makeFailedSample('binance', 'BTC', 3),
    ];

    const rows = aggregateMinute(samples, '2026-02-12T10:00:00Z');
    expect(rows[0].samples_total).toBe(4);
    expect(rows[0].samples_success).toBe(2);
    expect(rows[0].mid_price).toBe(100000);
    expect(rows[0].error).toBe('');
  });
});

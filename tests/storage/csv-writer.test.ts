import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { appendRows, getCsvHeader } from '../../src/storage/csv-writer.js';
import type { MinuteRow } from '../../src/types.js';

const TEST_DIR = resolve(import.meta.dirname, '..', '..', 'data');
const TEST_DATE = new Date('2099-12-01T00:00:00Z'); // far future to not collide

function testCsvPath(): string {
  return resolve(TEST_DIR, '2099-12.csv');
}

function makeRow(minute: string, exchange: 'binance' | 'bybit' = 'binance'): MinuteRow {
  return {
    ts_minute_utc: minute,
    exchange,
    ticker: 'BTC',
    symbol: 'BTCUSDT',
    samples_total: 4,
    samples_success: 4,
    book_timestamp_ms: 1700000000000,
    collected_at_utc: minute,
    mid_price: 100000,
    best_bid: 99999,
    best_ask: 100001,
    spread_usd: 2,
    spread_bps: 0.2,
    ask_slip_1k: 0.1,
    ask_slip_10k: 0.5,
    ask_slip_100k: 2.0,
    ask_slip_1m: 10.0,
    bid_slip_1k: 0.1,
    bid_slip_10k: 0.5,
    bid_slip_100k: 2.0,
    bid_slip_1m: 10.0,
    ask_fill_1k: true,
    ask_fill_10k: true,
    ask_fill_100k: true,
    ask_fill_1m: true,
    bid_fill_1k: true,
    bid_fill_10k: true,
    bid_fill_100k: true,
    bid_fill_1m: false,
    ask_filled_notional_1m: 1000000,
    bid_filled_notional_1m: 800000,
    is_aggregated_estimate: false,
    hyperliquid_n_sig_figs: null,
    hyperliquid_n_sig_figs_per_tier: null,
    lighter_ws_fallback: false,
    error: '',
  };
}

describe('csv-writer', () => {
  beforeEach(() => {
    // Clean up test file
    const path = testCsvPath();
    if (existsSync(path)) rmSync(path);
  });

  afterEach(() => {
    const path = testCsvPath();
    if (existsSync(path)) rmSync(path);
  });

  it('creates CSV file with header on first write', () => {
    const row = makeRow('2099-12-31T00:00:00Z');
    appendRows([row], TEST_DATE);

    const path = testCsvPath();
    expect(existsSync(path)).toBe(true);

    const content = readFileSync(path, 'utf-8');
    const lines = content.trim().split('\n');
    expect(lines[0]).toBe(getCsvHeader());
    expect(lines).toHaveLength(2); // header + 1 row
  });

  it('appends multiple rows', () => {
    appendRows([
      makeRow('2099-12-31T00:00:00Z'),
      makeRow('2099-12-31T00:00:00Z', 'bybit'),
    ], TEST_DATE);

    const content = readFileSync(testCsvPath(), 'utf-8');
    const lines = content.trim().split('\n');
    expect(lines).toHaveLength(3); // header + 2 rows
  });

  it('idempotent upsert replaces duplicate key rows', () => {
    const row1 = makeRow('2099-12-31T00:00:00Z');
    appendRows([row1], TEST_DATE);

    // Write again with same key but different data
    const row2 = makeRow('2099-12-31T00:00:00Z');
    row2.mid_price = 99999;
    appendRows([row2], TEST_DATE);

    const content = readFileSync(testCsvPath(), 'utf-8');
    const lines = content.trim().split('\n');
    expect(lines).toHaveLength(2); // header + 1 row (replaced, not duplicated)
    expect(lines[1]).toContain('99999'); // updated value
  });

  it('writes different minute buckets as separate rows', () => {
    appendRows([
      makeRow('2099-12-31T00:00:00Z'),
    ], TEST_DATE);
    appendRows([
      makeRow('2099-12-31T00:01:00Z'),
    ], TEST_DATE);

    const content = readFileSync(testCsvPath(), 'utf-8');
    const lines = content.trim().split('\n');
    expect(lines).toHaveLength(3); // header + 2 rows
  });

  it('keeps newline-containing error fields safe for upsert', () => {
    const row = makeRow('2099-12-31T00:00:00Z');
    row.samples_success = 0;
    row.mid_price = null;
    row.error = 'first line\nsecond line';
    appendRows([row], TEST_DATE);

    const updated = makeRow('2099-12-31T00:00:00Z');
    updated.samples_success = 0;
    updated.mid_price = null;
    updated.error = 'updated';
    appendRows([updated], TEST_DATE);

    const content = readFileSync(testCsvPath(), 'utf-8');
    const lines = content.trim().split('\n');
    expect(lines).toHaveLength(2); // header + one replaced row
    expect(lines[1]).toContain('updated');
  });
});

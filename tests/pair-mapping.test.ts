import { describe, it, expect } from 'vitest';
import {
  resolveSymbol,
  getCanonicalTickers,
  buildSymbolMap,
  isTickerSupportedOnExchange,
} from '../src/pair-mapping.js';
import { EXCHANGE_KEYS } from '../src/types.js';

describe('resolveSymbol', () => {
  it('resolves BTC for all exchanges', () => {
    expect(resolveSymbol('BTC', 'hyperliquid')).toBe('BTC');
    expect(resolveSymbol('BTC', 'dydx')).toBe('BTC-USD');
    expect(resolveSymbol('BTC', 'lighter')).toBe('BTC');
    expect(resolveSymbol('BTC', 'asterdex')).toBe('BTCUSDT');
    expect(resolveSymbol('BTC', 'binance')).toBe('BTCUSDT');
    expect(resolveSymbol('BTC', 'bybit')).toBe('BTCUSDT');
  });

  it('resolves ETH for all exchanges', () => {
    expect(resolveSymbol('ETH', 'hyperliquid')).toBe('ETH');
    expect(resolveSymbol('ETH', 'dydx')).toBe('ETH-USD');
    expect(resolveSymbol('ETH', 'binance')).toBe('ETHUSDT');
  });

  it('resolves SOL for all exchanges', () => {
    expect(resolveSymbol('SOL', 'hyperliquid')).toBe('SOL');
    expect(resolveSymbol('SOL', 'dydx')).toBe('SOL-USD');
    expect(resolveSymbol('SOL', 'bybit')).toBe('SOLUSDT');
  });

  it('resolves BONK with per-exchange overrides', () => {
    expect(resolveSymbol('BONK', 'hyperliquid')).toBe('kBONK');
    expect(resolveSymbol('BONK', 'dydx')).toBe('BONK-USD');
    expect(resolveSymbol('BONK', 'lighter')).toBe('1000BONK');
    expect(resolveSymbol('BONK', 'asterdex')).toBe('1000BONKUSDT');
    expect(resolveSymbol('BONK', 'binance')).toBe('1000BONKUSDT');
    expect(resolveSymbol('BONK', 'bybit')).toBe('1000BONKUSDT');
  });

  it('throws for unsupported exchange ticker combinations', () => {
    expect(() => resolveSymbol('PAXG', 'asterdex')).toThrow(
      'Ticker PAXG is unsupported on exchange asterdex',
    );
  });

  it('throws for unknown ticker', () => {
    expect(() => resolveSymbol('UNKNOWN', 'binance')).toThrow(
      'Unknown canonical ticker: UNKNOWN',
    );
  });
});

describe('getCanonicalTickers', () => {
  it('returns all configured tickers', () => {
    const tickers = getCanonicalTickers();
    expect(tickers).toContain('BTC');
    expect(tickers).toContain('ETH');
    expect(tickers).toContain('SOL');
    expect(tickers.length).toBeGreaterThanOrEqual(3);
  });
});

describe('buildSymbolMap', () => {
  it('builds complete map for all exchanges and tickers', () => {
    const map = buildSymbolMap(['BTC', 'ETH'], [...EXCHANGE_KEYS]);

    expect(map.binance.BTC).toBe('BTCUSDT');
    expect(map.binance.ETH).toBe('ETHUSDT');
    expect(map.dydx.BTC).toBe('BTC-USD');
    expect(map.hyperliquid.ETH).toBe('ETH');
  });

  it('omits unsupported symbols from map', () => {
    const map = buildSymbolMap(['PAXG'], [...EXCHANGE_KEYS]);
    expect(map.binance.PAXG).toBe('PAXGUSDT');
    expect(map.asterdex.PAXG).toBeUndefined();
  });
});

describe('isTickerSupportedOnExchange', () => {
  it('returns false when ticker is intentionally unsupported', () => {
    expect(isTickerSupportedOnExchange('PAXG', 'asterdex')).toBe(false);
    expect(isTickerSupportedOnExchange('PAXG', 'binance')).toBe(true);
  });
});

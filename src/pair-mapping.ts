/**
 * Pair mapping is the single source of truth for tracked canonical tickers.
 * Add/remove entries in PAIR_MAP only.
 */

import type { ExchangeKey, TickerMapping } from './types.js';
import { EXCHANGE_SYMBOL_STYLE, EXCHANGE_DEFAULT_QUOTE } from './constants.js';

export const PAIR_MAP: TickerMapping[] = [
  {
    canonical: 'BTC',
    defaultQuote: 'USD',
  },
  {
    canonical: 'ETH',
    defaultQuote: 'USD',
  },
  {
    canonical: 'SOL',
    defaultQuote: 'USD',
  },
  {
    canonical: 'XRP',
    defaultQuote: 'USD',
  },
  {
    canonical: 'HYPE',
    defaultQuote: 'USD',
  },
  {
    canonical: 'BONK',
    defaultQuote: 'USD',
    overrides: {
      hyperliquid: 'kBONK',
      lighter: '1000BONK',
      asterdex: '1000BONKUSDT',
      binance: '1000BONKUSDT',
      bybit: '1000BONKUSDT',
    },
  },
  {
    canonical: 'PAXG',
    defaultQuote: 'USD',
    unsupportedExchanges: ['asterdex'],
  },
  {
    canonical: 'ZEC',
    defaultQuote: 'USD',
  },

  // Capacity note with current defaults (4 samples/min, depth=1000):
  // Keep <=12 tickers for comfortable headroom before Binance/AsterDEX limits tighten.
  // Add more tickers below.
  // {
  //   canonical: 'DOGE',
  //   defaultQuote: 'USD',
  // },
];

/**
 * Resolve the exchange-native symbol for a canonical ticker.
 *
 * Examples:
 *   resolveSymbol('BTC', 'binance')     -> 'BTCUSDT'
 *   resolveSymbol('BTC', 'dydx')        -> 'BTC-USD'
 *   resolveSymbol('BTC', 'hyperliquid') -> 'BTC'
 *   resolveSymbol('BTC', 'lighter')     -> 'BTC' (later resolved to market_id)
 */
export function resolveSymbol(canonical: string, exchange: ExchangeKey): string {
  const mapping = getTickerMapping(canonical);
  if (mapping.unsupportedExchanges?.includes(exchange)) {
    throw new Error(`Ticker ${canonical} is unsupported on exchange ${exchange}`);
  }

  if (mapping.overrides?.[exchange]) {
    return mapping.overrides[exchange]!;
  }

  const style = EXCHANGE_SYMBOL_STYLE[exchange];
  const base = mapping.canonical;

  const exchangeQuote = EXCHANGE_DEFAULT_QUOTE[exchange];
  const quote = exchangeQuote || mapping.defaultQuote;

  switch (style) {
    case 'baseOnly':
      return base;
    case 'baseDashQuote':
      return `${base}-${quote}`;
    case 'baseQuote':
      return `${base}${quote}`;
    default:
      throw new Error(`Unknown symbol style: ${style}`);
  }
}

/**
 * True when a canonical ticker should be collected on the given exchange.
 */
export function isTickerSupportedOnExchange(canonical: string, exchange: ExchangeKey): boolean {
  const mapping = getTickerMapping(canonical);
  return !mapping.unsupportedExchanges?.includes(exchange);
}

/**
 * Get all canonical tickers from the pair map.
 */
export function getCanonicalTickers(): string[] {
  return PAIR_MAP.map((m) => m.canonical);
}

/**
 * Build a full symbol map: { exchange -> { canonical -> nativeSymbol } }
 */
export function buildSymbolMap(
  tickers: string[],
  exchanges: ExchangeKey[],
): Record<ExchangeKey, Record<string, string>> {
  const map = {} as Record<ExchangeKey, Record<string, string>>;
  for (const exchange of exchanges) {
    map[exchange] = {};
    for (const ticker of tickers) {
      if (!isTickerSupportedOnExchange(ticker, exchange)) {
        continue;
      }
      map[exchange][ticker] = resolveSymbol(ticker, exchange);
    }
  }
  return map;
}

function getTickerMapping(canonical: string): TickerMapping {
  const mapping = PAIR_MAP.find((m) => m.canonical === canonical);
  if (!mapping) {
    throw new Error(`Unknown canonical ticker: ${canonical}`);
  }
  return mapping;
}

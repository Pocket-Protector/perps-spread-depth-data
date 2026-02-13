import type { ExchangeKey, TickerMapping } from './types.ts';
import { EXCHANGE_SYMBOL_STYLE, EXCHANGE_DEFAULT_QUOTE } from './constants.ts';

export const PAIR_MAP: TickerMapping[] = [
  { canonical: 'BTC', defaultQuote: 'USD' },
  { canonical: 'ETH', defaultQuote: 'USD' },
  { canonical: 'SOL', defaultQuote: 'USD' },
  { canonical: 'XRP', defaultQuote: 'USD' },
  { canonical: 'HYPE', defaultQuote: 'USD' },
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
  { canonical: 'ZEC', defaultQuote: 'USD' },
];

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

export function isTickerSupportedOnExchange(canonical: string, exchange: ExchangeKey): boolean {
  const mapping = getTickerMapping(canonical);
  return !mapping.unsupportedExchanges?.includes(exchange);
}

export function getCanonicalTickers(): string[] {
  return PAIR_MAP.map((m) => m.canonical);
}

function getTickerMapping(canonical: string): TickerMapping {
  const mapping = PAIR_MAP.find((m) => m.canonical === canonical);
  if (!mapping) {
    throw new Error(`Unknown canonical ticker: ${canonical}`);
  }
  return mapping;
}

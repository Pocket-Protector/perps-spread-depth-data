import type { ExchangeKey, SymbolStyle } from './types.ts';

// ── Notional tiers (ascending) ──

export const NOTIONAL_TIERS = [1_000, 10_000, 100_000, 1_000_000] as const;

// ── Symbol style per exchange ──

export const EXCHANGE_SYMBOL_STYLE: Record<ExchangeKey, SymbolStyle> = {
  hyperliquid: 'baseOnly',
  dydx: 'baseDashQuote',
  lighter: 'baseOnly',
  asterdex: 'baseQuote',
  binance: 'baseQuote',
  bybit: 'baseQuote',
};

// ── Default quote currencies per exchange ──

export const EXCHANGE_DEFAULT_QUOTE: Record<ExchangeKey, string> = {
  hyperliquid: '',
  dydx: 'USD',
  lighter: '',
  asterdex: 'USDT',
  binance: 'USDT',
  bybit: 'USDT',
};

// ── API base URLs ──

export const EXCHANGE_BASE_URLS: Record<ExchangeKey, string> = {
  hyperliquid: 'https://api.hyperliquid.xyz',
  dydx: 'https://indexer.dydx.trade',
  lighter: 'https://mainnet.zklighter.elliot.ai',
  asterdex: 'https://fapi.asterdex.com',
  binance: 'https://fapi.binance.com',
  bybit: 'https://api.bybit.com',
};

// ── Default depth limits per exchange ──

export const DEFAULT_DEPTH_LIMITS: Record<ExchangeKey, number> = {
  hyperliquid: 20,
  dydx: 100,
  lighter: 250,
  asterdex: 1000,
  binance: 1000,
  bybit: 1000,
};

// ── Hyperliquid adaptive strategy constants ──

export const HYPERLIQUID_SIG_FIGS_ORDER = [5, 4, 3, 2] as const;

// ── Lighter WebSocket ──

export const LIGHTER_WS_URL = 'wss://mainnet.zklighter.elliot.ai/stream';
export const LIGHTER_WS_TIMEOUT_MS = 8000;
export const LIGHTER_MARKET_CACHE_TTL_MS = 5 * 60 * 1000;

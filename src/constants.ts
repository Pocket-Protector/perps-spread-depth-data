import type { ExchangeKey, SymbolStyle } from './types.js';

// ── Notional tiers (ascending) ──

export const NOTIONAL_TIERS = [1_000, 10_000, 100_000, 1_000_000] as const;

// ── Exchange metadata ──

export const EXCHANGE_LABELS: Record<ExchangeKey, string> = {
  hyperliquid: 'Hyperliquid',
  dydx: 'dYdX',
  lighter: 'Lighter',
  asterdex: 'AsterDEX',
  binance: 'Binance',
  bybit: 'Bybit',
};

export const EXCHANGE_COLORS: Record<ExchangeKey, string> = {
  hyperliquid: '#96FCE4',
  dydx: '#7774FF',
  lighter: '#F3F3F3',
  asterdex: '#C99F6F',
  binance: '#FCD535',
  bybit: '#FF9C2E',
};

// ── Symbol style per exchange ──

export const EXCHANGE_SYMBOL_STYLE: Record<ExchangeKey, SymbolStyle> = {
  hyperliquid: 'baseOnly',    // "BTC"
  dydx: 'baseDashQuote',      // "BTC-USD"
  lighter: 'baseOnly',        // "BTC" → resolved to numeric market ID at runtime
  asterdex: 'baseQuote',      // "BTCUSDT"
  binance: 'baseQuote',       // "BTCUSDT"
  bybit: 'baseQuote',         // "BTCUSDT"
};

// ── Default quote currencies per exchange ──

export const EXCHANGE_DEFAULT_QUOTE: Record<ExchangeKey, string> = {
  hyperliquid: '',       // not used (baseOnly)
  dydx: 'USD',
  lighter: '',           // not used (baseOnly, resolved via market ID)
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
  hyperliquid: 20,    // hard cap by API
  dydx: 100,          // no explicit param, returns full book
  lighter: 250,       // REST hard max
  asterdex: 1000,
  binance: 1000,
  bybit: 1000,
};

// ── Rate limits (for guardrail calculations) ──

export interface RateLimitConfig {
  budget: number;
  windowSec: number;
  weightPerCall: number;
}

export const EXCHANGE_RATE_LIMITS: Record<ExchangeKey, RateLimitConfig> = {
  hyperliquid: { budget: 1200, windowSec: 60, weightPerCall: 2 },
  dydx:        { budget: 100,  windowSec: 10, weightPerCall: 1 },
  lighter:     { budget: 9999, windowSec: 60, weightPerCall: 1 }, // effectively unlimited for public reads
  asterdex:    { budget: 2400, windowSec: 60, weightPerCall: 20 }, // weight=20 at limit=1000
  binance:     { budget: 2400, windowSec: 60, weightPerCall: 40 }, // weight=40 at limit=1000
  bybit:       { budget: 600,  windowSec: 5,  weightPerCall: 1 },
};

// ── Hyperliquid adaptive strategy constants ──

export const HYPERLIQUID_SIG_FIGS_ORDER = [5, 4, 3, 2] as const;

// ── Lighter WebSocket ──

export const LIGHTER_WS_URL = 'wss://mainnet.zklighter.elliot.ai/stream';
export const LIGHTER_WS_TIMEOUT_MS = 8000;
export const LIGHTER_MARKET_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// ── Sampling defaults ──

export const DEFAULT_SAMPLES_PER_MINUTE = 4;
export const DEFAULT_SAMPLE_OFFSETS_SEC = [0, 15, 30, 45];
export const DEFAULT_RUN_DURATION_MINUTES = 15;
export const DEFAULT_FETCH_TIMEOUT_MS = 10_000;
export const DEFAULT_RETRY_MAX_ATTEMPTS = 2;
export const DEFAULT_RETRY_BACKOFF_MS = 500;

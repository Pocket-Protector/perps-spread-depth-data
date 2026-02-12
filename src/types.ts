// ── Exchange identifiers ──

export const EXCHANGE_KEYS = [
  'hyperliquid',
  'dydx',
  'lighter',
  'asterdex',
  'binance',
  'bybit',
] as const;

export type ExchangeKey = (typeof EXCHANGE_KEYS)[number];

// ── Order book primitives ──

export interface OrderBookLevel {
  price: number;
  size: number;
}

export interface NormalizedBook {
  bids: OrderBookLevel[]; // sorted descending by price
  asks: OrderBookLevel[]; // sorted ascending by price
  timestamp?: number;     // exchange-provided timestamp in ms (if available)
}

// ── Slippage results ──

export interface SlippageTierResult {
  notional: number;       // target notional (e.g. 1000, 10000, ...)
  vwap: number;           // volume-weighted average price (6dp)
  slippageBps: number;    // distance from mid to vwap in basis points (2dp)
  filled: boolean;        // true if full notional was filled
  filledNotional: number; // actual notional filled (2dp)
}

export interface LiquidityAnalysis {
  exchange: ExchangeKey;
  ticker: string;
  midPrice: number;     // 6dp
  bestBid: number;      // 6dp
  bestAsk: number;      // 6dp
  spreadUsd: number;    // 6dp
  spreadBps: number;    // 6dp
  asks: SlippageTierResult[];
  bids: SlippageTierResult[];
  timestamp?: number;

  // Hyperliquid adaptive strategy meta
  isAggregatedEstimate?: boolean;
  hyperliquidNSigFigs?: number;
  hyperliquidNSigFigsPerTier?: number[];

  // Lighter fallback meta
  lighterWsFallback?: boolean;
}

// ── Raw sample (pre-aggregation) ──

export interface RawSample {
  exchange: ExchangeKey;
  ticker: string;
  sampleIndex: number;
  collectedAtMs: number;
  analysis: LiquidityAnalysis | null;
  error?: string;
  durationMs: number;
}

// ── Minute aggregate row (CSV output) ──

export interface MinuteRow {
  ts_minute_utc: string;           // YYYY-MM-DDTHH:MM:00Z
  exchange: ExchangeKey;
  ticker: string;
  symbol: string;                  // exchange-native symbol used
  samples_total: number;
  samples_success: number;
  book_timestamp_ms: number | null;
  collected_at_utc: string;        // YYYY-MM-DDTHH:MM:00Z
  mid_price: number | null;
  best_bid: number | null;
  best_ask: number | null;
  spread_usd: number | null;
  spread_bps: number | null;
  ask_slip_1k: number | null;
  ask_slip_10k: number | null;
  ask_slip_100k: number | null;
  ask_slip_1m: number | null;
  bid_slip_1k: number | null;
  bid_slip_10k: number | null;
  bid_slip_100k: number | null;
  bid_slip_1m: number | null;
  ask_fill_1k: boolean | null;
  ask_fill_10k: boolean | null;
  ask_fill_100k: boolean | null;
  ask_fill_1m: boolean | null;
  bid_fill_1k: boolean | null;
  bid_fill_10k: boolean | null;
  bid_fill_100k: boolean | null;
  bid_fill_1m: boolean | null;
  ask_filled_notional_1m: number | null;
  bid_filled_notional_1m: number | null;
  is_aggregated_estimate: boolean;
  hyperliquid_n_sig_figs: number | null;
  hyperliquid_n_sig_figs_per_tier: string | null; // JSON array string e.g. "[5,5,4,3]"
  lighter_ws_fallback: boolean;
  error: string;
}

// ── Configuration ──

export interface IngestionConfig {
  pairs: string[];
  exchanges: ExchangeKey[];
  samples_per_minute: number;
  sample_offsets_sec: number[];
  run_duration_minutes: number;
  fetch_timeout_ms: number;
  retry_max_attempts: number;
  retry_backoff_ms: number;
  depth_limit_by_exchange: Record<ExchangeKey, number>;
  rate_limit_guardrails_enabled: boolean;
  allow_over_budget_override: boolean;
  enable_lighter_ws_fallback: boolean;
  enable_hyperliquid_adaptive_sigfigs: boolean;
  log_level: 'debug' | 'info' | 'warn' | 'error';
  log_json: boolean;
}

// ── Exchange adapter interface ──

export interface ExchangeAdapter {
  exchange: ExchangeKey;
  fetchOrderBook(symbol: string, depthLimit: number, timeoutMs: number): Promise<NormalizedBook>;
}

// ── Symbol mapping types ──

export type SymbolStyle = 'baseOnly' | 'baseDashQuote' | 'baseQuote';

export interface TickerMapping {
  canonical: string;        // e.g. "BTC"
  defaultQuote: string;     // e.g. "USDT" or "USD"
  overrides?: Partial<Record<ExchangeKey, string>>; // manual per-exchange symbol
  unsupportedExchanges?: ExchangeKey[]; // exchange list where ticker is intentionally skipped
}

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
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  timestamp?: number;
}

// ── Slippage results ──

export interface SlippageTierResult {
  notional: number;
  vwap: number;
  slippageBps: number;
  filled: boolean;
  filledNotional: number;
}

export interface LiquidityAnalysis {
  exchange: ExchangeKey;
  ticker: string;
  midPrice: number;
  bestBid: number;
  bestAsk: number;
  spreadUsd: number;
  spreadBps: number;
  asks: SlippageTierResult[];
  bids: SlippageTierResult[];
  timestamp?: number;

  isAggregatedEstimate?: boolean;
  hyperliquidNSigFigs?: number;
  hyperliquidNSigFigsPerTier?: number[];

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

// ── Minute aggregate row ──

export interface MinuteRow {
  ts_minute_utc: string;
  exchange: ExchangeKey;
  ticker: string;
  symbol: string;
  samples_total: number;
  samples_success: number;
  book_timestamp_ms: number | null;
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
  hyperliquid_n_sig_figs_per_tier: string | null;
  lighter_ws_fallback: boolean;
  error: string;
}

// ── Configuration ──

export interface IngestionConfig {
  pairs: string[];
  exchanges: ExchangeKey[];
  samples_per_minute: number;
  sample_offsets_sec: number[];
  fetch_timeout_ms: number;
  retry_max_attempts: number;
  retry_backoff_ms: number;
  depth_limit_by_exchange: Record<ExchangeKey, number>;
  enable_lighter_ws_fallback: boolean;
  enable_hyperliquid_adaptive_sigfigs: boolean;
}

// ── Symbol mapping types ──

export type SymbolStyle = 'baseOnly' | 'baseDashQuote' | 'baseQuote';

export interface TickerMapping {
  canonical: string;
  defaultQuote: string;
  overrides?: Partial<Record<ExchangeKey, string>>;
  unsupportedExchanges?: ExchangeKey[];
}

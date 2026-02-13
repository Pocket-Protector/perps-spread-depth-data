import type { IngestionConfig } from './types.ts';
import { DEFAULT_DEPTH_LIMITS } from './constants.ts';

export const CONFIG: IngestionConfig = {
  pairs: ['BTC', 'ETH', 'SOL', 'XRP', 'HYPE', 'BONK', 'PAXG', 'ZEC'],
  exchanges: ['hyperliquid', 'dydx', 'lighter', 'asterdex', 'binance', 'bybit'],
  samples_per_minute: 4,
  sample_offsets_sec: [0, 15, 30, 45],
  fetch_timeout_ms: 10_000,
  retry_max_attempts: 2,
  retry_backoff_ms: 500,
  depth_limit_by_exchange: { ...DEFAULT_DEPTH_LIMITS },
  enable_lighter_ws_fallback: true,
  enable_hyperliquid_adaptive_sigfigs: true,
};

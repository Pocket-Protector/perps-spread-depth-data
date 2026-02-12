import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { IngestionConfig, ExchangeKey } from './types.js';
import { EXCHANGE_KEYS } from './types.js';
import {
  DEFAULT_SAMPLES_PER_MINUTE,
  DEFAULT_SAMPLE_OFFSETS_SEC,
  DEFAULT_RUN_DURATION_MINUTES,
  DEFAULT_FETCH_TIMEOUT_MS,
  DEFAULT_RETRY_MAX_ATTEMPTS,
  DEFAULT_RETRY_BACKOFF_MS,
  DEFAULT_DEPTH_LIMITS,
  EXCHANGE_RATE_LIMITS,
} from './constants.js';
import { getCanonicalTickers } from './pair-mapping.js';
import { log } from './util/logger.js';

const CONFIG_PATH = resolve(import.meta.dirname, '..', 'config', 'ingestion.config.json');

export function loadConfig(overridePath?: string): IngestionConfig {
  const path = overridePath ?? CONFIG_PATH;
  const raw = JSON.parse(readFileSync(path, 'utf-8'));

  const config: IngestionConfig = {
    pairs: raw.pairs ?? getCanonicalTickers(),
    exchanges: raw.exchanges ?? [...EXCHANGE_KEYS],
    samples_per_minute: raw.samples_per_minute ?? DEFAULT_SAMPLES_PER_MINUTE,
    sample_offsets_sec: raw.sample_offsets_sec ?? DEFAULT_SAMPLE_OFFSETS_SEC,
    run_duration_minutes: raw.run_duration_minutes ?? DEFAULT_RUN_DURATION_MINUTES,
    fetch_timeout_ms: raw.fetch_timeout_ms ?? DEFAULT_FETCH_TIMEOUT_MS,
    retry_max_attempts: raw.retry_max_attempts ?? DEFAULT_RETRY_MAX_ATTEMPTS,
    retry_backoff_ms: raw.retry_backoff_ms ?? DEFAULT_RETRY_BACKOFF_MS,
    depth_limit_by_exchange: { ...DEFAULT_DEPTH_LIMITS, ...raw.depth_limit_by_exchange },
    rate_limit_guardrails_enabled: raw.rate_limit_guardrails_enabled ?? true,
    allow_over_budget_override: raw.allow_over_budget_override ?? false,
    enable_lighter_ws_fallback: raw.enable_lighter_ws_fallback ?? true,
    enable_hyperliquid_adaptive_sigfigs: raw.enable_hyperliquid_adaptive_sigfigs ?? true,
    log_level: raw.log_level ?? 'info',
    log_json: raw.log_json ?? true,
  };

  validate(config);
  return config;
}

function validate(config: IngestionConfig): void {
  // Validate exchanges
  for (const ex of config.exchanges) {
    if (!EXCHANGE_KEYS.includes(ex as ExchangeKey)) {
      throw new Error(`Unknown exchange in config: ${ex}`);
    }
  }

  // Validate tickers exist in pair map
  const known = new Set(getCanonicalTickers());
  for (const pair of config.pairs) {
    if (!known.has(pair)) {
      throw new Error(`Unknown ticker in config: ${pair}. Add it to pair-mapping.ts first.`);
    }
  }

  // Validate offsets count matches samples_per_minute
  if (config.sample_offsets_sec.length !== config.samples_per_minute) {
    throw new Error(
      `sample_offsets_sec has ${config.sample_offsets_sec.length} entries but samples_per_minute is ${config.samples_per_minute}`,
    );
  }

  // Rate limit guardrails
  if (config.rate_limit_guardrails_enabled) {
    checkRateBudgets(config);
  }
}

function checkRateBudgets(config: IngestionConfig): void {
  const tickerCount = config.pairs.length;
  const samplesPerMin = config.samples_per_minute;

  for (const exchange of config.exchanges) {
    const limits = EXCHANGE_RATE_LIMITS[exchange];
    const callsPerMin = tickerCount * samplesPerMin;
    const windowsPerMin = 60 / limits.windowSec;
    const budgetPerMin = limits.budget * windowsPerMin;
    const weightPerMin = callsPerMin * limits.weightPerCall;
    const usagePct = (weightPerMin / budgetPerMin) * 100;

    if (usagePct >= 100 && !config.allow_over_budget_override) {
      throw new Error(
        `${exchange}: projected ${weightPerMin}w/min exceeds budget ${budgetPerMin}w/min (${usagePct.toFixed(1)}%). ` +
        `Reduce tickers or set allow_over_budget_override=true.`,
      );
    }

    if (usagePct >= 80) {
      log.warn(`${exchange}: projected rate usage at ${usagePct.toFixed(1)}%`, {
        exchange,
        weightPerMin,
        budgetPerMin,
      });
    }
  }
}

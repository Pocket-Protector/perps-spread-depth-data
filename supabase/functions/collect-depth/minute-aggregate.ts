import type {
  ExchangeKey,
  LiquidityAnalysis,
  MinuteRow,
  RawSample,
} from './types.ts';
import { NOTIONAL_TIERS } from './constants.ts';
import { resolveSymbol } from './pair-mapping.ts';

export function aggregateMinute(
  samples: RawSample[],
  minuteBucket: string,
): MinuteRow[] {
  const groups = new Map<string, RawSample[]>();

  for (const s of samples) {
    const key = `${s.exchange}:${s.ticker}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(s);
  }

  const rows: MinuteRow[] = [];

  for (const [key, groupSamples] of groups) {
    const [exchange, ticker] = key.split(':') as [ExchangeKey, string];
    const successful = groupSamples.filter((s) => s.analysis !== null);
    const analyses = successful.map((s) => s.analysis!);

    let symbol: string;
    try {
      symbol = resolveSymbol(ticker, exchange);
    } catch {
      symbol = ticker;
    }

    if (analyses.length === 0) {
      const errors = groupSamples
        .filter((s) => s.error)
        .map((s) => s.error!)
        .slice(0, 3);

      rows.push(makeNullRow(
        minuteBucket, exchange, ticker, symbol,
        groupSamples.length, errors.join('; '),
      ));
      continue;
    }

    rows.push(buildRow(minuteBucket, exchange, ticker, symbol, groupSamples.length, analyses));
  }

  return rows;
}

function buildRow(
  minuteBucket: string,
  exchange: ExchangeKey,
  ticker: string,
  symbol: string,
  totalSamples: number,
  analyses: LiquidityAnalysis[],
): MinuteRow {
  const n = analyses.length;

  return {
    ts_minute_utc: minuteBucket,
    exchange,
    ticker,
    symbol,
    samples_total: totalSamples,
    samples_success: n,
    book_timestamp_ms: medianOfNullable(analyses.map((a) => a.timestamp ?? null)),
    mid_price: median(analyses.map((a) => a.midPrice)),
    best_bid: median(analyses.map((a) => a.bestBid)),
    best_ask: median(analyses.map((a) => a.bestAsk)),
    spread_usd: median(analyses.map((a) => a.spreadUsd)),
    spread_bps: median(analyses.map((a) => a.spreadBps)),

    ask_slip_1k: median(analyses.map((a) => a.asks[0]?.slippageBps ?? 0)),
    ask_slip_10k: median(analyses.map((a) => a.asks[1]?.slippageBps ?? 0)),
    ask_slip_100k: median(analyses.map((a) => a.asks[2]?.slippageBps ?? 0)),
    ask_slip_1m: median(analyses.map((a) => a.asks[3]?.slippageBps ?? 0)),

    bid_slip_1k: median(analyses.map((a) => a.bids[0]?.slippageBps ?? 0)),
    bid_slip_10k: median(analyses.map((a) => a.bids[1]?.slippageBps ?? 0)),
    bid_slip_100k: median(analyses.map((a) => a.bids[2]?.slippageBps ?? 0)),
    bid_slip_1m: median(analyses.map((a) => a.bids[3]?.slippageBps ?? 0)),

    ask_fill_1k: majorityVote(analyses.map((a) => a.asks[0]?.filled ?? false)),
    ask_fill_10k: majorityVote(analyses.map((a) => a.asks[1]?.filled ?? false)),
    ask_fill_100k: majorityVote(analyses.map((a) => a.asks[2]?.filled ?? false)),
    ask_fill_1m: majorityVote(analyses.map((a) => a.asks[3]?.filled ?? false)),

    bid_fill_1k: majorityVote(analyses.map((a) => a.bids[0]?.filled ?? false)),
    bid_fill_10k: majorityVote(analyses.map((a) => a.bids[1]?.filled ?? false)),
    bid_fill_100k: majorityVote(analyses.map((a) => a.bids[2]?.filled ?? false)),
    bid_fill_1m: majorityVote(analyses.map((a) => a.bids[3]?.filled ?? false)),

    ask_filled_notional_1m: median(analyses.map((a) => a.asks[3]?.filledNotional ?? 0)),
    bid_filled_notional_1m: median(analyses.map((a) => a.bids[3]?.filledNotional ?? 0)),

    is_aggregated_estimate: analyses.some((a) => a.isAggregatedEstimate === true),

    hyperliquid_n_sig_figs: exchange === 'hyperliquid'
      ? Math.min(...analyses.map((a) => a.hyperliquidNSigFigs ?? 5))
      : null,

    hyperliquid_n_sig_figs_per_tier: exchange === 'hyperliquid'
      ? JSON.stringify(mergePerTierSigFigs(analyses))
      : null,

    lighter_ws_fallback: analyses.some((a) => a.lighterWsFallback === true),

    error: '',
  };
}

function makeNullRow(
  minuteBucket: string,
  exchange: ExchangeKey,
  ticker: string,
  symbol: string,
  totalSamples: number,
  error: string,
): MinuteRow {
  return {
    ts_minute_utc: minuteBucket,
    exchange, ticker, symbol,
    samples_total: totalSamples,
    samples_success: 0,
    book_timestamp_ms: null,
    mid_price: null, best_bid: null, best_ask: null,
    spread_usd: null, spread_bps: null,
    ask_slip_1k: null, ask_slip_10k: null, ask_slip_100k: null, ask_slip_1m: null,
    bid_slip_1k: null, bid_slip_10k: null, bid_slip_100k: null, bid_slip_1m: null,
    ask_fill_1k: null, ask_fill_10k: null, ask_fill_100k: null, ask_fill_1m: null,
    bid_fill_1k: null, bid_fill_10k: null, bid_fill_100k: null, bid_fill_1m: null,
    ask_filled_notional_1m: null, bid_filled_notional_1m: null,
    is_aggregated_estimate: false,
    hyperliquid_n_sig_figs: null,
    hyperliquid_n_sig_figs_per_tier: null,
    lighter_ws_fallback: false,
    error,
  };
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

function medianOfNullable(values: (number | null)[]): number | null {
  const valid = values.filter((v): v is number => v !== null);
  if (valid.length === 0) return null;
  return Math.round(median(valid));
}

function majorityVote(values: boolean[]): boolean {
  const trueCount = values.filter(Boolean).length;
  return trueCount > values.length / 2;
}

function mergePerTierSigFigs(analyses: LiquidityAnalysis[]): number[] {
  const tierCount = NOTIONAL_TIERS.length;
  const result: number[] = new Array(tierCount).fill(5);

  for (const a of analyses) {
    if (a.hyperliquidNSigFigsPerTier) {
      for (let i = 0; i < tierCount; i++) {
        result[i] = Math.min(result[i], a.hyperliquidNSigFigsPerTier[i] ?? 5);
      }
    }
  }

  return result;
}

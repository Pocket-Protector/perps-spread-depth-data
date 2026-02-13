-- ============================================================
-- Supabase Migration: depth metrics schema
-- Run this in the Supabase SQL Editor (or via supabase db push)
-- ============================================================

-- ── Extensions ──
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ============================================================
-- 1. Raw minute-level metrics (7-day rolling window)
-- ============================================================

CREATE TABLE IF NOT EXISTS depth_metrics (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ts_minute_utc TIMESTAMPTZ NOT NULL,
  exchange      TEXT        NOT NULL,
  ticker        TEXT        NOT NULL,
  symbol        TEXT        NOT NULL,

  -- Sample metadata
  samples_total   SMALLINT,
  samples_success SMALLINT,
  book_timestamp_ms BIGINT,

  -- Price & spread
  mid_price   NUMERIC(18,6),
  best_bid    NUMERIC(18,6),
  best_ask    NUMERIC(18,6),
  spread_usd  NUMERIC(18,6),
  spread_bps  NUMERIC(12,6),

  -- Slippage (bps) per notional tier
  ask_slip_1k    NUMERIC(10,2),
  bid_slip_1k    NUMERIC(10,2),
  ask_slip_10k   NUMERIC(10,2),
  bid_slip_10k   NUMERIC(10,2),
  ask_slip_100k  NUMERIC(10,2),
  bid_slip_100k  NUMERIC(10,2),
  ask_slip_1m    NUMERIC(10,2),
  bid_slip_1m    NUMERIC(10,2),

  -- Fill status per tier
  ask_fill_1k   BOOLEAN,
  bid_fill_1k   BOOLEAN,
  ask_fill_10k  BOOLEAN,
  bid_fill_10k  BOOLEAN,
  ask_fill_100k BOOLEAN,
  bid_fill_100k BOOLEAN,
  ask_fill_1m   BOOLEAN,
  bid_fill_1m   BOOLEAN,

  -- Filled notional (1M tier only)
  ask_filled_notional_1m NUMERIC(12,2),
  bid_filled_notional_1m NUMERIC(12,2),

  -- Exchange-specific metadata
  is_aggregated_estimate          BOOLEAN DEFAULT FALSE,
  hyperliquid_n_sig_figs          SMALLINT,
  hyperliquid_n_sig_figs_per_tier JSONB,
  lighter_ws_fallback             BOOLEAN DEFAULT FALSE,

  -- Error tracking
  error TEXT,

  -- Housekeeping
  created_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE (ts_minute_utc, exchange, ticker)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_metrics_lookup
  ON depth_metrics (exchange, ticker, ts_minute_utc DESC);

CREATE INDEX IF NOT EXISTS idx_metrics_ticker_time
  ON depth_metrics (ticker, ts_minute_utc DESC);

CREATE INDEX IF NOT EXISTS idx_metrics_ts
  ON depth_metrics (ts_minute_utc DESC);

-- RLS
ALTER TABLE depth_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read access"
  ON depth_metrics FOR SELECT
  USING (true);

CREATE POLICY "Service insert"
  ON depth_metrics FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Service update"
  ON depth_metrics FOR UPDATE
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- 2. Hourly compacted metrics (long-term storage)
-- ============================================================

CREATE TABLE IF NOT EXISTS hourly_metrics (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ts_hour_utc   TIMESTAMPTZ NOT NULL,
  exchange      TEXT        NOT NULL,
  ticker        TEXT        NOT NULL,

  -- Median price & spread
  median_mid_price   NUMERIC(18,6),
  median_spread_bps  NUMERIC(12,6),

  -- Median slippage per tier
  median_ask_slip_1k    NUMERIC(10,2),
  median_bid_slip_1k    NUMERIC(10,2),
  median_ask_slip_10k   NUMERIC(10,2),
  median_bid_slip_10k   NUMERIC(10,2),
  median_ask_slip_100k  NUMERIC(10,2),
  median_bid_slip_100k  NUMERIC(10,2),
  median_ask_slip_1m    NUMERIC(10,2),
  median_bid_slip_1m    NUMERIC(10,2),

  -- Fill rates (percentage of minutes with full fill)
  ask_fill_rate_1k   NUMERIC(5,2),
  bid_fill_rate_1k   NUMERIC(5,2),
  ask_fill_rate_10k  NUMERIC(5,2),
  bid_fill_rate_10k  NUMERIC(5,2),
  ask_fill_rate_100k NUMERIC(5,2),
  bid_fill_rate_100k NUMERIC(5,2),
  ask_fill_rate_1m   NUMERIC(5,2),
  bid_fill_rate_1m   NUMERIC(5,2),

  -- Coverage
  minutes_total   SMALLINT,
  minutes_success SMALLINT,

  created_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE (ts_hour_utc, exchange, ticker)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_hourly_lookup
  ON hourly_metrics (exchange, ticker, ts_hour_utc DESC);

CREATE INDEX IF NOT EXISTS idx_hourly_ticker_time
  ON hourly_metrics (ticker, ts_hour_utc DESC);

-- RLS
ALTER TABLE hourly_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read access"
  ON hourly_metrics FOR SELECT
  USING (true);

CREATE POLICY "Service insert"
  ON hourly_metrics FOR INSERT
  WITH CHECK (true);

-- ============================================================
-- 3. Upsert function (called by Edge Function)
-- ============================================================

CREATE OR REPLACE FUNCTION upsert_depth_metrics(rows JSONB)
RETURNS void AS $$
BEGIN
  INSERT INTO depth_metrics (
    ts_minute_utc, exchange, ticker, symbol,
    samples_total, samples_success, book_timestamp_ms,
    mid_price, best_bid, best_ask, spread_usd, spread_bps,
    ask_slip_1k, bid_slip_1k, ask_slip_10k, bid_slip_10k,
    ask_slip_100k, bid_slip_100k, ask_slip_1m, bid_slip_1m,
    ask_fill_1k, bid_fill_1k, ask_fill_10k, bid_fill_10k,
    ask_fill_100k, bid_fill_100k, ask_fill_1m, bid_fill_1m,
    ask_filled_notional_1m, bid_filled_notional_1m,
    is_aggregated_estimate, hyperliquid_n_sig_figs,
    hyperliquid_n_sig_figs_per_tier, lighter_ws_fallback,
    error
  )
  SELECT
    (r->>'ts_minute_utc')::timestamptz,
    r->>'exchange', r->>'ticker', r->>'symbol',
    (r->>'samples_total')::smallint, (r->>'samples_success')::smallint,
    (r->>'book_timestamp_ms')::bigint,
    (r->>'mid_price')::numeric, (r->>'best_bid')::numeric,
    (r->>'best_ask')::numeric, (r->>'spread_usd')::numeric,
    (r->>'spread_bps')::numeric,
    (r->>'ask_slip_1k')::numeric, (r->>'bid_slip_1k')::numeric,
    (r->>'ask_slip_10k')::numeric, (r->>'bid_slip_10k')::numeric,
    (r->>'ask_slip_100k')::numeric, (r->>'bid_slip_100k')::numeric,
    (r->>'ask_slip_1m')::numeric, (r->>'bid_slip_1m')::numeric,
    (r->>'ask_fill_1k')::boolean, (r->>'bid_fill_1k')::boolean,
    (r->>'ask_fill_10k')::boolean, (r->>'bid_fill_10k')::boolean,
    (r->>'ask_fill_100k')::boolean, (r->>'bid_fill_100k')::boolean,
    (r->>'ask_fill_1m')::boolean, (r->>'bid_fill_1m')::boolean,
    (r->>'ask_filled_notional_1m')::numeric,
    (r->>'bid_filled_notional_1m')::numeric,
    (r->>'is_aggregated_estimate')::boolean,
    (r->>'hyperliquid_n_sig_figs')::smallint,
    CASE WHEN r->'hyperliquid_n_sig_figs_per_tier' IS NOT NULL
         AND r->>'hyperliquid_n_sig_figs_per_tier' != ''
         THEN (r->'hyperliquid_n_sig_figs_per_tier')::jsonb
         ELSE NULL END,
    (r->>'lighter_ws_fallback')::boolean,
    NULLIF(r->>'error', '')
  FROM jsonb_array_elements(rows) AS r
  ON CONFLICT (ts_minute_utc, exchange, ticker) DO UPDATE SET
    symbol = EXCLUDED.symbol,
    samples_total = EXCLUDED.samples_total,
    samples_success = EXCLUDED.samples_success,
    book_timestamp_ms = EXCLUDED.book_timestamp_ms,
    mid_price = EXCLUDED.mid_price,
    best_bid = EXCLUDED.best_bid,
    best_ask = EXCLUDED.best_ask,
    spread_usd = EXCLUDED.spread_usd,
    spread_bps = EXCLUDED.spread_bps,
    ask_slip_1k = EXCLUDED.ask_slip_1k,
    bid_slip_1k = EXCLUDED.bid_slip_1k,
    ask_slip_10k = EXCLUDED.ask_slip_10k,
    bid_slip_10k = EXCLUDED.bid_slip_10k,
    ask_slip_100k = EXCLUDED.ask_slip_100k,
    bid_slip_100k = EXCLUDED.bid_slip_100k,
    ask_slip_1m = EXCLUDED.ask_slip_1m,
    bid_slip_1m = EXCLUDED.bid_slip_1m,
    ask_fill_1k = EXCLUDED.ask_fill_1k,
    bid_fill_1k = EXCLUDED.bid_fill_1k,
    ask_fill_10k = EXCLUDED.ask_fill_10k,
    bid_fill_10k = EXCLUDED.bid_fill_10k,
    ask_fill_100k = EXCLUDED.ask_fill_100k,
    bid_fill_100k = EXCLUDED.bid_fill_100k,
    ask_fill_1m = EXCLUDED.ask_fill_1m,
    bid_fill_1m = EXCLUDED.bid_fill_1m,
    ask_filled_notional_1m = EXCLUDED.ask_filled_notional_1m,
    bid_filled_notional_1m = EXCLUDED.bid_filled_notional_1m,
    is_aggregated_estimate = EXCLUDED.is_aggregated_estimate,
    hyperliquid_n_sig_figs = EXCLUDED.hyperliquid_n_sig_figs,
    hyperliquid_n_sig_figs_per_tier = EXCLUDED.hyperliquid_n_sig_figs_per_tier,
    lighter_ws_fallback = EXCLUDED.lighter_ws_fallback,
    error = EXCLUDED.error;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 4. Compaction function (day 8+ → hourly medians)
-- ============================================================

CREATE OR REPLACE FUNCTION compact_old_metrics()
RETURNS void AS $$
DECLARE
  cutoff_start TIMESTAMPTZ;
  cutoff_end   TIMESTAMPTZ;
  compacted_count INT;
  deleted_count INT;
BEGIN
  cutoff_start := date_trunc('day', NOW() - INTERVAL '7 days');
  cutoff_end   := cutoff_start + INTERVAL '1 day';

  -- Skip if already compacted (idempotent)
  IF EXISTS (
    SELECT 1 FROM hourly_metrics
    WHERE ts_hour_utc >= cutoff_start AND ts_hour_utc < cutoff_end
    LIMIT 1
  ) THEN
    RAISE NOTICE 'Day % already compacted, skipping', cutoff_start::date;
    RETURN;
  END IF;

  -- Skip if no raw data exists for that day
  IF NOT EXISTS (
    SELECT 1 FROM depth_metrics
    WHERE ts_minute_utc >= cutoff_start AND ts_minute_utc < cutoff_end
    LIMIT 1
  ) THEN
    RAISE NOTICE 'No raw data for %, skipping', cutoff_start::date;
    RETURN;
  END IF;

  -- Insert hourly medians
  INSERT INTO hourly_metrics (
    ts_hour_utc, exchange, ticker,
    median_mid_price, median_spread_bps,
    median_ask_slip_1k, median_bid_slip_1k,
    median_ask_slip_10k, median_bid_slip_10k,
    median_ask_slip_100k, median_bid_slip_100k,
    median_ask_slip_1m, median_bid_slip_1m,
    ask_fill_rate_1k, bid_fill_rate_1k,
    ask_fill_rate_10k, bid_fill_rate_10k,
    ask_fill_rate_100k, bid_fill_rate_100k,
    ask_fill_rate_1m, bid_fill_rate_1m,
    minutes_total, minutes_success
  )
  SELECT
    date_trunc('hour', ts_minute_utc)       AS ts_hour_utc,
    exchange,
    ticker,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY mid_price),
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY spread_bps),
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ask_slip_1k),
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY bid_slip_1k),
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ask_slip_10k),
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY bid_slip_10k),
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ask_slip_100k),
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY bid_slip_100k),
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ask_slip_1m),
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY bid_slip_1m),
    ROUND(100.0 * COUNT(*) FILTER (WHERE ask_fill_1k)   / NULLIF(COUNT(*) FILTER (WHERE samples_success > 0), 0), 2),
    ROUND(100.0 * COUNT(*) FILTER (WHERE bid_fill_1k)   / NULLIF(COUNT(*) FILTER (WHERE samples_success > 0), 0), 2),
    ROUND(100.0 * COUNT(*) FILTER (WHERE ask_fill_10k)  / NULLIF(COUNT(*) FILTER (WHERE samples_success > 0), 0), 2),
    ROUND(100.0 * COUNT(*) FILTER (WHERE bid_fill_10k)  / NULLIF(COUNT(*) FILTER (WHERE samples_success > 0), 0), 2),
    ROUND(100.0 * COUNT(*) FILTER (WHERE ask_fill_100k) / NULLIF(COUNT(*) FILTER (WHERE samples_success > 0), 0), 2),
    ROUND(100.0 * COUNT(*) FILTER (WHERE bid_fill_100k) / NULLIF(COUNT(*) FILTER (WHERE samples_success > 0), 0), 2),
    ROUND(100.0 * COUNT(*) FILTER (WHERE ask_fill_1m)   / NULLIF(COUNT(*) FILTER (WHERE samples_success > 0), 0), 2),
    ROUND(100.0 * COUNT(*) FILTER (WHERE bid_fill_1m)   / NULLIF(COUNT(*) FILTER (WHERE samples_success > 0), 0), 2),
    COUNT(*)::smallint,
    COUNT(*) FILTER (WHERE samples_success > 0)::smallint
  FROM depth_metrics
  WHERE ts_minute_utc >= cutoff_start
    AND ts_minute_utc < cutoff_end
  GROUP BY date_trunc('hour', ts_minute_utc), exchange, ticker
  ON CONFLICT (ts_hour_utc, exchange, ticker) DO NOTHING;

  GET DIAGNOSTICS compacted_count = ROW_COUNT;

  -- Delete the compacted raw rows
  DELETE FROM depth_metrics
  WHERE ts_minute_utc >= cutoff_start
    AND ts_minute_utc < cutoff_end;

  GET DIAGNOSTICS deleted_count = ROW_COUNT;

  RAISE NOTICE 'Compacted %: % hourly rows, % minute rows deleted',
    cutoff_start::date, compacted_count, deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 5. API: Aggregated metrics (queries both tables seamlessly)
-- ============================================================

CREATE OR REPLACE FUNCTION get_aggregated_metrics(
  p_exchange  TEXT,
  p_ticker    TEXT,
  p_from      TIMESTAMPTZ,
  p_to        TIMESTAMPTZ,
  p_interval  TEXT DEFAULT '1 hour'
)
RETURNS TABLE (
  bucket               TIMESTAMPTZ,
  median_mid_price     NUMERIC,
  median_spread_bps    NUMERIC,
  median_ask_slip_1k   NUMERIC,
  median_bid_slip_1k   NUMERIC,
  median_ask_slip_10k  NUMERIC,
  median_bid_slip_10k  NUMERIC,
  median_ask_slip_100k NUMERIC,
  median_bid_slip_100k NUMERIC,
  median_ask_slip_1m   NUMERIC,
  median_bid_slip_1m   NUMERIC,
  sample_count         BIGINT
) AS $$
DECLARE
  raw_cutoff TIMESTAMPTZ := date_trunc('day', NOW() - INTERVAL '7 days');
BEGIN
  RETURN QUERY

  -- Part 1: Pre-compacted hourly data (older than raw window)
  SELECT
    h.ts_hour_utc AS bucket,
    h.median_mid_price,
    h.median_spread_bps,
    h.median_ask_slip_1k,
    h.median_bid_slip_1k,
    h.median_ask_slip_10k,
    h.median_bid_slip_10k,
    h.median_ask_slip_100k,
    h.median_bid_slip_100k,
    h.median_ask_slip_1m,
    h.median_bid_slip_1m,
    h.minutes_success::bigint AS sample_count
  FROM hourly_metrics h
  WHERE h.exchange = p_exchange
    AND h.ticker = p_ticker
    AND h.ts_hour_utc >= p_from
    AND h.ts_hour_utc < LEAST(p_to, raw_cutoff)
    AND p_from < raw_cutoff

  UNION ALL

  -- Part 2: Live aggregation from raw minute data (recent 7 days)
  SELECT
    date_trunc('hour', d.ts_minute_utc) AS bucket,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY d.mid_price),
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY d.spread_bps),
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY d.ask_slip_1k),
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY d.bid_slip_1k),
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY d.ask_slip_10k),
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY d.bid_slip_10k),
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY d.ask_slip_100k),
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY d.bid_slip_100k),
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY d.ask_slip_1m),
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY d.bid_slip_1m),
    COUNT(*)
  FROM depth_metrics d
  WHERE d.exchange = p_exchange
    AND d.ticker = p_ticker
    AND d.ts_minute_utc >= GREATEST(p_from, raw_cutoff)
    AND d.ts_minute_utc < p_to
    AND d.samples_success > 0
  GROUP BY date_trunc('hour', d.ts_minute_utc)

  ORDER BY bucket;
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================
-- 6. API: Cross-exchange comparison (latest snapshot)
-- ============================================================

CREATE OR REPLACE FUNCTION get_latest_cross_exchange(
  p_ticker TEXT
)
RETURNS TABLE (
  exchange      TEXT,
  ts_minute_utc TIMESTAMPTZ,
  mid_price     NUMERIC,
  spread_bps    NUMERIC,
  ask_slip_1k   NUMERIC,
  bid_slip_1k   NUMERIC,
  ask_slip_10k  NUMERIC,
  bid_slip_10k  NUMERIC,
  ask_slip_100k NUMERIC,
  bid_slip_100k NUMERIC,
  ask_slip_1m   NUMERIC,
  bid_slip_1m   NUMERIC
) AS $$
  SELECT DISTINCT ON (d.exchange)
    d.exchange, d.ts_minute_utc, d.mid_price, d.spread_bps,
    d.ask_slip_1k, d.bid_slip_1k, d.ask_slip_10k, d.bid_slip_10k,
    d.ask_slip_100k, d.bid_slip_100k, d.ask_slip_1m, d.bid_slip_1m
  FROM depth_metrics d
  WHERE d.ticker = p_ticker
    AND d.samples_success > 0
    AND d.ts_minute_utc > NOW() - INTERVAL '5 minutes'
  ORDER BY d.exchange, d.ts_minute_utc DESC;
$$ LANGUAGE sql STABLE;

-- ============================================================
-- 7. Cron jobs
-- ============================================================

-- Compaction: daily at 03:00 UTC
SELECT cron.schedule(
  'compact-old-metrics',
  '0 3 * * *',
  $$ SELECT compact_old_metrics(); $$
);

-- Note: The ingestion cron (to trigger the Edge Function every minute)
-- should be set up after the Edge Function is deployed:
--
-- SELECT cron.schedule(
--   'collect-depth-metrics',
--   '* * * * *',
--   $$
--   SELECT net.http_post(
--     url    := '<SUPABASE_URL>/functions/v1/collect-depth',
--     headers := jsonb_build_object(
--       'Authorization', 'Bearer <SERVICE_ROLE_KEY>',
--       'Content-Type', 'application/json'
--     ),
--     body   := '{}'::jsonb
--   );
--   $$
-- );

# Standalone Historical Liquidity Ingestion Plan

Last updated: 2026-02-12

## 1) Goal

Build and operate a standalone ingestion repository that continuously collects order book liquidity metrics and stores minute-level historical data for:

- Exchanges: `hyperliquid`, `dydx`, `lighter`, `asterdex`, `binance`, `bybit`
- Initial tickers: `BTC`, `ETH`, `SOL` (config-driven to scale later)

The ingestion repo should preserve metric semantics already validated in the existing codebase (slippage math, Hyperliquid depth strategy, Lighter REST->WebSocket fallback).

---

## 2) Non-goals

- No UI work in this plan.
- No dependency on Next.js client/runtime behavior.
- No requirement to keep ingestion logic inside the UI repo.

---

## 3) Source-of-truth Logic To Port (Exact Behavior)

The ingestion implementation should mirror these behaviors exactly:

- `src/lib/slippage.ts`
- `src/lib/orderbook-client.ts`
- `src/lib/exchanges/*.ts`
- `src/lib/lighter-ws.ts`
- `src/hooks/use-liquidity-poll.ts` (for exchange orchestration behavior)
- `src/lib/constants.ts`
- `src/lib/pair-mapping.ts`

### 3.1 Notional tiers

Default tiers (ascending): `[1000, 10000, 100000, 1000000]`

### 3.2 Book normalization rules

For every exchange parser:

- Parse numeric fields to floats.
- Drop invalid levels (`NaN`, non-finite, `<= 0` price or size).
- Sort bids descending by price.
- Sort asks ascending by price.
- Reject empty-side books.

### 3.3 Slippage computation rules

For each side and target notional:

1. Walk levels from best price outward.
2. Fill notional until exhausted or levels end.
3. `vwap = totalCost / totalQty` when `totalQty > 0`, else `0`.
4. `filled = remainingNotional <= 0`.
5. `filledNotional = totalCost`.
6. Slippage in bps:
   - Ask: `((vwap - midPrice) / midPrice) * 10000`
   - Bid: `((midPrice - vwap) / midPrice) * 10000`

Rounding:

- `midPrice`, `spread`, `vwap`: 6 decimals
- `slippageBps`: 2 decimals
- `filledNotional`: 2 decimals

### 3.4 Liquidity metrics per sample

From best bid/ask:

- `bestBid`
- `bestAsk`
- `midPrice = (bestBid + bestAsk) / 2`
- `spreadUsd = bestAsk - bestBid`
- `spreadBps = (spreadUsd / midPrice) * 10000`
- Slippage arrays (bid + ask) for each notional tier

---

## 4) Exchange Fetch Strategy

### 4.1 Endpoints

- Hyperliquid: `POST https://api.hyperliquid.xyz/info` with `{ type: "l2Book", coin, nSigFigs? }`
- dYdX: `GET https://indexer.dydx.trade/v4/orderbooks/perpetualMarket/{symbol}`
- Lighter REST: `GET https://mainnet.zklighter.elliot.ai/api/v1/orderBookOrders?market_id={id}&limit=250`
- AsterDEX: `GET https://fapi.asterdex.com/fapi/v1/depth?symbol={symbol}&limit=1000`
- Binance: `GET https://fapi.binance.com/fapi/v1/depth?symbol={symbol}&limit=1000`
- Bybit: `GET https://api.bybit.com/v5/market/orderbook?category=linear&symbol={symbol}&limit=1000`

Lighter market IDs must be discovered from:

- `GET https://mainnet.zklighter.elliot.ai/api/v1/orderBooks`
- Cache symbol->market_id for 5 minutes.

### 4.2 Hyperliquid adaptive strategy (must match current logic)

Use ordered `nSigFigs` attempts: `[5, 4, 3, 2]`.

Algorithm per sample:

1. Fetch/analyze at current `nSigFigs`.
2. Keep first successful analysis as the base for spread/mid fields.
3. Fill slippage tiers progressively:
   - Move bid cursor while `analysis.bids[idx].filled`.
   - Move ask cursor while `analysis.asks[idx].filled`.
4. Track:
   - `coarsestUsed` (lowest nSigFigs used)
   - `perTierSigFigs` (e.g. `[5, 5, 4, 3]`)
5. If some tiers remain unfilled after loop:
   - Use the last successful analysis values for remaining tiers (partial allowed).
6. Return merged analysis with meta:
   - `isAggregatedEstimate`
   - `hyperliquidNSigFigs`
   - `hyperliquidNSigFigsPerTier`

### 4.3 Lighter REST -> WS fallback strategy (must match current logic)

Algorithm per sample:

1. Fetch/analyze REST order book (`limit=250`).
2. If any slippage tier on either side is partial (`filled=false`), attempt WS snapshot fallback:
   - Open one-shot WS to `wss://mainnet.zklighter.elliot.ai/stream`
   - Subscribe to `order_book/{marketId}`
   - Capture first snapshot containing `order_book`
   - Timeout after 8 seconds
3. If WS success, use WS analysis and set `lighterWsFallback=true`.
4. If WS fails, keep REST analysis.

If a future mode keeps Lighter WS open (not one-shot snapshot):

- Enforce nonce continuity (`begin_nonce` must match previous `nonce`).
- Reconnect and resync snapshot on nonce mismatch.

### 4.4 Endpoint constraints and quirks (from `info.md`, validated 2026-02-12)

- Hyperliquid `l2Book` is hard-capped at 20 levels/side. Additional depth params do not increase depth.
- Lighter REST `limit` has a hard max of 250. Values above 250 return `20001 invalid param`.
- Lighter REST has no pagination for order book depth.
- Lighter `total_bids` and `total_asks` fields echo request limit; do not treat them as full depth counts.
- Bybit linear docs commonly state max 500 levels, but observed behavior returns up to 1000 levels.
- AsterDEX and Binance are interface-compatible (`/fapi/v1/depth`) and can share adapter patterns.
- dYdX limits can vary by indexer deployment. Use canonical `indexer.dydx.trade` for baseline behavior.

### 4.5 Rate-limit telemetry headers to capture in logs

Capture these headers per request when present (store in debug logs, not required in CSV):

- Binance/AsterDEX: `X-MBX-USED-WEIGHT-1m`
- Bybit: `X-Bapi-Limit-Status`, `X-Bapi-Limit-Reset-Timestamp`
- dYdX: `ratelimit-limit`, `ratelimit-remaining`, `ratelimit-reset`

Note:

- Hyperliquid and Lighter do not reliably expose rate headers for this use case; infer pressure from status codes and latency trends.

### 4.6 Throughput planning and guardrails

At `3 samples/minute`, each `exchange x ticker` consumes `3` requests/minute.

Planning rules:

- Compute projected request or weight usage at startup.
- Warn at `>= 80%` projected budget usage.
- Hard-block config at `>= 100%` projected budget usage unless explicit override is set.

Important note from `info.md`:

- Request weight for Binance and AsterDEX depends on depth limit.
- Capacity estimates change materially between `limit=100` and `limit=1000`.
- Keep depth limit configurable per exchange and include it in budget calculations.

---

## 5) Symbol Mapping And Coverage

Symbol mapping should be config-driven, using the same semantics as `src/lib/pair-mapping.ts`:

- Canonical ticker definition with optional per-exchange quote overrides
- Optional manual per-exchange symbol override
- Exchange symbol styles:
  - `baseOnly` (e.g. Hyperliquid, Lighter)
  - `baseDashQuote` (e.g. dYdX)
  - `baseQuote` (e.g. Binance, Bybit, AsterDEX)

Initial run set:

- Tickers: `BTC`, `ETH`, `SOL`
- Exchanges: all 6 above

---

## 6) Sampling Model

### 6.1 Minute window

Default:

- `samples_per_minute = 3`
- Offsets: `0s`, `20s`, `40s`

For each minute/ticker/exchange:

1. Collect 3 samples.
2. Compute 1 minute aggregate row (median for numeric fields).

Scheduling guidance:

- Keep per-minute offsets deterministic.
- Stagger exchange requests within each offset window (small jitter) to reduce burst collisions at scale.

### 6.2 Aggregation rules

Numeric fields:

- Median across successful samples only.

Boolean fields:

- Majority vote (`true` count > `false` count), tie -> `false`.

Meta fields:

- `lighterWsFallback`: `true` if any successful sample used WS.
- `hyperliquidNSigFigs`: minimum across successful samples.
- `hyperliquidNSigFigsPerTier`: per-tier minimum across successful samples.
- `isAggregatedEstimate`: `true` if any successful sample is aggregated.

Timestamp/error fields:

- `book_timestamp_ms`: median of successful sample book timestamps (rounded to integer).
- `collected_at_utc`: minute bucket close time in UTC (`YYYY-MM-DDTHH:MM:00Z`).
- `error`: empty when `samples_success > 0`; populated summary when `samples_success = 0`.

If zero successful samples for a minute:

- Write row with null metrics and populated `error`.

---

## 7) Output Data Model

Use one wide CSV row per `minute x exchange x ticker`.

Required columns:

`ts_minute_utc,exchange,ticker,symbol,samples_total,samples_success,book_timestamp_ms,collected_at_utc,mid_price,best_bid,best_ask,spread_usd,spread_bps,ask_slip_1k,ask_slip_10k,ask_slip_100k,ask_slip_1m,bid_slip_1k,bid_slip_10k,bid_slip_100k,bid_slip_1m,ask_fill_1k,ask_fill_10k,ask_fill_100k,ask_fill_1m,bid_fill_1k,bid_fill_10k,bid_fill_100k,bid_fill_1m,ask_filled_notional_1m,bid_filled_notional_1m,is_aggregated_estimate,hyperliquid_n_sig_figs,hyperliquid_n_sig_figs_per_tier,lighter_ws_fallback,error`

Notes:

- `hyperliquid_n_sig_figs_per_tier` stored as compact JSON string (example: `[5,5,4,3]`).
- `error` empty on success.
- Rows must be idempotent on key: `(ts_minute_utc, exchange, ticker)`.

---

## 8) Storage Layout

Recommended daily partitioning:

```
data/
  daily/
    YYYY-MM-DD.csv
  logs/
    YYYY-MM-DD/
      run-<run_id>.jsonl
  archive/
    YYYY-MM.csv.gz
```

Policy:

- Append minute rows to current day file.
- Optional monthly compression job moves old daily files into `archive`.

---

## 9) Runtime And Scheduling

### 9.1 Runtime modes

Provide both:

- `collect:once` (single bounded run)
- `collect:daemon` (continuous local process)
- `collect:backfill --from --to` (historical replay windows)

### 9.2 GitHub Actions mode (optional but supported)

Bounded run pattern:

- Duration: 15 minutes
- Timeout guard: 20 minutes
- At run end: commit and push `data/`
- Optional chaining via `workflow_dispatch`
- Kill switch variable: `COLLECT_ENABLED`
- Backup schedule: every 30 minutes to restart if chain breaks

### 9.3 Configuration contract (required)

Example config keys:

- `pairs`: ticker list
- `exchanges`: exchange list
- `samples_per_minute`
- `sample_offsets_sec`
- `run_duration_minutes`
- `fetch_timeout_ms`
- `retry_max_attempts`
- `retry_backoff_ms`
- `depth_limit_by_exchange`
- `rate_limit_guardrails_enabled`
- `allow_over_budget_override`
- `enable_lighter_ws_fallback`
- `enable_hyperliquid_adaptive_sigfigs`
- `log_level`
- `log_json`
- `debug_capture_headers`

Config validation:

- Fail fast if unknown exchange or ticker is configured.
- Fail fast if offsets count does not match `samples_per_minute`.
- Fail fast if projected throughput exceeds hard guardrail without override.

---

## 10) Reliability Requirements

Per request:

- Timeout (`fetch_timeout_ms`, default 8-10s)
- Retry policy (small bounded retries with jitter)
- Structured error classification (`timeout`, `http_<code>`, `parse_error`, `ws_error`, `unknown`)
- Capture request latency, response status, and relevant rate-limit headers for every attempt.

Throttle-aware behavior:

- On `429`, apply exponential backoff with jitter per exchange.
- On Bybit `403` ban signals, apply cool-off window before next Bybit attempt.
- Maintain per-exchange failure counters and emit warning logs when consecutive failures exceed threshold.

Per minute row:

- Row must still be written when failures occur (timeline continuity).
- Include `samples_success`, `samples_total`, and `error`.
- Include concise error summary string when minute is fully failed (first root cause + failure count).

Process-level:

- Prevent overlapping runs for same target partition.
- Graceful shutdown flushes buffered rows.
- Add heartbeat log line every minute with processed row count and current lag.

Debug observability requirements:

- Emit structured JSONL logs (one event per line).
- Include `run_id`, `exchange`, `ticker`, `minute_bucket`, `sample_index`, `stage`, `duration_ms`, `result`, `error_code`.
- Log Hyperliquid strategy decisions: attempted `nSigFigs`, fill cursor progression, selected per-tier `nSigFigs`.
- Log Lighter fallback decisions: REST level counts, partial detection, WS fallback attempt, WS success/failure.

---

## 11) Suggested Standalone Repo Layout

```
liquidity-ingestion/
  README.md
  plan.md
  package.json
  config/
    ingestion.config.json
  src/
    main.ts
    config.ts
    types.ts
    pair-mapping.ts
    constants.ts
    metrics/
      slippage.ts
    exchanges/
      hyperliquid.ts
      dydx.ts
      lighter-rest.ts
      lighter-ws.ts
      asterdex.ts
      binance.ts
      bybit.ts
      index.ts
    ingest/
      sample-engine.ts
      minute-aggregate.ts
      hyperliquid-strategy.ts
      lighter-strategy.ts
    storage/
      csv-writer.ts
      rotate-archive.ts
    util/
      time.ts
      retry.ts
      errors.ts
  .github/workflows/
    collect.yml
```

---

## 12) Agent Execution Plan (Implementation Phases)

### Phase 1: Core metric parity ✅ COMPLETE

- Port slippage and analyze logic exactly. ✅
- Add deterministic unit tests for: ✅
  - Full fill ✅
  - Partial fill ✅
  - Rounding behavior ✅
- 29 tests passing (23 slippage + 6 pair-mapping)

### Phase 2: Exchange adapters ✅ COMPLETE

- Implement fetch + parse for all 6 exchanges. ✅
- Port Lighter market ID cache. ✅
- Lighter symbol format corrected: uses baseOnly ("BTC"), not "BTC-USD" ✅
- Binance/AsterDEX share a single adapter (identical API). ✅
- All 18 exchange×ticker combinations verified against live APIs. ✅

### Phase 3: Special strategies ✅ COMPLETE

- Implement Hyperliquid adaptive `nSigFigs` merge strategy. ✅
- Implement Lighter REST->WS fallback strategy. ✅

### Phase 4: Minute sampler ✅ COMPLETE (updated to 4 samples/min)

- Implement 4-sample/minute loop with offsets [0, 15, 30, 45]. ✅
- Implement median/minute row aggregation rules. ✅
- Emit structured errors while preserving rows. ✅
- 5 aggregation tests passing. ✅

### Phase 5: Persistence and ops ✅ COMPLETE

- Implement daily CSV writer and idempotent upsert behavior. ✅
- Add GitHub Actions workflow with bounded run and kill switch. ✅
- 4 CSV writer tests passing. ✅

### Phase 6: Backfill and validation

- Implement date-range backfill mode.
- Add reconciliation script:
  - row count by day
  - null/error rate by exchange
  - duplicate key check

---

## 13) Acceptance Criteria

The ingestion pipeline is considered production-ready when:

1. It runs continuously for 24h with no data gap larger than 2 minutes.
2. Every minute has one row per configured exchange+ticker, even on failures.
3. Hyperliquid rows include correct aggregate metadata when coarser `nSigFigs` is used.
4. Lighter rows indicate WS fallback when REST depth is insufficient.
5. Metric outputs match reference formulas and rounding from source-of-truth logic.
6. CSV files are parseable and idempotent on `(ts_minute_utc, exchange, ticker)`.

---

## 14) Open Decisions

1. Retention policy: how many daily CSV files remain uncompressed.
2. Storage target: keep in Git repo vs separate data bucket/repo long-term.
3. Default ticker set beyond BTC/ETH/SOL.
4. Whether to persist per-sample raw rows in addition to minute aggregates.

---

## 15) Build And Debug Runbook

Use this runbook during implementation and incident triage.

### 15.1 Adapter bring-up checklist

1. Verify endpoint request/response contract with direct HTTP call.
2. Confirm parser output has sorted bids/asks and non-empty sides.
3. Record sample response fixture for regression tests.
4. Verify slippage outputs on fixture with deterministic expected values.

### 15.2 Strategy-specific checks

Hyperliquid checks:

1. Validate base sample at `nSigFigs=5` succeeds for liquid ticker.
2. Validate adaptive fallback path when deeper tiers become partial.
3. Confirm emitted meta includes `hyperliquid_n_sig_figs` and `hyperliquid_n_sig_figs_per_tier`.

Lighter checks:

1. Validate REST depth path for liquid ticker without fallback.
2. Validate forced/observed partial path triggers WS fallback.
3. Confirm row sets `lighter_ws_fallback=true` only when WS analysis used.

### 15.3 Minute aggregation checks

1. Verify 3 samples produce exactly 1 row per `exchange x ticker x minute`.
2. Verify median aggregation for numeric fields.
3. Verify boolean majority handling and tie behavior.
4. Verify full-failure minute still writes row with null metrics + error.

### 15.4 CSV and idempotency checks

1. Re-run same minute window and confirm no duplicate key rows.
2. Validate schema/header order exactly matches Section 7.
3. Run duplicate scan on `(ts_minute_utc, exchange, ticker)`.
4. Validate day file row count equals expected minutes * exchanges * tickers (minus allowed downtime windows).

### 15.5 Operational checks

1. Confirm workflow timeout guard and kill switch behavior.
2. Confirm logs include rate header telemetry for supported exchanges.
3. Alert when exchange failure ratio exceeds threshold over rolling window.
4. Confirm archive/rotation does not break downstream CSV consumers.

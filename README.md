# perps-spread-depth-data

Historical spread and depth ingestion for perpetual futures order books across multiple exchanges.

## What this project does

Every minute, the collector:
1. Takes multiple snapshots of each `exchange x ticker` order book.
2. Computes spread and slippage metrics per snapshot.
3. Aggregates the snapshots into one minute-level row (median/majority rules).
4. Upserts rows into CSV storage keyed by `(ts_minute_utc, exchange, ticker)`.

Current tracked exchanges:
- `hyperliquid`
- `dydx`
- `lighter`
- `asterdex`
- `binance`
- `bybit`

Current tracked tickers:
- `BTC`
- `ETH`
- `SOL`
- `XRP`
- `HYPE`
- `BONK`
- `PAXG`
- `ZEC`

Unsupported exchange/ticker combinations are intentionally skipped
(for example `PAXG` on `asterdex`), so no row is emitted for those pairs.

## Runtime defaults (current config)

From `config/ingestion.config.json`:
- `samples_per_minute`: `4`
- `sample_offsets_sec`: `[0, 15, 30, 45]`
- `run_duration_minutes`: `15`
- `fetch_timeout_ms`: `10000`
- `retry_max_attempts`: `2`
- `retry_backoff_ms`: `500`

Important:
- Minute timestamp (`ts_minute_utc`) is the minute start (`YYYY-MM-DDTHH:MM:00Z`).
- If a run starts late, stale offsets for that minute are skipped instead of crossing into next minute.
- If all offsets are stale, one immediate fallback sample is collected so the minute still gets data.

## Data flow and computation

## 1) Symbol mapping

Canonical tickers are mapped to exchange-native symbols in `src/pair-mapping.ts`.

Style rules:
- `baseOnly`: e.g. `BTC`
- `baseDashQuote`: e.g. `BTC-USD`
- `baseQuote`: e.g. `BTCUSDT`

Examples:
- Hyperliquid: `BTC`
- dYdX: `BTC-USD`
- Binance/AsterDEX/Bybit: `BTCUSDT`
- Lighter: `BTC` (then resolved to numeric market ID)

## 2) Per-snapshot fetch and normalization

For each sample:
1. Fetch raw order book from exchange API.
2. Parse prices/sizes as numbers.
3. Drop invalid levels where price/size are non-finite or `<= 0`.
4. Sort bids descending and asks ascending.
5. Reject books with empty bids or asks.

## 3) Per-snapshot metrics

Given best bid and ask:
- `midPrice = (bestBid + bestAsk) / 2`
- `spreadUsd = bestAsk - bestBid`
- `spreadBps = (spreadUsd / midPrice) * 10000`

Notional tiers:
- `$1k`, `$10k`, `$100k`, `$1m`

For each tier and side, the engine walks levels from best price outward until target notional is filled or book ends.

Computed fields per tier:
- `vwap = totalCost / totalQty` (or `0` when unfilled)
- `filled` boolean
- `filledNotional` actual filled notional
- `slippageBps`

Slippage formulas:
- Ask side: `((vwap - midPrice) / midPrice) * 10000`
- Bid side: `((midPrice - vwap) / midPrice) * 10000`

Rounding:
- `midPrice`, `spreadUsd`, `bestBid`, `bestAsk`, `vwap`: 6 decimals
- `spreadBps`: 6 decimals
- `slippageBps`: 2 decimals
- `filledNotional`: 2 decimals

## 4) Minute aggregation rules

Snapshots are grouped by `exchange + ticker` and collapsed into one row per minute.

Numeric fields:
- Median across successful snapshots only.

Boolean fields:
- Majority vote (`true` count must be greater than half).
- Tie resolves to `false`.

Meta fields:
- `is_aggregated_estimate`: `true` if any successful sample is aggregated (Hyperliquid adaptive).
- `hyperliquid_n_sig_figs`: minimum `nSigFigs` used among successful samples.
- `hyperliquid_n_sig_figs_per_tier`: per-tier minimum array (stored as JSON string).
- `lighter_ws_fallback`: `true` if any successful sample used Lighter WS fallback.

Failure handling:
- If all samples fail for a minute, metrics are `null` and `error` contains summarized causes.
- If at least one sample succeeds, `error` is empty for that row.

## 5) Retry and errors

Retry behavior:
- Bounded retries with jittered backoff.
- Defaults: max 2 attempts, base backoff 500ms.

Error classification:
- `timeout`
- `http_error`
- `parse_error`
- `ws_error`
- `empty_book`
- `unknown`

Per-sample errors are also persisted as JSONL:
- `data/logs/YYYY-MM-DD/errors.jsonl`

## Storage format and semantics

CSV storage path:
- Monthly file: `data/YYYY-MM.csv`

Upsert behavior:
- Idempotent key: `(ts_minute_utc, exchange, ticker)`
- Existing key rows are replaced, new keys appended.

String serialization:
- Newlines are normalized to literal `\\n` to keep one CSV record per line.

Current CSV columns (exact order):
- `ts_minute_utc`
- `exchange`
- `ticker`
- `symbol`
- `samples_total`
- `samples_success`
- `book_timestamp_ms`
- `collected_at_utc`
- `mid_price`
- `best_bid`
- `best_ask`
- `spread_usd`
- `spread_bps`
- `ask_slip_1k`
- `ask_slip_10k`
- `ask_slip_100k`
- `ask_slip_1m`
- `bid_slip_1k`
- `bid_slip_10k`
- `bid_slip_100k`
- `bid_slip_1m`
- `ask_fill_1k`
- `ask_fill_10k`
- `ask_fill_100k`
- `ask_fill_1m`
- `bid_fill_1k`
- `bid_fill_10k`
- `bid_fill_100k`
- `bid_fill_1m`
- `ask_filled_notional_1m`
- `bid_filled_notional_1m`
- `is_aggregated_estimate`
- `hyperliquid_n_sig_figs`
- `hyperliquid_n_sig_figs_per_tier`
- `lighter_ws_fallback`
- `error`

## Exchange caveats

## Hyperliquid

API:
- `POST /info` with `{ type: "l2Book", coin, nSigFigs? }`

Caveats:
- Public depth is capped at 20 levels per side.
- This can underfill large notionals on thin books.

Mitigation in this repo:
- Adaptive aggregation strategy tries `nSigFigs` in `[5,4,3,2]`.
- Keeps first successful snapshot for top-of-book fields.
- Fills deeper tiers from progressively coarser books.
- Writes metadata:
  - `is_aggregated_estimate`
  - `hyperliquid_n_sig_figs`
  - `hyperliquid_n_sig_figs_per_tier`

## Lighter

APIs:
- REST market discovery: `GET /api/v1/orderBooks`
- REST book: `GET /api/v1/orderBookOrders?market_id={id}&limit={limit}`
- WS book: `wss://mainnet.zklighter.elliot.ai/stream`

Caveats:
- Symbols must be resolved to numeric `market_id`.
- REST depth has hard max `limit=250` orders per side.
- REST may be insufficient for large notionals in thin markets.

Mitigation in this repo:
- Caches market ID map for 5 minutes.
- Aggregates REST orders by price client-side.
- If any tier is partial on REST, optionally fetches one-shot full WS snapshot.
- Sets `lighter_ws_fallback=true` when WS snapshot is used.

## dYdX

API:
- `GET /v4/orderbooks/perpetualMarket/{ticker}`

Caveats:
- Symbol format must match `BASE-USD` (for example `BTC-USD`).
- Adapter does not use an explicit depth limit parameter.
- No exchange timestamp is persisted by current adapter, so `book_timestamp_ms` may be `null`.

## Binance

API:
- `GET /fapi/v1/depth?symbol={symbol}&limit={depthLimit}`

Caveats:
- Rate limit cost grows with depth limit.
- Current default depth is 1000.

Implementation detail:
- Adapter sets `timestamp` to local `Date.now()` (not exchange event time).

## AsterDEX

API:
- Binance-compatible `GET /fapi/v1/depth`

Caveats:
- Same shape and operational caveats as Binance in this implementation.
- Current default depth is 1000.

Implementation detail:
- Uses same shared adapter as Binance.
- `timestamp` is local `Date.now()`.

## Bybit

API:
- `GET /v5/market/orderbook?category=linear&symbol={symbol}&limit={depthLimit}`

Caveats:
- `category=linear` is required.
- Response must have `retCode === 0`; otherwise sample fails.

Implementation detail:
- Uses exchange-provided `result.ts` as `book_timestamp_ms`.

## Rate-limit guardrails

At startup, config validation estimates projected request weight and:
- Warns at `>= 80%`
- Blocks at `>= 100%` unless `allow_over_budget_override=true`

Current practical guidance in `src/pair-mapping.ts`:
- With current defaults, keep `<=12` tickers for comfortable headroom.

## Operational caveats and maintenance notes

- The collector writes monthly CSV files (`data/YYYY-MM.csv`), not daily partition files.
- Existing workflow runs every 30 minutes and commits updated CSV data.
- If `samples_success=0`, metric columns are null by design to preserve timeline continuity.
- `error` field stores summary text for row-level failures; full per-sample failures are in JSONL logs.

## Usage

Install:
```bash
npm ci
```

Run once (bounded):
```bash
npm run collect:once
```

Run continuously:
```bash
npm run collect:daemon
```

Run tests:
```bash
npm test
```

Typecheck:
```bash
npm run typecheck
```

## Config reference

Main config file:
- `config/ingestion.config.json`

Key fields:
- `pairs`
- `exchanges`
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

## Repository map

- `src/main.ts`: runtime scheduler and minute loop
- `src/metrics/slippage.ts`: normalization + spread/slippage math
- `src/ingest/sample-engine.ts`: per-sample orchestration, retries, error capture
- `src/ingest/minute-aggregate.ts`: minute-level aggregation rules
- `src/ingest/hyperliquid-strategy.ts`: adaptive `nSigFigs` logic
- `src/ingest/lighter-strategy.ts`: REST->WS fallback logic
- `src/storage/csv-writer.ts`: CSV upsert writer
- `src/storage/error-log.ts`: JSONL sample error logs
- `src/pair-mapping.ts`: canonical ticker list and symbol mapping

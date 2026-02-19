/**
 * bonk-snapshot.ts
 * Live BONK-USD snapshot from dYdX — shows pipeline steps + slippage table.
 * Run with:  npx tsx bonk-snapshot.ts
 */

import { fetchDydx } from './src/exchanges/dydx.js';
import { normalizeBook, computeSlippage } from './src/metrics/slippage.js';
import { resolveSymbol } from './src/pair-mapping.js';

// ── helpers ────────────────────────────────────────────────────────────────

const TIERS = [1_000, 10_000, 100_000, 1_000_000];
const TIER_LABELS = ['$1k', '$10k', '$100k', '$1M'];

function round(v: number, dp: number) {
  const f = 10 ** dp;
  return Math.round(v * f) / f;
}

const dim   = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold  = (s: string) => `\x1b[1m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red   = (s: string) => `\x1b[31m${s}\x1b[0m`;
const cyan  = (s: string) => `\x1b[36m${s}\x1b[0m`;
const yellow= (s: string) => `\x1b[33m${s}\x1b[0m`;

function pad(s: string, w: number, right = false) {
  return right ? s.padStart(w) : s.padEnd(w);
}

function step(n: number, label: string) {
  console.log(`\n${cyan(`[${n}]`)} ${bold(label)}`);
}

function printDivider(char = '─', width = 72) {
  console.log(dim(char.repeat(width)));
}

// ── main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n' + bold('  BONK / dYdX  —  live order-book snapshot'));
  printDivider('═');

  // ── Step 1: symbol resolution ──────────────────────────────────────────

  step(1, 'Symbol resolution  (pair-mapping.ts → resolveSymbol)');
  console.log(dim('  BONK has no dydx override in PAIR_MAP, so falls back to:'));
  console.log(dim('    EXCHANGE_SYMBOL_STYLE[dydx]  = "baseDashQuote"'));
  console.log(dim('    EXCHANGE_DEFAULT_QUOTE[dydx] = "USD"'));
  console.log(dim('    ⟹  symbol = base + "-" + quote'));

  const symbol = resolveSymbol('BONK', 'dydx');
  console.log(`\n  resolveSymbol('BONK', 'dydx')  →  ${yellow(symbol)}`);

  // ── Step 2: fetch order book ───────────────────────────────────────────

  step(2, 'Fetch order book  (exchanges/dydx.ts → fetchDydx)');
  const url = `https://indexer.dydx.trade/v4/orderbooks/perpetualMarket/${symbol}`;
  console.log(dim(`  GET ${url}`));
  console.log(dim('  Response: { bids: [{price,size},...], asks: [{price,size},...] }'));
  console.log(dim('  Prices/sizes arrive as strings → parsed with parseFloat()'));

  const fetchedAt = new Date();
  const raw = await fetchDydx(symbol, 10_000);

  console.log(`\n  Fetched at  ${fetchedAt.toISOString()}`);
  console.log(`  Raw levels  bids=${raw.bids.length}   asks=${raw.asks.length}`);

  // ── Step 3: normalize book ─────────────────────────────────────────────

  step(3, 'Normalize book  (metrics/slippage.ts → normalizeBook)');
  console.log(dim('  • Drop NaN / ≤0 price or size'));
  console.log(dim('  • Sort bids descending, asks ascending'));
  console.log(dim('  • Reject if either side is empty'));

  const book = normalizeBook(raw.bids, raw.asks);
  if (!book) {
    console.error(red('  ERROR: empty book — aborting'));
    process.exit(1);
  }
  console.log(`\n  Clean levels  bids=${book.bids.length}   asks=${book.asks.length}`);

  // ── Step 4: mid / spread ───────────────────────────────────────────────

  step(4, 'Mid price & spread');

  const bestBid = book.bids[0].price;
  const bestAsk = book.asks[0].price;
  const mid     = round((bestBid + bestAsk) / 2, 8);
  const spreadUsd = round(bestAsk - bestBid, 8);
  const spreadBps = round((spreadUsd / mid) * 10_000, 2);

  console.log(dim('  midPrice  = (bestBid + bestAsk) / 2'));
  console.log(dim('  spreadBps = (spreadUsd / mid) × 10,000'));
  console.log(`\n  bestBid   = ${green(bestBid.toFixed(8))}`);
  console.log(`  bestAsk   = ${red(bestAsk.toFixed(8))}`);
  console.log(`  midPrice  = ${bold(mid.toFixed(8))}`);
  console.log(`  spreadUsd = ${spreadUsd.toFixed(8)}`);
  console.log(`  spreadBps = ${bold(spreadBps.toFixed(2))} bps`);

  // ── Step 5: top-of-book preview ───────────────────────────────────────

  step(5, 'Top 5 levels each side');

  const COL = { side: 6, price: 16, size: 20, notional: 14 };
  const hdr = [
    pad('Side',     COL.side),
    pad('Price',    COL.price, true),
    pad('Size',     COL.size,  true),
    pad('Notional', COL.notional, true),
  ].join('  ');
  printDivider();
  console.log('  ' + bold(hdr));
  printDivider();

  const printLevels = (levels: typeof book.bids, side: 'BID' | 'ASK', n = 5) => {
    for (let i = 0; i < Math.min(n, levels.length); i++) {
      const l = levels[i];
      const notional = l.price * l.size;
      const color = side === 'BID' ? green : red;
      const row = [
        pad(color(side), COL.side),
        pad(l.price.toFixed(8), COL.price, true),
        pad(l.size.toFixed(2),  COL.size,  true),
        pad(`$${notional.toFixed(2)}`, COL.notional, true),
      ].join('  ');
      console.log('  ' + row);
    }
  };

  // asks sorted ascending: [0] = best (lowest). Show top 5 from best outward.
  printLevels(book.asks, 'ASK');
  printDivider('·');
  printLevels(book.bids, 'BID');
  printDivider();

  // ── Step 6: slippage calculation ───────────────────────────────────────

  step(6, 'Slippage  (metrics/slippage.ts → computeSlippage)');
  console.log(dim('  For each tier, walk levels from best outward, filling targetNotional.'));
  console.log(dim('  vwap        = totalCost / totalQty'));
  console.log(dim('  ask slip    = ((vwap - mid) / mid) × 10,000  bps'));
  console.log(dim('  bid slip    = ((mid - vwap) / mid) × 10,000  bps'));
  console.log(dim('  +bps = worse than mid  |  −bps = better (anomalous, e.g. price tick rounding)'));

  // ── Step 7: slippage table ─────────────────────────────────────────────

  step(7, 'Slippage table');

  const C = { tier: 8, slip: 12, vwap: 18, notl: 14, fill: 6 };
  const tableHdr = [
    pad('Tier',    C.tier),
    pad('AskSlip', C.slip, true),
    pad('BidSlip', C.slip, true),
    pad('Ask VWAP', C.vwap, true),
    pad('Bid VWAP', C.vwap, true),
    pad('AskFill', C.notl, true),
    pad('BidFill', C.notl, true),
  ].join('  ');

  printDivider('─', 100);
  console.log('  ' + bold(tableHdr));
  printDivider('─', 100);

  for (let i = 0; i < TIERS.length; i++) {
    const tier  = TIERS[i];
    const label = TIER_LABELS[i];

    const ask = computeSlippage(book.asks, tier, mid, 'ask');
    const bid = computeSlippage(book.bids, tier, mid, 'bid');

    const fmtSlip = (bps: number, filled: boolean) => {
      if (!filled) return dim('n/a (partial)');
      const s = bps.toFixed(2) + ' bps';
      return bps > 50 ? red(s) : bps > 10 ? yellow(s) : green(s);
    };

    const fmtFilled = (r: ReturnType<typeof computeSlippage>) =>
      r.filled
        ? `$${r.filledNotional.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
        : dim(`$${r.filledNotional.toLocaleString('en-US', { maximumFractionDigits: 0 })} (partial)`);

    const row = [
      pad(bold(label), C.tier),
      pad(fmtSlip(ask.slippageBps, ask.filled), C.slip, true),
      pad(fmtSlip(bid.slippageBps, bid.filled), C.slip, true),
      pad(ask.vwap.toFixed(8), C.vwap, true),
      pad(bid.vwap.toFixed(8), C.vwap, true),
      pad(fmtFilled(ask), C.notl, true),
      pad(fmtFilled(bid), C.notl, true),
    ].join('  ');

    console.log('  ' + row);
  }

  printDivider('─', 100);
  console.log(dim('\n  Green ≤ 10bps  |  Yellow ≤ 50bps  |  Red > 50bps  |  n/a = book too thin\n'));
}

main().catch((err) => {
  console.error(red('\nFatal: ' + String(err)));
  process.exit(1);
});

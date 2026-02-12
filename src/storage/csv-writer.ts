import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import type { MinuteRow } from '../types.js';
import { monthUTC } from '../util/time.js';
import { log } from '../util/logger.js';

const DATA_DIR = resolve(import.meta.dirname, '..', '..', 'data');

/** CSV column order — must match plan section 7 exactly */
const CSV_COLUMNS: (keyof MinuteRow)[] = [
  'ts_minute_utc',
  'exchange',
  'ticker',
  'symbol',
  'samples_total',
  'samples_success',
  'book_timestamp_ms',
  'collected_at_utc',
  'mid_price',
  'best_bid',
  'best_ask',
  'spread_usd',
  'spread_bps',
  'ask_slip_1k',
  'ask_slip_10k',
  'ask_slip_100k',
  'ask_slip_1m',
  'bid_slip_1k',
  'bid_slip_10k',
  'bid_slip_100k',
  'bid_slip_1m',
  'ask_fill_1k',
  'ask_fill_10k',
  'ask_fill_100k',
  'ask_fill_1m',
  'bid_fill_1k',
  'bid_fill_10k',
  'bid_fill_100k',
  'bid_fill_1m',
  'ask_filled_notional_1m',
  'bid_filled_notional_1m',
  'is_aggregated_estimate',
  'hyperliquid_n_sig_figs',
  'hyperliquid_n_sig_figs_per_tier',
  'lighter_ws_fallback',
  'error',
];

const HEADER_LINE = CSV_COLUMNS.join(',');

/**
 * Get the path for this month's CSV file.
 * One file per month: data/YYYY-MM.csv
 * Rotates automatically at UTC month boundary.
 */
export function monthlyCsvPath(date?: Date): string {
  return resolve(DATA_DIR, `${monthUTC(date)}.csv`);
}

/**
 * Ensure the data directory and CSV file exist with header.
 */
function ensureFile(filePath: string): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  if (!existsSync(filePath)) {
    writeFileSync(filePath, HEADER_LINE + '\n', 'utf-8');
    log.info(`Created monthly CSV: ${filePath}`);
  }
}

/**
 * Serialize a MinuteRow to a CSV line.
 */
function rowToCsv(row: MinuteRow): string {
  return CSV_COLUMNS.map((col) => {
    const val = row[col];
    if (val === null || val === undefined) return '';
    if (typeof val === 'boolean') return val ? 'true' : 'false';
    if (typeof val === 'string') {
      // Keep records single-line so split('\n') remains safe for idempotent upsert.
      const singleLine = val.replace(/\r?\n/g, '\\n');
      // Escape strings that contain commas or quotes
      if (singleLine.includes(',') || singleLine.includes('"')) {
        return `"${singleLine.replace(/"/g, '""')}"`;
      }
      return singleLine;
    }
    return String(val);
  }).join(',');
}

/**
 * Append rows to this month's CSV file.
 * Implements idempotent upsert: if a row with the same (ts_minute_utc, exchange, ticker)
 * already exists, it will be replaced.
 */
export function appendRows(rows: MinuteRow[], date?: Date): void {
  const filePath = monthlyCsvPath(date);
  ensureFile(filePath);

  // Read existing rows to check for duplicates
  const existingContent = readFileSync(filePath, 'utf-8');
  const existingLines = existingContent.split('\n').filter((l) => l.trim());

  // Build a set of existing keys (skip header)
  const existingKeys = new Set<string>();
  const existingRows: string[] = [];

  for (let i = 0; i < existingLines.length; i++) {
    if (i === 0) {
      existingRows.push(existingLines[i]); // keep header
      continue;
    }
    const parts = existingLines[i].split(',');
    const key = `${parts[0]}|${parts[1]}|${parts[2]}`; // ts|exchange|ticker
    existingKeys.add(key);
    existingRows.push(existingLines[i]);
  }

  // Check new rows for duplicates
  const newLines: string[] = [];
  const replaceKeys = new Map<string, string>(); // key → new csv line

  for (const row of rows) {
    const key = `${row.ts_minute_utc}|${row.exchange}|${row.ticker}`;
    const csvLine = rowToCsv(row);

    if (existingKeys.has(key)) {
      // Mark for replacement (idempotent upsert)
      replaceKeys.set(key, csvLine);
    } else {
      newLines.push(csvLine);
    }
  }

  if (replaceKeys.size > 0) {
    // Rewrite file with replacements
    const updatedLines = existingRows.map((line, i) => {
      if (i === 0) return line; // header
      const parts = line.split(',');
      const key = `${parts[0]}|${parts[1]}|${parts[2]}`;
      return replaceKeys.get(key) ?? line;
    });

    // Append truly new rows
    updatedLines.push(...newLines);
    writeFileSync(filePath, updatedLines.join('\n') + '\n', 'utf-8');
    log.debug(`CSV upsert: ${replaceKeys.size} replaced, ${newLines.length} appended`);
  } else if (newLines.length > 0) {
    // Simple append
    appendFileSync(filePath, newLines.join('\n') + '\n', 'utf-8');
    log.debug(`CSV append: ${newLines.length} rows`);
  }
}

/**
 * Get the CSV header string.
 */
export function getCsvHeader(): string {
  return HEADER_LINE;
}

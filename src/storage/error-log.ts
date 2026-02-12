import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ExchangeKey } from '../types.js';
import { todayUTC } from '../util/time.js';

interface SampleErrorRecord {
  ts: string;
  exchange: ExchangeKey;
  ticker: string;
  sample_index: number;
  code: string;
  message: string;
}

const LOGS_DIR = resolve(import.meta.dirname, '..', '..', 'data', 'logs');

export function appendSampleErrorLog(record: SampleErrorRecord, date: Date = new Date()): void {
  const day = todayUTC(date);
  const dir = resolve(LOGS_DIR, day);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const path = resolve(dir, 'errors.jsonl');
  appendFileSync(path, JSON.stringify(record) + '\n', 'utf-8');
}

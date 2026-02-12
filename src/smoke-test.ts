/**
 * Quick smoke test: collect one sample round and write to CSV.
 * Run with: npx tsx src/smoke-test.ts
 */
import { loadConfig } from './config.js';
import { collectSampleRound } from './ingest/sample-engine.js';
import { aggregateMinute } from './ingest/minute-aggregate.js';
import { appendRows } from './storage/csv-writer.js';
import { configureLogger, log } from './util/logger.js';
import { minuteBucket, generateRunId } from './util/time.js';

async function main() {
  const runId = generateRunId();
  const config = loadConfig();
  configureLogger('debug', false, runId);

  log.info(`Smoke test: collecting 1 sample round for ${config.pairs.length} tickers × ${config.exchanges.length} exchanges`);

  const start = Date.now();
  const samples = await collectSampleRound(0, config);
  const elapsed = Date.now() - start;

  // Report results
  const successful = samples.filter((s) => s.analysis !== null);
  const failed = samples.filter((s) => s.analysis === null);

  log.info(`Collected ${samples.length} samples in ${elapsed}ms: ${successful.length} ok, ${failed.length} failed`);

  for (const s of samples) {
    if (s.analysis) {
      log.info(`  ${s.exchange}:${s.ticker} — mid=${s.analysis.midPrice} spread=${s.analysis.spreadBps}bps (${s.durationMs}ms)`);
    } else {
      log.info(`  ${s.exchange}:${s.ticker} — FAILED: ${s.error} (${s.durationMs}ms)`);
    }
  }

  // Aggregate and write
  const bucket = minuteBucket();
  const rows = aggregateMinute(samples, bucket);
  appendRows(rows);

  log.info(`Wrote ${rows.length} rows to CSV for minute ${bucket}`);
}

main().catch((err) => {
  console.error('Smoke test failed:', err);
  process.exit(1);
});

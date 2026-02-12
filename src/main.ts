import { loadConfig } from './config.js';
import { collectSampleRound } from './ingest/sample-engine.js';
import { aggregateMinute } from './ingest/minute-aggregate.js';
import { appendRows } from './storage/csv-writer.js';
import { configureLogger, log } from './util/logger.js';
import { minuteBucket, sleep, generateRunId } from './util/time.js';
import type { RawSample, IngestionConfig } from './types.js';

// ── Parse CLI args ──

function parseArgs(): { mode: 'once' | 'daemon'; configPath?: string } {
  const args = process.argv.slice(2);
  let mode: 'once' | 'daemon' = 'once';
  let configPath: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--mode' && args[i + 1]) {
      const modeArg = args[i + 1];
      if (modeArg === 'once' || modeArg === 'daemon') {
        mode = modeArg;
      } else {
        throw new Error(`Invalid --mode: ${modeArg}. Expected "once" or "daemon".`);
      }
      i++;
    }
    if (args[i] === '--config' && args[i + 1]) {
      configPath = args[i + 1];
      i++;
    }
  }

  return { mode, configPath };
}

// ── Run one full minute cycle ──

async function runMinuteCycle(
  minuteStartMs: number,
  allSamples: RawSample[],
): Promise<void> {
  const bucket = minuteBucket(new Date(minuteStartMs));
  const rows = aggregateMinute(allSamples, bucket);
  appendRows(rows);

  const successCount = rows.filter((r) => r.samples_success > 0).length;
  const failCount = rows.filter((r) => r.samples_success === 0).length;

  log.info(`Minute ${bucket}: ${rows.length} rows written (${successCount} ok, ${failCount} failed)`, {
    minute: bucket,
    rows: rows.length,
    success: successCount,
    failed: failCount,
  });
}

// ── Bounded run (for GitHub Actions) ──

async function runOnce(config: IngestionConfig): Promise<void> {
  const durationMs = config.run_duration_minutes * 60 * 1000;
  const endTime = Date.now() + durationMs;

  log.info(`Starting bounded run for ${config.run_duration_minutes} minutes`, {
    pairs: config.pairs,
    exchanges: config.exchanges,
    samples_per_minute: config.samples_per_minute,
  });

  while (Date.now() < endTime) {
    await runOneMinute(config);

    // Check if we still have time for another minute
    if (Date.now() + 60_000 > endTime) {
      log.info('Approaching end of run duration, stopping');
      break;
    }
  }

  log.info('Bounded run complete');
}

// ── Daemon mode (continuous) ──

async function runDaemon(config: IngestionConfig): Promise<void> {
  log.info('Starting daemon mode (continuous)', {
    pairs: config.pairs,
    exchanges: config.exchanges,
    samples_per_minute: config.samples_per_minute,
  });

  // Graceful shutdown
  let running = true;
  const shutdown = () => {
    log.info('Shutdown signal received, finishing current cycle...');
    running = false;
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  while (running) {
    await runOneMinute(config);
  }

  log.info('Daemon stopped');
}

// ── Execute one minute of sampling ──

async function runOneMinute(config: IngestionConfig): Promise<void> {
  const cycleStartMs = floorToMinute(Date.now());
  const allSamples: RawSample[] = [];
  const offsets = [...config.sample_offsets_sec].sort((a, b) => a - b);
  let collectedRounds = 0;

  for (let i = 0; i < offsets.length; i++) {
    // Anchor each offset to this minute bucket to prevent cross-minute mixing.
    const targetMs = cycleStartMs + offsets[i] * 1000;
    const nowMs = Date.now();
    const lagMs = nowMs - targetMs;

    if (lagMs > 1000) {
      log.warn(`Skipping stale offset ${offsets[i]}s for minute ${minuteBucket(new Date(cycleStartMs))}`, {
        offset_sec: offsets[i],
        lag_ms: lagMs,
      });
      continue;
    }

    const waitMs = targetMs - nowMs;
    if (waitMs > 0) {
      await sleep(waitMs);
    }

    log.debug(`Collecting sample ${i + 1}/${offsets.length} at offset ${offsets[i]}s`);

    const samples = await collectSampleRound(i, config);
    allSamples.push(...samples);
    collectedRounds++;
  }

  // If we started late and all offsets were stale, collect one immediate round.
  if (collectedRounds === 0) {
    log.warn('No scheduled offsets were usable for this minute, collecting one immediate fallback sample');
    const samples = await collectSampleRound(0, config);
    allSamples.push(...samples);
  }

  await runMinuteCycle(cycleStartMs, allSamples);
}

function floorToMinute(tsMs: number): number {
  return Math.floor(tsMs / 60_000) * 60_000;
}

// ── Entry point ──

async function main(): Promise<void> {
  const { mode, configPath } = parseArgs();
  const runId = generateRunId();
  const config = loadConfig(configPath);

  configureLogger(config.log_level, config.log_json, runId);

  log.info(`Run ID: ${runId}, mode: ${mode}`, {
    run_id: runId,
    mode,
    tickers: config.pairs.length,
    exchanges: config.exchanges.length,
  });

  if (mode === 'once') {
    await runOnce(config);
  } else {
    await runDaemon(config);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});

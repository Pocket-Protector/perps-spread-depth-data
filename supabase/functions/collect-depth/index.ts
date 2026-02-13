import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { CONFIG } from './config.ts';
import { collectSampleRound } from './sample-engine.ts';
import { aggregateMinute } from './minute-aggregate.ts';
import type { RawSample } from './types.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

console.info('[collect-depth] Module loaded, SUPABASE_URL:', SUPABASE_URL ? 'set' : 'MISSING');

function formatMinuteBucket(date: Date): string {
  const d = new Date(date);
  d.setSeconds(0, 0);
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

Deno.serve(async (_req: Request) => {
  // No custom auth check — Supabase verifies the JWT in the Authorization header.
  // The function is invoked by pg_cron via net.http_post with the service_role key.

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const now = new Date();
  const minuteBucket = formatMinuteBucket(now);

  console.info(`[collect-depth] Starting collection for ${minuteBucket}`);

  try {
    // Collect 4 samples at 15s intervals
    const allSamples: RawSample[] = [];

    for (let i = 0; i < CONFIG.samples_per_minute; i++) {
      if (i > 0) {
        const offset = CONFIG.sample_offsets_sec[i] - CONFIG.sample_offsets_sec[i - 1];
        await new Promise((r) => setTimeout(r, offset * 1000));
      }

      console.info(`[collect-depth] Sample ${i + 1}/${CONFIG.samples_per_minute}`);
      const roundSamples = await collectSampleRound(i, CONFIG);
      allSamples.push(...roundSamples);
    }

    // Aggregate to minute-level metrics
    const minuteRows = aggregateMinute(allSamples, minuteBucket);

    const successCount = minuteRows.filter((r) => r.samples_success > 0).length;
    const errorCount = minuteRows.filter((r) => r.samples_success === 0).length;

    console.info(
      `[collect-depth] Aggregated ${minuteRows.length} rows (${successCount} ok, ${errorCount} failed)`,
    );

    // Upsert to database — pass array directly, supabase-js handles JSONB serialization
    const { error } = await supabase.rpc('upsert_depth_metrics', {
      rows: minuteRows,
    });

    if (error) {
      console.error('[collect-depth] Upsert error:', error);
      throw new Error(`Supabase upsert failed: ${error.message}`);
    }

    console.info(`[collect-depth] Done: ${minuteRows.length} rows upserted for ${minuteBucket}`);

    return new Response(
      JSON.stringify({
        ok: true,
        minute: minuteBucket,
        rows: minuteRows.length,
        success: successCount,
        errors: errorCount,
      }),
      { headers: { 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('[collect-depth] Collection failed:', err);
    return new Response(
      JSON.stringify({ ok: false, error: String(err) }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
});

import type { LiquidityAnalysis } from '../types.js';
import { HYPERLIQUID_SIG_FIGS_ORDER, NOTIONAL_TIERS } from '../constants.js';
import { fetchHyperliquid } from '../exchanges/hyperliquid.js';
import { normalizeBook, analyzeBook } from '../metrics/slippage.js';
import { log } from '../util/logger.js';

/**
 * Hyperliquid adaptive nSigFigs strategy.
 *
 * Algorithm (from plan section 4.2):
 * 1. Fetch/analyze at current nSigFigs (starting at 5, finest).
 * 2. Keep first successful analysis as the base for spread/mid fields.
 * 3. Fill slippage tiers progressively:
 *    - Move bid cursor while analysis.bids[idx].filled
 *    - Move ask cursor while analysis.asks[idx].filled
 * 4. Track coarsestUsed and perTierSigFigs.
 * 5. If some tiers remain unfilled after loop, use last analysis values.
 * 6. Return merged analysis with meta.
 */
export async function fetchHyperliquidAdaptive(
  coin: string,
  timeoutMs: number,
): Promise<LiquidityAnalysis> {
  let baseAnalysis: LiquidityAnalysis | null = null;
  let bidCursor = 0; // next unfilled bid tier index
  let askCursor = 0; // next unfilled ask tier index
  const tierCount = NOTIONAL_TIERS.length;
  const perTierSigFigs: number[] = new Array(tierCount).fill(0);
  let coarsestUsed: number = HYPERLIQUID_SIG_FIGS_ORDER[0];
  let lastSuccessfulAnalysis: LiquidityAnalysis | null = null;

  for (const nSigFigs of HYPERLIQUID_SIG_FIGS_ORDER) {
    // All tiers filled, done
    if (bidCursor >= tierCount && askCursor >= tierCount) break;

    try {
      const rawBook = await fetchHyperliquid(coin, timeoutMs, nSigFigs);
      const book = normalizeBook(rawBook.bids, rawBook.asks, rawBook.timestamp);

      if (!book) {
        log.warn(`Hyperliquid nSigFigs=${nSigFigs}: empty book for ${coin}`);
        continue;
      }

      const analysis = analyzeBook(book, 'hyperliquid', coin);
      lastSuccessfulAnalysis = analysis;

      // First successful analysis becomes the base (mid, spread, bestBid/Ask)
      if (!baseAnalysis) {
        baseAnalysis = { ...analysis };
        // Initialize all tiers from this first analysis
        for (let i = 0; i < tierCount; i++) {
          baseAnalysis.asks[i] = { ...analysis.asks[i] };
          baseAnalysis.bids[i] = { ...analysis.bids[i] };
        }
      }

      // Fill ask tiers progressively
      while (askCursor < tierCount && analysis.asks[askCursor].filled) {
        baseAnalysis!.asks[askCursor] = { ...analysis.asks[askCursor] };
        perTierSigFigs[askCursor] = nSigFigs;
        askCursor++;
      }

      // Fill bid tiers progressively
      while (bidCursor < tierCount && analysis.bids[bidCursor].filled) {
        baseAnalysis!.bids[bidCursor] = { ...analysis.bids[bidCursor] };
        perTierSigFigs[bidCursor] = nSigFigs;
        bidCursor++;
      }

      coarsestUsed = nSigFigs;

      log.debug(`Hyperliquid nSigFigs=${nSigFigs}: bidCursor=${bidCursor}, askCursor=${askCursor}`, {
        coin,
        nSigFigs,
        bidCursor,
        askCursor,
      });
    } catch (err) {
      log.warn(`Hyperliquid nSigFigs=${nSigFigs} failed for ${coin}: ${err}`);
    }
  }

  if (!baseAnalysis) {
    throw new Error(`Hyperliquid: all nSigFigs attempts failed for ${coin}`);
  }

  // For any remaining unfilled tiers, use the last successful analysis values
  if (lastSuccessfulAnalysis) {
    for (let i = askCursor; i < tierCount; i++) {
      if (perTierSigFigs[i] === 0) {
        baseAnalysis.asks[i] = { ...lastSuccessfulAnalysis.asks[i] };
        perTierSigFigs[i] = coarsestUsed;
      }
    }
    for (let i = bidCursor; i < tierCount; i++) {
      if (perTierSigFigs[i] === 0) {
        baseAnalysis.bids[i] = { ...lastSuccessfulAnalysis.bids[i] };
        perTierSigFigs[i] = coarsestUsed;
      }
    }
  }

  const isAggregated = coarsestUsed < HYPERLIQUID_SIG_FIGS_ORDER[0];

  baseAnalysis.isAggregatedEstimate = isAggregated;
  baseAnalysis.hyperliquidNSigFigs = coarsestUsed;
  baseAnalysis.hyperliquidNSigFigsPerTier = perTierSigFigs;

  return baseAnalysis;
}

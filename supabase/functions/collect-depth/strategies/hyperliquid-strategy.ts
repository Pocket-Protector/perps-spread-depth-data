import type { LiquidityAnalysis } from '../types.ts';
import { HYPERLIQUID_SIG_FIGS_ORDER, NOTIONAL_TIERS } from '../constants.ts';
import { fetchHyperliquid } from '../exchanges/hyperliquid.ts';
import { normalizeBook, analyzeBook } from '../slippage.ts';

export async function fetchHyperliquidAdaptive(
  coin: string,
  timeoutMs: number,
): Promise<LiquidityAnalysis> {
  let baseAnalysis: LiquidityAnalysis | null = null;
  let bidCursor = 0;
  let askCursor = 0;
  const tierCount = NOTIONAL_TIERS.length;
  const perTierSigFigs: number[] = new Array(tierCount).fill(0);
  let coarsestUsed: number = HYPERLIQUID_SIG_FIGS_ORDER[0];
  let lastSuccessfulAnalysis: LiquidityAnalysis | null = null;

  for (const nSigFigs of HYPERLIQUID_SIG_FIGS_ORDER) {
    if (bidCursor >= tierCount && askCursor >= tierCount) break;

    try {
      const rawBook = await fetchHyperliquid(coin, timeoutMs, nSigFigs);
      const book = normalizeBook(rawBook.bids, rawBook.asks, rawBook.timestamp);

      if (!book) {
        console.warn(`Hyperliquid nSigFigs=${nSigFigs}: empty book for ${coin}`);
        continue;
      }

      const analysis = analyzeBook(book, 'hyperliquid', coin);
      lastSuccessfulAnalysis = analysis;

      if (!baseAnalysis) {
        baseAnalysis = { ...analysis };
        for (let i = 0; i < tierCount; i++) {
          baseAnalysis.asks[i] = { ...analysis.asks[i] };
          baseAnalysis.bids[i] = { ...analysis.bids[i] };
        }
      }

      while (askCursor < tierCount && analysis.asks[askCursor].filled) {
        baseAnalysis!.asks[askCursor] = { ...analysis.asks[askCursor] };
        perTierSigFigs[askCursor] = nSigFigs;
        askCursor++;
      }

      while (bidCursor < tierCount && analysis.bids[bidCursor].filled) {
        baseAnalysis!.bids[bidCursor] = { ...analysis.bids[bidCursor] };
        perTierSigFigs[bidCursor] = nSigFigs;
        bidCursor++;
      }

      coarsestUsed = nSigFigs;
    } catch (err) {
      console.warn(`Hyperliquid nSigFigs=${nSigFigs} failed for ${coin}:`, err);
    }
  }

  if (!baseAnalysis) {
    throw new Error(`Hyperliquid: all nSigFigs attempts failed for ${coin}`);
  }

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

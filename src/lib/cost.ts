/** Aggregated Claude usage of a source's analyses (all runs, retries and correction rounds included). */
export type SourceCost = { calls: number; tokens: number; outputTokens: number; costUsd: number };

/** A montage's share of its source's analysis: one analysis yields every moment of the video. */
export function shareOf(cost: SourceCost, momentCount: number): SourceCost {
  const n = Math.max(1, momentCount);
  return {
    calls: cost.calls,
    tokens: Math.round(cost.tokens / n),
    outputTokens: Math.round(cost.outputTokens / n),
    costUsd: cost.costUsd / n,
  };
}

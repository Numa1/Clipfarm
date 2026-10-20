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

/**
 * Splits a source's analysis cost across its moments in proportion to `weights` (one entry per moment,
 * e.g. how many transcript words fall in each moment's range), instead of splitting it equally.
 *
 * Every field (calls/tokens/outputTokens/costUsd) is distributed so the shares sum back to exactly
 * `cost`: each share but the last is the rounded proportional amount, and the last share absorbs
 * whatever rounding difference remains, rather than being computed from its own weight. When every
 * weight is zero (e.g. no transcript word lands in any moment), falls back to an equal split.
 */
export function shareByWeight(cost: SourceCost, weights: number[]): SourceCost[] {
  const n = weights.length;
  if (n === 0) return [];

  const total = weights.reduce((a, b) => a + b, 0);
  const w = total > 0 ? weights : weights.map(() => 1);
  const sumW = total > 0 ? total : n;

  // Distributes one numeric field of `cost` proportionally to `w`, the last share taking whatever is
  // left so the parts always add back up to `value` exactly (no compounding rounding drift).
  const distribute = (value: number, round: boolean): number[] => {
    const shares: number[] = [];
    let remaining = value;
    for (let i = 0; i < n - 1; i++) {
      const raw = (w[i] / sumW) * value;
      const share = round ? Math.round(raw) : raw;
      shares.push(share);
      remaining -= share;
    }
    shares.push(round ? Math.round(remaining) : remaining);
    return shares;
  };

  const calls = distribute(cost.calls, true);
  const tokens = distribute(cost.tokens, true);
  const outputTokens = distribute(cost.outputTokens, true);
  const costUsd = distribute(cost.costUsd, false);

  return weights.map((_, i) => ({
    calls: calls[i],
    tokens: tokens[i],
    outputTokens: outputTokens[i],
    costUsd: costUsd[i],
  }));
}

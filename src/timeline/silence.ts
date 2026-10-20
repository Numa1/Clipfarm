/** A silence longer than this inside a moment is cut (seconds). */
export const MAX_SILENCE = 1.0;
/** Breathing room kept around speech at each cut (seconds). */
export const SPEECH_PAD = 0.25;

/**
 * Source ranges to keep from [start, end] so that the short has no dead air: every silence longer
 * than `maxSilence` between words is cut, keeping `pad` seconds of air on each side. Without any
 * word in range (music, pure gameplay), the whole segment is kept.
 */
export function speechRanges(
  words: { start: number; end: number }[],
  start: number,
  end: number,
  { maxSilence = MAX_SILENCE, pad = SPEECH_PAD } = {},
): [number, number][] {
  const runs: [number, number][] = [];
  for (const w of words) {
    if (w.end <= start || w.start >= end) continue;
    const a = Math.max(start, w.start);
    const b = Math.min(end, w.end);
    const last = runs[runs.length - 1];
    if (last && a - last[1] <= maxSilence) last[1] = Math.max(last[1], b);
    else runs.push([a, b]);
  }
  if (!runs.length) return [[start, end]];
  return runs.map(([a, b]) => [Math.max(start, a - pad), Math.min(end, b + pad)]);
}

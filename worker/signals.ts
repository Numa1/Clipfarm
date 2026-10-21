import { eq } from "drizzle-orm";
import type { DB } from "@/server/db";
import { sources, transcripts, type Source, type Word } from "@/server/db/schema";

/**
 * Signals cheap to compute from data already in base (no Claude call, no heavy processing):
 * speech rate, how much of the audio is the content's own voice (game, clip…) rather than the
 * creator's, the video's language, and its resolution. Used by the niche classifier (future task).
 */
export type BaseSignals = {
  /** Words per second spoken by the creator (vo !== true), null without a transcript or duration. */
  wordsPerSec: number | null;
  /** Share of transcribed words whose voice is the content's own (vo === true), null without words. */
  contentVoiceShare: number | null;
  lang: string | null;
  width: number | null;
  height: number | null;
  /** width / height, null when either dimension is missing or zero. */
  aspectRatio: number | null;
};

/** Pure core: computes the signals from data already fetched (easy to unit test). */
export function computeBaseSignals(source: Pick<Source, "lang" | "width" | "height">, words: Word[] | null): BaseSignals {
  const list = words ?? [];
  const contentWords = list.filter((w) => w.vo === true).length;
  const creatorWords = list.length - contentWords;
  const duration = list.length ? Math.max(...list.map((w) => w.end)) - Math.min(...list.map((w) => w.start)) : 0;
  const { lang, width, height } = source;
  return {
    wordsPerSec: list.length && duration > 0 ? creatorWords / duration : null,
    contentVoiceShare: list.length ? contentWords / list.length : null,
    lang: lang ?? null,
    width: width ?? null,
    height: height ?? null,
    aspectRatio: width && height ? width / height : null,
  };
}

/** Reads a source and its transcript from the DB and computes its base signals. */
export async function baseSignalsForSource(db: DB, sourceId: string): Promise<BaseSignals | null> {
  const source = db.select().from(sources).where(eq(sources.id, sourceId)).get();
  if (!source) return null;
  const transcript = db.select().from(transcripts).where(eq(transcripts.sourceId, sourceId)).get();
  return computeBaseSignals(source, transcript?.json.words ?? null);
}

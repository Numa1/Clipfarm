import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import type { DB } from "@/server/db";
import { sources, transcripts, type Word } from "@/server/db/schema";
import { resolveInLibrary, sourceDir } from "@/server/paths";
import { run } from "../exec";
import { detectSourceLanguage, detectVoices } from "../voices";

const WHISPER_BIN = process.env.WHISPER_BIN ?? "whisper-cli";
const WHISPER_MODEL =
  process.env.WHISPER_MODEL ?? path.join(process.cwd(), "models", "ggml-large-v3-turbo.bin");

type WhisperJson = {
  transcription: { offsets: { from: number; to: number }; text: string }[];
};

/** whisper-cli arguments for a word-level transcript in `lang` (-ml 1 -sow = one segment per word). */
export function transcribeArgs(model: string, audio: string, outBase: string, lang: string): string[] {
  return ["-m", model, "-f", audio, "-l", lang, "-ml", "1", "-sow", "-oj", "-of", outBase, "-pp"];
}

/** Word-level transcript with whisper.cpp, in the source's dominant language (detected up front). */
export async function transcribe(
  db: DB,
  payload: { sourceId: string },
  progress: (p: number) => void,
  signal?: AbortSignal,
) {
  const source = db.select().from(sources).where(eq(sources.id, payload.sourceId)).get();
  if (!source?.audioPath) throw new Error("source not ingested");
  const audio = resolveInLibrary(source.audioPath);
  if (!audio) throw new Error("audio missing");
  if (!fs.existsSync(WHISPER_MODEL)) {
    throw new Error(`Whisper model not found at ${WHISPER_MODEL}. Run: pnpm setup:whisper`);
  }

  // Whisper must be told the source language up front, or it auto-detects on the first seconds only
  // and translates the rest to that language instead of transcribing it (e.g. English under French).
  const lang = await detectSourceLanguage(audio, { signal });
  db.update(sources).set({ lang }).where(eq(sources.id, source.id)).run();
  signal?.throwIfAborted();

  const outBase = path.join(sourceDir(source.id), "transcript");
  await run(WHISPER_BIN, transcribeArgs(WHISPER_MODEL, audio, outBase, lang), {
    onStderr: (line) => {
      const m = /progress\s*=\s*(\d+)%/.exec(line);
      if (m) progress((0.85 * +m[1]) / 100);
    },
    signal,
  });
  signal?.throwIfAborted();

  const raw = JSON.parse(fs.readFileSync(`${outBase}.json`, "utf8")) as WhisperJson;
  const transcribed: Word[] = raw.transcription
    .map((s) => ({ w: s.text.trim(), start: s.offsets.from / 1000, end: s.offsets.to / 1000 }))
    .filter((w) => w.w.length > 0);
  // Creator or content (game, clip)? By the language actually spoken, which the forced-language text hides.
  const words = await detectVoices(audio, transcribed, lang, { signal, progress: (p) => progress(0.85 + 0.15 * p) });
  signal?.throwIfAborted();

  db.insert(transcripts)
    .values({ sourceId: source.id, language: lang, json: { language: lang, words } })
    .onConflictDoUpdate({ target: transcripts.sourceId, set: { json: { language: lang, words } } })
    .run();
  db.update(sources).set({ status: "analyzing" }).where(eq(sources.id, source.id)).run();

  return { words: words.length, contentWords: words.filter((w) => w.vo).length };
}

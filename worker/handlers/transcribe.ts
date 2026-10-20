import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import type { DB } from "@/server/db";
import { sources, transcripts, type Word } from "@/server/db/schema";
import { enqueueJob } from "@/server/jobs";
import { resolveInLibrary, sourceDir } from "@/server/paths";
import { run } from "../exec";

const WHISPER_BIN = process.env.WHISPER_BIN ?? "whisper-cli";
const WHISPER_MODEL =
  process.env.WHISPER_MODEL ?? path.join(process.cwd(), "models", "ggml-large-v3-turbo.bin");

type WhisperJson = {
  transcription: { offsets: { from: number; to: number }; text: string }[];
};

/** Word-level French transcript with whisper.cpp (-ml 1 -sow = one segment per word). */
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

  const outBase = path.join(sourceDir(source.id), "transcript");
  await run(
    WHISPER_BIN,
    ["-m", WHISPER_MODEL, "-f", audio, "-l", "fr", "-ml", "1", "-sow", "-oj", "-of", outBase, "-pp"],
    {
      onStderr: (line) => {
        const m = /progress\s*=\s*(\d+)%/.exec(line);
        if (m) progress(+m[1] / 100);
      },
      signal,
    },
  );
  signal?.throwIfAborted();

  const raw = JSON.parse(fs.readFileSync(`${outBase}.json`, "utf8")) as WhisperJson;
  const words: Word[] = raw.transcription
    .map((s) => ({ w: s.text.trim(), start: s.offsets.from / 1000, end: s.offsets.to / 1000 }))
    .filter((w) => w.w.length > 0);

  db.insert(transcripts)
    .values({ sourceId: source.id, language: "fr", json: { language: "fr", words } })
    .onConflictDoUpdate({ target: transcripts.sourceId, set: { json: { language: "fr", words } } })
    .run();
  db.update(sources).set({ status: "analyzing" }).where(eq(sources.id, source.id)).run();

  enqueueJob(db, "moments", { sourceId: source.id });
  return { words: words.length };
}

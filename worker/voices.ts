import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Word } from "@/server/db/schema";
import { run } from "./exec";

const WHISPER_BIN = process.env.WHISPER_BIN ?? "whisper-cli";
/** Small multilingual model, only used for language identification (~0.07 s per line vs ~1 s with large). */
export const LID_MODEL = process.env.WHISPER_LID_MODEL ?? path.join(process.cwd(), "models", "ggml-base.bin");

/** Lines shorter than this are too short to identify a language: they follow their neighbours. */
const MIN_LINE_SEC = 0.8;
/** A detection this sure defines the content's language. */
const SURE = 0.8;
/** A detection at least this sure labels its line. */
const LIKELY = 0.6;
/**
 * Content voices come in blocks (a cutscene is a dialogue). Shorter runs are the game commentary
 * heard under the creator during gameplay, which can outweigh a few short words of theirs.
 */
const MIN_CONTENT_RUN = 3;

export type Line = { start: number; end: number; words: Word[] };

/** Words grouped into lines: a sentence, or 12 s at most (the unit the moments prompt shows). */
export function transcriptLines(words: Word[]): Line[] {
  const lines: Line[] = [];
  let buf: Word[] = [];
  for (const w of words) {
    buf.push(w);
    if (/[.!?…]$/.test(w.w) || w.end - buf[0].start > 12) {
      lines.push({ start: buf[0].start, end: w.end, words: buf });
      buf = [];
    }
  }
  if (buf.length) lines.push({ start: buf[0].start, end: buf[buf.length - 1].end, words: buf });
  return lines;
}

export type Detection = { lang: string; p: number } | null;

/** Language detected for each input file, from `whisper-cli -dl` logs (files are processed in order). */
export function parseDetections(log: string): Map<string, { lang: string; p: number }> {
  const out = new Map<string, { lang: string; p: number }>();
  let file: string | null = null;
  for (const line of log.split("\n")) {
    const processing = /processing '([^']+)'/.exec(line);
    if (processing) file = processing[1];
    const detected = /auto-detected language: (\w+) \(p = ([\d.]+)\)/.exec(line);
    if (detected && file) out.set(file, { lang: detected[1], p: Number(detected[2]) });
  }
  return out;
}

/**
 * Who speaks each line: "content" (game, clip…) when its audio is in the content's language, "creator"
 * when it is in the video's language, null when undecided (the caller falls back to the text).
 * - The content's language is the most frequent other language among sure detections, so the random
 *   languages a short line can be mistaken for (zh, ko…) never count.
 * - Undecided lines take the voice of their neighbours when both agree.
 * - A run of content lines holding fewer than MIN_CONTENT_RUN detected ones is undecided.
 */
export function voiceLabels(dets: Detection[], sourceLang: string): ("creator" | "content" | null)[] {
  const counts = new Map<string, number>();
  for (const d of dets) if (d && d.p >= SURE && d.lang !== sourceLang) counts.set(d.lang, (counts.get(d.lang) ?? 0) + 1);
  const [contentLang] = [...counts].sort((a, b) => b[1] - a[1])[0] ?? [null];
  const labels = dets.map((d) =>
    !d || d.p < LIKELY ? null : d.lang === sourceLang ? "creator" : d.lang === contentLang ? "content" : null,
  );
  const filled = labels.map((l, i) => {
    if (l) return l;
    const prev = labels.slice(0, i).reverse().find(Boolean) ?? null;
    const next = labels.slice(i + 1).find(Boolean) ?? null;
    return prev && prev === next ? prev : null;
  });
  for (let i = 0; i < filled.length; ) {
    if (filled[i] !== "content") {
      i++;
      continue;
    }
    let j = i;
    while (j < filled.length && filled[j] === "content") j++;
    const detected = labels.slice(i, j).filter((l) => l === "content").length;
    if (detected < MIN_CONTENT_RUN) filled.fill(null, i, j);
    i = j;
  }
  return filled;
}

/** [start, end] seconds of a 16-bit PCM WAV file as a standalone WAV buffer. */
export function wavSlice(wav: Buffer, start: number, end: number): Buffer {
  let pos = 12;
  let fmt: { channels: number; rate: number; bits: number } | null = null;
  while (pos + 8 <= wav.length) {
    const id = wav.toString("ascii", pos, pos + 4);
    const size = wav.readUInt32LE(pos + 4);
    if (id === "fmt ") fmt = { channels: wav.readUInt16LE(pos + 10), rate: wav.readUInt32LE(pos + 12), bits: wav.readUInt16LE(pos + 22) };
    if (id === "data" && fmt) {
      const frame = (fmt.channels * fmt.bits) / 8;
      const data = pos + 8;
      const dataEnd = Math.min(wav.length, data + size);
      const from = Math.min(dataEnd, data + Math.max(0, Math.floor(start * fmt.rate)) * frame);
      const to = Math.min(dataEnd, data + Math.max(0, Math.floor(end * fmt.rate)) * frame);
      const header = Buffer.from(wav.subarray(0, 44));
      // Canonical 44-byte header rebuilt around the slice.
      header.write("RIFF", 0, "ascii");
      header.writeUInt32LE(36 + (to - from), 4);
      header.write("WAVEfmt ", 8, "ascii");
      header.writeUInt32LE(16, 16);
      header.writeUInt16LE(1, 20);
      header.writeUInt16LE(fmt.channels, 22);
      header.writeUInt32LE(fmt.rate, 24);
      header.writeUInt32LE(fmt.rate * frame, 28);
      header.writeUInt16LE(frame, 32);
      header.writeUInt16LE(fmt.bits, 34);
      header.write("data", 36, "ascii");
      header.writeUInt32LE(to - from, 40);
      return Buffer.concat([header, wav.subarray(from, to)]);
    }
    pos += 8 + size + (size % 2);
  }
  throw new Error("not a PCM WAV file");
}

/** Duration in seconds of a 16-bit PCM WAV file, read from its `fmt `/`data` chunks. */
export function wavDurationSec(wav: Buffer): number {
  let pos = 12;
  let rate: number | null = null;
  while (pos + 8 <= wav.length) {
    const id = wav.toString("ascii", pos, pos + 4);
    const size = wav.readUInt32LE(pos + 4);
    if (id === "fmt ") rate = wav.readUInt32LE(pos + 12);
    if (id === "data" && rate) {
      const dataEnd = Math.min(wav.length, pos + 8 + size);
      const samples = (dataEnd - (pos + 8)) / 2; // 16-bit mono LID samples
      return samples / rate;
    }
    pos += 8 + size + (size % 2);
  }
  throw new Error("not a PCM WAV file");
}

/**
 * A handful of short windows spread evenly across the audio, to sample its dominant language without
 * running LID on the whole file. Skips entirely when the audio is too short for even one full window.
 */
export function sampleWindows(durationSec: number, count = 5, windowSec = 5): { start: number; end: number }[] {
  if (durationSec < windowSec) return durationSec > 0 ? [{ start: 0, end: durationSec }] : [];
  const windows: { start: number; end: number }[] = [];
  for (let i = 0; i < count; i++) {
    const start = ((i + 0.5) / count) * (durationSec - windowSec);
    windows.push({ start, end: start + windowSec });
  }
  return windows;
}

/**
 * The dominant language among a set of detections: the most frequent language reaching SURE confidence,
 * then the single most confident detection, then `fallback` when nothing was detected at all (missing
 * model, silence-only samples…).
 */
export function dominantLanguage(dets: Detection[], fallback: string): string {
  const counts = new Map<string, number>();
  for (const d of dets) if (d && d.p >= SURE) counts.set(d.lang, (counts.get(d.lang) ?? 0) + 1);
  const [topLang] = [...counts].sort((a, b) => b[1] - a[1])[0] ?? [null];
  if (topLang) return topLang;
  const best = dets.filter((d): d is NonNullable<Detection> => !!d).sort((a, b) => b.p - a.p)[0];
  return best?.lang ?? fallback;
}

/**
 * Main spoken language of the whole source, detected on a handful of short samples spread across the
 * audio with the same small LID model used to tell voices apart (see `detectLanguages`). Needed before
 * transcription, since whisper must be told the source language up front (it otherwise auto-detects on
 * the first seconds only, and translates everything else to that language instead of transcribing it).
 * Falls back to `fallback` ("fr" by default) when the model is missing or nothing was confidently detected.
 */
export async function detectSourceLanguage(
  audioPath: string,
  opts: { signal?: AbortSignal; fallback?: string } = {},
): Promise<string> {
  const fallback = opts.fallback ?? "fr";
  if (!fs.existsSync(LID_MODEL)) {
    console.warn(`Language model missing at ${LID_MODEL} (pnpm setup:whisper): defaulting source language to ${fallback}.`);
    return fallback;
  }
  const wav = fs.readFileSync(audioPath);
  const windows = sampleWindows(wavDurationSec(wav));
  if (!windows.length) return fallback;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clipfarm-srclang-"));
  try {
    const files = windows.map((w, i) => {
      const file = path.join(dir, `${String(i).padStart(5, "0")}.wav`);
      fs.writeFileSync(file, wavSlice(wav, w.start, w.end));
      return file;
    });
    let log = "";
    await run(WHISPER_BIN, ["-m", LID_MODEL, "-dl", ...files.flatMap((f) => ["-f", f])], {
      signal: opts.signal,
      onStderr: (line) => {
        log += `${line}\n`;
      },
    });
    const found = parseDetections(log);
    return dominantLanguage(
      files.map((f) => found.get(f) ?? null),
      fallback,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Spoken language of each line (null when too short or undetected), in one whisper run on a small model. */
export async function detectLanguages(
  audioPath: string,
  lines: Line[],
  opts: { signal?: AbortSignal; progress?: (p: number) => void } = {},
): Promise<Detection[]> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clipfarm-lid-"));
  try {
    const wav = fs.readFileSync(audioPath);
    const files = lines.map((l, i) => {
      if (l.end - l.start < MIN_LINE_SEC) return null;
      const file = path.join(dir, `${String(i).padStart(5, "0")}.wav`);
      fs.writeFileSync(file, wavSlice(wav, l.start, l.end));
      return file;
    });
    const inputs = files.filter((f): f is string => !!f);
    let log = "";
    let done = 0;
    if (inputs.length) {
      await run(WHISPER_BIN, ["-m", LID_MODEL, "-dl", ...inputs.flatMap((f) => ["-f", f])], {
        signal: opts.signal,
        onStderr: (line) => {
          log += `${line}\n`;
          if (line.includes("auto-detected language")) opts.progress?.(++done / inputs.length);
        },
      });
    }
    const found = parseDetections(log);
    return files.map((f) => (f && found.get(f)) || null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Tell the creator's voice from the content's (game cutscenes, watched clips) by the language actually
 * spoken: whisper is forced to the video's language for the transcript and translates foreign speech,
 * so the text alone cannot. Returns the words with `vo` set where decided; unchanged without the model.
 */
export async function detectVoices(
  audioPath: string,
  words: Word[],
  sourceLang: string,
  opts: { signal?: AbortSignal; progress?: (p: number) => void } = {},
): Promise<Word[]> {
  if (!fs.existsSync(LID_MODEL)) {
    console.warn(`Language model missing at ${LID_MODEL} (pnpm setup:whisper): content voices told by text only.`);
    return words;
  }
  const lines = transcriptLines(words);
  const labels = voiceLabels(await detectLanguages(audioPath, lines, opts), sourceLang);
  return lines.flatMap((l, i) => l.words.map((w) => (labels[i] ? { ...w, vo: labels[i] === "content" } : w)));
}

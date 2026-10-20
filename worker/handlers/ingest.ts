import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import type { DB } from "@/server/db";
import { sources } from "@/server/db/schema";
import { rel, resolveInLibrary, sourceDir } from "@/server/paths";
import { run } from "../exec";

type Probe = { streams: { codec_type: string; width?: number; height?: number }[]; format: { duration: string } };

/** ffprobe + 540p proxy for the editor + 16 kHz mono wav for Whisper. */
export async function ingest(
  db: DB,
  payload: { sourceId: string },
  progress: (p: number) => void,
  signal?: AbortSignal,
) {
  const source = db.select().from(sources).where(eq(sources.id, payload.sourceId)).get();
  if (!source) throw new Error(`source ${payload.sourceId} not found`);
  db.update(sources).set({ status: "ingesting", error: null }).where(eq(sources.id, source.id)).run();

  const input = resolveInLibrary(source.originalPath);
  if (!input || !fs.existsSync(input)) throw new Error("original file missing");
  const dir = sourceDir(source.id);

  const probe = JSON.parse(
    await run("ffprobe", ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", input], { signal }),
  ) as Probe;
  const video = probe.streams.find((s) => s.codec_type === "video");
  const durationSec = Number(probe.format.duration);
  if (!video || !Number.isFinite(durationSec)) throw new Error("no video stream");

  const proxy = path.join(dir, "proxy.mp4");
  const audio = path.join(dir, "audio.wav");
  const onStderr = (line: string) => {
    const m = /time=(\d+):(\d+):(\d+\.\d+)/.exec(line);
    if (m) progress((+m[1] * 3600 + +m[2] * 60 + +m[3]) / durationSec);
  };

  // Proxy: 540p H.264 with dense keyframes → fast scrubbing in the browser.
  const encodeSoftware = () =>
    run("ffmpeg", ["-y", "-i", input, "-vf", "scale=-2:540", "-c:v", "libx264", "-preset", "veryfast", "-crf", "26",
      "-g", "30", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", proxy], { onStderr, signal });

  await run(
    "ffmpeg",
    ["-y", "-i", input, "-vf", "scale=-2:540", "-c:v", "h264_videotoolbox", "-b:v", "2M", "-g", "30",
      "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", proxy],
    { onStderr, signal },
  ).catch(encodeSoftware); // Fallback when the hardware encoder is unavailable.

  // The hardware encoder can exit 0 while still emitting a malformed H.264 stream
  // (invalid NAL units) under memory/GPU pressure, so re-decode the result to check.
  // `-v error` means any stderr line is a real decode error, regardless of exit code.
  let decodeErrored = false;
  await run("ffmpeg", ["-v", "error", "-i", proxy, "-f", "null", "-"], {
    onStderr: () => (decodeErrored = true),
    signal,
  }).catch(() => (decodeErrored = true));
  if (decodeErrored) await encodeSoftware();
  await run("ffmpeg", ["-y", "-i", input, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", audio], { signal });
  signal?.throwIfAborted();

  db.update(sources)
    .set({
      proxyPath: rel(proxy),
      audioPath: rel(audio),
      durationSec,
      width: video.width,
      height: video.height,
      status: "transcribing",
    })
    .where(eq(sources.id, source.id))
    .run();

  return { durationSec };
}

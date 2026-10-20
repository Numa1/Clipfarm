import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/server/db";
import { projects, sources, transcripts, type Word } from "@/server/db/schema";
import { resolveInLibrary } from "@/server/paths";
import { parseTimeline, shotSchema, type Shot } from "@/timeline/schema";
import { run } from "../exec";

const SCRIPT = path.join(process.cwd(), "scripts", "reframe.py");
const MODELS_DIR = path.join(process.cwd(), "models");
export const REFRAME_MODELS = ["face_detection_yunet_2023mar.onnx", "face_recognition_sface_2021dec.onnx"];

/** Why automatic framing cannot run on this machine, or null when it can. */
export function reframeSetupProblem(): string | null {
  const missing = REFRAME_MODELS.filter((m) => !fs.existsSync(path.join(MODELS_DIR, m)));
  if (missing.length) return `Modèles de cadrage manquants (${missing.join(", ")}). Lance : pnpm setup:models`;
  return null;
}

/** Merge word timings into speech intervals (gaps < 0.6 s are the same utterance). */
export function speechIntervals(words: Word[], from: number, to: number): [number, number][] {
  const out: [number, number][] = [];
  for (const w of words) {
    if (w.end < from || w.start > to) continue;
    const last = out[out.length - 1];
    if (last && w.start - last[1] < 0.6) last[1] = Math.max(last[1], w.end);
    else out.push([w.start, w.end]);
  }
  return out;
}

/**
 * Compute automatic shots (crop / split / fit) for the targeted video clips, or every clip in auto
 * mode when `itemIds` is omitted. Clips framed "center" or "manual" by the user are never touched.
 */
export async function reframe(
  db: DB,
  payload: { projectId: string; itemIds?: string[] },
  progress: (p: number) => void,
  signal?: AbortSignal,
) {
  const problem = reframeSetupProblem();
  if (problem) throw new Error(problem);
  const project = db.select().from(projects).where(eq(projects.id, payload.projectId)).get();
  if (!project) throw new Error("project not found");
  const timeline = parseTimeline(project.timeline);

  const wanted = (id: string, mode: string) => (payload.itemIds ? payload.itemIds.includes(id) : mode === "auto");
  const clips = timeline.tracks
    .flatMap((t) => t.items)
    .filter((i) => i.type === "video" && wanted(i.id, i.crop.mode));
  const updates = new Map<string, Shot[]>();
  let done = 0;
  for (const clip of clips) {
    if (clip.type !== "video") continue;
    const asset = timeline.assets[clip.assetId];
    const source = asset && db.select().from(sources).where(eq(sources.id, asset.id)).get();
    const file = source?.proxyPath && resolveInLibrary(source.proxyPath);
    if (!source || !file) continue;
    const tr = db.select().from(transcripts).where(eq(transcripts.sourceId, source.id)).get();
    const speech = tr ? speechIntervals(tr.json.words, clip.sourceIn, clip.sourceOut) : [];
    const args = ["run", "--quiet", SCRIPT, file, String(clip.sourceIn), String(clip.sourceOut)];
    // The render uses the original file: lets the script avoid over-magnifying low-res sources.
    if (asset.height) args.push("--src-height", String(asset.height));
    const out = await run("uv", args, { input: JSON.stringify(speech), signal }).catch((e: Error) => {
      if (/ENOENT/.test(e.message)) throw new Error("uv est introuvable : installe-le (https://docs.astral.sh/uv/) pour le cadrage auto.");
      throw e;
    });
    updates.set(clip.id, z.array(shotSchema).min(1).parse(JSON.parse(out)));
    progress(++done / clips.length);
  }

  signal?.throwIfAborted();
  // Re-read: the user may have edited the timeline while we were computing. Only clips still in
  // auto mode receive the result (a clip switched to center/manual meanwhile keeps that choice).
  const fresh = db.select().from(projects).where(eq(projects.id, payload.projectId)).get();
  if (!fresh) return {};
  const tl = parseTimeline(fresh.timeline);
  for (const track of tl.tracks) {
    for (const item of track.items) {
      const shots = item.type === "video" && item.crop.mode === "auto" && updates.get(item.id);
      if (item.type === "video" && shots) item.crop = { mode: "auto", keyframes: [], shots };
    }
  }
  db.update(projects).set({ timeline: tl, updatedAt: new Date() }).where(eq(projects.id, fresh.id)).run();
  return { clips: updates.size, shots: [...updates.values()].reduce((n, s) => n + s.length, 0) };
}

import path from "node:path";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/server/db";
import { projects, sources, transcripts, type Word } from "@/server/db/schema";
import { resolveInLibrary } from "@/server/paths";
import { parseTimeline, shotSchema, type Shot } from "@/timeline/schema";
import { run } from "../exec";

const SCRIPT = path.join(process.cwd(), "scripts", "reframe.py");

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

/** Compute automatic shots (crop / split / fit) for every video clip of a project not framed manually. */
export async function reframe(db: DB, payload: { projectId: string }, progress: (p: number) => void) {
  const project = db.select().from(projects).where(eq(projects.id, payload.projectId)).get();
  if (!project) throw new Error("project not found");
  const timeline = parseTimeline(project.timeline);

  const clips = timeline.tracks.flatMap((t) => t.items).filter((i) => i.type === "video" && i.crop.mode !== "manual");
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
    const out = await run("uv", ["run", "--quiet", SCRIPT, file, String(clip.sourceIn), String(clip.sourceOut)], {
      input: JSON.stringify(speech),
    });
    updates.set(clip.id, z.array(shotSchema).min(1).parse(JSON.parse(out)));
    progress(++done / clips.length);
  }

  // Re-read: the user may have edited the timeline while we were computing.
  const fresh = db.select().from(projects).where(eq(projects.id, payload.projectId)).get();
  if (!fresh) return {};
  const tl = parseTimeline(fresh.timeline);
  for (const track of tl.tracks) {
    for (const item of track.items) {
      const shots = item.type === "video" && item.crop.mode !== "manual" && updates.get(item.id);
      if (item.type === "video" && shots) item.crop = { mode: "auto", keyframes: [], shots };
    }
  }
  db.update(projects).set({ timeline: tl, updatedAt: new Date() }).where(eq(projects.id, fresh.id)).run();
  return { clips: updates.size, shots: [...updates.values()].reduce((n, s) => n + s.length, 0) };
}

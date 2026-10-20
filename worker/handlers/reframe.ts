import path from "node:path";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/server/db";
import { projects, sources } from "@/server/db/schema";
import { resolveInLibrary } from "@/server/paths";
import { cropKeyframeSchema, parseTimeline } from "@/timeline/schema";
import { run } from "../exec";

const SCRIPT = path.join(process.cwd(), "scripts", "reframe.py");

/** Compute auto-crop keyframes for every video clip of a project that is still in "center"/"auto" mode. */
export async function reframe(db: DB, payload: { projectId: string }, progress: (p: number) => void) {
  const project = db.select().from(projects).where(eq(projects.id, payload.projectId)).get();
  if (!project) throw new Error("project not found");
  const timeline = parseTimeline(project.timeline);

  const clips = timeline.tracks.flatMap((t) => t.items).filter((i) => i.type === "video" && i.crop.mode !== "manual");
  const updates = new Map<string, z.infer<typeof cropKeyframeSchema>[]>();
  let done = 0;
  for (const clip of clips) {
    if (clip.type !== "video") continue;
    const asset = timeline.assets[clip.assetId];
    const source = asset && db.select().from(sources).where(eq(sources.id, asset.id)).get();
    const file = source?.proxyPath && resolveInLibrary(source.proxyPath);
    if (!file) continue;
    const out = await run("uv", ["run", "--quiet", SCRIPT, file, String(clip.sourceIn), String(clip.sourceOut)]);
    updates.set(clip.id, z.array(cropKeyframeSchema).parse(JSON.parse(out)));
    progress(++done / clips.length);
  }

  // Re-read: the user may have edited the timeline while we were computing.
  const fresh = db.select().from(projects).where(eq(projects.id, payload.projectId)).get();
  if (!fresh) return {};
  const tl = parseTimeline(fresh.timeline);
  for (const track of tl.tracks) {
    for (const item of track.items) {
      const kfs = item.type === "video" && item.crop.mode !== "manual" && updates.get(item.id);
      if (item.type === "video" && kfs) item.crop = { mode: "auto", keyframes: kfs };
    }
  }
  db.update(projects).set({ timeline: tl, updatedAt: new Date() }).where(eq(projects.id, fresh.id)).run();
  return { clips: updates.size };
}

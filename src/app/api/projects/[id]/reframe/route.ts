import { eq } from "drizzle-orm";
import { getDb } from "@/server/db";
import { projects } from "@/server/db/schema";
import { enqueueJob } from "@/server/jobs";
import { parseTimeline } from "@/timeline/schema";

/** Recompute the automatic framing: every clip not framed manually goes back to auto. */
export async function POST(_req: Request, ctx: RouteContext<"/api/projects/[id]/reframe">) {
  const { id } = await ctx.params;
  const db = getDb();
  const project = db.select().from(projects).where(eq(projects.id, id)).get();
  if (!project) return Response.json({ error: "not found" }, { status: 404 });
  const timeline = parseTimeline(project.timeline);
  for (const track of timeline.tracks)
    for (const item of track.items)
      if (item.type === "video" && item.crop.mode === "center") item.crop = { mode: "auto", keyframes: [] };
  db.update(projects).set({ timeline, updatedAt: new Date() }).where(eq(projects.id, id)).run();
  const job = enqueueJob(db, "reframe", { projectId: id });
  return Response.json(job, { status: 202 });
}

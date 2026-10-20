import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/server/db";
import { projects } from "@/server/db/schema";
import { enqueueJob } from "@/server/jobs";
import { parseTimeline } from "@/timeline/schema";

const bodySchema = z.object({ itemIds: z.array(z.string()).min(1).optional() }).default({});

/**
 * Recompute the automatic framing of some video clips (all auto clips when `itemIds` is omitted).
 * Targeted clips go back to auto; clips framed "center" or "manual" by the user are left alone.
 */
export async function POST(req: Request, ctx: RouteContext<"/api/projects/[id]/reframe">) {
  const { id } = await ctx.params;
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: parsed.error.message }, { status: 400 });
  const { itemIds } = parsed.data;

  const db = getDb();
  const project = db.select().from(projects).where(eq(projects.id, id)).get();
  if (!project) return Response.json({ error: "not found" }, { status: 404 });
  if (itemIds) {
    const timeline = parseTimeline(project.timeline);
    for (const track of timeline.tracks)
      for (const item of track.items)
        if (item.type === "video" && itemIds.includes(item.id)) item.crop = { mode: "auto", keyframes: [] };
    db.update(projects).set({ timeline, updatedAt: new Date() }).where(eq(projects.id, id)).run();
  }
  const job = enqueueJob(db, "reframe", { projectId: id, ...(itemIds && { itemIds }) });
  return Response.json(job, { status: 202 });
}

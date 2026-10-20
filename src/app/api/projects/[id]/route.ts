import { and, desc, eq, inArray, like } from "drizzle-orm";
import { z } from "zod";
import { route } from "@/server/api";
import { getDb } from "@/server/db";
import { jobs, projects } from "@/server/db/schema";
import { writeTimeline } from "@/server/timeline-store";
import { timelineSchema } from "@/timeline/schema";

export async function GET(_req: Request, ctx: RouteContext<"/api/projects/[id]">) {
  const { id } = await ctx.params;
  const db = getDb();
  const project = db.select().from(projects).where(eq(projects.id, id)).get();
  if (!project) return Response.json({ error: "not found" }, { status: 404 });
  const activeJobs = db
    .select()
    .from(jobs)
    .where(and(inArray(jobs.status, ["queued", "running"]), like(jobs.payload, `%"projectId":"${id}"%`)))
    .orderBy(desc(jobs.createdAt))
    .all();
  return Response.json({ ...project, activeJobs });
}

const putBodySchema = z.object({
  timeline: timelineSchema,
  name: z.string().min(1).optional(),
  /** Revision the caller built this timeline on top of (optimistic lock, see `timeline-store.ts`). */
  baseRevision: z.number().int().nonnegative(),
  /** Who is writing: omit for a normal human request; "agent"/"system" for other callers. */
  actor: z.enum(["agent", "system"]).optional(),
  actorId: z.string().optional(),
});

/**
 * Save the timeline (validated against the schema so agents and humans can't write garbage).
 * Requires `baseRevision`: a write whose base no longer matches the project's current revision is
 * refused with a 409 conflict instead of silently overwriting someone else's change.
 */
export const PUT = route({ path: "/api/projects/[id]", body: putBodySchema }, ({ body, params: { id } }) => {
  const result = writeTimeline(getDb(), {
    projectId: id,
    baseRevision: body.baseRevision,
    timeline: body.timeline,
    actor: body.actor ?? "human",
    actorId: body.actorId,
    ...(body.name ? { name: body.name } : {}),
  });
  return Response.json(result);
});

export async function DELETE(_req: Request, ctx: RouteContext<"/api/projects/[id]">) {
  const { id } = await ctx.params;
  getDb().delete(projects).where(eq(projects.id, id)).run();
  return new Response(null, { status: 204 });
}

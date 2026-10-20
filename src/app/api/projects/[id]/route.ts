import { and, desc, eq, inArray, like } from "drizzle-orm";
import { getDb } from "@/server/db";
import { jobs, projects } from "@/server/db/schema";
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

/** Save the timeline (validated against the schema so agents and humans can't write garbage). */
export async function PUT(request: Request, ctx: RouteContext<"/api/projects/[id]">) {
  const { id } = await ctx.params;
  const body = (await request.json()) as { timeline?: unknown; name?: string };
  const parsed = timelineSchema.safeParse(body.timeline);
  if (!parsed.success) return Response.json({ error: parsed.error.issues }, { status: 422 });
  const row = getDb()
    .update(projects)
    .set({ timeline: parsed.data, ...(body.name ? { name: body.name } : {}), updatedAt: new Date() })
    .where(eq(projects.id, id))
    .returning({ id: projects.id, updatedAt: projects.updatedAt })
    .get();
  if (!row) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json(row);
}

export async function DELETE(_req: Request, ctx: RouteContext<"/api/projects/[id]">) {
  const { id } = await ctx.params;
  getDb().delete(projects).where(eq(projects.id, id)).run();
  return new Response(null, { status: 204 });
}

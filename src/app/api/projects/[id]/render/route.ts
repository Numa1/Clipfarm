import { eq } from "drizzle-orm";
import { getDb } from "@/server/db";
import { projects } from "@/server/db/schema";
import { enqueueJob } from "@/server/jobs";

export async function POST(_req: Request, ctx: RouteContext<"/api/projects/[id]/render">) {
  const { id } = await ctx.params;
  const db = getDb();
  const project = db.select({ id: projects.id }).from(projects).where(eq(projects.id, id)).get();
  if (!project) return Response.json({ error: "not found" }, { status: 404 });
  const job = enqueueJob(db, "render", { projectId: id });
  return Response.json(job, { status: 202 });
}

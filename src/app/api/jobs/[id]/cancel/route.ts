import { eq } from "drizzle-orm";
import { getDb } from "@/server/db";
import { jobs } from "@/server/db/schema";
import { cancelJob } from "@/server/jobs";

/** Cancel a queued or running job (the worker stops a running one within a second). */
export async function POST(_req: Request, ctx: RouteContext<"/api/jobs/[id]/cancel">) {
  const { id } = await ctx.params;
  const db = getDb();
  const job = cancelJob(db, id);
  if (job) return Response.json(job);
  const existing = db.select().from(jobs).where(eq(jobs.id, id)).get();
  if (!existing) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json({ error: `job already ${existing.status}` }, { status: 409 });
}

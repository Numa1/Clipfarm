import { eq } from "drizzle-orm";
import { getDb } from "@/server/db";
import { jobs } from "@/server/db/schema";

export async function GET(_req: Request, ctx: RouteContext<"/api/jobs/[id]">) {
  const { id } = await ctx.params;
  const job = getDb().select().from(jobs).where(eq(jobs.id, id)).get();
  if (!job) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json(job);
}

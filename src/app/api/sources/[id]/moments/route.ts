import { and, eq, inArray, like } from "drizzle-orm";
import { getDb } from "@/server/db";
import { jobs, sources, transcripts } from "@/server/db/schema";
import { enqueueJob } from "@/server/jobs";

/** Search the moments again (after a prompt change or once the creator's name is set). */
export async function POST(_req: Request, ctx: RouteContext<"/api/sources/[id]/moments">) {
  const { id } = await ctx.params;
  const db = getDb();
  const source = db.select().from(sources).where(eq(sources.id, id)).get();
  if (!source) return Response.json({ error: "not found" }, { status: 404 });
  const busy = db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(inArray(jobs.status, ["queued", "running"]), like(jobs.payload, `%"sourceId":"${id}"%`)))
    .get();
  if (busy) return Response.json({ error: "a job is already running for this source" }, { status: 409 });
  const tr = db.select({ id: transcripts.sourceId }).from(transcripts).where(eq(transcripts.sourceId, id)).get();
  if (!tr) return Response.json({ error: "source not transcribed yet" }, { status: 409 });
  db.update(sources).set({ status: "analyzing", error: null }).where(eq(sources.id, id)).run();
  return Response.json(enqueueJob(db, "moments", { sourceId: id }), { status: 202 });
}

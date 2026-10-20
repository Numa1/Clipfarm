import fs from "node:fs";
import { z } from "zod";
import { desc, eq, like } from "drizzle-orm";
import { getDb } from "@/server/db";
import { jobs, moments, sources } from "@/server/db/schema";
import { activeJobsFor, cancelSourceJobs } from "@/server/jobs";
import { sourceDir } from "@/server/paths";

export async function GET(_req: Request, ctx: RouteContext<"/api/sources/[id]">) {
  const { id } = await ctx.params;
  const db = getDb();
  const source = db.select().from(sources).where(eq(sources.id, id)).get();
  if (!source) return Response.json({ error: "not found" }, { status: 404 });
  const list = db.select().from(moments).where(eq(moments.sourceId, id)).orderBy(desc(moments.score)).all();
  const activeJob = activeJobsFor(db, { sourceId: id }).at(-1) ?? null;
  // Most recent job of the pipeline: when it failed or was cancelled, the UI offers a retry.
  const lastJob =
    db
      .select()
      .from(jobs)
      .where(like(jobs.payload, `%"sourceId":"${id}"%`))
      .orderBy(desc(jobs.createdAt))
      .get() ?? null;
  return Response.json({ ...source, moments: list, activeJob, lastJob });
}

const patchSchema = z.object({ creator: z.string().trim().max(80).nullable() });

/** Edit source details (the creator's name feeds the generated titles). */
export async function PATCH(request: Request, ctx: RouteContext<"/api/sources/[id]">) {
  const { id } = await ctx.params;
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.message }, { status: 400 });
  const row = getDb()
    .update(sources)
    .set({ creator: parsed.data.creator || null })
    .where(eq(sources.id, id))
    .returning()
    .get();
  if (!row) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json(row);
}

export async function DELETE(_req: Request, ctx: RouteContext<"/api/sources/[id]">) {
  const { id } = await ctx.params;
  const db = getDb();
  // Stop its pipeline first: a running job would otherwise fail on the deleted files.
  cancelSourceJobs(db, id);
  db.delete(sources).where(eq(sources.id, id)).run();
  fs.rmSync(sourceDir(id), { recursive: true, force: true });
  return new Response(null, { status: 204 });
}

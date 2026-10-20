import fs from "node:fs";
import { and, desc, eq, inArray, like } from "drizzle-orm";
import { getDb } from "@/server/db";
import { jobs, moments, sources } from "@/server/db/schema";
import { sourceDir } from "@/server/paths";

export async function GET(_req: Request, ctx: RouteContext<"/api/sources/[id]">) {
  const { id } = await ctx.params;
  const db = getDb();
  const source = db.select().from(sources).where(eq(sources.id, id)).get();
  if (!source) return Response.json({ error: "not found" }, { status: 404 });
  const list = db.select().from(moments).where(eq(moments.sourceId, id)).orderBy(desc(moments.score)).all();
  const job = db
    .select()
    .from(jobs)
    .where(and(inArray(jobs.status, ["queued", "running"]), like(jobs.payload, `%"sourceId":"${id}"%`)))
    .get();
  return Response.json({ ...source, moments: list, activeJob: job ?? null });
}

export async function DELETE(_req: Request, ctx: RouteContext<"/api/sources/[id]">) {
  const { id } = await ctx.params;
  getDb().delete(sources).where(eq(sources.id, id)).run();
  fs.rmSync(sourceDir(id), { recursive: true, force: true });
  return new Response(null, { status: 204 });
}

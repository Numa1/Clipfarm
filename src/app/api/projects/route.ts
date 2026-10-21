import { desc, eq, sql } from "drizzle-orm";
import { connection } from "next/server";
import { z } from "zod";
import { httpError, route } from "@/server/api";
import { getDb } from "@/server/db";
import { costSelect, shareOf, toCost } from "@/server/costs";
import { projects, sources } from "@/server/db/schema";
import { createProject } from "@/server/projects";

export const GET = route({}, async () => {
  await connection();
  const rows = getDb()
    .select({
      id: projects.id,
      name: projects.name,
      updatedAt: projects.updatedAt,
      lastExportPath: projects.lastExportPath,
      sourceId: projects.sourceId,
      sourceTitle: sources.title,
      momentCount: sql<number>`(select count(*) from "moments" where "moments"."source_id" = "projects"."source_id")`,
      ...costSelect(`"projects"."source_id"`),
    })
    .from(projects)
    .leftJoin(sources, eq(sources.id, projects.sourceId))
    .orderBy(desc(projects.updatedAt))
    .all();
  // A montage's cost is its share of the source's analysis (one analysis yields all its moments).
  return Response.json(
    rows.map(({ momentCount, costCalls, costTokens, costOutputTokens, costUsd, ...p }) => ({
      ...p,
      cost: p.sourceId ? shareOf(toCost({ costCalls, costTokens, costOutputTokens, costUsd }), momentCount) : null,
    })),
  );
});

const createSchema = z.union([
  z.object({ momentId: z.string() }),
  z.object({ sourceId: z.string(), start: z.number(), end: z.number(), hook: z.string().optional() }),
]);

/** Create a project pre-cut on a suggested moment (or an arbitrary segment), then queue auto-reframe. */
export const POST = route({ body: createSchema, idempotent: true }, ({ body }) => {
  const res = createProject(getDb(), body);
  if ("error" in res) throw httpError(res.status, res.error);
  return Response.json({ id: res.project.id }, { status: 201 });
});

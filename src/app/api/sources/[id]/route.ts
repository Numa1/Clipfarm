import fs from "node:fs";
import { z } from "zod";
import { desc, eq, like } from "drizzle-orm";
import { isNicheId, NICHE_IDS } from "@/config/niches";
import { HttpError, route } from "@/server/api";
import { getDb } from "@/server/db";
import { costSelect, toCost } from "@/server/costs";
import { jobs, moments, projects, sources } from "@/server/db/schema";
import { activeJobsFor, cancelSourceJobs } from "@/server/jobs";
import { sourceDir } from "@/server/paths";
import { parseTimeline } from "@/timeline/schema";

export const GET = route({ path: "/api/sources/[id]" }, ({ params: { id } }) => {
  const db = getDb();
  const source = db.select().from(sources).where(eq(sources.id, id)).get();
  if (!source) throw new HttpError(404, "not_found", "not found");
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
  const montages = db
    .select({
      id: projects.id,
      name: projects.name,
      momentId: projects.momentId,
      updatedAt: projects.updatedAt,
      lastExportPath: projects.lastExportPath,
      timeline: projects.timeline,
    })
    .from(projects)
    .where(eq(projects.sourceId, id))
    .orderBy(desc(projects.updatedAt))
    .all()
    .map(({ timeline, ...p }) => ({ ...p, preview: firstClip(timeline) }));
  const cost = toCost(db.select(costSelect(`"sources"."id"`)).from(sources).where(eq(sources.id, id)).get()!);
  return Response.json({ ...source, moments: list, projects: montages, cost, activeJob, lastJob });
});

/** Source range of a montage's first video clip, to preview a draft from the source video. */
function firstClip(timeline: unknown): { start: number; end: number } | null {
  try {
    const clip = parseTimeline(timeline)
      .tracks.flatMap((t) => t.items)
      .filter((i) => i.type === "video")
      .sort((a, b) => a.start - b.start)[0];
    return clip ? { start: clip.sourceIn, end: clip.sourceOut } : null;
  } catch {
    return null;
  }
}

const patchSchema = z
  .object({
    creator: z.string().trim().max(80).nullable().optional(),
    /** Correction manuelle de niche : force nicheSource à "manual" (jamais écrasée par le job "niche"). */
    niche: z
      .string()
      .refine(isNicheId, { message: `niche invalide (attendu : ${NICHE_IDS.join(", ")})` })
      .optional(),
  })
  .refine((b) => b.creator !== undefined || b.niche !== undefined, { message: "creator ou niche requis" });

/**
 * Edit source details : le nom du créateur (alimente les titres générés) et/ou une correction
 * manuelle de niche. Une niche posée ici force nicheSource = "manual" et nicheConfidence = 1 : le
 * handler "niche" (worker/handlers/niche.ts) ne l'écrasera plus jamais automatiquement.
 */
export const PATCH = route({ path: "/api/sources/[id]", body: patchSchema, validationStatus: 400 }, ({ body, params: { id } }) => {
  const set: Partial<typeof sources.$inferInsert> = {};
  if (body.creator !== undefined) set.creator = body.creator || null;
  if (body.niche !== undefined) {
    set.niche = body.niche;
    set.nicheSource = "manual";
    set.nicheConfidence = 1;
  }
  const row = getDb().update(sources).set(set).where(eq(sources.id, id)).returning().get();
  if (!row) throw new HttpError(404, "not_found", "not found");
  return Response.json(row);
});

export const DELETE = route({ path: "/api/sources/[id]" }, ({ params: { id } }) => {
  const db = getDb();
  // Stop its pipeline first: a running job would otherwise fail on the deleted files.
  cancelSourceJobs(db, id);
  db.delete(sources).where(eq(sources.id, id)).run();
  fs.rmSync(sourceDir(id), { recursive: true, force: true });
  return new Response(null, { status: 204 });
});

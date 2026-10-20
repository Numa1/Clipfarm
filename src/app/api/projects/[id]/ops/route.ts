import { eq } from "drizzle-orm";
import { z } from "zod";
import { HttpError, route } from "@/server/api";
import { getDb } from "@/server/db";
import { projects } from "@/server/db/schema";
import { writeTimeline } from "@/server/timeline-store";
import { applyCommands, commandSchema } from "@/timeline/commands";
import { parseTimeline, timelineSchema } from "@/timeline/schema";

const bodySchema = z.object({
  commands: z.array(commandSchema).min(1),
  /** Revision the caller built these commands on top of (optimistic lock, see `timeline-store.ts`). */
  baseRevision: z.number().int().nonnegative(),
  /** Who is writing: omit for a normal human request; "agent"/"system" for other callers. */
  actor: z.enum(["agent", "system"]).optional(),
  actorId: z.string().optional(),
});

/**
 * Apply one or more serialized commands (`timeline/commands.ts`) to the project's current timeline
 * and save the result through `timeline-store.ts`, guarded by `baseRevision`. The caller may also
 * mark itself as "agent" via the body (or the `x-clipfarm-actor` header), defaulting to "human".
 */
export const POST = route({ path: "/api/projects/[id]/ops", body: bodySchema }, ({ body, request, params: { id } }) => {
  const db = getDb();
  const project = db.select({ id: projects.id, timeline: projects.timeline }).from(projects).where(eq(projects.id, id)).get();
  if (!project) throw new HttpError(404, "not_found", "not found");

  const current = parseTimeline(project.timeline);
  const next = applyCommands(current, body.commands);
  const parsed = timelineSchema.safeParse(next);
  if (!parsed.success) {
    throw new HttpError(422, "validation", "les commandes produisent une timeline invalide", parsed.error.issues);
  }

  const headerActor = request.headers.get("x-clipfarm-actor");
  const actor = body.actor ?? (headerActor === "agent" || headerActor === "system" ? headerActor : "human");

  const result = writeTimeline(db, {
    projectId: id,
    baseRevision: body.baseRevision,
    timeline: parsed.data,
    actor,
    actorId: body.actorId,
    ops: body.commands,
  });
  return Response.json(result);
});

import { and, desc, eq, lt } from "drizzle-orm";
import type { Timeline } from "@/timeline/schema";
import { httpError } from "./api";
import type { DB } from "./db";
import { type Actor, projectRevisions, projects, type ProjectRevision } from "./db/schema";

export type WriteTimelineInput = {
  projectId: string;
  /** Revision the caller believes is current (optimistic lock). */
  baseRevision: number;
  timeline: Timeline;
  /** Who made the change: "human" for a normal user request, "agent" when an agent says so, "system" for automatic recalibration or any write not from a direct human request. */
  actor: Actor;
  actorId?: string | null;
  /** Serialized commands that produced `timeline`, kept for audit/replay (see `timeline/commands.ts`). */
  ops?: unknown[];
  /** Optional rename alongside the timeline write. */
  name?: string;
};

export type WriteTimelineResult = {
  id: string;
  revision: number;
  updatedAt: Date;
};

/**
 * Write a timeline guarded by an optimistic lock on `projects.revision`.
 *
 * The caller supplies `baseRevision`, the revision it built its change on top of. If the project's
 * current revision no longer matches, nothing is written and a 409 (`{ error, code: "conflict" }`,
 * via `httpError`/`errorResponse` from `./api`) is thrown. If it matches, the timeline is saved,
 * `projects.revision` is incremented, and a `project_revisions` row records the change with its
 * author. The read-check-write runs inside one `db.transaction`, whose callback is fully synchronous
 * (better-sqlite3 is a blocking driver) so no other request's write can interleave between the check
 * and the write even though the route handler around it is async.
 */
export function writeTimeline(db: DB, input: WriteTimelineInput): WriteTimelineResult {
  return db.transaction((tx) => {
    const project = tx
      .select({ id: projects.id, revision: projects.revision })
      .from(projects)
      .where(eq(projects.id, input.projectId))
      .get();
    if (!project) throw httpError(404, "projet introuvable");
    if (project.revision !== input.baseRevision) {
      throw httpError(409, "la révision du projet a changé entre-temps : recharge avant de réessayer");
    }

    const revision = project.revision + 1;
    const updatedAt = new Date();
    tx.update(projects)
      .set({ timeline: input.timeline, revision, updatedAt, ...(input.name ? { name: input.name } : {}) })
      .where(eq(projects.id, input.projectId))
      .run();
    tx.insert(projectRevisions)
      .values({
        projectId: input.projectId,
        rev: revision,
        actor: input.actor,
        actorId: input.actorId ?? null,
        ops: input.ops ?? null,
        snapshot: input.timeline,
      })
      .run();

    return { id: input.projectId, revision, updatedAt };
  });
}

export type RevisionsPage = {
  revisions: ProjectRevision[];
  /** Pass as `before` to fetch the next (older) page; null once there is nothing older. */
  nextCursor: number | null;
};

/** Paginated history of a project's revisions, newest first. */
export function listRevisions(db: DB, projectId: string, opts: { limit?: number; before?: number } = {}): RevisionsPage {
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100);
  const where =
    opts.before != null
      ? and(eq(projectRevisions.projectId, projectId), lt(projectRevisions.rev, opts.before))
      : eq(projectRevisions.projectId, projectId);
  const rows = db.select().from(projectRevisions).where(where).orderBy(desc(projectRevisions.rev)).limit(limit + 1).all();
  const revisions = rows.slice(0, limit);
  const nextCursor = rows.length > limit ? revisions[revisions.length - 1].rev : null;
  return { revisions, nextCursor };
}

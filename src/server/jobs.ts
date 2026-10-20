import { and, asc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { DB } from "./db";
import { jobs, type Job, type JobType } from "./db/schema";

export function enqueueJob(db: DB, type: JobType, payload: Record<string, unknown>): Job {
  return db.insert(jobs).values({ id: nanoid(10), type, payload }).returning().get();
}

/**
 * Atomically take the oldest queued job (single worker, but safe against double claims).
 * IMMEDIATE takes the write lock upfront: a deferred read→write upgrade fails with
 * SQLITE_BUSY right away (busy_timeout doesn't apply) when Next.js writes concurrently.
 */
export function claimNextJob(db: DB): Job | null {
  return db.transaction((tx) => {
    const next = tx.select().from(jobs).where(eq(jobs.status, "queued")).orderBy(asc(jobs.createdAt)).limit(1).get();
    if (!next) return null;
    const res = tx
      .update(jobs)
      .set({ status: "running", startedAt: new Date(), progress: 0 })
      .where(and(eq(jobs.id, next.id), eq(jobs.status, "queued")))
      .returning()
      .get();
    return res ?? null;
  }, { behavior: "immediate" });
}

export function setJobProgress(db: DB, id: string, progress: number) {
  db.update(jobs).set({ progress: Math.min(1, Math.max(0, progress)) }).where(eq(jobs.id, id)).run();
}

export function finishJob(db: DB, id: string, result: Record<string, unknown> = {}) {
  db.update(jobs).set({ status: "done", progress: 1, result, finishedAt: new Date() }).where(eq(jobs.id, id)).run();
}

export function failJob(db: DB, id: string, error: string) {
  db.update(jobs).set({ status: "error", error, finishedAt: new Date() }).where(eq(jobs.id, id)).run();
}

/** Jobs left "running" by a crashed worker go back to the queue on startup. */
export function requeueStaleJobs(db: DB) {
  db.update(jobs).set({ status: "queued", progress: 0 }).where(eq(jobs.status, "running")).run();
}

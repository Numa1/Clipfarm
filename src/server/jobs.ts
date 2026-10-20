import { and, asc, desc, eq, inArray, like } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { DB } from "./db";
import { jobs, moments, sources, type Job, type JobType, type SourceStatus } from "./db/schema";

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

/** The update is a no-op if the job was cancelled meanwhile (returns false). */
export function finishJob(db: DB, id: string, result: Record<string, unknown> = {}): boolean {
  const row = db
    .update(jobs)
    .set({ status: "done", progress: 1, result, finishedAt: new Date() })
    .where(and(eq(jobs.id, id), eq(jobs.status, "running")))
    .returning({ id: jobs.id })
    .get();
  return !!row;
}

/** The update is a no-op if the job was cancelled meanwhile (returns false). */
export function failJob(db: DB, id: string, error: string): boolean {
  const row = db
    .update(jobs)
    .set({ status: "error", error, finishedAt: new Date() })
    .where(and(eq(jobs.id, id), eq(jobs.status, "running")))
    .returning({ id: jobs.id })
    .get();
  return !!row;
}

export const CANCELLED_MESSAGE = "Traitement annulé.";

/**
 * Cancel a queued or running job. A running job is stopped by the worker, which watches its status.
 * The source it was processing (if any) is marked as failed. Returns null if the job had already ended.
 */
export function cancelJob(db: DB, id: string): Job | null {
  const job = db
    .update(jobs)
    .set({ status: "cancelled", error: CANCELLED_MESSAGE, finishedAt: new Date() })
    .where(and(eq(jobs.id, id), inArray(jobs.status, ["queued", "running"])))
    .returning()
    .get();
  if (!job) return null;
  markSourceFailed(db, job, CANCELLED_MESSAGE);
  return job;
}

/**
 * Source state after one of its jobs failed or was cancelled. A failed re-run of the moment search
 * leaves a source that already has moments usable ("ready"): the failure stays on the job, where
 * the UI shows it with a retry. Any other failure blocks the pipeline: the source is in error.
 */
export function markSourceFailed(db: DB, job: Job, message: string) {
  const sourceId = (job.payload as { sourceId?: string }).sourceId;
  if (!sourceId) return;
  const usable =
    job.type === "moments" &&
    !!db.select({ id: moments.id }).from(moments).where(eq(moments.sourceId, sourceId)).limit(1).get();
  db.update(sources)
    .set(usable ? { status: "ready", error: null } : { status: "error", error: message })
    .where(eq(sources.id, sourceId))
    .run();
}

/** Status a source shows while the given step of its pipeline runs again. */
const RETRY_STATUS: Partial<Record<JobType, SourceStatus>> = {
  ingest: "uploaded",
  transcribe: "transcribing",
  moments: "analyzing",
};

/** Queued or running jobs of a source, or of a project. */
export function activeJobsFor(db: DB, key: { sourceId: string } | { projectId: string }) {
  const [field, id] = "sourceId" in key ? ["sourceId", key.sourceId] : ["projectId", key.projectId];
  return db
    .select()
    .from(jobs)
    .where(and(inArray(jobs.status, ["queued", "running"]), like(jobs.payload, `%"${field}":"${id}"%`)))
    .orderBy(desc(jobs.createdAt))
    .all();
}

/**
 * Queue a failed or cancelled job again (same type and payload). Refused while another job runs for
 * the same source or project, so a retry never races the pipeline.
 */
export function retryJob(db: DB, id: string): { job: Job } | { error: string; status: number } {
  const old = db.select().from(jobs).where(eq(jobs.id, id)).get();
  if (!old) return { error: "not found", status: 404 };
  if (old.status !== "error" && old.status !== "cancelled") return { error: `job is ${old.status}`, status: 409 };
  const { sourceId, projectId } = old.payload as { sourceId?: string; projectId?: string };
  const key = sourceId ? { sourceId } : projectId ? { projectId } : null;
  if (key && activeJobsFor(db, key).length) return { error: "another job is already running", status: 409 };
  if (sourceId && !db.select({ id: sources.id }).from(sources).where(eq(sources.id, sourceId)).get()) {
    return { error: "source deleted", status: 410 };
  }
  const job = enqueueJob(db, old.type, old.payload);
  const status = RETRY_STATUS[old.type];
  if (sourceId && status) db.update(sources).set({ status, error: null }).where(eq(sources.id, sourceId)).run();
  return { job };
}

/** Cancel every queued or running job of a source (before deleting it). */
export function cancelSourceJobs(db: DB, sourceId: string) {
  db.update(jobs)
    .set({ status: "cancelled", error: CANCELLED_MESSAGE, finishedAt: new Date() })
    .where(and(inArray(jobs.status, ["queued", "running"]), like(jobs.payload, `%"sourceId":"${sourceId}"%`)))
    .run();
}

export function isJobCancelled(db: DB, id: string): boolean {
  return db.select({ status: jobs.status }).from(jobs).where(eq(jobs.id, id)).get()?.status === "cancelled";
}

/** Jobs left "running" by a crashed worker go back to the queue on startup. */
export function requeueStaleJobs(db: DB) {
  db.update(jobs).set({ status: "queued", progress: 0 }).where(eq(jobs.status, "running")).run();
}

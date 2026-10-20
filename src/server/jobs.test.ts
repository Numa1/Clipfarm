import path from "node:path";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { beforeEach, describe, expect, it } from "vitest";
import type { DB } from "./db";
import * as schema from "./db/schema";
import {
  CANCELLED_MESSAGE,
  cancelJob,
  cancelSourceJobs,
  claimNextJob,
  enqueueJob,
  failJob,
  finishJob,
  isJobCancelled,
  markSourceFailed,
  retryJob,
} from "./jobs";

let db: DB;

beforeEach(() => {
  db = drizzle(new Database(":memory:"), { schema });
  migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  db.insert(schema.sources).values({ id: "src1", title: "test", originalPath: "sources/src1/original.mp4" }).run();
});

const sourceOf = () => db.select().from(schema.sources).where(eq(schema.sources.id, "src1")).get()!;

describe("cancelJob", () => {
  it("cancels a queued job so the worker never claims it, and marks its source", () => {
    const job = enqueueJob(db, "ingest", { sourceId: "src1" });
    expect(cancelJob(db, job.id)?.status).toBe("cancelled");
    expect(claimNextJob(db, "heavy")).toBeNull();
    expect(sourceOf()).toMatchObject({ status: "error", error: CANCELLED_MESSAGE });
  });

  it("flags a running job, and the worker's late result does not overwrite it", () => {
    const job = enqueueJob(db, "render", { projectId: "p1" });
    claimNextJob(db, "heavy");
    cancelJob(db, job.id);
    expect(isJobCancelled(db, job.id)).toBe(true);
    expect(finishJob(db, job.id, { output: "x.mp4" })).toBe(false);
    expect(failJob(db, job.id, "boom")).toBe(false);
    expect(isJobCancelled(db, job.id)).toBe(true);
  });

  it("leaves finished jobs alone", () => {
    const job = enqueueJob(db, "render", { projectId: "p1" });
    claimNextJob(db, "heavy");
    expect(finishJob(db, job.id)).toBe(true);
    expect(cancelJob(db, job.id)).toBeNull();
  });
});

describe("cancelSourceJobs", () => {
  it("cancels only the active jobs of that source", () => {
    const mine = enqueueJob(db, "ingest", { sourceId: "src1" });
    const other = enqueueJob(db, "ingest", { sourceId: "src2" });
    cancelSourceJobs(db, "src1");
    expect(isJobCancelled(db, mine.id)).toBe(true);
    expect(isJobCancelled(db, other.id)).toBe(false);
  });
});

const addMoment = () =>
  db.insert(schema.moments).values({ id: "m1", sourceId: "src1", start: 0, end: 30, hook: "h", reason: "r", score: 50 }).run();

describe("markSourceFailed", () => {
  it("keeps a source with moments ready when a moment re-run fails", () => {
    addMoment();
    const job = enqueueJob(db, "moments", { sourceId: "src1" });
    markSourceFailed(db, job, "Claude : limite atteinte");
    expect(sourceOf()).toMatchObject({ status: "ready", error: null });
  });

  it("puts the source in error when the pipeline cannot go on", () => {
    const moments = enqueueJob(db, "moments", { sourceId: "src1" });
    markSourceFailed(db, moments, "boom");
    expect(sourceOf()).toMatchObject({ status: "error", error: "boom" });
    const ingest = enqueueJob(db, "ingest", { sourceId: "src1" });
    addMoment();
    markSourceFailed(db, ingest, "ffmpeg");
    expect(sourceOf()).toMatchObject({ status: "error", error: "ffmpeg" });
  });

  it("applies the same rule when a moment re-run is cancelled", () => {
    addMoment();
    const job = enqueueJob(db, "moments", { sourceId: "src1" });
    cancelJob(db, job.id);
    expect(sourceOf()).toMatchObject({ status: "ready", error: null });
  });
});

describe("enqueueJob", () => {
  it("returns the already-active job instead of inserting a duplicate for the same dedupe key", () => {
    const first = enqueueJob(db, "ingest", { sourceId: "src1" });
    const second = enqueueJob(db, "ingest", { sourceId: "src1" });
    expect(second.id).toBe(first.id);
    const rows = db.select().from(schema.jobs).where(eq(schema.jobs.sourceId, "src1")).all();
    expect(rows).toHaveLength(1);
  });

  it("allows a new job with the same key once the earlier one has ended", () => {
    const first = enqueueJob(db, "ingest", { sourceId: "src1" });
    claimNextJob(db, "heavy");
    finishJob(db, first.id);
    const second = enqueueJob(db, "ingest", { sourceId: "src1" });
    expect(second.id).not.toBe(first.id);
  });

  it("sets the lane and dedupe key from the job registry", () => {
    const heavy = enqueueJob(db, "ingest", { sourceId: "src1" });
    const light = enqueueJob(db, "moments", { sourceId: "src1" });
    expect(heavy).toMatchObject({ lane: "heavy", dedupeKey: "ingest:source:src1" });
    expect(light).toMatchObject({ lane: "light", dedupeKey: "moments:source:src1" });
  });
});

describe("claimNextJob lanes", () => {
  it("claims and runs a light job independently while a heavy job is in progress", () => {
    const heavy = enqueueJob(db, "ingest", { sourceId: "src1" });
    const light = enqueueJob(db, "moments", { sourceId: "src1" });

    const claimedHeavy = claimNextJob(db, "heavy");
    expect(claimedHeavy).toMatchObject({ id: heavy.id, status: "running" });
    // The heavy job is still running — the light one is claimed and runs on its own lane.
    const claimedLight = claimNextJob(db, "light");
    expect(claimedLight).toMatchObject({ id: light.id, status: "running" });

    expect(claimNextJob(db, "heavy")).toBeNull();
    expect(claimNextJob(db, "light")).toBeNull();
  });
});

describe("retryJob", () => {
  it("queues a copy of a failed job and resets the source status", () => {
    const job = enqueueJob(db, "transcribe", { sourceId: "src1" });
    claimNextJob(db, "heavy");
    failJob(db, job.id, "whisper");
    markSourceFailed(db, job, "whisper");
    const res = retryJob(db, job.id);
    expect("job" in res && res.job).toMatchObject({ type: "transcribe", status: "queued", payload: { sourceId: "src1" } });
    expect(sourceOf()).toMatchObject({ status: "transcribing", error: null });
  });

  it("refuses jobs that did not fail, and retries while the pipeline is busy", () => {
    const done = enqueueJob(db, "render", { projectId: "p1" });
    claimNextJob(db, "heavy");
    finishJob(db, done.id);
    expect(retryJob(db, done.id)).toMatchObject({ status: 409 });

    const failed = enqueueJob(db, "render", { projectId: "p1" });
    cancelJob(db, failed.id);
    enqueueJob(db, "reframe", { projectId: "p1" });
    expect(retryJob(db, failed.id)).toMatchObject({ status: 409 });
    expect(retryJob(db, "nope")).toMatchObject({ status: 404 });
  });
});

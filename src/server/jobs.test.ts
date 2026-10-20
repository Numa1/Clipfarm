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
    expect(claimNextJob(db)).toBeNull();
    expect(sourceOf()).toMatchObject({ status: "error", error: CANCELLED_MESSAGE });
  });

  it("flags a running job, and the worker's late result does not overwrite it", () => {
    const job = enqueueJob(db, "render", { projectId: "p1" });
    claimNextJob(db);
    cancelJob(db, job.id);
    expect(isJobCancelled(db, job.id)).toBe(true);
    expect(finishJob(db, job.id, { output: "x.mp4" })).toBe(false);
    expect(failJob(db, job.id, "boom")).toBe(false);
    expect(isJobCancelled(db, job.id)).toBe(true);
  });

  it("leaves finished jobs alone", () => {
    const job = enqueueJob(db, "render", { projectId: "p1" });
    claimNextJob(db);
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

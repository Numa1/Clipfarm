import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { beforeEach, describe, expect, it } from "vitest";
import type { DB } from "./db";
import * as schema from "./db/schema";
import { claimNextJob } from "./jobs";
import { nextJobsAfter, onProjectCreated } from "./pipeline";

let db: DB;

beforeEach(() => {
  db = drizzle(new Database(":memory:"), { schema });
  migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  db.insert(schema.sources).values({ id: "src1", title: "test", originalPath: "sources/src1/original.mp4" }).run();
});

describe("nextJobsAfter", () => {
  it("enfile transcribe quand ingest se termine", () => {
    const enqueued = nextJobsAfter(db, "ingest", { sourceId: "src1" }, { durationSec: 12 });
    expect(enqueued.map((j) => j.type)).toEqual(["transcribe"]);
    expect(claimNextJob(db, "heavy")).toMatchObject({ type: "transcribe", payload: { sourceId: "src1" } });
  });

  it("enfile niche quand transcribe se termine", () => {
    const enqueued = nextJobsAfter(db, "transcribe", { sourceId: "src1" }, { words: 3 });
    expect(enqueued.map((j) => j.type)).toEqual(["niche"]);
    expect(claimNextJob(db, "light")).toMatchObject({ type: "niche", payload: { sourceId: "src1" } });
  });

  it("enfile moments quand niche se termine", () => {
    const enqueued = nextJobsAfter(db, "niche", { sourceId: "src1" }, { niche: "gaming" });
    expect(enqueued.map((j) => j.type)).toEqual(["moments"]);
    expect(claimNextJob(db, "light")).toMatchObject({ type: "moments", payload: { sourceId: "src1" } });
  });

  it("n'enfile rien quand moments se termine (pas d'étape suivante pour l'instant)", () => {
    expect(nextJobsAfter(db, "moments", { sourceId: "src1" }, {})).toEqual([]);
  });

  it("n'enfile rien sans sourceId dans le payload", () => {
    expect(nextJobsAfter(db, "ingest", {}, {})).toEqual([]);
  });
});

describe("onProjectCreated", () => {
  it("enfile reframe", () => {
    const enqueued = onProjectCreated(db, "p1");
    expect(enqueued.map((j) => j.type)).toEqual(["reframe"]);
    expect(claimNextJob(db, "heavy")).toMatchObject({ type: "reframe", payload: { projectId: "p1" } });
  });
});

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { emptyTimeline } from "@/timeline/factory";
import { HttpError } from "./api";

let lib: string;
let db: import("./db").DB;
let schema: typeof import("./db").schema;
let writeTimeline: typeof import("./timeline-store").writeTimeline;
let listRevisions: typeof import("./timeline-store").listRevisions;

beforeAll(async () => {
  lib = fs.mkdtempSync(path.join(os.tmpdir(), "clipfarm-timeline-store-"));
  process.env.CLIPFARM_LIBRARY = lib;
  const dbModule = await import("./db");
  db = dbModule.getDb();
  schema = dbModule.schema;
  ({ writeTimeline, listRevisions } = await import("./timeline-store"));
});

afterAll(() => fs.rmSync(lib, { recursive: true, force: true }));

function makeProject(id: string) {
  db.insert(schema.projects).values({ id, name: "Projet", timeline: emptyTimeline() }).run();
}

describe("writeTimeline", () => {
  it("accepts a write whose baseRevision matches, increments revision, and records the author", () => {
    makeProject("p1");
    const result = writeTimeline(db, { projectId: "p1", baseRevision: 0, timeline: emptyTimeline(), actor: "human" });
    expect(result.revision).toBe(1);

    const row = db.select().from(schema.projects).where(eq(schema.projects.id, "p1")).get();
    expect(row?.revision).toBe(1);

    const revisions = db.select().from(schema.projectRevisions).where(eq(schema.projectRevisions.projectId, "p1")).all();
    expect(revisions).toHaveLength(1);
    expect(revisions[0]).toMatchObject({ rev: 1, actor: "human" });
    expect(revisions[0].actor).toBeTruthy();
  });

  it("refuses a write whose baseRevision is stale with a 409 conflict, and writes nothing", () => {
    makeProject("p2");
    writeTimeline(db, { projectId: "p2", baseRevision: 0, timeline: emptyTimeline(), actor: "human" });

    let caught: unknown;
    try {
      writeTimeline(db, { projectId: "p2", baseRevision: 0, timeline: emptyTimeline(), actor: "human" });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(HttpError);
    expect((caught as HttpError).status).toBe(409);
    expect((caught as HttpError).code).toBe("conflict");

    // Still at revision 1: the stale write changed nothing.
    const row = db.select().from(schema.projects).where(eq(schema.projects.id, "p2")).get();
    expect(row?.revision).toBe(1);
    const revisions = db.select().from(schema.projectRevisions).where(eq(schema.projectRevisions.projectId, "p2")).all();
    expect(revisions).toHaveLength(1);
  });

  it("two concurrent writes on the same base: the first succeeds (200-equivalent), the second gets 409", () => {
    makeProject("p3");
    // Both "requests" read revision 0 before either writes (simulates two in-flight PUTs racing).
    const attempt = (actor: "human" | "agent") => () =>
      writeTimeline(db, { projectId: "p3", baseRevision: 0, timeline: emptyTimeline(), actor });

    const results = [attempt("human"), attempt("agent")].map((run) => {
      try {
        return { ok: true as const, value: run() };
      } catch (e) {
        return { ok: false as const, error: e };
      }
    });

    const oks = results.filter((r) => r.ok);
    const fails = results.filter((r) => !r.ok);
    expect(oks).toHaveLength(1);
    expect(fails).toHaveLength(1);
    expect((fails[0] as { error: unknown }).error).toBeInstanceOf(HttpError);
    expect(((fails[0] as { error: HttpError }).error).status).toBe(409);
    expect(((fails[0] as { error: HttpError }).error).code).toBe("conflict");

    const row = db.select().from(schema.projects).where(eq(schema.projects.id, "p3")).get();
    expect(row?.revision).toBe(1);
  });

  it("throws 404 for an unknown project", () => {
    expect(() => writeTimeline(db, { projectId: "nope", baseRevision: 0, timeline: emptyTimeline(), actor: "human" })).toThrow(
      HttpError,
    );
  });

  it("records a non-null actor on every revision, including system writes", () => {
    makeProject("p4");
    writeTimeline(db, { projectId: "p4", baseRevision: 0, timeline: emptyTimeline(), actor: "system", actorId: "reframe" });
    const [rev] = db.select().from(schema.projectRevisions).where(eq(schema.projectRevisions.projectId, "p4")).all();
    expect(rev.actor).toBe("system");
    expect(rev.actor).not.toBeNull();
  });
});

describe("listRevisions", () => {
  it("pages revisions newest first", () => {
    makeProject("p5");
    for (let i = 0; i < 3; i++) writeTimeline(db, { projectId: "p5", baseRevision: i, timeline: emptyTimeline(), actor: "human" });

    const page = listRevisions(db, "p5", { limit: 2 });
    expect(page.revisions.map((r) => r.rev)).toEqual([3, 2]);
    expect(page.nextCursor).toBe(2);

    const next = listRevisions(db, "p5", { limit: 2, before: page.nextCursor! });
    expect(next.revisions.map((r) => r.rev)).toEqual([1]);
    expect(next.nextCursor).toBeNull();
  });
});

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { emptyTimeline } from "@/timeline/factory";

let lib: string;
let db: import("@/server/db").DB;
let schema: typeof import("@/server/db").schema;
let projectRoute: typeof import("./route");
let opsRoute: typeof import("./ops/route");
let revisionsRoute: typeof import("./revisions/route");

const HOST = { host: "localhost:3100" };
const url = (p: string) => `http://localhost:3100${p}`;
const put = (p: string, body: unknown) =>
  new Request(url(p), { method: "PUT", body: JSON.stringify(body), headers: { ...HOST, "content-type": "application/json" } });
const post = (p: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(url(p), { method: "POST", body: JSON.stringify(body), headers: { ...HOST, "content-type": "application/json", ...headers } });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeAll(async () => {
  lib = fs.mkdtempSync(path.join(os.tmpdir(), "clipfarm-project-route-"));
  process.env.CLIPFARM_LIBRARY = lib;
  const dbModule = await import("@/server/db");
  db = dbModule.getDb();
  schema = dbModule.schema;
  projectRoute = await import("./route");
  opsRoute = await import("./ops/route");
  revisionsRoute = await import("./revisions/route");
});

afterAll(() => fs.rmSync(lib, { recursive: true, force: true }));

function makeProject(id: string) {
  db.insert(schema.projects).values({ id, name: "Projet", timeline: emptyTimeline() }).run();
}

describe("PUT /api/projects/[id]", () => {
  it("requires baseRevision: 422 without it", async () => {
    makeProject("put-1");
    const res = await projectRoute.PUT(put("/api/projects/put-1", { timeline: emptyTimeline() }), params("put-1"));
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe("validation");
  });

  it("two simultaneous PUTs on the same baseRevision: the first succeeds, the second gets 409 conflict", async () => {
    makeProject("put-2");
    const body = { timeline: emptyTimeline(), baseRevision: 0 };
    const [first, second] = await Promise.all([
      projectRoute.PUT(put("/api/projects/put-2", body), params("put-2")),
      projectRoute.PUT(put("/api/projects/put-2", body), params("put-2")),
    ]);
    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([200, 409]);
    const conflictRes = first.status === 409 ? first : second;
    expect(await conflictRes.json()).toMatchObject({ code: "conflict" });

    const row = db.select().from(schema.projects).where(eq(schema.projects.id, "put-2")).get();
    expect(row?.revision).toBe(1);
  });

  it("a write on the up-to-date baseRevision after a conflict succeeds", async () => {
    makeProject("put-3");
    const first = await projectRoute.PUT(put("/api/projects/put-3", { timeline: emptyTimeline(), baseRevision: 0 }), params("put-3"));
    expect(first.status).toBe(200);
    const retry = await projectRoute.PUT(put("/api/projects/put-3", { timeline: emptyTimeline(), baseRevision: 1 }), params("put-3"));
    expect(retry.status).toBe(200);
    expect((await retry.json()).revision).toBe(2);
  });

  it("defaults the revision author to human", async () => {
    makeProject("put-4");
    await projectRoute.PUT(put("/api/projects/put-4", { timeline: emptyTimeline(), baseRevision: 0 }), params("put-4"));
    const [rev] = db.select().from(schema.projectRevisions).where(eq(schema.projectRevisions.projectId, "put-4")).all();
    expect(rev.actor).toBe("human");
  });

  it("honours an explicit agent/system actor", async () => {
    makeProject("put-5");
    await projectRoute.PUT(put("/api/projects/put-5", { timeline: emptyTimeline(), baseRevision: 0, actor: "system" }), params("put-5"));
    const [rev] = db.select().from(schema.projectRevisions).where(eq(schema.projectRevisions.projectId, "put-5")).all();
    expect(rev.actor).toBe("system");
  });
});

describe("POST /api/projects/[id]/ops", () => {
  it("applies a command and bumps the revision", async () => {
    makeProject("ops-1");
    const res = await opsRoute.POST(
      post("/api/projects/ops-1/ops", { commands: [{ type: "setHook", hooks: [{ text: "Regarde ça" }] }], baseRevision: 0 }),
      params("ops-1"),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).revision).toBe(1);
    const row = db.select().from(schema.projects).where(eq(schema.projects.id, "ops-1")).get();
    expect((row?.timeline as { meta: { hooks?: unknown[] } }).meta.hooks).toEqual([{ text: "Regarde ça" }]);
  });

  it("refuses a stale baseRevision with 409", async () => {
    makeProject("ops-2");
    await opsRoute.POST(post("/api/projects/ops-2/ops", { commands: [{ type: "setHook", hooks: [] }], baseRevision: 0 }), params("ops-2"));
    const res = await opsRoute.POST(post("/api/projects/ops-2/ops", { commands: [{ type: "setHook", hooks: [] }], baseRevision: 0 }), params("ops-2"));
    expect(res.status).toBe(409);
  });

  it("marks the actor from the x-clipfarm-actor header", async () => {
    makeProject("ops-3");
    await opsRoute.POST(
      post("/api/projects/ops-3/ops", { commands: [{ type: "setHook", hooks: [] }], baseRevision: 0 }, { "x-clipfarm-actor": "agent" }),
      params("ops-3"),
    );
    const [rev] = db.select().from(schema.projectRevisions).where(eq(schema.projectRevisions.projectId, "ops-3")).all();
    expect(rev.actor).toBe("agent");
  });
});

describe("GET /api/projects/[id]/revisions", () => {
  it("lists revisions newest first", async () => {
    makeProject("rev-1");
    await projectRoute.PUT(put("/api/projects/rev-1", { timeline: emptyTimeline(), baseRevision: 0 }), params("rev-1"));
    await projectRoute.PUT(put("/api/projects/rev-1", { timeline: emptyTimeline(), baseRevision: 1 }), params("rev-1"));
    const res = await revisionsRoute.GET(new Request(url("/api/projects/rev-1/revisions"), { headers: HOST }), params("rev-1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.revisions.map((r: { rev: number }) => r.rev)).toEqual([2, 1]);
  });
});

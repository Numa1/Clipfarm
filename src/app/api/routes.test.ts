import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Routes read CLIPFARM_LIBRARY at import time: point it at a throwaway library first.
let lib: string;
let db: import("@/server/db").DB;
let schema: typeof import("@/server/db").schema;
let projectsRoute: typeof import("./projects/route");
let cancelRoute: typeof import("./jobs/[id]/cancel/route");
let mediaRoute: typeof import("./media/[...path]/route");
let sourcesRoute: typeof import("./sources/route");
let sfxRoute: typeof import("./sfx/route");

const HOST = { host: "localhost:3100" };
const url = (p: string) => `http://localhost:3100${p}`;
const json = (p: string, body: string, headers: Record<string, string> = {}) =>
  new Request(url(p), { method: "POST", body, headers: { ...HOST, ...headers } });

beforeAll(async () => {
  lib = fs.mkdtempSync(path.join(os.tmpdir(), "clipfarm-routes-"));
  process.env.CLIPFARM_LIBRARY = lib;
  const dbModule = await import("@/server/db");
  db = dbModule.getDb();
  schema = dbModule.schema;
  projectsRoute = await import("./projects/route");
  cancelRoute = await import("./jobs/[id]/cancel/route");
  mediaRoute = await import("./media/[...path]/route");
  sourcesRoute = await import("./sources/route");
  sfxRoute = await import("./sfx/route");
});

afterAll(() => fs.rmSync(lib, { recursive: true, force: true }));

describe("POST /api/projects", () => {
  it("answers 422 in the common error format on an invalid body", async () => {
    const res = await projectsRoute.POST(json("/api/projects", "{}"));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body).toMatchObject({ error: expect.any(String), code: "validation" });
    expect(body.issues.length).toBeGreaterThan(0);
  });

  it("answers 400 on invalid JSON", async () => {
    const res = await projectsRoute.POST(json("/api/projects", "{not json"));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "invalid_json" });
  });

  it("answers 404 in the common format for an unknown moment", async () => {
    const res = await projectsRoute.POST(json("/api/projects", JSON.stringify({ momentId: "nope" })));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "moment not found", code: "not_found" });
  });

  it("replays the same Idempotency-Key: one project row, same id", async () => {
    db.insert(schema.sources)
      .values({ id: "src1", title: "demo", originalPath: "sources/src1/original.mp4", proxyPath: "sources/src1/proxy.mp4", durationSec: 60, width: 1920, height: 1080 })
      .run();
    const body = JSON.stringify({ sourceId: "src1", start: 1, end: 10 });
    const first = await projectsRoute.POST(json("/api/projects", body, { "idempotency-key": "create-1" }));
    const second = await projectsRoute.POST(json("/api/projects", body, { "idempotency-key": "create-1" }));
    expect(first.status).toBe(201);
    expect(first.headers.get("idempotent-replay")).toBeNull();
    expect(second.status).toBe(201);
    expect(second.headers.get("idempotent-replay")).toBe("true");
    const { id } = await first.json();
    expect((await second.json()).id).toBe(id);
    expect(db.select().from(schema.projects).where(eq(schema.projects.sourceId, "src1")).all()).toHaveLength(1);
  });
});

describe("POST /api/jobs/[id]/cancel", () => {
  it("answers 404 in the common format for an unknown job", async () => {
    const res = await cancelRoute.POST(json("/api/jobs/zzz/cancel", ""), { params: Promise.resolve({ id: "zzz" }) });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not found", code: "not_found" });
  });
});

describe("local guard", () => {
  const foreign = { host: "evil.example" };

  it("refuses a foreign Host on migrated routes", async () => {
    const upload = await sourcesRoute.POST(new Request("http://evil.example/api/sources", { method: "POST", body: "x", headers: foreign }));
    expect(upload.status).toBe(403);
    expect(await upload.json()).toMatchObject({ code: "forbidden" });
    const sfx = await sfxRoute.POST(new Request("http://evil.example/api/sfx", { method: "POST", body: "x", headers: foreign }));
    expect(sfx.status).toBe(403);
  });
});

describe("streaming", () => {
  it("serves a Range request on api/media with 206 and Content-Range", async () => {
    fs.mkdirSync(path.join(lib, "sources", "m"), { recursive: true });
    fs.writeFileSync(path.join(lib, "sources", "m", "clip.mp4"), Buffer.from("0123456789"));
    const req = new Request(url("/api/media/sources/m/clip.mp4"), { headers: { ...HOST, range: "bytes=2-5" } });
    const res = await mediaRoute.GET(req, { params: Promise.resolve({ path: ["sources", "m", "clip.mp4"] }) });
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe("bytes 2-5/10");
    expect(res.headers.get("content-length")).toBe("4");
    expect(await res.text()).toBe("2345");
  });

  it("answers 404 in the common format for missing media", async () => {
    const res = await mediaRoute.GET(new Request(url("/api/media/sources/none.mp4"), { headers: HOST }), {
      params: Promise.resolve({ path: ["sources", "none.mp4"] }),
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: "not_found" });
  });

  it("accepts a streamed upload on api/sources without buffering it in the wrapper", async () => {
    const chunks = [Buffer.from("aaaa"), Buffer.from("bbbb")];
    const body = new ReadableStream({
      start(controller) {
        for (const c of chunks) controller.enqueue(c);
        controller.close();
      },
    });
    const req = new Request(url("/api/sources"), {
      method: "POST",
      body,
      headers: { ...HOST, "x-filename": "stream.mp4" },
      duplex: "half",
    } as RequestInit);
    const res = await sourcesRoute.POST(req);
    expect(res.status).toBe(201);
    const source = await res.json();
    expect(fs.readFileSync(path.join(lib, source.originalPath), "utf8")).toBe("aaaabbbb");
  });

  it("rejects an unsupported upload type with 415", async () => {
    const res = await sourcesRoute.POST(new Request(url("/api/sources"), { method: "POST", body: "x", headers: { ...HOST, "x-filename": "a.txt" } }));
    expect(res.status).toBe(415);
    expect(await res.json()).toMatchObject({ code: "unsupported_media_type" });
  });
});

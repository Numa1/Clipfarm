import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let lib: string;
let db: import("@/server/db").DB;
let schema: typeof import("@/server/db").schema;
let sourceRoute: typeof import("./route");

const HOST = { host: "localhost:3100" };
const url = (p: string) => `http://localhost:3100${p}`;
const patch = (p: string, body: unknown) =>
  new Request(url(p), { method: "PATCH", body: JSON.stringify(body), headers: { ...HOST, "content-type": "application/json" } });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeAll(async () => {
  lib = fs.mkdtempSync(path.join(os.tmpdir(), "clipfarm-sources-route-"));
  process.env.CLIPFARM_LIBRARY = lib;
  const dbModule = await import("@/server/db");
  db = dbModule.getDb();
  schema = dbModule.schema;
  sourceRoute = await import("./route");
});

afterAll(() => fs.rmSync(lib, { recursive: true, force: true }));

function makeSource(id: string) {
  db.insert(schema.sources).values({ id, title: "Une vidéo", originalPath: `sources/${id}/original.mp4` }).run();
}

describe("PATCH /api/sources/[id]", () => {
  it("corrige la niche à la main : force nicheSource à \"manual\" et nicheConfidence à 1", async () => {
    makeSource("src-patch-niche");
    const res = await sourceRoute.PATCH(patch("/api/sources/src-patch-niche", { niche: "gaming" }), params("src-patch-niche"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ niche: "gaming", nicheSource: "manual", nicheConfidence: 1 });

    const row = db.select().from(schema.sources).where(eq(schema.sources.id, "src-patch-niche")).get()!;
    expect(row).toMatchObject({ niche: "gaming", nicheSource: "manual", nicheConfidence: 1 });
  });

  it("refuse un identifiant de niche inconnu, dans le format d'erreur commun", async () => {
    makeSource("src-patch-bad-niche");
    const res = await sourceRoute.PATCH(patch("/api/sources/src-patch-bad-niche", { niche: "n-importe-quoi" }), params("src-patch-bad-niche"));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "validation" });
  });

  it("continue d'accepter creator seul, sans toucher à la niche", async () => {
    makeSource("src-patch-creator");
    const res = await sourceRoute.PATCH(patch("/api/sources/src-patch-creator", { creator: "Alex" }), params("src-patch-creator"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ creator: "Alex", niche: null, nicheSource: null });
  });

  it("répond 404 au format commun pour une source inconnue", async () => {
    const res = await sourceRoute.PATCH(patch("/api/sources/inconnue", { creator: "Alex" }), params("inconnue"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not found", code: "not_found" });
  });
});

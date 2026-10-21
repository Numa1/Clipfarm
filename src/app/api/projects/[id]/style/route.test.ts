import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { emptyTimeline } from "@/timeline/factory";
import type { Timeline } from "@/timeline/schema";

let lib: string;
let db: import("@/server/db").DB;
let schema: typeof import("@/server/db").schema;
let styleRoute: typeof import("./route");

const HOST = { host: "localhost:3100" };
const url = (p: string) => `http://localhost:3100${p}`;
const post = (p: string, body: unknown) =>
  new Request(url(p), { method: "POST", body: JSON.stringify(body), headers: { ...HOST, "content-type": "application/json" } });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeAll(async () => {
  lib = fs.mkdtempSync(path.join(os.tmpdir(), "clipfarm-project-style-route-"));
  process.env.CLIPFARM_LIBRARY = lib;
  const dbModule = await import("@/server/db");
  db = dbModule.getDb();
  schema = dbModule.schema;
  styleRoute = await import("./route");
});

afterAll(() => fs.rmSync(lib, { recursive: true, force: true }));

const MANUAL_SHOT = { t: 0, layout: "split" as const, cam: { x: 0, y: 0.6, w: 0.3, h: 0.4 }, content: { x: 0.2, y: 0, w: 0.5, h: 1 }, ratio: 0.4 };

function timelineWithCrops(): Timeline {
  const tl = emptyTimeline();
  tl.assets["a1"] = { id: "a1", kind: "video", src: "sources/a1/proxy.mp4", durationSec: 60 };
  tl.tracks[0].items.push(
    {
      id: "manual-clip",
      type: "video",
      start: 0,
      assetId: "a1",
      sourceIn: 0,
      sourceOut: 10,
      volume: 1,
      crop: { mode: "manual", keyframes: [], shots: [MANUAL_SHOT] },
    },
    {
      id: "auto-clip",
      type: "video",
      start: 10,
      assetId: "a1",
      sourceIn: 10,
      sourceOut: 20,
      volume: 1,
      crop: { mode: "auto", keyframes: [], shots: [{ ...MANUAL_SHOT, t: 10 }] },
    },
  );
  return tl;
}

function makeProject(id: string, timeline: Timeline, styleId?: string) {
  db.insert(schema.projects).values({ id, name: "Projet", timeline, ...(styleId ? { styleId } : {}) }).run();
}

describe("POST /api/projects/[id]/style", () => {
  it("met à jour meta.styleId et la colonne styleId sans toucher aux cadrages manuels existants", async () => {
    makeProject("style-1", timelineWithCrops(), "chill");
    const res = await styleRoute.POST(post("/api/projects/style-1/style", { styleId: "epique" }), params("style-1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ styleId: "epique" });

    const row = db.select().from(schema.projects).where(eq(schema.projects.id, "style-1")).get();
    expect(row?.styleId).toBe("epique");
    const timeline = row?.timeline as Timeline;
    expect(timeline.meta.styleId).toBe("epique");

    const manual = timeline.tracks[0].items.find((i) => i.id === "manual-clip");
    if (manual?.type !== "video" || manual.crop.mode !== "manual") throw new Error("unexpected");
    expect(manual.crop.shots?.[0]).toMatchObject({ ratio: 0.4 }); // inchangé malgré epique.crop.splitRatio = 0.3

    const auto = timeline.tracks[0].items.find((i) => i.id === "auto-clip");
    if (auto?.type !== "video" || auto.crop.mode !== "auto") throw new Error("unexpected");
    expect(auto.crop.shots?.[0]).toMatchObject({ ratio: 0.3 }); // mis à jour selon le preset "epique"
  });

  it("refuse un styleId inconnu avec 400", async () => {
    makeProject("style-2", emptyTimeline());
    const res = await styleRoute.POST(post("/api/projects/style-2/style", { styleId: "n-existe-pas" }), params("style-2"));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("bad_request");
  });

  it("renvoie un 404 français pour un projet inconnu", async () => {
    const res = await styleRoute.POST(post("/api/projects/does-not-exist/style", { styleId: "chill" }), params("does-not-exist"));
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: "not_found", error: "projet introuvable" });
  });

  it("400 quand styleId est manquant", async () => {
    makeProject("style-3", emptyTimeline());
    const res = await styleRoute.POST(post("/api/projects/style-3/style", {}), params("style-3"));
    expect(res.status).toBe(400);
  });
});

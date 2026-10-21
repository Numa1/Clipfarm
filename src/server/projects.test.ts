import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { DB } from "./db";
import * as schema from "./db/schema";
import { createProject } from "./projects";

let db: DB;

beforeEach(() => {
  db = drizzle(new Database(":memory:"), { schema });
  migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
});

function makeSource(overrides: Partial<typeof schema.sources.$inferInsert> = {}) {
  db.insert(schema.sources)
    .values({
      id: "src1",
      title: "Source test",
      originalPath: "sources/src1/original.mp4",
      proxyPath: "sources/src1/proxy.mp4",
      durationSec: 120,
      ...overrides,
    })
    .run();
}

describe("createProject", () => {
  it("applique le style par défaut de la niche de la source quand aucun styleId n'est fourni", () => {
    makeSource({ niche: "gaming" }); // defaultStyle: "epique"
    const res = createProject(db, { sourceId: "src1", start: 0, end: 10 });
    if ("error" in res) throw new Error(res.error);
    expect(res.project.styleId).toBe("epique");
    expect((res.project.timeline as { meta: { styleId?: string } }).meta.styleId).toBe("epique");
  });

  it("retombe sur un style de repli raisonnable quand la niche de la source est inconnue", () => {
    makeSource({ niche: null });
    const res = createProject(db, { sourceId: "src1", start: 0, end: 10 });
    if ("error" in res) throw new Error(res.error);
    expect(res.project.styleId).toBe("chill");
  });

  it("applique le styleId explicite plutôt que celui de la niche", () => {
    makeSource({ niche: "gaming" }); // defaultStyle: "epique"
    const res = createProject(db, { sourceId: "src1", start: 0, end: 10, styleId: "humour" });
    if ("error" in res) throw new Error(res.error);
    expect(res.project.styleId).toBe("humour");
  });

  it("refuse un styleId inconnu", () => {
    makeSource();
    const res = createProject(db, { sourceId: "src1", start: 0, end: 10, styleId: "n-existe-pas" });
    expect(res).toMatchObject({ status: 400 });
  });

  it("refuse une source qui n'est pas prête", () => {
    makeSource({ proxyPath: null });
    const res = createProject(db, { sourceId: "src1", start: 0, end: 10 });
    expect(res).toMatchObject({ status: 409 });
  });

  it("refuse un moment introuvable", () => {
    const res = createProject(db, { momentId: "does-not-exist" });
    expect(res).toMatchObject({ status: 404 });
  });

  it("enregistre bien la colonne styleId en base, pas seulement dans le timeline", () => {
    makeSource({ niche: "podcast" }); // defaultStyle: "chill"
    const res = createProject(db, { sourceId: "src1", start: 0, end: 10 });
    if ("error" in res) throw new Error(res.error);
    const row = db.select().from(schema.projects).where(eq(schema.projects.id, res.project.id)).get();
    expect(row?.styleId).toBe("chill");
  });
});

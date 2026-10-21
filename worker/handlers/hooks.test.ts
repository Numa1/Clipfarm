import path from "node:path";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import type { DB } from "@/server/db";
import * as schema from "@/server/db/schema";
import { parseTimeline, TIMELINE_VERSION } from "@/timeline/schema";

// Must run before `generateHooks` (and the module it reads it through, src/server/llm.ts) is
// imported: CLAUDE_BIN is read once at module load. Same convention as
// src/server/niche-llm.test.ts / worker/handlers/moments-failure.test.ts.
beforeAll(() => {
  process.env.CLAUDE_BIN = path.resolve("e2e/fake-claude.mjs");
});

function emptyTimeline() {
  return { version: TIMELINE_VERSION, fps: 30, width: 1080, height: 1920, assets: {}, tracks: [], meta: {} };
}

function seed(db: DB) {
  db.insert(schema.sources)
    .values({ id: "src1", title: "Test de bout en bout", originalPath: "sources/src1/original.mp4", niche: "podcast", creator: "Alex" })
    .run();
  db.insert(schema.transcripts)
    .values({
      sourceId: "src1",
      language: "fr",
      json: {
        language: "fr",
        words: [
          { w: "Alors", start: 0, end: 0.3 },
          { w: "accroche-toi,", start: 0.3, end: 0.8 },
          { w: "ce", start: 0.8, end: 0.9 },
          { w: "qui", start: 0.9, end: 1.0 },
          { w: "arrive", start: 1.0, end: 1.3 },
          { w: "est", start: 1.3, end: 1.4 },
          { w: "incroyable", start: 1.4, end: 2.0 },
          { w: "!", start: 2.0, end: 2.0 },
        ],
      },
    })
    .run();
  db.insert(schema.moments)
    .values({ id: "mom1", sourceId: "src1", start: 0, end: 2, hook: "ancien hook", reason: "test", score: 80 })
    .run();
  db.insert(schema.projects)
    .values({ id: "proj1", name: "Projet test", sourceId: "src1", momentId: "mom1", timeline: emptyTimeline(), revision: 0 })
    .run();
}

describe("generateHooks (faux Claude, e2e/fake-claude.mjs)", () => {
  it("écrit 3 à 5 variantes d'accroche dans meta.hooks et attribue le coût au projet", async () => {
    const db: DB = drizzle(new Database(":memory:"), { schema });
    migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
    seed(db);

    const { generateHooks } = await import("./hooks");
    const result = await generateHooks(db, { projectId: "proj1" });

    expect(result.variants).toBeGreaterThanOrEqual(3);
    expect(result.variants).toBeLessThanOrEqual(5);

    const project = db.select().from(schema.projects).where(eq(schema.projects.id, "proj1")).get()!;
    const timeline = parseTimeline(project.timeline);
    expect(timeline.meta.hooks).toBeDefined();
    expect(timeline.meta.hooks!.length).toBeGreaterThanOrEqual(3);
    expect(timeline.meta.hooks!.length).toBeLessThanOrEqual(5);
    expect(timeline.meta.hooks!.filter((h) => h.kind === "retenue")).toHaveLength(1);
    for (const h of timeline.meta.hooks!) expect(h.text.length).toBeGreaterThan(0);

    // La révision avance : la commande "setHook" est passée par timeline-store (verrou de révision).
    expect(project.revision).toBe(1);

    const calls = db.select().from(schema.llmCalls).where(eq(schema.llmCalls.projectId, "proj1")).all();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ status: "ok", promptId: "hooks", promptVersion: "1", purpose: "hooks" });
    // Le coût est attribué au PROJET, pas seulement à la source.
    expect(calls[0].projectId).toBe("proj1");
    expect(calls[0].costUsd).toBeGreaterThan(0);

    // Pas attribué à la source : la fonctionnalité est consommée par le projet, pas par la source brute.
    const sourceCalls = db.select().from(schema.llmCalls).where(eq(schema.llmCalls.sourceId, "src1")).all();
    expect(sourceCalls).toHaveLength(0);
  });
});

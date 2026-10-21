import path from "node:path";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import type { DB } from "@/server/db";
import * as schema from "@/server/db/schema";
import type { NicheLocalSignals } from "./niche";

// Must run before `classifyNiche` (and the module it reads it through, src/server/llm.ts) is
// imported: CLAUDE_BIN is read once at module load. Same convention as
// worker/handlers/moments-failure.test.ts. This is why this file has no top-level static import of
// "./niche" (src/server/niche.test.ts covers everything that doesn't need the fake Claude CLI).
beforeAll(() => {
  process.env.CLAUDE_BIN = path.resolve("e2e/fake-claude.mjs");
});

/** Rien ne dépasse nettement : aucune niche ne devrait atteindre le seuil de confiance local (0.7). */
const AMBIGUOUS_SIGNALS: NicheLocalSignals = {
  wordsPerSec: 1.2,
  contentVoiceShare: 0.4,
  faceScore: 0.35,
  greenShare: 0.08,
  sceneCutRate: 0.3,
};

describe("classifyNiche, Claude en repli (faux Claude, e2e/fake-claude.mjs)", () => {
  it("des signaux ambigus déclenchent l'appel à Claude, dont la réponse détermine la niche", async () => {
    const db: DB = drizzle(new Database(":memory:"), { schema });
    migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
    db.insert(schema.sources).values({ id: "src-ambigu", title: "Vidéo quelconque", originalPath: "sources/src-ambigu/original.mp4" }).run();
    db.insert(schema.transcripts)
      .values({
        sourceId: "src-ambigu",
        language: "fr",
        json: {
          language: "fr",
          words: [
            { w: "Salut", start: 0, end: 0.5 },
            { w: "tout", start: 0.5, end: 0.9 },
            { w: "le", start: 0.9, end: 1.0 },
            { w: "monde", start: 1.0, end: 1.4 },
          ],
        },
      })
      .run();
    const source = db.select().from(schema.sources).where(eq(schema.sources.id, "src-ambigu")).get()!;

    const { classifyNiche, classifyLocally, CONFIDENCE_THRESHOLD } = await import("./niche");
    // Les signaux sont bien sous le seuil local : c'est pour ça que ce cas passe par Claude.
    expect(classifyLocally(AMBIGUOUS_SIGNALS).confidence).toBeLessThan(CONFIDENCE_THRESHOLD);

    const result = await classifyNiche(db, source, AMBIGUOUS_SIGNALS);

    // e2e/fake-claude.mjs répond systématiquement { niche: "podcast", confidence: 0.75, ... } sur le
    // prompt de niche (reconnu par son marqueur "Niches possibles").
    expect(result.niche).toBe("podcast");
    expect(result.confidence).toBe(0.75);
    expect(result.source).toBe("llm");

    const calls = db.select().from(schema.llmCalls).where(eq(schema.llmCalls.sourceId, "src-ambigu")).all();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ status: "ok", promptId: "niche", promptVersion: "1", purpose: "niche" });
  });
});

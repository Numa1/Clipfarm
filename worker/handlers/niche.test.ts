import path from "node:path";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it } from "vitest";
import type { DB } from "@/server/db";
import * as schema from "@/server/db/schema";
import { assignNiche } from "./niche";

function freshDb(): DB {
  const db: DB = drizzle(new Database(":memory:"), { schema });
  migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  return db;
}

describe("assignNiche", () => {
  it("ne touche jamais une source déjà corrigée manuellement (nicheSource = \"manual\")", async () => {
    const db = freshDb();
    db.insert(schema.sources)
      .values({
        id: "src1",
        title: "Test",
        originalPath: "sources/src1/original.mp4",
        niche: "humour",
        nicheConfidence: 1,
        nicheSource: "manual",
        nicheSignals: { wordsPerSec: 5, contentVoiceShare: 0.1, faceScore: 0.9, greenShare: 0, sceneCutRate: 2 },
      })
      .run();

    const result = await assignNiche(db, { sourceId: "src1" });

    expect(result).toMatchObject({ skipped: true });
    const source = db.select().from(schema.sources).where(eq(schema.sources.id, "src1")).get()!;
    expect(source.niche).toBe("humour");
    expect(source.nicheConfidence).toBe(1);
    expect(source.nicheSource).toBe("manual");
    // Aucun appel réseau, aucun job enfilé par ce handler (voir src/server/pipeline.ts).
    expect(db.select().from(schema.llmCalls).all()).toHaveLength(0);
  });

  it("répond une erreur claire pour une source inexistante", async () => {
    const db = freshDb();
    await expect(assignNiche(db, { sourceId: "nope" })).rejects.toThrow("source not found");
  });
});

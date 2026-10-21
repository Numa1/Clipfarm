import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NICHES } from "@/config/niches";
import { momentsPrompt } from "@/prompts/moments";
import type { DB } from "@/server/db";
import * as schema from "@/server/db/schema";

// Capture ce que `findMoments` envoie à Claude (système + version de prompt) sans dépendre du CLI
// réel : un faux `callClaude` qui enregistre ses arguments et renvoie un moment valide.
const calls: { system: string; promptVersion: string }[] = [];

vi.mock("@/server/llm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/llm")>();
  return {
    ...actual,
    callClaude: vi.fn(async (args: { system: string; promptVersion: string }) => {
      calls.push({ system: args.system, promptVersion: args.promptVersion });
      return {
        structured_output: {
          moments: [
            {
              start: 0,
              end: 30,
              title: "Il réagit à chaud pendant tout le passage",
              hook: "Un moment à ne pas manquer",
              teaser: null,
              proof: "Salut tout le monde comment ça va",
              reason: "Test.",
              score: 80,
            },
          ],
        },
      };
    }),
  };
});

function makeDb(): DB {
  const db: DB = drizzle(new Database(":memory:"), { schema });
  migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  return db;
}

// Transcription assez longue pour couvrir [0, 30.5] (fenêtre de recherche de la citation).
const words = "Salut tout le monde comment ça va aujourd'hui on continue le live ensemble"
  .split(" ")
  .map((w, i) => ({ w, start: i * 2, end: i * 2 + 1.5 }));

describe("findMoments, choix du prompt selon la niche de la source", () => {
  afterEach(() => {
    calls.length = 0;
    vi.clearAllMocks();
  });

  it("utilise momentsPrompt2 avec la consigne de niche quand la source a une niche connue (football)", async () => {
    const { findMoments } = await import("./moments");
    const db = makeDb();
    db.insert(schema.sources)
      .values({ id: "s-football", title: "Match du dimanche", originalPath: "sources/s-football/original.mp4", niche: "football" })
      .run();
    db.insert(schema.transcripts).values({ sourceId: "s-football", language: "fr", json: { language: "fr", words } }).run();

    await findMoments(db, { sourceId: "s-football" });

    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0].promptVersion).toBe("2");
    expect(calls[0].system).toContain(NICHES.football.promptHint);
    expect(calls[0].system).not.toBe(momentsPrompt.system);
  });

  it("garde le comportement de momentsPrompt version 1 quand la niche est absente", async () => {
    const { findMoments } = await import("./moments");
    const db = makeDb();
    db.insert(schema.sources)
      .values({ id: "s-sans-niche", title: "Vidéo quelconque", originalPath: "sources/s-sans-niche/original.mp4" })
      .run();
    db.insert(schema.transcripts).values({ sourceId: "s-sans-niche", language: "fr", json: { language: "fr", words } }).run();

    await findMoments(db, { sourceId: "s-sans-niche" });

    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0].promptVersion).toBe("1");
    expect(calls[0].system).toBe(momentsPrompt.system);
  });

  it("garde le comportement de momentsPrompt version 1 quand la niche est inconnue", async () => {
    const { findMoments } = await import("./moments");
    const db = makeDb();
    db.insert(schema.sources)
      .values({ id: "s-niche-inconnue", title: "Vidéo quelconque", originalPath: "sources/s-niche-inconnue/original.mp4", niche: "ovni" })
      .run();
    db.insert(schema.transcripts).values({ sourceId: "s-niche-inconnue", language: "fr", json: { language: "fr", words } }).run();

    await findMoments(db, { sourceId: "s-niche-inconnue" });

    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0].promptVersion).toBe("1");
    expect(calls[0].system).toBe(momentsPrompt.system);
  });
});

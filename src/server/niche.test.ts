// IMPORTANT : ce fichier n'importe "./niche" qu'en haut du module (voir plus bas), avant tout
// beforeAll — aucun test ici n'a besoin de CLAUDE_BIN (ils n'atteignent jamais l'appel à Claude).
// Le test "Claude en repli" (signaux ambigus) vit dans niche-llm.test.ts, qui pose CLAUDE_BIN avant
// son premier import de "./niche" (src/server/llm.ts lit CLAUDE_BIN une fois, au chargement du
// module — même convention que worker/handlers/moments-failure.test.ts).
import path from "node:path";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it } from "vitest";
import type { DB } from "@/server/db";
import * as schema from "@/server/db/schema";
import {
  CONFIDENCE_THRESHOLD,
  classifyLocally,
  classifyNiche,
  findSimilarManualExamples,
  normalizeSignals,
  scoreNiche,
  summarizeSignals,
  type NicheLocalSignals,
} from "./niche";

function freshDb(): DB {
  const db: DB = drizzle(new Database(":memory:"), { schema });
  migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  return db;
}

/** Signaux "quasi 100% de vert à l'écran + débit de commentaire sportif" : très marqués côté football. */
const FOOTBALL_SIGNALS: NicheLocalSignals = {
  wordsPerSec: 3.4, // commentaire sportif très rapide
  contentVoiceShare: 0.85,
  faceScore: 0, // pas de facecam
  greenShare: 0.97, // quasi 100% de vert (terrain)
  sceneCutRate: 1.1, // beaucoup d'activité à l'écran
};

/** Rien ne dépasse nettement : aucune niche ne devrait atteindre le seuil de confiance local. */
const AMBIGUOUS_SIGNALS: NicheLocalSignals = {
  wordsPerSec: 1.2,
  contentVoiceShare: 0.4,
  faceScore: 0.35,
  greenShare: 0.08,
  sceneCutRate: 0.3,
};

describe("scoreNiche / normalizeSignals", () => {
  it("ignore les dimensions dont le signal est absent (ni numérateur ni dénominateur)", () => {
    const weights = { speechRate: 0.5, contentVoiceRatio: 0.5, facecamPresence: 1, greenScreenRatio: 0, multiSpeakerCount: 1, onScreenMotion: 0 };
    const normalized = normalizeSignals({ wordsPerSec: 2, contentVoiceShare: null, faceScore: null, greenShare: 0, sceneCutRate: null });
    // Seul speechRate (0.5) et greenScreenRatio (0 avec poids 0) ont une valeur : contentVoiceRatio,
    // facecamPresence et multiSpeakerCount (toujours null, pas encore de signal local) sont ignorés.
    const speechRateNormalized = 2 / 3.5;
    expect(scoreNiche(weights, normalized)).toBeCloseTo((0.5 * speechRateNormalized + 0 * 0) / (0.5 + 0), 5);
  });

  it("multiSpeakerCount est toujours normalisé à null : aucun signal local ne l'alimente", () => {
    expect(normalizeSignals(FOOTBALL_SIGNALS).multiSpeakerCount).toBeNull();
  });
});

describe("classifyLocally", () => {
  it("classe localement avec confiance >= 0.7 des signaux très marqués (vert + débit sportif), sans appeler Claude", () => {
    const result = classifyLocally(FOOTBALL_SIGNALS);
    expect(result.nicheId).toBe("football");
    expect(result.confidence).toBeGreaterThanOrEqual(CONFIDENCE_THRESHOLD);
  });

  it("une niche connait un score inférieur au seuil sur des signaux ambigus", () => {
    const result = classifyLocally(AMBIGUOUS_SIGNALS);
    expect(result.confidence).toBeLessThan(CONFIDENCE_THRESHOLD);
  });
});

describe("classifyNiche (hybride, cas local)", () => {
  it("des signaux très marqués sont classés localement : aucune ligne llm_calls ajoutée", async () => {
    const db = freshDb();
    db.insert(schema.sources).values({ id: "src-football", title: "Résumé du match", originalPath: "sources/src-football/original.mp4" }).run();
    const source = db.select().from(schema.sources).where(eq(schema.sources.id, "src-football")).get()!;

    const result = await classifyNiche(db, source, FOOTBALL_SIGNALS);

    expect(result.niche).toBe("football");
    expect(result.source).toBe("auto");
    expect(result.confidence).toBeGreaterThanOrEqual(CONFIDENCE_THRESHOLD);
    const calls = db.select().from(schema.llmCalls).all();
    expect(calls).toHaveLength(0);
  });
});

describe("summarizeSignals", () => {
  it("rend les signaux connus en pourcentage et les signaux manquants comme 'inconnu'", () => {
    const text = summarizeSignals({ wordsPerSec: null, contentVoiceShare: 0.5, faceScore: null, greenShare: 1, sceneCutRate: null });
    expect(text).toContain("débit de parole inconnu");
    expect(text).toContain("vert à l'écran 100%");
    expect(text).toContain("facecam inconnu");
  });
});

describe("findSimilarManualExamples", () => {
  it("retourne les corrections manuelles les plus proches, triées, en excluant la source elle-même", () => {
    const db = freshDb();
    const insertManual = (id: string, niche: string, signals: NicheLocalSignals) =>
      db.insert(schema.sources).values({
        id,
        title: id,
        originalPath: `sources/${id}/original.mp4`,
        niche,
        nicheSource: "manual",
        nicheConfidence: 1,
        nicheSignals: signals,
      }).run();

    insertManual("near", "podcast", { wordsPerSec: 2, contentVoiceShare: 0.9, faceScore: 0.5, greenShare: 0.05, sceneCutRate: 0.1 });
    insertManual("far", "gaming", { wordsPerSec: 0.2, contentVoiceShare: 0.1, faceScore: 0.9, greenShare: 0, sceneCutRate: 1 });
    insertManual("itself", "humour", { wordsPerSec: 2, contentVoiceShare: 0.9, faceScore: 0.5, greenShare: 0.05, sceneCutRate: 0.1 });
    // Pas une correction manuelle : ne doit jamais apparaître dans les exemples.
    db.insert(schema.sources).values({ id: "auto-only", title: "auto-only", originalPath: "sources/auto-only/original.mp4", niche: "podcast", nicheSource: "auto", nicheConfidence: 0.8 }).run();

    const current: NicheLocalSignals = { wordsPerSec: 2.1, contentVoiceShare: 0.88, faceScore: 0.48, greenShare: 0.06, sceneCutRate: 0.12 };
    const examples = findSimilarManualExamples(db, current, "itself");

    expect(examples.map((e) => e.niche)).toEqual(["podcast", "gaming"]);
  });
});

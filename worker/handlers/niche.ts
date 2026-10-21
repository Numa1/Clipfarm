import { eq } from "drizzle-orm";
import type { DB } from "@/server/db";
import { sources } from "@/server/db/schema";
import { classifyNiche, localSignalsForSource } from "@/server/niche";

/**
 * Détermine la niche d'une source (vague 4, tâche N3) : score local d'abord, Claude en repli si
 * besoin (voir src/server/niche.ts). N'enfile aucun job suivant : c'est src/server/pipeline.ts qui
 * décide de la chaîne (transcribe -> niche -> moments), suivant la même règle que la tâche F3.
 *
 * Une correction manuelle n'est jamais écrasée automatiquement : si `sources.nicheSource` vaut déjà
 * "manual" pour cette source, ce handler ne fait rien.
 */
export async function assignNiche(db: DB, payload: { sourceId: string }, signal?: AbortSignal) {
  const source = db.select().from(sources).where(eq(sources.id, payload.sourceId)).get();
  if (!source) throw new Error("source not found");

  if (source.nicheSource === "manual") {
    return { skipped: true, reason: "correction manuelle conservée" };
  }

  const localSignals = await localSignalsForSource(db, source.id, signal);
  const result = await classifyNiche(db, source, localSignals, signal);
  db.update(sources)
    .set({ niche: result.niche, nicheConfidence: result.confidence, nicheSignals: result.signals, nicheSource: result.source })
    .where(eq(sources.id, source.id))
    .run();

  return { niche: result.niche, confidence: result.confidence, source: result.source };
}

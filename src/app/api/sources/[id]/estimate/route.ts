import { eq } from "drizzle-orm";
import { HttpError, route } from "@/server/api";
import { getDb } from "@/server/db";
import { sources, transcripts } from "@/server/db/schema";
import { estimateForSource, wordCountOfTranscript } from "@/server/estimate";

/**
 * Estimation du coût d'analyse AVANT de la lancer (voir src/server/estimate.ts) : basée sur la
 * transcription si elle existe déjà, sinon sur la durée de la vidéo, sinon une erreur.
 */
export const GET = route({ path: "/api/sources/[id]/estimate" }, ({ params: { id } }) => {
  const db = getDb();
  const source = db.select().from(sources).where(eq(sources.id, id)).get();
  if (!source) throw new HttpError(404, "not_found", "not found");

  const tr = db.select({ json: transcripts.json }).from(transcripts).where(eq(transcripts.sourceId, id)).get();
  const wordCount = tr ? wordCountOfTranscript(tr.json.words) : null;

  const estimate = estimateForSource({ wordCount, durationSec: source.durationSec });
  if (!estimate) {
    throw new HttpError(
      409,
      "conflict",
      "impossible d'estimer le coût : ni transcription ni durée connue pour cette source",
    );
  }
  return Response.json(estimate);
});

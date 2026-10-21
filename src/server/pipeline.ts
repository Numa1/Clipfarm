import type { DB } from "./db";
import type { Job, JobType } from "./db/schema";
import { enqueueJob } from "./jobs";

/**
 * Déclaration centrale des enchaînements de jobs : avant la vague 3, chaque handler enfilait lui-même
 * le job suivant ("ingest" enfilait "transcribe", "transcribe" enfilait "moments", et la création d'un
 * projet enfilait "reframe"), ce qui dispersait cet enchaînement dans plusieurs fichiers. Il est
 * maintenant décidé à un seul endroit, et appliqué depuis le point d'ancrage générique de
 * worker/index.ts (une fois qu'un job se termine avec succès) et depuis l'événement "projet créé".
 */

/**
 * Chaîne d'un job terminé vers les jobs suivants à enfiler pour la même source. Partiel : un type de
 * job qui ne déclenche rien (comme "moments" aujourd'hui) n'a pas d'entrée.
 *
 * Vague 4 : "niche" s'insère entre "transcribe" et "moments" (transcribe -> niche -> moments) ; cette
 * table est volontairement une simple liste par type plutôt qu'une chaîne figée, pour permettre
 * d'insérer une étape sans toucher aux autres entrées.
 */
const SOURCE_PIPELINE: Partial<Record<JobType, JobType[]>> = {
  ingest: ["transcribe"],
  transcribe: ["niche"],
  niche: ["moments"],
};

/**
 * Jobs à enfiler côté source quand le job `type` vient de se terminer avec succès. `payload` est le
 * payload du job terminé et `result` son résultat (non utilisés pour l'instant, mais une future étape
 * de la chaîne — comme la niche — pourra en avoir besoin pour décider quoi enfiler).
 */
export function nextJobsAfter(
  db: DB,
  type: JobType,
  payload: Record<string, unknown>,
  result: Record<string, unknown>,
): Job[] {
  void result;
  const nextTypes = SOURCE_PIPELINE[type];
  if (!nextTypes || nextTypes.length === 0) return [];
  const sourceId = typeof payload.sourceId === "string" ? payload.sourceId : null;
  if (!sourceId) return [];
  return nextTypes.map((nextType) => enqueueJob(db, nextType, { sourceId }));
}

/**
 * Jobs à enfiler quand un projet vient d'être créé. Les "hooks" de la vague 5 (déclenchés par
 * d'autres événements) s'ajouteront à côté de cette déclaration.
 */
const PROJECT_CREATED_PIPELINE: JobType[] = ["reframe"];

/** À appeler juste après la création d'un projet (voir src/server/projects.ts, createProject). */
export function onProjectCreated(db: DB, projectId: string): Job[] {
  return PROJECT_CREATED_PIPELINE.map((type) => enqueueJob(db, type, { projectId }));
}

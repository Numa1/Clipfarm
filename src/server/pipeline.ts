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
  const sourceId = typeof payload.sourceId === "string" ? payload.sourceId : null;
  const projectId = typeof payload.projectId === "string" ? payload.projectId : null;

  const bySource = sourceId ? (SOURCE_PIPELINE[type] ?? []).map((nextType) => enqueueJob(db, nextType, { sourceId })) : [];
  const byProject = projectId ? (PROJECT_PIPELINE[type] ?? []).map((nextType) => enqueueJob(db, nextType, { projectId })) : [];
  return [...bySource, ...byProject];
}

/**
 * Jobs à enfiler quand un projet vient d'être créé : recadrage auto, puis génération des accroches
 * (vague 5, tâche H2 — projet créé -> reframe -> hooks), une fois le recadrage terminé pour ne pas
 * faire porter les deux jobs "light"/"heavy" en parallèle sur le même projet tout neuf.
 */
const PROJECT_CREATED_PIPELINE: JobType[] = ["reframe"];

/** Jobs à enfiler côté projet quand le job `type` vient de se terminer avec succès (même rôle que
 *  `SOURCE_PIPELINE`, mais côté projet plutôt que côté source). */
const PROJECT_PIPELINE: Partial<Record<JobType, JobType[]>> = {
  reframe: ["hooks"],
};

/** À appeler juste après la création d'un projet (voir src/server/projects.ts, createProject). */
export function onProjectCreated(db: DB, projectId: string): Job[] {
  return PROJECT_CREATED_PIPELINE.map((type) => enqueueJob(db, type, { projectId }));
}

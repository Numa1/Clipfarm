import { eq } from "drizzle-orm";
import { z } from "zod";
import { nicheConfig } from "@/config/niches";
import { hooksPrompt, type HookPromptCandidate } from "@/prompts/hooks";
import type { DB } from "@/server/db";
import { moments, projects, sources, transcripts, type Word } from "@/server/db/schema";
import { detectHookCandidates } from "@/server/hooks/candidates";
import { callClaude } from "@/server/llm";
import { resolveInLibrary } from "@/server/paths";
import { writeTimeline } from "@/server/timeline-store";
import { stylePreset } from "@/styles/presets";
import { applyCommand } from "@/timeline/commands";
import { hookSchema, parseTimeline } from "@/timeline/schema";
import { transcriptLines } from "../voices";
import { extractJson } from "./moments";

/**
 * Génère les accroches d'un projet (vague 5, tâche H2) : classe les candidats locaux détectés par
 * src/server/hooks/candidates.ts (sans LLM) et écrit 3 à 5 variantes d'accroche complètes via Claude
 * (src/prompts/hooks.ts), en tenant compte de la niche (src/config/niches.ts) et du style de montage
 * retenu (src/styles/presets.ts). Le résultat remplace `meta.hooks` de la timeline du projet
 * (commande sérialisable "setHook", voir src/timeline/commands.ts) ; le coût de l'appel Claude est
 * attribué au PROJET ("projectId"), pas à la source — c'est le projet, pas la source brute, qui
 * consomme cette fonctionnalité.
 *
 * N'enfile aucun job suivant : comme pour toutes les tâches depuis la vague 3 (voir "niche"), c'est
 * src/server/pipeline.ts qui décide de la chaîne.
 */

const hookVariantSchema = z.object({ text: z.string().min(1), score: z.number().min(0).max(100) });
const hookResponseSchema = z.object({
  variants: z.array(hookVariantSchema).min(3).max(5),
  chosen: z.number().int().min(0),
  reason: z.string().optional(),
});

const HOOKS_JSON_SCHEMA = JSON.stringify(z.toJSONSchema(hookResponseSchema));

/** Extrait "[secondes] texte" (une ligne par phrase environ) pour la plage [from, to], pour garder le prompt compact. */
function transcriptExcerpt(words: Word[], from: number, to: number): string {
  const inRange = words.filter((w) => w.end > from && w.start < to);
  if (!inRange.length) return "(transcription indisponible)";
  return transcriptLines(inRange)
    .map((l) => `[${l.start.toFixed(1)}] ${l.words.map((w) => w.w).join(" ")}`)
    .join("\n");
}

/** Un index de "chosen" hors bornes (réponse de Claude mal formée) retombe sur la première variante plutôt que de planter. */
function clampChosen(chosen: number, length: number): number {
  return Math.min(Math.max(chosen, 0), length - 1);
}

export async function generateHooks(db: DB, payload: { projectId: string }, signal?: AbortSignal) {
  const project = db.select().from(projects).where(eq(projects.id, payload.projectId)).get();
  if (!project) throw new Error("project not found");
  if (!project.momentId) throw new Error("projet sans moment associé : impossible de générer des accroches");
  if (!project.sourceId) throw new Error("projet sans source associée : impossible de générer des accroches");

  const moment = db.select().from(moments).where(eq(moments.id, project.momentId)).get();
  if (!moment) throw new Error("moment introuvable");
  const source = db.select().from(sources).where(eq(sources.id, project.sourceId)).get();
  if (!source) throw new Error("source introuvable");

  const tr = db.select().from(transcripts).where(eq(transcripts.sourceId, source.id)).get();
  const words = tr?.json.words ?? [];

  const niche = source.niche ? nicheConfig(source.niche) : undefined;
  const styleId = project.styleId ?? niche?.defaultStyle;
  const style = styleId ? stylePreset(styleId) : undefined;

  const relPath = source.proxyPath ?? source.originalPath;
  const file = resolveInLibrary(relPath);
  const candidates = file ? await detectHookCandidates(file, words, moment.start, moment.end, { signal }) : [];
  const promptCandidates: HookPromptCandidate[] = candidates.map((c) => ({
    time: c.time,
    reason: c.reason,
    score: c.score,
    text: c.text,
  }));

  const prompt = hooksPrompt.build({
    title: source.title,
    creator: source.creator,
    nicheHint: niche?.promptHint ?? "Niche indéterminée : reste générique.",
    styleHint: style?.momentPromptHint ?? "Style indéterminé : reste générique.",
    styleTone: style?.hook.tone ?? "percutant",
    candidates: promptCandidates,
    transcriptExcerpt: transcriptExcerpt(words, moment.start, moment.end),
  });

  const envelope = await callClaude({
    db,
    system: hooksPrompt.system,
    prompt,
    jsonSchema: HOOKS_JSON_SCHEMA,
    promptId: hooksPrompt.id,
    promptVersion: hooksPrompt.version,
    purpose: "hooks",
    projectId: project.id,
    signal,
  });

  const parsed = hookResponseSchema.parse(envelope.structured_output ?? extractJson(envelope.result ?? ""));
  const chosen = clampChosen(parsed.chosen, parsed.variants.length);
  const hooks = parsed.variants.map((v, i) =>
    hookSchema.parse({ text: v.text, score: v.score, kind: i === chosen ? "retenue" : "variante" }),
  );

  const tl = applyCommand(parseTimeline(project.timeline), { type: "setHook", hooks });
  const written = writeTimeline(db, {
    projectId: project.id,
    baseRevision: project.revision,
    timeline: tl,
    actor: "system",
    ops: [{ type: "setHook", hooks }],
  });

  return { variants: hooks.length, chosen, revision: written.revision };
}

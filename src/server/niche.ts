import path from "node:path";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { isNicheId, NICHE_LIST, type NicheId, type NicheSignalWeights } from "@/config/niches";
import { nichePrompt } from "@/prompts/niche";
import type { DB } from "@/server/db";
import { sources, transcripts, type Source, type Word } from "@/server/db/schema";
import { callClaude } from "@/server/llm";
import { resolveInLibrary } from "@/server/paths";
import { run } from "../../worker/exec";
import { computeBaseSignals } from "../../worker/signals";
import { transcriptLines } from "../../worker/voices";

/**
 * Logique hybride de classification de niche (vague 4, tâche N3) : un score local gratuit d'abord
 * (signaux déjà en base + scripts/probe.py, aucun appel Claude), et seulement en repli, quand ce
 * score est trop incertain, un appel à Claude avec src/prompts/niche.ts pour trancher.
 */

/** Sous ce seuil de confiance, on ne fait pas confiance au score local seul : Claude tranche. */
export const CONFIDENCE_THRESHOLD = 0.7;

/**
 * Signaux locaux utilisés pour le score par niche, gratuits (pas d'appel Claude) : une partie vient
 * de la transcription déjà en base (worker/signals.ts), une partie de l'analyse vidéo
 * (scripts/probe.py). Stockée telle quelle dans `sources.nicheSignals` pour l'audit et pour servir
 * d'exemple aux classifications futures (voir `findSimilarManualExamples`).
 *
 * Note : `NicheSignalWeights.multiSpeakerCount` (src/config/niches.ts) n'a pas encore de signal
 * local correspondant — la diarisation (worker/voices.ts) ne distingue aujourd'hui que la voix du
 * créateur de celle du contenu, pas le nombre de locuteurs distincts côté créateur (interview à
 * plusieurs vs solo). Ce poids est donc ignoré du score tant qu'aucun champ ne l'alimente ici (voir
 * `normalizeSignals` : il est toujours `null`), plutôt que d'inventer une valeur arbitraire.
 */
export type NicheLocalSignals = {
  /** Mots/seconde du créateur (worker/signals.ts, BaseSignals.wordsPerSec). */
  wordsPerSec: number | null;
  /** Part de voix "contenu" dans la transcription (worker/signals.ts, BaseSignals.contentVoiceShare). */
  contentVoiceShare: number | null;
  /** Part des frames échantillonnées où un visage est détecté (scripts/probe.py, faceScore). */
  faceScore: number | null;
  /** Part moyenne de pixels "vert terrain" à l'écran (scripts/probe.py, greenShare). */
  greenShare: number | null;
  /** Coupures de plan par seconde (scripts/probe.py, sceneCutRate) : proxy pour l'activité à l'écran. */
  sceneCutRate: number | null;
};

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

/** Débit (mots/s) à partir duquel le signal "speechRate" compte comme maximal (1.0) une fois normalisé. */
const SPEECH_RATE_MAX = 3.5;
/** Coupures/s à partir desquelles le signal "onScreenMotion" compte comme maximal (1.0) une fois normalisé. */
const MOTION_MAX = 1.2;

/** Convertit les signaux locaux bruts dans l'échelle [0,1] de `NicheSignalWeights`, dimension par dimension. */
export function normalizeSignals(signals: NicheLocalSignals): Record<keyof NicheSignalWeights, number | null> {
  return {
    speechRate: signals.wordsPerSec == null ? null : clamp01(signals.wordsPerSec / SPEECH_RATE_MAX),
    contentVoiceRatio: signals.contentVoiceShare,
    facecamPresence: signals.faceScore,
    greenScreenRatio: signals.greenShare,
    // Pas de signal local pour cette dimension (voir le commentaire sur NicheLocalSignals) : elle
    // n'intervient donc jamais dans scoreNiche tant que ce champ reste null.
    multiSpeakerCount: null,
    onScreenMotion: signals.sceneCutRate == null ? null : clamp01(signals.sceneCutRate / MOTION_MAX),
  };
}

/**
 * Score [0,1] d'une niche : moyenne pondérée des dimensions disponibles. Une dimension dont le
 * signal est `null` (non mesuré) n'intervient ni au numérateur ni au dénominateur, pour ne pas
 * biaiser le score vers le bas simplement parce qu'un signal manque.
 */
export function scoreNiche(weights: NicheSignalWeights, normalized: Record<keyof NicheSignalWeights, number | null>): number {
  let num = 0;
  let den = 0;
  for (const key of Object.keys(weights) as (keyof NicheSignalWeights)[]) {
    const value = normalized[key];
    if (value == null) continue;
    num += weights[key] * value;
    den += weights[key];
  }
  return den > 0 ? num / den : 0;
}

export type NicheScore = { id: NicheId; score: number };

/** Score chaque niche de la taxonomie à partir des signaux locaux, triées du meilleur au pire score. */
export function scoreAllNiches(signals: NicheLocalSignals): NicheScore[] {
  const normalized = normalizeSignals(signals);
  return NICHE_LIST.map((n) => ({ id: n.id as NicheId, score: scoreNiche(n.signalWeights, normalized) })).sort(
    (a, b) => b.score - a.score,
  );
}

export type LocalClassification = { nicheId: NicheId; confidence: number; scores: NicheScore[] };

/** Classification purement locale (aucun appel réseau, aucun coût) : la meilleure niche et son score. */
export function classifyLocally(signals: NicheLocalSignals): LocalClassification {
  const scores = scoreAllNiches(signals);
  const best = scores[0] ?? { id: "autre" as NicheId, score: 0 };
  return { nicheId: best.id, confidence: best.score, scores };
}

/** Résumé en français des signaux : utilisé dans le prompt Claude et pour comparer deux jeux de signaux. */
export function summarizeSignals(signals: NicheLocalSignals): string {
  const pct = (v: number | null) => (v == null ? "inconnu" : `${Math.round(clamp01(v) * 100)}%`);
  return [
    signals.wordsPerSec == null ? "débit de parole inconnu" : `débit de parole ${signals.wordsPerSec.toFixed(1)} mots/s`,
    `voix "contenu" ${pct(signals.contentVoiceShare)}`,
    `facecam ${pct(signals.faceScore)}`,
    `vert à l'écran ${pct(signals.greenShare)}`,
    signals.sceneCutRate == null ? "activité à l'écran inconnue" : `activité à l'écran ${signals.sceneCutRate.toFixed(2)} coupures/s`,
  ].join(", ");
}

const PROBE_SCRIPT = path.join(process.cwd(), "scripts", "probe.py");

const probeOutputSchema = z.object({
  sceneCutRate: z.number(),
  hasFace: z.boolean(),
  faceScore: z.number(),
  greenShare: z.number(),
});

/**
 * Lance scripts/probe.py sur la vidéo de la source (le proxy si disponible, sinon l'original) et en
 * tire les signaux visuels. `null` quand il n'y a pas de fichier vidéo résoluble, ou quand `uv`/opencv
 * ne sont pas disponibles sur la machine (ingest/transcribe en dépendent déjà, mais on ne veut pas
 * qu'une analyse vidéo cassée bloque la classification : la logique hybride retombe alors sur les
 * seuls signaux texte, voire sur l'appel à Claude si ça ne suffit pas).
 */
async function probeSource(
  source: Pick<Source, "proxyPath" | "originalPath">,
  signal?: AbortSignal,
): Promise<Pick<NicheLocalSignals, "faceScore" | "greenShare" | "sceneCutRate"> | null> {
  const relPath = source.proxyPath ?? source.originalPath;
  const file = relPath && resolveInLibrary(relPath);
  if (!file) return null;
  try {
    // --keyframes 1 : on ne se sert pas des images (voir src/prompts/niche.ts), inutile d'en payer
    // le coût (encodage JPEG + base64) pour chaque frame par défaut.
    const out = await run("uv", ["run", "--quiet", PROBE_SCRIPT, file, "--keyframes", "1"], { signal });
    const parsed = probeOutputSchema.parse(JSON.parse(out));
    return { faceScore: parsed.faceScore, greenShare: parsed.greenShare, sceneCutRate: parsed.sceneCutRate };
  } catch {
    return null;
  }
}

/** Rassemble les signaux locaux (transcription en base + probe.py) pour une source. */
export async function localSignalsForSource(db: DB, sourceId: string, signal?: AbortSignal): Promise<NicheLocalSignals> {
  const source = db.select().from(sources).where(eq(sources.id, sourceId)).get();
  if (!source) throw new Error("source not found");
  const transcript = db.select().from(transcripts).where(eq(transcripts.sourceId, sourceId)).get();
  const base = computeBaseSignals(source, transcript?.json.words ?? null);
  const probe = await probeSource(source, signal);
  return {
    wordsPerSec: base.wordsPerSec,
    contentVoiceShare: base.contentVoiceShare,
    faceScore: probe?.faceScore ?? null,
    greenShare: probe?.greenShare ?? null,
    sceneCutRate: probe?.sceneCutRate ?? null,
  };
}

/** Distance euclidienne entre deux jeux de signaux normalisés ; une dimension manquante d'un côté ou de l'autre est ignorée. */
function signalDistance(a: Record<string, number | null>, b: Record<string, number | null>): number {
  let sumSq = 0;
  let n = 0;
  for (const key of Object.keys(a)) {
    const av = a[key];
    const bv = b[key];
    if (av == null || bv == null) continue;
    sumSq += (av - bv) ** 2;
    n++;
  }
  return n > 0 ? Math.sqrt(sumSq / n) : Infinity; // aucune dimension comparable : au plus loin possible
}

const MANUAL_EXAMPLES_LIMIT = 3;

export type ManualExample = { niche: string; signals: NicheLocalSignals };

/**
 * Sources déjà corrigées à la main (sources.nicheSource = "manual") dont les signaux enregistrés au
 * moment de la correction (sources.nicheSignals) sont les plus proches des signaux actuels : servent
 * d'exemples few-shot dans le prompt Claude, pour calibrer sa réponse sur des cas qu'un humain a déjà
 * tranchés avec un profil de signaux similaire.
 *
 * Approche volontairement simple : une requête qui ramène toutes les corrections manuelles (leur
 * nombre reste de l'ordre de la dizaine à la centaine pour ce produit, un index dédié serait
 * prématuré) puis un tri en mémoire par distance euclidienne sur les signaux normalisés. À revisiter
 * si le volume de corrections manuelles devient significatif.
 */
export function findSimilarManualExamples(db: DB, signals: NicheLocalSignals, excludeSourceId?: string): ManualExample[] {
  const normalized = normalizeSignals(signals);
  const manual = db.select().from(sources).where(eq(sources.nicheSource, "manual")).all();
  return manual
    .filter((r): r is Source & { niche: string; nicheSignals: NicheLocalSignals } => r.id !== excludeSourceId && !!r.niche && !!r.nicheSignals)
    .map((r) => ({ niche: r.niche, signals: r.nicheSignals, distance: signalDistance(normalized, normalizeSignals(r.nicheSignals)) }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, MANUAL_EXAMPLES_LIMIT)
    .map(({ niche, signals: s }) => ({ niche, signals: s }));
}

/** Extrait "[secondes] texte" (une ligne par phrase environ), limité pour garder le prompt compact. */
const TRANSCRIPT_EXCERPT_LINES = 40;

function excerptFromWords(words: Word[]): string {
  if (!words.length) return "(transcription indisponible)";
  return transcriptLines(words)
    .slice(0, TRANSCRIPT_EXCERPT_LINES)
    .map((l) => `[${l.start.toFixed(1)}] ${l.words.map((w) => w.w).join(" ")}`)
    .join("\n");
}

const nicheResponseSchema = z.object({
  niche: z.string(),
  confidence: z.number().min(0).max(1),
  reason: z.string().optional(),
});
const NICHE_JSON_SCHEMA = JSON.stringify(z.toJSONSchema(nicheResponseSchema));

/** Sort la réponse JSON de Claude d'une sortie libre (mêmes aléas que worker/handlers/moments.ts : fences ``` ou prose autour). */
function extractNicheJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const candidate = fenced?.[1] ?? text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  return JSON.parse(candidate);
}

export type NicheClassification = {
  niche: NicheId;
  /** [0,1] : score local si source = "auto", confiance déclarée par Claude si source = "llm". */
  confidence: number;
  /** "auto" = décidé localement (pas d'appel Claude, pas de coût) ; "llm" = Claude a tranché. */
  source: "auto" | "llm";
  /** Signaux locaux ayant servi à la décision (stockés dans sources.nicheSignals pour l'audit et les exemples futurs). */
  signals: NicheLocalSignals;
};

/**
 * Classification hybride d'une source : score local d'abord (gratuit) ; si le meilleur score est
 * sous CONFIDENCE_THRESHOLD, un appel à Claude (src/prompts/niche.ts) tranche à la place.
 *
 * Prend les signaux locaux déjà rassemblés (voir `localSignalsForSource`) plutôt que de les calculer
 * elle-même : ça sépare la logique de décision (pure côté scoring, testable sans DB ni vidéo) de la
 * collecte (DB + scripts/probe.py), et permet de tester le scoring/l'appel Claude avec des signaux
 * construits à la main.
 */
export async function classifyNiche(
  db: DB,
  source: Pick<Source, "id" | "title" | "creator">,
  localSignals: NicheLocalSignals,
  signal?: AbortSignal,
): Promise<NicheClassification> {
  const local = classifyLocally(localSignals);
  if (local.confidence >= CONFIDENCE_THRESHOLD) {
    return { niche: local.nicheId, confidence: local.confidence, source: "auto", signals: localSignals };
  }

  const tr = db.select().from(transcripts).where(eq(transcripts.sourceId, source.id)).get();
  const examples = findSimilarManualExamples(db, localSignals, source.id);
  const prompt = nichePrompt.build({
    title: source.title,
    creator: source.creator,
    signalsSummary: summarizeSignals(localSignals),
    transcriptExcerpt: excerptFromWords(tr?.json.words ?? []),
    examples: examples.map((e) => ({ niche: e.niche, signalsSummary: summarizeSignals(e.signals) })),
  });

  const envelope = await callClaude({
    db,
    system: nichePrompt.system,
    prompt,
    jsonSchema: NICHE_JSON_SCHEMA,
    promptId: nichePrompt.id,
    promptVersion: nichePrompt.version,
    purpose: "niche",
    sourceId: source.id,
    signal,
  });
  const parsed = nicheResponseSchema.parse(envelope.structured_output ?? extractNicheJson(envelope.result ?? ""));
  // Repli sur le meilleur candidat local si Claude répond un identifiant hors taxonomie : jamais de
  // niche invalide en base.
  const niche = isNicheId(parsed.niche) ? parsed.niche : local.nicheId;
  return { niche, confidence: clamp01(parsed.confidence), source: "llm", signals: localSignals };
}

import { estimateCostUsd } from "@/config/pricing";

/**
 * Estimation du coût d'analyse d'une source, AVANT même d'appeler Claude : à partir du nombre de
 * mots de sa transcription (ou, si elle n'existe pas encore, de la durée de la vidéo), on approxime
 * un nombre de tokens d'entrée, puis on applique les tarifs de src/config/pricing.ts et le nombre de
 * passes attendu pour obtenir un coût. C'est une estimation grossière (±30% visé, voir estimate.test.ts),
 * pas une facturation : le coût réel est celui enregistré dans "llm_calls" (src/server/llm.ts).
 */

/**
 * Tokens par mot pour une transcription en français. Le français utilise en moyenne plus de tokens
 * par mot que l'anglais (accords, élisions, mots composés) ; 1,3 est une approximation simple à
 * ajuster si on mesure mieux (par exemple en comparant à "input_tokens" des appels déjà enregistrés).
 */
export const TOKENS_PER_WORD_FR = 1.3;

/** Débit de parole moyen en français (~150 mots/minute), pour estimer un nombre de mots depuis une durée. */
export const WORDS_PER_SECOND_FR = 2.5;

/**
 * Tokens fixes du prompt système de la détection de moments (src/prompts/moments.ts), qui s'ajoutent
 * aux tokens de la transcription elle-même. Mesuré approximativement sur ce prompt (~500 mots) ; à
 * revoir si le prompt change significativement de taille (son "version" change alors aussi).
 */
export const SYSTEM_PROMPT_OVERHEAD_TOKENS = 700;

/**
 * Tokens de sortie attendus pour un appel qui renvoie une liste de moments (JSON structuré,
 * 5 à 10 moments avec titre, accroche, citation...). Peu sensible à la longueur de la transcription :
 * on garde une moyenne constante plutôt que de tenter de la dériver du nombre de mots.
 */
export const OUTPUT_TOKENS_PER_PASS = 900;

export type AnalysisPass = {
  /** Nom de la passe ; correspond à "llm_calls.purpose" quand la passe existe déjà (voir worker/handlers/moments.ts). */
  name: string;
  /**
   * Nombre de fois où cette passe tourne réellement, en moyenne, pour une analyse — pas forcément un
   * entier : une passe qui ne se déclenche que dans certains cas (comme la correction) compte pour une
   * fraction. C'est un multiplicateur appliqué à l'estimation de tokens d'une occurrence de la passe.
   */
  expectedRuns: number;
};

/**
 * Passes réelles ou prévues d'une analyse complète d'une source. Aujourd'hui, une seule passe réelle
 * existe : la détection des moments (findMoments, worker/handlers/moments.ts), avec une correction
 * possible en cas de réponse invalide (voir "askWithRetry" / le round "moments-fix"). Cette liste est
 * volontairement extensible : les vagues suivantes ajouteront ici leurs propres passes à mesure
 * qu'elles seront implémentées (par exemple la détection de niche en N3, les accroches de montage en
 * N4, ou une passe H2) — ne pas deviner leur forme à l'avance, seulement garder la liste facile à
 * étendre et chaque entrée nommée clairement.
 */
export const ANALYSIS_PASSES: readonly AnalysisPass[] = [
  // Détection des moments : un appel systématique par analyse (purpose "moments").
  { name: "moments", expectedRuns: 1 },
  // Correction : un second appel (purpose "moments-fix") ne part que si au moins un moment renvoyé
  // casse une règle (durée, citation non trouvée...) ; on compte une marge d'une chance sur deux.
  { name: "moments-fix", expectedRuns: 0.5 },
  // Vagues suivantes : N3 (niche), N4 (accroches de montage), H2... ajouteront ici leurs propres passes.
];

export type PassEstimate = { name: string; expectedRuns: number; costUsd: number };

export type Estimate = {
  /** D'où vient le nombre de mots : la transcription déjà disponible, ou la durée de la vidéo (approximation plus grossière). */
  basis: "transcript" | "duration";
  /** Nombre de mots utilisé pour le calcul (mesuré ou dérivé de la durée). */
  wordCount: number;
  /** Tokens d'entrée estimés pour UNE occurrence d'une passe (transcription + overhead du prompt système). */
  inputTokensPerPass: number;
  /** Tokens de sortie estimés pour UNE occurrence d'une passe. */
  outputTokensPerPass: number;
  /** Détail par passe (nom, nombre de fois attendu, coût correspondant). */
  passes: PassEstimate[];
  /** Coût total estimé (USD), somme de "passes". */
  costUsd: number;
};

/** Tokens d'entrée estimés pour une occurrence de passe, à partir du nombre de mots de la transcription. */
export function estimateInputTokens(wordCount: number): number {
  return Math.ceil(Math.max(0, wordCount) * TOKENS_PER_WORD_FR) + SYSTEM_PROMPT_OVERHEAD_TOKENS;
}

/** Nombre de mots approximatif d'une vidéo dont on ne connaît que la durée (pas encore transcrite). */
export function estimateWordCountFromDuration(durationSec: number): number {
  return Math.round(Math.max(0, durationSec) * WORDS_PER_SECOND_FR);
}

/**
 * Estimation complète du coût d'analyse d'une source à partir d'un nombre de mots déjà connu
 * (celui de sa transcription). "model" permet de simuler le tarif d'un autre modèle que celui par
 * défaut (src/config/pricing.ts) ; sans valeur connue à l'avance, on prend le tarif par défaut.
 */
export function estimateFromWordCount(wordCount: number, model?: string | null): Estimate {
  const inputTokensPerPass = estimateInputTokens(wordCount);
  const outputTokensPerPass = OUTPUT_TOKENS_PER_PASS;
  const passCostUsd = estimateCostUsd(model ?? null, {
    inputTokens: inputTokensPerPass,
    outputTokens: outputTokensPerPass,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  });
  const passes: PassEstimate[] = ANALYSIS_PASSES.map((p) => ({
    name: p.name,
    expectedRuns: p.expectedRuns,
    costUsd: passCostUsd * p.expectedRuns,
  }));
  return {
    basis: "transcript",
    wordCount,
    inputTokensPerPass,
    outputTokensPerPass,
    passes,
    costUsd: passes.reduce((sum, p) => sum + p.costUsd, 0),
  };
}

/** Même estimation, mais depuis la durée de la vidéo (transcription pas encore disponible). */
export function estimateFromDurationSec(durationSec: number, model?: string | null): Estimate {
  const estimate = estimateFromWordCount(estimateWordCountFromDuration(durationSec), model);
  return { ...estimate, basis: "duration" };
}

/**
 * Estimation pour une source : transcription si elle existe déjà, sinon durée, sinon `null` (ni l'une
 * ni l'autre n'est disponible — à la route d'en faire une erreur 409).
 */
export function estimateForSource(
  source: { wordCount: number | null; durationSec: number | null },
  model?: string | null,
): Estimate | null {
  if (source.wordCount != null) return estimateFromWordCount(source.wordCount, model);
  if (source.durationSec != null) return estimateFromDurationSec(source.durationSec, model);
  return null;
}

/** Nombre de mots d'une transcription déjà stockée (un élément de "words" = un mot, voir src/server/db/schema.ts). */
export function wordCountOfTranscript(words: readonly { w: string }[]): number {
  return words.length;
}

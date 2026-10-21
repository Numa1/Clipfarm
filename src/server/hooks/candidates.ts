import { run } from "../../../worker/exec";
import type { Word } from "@/server/db/schema";

/**
 * Détection GRATUITE (sans LLM) de candidats d'accroche dans un moment, avant de passer la main à
 * Claude (tâche H2) : pics de volume (ffmpeg/ebur128) et phrases marquantes de la transcription
 * (exclamation, question, début de phrase qui accroche). Sert à présélectionner des instants
 * intéressants, pas à juger du fond.
 */

export type HookCandidateReason = "volume" | "exclamation" | "question" | "strong_start";

export type HookCandidate = {
  /** Instant du candidat, en secondes, absolu dans le fichier source. */
  time: number;
  reason: HookCandidateReason;
  /** 0-100, simple heuristique : ne remplace pas un vrai jugement éditorial. */
  score: number;
  /** Texte de la phrase ou extrait concerné, quand disponible (candidats texte). */
  text?: string;
};

// ---------------------------------------------------------------------------
// 1. Pics de volume via ffmpeg (filtre ebur128), sur [from, to] d'un fichier audio/vidéo.
// ---------------------------------------------------------------------------

type LoudnessPoint = { t: number; momentary: number };

/** Une ligne de progression du filtre ebur128, ex: "[Parsed_ebur128_0 @ 0x...] t: 12.345 ... M: -18.2 S:... I: ...". */
const EBUR128_PROGRESS_LINE = /\bt:\s*([\d.]+)\b.*?\bM:\s*(-?[\d.]+|-inf)\b/;

/**
 * Parse la sortie stderr de ffmpeg avec le filtre ebur128 et renvoie, dans l'ordre, les points
 * (instant relatif en secondes, loudness momentanée M en LUFS) des lignes de progression. Les
 * lignes du résumé final ("Summary:", "Integrated loudness:"...) n'ont pas de "t:" et sont ignorées.
 */
export function parseEbur128Output(stderr: string): LoudnessPoint[] {
  const points: LoudnessPoint[] = [];
  for (const line of stderr.split(/\r?\n/)) {
    const m = EBUR128_PROGRESS_LINE.exec(line);
    if (!m) continue;
    const momentary = m[2] === "-inf" ? -Infinity : Number(m[2]);
    points.push({ t: Number(m[1]), momentary });
  }
  return points;
}

/**
 * Garde les pics locaux de loudness momentanée (un point au moins aussi fort que ses deux voisins
 * immédiats), triés du plus fort au plus faible puis limités à `maxPeaks`, et enfin remis dans
 * l'ordre chronologique.
 */
export function findLoudnessPeaks(points: LoudnessPoint[], maxPeaks = 5): LoudnessPoint[] {
  const peaks: LoudnessPoint[] = [];
  for (let i = 0; i < points.length; i++) {
    const cur = points[i];
    if (cur.momentary === -Infinity) continue;
    const prev = points[i - 1];
    const next = points[i + 1];
    if ((!prev || cur.momentary >= prev.momentary) && (!next || cur.momentary >= next.momentary)) peaks.push(cur);
  }
  return peaks
    .sort((a, b) => b.momentary - a.momentary)
    .slice(0, maxPeaks)
    .sort((a, b) => a.t - b.t);
}

/** Score 0-100 approximatif à partir d'une loudness momentanée en LUFS (-23 LUFS ≈ cible broadcast). */
function scoreFromLoudness(lufs: number): number {
  return Math.max(0, Math.min(100, Math.round(100 + lufs)));
}

/**
 * Lance ffmpeg avec le filtre ebur128 sur le passage [from, to] du fichier (audio ou vidéo), et
 * renvoie les instants (en secondes, absolus dans le fichier) des pics de loudness momentanée de ce
 * passage. N'échoue pas si ffmpeg sort en erreur après avoir produit de la sortie exploitable : seule
 * la stderr collectée est utilisée.
 */
export async function detectVolumePeaks(
  filePath: string,
  from: number,
  to: number,
  opts: { signal?: AbortSignal; maxPeaks?: number } = {},
): Promise<HookCandidate[]> {
  let stderr = "";
  await run(
    "ffmpeg",
    ["-ss", String(from), "-to", String(to), "-i", filePath, "-filter:a", "ebur128=peak=true", "-f", "null", "-"],
    { onStderr: (line) => (stderr += line + "\n"), signal: opts.signal },
  ).catch(() => {}); // seule la stderr (progression ebur128) nous intéresse, le code de sortie n'est pas significatif ici
  const peaks = findLoudnessPeaks(parseEbur128Output(stderr), opts.maxPeaks ?? 5);
  return peaks.map((p) => ({ time: from + p.t, reason: "volume", score: scoreFromLoudness(p.momentary) }));
}

// ---------------------------------------------------------------------------
// 2. Phrases marquantes dans la transcription (pure, sans ffmpeg).
// ---------------------------------------------------------------------------

type Sentence = { text: string; start: number; end: number };

const SENTENCE_END = /[.!?…]+$/;

/** Regroupe des mots horodatés en phrases, coupées sur la ponctuation finale (., !, ?, …). */
function splitIntoSentences(words: Word[]): Sentence[] {
  const sentences: Sentence[] = [];
  let buf: Word[] = [];
  for (const w of words) {
    buf.push(w);
    if (SENTENCE_END.test(w.w)) {
      sentences.push({ text: buf.map((x) => x.w).join(" "), start: buf[0].start, end: w.end });
      buf = [];
    }
  }
  if (buf.length) sentences.push({ text: buf.map((x) => x.w).join(" "), start: buf[0].start, end: buf[buf.length - 1].end });
  return sentences;
}

/**
 * Débuts de phrase de "mise en place", qui n'accrochent pas (cf. le prompt de moments.ts : "bon",
 * "alors", "allez les gars"...) : on ne les duplique pas mot pour mot, juste la même intuition, sur
 * le début de la phrase plutôt que sur l'ensemble du vocabulaire.
 */
const FILLER_OPENER = /^(bon|alors|allez|donc|du coup|voila|bah|ben|euh|ok|okay|ecoutez|attend|attends)\b/i;

/** true si la phrase démarre par une formule de mise en place plutôt que par le vif du sujet. */
function isFillerOpener(text: string): boolean {
  const normalized = text
    .trim()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // accents : "voilà" -> "voila", etc.
    .toLowerCase();
  return FILLER_OPENER.test(normalized);
}

/**
 * Détecte, sur une plage de temps [from, to] d'une liste de mots transcrits, les phrases avec un
 * point d'exclamation ou d'interrogation, et le début de phrase du passage quand ce n'est pas une
 * mise en place. Fonction pure : pas d'appel ffmpeg, testable uniquement avec des `Word`.
 */
export function detectTextCandidates(words: Word[], from: number, to: number): HookCandidate[] {
  const inRange = words.filter((w) => w.end > from && w.start < to && !w.vo);
  const sentences = splitIntoSentences(inRange);
  const candidates: HookCandidate[] = [];

  sentences.forEach((s, i) => {
    if (s.text.includes("!")) candidates.push({ time: s.start, reason: "exclamation", score: 70, text: s.text });
    else if (s.text.includes("?")) candidates.push({ time: s.start, reason: "question", score: 65, text: s.text });

    // Le début de phrase qui accroche n'a de sens qu'au tout début du passage étudié (le "start"
    // potentiel d'un moment) : une mise en place plus loin dans le passage n'est pas un problème.
    if (i === 0 && !isFillerOpener(s.text)) candidates.push({ time: s.start, reason: "strong_start", score: 60, text: s.text });
  });

  return candidates;
}

// ---------------------------------------------------------------------------
// 3. Combinaison des deux sources en une liste ordonnée de candidats d'accroche.
// ---------------------------------------------------------------------------

/**
 * Fusionne des candidats (de n'importe quelle source) en une liste triée par instant croissant.
 * Deux candidats à moins de `mergeWindowSec` l'un de l'autre sont fusionnés en un seul (on garde la
 * raison du score le plus élevé, avec un bonus pour le cumul de signaux au même instant) : un pic de
 * volume qui tombe pile sur une phrase choc ne doit pas compter deux fois dans la liste finale.
 */
export function combineHookCandidates(candidates: HookCandidate[], mergeWindowSec = 1.5): HookCandidate[] {
  const sorted = [...candidates].sort((a, b) => a.time - b.time);
  const merged: HookCandidate[] = [];
  for (const c of sorted) {
    const last = merged[merged.length - 1];
    if (last && c.time - last.time <= mergeWindowSec) {
      const bonus = Math.round(c.score / 3);
      if (c.score > last.score) last.reason = c.reason; // la raison la plus forte des deux l'emporte
      last.score = Math.min(100, Math.max(last.score, c.score) + bonus);
      if (c.text && !last.text) last.text = c.text;
    } else {
      merged.push({ ...c });
    }
  }
  return merged.sort((a, b) => a.time - b.time);
}

/**
 * Détecte les candidats d'accroche d'un moment [from, to] : pics de volume (ffmpeg) et phrases
 * marquantes de la transcription (pure), combinés en une seule liste ordonnée.
 */
export async function detectHookCandidates(
  filePath: string,
  words: Word[],
  from: number,
  to: number,
  opts: { signal?: AbortSignal; maxVolumePeaks?: number } = {},
): Promise<HookCandidate[]> {
  const volumeCandidates = await detectVolumePeaks(filePath, from, to, { signal: opts.signal, maxPeaks: opts.maxVolumePeaks });
  const textCandidates = detectTextCandidates(words, from, to);
  return combineHookCandidates([...volumeCandidates, ...textCandidates]);
}

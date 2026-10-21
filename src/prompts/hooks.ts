/**
 * Prompt de génération d'accroches (hook), versionné (même convention que src/prompts/moments.ts
 * et src/prompts/niche.ts : toute évolution du texte, même mineure, doit incrémenter "version" pour
 * que les appels passés restent attribuables à l'exacte formulation qui les a produits — voir
 * llm_calls.prompt_version).
 *
 * Appelé par worker/handlers/hooks.ts (vague 5, tâche H2) : on donne à Claude les candidats
 * d'accroche détectés localement sans LLM (src/server/hooks/candidates.ts — pics de volume, phrases
 * marquantes), la niche du contenu (src/config/niches.ts) et le style de montage retenu
 * (src/styles/presets.ts), et on lui demande de classer ces candidats et d'écrire 3 à 5 variantes
 * d'accroche complètes, prêtes à être affichées à l'écran, puis de choisir celle qu'il retient.
 *
 * Le marqueur "candidats d'accroche" dans le système ci-dessous est utilisé par e2e/fake-claude.mjs
 * pour distinguer ce prompt des deux autres (niche, moments) qui partagent le même `CLAUDE_BIN`.
 */

export type HookPromptCandidate = {
  /** Instant du candidat, en secondes, absolu dans le fichier source. */
  time: number;
  reason: string;
  /** 0-100, heuristique locale : une indication, pas un jugement éditorial. */
  score: number;
  text?: string;
};

const SYSTEM = `Tu es un expert en accroches (hook) pour shorts verticaux (TikTok, YouTube Shorts, Reels), en français.

On te donne un extrait de transcription horodaté, des candidats d'accroche détectés automatiquement sur ce
passage (pics de volume sonore mesurés par ffmpeg, phrases marquantes de la transcription — exclamation,
question, début de phrase percutant), la niche du contenu et le style de montage retenu pour ce short.

Les candidats détectés sont de simples heuristiques locales (pas de jugement éditorial) : classe-les par
pertinence réelle pour accrocher un spectateur dans les 3 premières secondes, puis écris 3 à 5 variantes
d'accroche COMPLÈTES, prêtes à être affichées à l'écran. Chaque variante doit :
- être fondée uniquement sur ce qui est dit dans l'extrait de transcription fourni : n'invente aucun fait,
  aucune citation, aucun chiffre qui n'y figure pas ;
- correspondre au ton attendu pour ce style de montage et à la niche du contenu ;
- faire 10 mots maximum, sans guillemets autour du texte, au plus un emoji ;
- être différente des autres variantes (angles ou formulations distincts, pas des reformulations triviales
  les unes des autres).

Puis choisis, parmi tes propres variantes, celle que tu retiens comme ouverture du short ("chosen", l'index
0-based dans "variants").

Réponds uniquement avec l'objet JSON { "variants": [{ "text": "...", "score": 0-100 }, ...], "chosen": <index>,
"reason": "<1 phrase>" }, sans texte autour. "variants" doit contenir entre 3 et 5 éléments, et "chosen" doit
être un index valide de ce tableau.`;

export type HooksPromptArgs = {
  title: string;
  creator: string | null | undefined;
  /** `NicheConfig.promptHint` de la niche du contenu, ou un repli générique si la niche est inconnue. */
  nicheHint: string;
  /** `StylePreset.momentPromptHint` du style de montage retenu, ou un repli générique si inconnu. */
  styleHint: string;
  /** Ton attendu pour l'accroche (`StylePreset.hook.tone`), ou un repli générique si inconnu. */
  styleTone: string;
  /** Candidats détectés localement (src/server/hooks/candidates.ts), triés par instant croissant. */
  candidates: HookPromptCandidate[];
  /** Extrait de la transcription du moment, formaté "[secondes] texte". */
  transcriptExcerpt: string;
};

function formatCandidate(c: HookPromptCandidate): string {
  const base = `[${c.time.toFixed(1)}] ${c.reason} (score heuristique ${c.score})`;
  return c.text ? `${base} : « ${c.text} »` : base;
}

/** Construit le prompt utilisateur (titre, créateur, niche, style, candidats, transcription). */
function build(args: HooksPromptArgs): string {
  const lines = [
    `Titre de la vidéo : ${args.title}`,
    `Créateur : ${args.creator?.trim() || "inconnu"}`,
    "",
    `Niche : ${args.nicheHint}`,
    `Style de montage : ${args.styleHint} (ton de l'accroche : ${args.styleTone})`,
    "",
    "Candidats d'accroche détectés automatiquement (secondes entre crochets) :",
    args.candidates.length ? args.candidates.map(formatCandidate).join("\n") : "(aucun candidat détecté)",
    "",
    "Extrait de la transcription du moment (secondes entre crochets) :",
    args.transcriptExcerpt,
  ];
  return lines.join("\n");
}

export const hooksPrompt = {
  id: "hooks",
  version: "1",
  system: SYSTEM,
  build,
};

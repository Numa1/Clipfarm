/**
 * Prompt de classification de niche, versionné (même convention que src/prompts/moments.ts : toute
 * évolution du texte, même mineure, doit incrémenter "version" pour que les appels passés restent
 * attribuables à l'exacte formulation qui les a produits — voir llm_calls.prompt_version).
 *
 * Appelé seulement en repli, quand les signaux locaux (src/server/niche.ts) ne suffisent pas à
 * trancher (meilleur score < 0,7) : on donne à Claude un résumé de ces signaux, un extrait de la
 * transcription, et, s'il y en a, des exemples de sources déjà corrigées manuellement par un humain
 * dont les signaux sont proches — pour calibrer sa réponse sur des cas déjà tranchés.
 *
 * Images (repli texte seul, documenté) : scripts/probe.py sait extraire des images clés
 * ("keyframes") de la vidéo, et l'idée de départ était de les joindre à cet appel pour aider Claude
 * à voir la facecam, le terrain, etc. Mais src/server/llm.ts (callClaude) n'envoie aujourd'hui qu'un
 * prompt texte à la CLI Claude (`claude -p --output-format json --json-schema ... --system-prompt
 * ...`, l'invite sur stdin) : il n'existe aucun mécanisme pour joindre un fichier ou une image à cet
 * appel, et étendre ce protocole dépasse le périmètre de cette tâche (ça toucherait tous les appelants
 * de callClaude). On se limite donc ici à un repli texte seul : signaux chiffrés + extrait de
 * transcription. Les images clés de probe.py restent calculées (utiles pour debug/QA) mais ne sont
 * pas envoyées ; une vague future pourra les exploiter si callClaude gagne la capacité de joindre des
 * pièces.
 */

import { NICHE_LIST } from "@/config/niches";

const SYSTEM = `Tu es un classifieur de contenu vidéo pour une app de montage de shorts, en français.
On te donne le titre d'une vidéo, le nom du créateur s'il est connu, un résumé des signaux mesurés
automatiquement sur la vidéo (débit de parole du créateur, part de voix "contenu" dans la transcription,
présence d'une facecam, part de vert à l'écran, activité à l'écran) et un extrait de sa transcription
horodatée. Tu reçois parfois aussi des exemples d'autres vidéos déjà classées à la main par un humain,
dont les signaux sont proches des siens : utilise-les pour calibrer ta réponse, ce ne sont pas des règles
absolues (deux vidéos aux signaux proches peuvent être de niches différentes).

Niches possibles (choisis-en une seule, par son identifiant exact) :
${NICHE_LIST.map((n) => `- "${n.id}" (${n.label}) : ${n.promptHint}`).join("\n")}

Réponds uniquement avec l'objet JSON { "niche": "<identifiant>", "confidence": <0..1>, "reason": "<1 phrase>" },
sans texte autour. "niche" doit être EXACTEMENT un des identifiants listés ci-dessus (jamais le libellé).
"confidence" doit refléter ta certitude réelle, pas être systématiquement haute : un score bas est la bonne
réponse sur un contenu ambigu ou hors des niches listées.`;

export type NichePromptExample = {
  /** Identifiant de niche choisi par l'humain pour cet exemple. */
  niche: string;
  /** Résumé en français de ses signaux (voir src/server/niche.ts, summarizeSignals). */
  signalsSummary: string;
};

export type NichePromptArgs = {
  title: string;
  creator: string | null | undefined;
  /** Résumé en français des signaux locaux de la source à classer (summarizeSignals). */
  signalsSummary: string;
  /** Extrait (pas la transcription complète) formaté "[secondes] texte". */
  transcriptExcerpt: string;
  /** Corrections manuelles aux signaux proches, triées de la plus proche à la moins proche. */
  examples: NichePromptExample[];
};

/** Construit le prompt utilisateur (titre, créateur, signaux, transcription, exemples éventuels). */
function build(args: NichePromptArgs): string {
  const lines = [
    `Titre de la vidéo : ${args.title}`,
    `Créateur : ${args.creator?.trim() || "inconnu"}`,
    "",
    `Signaux mesurés automatiquement : ${args.signalsSummary}`,
    "",
    "Extrait de la transcription (secondes entre crochets) :",
    args.transcriptExcerpt,
  ];
  if (args.examples.length) {
    lines.push(
      "",
      "Vidéos déjà classées manuellement par un humain, aux signaux proches (pour calibrer ta réponse, pas une règle absolue) :",
      ...args.examples.map((e, i) => `${i + 1}. niche "${e.niche}" — signaux : ${e.signalsSummary}`),
    );
  }
  return lines.join("\n");
}

export const nichePrompt = {
  id: "niche",
  version: "1",
  system: SYSTEM,
  build,
};

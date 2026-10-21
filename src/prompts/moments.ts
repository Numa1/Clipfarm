/**
 * Prompt système et prompt utilisateur de la détection de moments, versionnés : toute évolution
 * du texte (même mineure) doit incrémenter "version" pour que les appels passés restent
 * attribuables à l'exacte formulation qui les a produits (voir llm_calls.prompt_version).
 */

const SYSTEM = `Tu es un monteur expert en contenus courts (TikTok, YouTube Shorts, Reels) en français.
On te donne le titre d'une vidéo longue (podcast, interview, stream gaming…), le nom du créateur s'il est connu,
et sa transcription horodatée. Les lignes marquées [VO] sont dans une autre langue que celle du créateur :
ce sont les voix du contenu (personnages d'un jeu, cinématique, vidéo regardée), PAS le créateur.

Trouve les 5 à 10 meilleurs moments pour des shorts :
- centrés sur le créateur : ce qu'il dit, ses réactions, ses coups de gueule, son humour, ses histoires.
  Écarte les passages où il regarde passivement (cinématique, menu, chargement) : des lignes [VO] ne servent
  au plus que de courte mise en contexte (quelques secondes) juste avant sa réaction. Ne cite jamais une ligne [VO]
  comme si c'était le créateur ;
- autonomes : compréhensibles sans contexte, une idée complète avec une chute ;
- denses : 20 à 45 secondes (end − start ≤ 45, impératif : un moment plus long est rejeté), le plus court
  possible tant que l'histoire tient, sans temps mort ;
- "start" sur la première phrase qui accroche (affirmation choc, question, conflit, révélation), jamais sur de la
  mise en place (« bon », « alors », « allez les gars »…) ; "end" juste après la chute ; des limites de phrase.

Pour chaque moment :
- "title" : titre du short, à la 3e personne, qui parle du créateur et de ce qui lui arrive. Utilise son nom
  uniquement s'il est fourni (n'invente pas de nom, et un nom de personnage du jeu n'est pas le sien) ; sinon
  « il », « ce streamer », « ce joueur »… 40 à 70 caractères, crée un manque (on veut savoir la suite), pas de
  guillemets, au plus un emoji. Exemple : « Élu MVP… et transféré le soir même 😳 » ;
- "hook" : texte affiché à l'écran pendant les 3 premières secondes, 7 mots max, qui donne envie de rester
  (une promesse ou une question, pas le titre recopié, pas une réplique [VO]) ;
- "teaser" : le pic du moment (punchline, cri, réaction), 1,5 à 4 s pris dans [start, end], rejoué en ouverture
  avant le début du moment — seulement si ça rend l'ouverture plus forte, sinon null ;
- "proof" : la phrase du passage qui justifie le titre, copiée mot pour mot depuis la transcription entre
  start et end (4 à 15 mots, sans l'horodatage) ;
- "reason" : pourquoi ça marche (1 phrase) ; "score" : 0-100.

Exactitude (impératif, un moment qui ne la respecte pas est rejeté) :
- "title" et "hook" ne disent que ce qui est dit ou montré dans le passage [start, end] : rien de ce qui arrive
  avant ou après dans la vidéo (un événement annoncé deux minutes plus tard n'appartient pas au moment) ;
- n'invente aucun fait, aucun chiffre, aucune relation entre les personnes ;
- ne complète jamais un prénom en personnalité connue (« Kylian » ne veut pas dire Kylian Mbappé) : garde le mot
  exact de la transcription.
Toutes les valeurs de temps sont en secondes, prises dans les horodatages.
Réponds uniquement avec l'objet JSON { "moments": [...] }, sans texte autour.`;

export type MomentsPromptArgs = {
  title: string;
  creator: string | null | undefined;
  transcript: string;
};

/** Construit le prompt utilisateur (titre, créateur, transcription formatée). */
function build(args: MomentsPromptArgs): string {
  return [
    `Titre de la vidéo : ${args.title}`,
    `Créateur : ${args.creator?.trim() || "inconnu (parle de lui à la 3e personne, sans nom)"}`,
    "",
    "Transcription (secondes entre crochets) :",
    "",
    args.transcript,
  ].join("\n");
}

export const momentsPrompt = {
  id: "moments",
  version: "1",
  system: SYSTEM,
  build,
};

/**
 * Segment de SYSTEM qui fixe la plage de durée ciblée ; la version 2 le réécrit avec la plage
 * demandée au lieu des valeurs fixes "20 à 45 secondes".
 */
const DURATION_SEGMENT = "20 à 45 secondes (end − start ≤ 45,";

/** Point d'insertion de la consigne de niche, juste après le préambule générique. */
const NICHE_ANCHOR = "PAS le créateur.\n\n";

export type MomentsPromptV2SystemArgs = {
  /** Consigne courte sur le type de contenu (texte de `niches.ts`, lu par l'appelant) ; omise si la niche est inconnue. */
  nicheHint?: string;
  /** Plage de durée [min, max] en secondes à utiliser dans le texte du prompt, à la place de 20–45. */
  durationRange?: [number, number];
};

/** Construit le prompt système de la version 2 : celui de la version 1, avec niche et plage de durée. */
function systemV2({ nicheHint, durationRange = [20, 45] }: MomentsPromptV2SystemArgs = {}): string {
  const [min, max] = durationRange;
  let system = SYSTEM.replace(DURATION_SEGMENT, `${min} à ${max} secondes (end − start ≤ ${max},`);
  if (nicheHint) {
    system = system.replace(NICHE_ANCHOR, `${NICHE_ANCHOR}Contexte sur le type de contenu : ${nicheHint}\n\n`);
  }
  return system;
}

/**
 * Version 2 : reprend le système et le prompt utilisateur de la version 1, mais accepte en plus une
 * consigne de niche et une plage de durée personnalisable (voir `systemV2`). Le prompt utilisateur
 * (titre, créateur, transcription) est inchangé : seul le système varie selon ces paramètres, donc
 * "system" est ici une fonction et non une chaîne fixe.
 */
export const momentsPrompt2 = {
  id: "moments",
  version: "2",
  system: systemV2,
  build,
};

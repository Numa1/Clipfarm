/**
 * Taxonomie fixe mais extensible des "niches" de contenu (type de vidéo source).
 *
 * Utilisée par :
 * - le classifieur de niche (vague 4), qui s'appuie sur `signalWeights` pour pondérer les
 *   indices détectés automatiquement et choisir la niche la plus probable ;
 * - le prompt de génération de moments (vague 4), qui injecte `promptHint` pour adapter les
 *   instructions données à Claude selon le type de contenu ;
 * - le choix du style par défaut et du mode de recadrage (vagues 4-5), via `defaultStyle` et
 *   `defaultCropMode`.
 *
 * Pour ajouter une niche : ajouter une entrée dans `NICHES` ci-dessous (et uniquement ici).
 * `NICHE_IDS` et le type `NicheId` sont dérivés automatiquement de cet objet.
 */

/**
 * Identifiant de style par défaut. Ce ne sont pour l'instant que des étiquettes : les presets de
 * style complets (couleurs, polices, animations…) arrivent en vague 5.
 */
export type NicheStyleId = "epique" | "chill" | "humour" | "humour-condense";

/** Mode de recadrage par défaut appliqué à une source de cette niche. */
export type CropMode =
  /** Recadrage automatique centré sur le visage / la zone d'intérêt la plus probable. */
  | "auto"
  /** Suivi d'action : la zone recadrée suit le mouvement (ex. le ballon en football). */
  | "follow";

/**
 * Poids des signaux utilisés par le futur classifieur de niche pour distinguer les niches entre
 * elles. Chaque poids est un nombre dans [0, 1] : plus il est élevé, plus ce signal est
 * déterminant pour reconnaître cette niche (0 = signal non pertinent pour cette niche).
 *
 * Les signaux eux-mêmes (débit de parole mesuré, part de voix "contenu" détectée par
 * diarisation, présence d'une facecam détectée par vision, part de vert à l'écran…) sont
 * calculés ailleurs (pipeline d'analyse) ; cette table ne fait qu'indiquer leur importance
 * relative par niche.
 */
export type NicheSignalWeights = {
  /** Importance d'un débit de parole élevé et soutenu (ex. commentaire sportif, podcast rapide). */
  speechRate: number;
  /** Importance d'une part élevée de voix "contenu" (parole exploitable) vs silence/bruit/musique. */
  contentVoiceRatio: number;
  /** Importance de la présence d'une facecam (webcam incrustée) à l'écran. */
  facecamPresence: number;
  /** Importance d'une part élevée de vert à l'écran (terrain de sport, fond vert, jeu en 3D extérieur…). */
  greenScreenRatio: number;
  /** Importance d'un nombre de locuteurs distincts élevé (interview, débat, podcast à plusieurs). */
  multiSpeakerCount: number;
  /** Importance d'une activité à l'écran élevée (mouvement de caméra/jeu important, ex. gaming, sport). */
  onScreenMotion: number;
};

/** Configuration complète d'une niche de contenu. */
export type NicheConfig = {
  /** Identifiant stable, utilisé en base (colonne `sources.niche`) et dans le code. Jamais modifié une fois publié. */
  id: string;
  /** Libellé affichable à l'utilisateur, en français. */
  label: string;
  /** Style de montage appliqué par défaut aux moments de cette niche. */
  defaultStyle: NicheStyleId;
  /** Mode de recadrage appliqué par défaut aux moments de cette niche. */
  defaultCropMode: CropMode;
  /** Poids des signaux utilisés par le classifieur pour reconnaître cette niche. */
  signalWeights: NicheSignalWeights;
  /** Consigne courte en français, destinée à être injectée dans le prompt Claude de génération de moments. */
  promptHint: string;
};

/**
 * Table de configuration des niches. Clé = identifiant stable de la niche (doit être identique à
 * la propriété `id` de la valeur associée).
 *
 * Pour ajouter une niche : ajouter une entrée ici, rien d'autre à modifier.
 */
export const NICHES = {
  gaming: {
    id: "gaming",
    label: "Gaming",
    defaultStyle: "epique",
    defaultCropMode: "auto",
    signalWeights: {
      speechRate: 0.4,
      contentVoiceRatio: 0.5,
      facecamPresence: 0.7,
      greenScreenRatio: 0.1,
      multiSpeakerCount: 0.2,
      onScreenMotion: 0.9,
    },
    promptHint:
      "Contenu de jeu vidéo : privilégie les moments de gameplay marquants (kills, clutchs, fails, réactions) et la facecam du joueur quand elle est présente.",
  },
  football: {
    id: "football",
    label: "Sport",
    defaultStyle: "epique",
    defaultCropMode: "follow",
    signalWeights: {
      speechRate: 0.7,
      contentVoiceRatio: 0.6,
      facecamPresence: 0.1,
      greenScreenRatio: 0.8,
      multiSpeakerCount: 0.3,
      onScreenMotion: 0.8,
    },
    promptHint:
      "Contenu sportif (pas seulement le football) : le commentaire est le contenu principal, il n'y a souvent pas de facecam ; privilégie les temps forts du jeu (buts, actions décisives, célébrations) et le ton du commentateur.",
  },
  podcast: {
    id: "podcast",
    label: "Podcast",
    defaultStyle: "chill",
    defaultCropMode: "auto",
    signalWeights: {
      speechRate: 0.6,
      contentVoiceRatio: 0.9,
      facecamPresence: 0.5,
      greenScreenRatio: 0.05,
      multiSpeakerCount: 0.6,
      onScreenMotion: 0.1,
    },
    promptHint:
      "Podcast : privilégie les répliques fortes, les anecdotes marquantes et les échanges qui se suffisent à eux-mêmes hors contexte.",
  },
  interview: {
    id: "interview",
    label: "Interview",
    defaultStyle: "chill",
    defaultCropMode: "auto",
    signalWeights: {
      speechRate: 0.5,
      contentVoiceRatio: 0.9,
      facecamPresence: 0.6,
      greenScreenRatio: 0.05,
      multiSpeakerCount: 0.8,
      onScreenMotion: 0.1,
    },
    promptHint:
      "Interview : privilégie les questions-réponses complètes et les révélations ou prises de position marquantes d'un intervenant.",
  },
  humour: {
    id: "humour",
    label: "Humour",
    defaultStyle: "humour",
    defaultCropMode: "auto",
    signalWeights: {
      speechRate: 0.5,
      contentVoiceRatio: 0.7,
      facecamPresence: 0.6,
      greenScreenRatio: 0.1,
      multiSpeakerCount: 0.4,
      onScreenMotion: 0.4,
    },
    promptHint:
      "Contenu humoristique : privilégie les blagues, chutes et réactions qui fonctionnent même sans le contexte de la vidéo complète.",
  },
  vlog: {
    id: "vlog",
    label: "Vlog",
    defaultStyle: "chill",
    defaultCropMode: "auto",
    signalWeights: {
      speechRate: 0.4,
      contentVoiceRatio: 0.6,
      facecamPresence: 0.8,
      greenScreenRatio: 0.2,
      multiSpeakerCount: 0.2,
      onScreenMotion: 0.5,
    },
    promptHint:
      "Vlog : privilégie les moments personnels, les anecdotes de vie et les transitions naturelles entre lieux ou activités.",
  },
  education: {
    id: "education",
    label: "Éducation",
    defaultStyle: "chill",
    defaultCropMode: "auto",
    signalWeights: {
      speechRate: 0.5,
      contentVoiceRatio: 0.9,
      facecamPresence: 0.4,
      greenScreenRatio: 0.05,
      multiSpeakerCount: 0.1,
      onScreenMotion: 0.2,
    },
    promptHint:
      "Contenu éducatif : privilégie les explications autonomes et complètes d'une idée, qui ont du sens même isolées du reste.",
  },
  autre: {
    id: "autre",
    label: "Autre",
    defaultStyle: "chill",
    defaultCropMode: "auto",
    signalWeights: {
      speechRate: 0.3,
      contentVoiceRatio: 0.3,
      facecamPresence: 0.3,
      greenScreenRatio: 0.1,
      multiSpeakerCount: 0.3,
      onScreenMotion: 0.3,
    },
    promptHint:
      "Niche indéterminée : reste générique et privilégie les moments qui se suffisent à eux-mêmes, sans supposer de format particulier.",
  },
} as const satisfies Record<string, NicheConfig>;

/** Identifiants valides de niche, dans l'ordre déclaré ci-dessus. */
export const NICHE_IDS = Object.keys(NICHES) as NicheId[];

/** Identifiant de niche (type dérivé de `NICHES`, une seule source de vérité). */
export type NicheId = keyof typeof NICHES;

/** Liste des configurations de niche, dans l'ordre déclaré ci-dessus. */
export const NICHE_LIST: readonly NicheConfig[] = Object.values(NICHES);

/** Vrai si `value` est un identifiant de niche valide. */
export function isNicheId(value: string): value is NicheId {
  return Object.prototype.hasOwnProperty.call(NICHES, value);
}

/** Configuration d'une niche à partir de son identifiant (ou `undefined` si inconnu). */
export function nicheConfig(id: string): NicheConfig | undefined {
  return isNicheId(id) ? NICHES[id] : undefined;
}

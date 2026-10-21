import type { NicheStyleId } from "@/config/niches";
import type { StylePreset } from "./types";

/**
 * Les 4 presets de style complets correspondant aux `NicheStyleId` déclarés dans
 * `src/config/niches.ts`. Cette tâche (vague 5, S1) ne branche rien dans le pipeline : voir la
 * documentation de chaque champ dans `src/styles/types.ts` pour savoir quelle tâche future est
 * censée consommer quelle donnée.
 *
 * Pour ajouter un style : ajouter une entrée ici ET l'identifiant correspondant dans
 * `NicheStyleId` (`src/config/niches.ts`).
 */
export const STYLE_PRESETS = {
  epique: {
    id: "epique",
    label: "Épique",
    // Moments plus longs : on laisse le temps au suspense/à l'action de se déployer (gaming, sport).
    momentDuration: { minSec: 20, maxSec: 50 },
    momentPromptHint:
      "Style épique : privilégie les moments avec une montée en tension nette et une résolution forte (clutch, action décisive, retournement).",
    // Rythme plus lâche : on tolère des silences un peu plus longs (temps de jeu, suspense) sans couper.
    silence: { maxSilence: 1.4, speechPad: 0.3 },
    hook: { teaserDurationSec: 2.5, tone: "percutant" },
    teaser: { enabledByDefault: true, minMomentDurationSec: 25 },
    // Plans tenus plus longtemps pour laisser l'action se lire, facecam plus petite (le contenu prime).
    crop: { holdSec: 2.5, splitRatio: 0.3 },
    caption: { fontSize: 84, fontWeight: 900, color: "#ffe14d", background: "#00000099", y: 0.78 },
    impactZoom: { intensity: 1.25, frequency: "occasionnel" },
    music: { mood: "musique épique/énergique en fond, monte sur les temps forts", defaultVolume: 0.35 },
  },
  chill: {
    id: "chill",
    label: "Chill",
    // Moments plus longs et posés : on laisse une idée/anecdote se dérouler sans la tronquer (podcast, vlog).
    momentDuration: { minSec: 20, maxSec: 55 },
    momentPromptHint:
      "Style chill : privilégie les moments qui se suffisent à eux-mêmes, au ton posé, sans couper une idée ou une anecdote en plein milieu.",
    // Rythme de parole naturel, silences conversationnels tolérés plus largement.
    silence: { maxSilence: 1.2, speechPad: 0.25 },
    hook: { teaserDurationSec: 2, tone: "mysterieux" },
    teaser: { enabledByDefault: false, minMomentDurationSec: 30 },
    // Cadrage stable, peu de changements de plan ; facecam standard (interview/podcast à l'écran).
    crop: { holdSec: 4, splitRatio: 0.4 },
    caption: { fontSize: 64, fontWeight: 700, color: "#ffffff", background: null, y: 0.82 },
    impactZoom: { intensity: 1.05, frequency: "aucun" },
    music: { mood: "fond musical discret et doux, quasi inaudible sous la voix", defaultVolume: 0.12 },
  },
  humour: {
    id: "humour",
    label: "Humour",
    // Moments courts et vifs : la chute doit arriver vite.
    momentDuration: { minSec: 15, maxSec: 35 },
    momentPromptHint:
      "Style humour : privilégie les moments courts qui vont droit à la chute ou à la réaction, sans contexte superflu avant la blague.",
    // On coupe plus serré : le silence avant/après la chute n'apporte rien au rythme comique.
    silence: { maxSilence: 0.6, speechPad: 0.15 },
    hook: { teaserDurationSec: 1.5, tone: "humoristique" },
    teaser: { enabledByDefault: true, minMomentDurationSec: 18 },
    // Changements de plan plus fréquents (punchlines), facecam mise en avant.
    crop: { holdSec: 1.5, splitRatio: 0.45 },
    caption: { fontSize: 88, fontWeight: 900, color: "#ffffff", background: "#000000cc", y: 0.74 },
    impactZoom: { intensity: 1.4, frequency: "frequent" },
    music: { mood: "sting comique ponctuel sur la chute, silence sinon", defaultVolume: 0.25 },
  },
  "humour-condense": {
    id: "humour-condense",
    label: "Humour condensé",
    // Version la plus courte et la plus serrée : on vise le format le plus rapide à consommer.
    momentDuration: { minSec: 12, maxSec: 25 },
    momentPromptHint:
      "Style humour condensé : coupe tout ce qui n'est pas la chute elle-même ; vise le format le plus court possible qui reste compréhensible.",
    // Coupe très serrée : aucune place pour le temps mort, quitte à couper plus agressivement que "humour".
    silence: { maxSilence: 0.4, speechPad: 0.1 },
    // Le teaser désactivé par défaut : le moment est déjà réduit à l'essentiel, un teaser l'allongerait inutilement.
    hook: { teaserDurationSec: 1, tone: "direct" },
    teaser: { enabledByDefault: false, minMomentDurationSec: 15 },
    crop: { holdSec: 1, splitRatio: 0.5 },
    caption: { fontSize: 96, fontWeight: 900, color: "#ffffff", background: "#000000cc", y: 0.7 },
    impactZoom: { intensity: 1.6, frequency: "frequent" },
    music: { mood: "pas de musique de fond, silence entre les stings courts", defaultVolume: 0 },
  },
} as const satisfies Record<NicheStyleId, StylePreset>;

/** Identifiants valides de style, dans l'ordre déclaré ci-dessus. */
export const STYLE_IDS = Object.keys(STYLE_PRESETS) as NicheStyleId[];

/** Liste des presets de style, dans l'ordre déclaré ci-dessus. */
export const STYLE_PRESET_LIST: readonly StylePreset[] = Object.values(STYLE_PRESETS);

/** Vrai si `value` est un identifiant de style valide. */
export function isStyleId(value: string): value is NicheStyleId {
  return Object.prototype.hasOwnProperty.call(STYLE_PRESETS, value);
}

/** Preset de style à partir de son identifiant (ou `undefined` si inconnu). */
export function stylePreset(id: string): StylePreset | undefined {
  return isStyleId(id) ? STYLE_PRESETS[id] : undefined;
}

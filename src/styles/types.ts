import type { z } from "zod";
import type { NicheStyleId } from "@/config/niches";
import type { textStyleSchema } from "@/timeline/schema";

/** Style de texte tel que défini par `textStyleSchema` (`src/timeline/schema.ts`). */
type TextStyle = z.infer<typeof textStyleSchema>;

/**
 * Preset de style complet pour un identifiant `NicheStyleId` (vague 4 : "épique" | "chill" |
 * "humour" | "humour-condense"). `src/config/niches.ts` ne définit que l'étiquette ; ce module
 * fournit les données concrètes associées à chaque étiquette.
 *
 * Important : cette tâche (vague 5, S1) ne branche RIEN dans le pipeline existant. Elle définit
 * uniquement des données de configuration ; chaque champ documente qui est censé le consommer et
 * dans quelle tâche future.
 */

/** Plage de durée cible pour un moment, en secondes (voir `worker/handlers/moments.ts`). */
export type DurationRangeSec = {
  /** Durée minimale visée, en secondes. Doit être strictement inférieure à `maxSec`. */
  minSec: number;
  /** Durée maximale visée, en secondes. Doit être strictement supérieure à `minSec`. */
  maxSec: number;
};

/**
 * Paramètres de détection/retrait des silences, par style (mêmes unités que les constantes
 * globales `MAX_SILENCE` / `SPEECH_PAD` de `src/timeline/silence.ts`, mais déclinées par style
 * plutôt que fixées une fois pour toutes). Consommateur prévu : la tâche S2 (vague 5), qui
 * remplacera l'appel aux constantes globales par ces valeurs par style dans `speechRanges`.
 */
export type SilencePolicy = {
  /** Silence (en secondes) au-delà duquel une coupure est faite à l'intérieur d'un moment. */
  maxSilence: number;
  /** Marge (en secondes) de parole conservée de chaque côté d'une coupure. */
  speechPad: number;
};

/** Ton du texte affiché pendant l'accroche (teaser) en tête de moment. */
export type HookTone = "percutant" | "mysterieux" | "direct" | "humoristique";

/**
 * Paramètres de l'accroche (teaser) jouée en cold-open avant le moment complet (voir
 * `timelineFromSegment` dans `src/timeline/factory.ts`, paramètres `teaser`/`hook`). Consommateur
 * prévu : la tâche S2 (vague 5), qui décidera où placer le teaser et avec quel texte/ton.
 */
export type HookConfig = {
  /** Durée cible du teaser, en secondes. */
  teaserDurationSec: number;
  /** Ton/style du texte d'accroche affiché à l'écran pendant le teaser. */
  tone: HookTone;
};

/**
 * Politique d'activation du teaser : certains styles (ex. humour-condense) préfèrent sauter
 * directement dans le vif du sujet plutôt que de perdre du temps en accroche. Consommateur prévu :
 * la tâche S2 (vague 5), qui décide d'insérer ou non un teaser pour un moment donné.
 */
export type TeaserPolicy = {
  /** Si faux, aucun teaser n'est inséré par défaut pour ce style, quelle que soit la durée du moment. */
  enabledByDefault: boolean;
  /**
   * Durée minimale du moment (en secondes) en dessous de laquelle le teaser n'a pas d'intérêt
   * (le moment est déjà assez court pour accrocher sans extrait séparé).
   */
  minMomentDurationSec: number;
};

/**
 * Paramètres de recadrage (cadrage 9:16), au-delà du mode choisi par niche (`CropMode` dans
 * `src/config/niches.ts`). Consommateur prévu : la tâche S2/H1 (vague 5), au moment de générer les
 * `shots` de `cropSchema` (`src/timeline/schema.ts`).
 */
export type CropPreset = {
  /**
   * Tenue de cadrage minimale (en secondes) avant d'autoriser un nouveau changement de plan
   * ("hold"), pour éviter un recadrage trop nerveux.
   */
  holdSec: number;
  /**
   * Part par défaut de la hauteur de sortie donnée à la facecam dans un plan "split" (voir
   * `shotSchema` -> variante "split" -> `ratio` dans `src/timeline/schema.ts`, borné [0.2, 0.7]).
   * Reprend `ratio` comme référence de valeur par défaut, par style.
   */
  splitRatio: number;
};

/**
 * Apparence par défaut des sous-titres pour ce style. Reprend un sous-ensemble pertinent de
 * `textStyleSchema` (`src/timeline/schema.ts`) : taille, graisse, couleur, fond, position
 * verticale. Consommateur prévu : les tâches K1/K2 (vague 5, sous-titres), qui sont censées lire
 * ce champ pour initialiser le style visuel de la piste "caption" (`captionItemSchema`) au lieu de
 * partir d'un style câblé en dur ; `captionItemSchema.styleId` (déjà présent dans le schéma) est le
 * pont attendu entre un moment/timeline et le preset de style dont il hérite.
 */
export type CaptionAppearance = Pick<TextStyle, "fontSize" | "fontWeight" | "color" | "background"> & {
  /** Position verticale du bloc de sous-titres, normalisée 0..1 sur la hauteur de sortie. */
  y: number;
};

/**
 * Paramètre de "zoom d'impact" : un zoom ponctuel et bref déclenché sur certains instants forts
 * (punchline, révélation…). Ce preset ne fait que décrire l'intensité et la fréquence visées ; le
 * zoom lui-même n'est implémenté par aucune tâche de cette vague. Consommateur prévu : une tâche
 * future de montage automatique (post-vague 5), qui pourra lire ce champ pour calibrer l'effet.
 */
export type ImpactZoomPreset = {
  /** Intensité du zoom (1 = pas de zoom, >1 = zoom in ; mêmes unités que `CropKeyframe.zoom`). */
  intensity: number;
  /**
   * Fréquence/condition de déclenchement, en langage simple : "jamais", un zoom occasionnel sur
   * les temps forts détectés, ou un zoom sur (presque) chaque phrase/punchline.
   */
  frequency: "aucun" | "occasionnel" | "frequent";
};

/**
 * Paramètre musique/SFX : décrit l'ambiance recherchée et un volume de repli, sans implémenter de
 * sélection automatique de piste. Le format d'une piste disponible est celui renvoyé par
 * `GET /api/sfx` (`src/app/api/sfx/route.ts` : `{ name: string; src: string }`) ; ce preset ne fait
 * que donner une consigne pour guider un futur choix (manuel ou automatique) parmi ces pistes.
 * Consommateur prévu : une tâche future de sélection musicale (post-vague 5, ou H1/H2 si elles
 * touchent à l'ambiance sonore).
 */
export type MusicPreset = {
  /** Consigne en langage simple décrivant l'ambiance sonore recherchée pour ce style. */
  mood: string;
  /** Volume par défaut de la musique/SFX de fond, même échelle que `audioItemSchema.volume` (0..2). */
  defaultVolume: number;
};

/**
 * Preset de style complet : toutes les données nécessaires pour qu'un moment de niche donnée
 * (via `NicheConfig.defaultStyle`) soit monté de façon cohérente et distincte selon son style.
 * Aucune des tâches S2/K1/K2/H1/H2 (vague 5) n'est câblée par ce module : elles sont les
 * consommatrices prévues de chaque champ (voir la doc de chaque sous-type ci-dessus).
 */
export type StylePreset = {
  /** Identifiant du style, doit être identique à la clé correspondante dans `STYLE_PRESETS`. */
  id: NicheStyleId;
  /** Libellé affichable à l'utilisateur, en français. */
  label: string;
  /** Plage de durée cible des moments pour ce style. Consommateur : N4/S2 via `momentsPrompt2`. */
  momentDuration: DurationRangeSec;
  /**
   * Consigne de prompt courte en français, destinée à être injectée comme `nicheHint` /
   * complément de `momentsPrompt2.system(...)` (tâche N4, vague 4 ; branchement réel en S2).
   */
  momentPromptHint: string;
  /** Politique de détection des silences pour ce style. Consommateur : S2. */
  silence: SilencePolicy;
  /** Paramètres de l'accroche (teaser) pour ce style. Consommateur : S2. */
  hook: HookConfig;
  /** Politique d'activation du teaser pour ce style. Consommateur : S2. */
  teaser: TeaserPolicy;
  /** Paramètres de recadrage pour ce style. Consommateur : S2/H1. */
  crop: CropPreset;
  /** Apparence par défaut des sous-titres pour ce style. Consommateur : K1/K2. */
  caption: CaptionAppearance;
  /** Paramètre de zoom d'impact pour ce style. Consommateur : tâche future (non planifiée en vague 5). */
  impactZoom: ImpactZoomPreset;
  /** Paramètre musique/SFX pour ce style. Consommateur : tâche future (non planifiée en vague 5). */
  music: MusicPreset;
};

import { nanoid } from "nanoid";
import type { Word } from "@/server/db/schema";
import { captionItemSchema, type CaptionItem } from "@/timeline/schema";

export type BuildCaptionsOptions = {
  /** Fewest words per caption group (default 2). */
  minWords?: number;
  /** Most words per caption group (default 4). */
  maxWords?: number;
  /**
   * Inclure les répliques marquées `vo: true` (voix du contenu : cinématique de jeu, extrait
   * regardé...), qui ne sont pas des propos du créateur. Exclues par défaut : ce ne sont pas des
   * sous-titres à afficher tels quels.
   */
  includeVo?: boolean;
  /**
   * Écart de temps (s) au-delà duquel deux mots consécutifs retenus ne sont plus groupés ensemble,
   * même si le groupe courant n'a pas atteint `maxWords`. Évite qu'un sous-titre couvre un long
   * silence ou un passage `vo` exclu entre deux mots du créateur (défaut 1.2s).
   */
  maxGapSec?: number;
  /** `styleId` à reporter tel quel sur chaque item produit. */
  styleId?: string;
};

const DEFAULT_MIN_WORDS = 2;
const DEFAULT_MAX_WORDS = 4;
const DEFAULT_MAX_GAP_SEC = 1.2;

/**
 * Construit les items `caption` (voir `captionItemSchema`) correspondant à un extrait de
 * transcription [`from`, `to`] (le `sourceIn`/`sourceOut` d'un clip vidéo de la timeline).
 *
 * Fonction pure : ne lit ni n'écrit rien, ne connaît pas la timeline globale. Les instants
 * produits (`start` de chaque item, `start`/`end` de chaque mot) sont relatifs à `from` (`from`
 * devient l'instant 0) — à l'appelant de les décaler de la position du clip vidéo sur la piste si
 * ce dernier ne démarre pas lui-même à 0.
 *
 * Mise en avant du mot courant pendant la lecture : chaque mot du groupe garde son `start`/`end`
 * propre (hérité de `captionWordSchema`), ce qui suffit déjà à déterminer le mot actif en comparant
 * l'instant de lecture à ces bornes — pas besoin d'un champ d'offset supplémentaire. On ne modifie
 * donc pas `captionWordSchema` : décision documentée ici plutôt que dans le schéma partagé.
 *
 * Les mots `vo: true` (voix du contenu, pas le créateur) sont exclus par défaut ; passer
 * `includeVo: true` pour les inclure explicitement.
 */
export function buildCaptionItems(words: Word[], from: number, to: number, opts: BuildCaptionsOptions = {}): CaptionItem[] {
  const minWords = Math.max(1, opts.minWords ?? DEFAULT_MIN_WORDS);
  const maxWords = Math.max(minWords, opts.maxWords ?? DEFAULT_MAX_WORDS);
  const maxGapSec = opts.maxGapSec ?? DEFAULT_MAX_GAP_SEC;

  const kept = words
    .filter((w) => w.end > from && w.start < to)
    .filter((w) => opts.includeVo || !w.vo)
    .map((w) => ({
      w: w.w,
      start: Math.max(0, Math.min(w.start, to) - from),
      end: Math.max(0, Math.min(w.end, to) - from),
    }))
    .sort((a, b) => a.start - b.start);

  const groups = groupWords(kept, minWords, maxWords, maxGapSec);

  return groups.map((group) => {
    const start = group[0].start;
    const end = Math.max(...group.map((w) => w.end));
    const item: CaptionItem = {
      id: nanoid(8),
      type: "caption",
      start,
      duration: Math.max(end - start, 0.01),
      words: group,
      ...(opts.styleId ? { styleId: opts.styleId } : {}),
    };
    return captionItemSchema.parse(item);
  });
}

type RelWord = { w: string; start: number; end: number };

/** Découpe les mots retenus en groupes de `minWords` à `maxWords`, sans laisser de reste < minWords
 *  quand ce n'est pas inévitable (moins de `minWords` mots au total). Coupe aussi un groupe dès
 *  qu'un trop grand écart sépare deux mots consécutifs (silence ou passage `vo` exclu entre eux). */
function groupWords(words: RelWord[], minWords: number, maxWords: number, maxGapSec: number): RelWord[][] {
  const groups: RelWord[][] = [];
  let i = 0;
  const n = words.length;
  while (i < n) {
    const remaining = n - i;
    let size = Math.min(maxWords, remaining);
    // Un segment coupé par un grand écart ne dépasse pas ce point.
    for (let k = 1; k < size; k++) {
      if (words[i + k].start - words[i + k - 1].end > maxGapSec) {
        size = k;
        break;
      }
    }
    // Évite de laisser un reste trop court quand on peut rééquilibrer ce groupe-ci.
    const leftover = remaining - size;
    if (leftover > 0 && leftover < minWords && size > minWords) {
      size -= minWords - leftover;
    }
    groups.push(words.slice(i, i + size));
    i += size;
  }
  return groups;
}

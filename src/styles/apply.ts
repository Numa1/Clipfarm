import type { Timeline } from "@/timeline/schema";
import type { StylePreset } from "./types";

/**
 * Applique un preset de style (`src/styles/presets.ts`) à une timeline existante et retourne une
 * nouvelle timeline (aucune mutation en place).
 *
 * - `meta.styleId` est mis à jour avec l'identifiant du style appliqué.
 * - Les clips vidéo en `crop.mode: "auto"` reçoivent les paramètres de recadrage du style (pour
 *   l'instant : `splitRatio` sur les plans "split" déjà calculés par le worker de reframe — voir
 *   `src/timeline/crop.ts`). Les clips `crop.mode: "manual"` ou `"center"` ne sont JAMAIS modifiés :
 *   c'est un cadrage choisi explicitement par l'utilisateur, le style ne doit pas l'écraser.
 * - Les éléments de sous-titres (piste "caption") sont pointés vers le nouveau style via
 *   `styleId`, le pont prévu par `captionItemSchema` (voir `src/styles/types.ts`, `CaptionAppearance`)
 *   pour que K1/K2 en dérive l'apparence visuelle.
 */
export function applyStyle(timeline: Timeline, style: StylePreset): Timeline {
  return {
    ...timeline,
    tracks: timeline.tracks.map((track) => ({
      ...track,
      items: track.items.map((item) => {
        if (item.type === "video") {
          // Cadrage manuel ou centré : choix explicite de l'utilisateur, on n'y touche jamais.
          if (item.crop.mode !== "auto") return item;
          if (!item.crop.shots?.length) return item;
          return {
            ...item,
            crop: {
              ...item.crop,
              shots: item.crop.shots.map((shot) =>
                shot.layout === "split" ? { ...shot, ratio: style.crop.splitRatio } : shot,
              ),
            },
          };
        }
        if (item.type === "caption") return { ...item, styleId: style.id };
        return item;
      }),
    })),
    meta: { ...timeline.meta, styleId: style.id },
  };
}

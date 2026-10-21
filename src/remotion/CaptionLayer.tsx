import { AbsoluteFill, useCurrentFrame } from "remotion";
import { stylePreset } from "@/styles/presets";
import type { CaptionAppearance } from "@/styles/types";
import type { CaptionItem, Timeline } from "@/timeline/schema";

/**
 * Apparence par défaut utilisée quand l'item ne référence aucun `styleId` connu (voir
 * `CaptionAppearance`, `src/styles/types.ts`). Choisie proche du preset "chill".
 */
const DEFAULT_APPEARANCE: CaptionAppearance = {
  fontSize: 64,
  fontWeight: 700,
  color: "#ffffff",
  background: "#000000cc",
  y: 0.82,
};

/** Couleur du mot en cours de lecture (distingue visuellement le mot actif des autres). */
const ACTIVE_COLOR = "#ffe14d";

function appearanceFor(styleId: string | undefined): CaptionAppearance {
  if (!styleId) return DEFAULT_APPEARANCE;
  return stylePreset(styleId)?.caption ?? DEFAULT_APPEARANCE;
}

/**
 * Affiche un item `caption` (sous-titres mot-à-mot) : rendu identique dans l'apercu (Player) et au
 * rendu final, puisque les deux partagent `ShortComposition`. Ne dépend de rien de spécifique au
 * Player (uniquement `useCurrentFrame`, comme `TextLayer`).
 *
 * Coordonnées temporelles : `item.start` et `word.start`/`word.end` (voir `captionWordSchema`)
 * partagent la même origine (celle du clip source, voir `src/captions/build.ts`) — ce ne sont PAS
 * des horodatages relatifs au début de l'item. Le frame local de la `Sequence` (0 à l'instant
 * `item.start` sur la timeline) permet de reconstruire cet instant : `item.start + frame / fps`.
 */
export function CaptionLayer({ item, timeline }: { item: CaptionItem; timeline: Timeline }) {
  const frame = useCurrentFrame();
  const elapsed = frame / timeline.fps;
  // Garde-fou : ne rien afficher en dehors de la plage de l'item, même si le composant est monté
  // (en dehors d'une Sequence dédiée) pour un instant qui ne lui appartient pas.
  if (elapsed < 0 || elapsed >= item.duration) return null;

  const t = item.start + elapsed;
  const appearance = appearanceFor(item.styleId);

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          left: 0.5 * timeline.width,
          top: appearance.y * timeline.height,
          transform: "translate(-50%, -50%)",
          width: 0.86 * timeline.width,
          textAlign: "center",
          fontFamily: "Inter, system-ui, sans-serif",
          fontSize: appearance.fontSize,
          fontWeight: appearance.fontWeight,
          lineHeight: 1.2,
          letterSpacing: "-0.02em",
          color: appearance.color,
          textShadow: appearance.background ? undefined : "0 4px 24px rgba(0,0,0,0.55)",
        }}
      >
        <span
          style={{
            background: appearance.background ?? undefined,
            padding: appearance.background ? "0.08em 0.3em" : undefined,
            borderRadius: 16,
            boxDecorationBreak: "clone",
            WebkitBoxDecorationBreak: "clone",
          }}
        >
          {item.words.map((word, i) => {
            const active = t >= word.start && t < word.end;
            return (
              <span
                key={i}
                data-active={active}
                data-word={word.w}
                style={{
                  color: active ? ACTIVE_COLOR : appearance.color,
                  fontWeight: active ? Math.min(900, appearance.fontWeight + 100) : appearance.fontWeight,
                }}
              >
                {word.w}
                {i < item.words.length - 1 ? " " : ""}
              </span>
            );
          })}
        </span>
      </div>
    </AbsoluteFill>
  );
}

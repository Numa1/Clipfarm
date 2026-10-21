import type { ReactElement, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { CaptionItem, Timeline } from "@/timeline/schema";

// `useCurrentFrame` ne peut pas tourner sans un véritable <Player>/rendu Remotion ; on le mocke
// pour contrôler l'instant de lecture, comme suggéré pour tester un composant Remotion isolément.
const mockFrame = vi.hoisted(() => ({ value: 0 }));
vi.mock("remotion", () => ({
  useCurrentFrame: () => mockFrame.value,
  AbsoluteFill: ({ children, style }: { children?: ReactNode; style?: object }) => ({
    type: "AbsoluteFill",
    props: { style, children },
  }),
}));

import { CaptionLayer } from "./CaptionLayer";

function timeline(fps = 30): Timeline {
  return {
    version: 2,
    fps,
    width: 1080,
    height: 1920,
    assets: {},
    tracks: [],
    meta: {},
  };
}

function captionItem(): CaptionItem {
  return {
    id: "c1",
    type: "caption",
    start: 10, // même origine que `words[].start`/`end` (voir src/captions/build.ts)
    duration: 1.2,
    words: [
      { w: "Salut", start: 10.0, end: 10.3 },
      { w: "tout", start: 10.3, end: 10.6 },
      { w: "le", start: 10.6, end: 10.8 },
      { w: "monde", start: 10.8, end: 11.2 },
    ],
  };
}

/** Marche l'arbre d'éléments React renvoyé par le composant (appelé directement, sans DOM) pour
 *  retrouver les `<span data-word>` représentant chaque mot. */
function findWordSpans(node: unknown, out: { word: string; active: boolean; color: unknown }[] = []) {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    for (const n of node) findWordSpans(n, out);
    return out;
  }
  const el = node as { props?: Record<string, unknown> };
  const props = el.props;
  if (props && typeof props["data-word"] === "string") {
    out.push({
      word: props["data-word"] as string,
      active: Boolean(props["data-active"]),
      color: (props.style as Record<string, unknown> | undefined)?.color,
    });
  }
  if (props?.children) findWordSpans(props.children, out);
  return out;
}

function render(item: CaptionItem, tl: Timeline, frame: number) {
  mockFrame.value = frame;
  const el = CaptionLayer({ item, timeline: tl }) as ReactElement | null;
  return el;
}

describe("CaptionLayer", () => {
  it("met en avant visuellement le mot courant selon l'instant de lecture", () => {
    const item = captionItem();
    const tl = timeline(30);

    // t = item.start + frame/fps = 10 + 15/30 = 10.5s -> dans la plage du mot "le" (10.6? non)
    // Choisit un frame qui tombe précisément dans la plage de "tout" (10.3..10.6) : t = 10.45s.
    const frame = Math.round((10.45 - item.start) * tl.fps); // 13.5 -> 14 (t=10.4667)
    const el = render(item, tl, frame);
    expect(el).not.toBeNull();

    const spans = findWordSpans(el);
    expect(spans.map((s) => s.word)).toEqual(["Salut", "tout", "le", "monde"]);

    const activeWords = spans.filter((s) => s.active).map((s) => s.word);
    expect(activeWords).toEqual(["tout"]);

    // Le mot actif est visuellement distingué (couleur différente) des autres.
    const active = spans.find((s) => s.word === "tout")!;
    const inactive = spans.find((s) => s.word === "Salut")!;
    expect(active.color).not.toBe(inactive.color);
  });

  it("ne met aucun mot en avant pendant un silence entre deux mots", () => {
    const item = captionItem();
    const tl = timeline(30);
    // Sous-titre avec un vrai creux (pas de mot) entre 10.3 et 10.8.
    const itemWithGap: CaptionItem = {
      ...item,
      words: [
        { w: "Salut", start: 10.0, end: 10.3 },
        { w: "monde", start: 10.8, end: 11.2 },
      ],
    };
    const silenceFrame = Math.round((10.5 - item.start) * tl.fps); // entre 10.3 et 10.8 : aucun mot actif
    const el = render(itemWithGap, tl, silenceFrame);
    const spans = findWordSpans(el);
    expect(spans.some((s) => s.active)).toBe(false);
  });

  it("n'affiche rien en dehors de la plage de temps de l'item", () => {
    const item = captionItem();
    const tl = timeline(30);

    const before = render(item, tl, -1);
    expect(before).toBeNull();

    const after = render(item, tl, Math.round(item.duration * tl.fps) + 1);
    expect(after).toBeNull();
  });
});

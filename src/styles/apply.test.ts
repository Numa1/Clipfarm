import { describe, expect, it } from "vitest";
import { emptyTimeline } from "@/timeline/factory";
import type { Timeline } from "@/timeline/schema";
import { applyStyle } from "./apply";
import { STYLE_PRESETS } from "./presets";

const EPIQUE = STYLE_PRESETS.epique; // splitRatio: 0.3
const CHILL = STYLE_PRESETS.chill; // splitRatio: 0.4

function baseTimeline(): Timeline {
  const tl = emptyTimeline();
  tl.assets["a1"] = { id: "a1", kind: "video", src: "sources/a1/proxy.mp4", durationSec: 60 };
  tl.tracks[0].items.push(
    {
      id: "manual-clip",
      type: "video",
      start: 0,
      assetId: "a1",
      sourceIn: 0,
      sourceOut: 10,
      volume: 1,
      crop: {
        mode: "manual",
        keyframes: [],
        shots: [{ t: 0, layout: "split", cam: { x: 0, y: 0.6, w: 0.3, h: 0.4 }, content: { x: 0.2, y: 0, w: 0.5, h: 1 }, ratio: 0.4 }],
      },
    },
    {
      id: "auto-clip",
      type: "video",
      start: 10,
      assetId: "a1",
      sourceIn: 10,
      sourceOut: 20,
      volume: 1,
      crop: {
        mode: "auto",
        keyframes: [],
        shots: [{ t: 10, layout: "split", cam: { x: 0, y: 0.6, w: 0.3, h: 0.4 }, content: { x: 0.2, y: 0, w: 0.5, h: 1 }, ratio: 0.4 }],
      },
    },
  );
  tl.tracks.push({
    id: "caption",
    kind: "caption",
    name: "Sous-titres",
    muted: false,
    hidden: false,
    items: [{ id: "cap-1", type: "caption", start: 0, duration: 5, words: [] }],
  });
  return tl;
}

describe("applyStyle", () => {
  it("laisse inchangé un clip dont le cadrage est manuel", () => {
    const tl = baseTimeline();
    const manualBefore = tl.tracks[0].items.find((i) => i.id === "manual-clip");
    const result = applyStyle(tl, EPIQUE);
    const manualAfter = result.tracks[0].items.find((i) => i.id === "manual-clip");
    expect(manualAfter).toEqual(manualBefore);
  });

  it("met à jour les paramètres de recadrage d'un clip en mode auto quand le style les définit", () => {
    const tl = baseTimeline();
    const result = applyStyle(tl, EPIQUE);
    const autoAfter = result.tracks[0].items.find((i) => i.id === "auto-clip");
    expect(autoAfter?.type).toBe("video");
    if (autoAfter?.type !== "video" || autoAfter.crop.mode !== "auto") throw new Error("unexpected");
    expect(autoAfter.crop.shots?.[0]).toMatchObject({ layout: "split", ratio: EPIQUE.crop.splitRatio });
    expect(EPIQUE.crop.splitRatio).not.toBe(0.4); // valeur de départ du fixture, pour que le test soit probant
  });

  it("met à jour meta.styleId", () => {
    const tl = baseTimeline();
    const result = applyStyle(tl, CHILL);
    expect(result.meta.styleId).toBe("chill");
  });

  it("pointe les sous-titres vers le nouveau style", () => {
    const tl = baseTimeline();
    const result = applyStyle(tl, CHILL);
    const caption = result.tracks.find((t) => t.kind === "caption")?.items[0];
    expect(caption).toMatchObject({ type: "caption", styleId: "chill" });
  });

  it("ne mute pas la timeline reçue en entrée", () => {
    const tl = baseTimeline();
    const snapshot = JSON.parse(JSON.stringify(tl));
    applyStyle(tl, EPIQUE);
    expect(tl).toEqual(snapshot);
  });
});

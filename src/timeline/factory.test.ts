import { describe, expect, it } from "vitest";
import { createAudioItem, createTextItem, timelineFromSegment } from "./factory";

describe("timelineFromSegment", () => {
  it("places the teaser, then the kept ranges back to back", () => {
    const tl = timelineFromSegment({
      asset: { id: "src", kind: "video", src: "sources/src/proxy.mp4", durationSec: 600 },
      sourceIn: 100,
      sourceOut: 140,
      keep: [
        [100, 110],
        [115, 140],
      ],
      teaser: [130, 133],
      hook: "Le hook",
    });
    const clips = tl.tracks[0].items.map((i) => (i.type === "video" ? [i.start, i.sourceIn, i.sourceOut] : null));
    expect(clips).toEqual([
      [0, 130, 133],
      [3, 100, 110],
      [13, 115, 140],
    ]);
    expect(tl.tracks[1].items[0]).toMatchObject({ type: "text", start: 0, duration: 3, text: "Le hook" });
  });
});

describe("createTextItem", () => {
  it("builds a centered text item with a generated id", () => {
    const item = createTextItem({ start: 5, text: "Ton texte" });
    expect(item).toMatchObject({
      type: "text",
      start: 5,
      duration: 3,
      text: "Ton texte",
      x: 0.5,
      y: 0.18,
      maxWidth: 0.86,
      style: { fontSize: 72, fontWeight: 800, color: "#ffffff", background: null, align: "center" },
    });
    expect(item.id).toMatch(/^.{8}$/);
  });

  it("generates a distinct id on each call", () => {
    expect(createTextItem({ start: 0, text: "a" }).id).not.toEqual(createTextItem({ start: 0, text: "a" }).id);
  });
});

describe("createAudioItem", () => {
  it("builds an audio clip referencing the given asset with a generated id", () => {
    const item = createAudioItem({ start: 2, assetId: "sfx:boop.mp3", sourceIn: 0, sourceOut: 1.5, volume: 0.8 });
    expect(item).toMatchObject({
      type: "audio",
      start: 2,
      assetId: "sfx:boop.mp3",
      sourceIn: 0,
      sourceOut: 1.5,
      volume: 0.8,
    });
    expect(item.id).toMatch(/^.{8}$/);
  });
});

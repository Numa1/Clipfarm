import { describe, expect, it } from "vitest";
import { cropAt, cropTransform } from "./crop";
import { timelineFromSegment } from "./factory";
import {
  addItem,
  findItem,
  moveItem,
  removeItem,
  snapTime,
  splitItem,
  timelineDuration,
  trimItem,
} from "./ops";
import { parseTimeline, type VideoItem } from "./schema";

const asset = { id: "src1", kind: "video" as const, src: "a.mp4", durationSec: 3600, width: 1920, height: 1080 };

function base() {
  return timelineFromSegment({ asset, sourceIn: 100, sourceOut: 140, hook: "Le hook" });
}

const videoOf = (tl: ReturnType<typeof base>) => tl.tracks[0].items as VideoItem[];

describe("timeline ops", () => {
  it("creates a valid pre-cut timeline", () => {
    const tl = base();
    expect(() => parseTimeline(tl)).not.toThrow();
    expect(timelineDuration(tl)).toBe(40);
  });

  it("splits a video item and keeps source continuity", () => {
    const tl = base();
    const id = videoOf(tl)[0].id;
    const out = splitItem(tl, id, 10);
    const [a, b] = videoOf(out);
    expect(a).toMatchObject({ start: 0, sourceIn: 100, sourceOut: 110 });
    expect(b).toMatchObject({ start: 10, sourceIn: 110, sourceOut: 140 });
    expect(b.id).not.toBe(a.id);
    expect(videoOf(tl)).toHaveLength(1); // immutable
  });

  it("ignores splits at the edges", () => {
    const tl = base();
    const id = videoOf(tl)[0].id;
    expect(splitItem(tl, id, 0)).toBe(tl);
    expect(splitItem(tl, id, 40)).toBe(tl);
  });

  it("trims start and end within source bounds", () => {
    const tl = base();
    const id = videoOf(tl)[0].id;
    const t1 = trimItem(tl, id, "start", 5);
    expect(videoOf(t1)[0]).toMatchObject({ start: 5, sourceIn: 105, sourceOut: 140 });
    const t2 = trimItem(t1, id, "end", 20);
    expect(videoOf(t2)[0]).toMatchObject({ sourceOut: 120 });
    const t3 = trimItem(tl, id, "end", 99999);
    expect(videoOf(t3)[0].sourceOut).toBe(3600);
  });

  it("moves, removes and adds items", () => {
    let tl = base();
    const id = videoOf(tl)[0].id;
    tl = moveItem(tl, id, 2);
    expect(findItem(tl, id)?.item.start).toBe(2);
    tl = removeItem(tl, id);
    expect(findItem(tl, id)).toBeNull();
    tl = addItem(tl, { id: "sfx", type: "audio", start: 1, assetId: "s", sourceIn: 0, sourceOut: 1, volume: 1 });
    expect(findItem(tl, "sfx")?.track.kind).toBe("audio");
  });

  it("refuses to move an item onto a track of another kind", () => {
    const tl = base();
    const id = videoOf(tl)[0].id;
    const out = moveItem(tl, id, 0, "audio");
    expect(findItem(out, id)?.track.id).toBe("video");
  });

  it("snaps to item edges", () => {
    const tl = base();
    expect(snapTime(tl, 39.9, 0.2)).toBe(40);
    expect(snapTime(tl, 20, 0.2)).toBe(20);
  });
});

describe("crop", () => {
  it("interpolates keyframes", () => {
    const k = cropAt(
      { mode: "auto", keyframes: [{ t: 0, x: 0.2, y: 0.5, zoom: 1 }, { t: 10, x: 0.6, y: 0.5, zoom: 1 }] },
      5,
    );
    expect(k.x).toBeCloseTo(0.4);
  });

  it("covers a vertical frame from a 16:9 source without borders", () => {
    const r = cropTransform({ t: 0, x: 0, y: 0.5, zoom: 1 }, { width: 1920, height: 1080 }, { width: 1080, height: 1920 });
    expect(r.height).toBeCloseTo(1920);
    expect(r.left).toBe(0); // clamped to the left edge
  });
});

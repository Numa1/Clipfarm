import { describe, expect, it } from "vitest";
import { contentAt, cropAt, cropTransform, fitTransform, regionTransform, shotAt, withShotLayout } from "./crop";
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

  it("falls back to keyframes when there are no shots", () => {
    const s = shotAt({ mode: "auto", keyframes: [{ t: 0, x: 0.3, y: 0.5, zoom: 1 }] }, 4);
    expect(s.layout).toBe("crop");
    expect(s.layout === "crop" && s.keyframes[0].x).toBe(0.3);
    expect(shotAt({ mode: "center", keyframes: [] }, 4).layout).toBe("crop");
  });

  it("switches shots as a step function", () => {
    const crop = {
      mode: "auto" as const,
      keyframes: [],
      shots: [
        { t: 10, layout: "fit" as const },
        { t: 12, layout: "crop" as const, keyframes: [{ t: 12, x: 0.5, y: 0.4, zoom: 1 }] },
      ],
    };
    expect(shotAt(crop, 5).layout).toBe("fit"); // before the first shot → first shot
    expect(shotAt(crop, 11.99).layout).toBe("fit");
    expect(shotAt(crop, 12).layout).toBe("crop");
    // Manual mode ignores shots.
    expect(shotAt({ ...crop, mode: "manual", keyframes: [{ t: 0, x: 0.5, y: 0.5, zoom: 1 }] }, 11).layout).toBe("crop");
  });

  it("fills a box with a source region (facecam in the top-right corner)", () => {
    const src = { width: 1920, height: 1080 };
    const out = { width: 1080, height: 768 };
    const cam = { x: 0.75, y: 0, w: 0.25, h: 0.3 };
    const r = regionTransform(cam, src, out);
    // Region (480×324 px) scaled to cover 1080×768.
    expect(r.width).toBeCloseTo(1920 * Math.max(1080 / 480, 768 / 324));
    expect(r.left + 0.875 * r.width).toBeCloseTo(540); // region center → box center
    expect(r.left + r.width).toBeGreaterThanOrEqual(1080); // no empty border
    expect(r.top).toBe(0); // clamped on the top edge
  });

  it("changes only the shot under the playhead", () => {
    const cam = { x: 0, y: 0.6, w: 0.3, h: 0.4 };
    const crop = {
      mode: "auto" as const,
      keyframes: [],
      shots: [
        { t: 0, layout: "split" as const, cam, content: { x: 0.3, y: 0, w: 0.5, h: 1 }, ratio: 0.4 },
        { t: 5, layout: "fit" as const },
      ],
    };
    const a = withShotLayout(crop, 6, "split");
    expect(a.shots?.[1]).toMatchObject({ t: 5, layout: "split", cam }); // geometry borrowed from the other split
    const b = withShotLayout(crop, 1, "crop");
    expect(b.shots?.[0].layout).toBe("crop");
    expect(b.shots?.[1].layout).toBe("fit");
    // A clip without shots becomes a single-shot auto crop.
    expect(withShotLayout({ mode: "center", keyframes: [] }, 3, "fit").shots).toEqual([{ t: 0, layout: "fit" }]);
  });

  it("pans the content window of a split shot, staying inside the frame", () => {
    const shot = {
      t: 0,
      layout: "split" as const,
      cam: { x: 0, y: 0.6, w: 0.3, h: 0.4 },
      content: { x: 0.3, y: 0, w: 0.5, h: 1 },
      ratio: 0.4,
      pan: [
        { t: 0, x: 0.55 },
        { t: 2, x: 0.95 },
      ],
    };
    expect(contentAt(shot, 1).x).toBeCloseTo(0.5); // center 0.75 → left edge 0.5
    expect(contentAt(shot, 5).x).toBeCloseTo(0.5); // center 0.95 clamped: right edge stays at 1
    expect(contentAt({ ...shot, pan: undefined }, 1)).toBe(shot.content);
  });

  it("letterboxes the whole frame", () => {
    const r = fitTransform({ width: 1920, height: 1080 }, { width: 1080, height: 1920 });
    expect(r.width).toBe(1080);
    expect(r.height).toBeCloseTo(607.5);
    expect(r.top).toBeCloseTo((1920 - 607.5) / 2);
  });
});

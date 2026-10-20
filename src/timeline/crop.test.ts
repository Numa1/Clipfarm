import { describe, expect, it } from "vitest";
import { analysisWindows, mergeCrops, shotsInRange } from "./crop";
import type { Shot, Timeline, VideoItem } from "./schema";

describe("shotsInRange", () => {
  const shots: Shot[] = [
    { t: 100, layout: "fit" },
    { t: 105, layout: "crop", keyframes: [{ t: 105, x: 0.5, y: 0.5, zoom: 1 }] },
    { t: 110, layout: "fit" },
  ];

  it("starts with the shot active at the range start, then the shots inside", () => {
    expect(shotsInRange(shots, 103, 112).map((s) => [s.t, s.layout])).toEqual([
      [103, "fit"],
      [105, "crop"],
      [110, "fit"],
    ]);
    expect(shotsInRange(shots, 106, 109).map((s) => [s.t, s.layout])).toEqual([[106, "crop"]]);
  });
});

describe("analysisWindows", () => {
  it("merges close ranges (jump cuts, teaser) into one window", () => {
    expect(
      analysisWindows([
        [120, 123],
        [100, 104],
        [105, 130],
      ]),
    ).toEqual([[100, 130]]);
  });

  it("keeps distant ranges apart and caps the window length", () => {
    expect(analysisWindows([[0, 10], [50, 60]])).toEqual([[0, 10], [50, 60]]);
    expect(analysisWindows([[0, 100], [110, 200]], 20, 150)).toEqual([[0, 100], [110, 200]]);
  });
});

describe("mergeCrops", () => {
  const clip1: VideoItem = {
    id: "clip-1",
    type: "video",
    start: 0,
    assetId: "a",
    sourceIn: 0,
    sourceOut: 10,
    volume: 1,
    crop: { mode: "auto", keyframes: [] },
  };
  const clip2: VideoItem = {
    id: "clip-2",
    type: "video",
    start: 10,
    assetId: "a",
    sourceIn: 10,
    sourceOut: 20,
    volume: 1,
    crop: { mode: "manual", keyframes: [{ t: 10, x: 0.5, y: 0.5, zoom: 1.5 }] },
  };
  const base: Timeline = {
    version: 2,
    fps: 30,
    width: 1080,
    height: 1920,
    assets: { a: { id: "a", kind: "video", src: "sources/a/proxy.mp4", durationSec: 60 } },
    tracks: [{ id: "video", kind: "video", name: "Vidéo", muted: false, hidden: false, items: [clip1, clip2] }],
    meta: {},
  };

  it("applies the worker's computed shots to clips still in auto mode", () => {
    const remoteClip1: VideoItem = { ...clip1, crop: { mode: "auto", keyframes: [], shots: [{ t: 0, layout: "fit" }] } };
    const remoteClip2: VideoItem = { ...clip2, crop: { mode: "auto", keyframes: [], shots: [{ t: 10, layout: "fit" }] } };
    const remote: Timeline = {
      ...base,
      tracks: [{ ...base.tracks[0], items: [remoteClip1, remoteClip2] }],
    };
    const merged = mergeCrops(base, remote);
    const items = merged.tracks[0].items;
    expect(items[0]).toMatchObject({ id: "clip-1", crop: { mode: "auto", shots: [{ t: 0, layout: "fit" }] } });
    // clip-2 was switched to manual locally in the meantime, so the remote auto result is ignored.
    expect(items[1]).toMatchObject({ id: "clip-2", crop: { mode: "manual" } });
  });

  it("leaves clips untouched when the worker found nothing new, or they no longer exist remotely", () => {
    const remote: Timeline = { ...base, tracks: [{ ...base.tracks[0], items: [] }] };
    expect(mergeCrops(base, remote)).toEqual(base);
  });
});

import { nanoid } from "nanoid";
import { TIMELINE_VERSION, type Asset, type CropKeyframe, type Timeline } from "./schema";

export function emptyTimeline(): Timeline {
  return {
    version: TIMELINE_VERSION,
    fps: 30,
    width: 1080,
    height: 1920,
    assets: {},
    tracks: [
      { id: "video", kind: "video", name: "Vidéo", muted: false, hidden: false, items: [] },
      { id: "text", kind: "text", name: "Texte", muted: false, hidden: false, items: [] },
      { id: "audio", kind: "audio", name: "SFX / Musique", muted: false, hidden: false, items: [] },
    ],
    meta: {},
  };
}

/** Timeline pre-cut on a source segment (used when picking a suggested moment). */
export function timelineFromSegment(opts: {
  asset: Asset;
  sourceIn: number;
  sourceOut: number;
  hook?: string;
  cropKeyframes?: CropKeyframe[];
  meta?: Record<string, unknown>;
}): Timeline {
  const tl = emptyTimeline();
  tl.assets[opts.asset.id] = opts.asset;
  const duration = opts.sourceOut - opts.sourceIn;
  tl.tracks[0].items.push({
    id: nanoid(8),
    type: "video",
    start: 0,
    assetId: opts.asset.id,
    sourceIn: opts.sourceIn,
    sourceOut: opts.sourceOut,
    volume: 1,
    // Auto with nothing computed yet renders centered until the reframe job fills it in;
    // "center" is reserved for an explicit user choice the worker must not overwrite.
    crop: { mode: "auto", keyframes: opts.cropKeyframes ?? [] },
  });
  if (opts.hook) {
    tl.tracks[1].items.push({
      id: nanoid(8),
      type: "text",
      start: 0,
      duration: Math.min(3, duration),
      text: opts.hook,
      x: 0.5,
      y: 0.18,
      maxWidth: 0.86,
      style: { fontSize: 72, fontWeight: 800, color: "#ffffff", background: null, align: "center" },
    });
  }
  tl.meta = { ...opts.meta };
  return tl;
}

import { nanoid } from "nanoid";
import { TIMELINE_VERSION, type Asset, type AudioItem, type CropKeyframe, type TextItem, type Timeline } from "./schema";

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

/**
 * Timeline pre-cut on a source segment (used when picking a suggested moment).
 * `keep` lists the source ranges to keep inside [sourceIn, sourceOut] (dead air removed), placed
 * back to back; `teaser` is a short excerpt replayed first as a cold open.
 */
export function timelineFromSegment(opts: {
  asset: Asset;
  sourceIn: number;
  sourceOut: number;
  keep?: [number, number][];
  teaser?: [number, number];
  hook?: string;
  cropKeyframes?: CropKeyframe[];
  meta?: Record<string, unknown>;
}): Timeline {
  const tl = emptyTimeline();
  tl.assets[opts.asset.id] = opts.asset;
  const ranges = [...(opts.teaser ? [opts.teaser] : []), ...(opts.keep ?? [[opts.sourceIn, opts.sourceOut]])];
  let cursor = 0;
  for (const [sourceIn, sourceOut] of ranges) {
    tl.tracks[0].items.push({
      id: nanoid(8),
      type: "video",
      start: cursor,
      assetId: opts.asset.id,
      sourceIn,
      sourceOut,
      volume: 1,
      // Auto with nothing computed yet renders centered until the reframe job fills it in;
      // "center" is reserved for an explicit user choice the worker must not overwrite.
      crop: { mode: "auto", keyframes: opts.cropKeyframes ?? [] },
    });
    cursor += sourceOut - sourceIn;
  }
  if (opts.hook) {
    tl.tracks[1].items.push({
      id: nanoid(8),
      type: "text",
      start: 0,
      duration: Math.min(3, cursor),
      text: opts.hook,
      // Below the facecam slot of a split screen, and below the face of a speaker crop.
      x: 0.5,
      y: 0.62,
      maxWidth: 0.86,
      style: { fontSize: 72, fontWeight: 800, color: "#ffffff", background: null, align: "center" },
    });
  }
  tl.meta = { ...opts.meta };
  return tl;
}

/** New on-screen text item ("Ton texte" default style), dropped at the given timeline position. */
export function createTextItem(opts: { start: number; text: string }): TextItem {
  return {
    id: nanoid(8),
    type: "text",
    start: opts.start,
    duration: 3,
    text: opts.text,
    x: 0.5,
    y: 0.18,
    maxWidth: 0.86,
    style: { fontSize: 72, fontWeight: 800, color: "#ffffff", background: null, align: "center" },
  };
}

/** New audio clip (e.g. an SFX drop) referencing an already-registered asset. */
export function createAudioItem(opts: {
  start: number;
  assetId: string;
  sourceIn: number;
  sourceOut: number;
  volume: number;
}): AudioItem {
  return {
    id: nanoid(8),
    type: "audio",
    start: opts.start,
    assetId: opts.assetId,
    sourceIn: opts.sourceIn,
    sourceOut: opts.sourceOut,
    volume: opts.volume,
  };
}

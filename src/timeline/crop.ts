import type { Crop, CropKeyframe, Rect, Shot, ShotLayout } from "./schema";

const CENTER: CropKeyframe = { t: 0, x: 0.5, y: 0.5, zoom: 1 };

type Size = { width: number; height: number };
export type Box = { width: number; height: number; left: number; top: number };

/** Keyframe at source time `t`, linearly interpolated. */
export function keyframeAt(kfs: CropKeyframe[], t: number): CropKeyframe {
  if (kfs.length === 0) return { ...CENTER, t };
  if (kfs.length === 1 || t <= kfs[0].t) return { ...kfs[0], t };
  const last = kfs[kfs.length - 1];
  if (t >= last.t) return { ...last, t };
  let i = 0;
  while (kfs[i + 1].t < t) i++;
  const a = kfs[i];
  const b = kfs[i + 1];
  const k = (t - a.t) / (b.t - a.t);
  return {
    t,
    x: a.x + (b.x - a.x) * k,
    y: a.y + (b.y - a.y) * k,
    zoom: a.zoom + (b.zoom - a.zoom) * k,
  };
}

/** Content window of a split shot at source time `t`, following its horizontal pans. */
export function contentAt(shot: Extract<Shot, { layout: "split" }>, t: number): Rect {
  if (!shot.pan?.length) return shot.content;
  const kf = keyframeAt(
    shot.pan.map((p) => ({ t: p.t, x: p.x, y: 0.5, zoom: 1 })),
    t,
  );
  const w = shot.content.w;
  return { ...shot.content, x: clamp(kf.x - w / 2, 0, 1 - w) };
}

/** Crop window at source time `t`, linearly interpolated between keyframes. */
export function cropAt(crop: Crop, t: number): CropKeyframe {
  return keyframeAt(crop.mode === "center" ? [] : crop.keyframes, t);
}

/** Shot active at source time `t` (step function → hard cuts between shots). */
export function shotAt(crop: Crop, t: number): Shot {
  const shots = crop.mode === "auto" ? crop.shots : undefined;
  if (!shots?.length) {
    const kfs = crop.mode === "center" || crop.keyframes.length === 0 ? [CENTER] : crop.keyframes;
    return { t: 0, layout: "crop", keyframes: kfs };
  }
  let i = 0;
  while (i + 1 < shots.length && shots[i + 1].t <= t) i++;
  return shots[i];
}

/**
 * Shots covering source range [from, to] out of shots computed over a wider window: the shot active
 * at `from` (moved to start there), then those starting inside the range.
 */
export function shotsInRange(shots: Shot[], from: number, to: number): Shot[] {
  if (!shots.length) return [];
  let i = 0;
  while (i + 1 < shots.length && shots[i + 1].t <= from) i++;
  return [{ ...shots[i], t: from }, ...shots.slice(i + 1).filter((s) => s.t < to)];
}

/**
 * Merge source ranges into analysis windows: ranges closer than `maxGap` share a window, as long
 * as it stays under `maxSpan` seconds. Framing a whole moment at once is far more reliable than
 * framing each short jump-cut piece on its own (facecam detection needs time and scene cuts).
 */
export function analysisWindows(ranges: [number, number][], maxGap = 20, maxSpan = 180): [number, number][] {
  const out: [number, number][] = [];
  for (const [a, b] of [...ranges].sort((x, y) => x[0] - y[0])) {
    const last = out[out.length - 1];
    if (last && a - last[1] <= maxGap && Math.max(last[1], b) - last[0] <= maxSpan) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

const DEFAULT_CAM: Rect = { x: 0, y: 0.6, w: 0.3, h: 0.4 };
const DEFAULT_CONTENT: Rect = { x: 0.2363, y: 0, w: 0.5273, h: 1 };

/** Change the layout of the shot at source time `t`, deriving sensible geometry for it. */
export function withShotLayout(crop: Crop, t: number, layout: ShotLayout): Crop {
  const shots = crop.mode === "auto" && crop.shots?.length ? crop.shots : [shotAt(crop, t)];
  let i = 0;
  while (i + 1 < shots.length && shots[i + 1].t <= t) i++;
  const cur = shots[i];
  if (cur.layout === layout) return crop;
  let next: Shot;
  if (layout === "fit") next = { t: cur.t, layout };
  else if (layout === "split") {
    const ref = shots.find((s) => s.layout === "split");
    next = ref?.layout === "split" ? { ...ref, t: cur.t } : { t: cur.t, layout, cam: DEFAULT_CAM, content: DEFAULT_CONTENT, ratio: 0.4 };
  } else {
    // Frame what the facecam showed, or the center of the frame.
    const kf: CropKeyframe =
      cur.layout === "split"
        ? { t: cur.t, x: cur.cam.x + cur.cam.w / 2, y: cur.cam.y + cur.cam.h / 2, zoom: clamp(1 / (cur.cam.h * 1.1), 1, 3) }
        : { ...CENTER, t: cur.t };
    next = { t: cur.t, layout, keyframes: [kf] };
  }
  return { mode: "auto", keyframes: [], shots: shots.map((s, k) => (k === i ? next : s)) };
}

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}

/**
 * CSS transform that fills an output frame (outW×outH) with a source (srcW×srcH),
 * centered on the crop point and clamped so no empty border shows.
 */
export function cropTransform(kf: CropKeyframe, src: Size, out: Size): Box {
  const cover = Math.max(out.width / src.width, out.height / src.height);
  const scale = cover * kf.zoom;
  const width = src.width * scale;
  const height = src.height * scale;
  const left = clamp(out.width / 2 - kf.x * width, out.width - width, 0);
  const top = clamp(out.height / 2 - kf.y * height, out.height - height, 0);
  return { width, height, left, top };
}

/**
 * Fill an output box with a normalized source region (cover, centered on the region),
 * clamped so the box never shows past the source edges. Coordinates are relative to the box.
 */
export function regionTransform(region: Rect, src: Size, out: Size): Box {
  const s = Math.max(out.width / (region.w * src.width), out.height / (region.h * src.height));
  const width = src.width * s;
  const height = src.height * s;
  const cx = region.x + region.w / 2;
  const cy = region.y + region.h / 2;
  const left = clamp(out.width / 2 - cx * width, out.width - width, 0);
  const top = clamp(out.height / 2 - cy * height, out.height - height, 0);
  return { width, height, left, top };
}

/** Whole source inside the output frame (letterbox), centered. */
export function fitTransform(src: Size, out: Size): Box {
  const s = Math.min(out.width / src.width, out.height / src.height);
  const width = src.width * s;
  const height = src.height * s;
  return { width, height, left: (out.width - width) / 2, top: (out.height - height) / 2 };
}

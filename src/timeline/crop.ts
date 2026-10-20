import type { Crop, CropKeyframe } from "./schema";

const CENTER: CropKeyframe = { t: 0, x: 0.5, y: 0.5, zoom: 1 };

/** Crop window at source time `t`, linearly interpolated between keyframes. */
export function cropAt(crop: Crop, t: number): CropKeyframe {
  const kfs = crop.mode === "center" || crop.keyframes.length === 0 ? [CENTER] : crop.keyframes;
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

/**
 * CSS transform that fills an output frame (outW×outH) with a source (srcW×srcH),
 * centered on the crop point and clamped so no empty border shows.
 */
export function cropTransform(
  kf: CropKeyframe,
  src: { width: number; height: number },
  out: { width: number; height: number },
): { width: number; height: number; left: number; top: number } {
  const cover = Math.max(out.width / src.width, out.height / src.height);
  const scale = cover * kf.zoom;
  const width = src.width * scale;
  const height = src.height * scale;
  const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
  const left = clamp(out.width / 2 - kf.x * width, out.width - width, 0);
  const top = clamp(out.height / 2 - kf.y * height, out.height - height, 0);
  return { width, height, left, top };
}

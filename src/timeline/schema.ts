import { z } from "zod";

/**
 * Timeline = single source of truth for a short.
 * Read/written by the human editor, the Remotion preview/render,
 * and (from V3) by agents. All times are in seconds.
 */

export const TIMELINE_VERSION = 1;

const id = z.string().min(1);
const seconds = z.number().nonnegative();

export const assetSchema = z.object({
  id,
  kind: z.enum(["video", "audio"]),
  /** Path relative to the library root, e.g. "sources/abc/proxy.mp4". */
  src: z.string().min(1),
  /** Full-quality file used at render time (falls back to `src`). */
  renderSrc: z.string().min(1).optional(),
  durationSec: z.number().positive(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
});

/** Crop keyframe for 9:16 reframing, keyed on SOURCE time. */
export const cropKeyframeSchema = z.object({
  t: seconds,
  /** Center of the crop window, normalized 0..1 on the source frame. */
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  /** 1 = crop fills output height; >1 zooms in. */
  zoom: z.number().min(1).max(4).default(1),
});

const unit = z.number().min(0).max(1);

/** Rectangle normalized 0..1 on the source frame (top-left corner + size). */
export const rectSchema = z.object({ x: unit, y: unit, w: unit.positive(), h: unit.positive() });

export const shotLayouts = ["crop", "split", "fit"] as const;

/** A shot holds one layout over SOURCE time [t, next shot.t): switching shots is a hard cut. */
export const shotSchema = z.discriminatedUnion("layout", [
  z.object({ t: seconds, layout: z.literal("crop"), keyframes: z.array(cropKeyframeSchema).min(1) }),
  z.object({
    t: seconds,
    layout: z.literal("split"),
    /** Facecam region, shown on top. */
    cam: rectSchema,
    /** Content region (gameplay, screen…), shown below. */
    content: rectSchema,
    /** Share of the output height given to the facecam. */
    ratio: z.number().min(0.2).max(0.7).default(0.4),
    /** Horizontal pans of the content window (its center x over SOURCE time). */
    pan: z.array(z.object({ t: seconds, x: z.number().min(0).max(1) })).optional(),
  }),
  /** Whole source frame letterboxed over a blurred copy of itself. */
  z.object({ t: seconds, layout: z.literal("fit") }),
]);

export const cropSchema = z.object({
  mode: z.enum(["auto", "manual", "center"]),
  keyframes: z.array(cropKeyframeSchema),
  /** When present (auto mode), takes precedence over `keyframes`. Sorted by `t`. */
  shots: z.array(shotSchema).optional(),
});

const baseItem = {
  id,
  /** Start position on the timeline. */
  start: seconds,
};

export const videoItemSchema = z.object({
  ...baseItem,
  type: z.literal("video"),
  assetId: id,
  sourceIn: seconds,
  sourceOut: seconds,
  volume: z.number().min(0).max(2).default(1),
  crop: cropSchema.default({ mode: "auto", keyframes: [] }),
});

export const audioItemSchema = z.object({
  ...baseItem,
  type: z.literal("audio"),
  assetId: id,
  sourceIn: seconds,
  sourceOut: seconds,
  volume: z.number().min(0).max(2).default(1),
});

export const textStyleSchema = z.object({
  fontSize: z.number().positive().default(72),
  fontWeight: z.number().int().min(100).max(900).default(800),
  color: z.string().default("#ffffff"),
  background: z.string().nullable().default(null),
  align: z.enum(["left", "center", "right"]).default("center"),
});

export const textItemSchema = z.object({
  ...baseItem,
  type: z.literal("text"),
  duration: z.number().positive(),
  text: z.string(),
  /** Anchor (center of the text box), normalized 0..1 on the output frame. */
  x: z.number().min(0).max(1).default(0.5),
  y: z.number().min(0).max(1).default(0.18),
  /** Max box width, normalized on output width. */
  maxWidth: z.number().min(0.1).max(1).default(0.86),
  style: textStyleSchema.default({
    fontSize: 72,
    fontWeight: 800,
    color: "#ffffff",
    background: null,
    align: "center",
  }),
});

export const itemSchema = z.discriminatedUnion("type", [
  videoItemSchema,
  audioItemSchema,
  textItemSchema,
]);

export const trackSchema = z.object({
  id,
  kind: z.enum(["video", "audio", "text"]),
  name: z.string(),
  muted: z.boolean().default(false),
  hidden: z.boolean().default(false),
  items: z.array(itemSchema),
});

export const timelineSchema = z.object({
  version: z.literal(TIMELINE_VERSION),
  fps: z.number().int().positive().default(30),
  width: z.number().int().positive().default(1080),
  height: z.number().int().positive().default(1920),
  assets: z.record(z.string(), assetSchema),
  /** Order = stacking order for visuals: index 0 is drawn first (bottom). */
  tracks: z.array(trackSchema),
  /** Free metadata (source, moment, preset in V2, agent notes in V3…). */
  meta: z.record(z.string(), z.unknown()).default({}),
});

export type Asset = z.infer<typeof assetSchema>;
export type CropKeyframe = z.infer<typeof cropKeyframeSchema>;
export type Crop = z.infer<typeof cropSchema>;
export type Rect = z.infer<typeof rectSchema>;
export type Shot = z.infer<typeof shotSchema>;
export type ShotLayout = Shot["layout"];
export type VideoItem = z.infer<typeof videoItemSchema>;
export type AudioItem = z.infer<typeof audioItemSchema>;
export type TextItem = z.infer<typeof textItemSchema>;
export type Item = z.infer<typeof itemSchema>;
export type Track = z.infer<typeof trackSchema>;
export type Timeline = z.infer<typeof timelineSchema>;

export function parseTimeline(input: unknown): Timeline {
  return timelineSchema.parse(input);
}

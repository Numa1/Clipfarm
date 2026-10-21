import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { DB } from "./db";
import { moments, projects, sources, transcripts, type Project } from "./db/schema";
import { onProjectCreated } from "./pipeline";
import { nicheConfig } from "@/config/niches";
import { applyStyle } from "@/styles/apply";
import { isStyleId, stylePreset } from "@/styles/presets";
import { timelineFromSegment } from "@/timeline/factory";
import { speechRanges } from "@/timeline/silence";

export type Segment = ({ momentId: string } | { sourceId: string; start: number; end: number; hook?: string }) & {
  /** Style explicite à appliquer (sinon : celui par défaut de la niche de la source, à défaut "chill"). */
  styleId?: string;
};

/** Style de repli quand la source n'a pas (encore) de niche connue. */
const FALLBACK_STYLE_ID = "chill";

/**
 * Create a project pre-cut on a suggested moment (or an arbitrary segment) and queue its
 * auto-reframe. Returns why it could not, as an HTTP-like status, otherwise the project.
 */
export function createProject(db: DB, body: Segment): { project: Project } | { error: string; status: number } {
  const moment = "momentId" in body ? db.select().from(moments).where(eq(moments.id, body.momentId)).get() : null;
  const seg = moment
    ? { sourceId: moment.sourceId, start: moment.start, end: moment.end, hook: moment.hook, title: moment.title }
    : "sourceId" in body
      ? body
      : null;
  if (!seg) return { error: "moment not found", status: 404 };

  const source = db.select().from(sources).where(eq(sources.id, seg.sourceId)).get();
  if (!source?.proxyPath || !source.durationSec) return { error: "source not ready", status: 409 };

  if (body.styleId !== undefined && !isStyleId(body.styleId)) {
    return { error: `style inconnu : ${body.styleId}`, status: 400 };
  }
  const styleId = body.styleId ?? (source.niche && nicheConfig(source.niche)?.defaultStyle) ?? FALLBACK_STYLE_ID;
  const style = stylePreset(styleId) ?? stylePreset(FALLBACK_STYLE_ID)!;

  // Dead air out: keep only the spoken parts of the segment, per the style's own silence policy.
  const words = db.select().from(transcripts).where(eq(transcripts.sourceId, source.id)).get()?.json.words ?? [];
  const teaser =
    moment?.teaserStart != null && moment.teaserEnd != null ? ([moment.teaserStart, moment.teaserEnd] as [number, number]) : undefined;

  const timeline = applyStyle(
    timelineFromSegment({
      // Asset id = source id (the worker relies on it to find the proxy).
      asset: {
        id: source.id,
        kind: "video",
        src: source.proxyPath,
        renderSrc: source.originalPath,
        durationSec: source.durationSec,
        width: source.width ?? undefined,
        height: source.height ?? undefined,
      },
      sourceIn: seg.start,
      sourceOut: seg.end,
      keep: speechRanges(words, seg.start, seg.end, { maxSilence: style.silence.maxSilence, pad: style.silence.speechPad }),
      teaser,
      hook: seg.hook,
      meta: { sourceId: source.id, momentId: moment?.id ?? null },
    }),
    style,
  );

  const project = db
    .insert(projects)
    .values({
      id: nanoid(10),
      name: "title" in seg && seg.title ? seg.title : seg.hook ? `${source.title} — ${seg.hook}` : source.title,
      sourceId: source.id,
      momentId: moment?.id ?? null,
      timeline,
      styleId: style.id,
    })
    .returning()
    .get();
  onProjectCreated(db, project.id);
  return { project };
}

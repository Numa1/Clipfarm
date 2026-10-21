import { eq } from "drizzle-orm";
import { z } from "zod";
import { HttpError, route } from "@/server/api";
import { getDb } from "@/server/db";
import { projects } from "@/server/db/schema";
import { applyStyle } from "@/styles/apply";
import { isStyleId, stylePreset } from "@/styles/presets";
import { parseTimeline } from "@/timeline/schema";

const bodySchema = z.object({ styleId: z.string() });

/**
 * Réapplique un style (`src/styles/presets.ts`) sur un projet existant : `meta.styleId` et les
 * paramètres de recadrage des clips en `crop.mode: "auto"` sont mis à jour, sans jamais toucher aux
 * clips dont le cadrage a été réglé à la main (`crop.mode: "manual"` ou `"center"`), voir
 * `src/styles/apply.ts`.
 */
export const POST = route({ path: "/api/projects/[id]/style", body: bodySchema, validationStatus: 400 }, ({ body, params: { id } }) => {
  if (!isStyleId(body.styleId)) throw new HttpError(400, "bad_request", `style inconnu : ${body.styleId}`);
  const style = stylePreset(body.styleId)!;

  const db = getDb();
  const project = db.select({ id: projects.id, timeline: projects.timeline }).from(projects).where(eq(projects.id, id)).get();
  if (!project) throw new HttpError(404, "not_found", "projet introuvable");

  const current = parseTimeline(project.timeline);
  const timeline = applyStyle(current, style);
  db.update(projects).set({ timeline, styleId: style.id, updatedAt: new Date() }).where(eq(projects.id, id)).run();

  return Response.json({ id, styleId: style.id });
});

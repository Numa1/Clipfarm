import { eq } from "drizzle-orm";
import { HttpError, route } from "@/server/api";
import { getDb } from "@/server/db";
import { sources, transcripts } from "@/server/db/schema";
import { activeJobsFor, enqueueJob } from "@/server/jobs";

/** Search the moments again (after a prompt change or once the creator's name is set). */
export const POST = route({ path: "/api/sources/[id]/moments" }, ({ params: { id } }) => {
  const db = getDb();
  const source = db.select().from(sources).where(eq(sources.id, id)).get();
  if (!source) throw new HttpError(404, "not_found", "not found");
  if (activeJobsFor(db, { sourceId: id }).length) throw new HttpError(409, "conflict", "a job is already running for this source");
  const tr = db.select({ id: transcripts.sourceId }).from(transcripts).where(eq(transcripts.sourceId, id)).get();
  if (!tr) throw new HttpError(409, "conflict", "source not transcribed yet");
  db.update(sources).set({ status: "analyzing", error: null }).where(eq(sources.id, id)).run();
  return Response.json(enqueueJob(db, "moments", { sourceId: id }), { status: 202 });
});

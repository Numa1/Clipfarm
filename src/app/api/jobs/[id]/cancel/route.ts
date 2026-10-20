import { eq } from "drizzle-orm";
import { HttpError, route } from "@/server/api";
import { getDb } from "@/server/db";
import { jobs } from "@/server/db/schema";
import { cancelJob } from "@/server/jobs";

/** Cancel a queued or running job (the worker stops a running one within a second). */
export const POST = route({ path: "/api/jobs/[id]/cancel" }, ({ params: { id } }) => {
  const db = getDb();
  const job = cancelJob(db, id);
  if (job) return Response.json(job);
  const existing = db.select().from(jobs).where(eq(jobs.id, id)).get();
  if (!existing) throw new HttpError(404, "not_found", "not found");
  throw new HttpError(409, "conflict", `job already ${existing.status}`);
});

import { eq } from "drizzle-orm";
import { HttpError, route } from "@/server/api";
import { getDb } from "@/server/db";
import { jobs } from "@/server/db/schema";

export const GET = route({ path: "/api/jobs/[id]" }, ({ params: { id } }) => {
  const job = getDb().select().from(jobs).where(eq(jobs.id, id)).get();
  if (!job) throw new HttpError(404, "not_found", "not found");
  return Response.json(job);
});

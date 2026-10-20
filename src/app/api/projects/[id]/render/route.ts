import { eq } from "drizzle-orm";
import { HttpError, route } from "@/server/api";
import { getDb } from "@/server/db";
import { projects } from "@/server/db/schema";
import { enqueueJob } from "@/server/jobs";

export const POST = route({ path: "/api/projects/[id]/render" }, ({ params: { id } }) => {
  const db = getDb();
  const project = db.select({ id: projects.id }).from(projects).where(eq(projects.id, id)).get();
  if (!project) throw new HttpError(404, "not_found", "not found");
  const job = enqueueJob(db, "render", { projectId: id });
  return Response.json(job, { status: 202 });
});

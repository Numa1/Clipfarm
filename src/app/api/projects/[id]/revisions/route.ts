import { HttpError, route } from "@/server/api";
import { getDb } from "@/server/db";
import { listRevisions } from "@/server/timeline-store";

/** Paginated revision history for a project, newest first: `?limit=20&before=<rev>`. */
export const GET = route({ path: "/api/projects/[id]/revisions" }, ({ request, params: { id } }) => {
  const url = new URL(request.url);
  const limitParam = url.searchParams.get("limit");
  const beforeParam = url.searchParams.get("before");

  const limit = limitParam ? Number(limitParam) : undefined;
  if (limit != null && (!Number.isInteger(limit) || limit < 1)) {
    throw new HttpError(400, "bad_request", "limit doit être un entier positif");
  }
  const before = beforeParam ? Number(beforeParam) : undefined;
  if (before != null && !Number.isInteger(before)) {
    throw new HttpError(400, "bad_request", "before doit être un entier");
  }

  const page = listRevisions(getDb(), id, { limit, before });
  return Response.json(page);
});

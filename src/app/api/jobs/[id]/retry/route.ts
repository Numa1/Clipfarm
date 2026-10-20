import { httpError, route } from "@/server/api";
import { getDb } from "@/server/db";
import { retryJob } from "@/server/jobs";

/** Queue a failed or cancelled job again, with the same payload. */
export const POST = route({ path: "/api/jobs/[id]/retry" }, ({ params: { id } }) => {
  const res = retryJob(getDb(), id);
  if ("error" in res) throw httpError(res.status, res.error);
  return Response.json(res.job, { status: 201 });
});

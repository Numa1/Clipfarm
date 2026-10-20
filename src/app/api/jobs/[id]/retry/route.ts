import { getDb } from "@/server/db";
import { retryJob } from "@/server/jobs";

/** Queue a failed or cancelled job again, with the same payload. */
export async function POST(_req: Request, ctx: RouteContext<"/api/jobs/[id]/retry">) {
  const { id } = await ctx.params;
  const res = retryJob(getDb(), id);
  if ("error" in res) return Response.json({ error: res.error }, { status: res.status });
  return Response.json(res.job, { status: 201 });
}

import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { desc, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { connection } from "next/server";
import { HttpError, route } from "@/server/api";
import { getDb } from "@/server/db";
import { costSelect, toCost } from "@/server/costs";
import { sources } from "@/server/db/schema";
import { enqueueJob } from "@/server/jobs";
import { VIDEO_TYPES } from "@/server/media";
import { rel, sourceDir } from "@/server/paths";

export const GET = route({ local: true }, async () => {
  await connection();
  const db = getDb();
  const rows = db
    .select({
      source: sources,
      // Qualified by hand: drizzle renders unqualified column names inside raw subqueries.
      momentCount: sql<number>`(select count(*) from "moments" where "moments"."source_id" = "sources"."id")`,
      projectCount: sql<number>`(select count(*) from "projects" where "projects"."source_id" = "sources"."id")`,
      exportCount: sql<number>`(select count(*) from "projects" where "projects"."source_id" = "sources"."id" and "projects"."last_export_path" is not null)`,
      ...costSelect(`"sources"."id"`),
    })
    .from(sources)
    .orderBy(desc(sources.createdAt))
    .all();
  return Response.json(
    rows.map(({ source, momentCount, projectCount, exportCount, ...cost }) => ({
      ...source,
      momentCount,
      projectCount,
      exportCount,
      cost: toCost(cost),
    })),
  );
});

/** Streamed upload: raw file body + `x-filename` header (no multipart, no memory buffering). */
// No `body` schema: the wrapper must not consume the stream.
export const POST = route({ local: true }, async ({ request }) => {
  const filename = decodeURIComponent(request.headers.get("x-filename") ?? "video.mp4");
  if (!request.body) throw new HttpError(400, "bad_request", "empty body");
  const ext = path.extname(filename).toLowerCase() || ".mp4";
  // Only video files: anything else could not be served back (see resolveMedia).
  if (!(ext in VIDEO_TYPES)) throw new HttpError(415, "unsupported_media_type", `unsupported video type ${ext}`);

  const id = nanoid(10);
  const dir = sourceDir(id);
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, `original${ext}`);
  await pipeline(Readable.fromWeb(request.body as never), fs.createWriteStream(dest));

  const db = getDb();
  const source = db
    .insert(sources)
    .values({ id, title: path.basename(filename, path.extname(filename)), originalPath: rel(dest) })
    .returning()
    .get();
  enqueueJob(db, "ingest", { sourceId: id });
  return Response.json(source, { status: 201 });
});

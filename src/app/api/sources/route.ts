import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { desc, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { connection } from "next/server";
import { getDb } from "@/server/db";
import { sources } from "@/server/db/schema";
import { enqueueJob } from "@/server/jobs";
import { refuseNonLocal } from "@/server/local-guard";
import { VIDEO_TYPES } from "@/server/media";
import { rel, sourceDir } from "@/server/paths";

export async function GET(request: Request) {
  await connection();
  const refused = refuseNonLocal(request);
  if (refused) return refused;
  const db = getDb();
  const rows = db
    .select({
      source: sources,
      // Qualified by hand: drizzle renders unqualified column names inside raw subqueries.
      momentCount: sql<number>`(select count(*) from "moments" where "moments"."source_id" = "sources"."id")`,
    })
    .from(sources)
    .orderBy(desc(sources.createdAt))
    .all();
  return Response.json(rows.map((r) => ({ ...r.source, momentCount: r.momentCount })));
}

/** Streamed upload: raw file body + `x-filename` header (no multipart, no memory buffering). */
export async function POST(request: Request) {
  const refused = refuseNonLocal(request);
  if (refused) return refused;
  const filename = decodeURIComponent(request.headers.get("x-filename") ?? "video.mp4");
  if (!request.body) return Response.json({ error: "empty body" }, { status: 400 });
  const ext = path.extname(filename).toLowerCase() || ".mp4";
  // Only video files: anything else could not be served back (see resolveMedia).
  if (!(ext in VIDEO_TYPES)) return Response.json({ error: `unsupported video type ${ext}` }, { status: 415 });

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
}

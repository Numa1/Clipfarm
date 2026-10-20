import fs from "node:fs";
import { Readable } from "node:stream";
import { contentTypeFor, parseRange, resolveMedia } from "@/server/media";

/** Serves library media (videos, audio) with HTTP Range support (required for <video> seeking). */
export async function GET(request: Request, ctx: RouteContext<"/api/media/[...path]">) {
  const { path: parts } = await ctx.params;
  const file = resolveMedia(parts.map(decodeURIComponent).join("/"));
  if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) return new Response("not found", { status: 404 });

  const size = fs.statSync(file).size;
  const range = parseRange(request.headers.get("range"), size);
  const headers = new Headers({ "Content-Type": contentTypeFor(file), "Accept-Ranges": "bytes" });
  const toWeb = (s: fs.ReadStream) => Readable.toWeb(s) as ReadableStream;

  if (range) {
    headers.set("Content-Range", `bytes ${range.start}-${range.end}/${size}`);
    headers.set("Content-Length", String(range.end - range.start + 1));
    return new Response(toWeb(fs.createReadStream(file, range)), { status: 206, headers });
  }
  headers.set("Content-Length", String(size));
  return new Response(toWeb(fs.createReadStream(file)), { status: 200, headers });
}

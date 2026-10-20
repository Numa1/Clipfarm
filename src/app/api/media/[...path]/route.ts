import fs from "node:fs";
import { Readable } from "node:stream";
import { HttpError, route } from "@/server/api";
import { contentTypeFor, parseRange, resolveMedia } from "@/server/media";

/** Serves library media (videos, audio) with HTTP Range support (required for <video> seeking). */
export const GET = route({ path: "/api/media/[...path]" }, ({ request, params: { path: parts } }) => {
  const file = resolveMedia(parts.map(decodeURIComponent).join("/"));
  if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) throw new HttpError(404, "not_found", "not found");

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
});

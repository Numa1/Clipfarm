import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { connection } from "next/server";
import { refuseNonLocal } from "@/server/local-guard";
import { rel, SFX_DIR } from "@/server/paths";

const AUDIO_EXT = new Set([".mp3", ".wav", ".m4a", ".aac", ".ogg"]);

/** Local SFX / music library: every audio file dropped in library/sfx. */
export async function GET(request: Request) {
  await connection();
  const refused = refuseNonLocal(request);
  if (refused) return refused;
  fs.mkdirSync(SFX_DIR, { recursive: true });
  const files = fs
    .readdirSync(SFX_DIR)
    .filter((f) => AUDIO_EXT.has(path.extname(f).toLowerCase()))
    .sort()
    .map((f) => ({ name: path.basename(f, path.extname(f)), src: rel(path.join(SFX_DIR, f)) }));
  return Response.json(files);
}

export async function POST(request: Request) {
  const refused = refuseNonLocal(request);
  if (refused) return refused;
  const filename = path.basename(decodeURIComponent(request.headers.get("x-filename") ?? ""));
  if (!filename || !AUDIO_EXT.has(path.extname(filename).toLowerCase()) || !request.body) {
    return Response.json({ error: "audio file expected" }, { status: 400 });
  }
  fs.mkdirSync(SFX_DIR, { recursive: true });
  const dest = path.join(SFX_DIR, filename);
  await pipeline(Readable.fromWeb(request.body as never), fs.createWriteStream(dest));
  return Response.json({ name: path.basename(filename, path.extname(filename)), src: rel(dest) }, { status: 201 });
}

import path from "node:path";
import { rel, resolveInLibrary } from "./paths";

export const VIDEO_TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".avi": "video/x-msvideo",
};

const AUDIO_TYPES: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".ogg": "audio/ogg",
};

const TYPES = { ...VIDEO_TYPES, ...AUDIO_TYPES };

/** Library folders whose media may be served over HTTP. The DB, its WAL and transcripts never are. */
const MEDIA_DIRS = new Set(["sources", "exports", "sfx"]);

export function contentTypeFor(file: string): string {
  return TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";
}

/** Absolute path of a servable media file (video/audio inside a media folder), or null. */
export function resolveMedia(relPath: string): string | null {
  const abs = resolveInLibrary(relPath);
  if (!abs) return null;
  const top = rel(abs).split("/")[0];
  return MEDIA_DIRS.has(top) && path.extname(abs).toLowerCase() in TYPES ? abs : null;
}

/** Parse a single "bytes=a-b" range header (what browsers and Remotion send). */
export function parseRange(header: string | null, size: number): { start: number; end: number } | null {
  const m = header && /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!m) return null;
  let start = m[1] ? Number(m[1]) : NaN;
  let end = m[2] ? Number(m[2]) : size - 1;
  if (Number.isNaN(start)) {
    // Suffix range: last N bytes.
    start = Math.max(0, size - end);
    end = size - 1;
  }
  if (start > end || start >= size) return null;
  return { start, end: Math.min(end, size - 1) };
}

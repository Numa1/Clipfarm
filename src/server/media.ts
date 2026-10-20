import path from "node:path";

const TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".ogg": "audio/ogg",
  ".json": "application/json",
};

export function contentTypeFor(file: string): string {
  return TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";
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

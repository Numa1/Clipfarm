import path from "node:path";

/** Root of all heavy files (sources, proxies, audio, exports, sfx) and the DB. Only media are served (see resolveMedia). */
export const LIBRARY_DIR = path.resolve(/*turbopackIgnore: true*/ process.env.CLIPFARM_LIBRARY ?? path.join(process.cwd(), "library"));
export const DB_PATH = path.join(LIBRARY_DIR, "clipfarm.db");

export const sourceDir = (sourceId: string) => path.join(LIBRARY_DIR, "sources", sourceId);
export const EXPORTS_DIR = path.join(LIBRARY_DIR, "exports");
export const SFX_DIR = path.join(LIBRARY_DIR, "sfx");

/** Library-relative path (what timelines and the DB store). */
export const rel = (abs: string) => path.relative(LIBRARY_DIR, abs).split(path.sep).join("/");

/** Resolve a library-relative path, refusing anything that escapes the library. */
export function resolveInLibrary(relPath: string): string | null {
  const abs = path.resolve(LIBRARY_DIR, relPath);
  return abs.startsWith(LIBRARY_DIR + path.sep) ? abs : null;
}

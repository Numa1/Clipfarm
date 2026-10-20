/**
 * Timeline schema migrations. Kept free of imports from ./schema (which depends on this file),
 * so the target version lives here and schema.ts re-exports it as TIMELINE_VERSION.
 */

const LATEST_VERSION = 2;

/** Brings any known timeline version up to the latest one; unknown input is returned untouched. */
export function migrateTimeline(input: unknown): unknown {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return input;
  const tl = input as Record<string, unknown>;
  if (tl.version === 1) {
    // v2 only adds the caption track/item and typed meta keys: nothing to rewrite.
    return { ...tl, version: LATEST_VERSION, meta: tl.meta ?? {} };
  }
  return input;
}

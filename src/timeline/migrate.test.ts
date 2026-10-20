import { describe, expect, it } from "vitest";
import { emptyTimeline } from "./factory";
import { migrateTimeline } from "./migrate";
import { parseTimeline, timelineSchema, TIMELINE_VERSION } from "./schema";

const asset = { id: "a", kind: "video", src: "sources/a/proxy.mp4", durationSec: 100 };
const videoItem = { id: "v1", type: "video", start: 0, assetId: "a", sourceIn: 5, sourceOut: 15, volume: 1, crop: { mode: "auto", keyframes: [] } };

function v1(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    fps: 30,
    width: 1080,
    height: 1920,
    assets: { a: asset },
    tracks: [{ id: "video", kind: "video", name: "Vidéo", muted: false, hidden: false, items: [videoItem] }],
    meta: { hook: "Salut", custom: { n: 1 } },
    ...overrides,
  };
}

function issues(input: unknown): string[] {
  const r = timelineSchema.safeParse(input);
  return r.success ? [] : r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
}

describe("migrateTimeline", () => {
  it("moves v1 to v2 and keeps every field", () => {
    const input = v1();
    const out = migrateTimeline(input) as Record<string, unknown>;
    expect(out.version).toBe(2);
    expect({ ...out, version: 1 }).toEqual(input);
  });

  it("is idempotent on a v2", () => {
    const once = migrateTimeline(v1());
    expect(migrateTimeline(once)).toEqual(once);
  });

  it("targets the schema version and leaves unknown input alone", () => {
    expect((migrateTimeline(v1()) as { version: number }).version).toBe(TIMELINE_VERSION);
    expect(migrateTimeline(null)).toBeNull();
    expect(migrateTimeline("x")).toBe("x");
  });
});

describe("timelineSchema", () => {
  it("accepts v1 and v2 and returns a v2", () => {
    const a = timelineSchema.safeParse(v1());
    const b = timelineSchema.safeParse({ ...v1(), version: 2 });
    expect(a.success && a.data.version).toBe(2);
    expect(b.success && b.data.version).toBe(2);
    expect(parseTimeline(emptyTimeline()).version).toBe(2);
  });

  it("keeps meta keys, typed or not", () => {
    const meta = { sourceId: "s", momentId: null, niche: "gaming", hooks: [{ text: "h", kind: "question", score: 0.8 }], hook: "Salut" };
    const tl = parseTimeline(v1({ meta }));
    expect(tl.meta).toEqual(meta);
  });

  it("rejects a malformed hook", () => {
    expect(issues(v1({ meta: { hooks: [{ kind: "x" }] } })).join()).toContain("meta.hooks.0.text");
  });

  it("accepts a caption track with caption items", () => {
    const caption = { id: "c1", type: "caption", start: 0, duration: 2, words: [{ w: "yo", start: 0, end: 0.5 }], styleId: "s" };
    const tl = parseTimeline(
      v1({ tracks: [...v1().tracks, { id: "cap", kind: "caption", name: "Sous-titres", items: [caption] }] }),
    );
    expect(tl.tracks[1].items[0]).toEqual(caption);
  });

  it("does not create a caption track in emptyTimeline", () => {
    expect(emptyTimeline().tracks.some((t) => t.kind === "caption")).toBe(false);
  });

  it("rejects an orphan assetId", () => {
    const tl = v1();
    tl.tracks[0].items = [{ ...videoItem, assetId: "ghost" }];
    expect(issues(tl)).toEqual([expect.stringContaining("tracks.0.items.0.assetId: L’asset « ghost » n’existe pas")]);
  });

  it("rejects an item type that does not match its track", () => {
    const tl = v1();
    tl.tracks[0].kind = "audio";
    expect(issues(tl).join()).toContain("tracks.0.items.0.type");
  });

  it("rejects duplicate item ids", () => {
    const tl = v1();
    tl.tracks[0].items = [videoItem, { ...videoItem, start: 10 }];
    expect(issues(tl)).toEqual([expect.stringContaining("tracks.0.items.1.id: Identifiant d’élément dupliqué : v1")]);
  });

  it("rejects sourceOut <= sourceIn", () => {
    const tl = v1();
    tl.tracks[0].items = [{ ...videoItem, sourceOut: 5 }];
    expect(issues(tl)).toEqual([expect.stringContaining("tracks.0.items.0.sourceOut")]);
  });
});

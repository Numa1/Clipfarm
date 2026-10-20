import { describe, expect, it } from "vitest";
import { timelineFromSegment } from "./factory";

describe("timelineFromSegment", () => {
  it("places the teaser, then the kept ranges back to back", () => {
    const tl = timelineFromSegment({
      asset: { id: "src", kind: "video", src: "sources/src/proxy.mp4", durationSec: 600 },
      sourceIn: 100,
      sourceOut: 140,
      keep: [
        [100, 110],
        [115, 140],
      ],
      teaser: [130, 133],
      hook: "Le hook",
    });
    const clips = tl.tracks[0].items.map((i) => (i.type === "video" ? [i.start, i.sourceIn, i.sourceOut] : null));
    expect(clips).toEqual([
      [0, 130, 133],
      [3, 100, 110],
      [13, 115, 140],
    ]);
    expect(tl.tracks[1].items[0]).toMatchObject({ type: "text", start: 0, duration: 3, text: "Le hook" });
  });
});

import { describe, expect, it } from "vitest";
import { analysisWindows, shotsInRange } from "./crop";
import type { Shot } from "./schema";

describe("shotsInRange", () => {
  const shots: Shot[] = [
    { t: 100, layout: "fit" },
    { t: 105, layout: "crop", keyframes: [{ t: 105, x: 0.5, y: 0.5, zoom: 1 }] },
    { t: 110, layout: "fit" },
  ];

  it("starts with the shot active at the range start, then the shots inside", () => {
    expect(shotsInRange(shots, 103, 112).map((s) => [s.t, s.layout])).toEqual([
      [103, "fit"],
      [105, "crop"],
      [110, "fit"],
    ]);
    expect(shotsInRange(shots, 106, 109).map((s) => [s.t, s.layout])).toEqual([[106, "crop"]]);
  });
});

describe("analysisWindows", () => {
  it("merges close ranges (jump cuts, teaser) into one window", () => {
    expect(
      analysisWindows([
        [120, 123],
        [100, 104],
        [105, 130],
      ]),
    ).toEqual([[100, 130]]);
  });

  it("keeps distant ranges apart and caps the window length", () => {
    expect(analysisWindows([[0, 10], [50, 60]])).toEqual([[0, 10], [50, 60]]);
    expect(analysisWindows([[0, 100], [110, 200]], 20, 150)).toEqual([[0, 100], [110, 200]]);
  });
});

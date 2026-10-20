import { describe, expect, it } from "vitest";
import { speechIntervals } from "./reframe";

describe("speechIntervals", () => {
  it("merges close words and keeps only the clip range", () => {
    const words = [
      { w: "avant", start: 1, end: 1.5 },
      { w: "salut", start: 10, end: 10.4 },
      { w: "à", start: 10.6, end: 10.8 },
      { w: "tous", start: 11, end: 11.5 },
      { w: "pause", start: 14, end: 14.5 },
      { w: "après", start: 30, end: 31 },
    ];
    expect(speechIntervals(words, 9, 20)).toEqual([
      [10, 11.5],
      [14, 14.5],
    ]);
  });
});

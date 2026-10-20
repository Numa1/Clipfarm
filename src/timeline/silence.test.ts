import { describe, expect, it } from "vitest";
import { speechRanges } from "./silence";

const w = (start: number, end: number) => ({ start, end });

describe("speechRanges", () => {
  it("cuts long silences and keeps a little air around speech", () => {
    const words = [w(10, 10.5), w(11.2, 11.5), w(14, 14.5), w(14.9, 15.2)];
    expect(speechRanges(words, 9, 20)).toEqual([
      [9.75, 11.75],
      [13.75, 15.45],
    ]);
  });

  it("clamps to the segment and ignores words outside it", () => {
    expect(speechRanges([w(1, 2), w(9.9, 10.4), w(30, 31)], 10, 20)).toEqual([[10, 10.65]]);
  });

  it("keeps the whole segment when nobody speaks", () => {
    expect(speechRanges([], 5, 12)).toEqual([[5, 12]]);
  });
});

import { describe, expect, it } from "vitest";
import { computeBaseSignals } from "./signals";

const source = (over: Partial<{ lang: string | null; width: number | null; height: number | null }> = {}) => ({
  lang: "fr",
  width: 1920,
  height: 1080,
  ...over,
});

describe("computeBaseSignals", () => {
  it("returns lang and resolution straight from the source, without a transcript", () => {
    expect(computeBaseSignals(source(), null)).toEqual({
      wordsPerSec: null,
      contentVoiceShare: null,
      lang: "fr",
      width: 1920,
      height: 1080,
      aspectRatio: 1920 / 1080,
    });
  });

  it("falls back to null when lang or dimensions are missing", () => {
    const s = computeBaseSignals(source({ lang: null, width: null, height: 1080 }), []);
    expect(s.lang).toBeNull();
    expect(s.aspectRatio).toBeNull();
  });

  it("computes the creator's speech rate from words that are not the content's voice", () => {
    const words = [
      { w: "Salut", start: 0, end: 0.5 },
      { w: "à", start: 0.5, end: 0.7 },
      { w: "tous", start: 0.7, end: 1.0 },
      { w: "GOAL", start: 1.0, end: 1.5, vo: true }, // game audio, not counted as creator speech
    ];
    const s = computeBaseSignals(source(), words);
    // 3 creator words over the full span (0 → 1.5s).
    expect(s.wordsPerSec).toBeCloseTo(3 / 1.5, 5);
  });

  it("computes the content-voice share from the vo flag", () => {
    const words = [
      { w: "a", start: 0, end: 1 },
      { w: "b", start: 1, end: 2, vo: true },
      { w: "c", start: 2, end: 3, vo: true },
      { w: "d", start: 3, end: 4, vo: false },
    ];
    expect(computeBaseSignals(source(), words).contentVoiceShare).toBeCloseTo(2 / 4, 5);
  });

  it("returns null rates on an empty transcript", () => {
    const s = computeBaseSignals(source(), []);
    expect(s.wordsPerSec).toBeNull();
    expect(s.contentVoiceShare).toBeNull();
  });
});

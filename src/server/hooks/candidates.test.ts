import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Word } from "@/server/db/schema";
import { combineHookCandidates, detectTextCandidates, findLoudnessPeaks, parseEbur128Output } from "./candidates";

const FIXTURE_PATH = path.join(__dirname, "__fixtures__", "ebur128-sample.txt");

/** Construit des `Word` horodatés à partir d'une phrase : 0.3 s par mot, qui s'enchaînent. */
function wordsFrom(text: string, startAt = 0): Word[] {
  let t = startAt;
  return text.split(" ").map((w) => {
    const word = { w, start: t, end: t + 0.3 };
    t += 0.3;
    return word;
  });
}

describe("parseEbur128Output", () => {
  it("parses t/M from real ffmpeg -filter:a ebur128 stderr output (fixture)", () => {
    const stderr = fs.readFileSync(FIXTURE_PATH, "utf8");
    const points = parseEbur128Output(stderr);
    // Le fichier de test enchaîne un passage calme, un passage fort (~ -22.3 LUFS) puis calme à nouveau.
    expect(points.length).toBeGreaterThan(30);
    const loud = points.find((p) => p.t > 2.3 && p.t < 3.0);
    expect(loud?.momentary).toBeCloseTo(-22.3, 1);
    const quiet = points.find((p) => p.t < 0.5);
    expect(quiet?.momentary).toBeLessThan(-100);
  });
});

describe("findLoudnessPeaks", () => {
  it("picks the loud plateau of the fixture, not the quiet sections", () => {
    const stderr = fs.readFileSync(FIXTURE_PATH, "utf8");
    const peaks = findLoudnessPeaks(parseEbur128Output(stderr), 3);
    expect(peaks.length).toBeGreaterThan(0);
    for (const p of peaks) {
      expect(p.t).toBeGreaterThan(2.0);
      expect(p.t).toBeLessThan(3.5);
      expect(p.momentary).toBeGreaterThan(-30);
    }
  });
});

describe("detectTextCandidates", () => {
  it("detects a sentence with an exclamation mark as a candidate", () => {
    const words = wordsFrom("Alors on commence la vidéo.").concat(
      wordsFrom("Il a explosé le record du monde !", 2),
    );
    const candidates = detectTextCandidates(words, 0, 10);
    const exclam = candidates.find((c) => c.reason === "exclamation");
    expect(exclam).toBeDefined();
    expect(exclam?.text).toContain("!");
  });

  it("detects a sentence with a question mark as a candidate", () => {
    const words = wordsFrom("Bon allons-y.").concat(wordsFrom("Vous savez ce qui s'est passé ensuite ?", 2));
    const candidates = detectTextCandidates(words, 0, 10);
    const question = candidates.find((c) => c.reason === "question");
    expect(question).toBeDefined();
  });

  it("rejects an obvious filler opener ('bon', 'alors', 'allez les gars') as a strong start", () => {
    const words = wordsFrom("Bon allez les gars on y va tranquillement.");
    const candidates = detectTextCandidates(words, 0, 10);
    expect(candidates.find((c) => c.reason === "strong_start")).toBeUndefined();
  });

  it("accepts a punchy opening sentence as a strong start", () => {
    const words = wordsFrom("J'ai explosé le record du monde hier soir.");
    const candidates = detectTextCandidates(words, 0, 10);
    const start = candidates.find((c) => c.reason === "strong_start");
    expect(start).toBeDefined();
    expect(start?.time).toBe(words[0].start);
  });

  it("ignores words marked as voices of the content (vo)", () => {
    const words: Word[] = [
      { w: "Game", start: 0, end: 0.3, vo: true },
      { w: "over!", start: 0.3, end: 0.6, vo: true },
    ];
    expect(detectTextCandidates(words, 0, 10)).toEqual([]);
  });

  it("only considers words inside [from, to]", () => {
    const words = wordsFrom("Quoi ?!", 100);
    expect(detectTextCandidates(words, 0, 10)).toEqual([]);
  });
});

describe("combineHookCandidates", () => {
  it("orders merged candidates chronologically", () => {
    const merged = combineHookCandidates([
      { time: 10, reason: "exclamation", score: 70 },
      { time: 2, reason: "volume", score: 50 },
      { time: 6, reason: "question", score: 65 },
    ]);
    expect(merged.map((c) => c.time)).toEqual([2, 6, 10]);
  });

  it("merges candidates that fall within the merge window into one, keeping the strongest reason", () => {
    const merged = combineHookCandidates([
      { time: 5.0, reason: "volume", score: 40 },
      { time: 5.4, reason: "exclamation", score: 80 },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].reason).toBe("exclamation");
    expect(merged[0].score).toBeGreaterThan(80);
  });
});

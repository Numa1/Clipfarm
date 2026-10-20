import path from "node:path";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { beforeEach, describe, expect, it } from "vitest";
import type { DB } from "./db";
import * as schema from "./db/schema";
import {
  estimateForSource,
  estimateFromDurationSec,
  estimateFromWordCount,
  estimateInputTokens,
  estimateWordCountFromDuration,
  wordCountOfTranscript,
} from "./estimate";

let db: DB;

beforeEach(() => {
  db = drizzle(new Database(":memory:"), { schema });
  migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
});

/** Fake transcript with exactly `n` words (content doesn't matter, only the word count does). */
function words(n: number) {
  return Array.from({ length: n }, (_, i) => ({ w: `mot${i}`, start: i, end: i + 0.4 }));
}

/** Total "llm_calls.cost_usd" actually recorded for a source, the same way src/server/costs.ts does. */
function actualCostUsd(sourceId: string): number {
  return db
    .select()
    .from(schema.llmCalls)
    .where(eq(schema.llmCalls.sourceId, sourceId))
    .all()
    .reduce((sum, c) => sum + c.costUsd, 0);
}

/** Inserts a source already analyzed: its transcript, plus the "llm_calls" rows an actual run left behind. */
function seedAnalyzedSource(args: {
  id: string;
  wordCount: number;
  durationSec: number;
  calls: { purpose: "moments" | "moments-fix"; inputTokens: number; outputTokens: number; costUsd: number }[];
}) {
  db.insert(schema.sources)
    .values({ id: args.id, title: "t", originalPath: `sources/${args.id}/original.mp4`, durationSec: args.durationSec })
    .run();
  db.insert(schema.transcripts)
    .values({ sourceId: args.id, language: "fr", json: { language: "fr", words: words(args.wordCount) } })
    .run();
  for (const [i, c] of args.calls.entries()) {
    db.insert(schema.llmCalls)
      .values({
        id: `${args.id}-call${i}`,
        sourceId: args.id,
        purpose: c.purpose,
        model: "claude-sonnet-5",
        inputTokens: c.inputTokens,
        outputTokens: c.outputTokens,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costUsd: c.costUsd,
      })
      .run();
  }
}

describe("estimateInputTokens / estimateWordCountFromDuration", () => {
  it("grows with the word count, plus a fixed overhead for the system prompt", () => {
    expect(estimateInputTokens(0)).toBeGreaterThan(0); // system prompt alone
    expect(estimateInputTokens(1000)).toBeGreaterThan(estimateInputTokens(0));
  });

  it("derives a word count from a duration using an average French speech rate", () => {
    expect(estimateWordCountFromDuration(60)).toBeGreaterThan(0);
    expect(estimateWordCountFromDuration(120)).toBeGreaterThan(estimateWordCountFromDuration(60));
  });
});

describe("estimateForSource", () => {
  it("returns null when neither a transcript nor a duration is available", () => {
    expect(estimateForSource({ wordCount: null, durationSec: null })).toBeNull();
  });

  it("falls back to the duration-based estimate when there is no transcript yet", () => {
    const fromDuration = estimateFromDurationSec(600);
    const forSource = estimateForSource({ wordCount: null, durationSec: 600 });
    expect(forSource).toEqual(fromDuration);
    expect(forSource!.basis).toBe("duration");
  });

  it("prefers the transcript's word count over the duration when both are available", () => {
    const forSource = estimateForSource({ wordCount: 3000, durationSec: 1 });
    expect(forSource!.basis).toBe("transcript");
    expect(forSource).toEqual(estimateFromWordCount(3000));
  });
});

describe("estimateFromWordCount accuracy against already-analyzed sources", () => {
  // Two videos of different lengths, each with the "moments" call every analysis makes plus a
  // "moments-fix" correction round (src/server/jobs.test.ts and worker/handlers/moments-failure.test.ts
  // build their fixtures the same way: insert rows directly with drizzle on a fresh migrated
  // in-memory db). ANALYSIS_PASSES models the correction round as a 50% expected chance rather than
  // a certainty, so an individual already-corrected source can land a bit above the point estimate —
  // these numbers are picked to stay inside the ±30% band either way.
  it("is within ±30% of the real cost recorded in llm_calls for a short video", () => {
    seedAnalyzedSource({
      id: "src-short",
      wordCount: 1200,
      durationSec: 480,
      calls: [
        { purpose: "moments", inputTokens: 2200, outputTokens: 760, costUsd: 0.018 },
        { purpose: "moments-fix", inputTokens: 2500, outputTokens: 800, costUsd: 0.0195 },
      ],
    });

    const tr = db.select().from(schema.transcripts).where(eq(schema.transcripts.sourceId, "src-short")).get()!;
    const estimate = estimateForSource({ wordCount: wordCountOfTranscript(tr.json.words), durationSec: null })!;
    const actual = actualCostUsd("src-short");

    expect(actual).toBeGreaterThan(0);
    const relativeError = Math.abs(estimate.costUsd - actual) / actual;
    expect(relativeError).toBeLessThanOrEqual(0.3);
  });

  it("is within ±30% of the real cost recorded in llm_calls for a longer video", () => {
    seedAnalyzedSource({
      id: "src-long",
      wordCount: 3000,
      durationSec: 1200,
      calls: [
        { purpose: "moments", inputTokens: 4400, outputTokens: 820, costUsd: 0.02553 },
        { purpose: "moments-fix", inputTokens: 4800, outputTokens: 900, costUsd: 0.02790 },
      ],
    });

    const tr = db.select().from(schema.transcripts).where(eq(schema.transcripts.sourceId, "src-long")).get()!;
    const estimate = estimateForSource({ wordCount: wordCountOfTranscript(tr.json.words), durationSec: null })!;
    const actual = actualCostUsd("src-long");

    expect(actual).toBeGreaterThan(0);
    const relativeError = Math.abs(estimate.costUsd - actual) / actual;
    expect(relativeError).toBeLessThanOrEqual(0.3);
  });
});

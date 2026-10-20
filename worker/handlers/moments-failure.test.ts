import path from "node:path";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import type { DB } from "@/server/db";
import * as schema from "@/server/db/schema";

// Must run before `findMoments` (and the module that reads it, src/server/llm.ts) is imported.
beforeAll(() => {
  process.env.CLAUDE_BIN = path.resolve("e2e/fake-claude.mjs");
});

describe("findMoments, CLI failure", () => {
  it("records a llm_calls row with status \"error\" and the message when the CLI exits 1", async () => {
    const { findMoments } = await import("./moments");
    const db: DB = drizzle(new Database(":memory:"), { schema });
    migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
    db.insert(schema.sources).values({ id: "src1", title: "Test", originalPath: "sources/src1/original.mp4" }).run();
    // A single word: fewer than the 2 timestamped lines e2e/fake-claude.mjs needs, so it exits 1
    // with its own JSON envelope (`{ is_error: true, result: "fake-claude: transcript too short" }`).
    db.insert(schema.transcripts)
      .values({ sourceId: "src1", language: "fr", json: { language: "fr", words: [{ w: "Salut", start: 0, end: 0.5 }] } })
      .run();

    await expect(findMoments(db, { sourceId: "src1" })).rejects.toThrow();

    const calls = db.select().from(schema.llmCalls).where(eq(schema.llmCalls.sourceId, "src1")).all();
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((c) => c.status === "error")).toBe(true);
    expect(calls.every((c) => c.error?.includes("transcript too short"))).toBe(true);
    expect(calls.every((c) => c.promptId === "moments" && c.promptVersion === "1")).toBe(true);
  });
});

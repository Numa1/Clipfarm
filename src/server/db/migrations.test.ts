import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";

const DIR = path.join(process.cwd(), "drizzle");
const TAG = "0003_f0_jobs_llm_niche_revisions";

/** Apply one migration file statement by statement, like the drizzle migrator does. */
function apply(sqlite: Database.Database, tag: string) {
  const sql = fs.readFileSync(path.join(DIR, `${tag}.sql`), "utf8");
  for (const stmt of sql.split("--> statement-breakpoint")) sqlite.exec(stmt);
}

const TABLES = ["jobs", "llm_calls", "sources", "projects", "moments", "transcripts"];
const count = (sqlite: Database.Database, table: string) =>
  (sqlite.prepare(`select count(*) as n from ${table}`).get() as { n: number }).n;

let sqlite: Database.Database;

beforeEach(() => {
  sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  for (const tag of ["0000_init", "0001_rapid_unus", "0002_llm_calls"]) apply(sqlite, tag);

  sqlite.exec(`
    insert into sources (id, title, original_path, status, created_at) values ('s1', 'A', 'a.mp4', 'ready', 1), ('s2', 'B', 'b.mp4', 'ready', 2);
    insert into projects (id, name, source_id, timeline, created_at, updated_at) values ('p1', 'P', 's1', '{}', 1, 1);
    insert into transcripts (source_id, language, json, created_at) values ('s1', 'fr', '{}', 1);
    insert into moments (id, source_id, start, end, hook, reason, score, created_at) values ('m1', 's1', 0, 10, 'h', 'r', 5, 1);
    insert into jobs (id, type, payload, status, created_at) values
      ('j1', 'ingest', '{"sourceId":"s1"}', 'done', 1),
      ('j2', 'moments', '{"sourceId":"s2"}', 'queued', 2),
      ('j3', 'render', '{"projectId":"p1","sourceId":"s1"}', 'running', 3),
      ('j4', 'transcribe', '{}', 'error', 4);
    insert into llm_calls (id, source_id, purpose, model, input_tokens, cost_usd, created_at) values
      ('l1', 's1', 'moments', 'opus', 100, 0.5, 1), ('l2', 's2', 'moments-fix', null, 0, 0, 2);
  `);
});

describe("migration 0003", () => {
  it("keeps every row and backfills jobs from their payload", () => {
    const before = TABLES.map((t) => count(sqlite, t));
    apply(sqlite, TAG);
    expect(TABLES.map((t) => count(sqlite, t))).toEqual(before);

    const jobs = sqlite.prepare("select id, source_id, project_id, lane, dedupe_key from jobs order by id").all();
    expect(jobs).toEqual([
      { id: "j1", source_id: "s1", project_id: null, lane: "heavy", dedupe_key: null },
      { id: "j2", source_id: "s2", project_id: null, lane: "light", dedupe_key: null },
      { id: "j3", source_id: "s1", project_id: "p1", lane: "heavy", dedupe_key: null },
      { id: "j4", source_id: null, project_id: null, lane: "heavy", dedupe_key: null },
    ]);
  });

  it("rebuilds llm_calls with status ok and a nullable source", () => {
    apply(sqlite, TAG);
    const rows = sqlite.prepare("select id, source_id, status, error, project_id, cost_usd from llm_calls order by id").all();
    expect(rows).toEqual([
      { id: "l1", source_id: "s1", status: "ok", error: null, project_id: null, cost_usd: 0.5 },
      { id: "l2", source_id: "s2", status: "ok", error: null, project_id: null, cost_usd: 0 },
    ]);
    sqlite.exec("insert into llm_calls (id, purpose, project_id, status, error, created_at) values ('l3', 'x', 'p1', 'error', 'boom', 3)");
    sqlite.exec("delete from projects where id = 'p1'");
    expect(sqlite.prepare("select project_id from llm_calls where id = 'l3'").get()).toEqual({ project_id: null });
  });

  it("adds the niche, revision and style columns", () => {
    apply(sqlite, TAG);
    expect(sqlite.prepare("select niche, niche_confidence, niche_signals, niche_source, lang from sources where id = 's1'").get()).toEqual({
      niche: null,
      niche_confidence: null,
      niche_signals: null,
      niche_source: null,
      lang: null,
    });
    expect(sqlite.prepare("select revision, style_id from projects where id = 'p1'").get()).toEqual({ revision: 0, style_id: null });
    sqlite.exec("insert into project_revisions (project_id, rev, actor, created_at) values ('p1', 1, 'human', 1)");
    expect(() => sqlite.exec("insert into project_revisions (project_id, rev, actor, created_at) values ('p1', 1, 'agent', 2)")).toThrow();
    sqlite.exec("delete from projects where id = 'p1'");
    expect(count(sqlite, "project_revisions")).toBe(0);
  });

  it("allows one active job per dedupe_key", () => {
    apply(sqlite, TAG);
    const insert = (id: string, status: string, key: string | null) =>
      sqlite
        .prepare("insert into jobs (id, type, payload, status, dedupe_key, created_at) values (?, 'render', '{}', ?, ?, 1)")
        .run(id, status, key);

    insert("a", "queued", "k");
    expect(() => insert("b", "running", "k")).toThrow(/UNIQUE/);
    insert("c", "queued", "other");
    insert("n1", "queued", null);
    insert("n2", "queued", null);

    sqlite.prepare("update jobs set status = 'done' where id = 'a'").run();
    insert("d", "queued", "k");
    insert("e", "done", "k");
    expect(() => insert("f", "queued", "k")).toThrow(/UNIQUE/);
  });
});

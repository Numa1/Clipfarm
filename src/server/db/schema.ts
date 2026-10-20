import { sql } from "drizzle-orm";
import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const createdAt = () =>
  integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date());

export type NicheSource = "auto" | "llm" | "manual";

export type SourceStatus = "uploaded" | "ingesting" | "transcribing" | "analyzing" | "ready" | "error";

export const sources = sqliteTable("sources", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  /** Library-relative paths. */
  originalPath: text("original_path").notNull(),
  proxyPath: text("proxy_path"),
  audioPath: text("audio_path"),
  durationSec: real("duration_sec"),
  width: integer("width"),
  height: integer("height"),
  status: text("status").$type<SourceStatus>().notNull().default("uploaded"),
  error: text("error"),
  /** Name of the person on screen (streamer, host…), used in generated titles. Optional. */
  creator: text("creator"),
  niche: text("niche"),
  nicheConfidence: real("niche_confidence"),
  nicheSignals: text("niche_signals", { mode: "json" }).$type<Record<string, unknown>>(),
  nicheSource: text("niche_source").$type<NicheSource>(),
  lang: text("lang"),
  createdAt: createdAt(),
});

/** Word-level transcript, stored as JSON: { language, words: [{ w, start, end }] }. */
export const transcripts = sqliteTable("transcripts", {
  sourceId: text("source_id")
    .primaryKey()
    .references(() => sources.id, { onDelete: "cascade" }),
  language: text("language").notNull(),
  json: text("json", { mode: "json" }).$type<Transcript>().notNull(),
  createdAt: createdAt(),
});

/** Highlight suggested by the AI (Claude via the local CLI). */
export const moments = sqliteTable("moments", {
  id: text("id").primaryKey(),
  sourceId: text("source_id")
    .notNull()
    .references(() => sources.id, { onDelete: "cascade" }),
  start: real("start").notNull(),
  end: real("end").notNull(),
  /** Title of the short (to publish). Null on moments found before titles existed. */
  title: text("title"),
  /** On-screen text over the first seconds. */
  hook: text("hook").notNull(),
  /** Optional cold open: the peak of the moment, replayed at the very start. */
  teaserStart: real("teaser_start"),
  teaserEnd: real("teaser_end"),
  reason: text("reason").notNull(),
  score: integer("score").notNull(),
  createdAt: createdAt(),
});

export type Actor = "human" | "agent" | "system";

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  sourceId: text("source_id").references(() => sources.id, { onDelete: "set null" }),
  momentId: text("moment_id"),
  /** Timeline JSON (see src/timeline/schema.ts). */
  timeline: text("timeline", { mode: "json" }).notNull(),
  lastExportPath: text("last_export_path"),
  /** Incremented on every accepted change; matches the latest project_revisions row. */
  revision: integer("revision").notNull().default(0),
  styleId: text("style_id"),
  createdAt: createdAt(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const projectRevisions = sqliteTable(
  "project_revisions",
  {
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    rev: integer("rev").notNull(),
    actor: text("actor").$type<Actor>().notNull(),
    actorId: text("actor_id"),
    ops: text("ops", { mode: "json" }).$type<unknown[]>(),
    snapshot: text("snapshot", { mode: "json" }).$type<unknown>(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.rev] })],
);

export type JobType = "ingest" | "transcribe" | "moments" | "reframe" | "render";
export type JobLane = "heavy" | "light";
export type JobStatus = "queued" | "running" | "done" | "error" | "cancelled";

export const jobs = sqliteTable(
  "jobs",
  {
    id: text("id").primaryKey(),
    type: text("type").$type<JobType>().notNull(),
    payload: text("payload", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    /** Denormalized from the payload so jobs can be filtered by index. No foreign keys: jobs outlive their rows. */
    sourceId: text("source_id"),
    projectId: text("project_id"),
    lane: text("lane").$type<JobLane>().notNull().default("heavy"),
    /** At most one queued or running job per key (partial unique index). */
    dedupeKey: text("dedupe_key"),
    status: text("status").$type<JobStatus>().notNull().default("queued"),
    progress: real("progress").notNull().default(0),
    result: text("result", { mode: "json" }).$type<Record<string, unknown>>(),
    error: text("error"),
    createdAt: createdAt(),
    startedAt: integer("started_at", { mode: "timestamp_ms" }),
    finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
  },
  (t) => [
    index("jobs_source_id_idx").on(t.sourceId),
    index("jobs_project_id_idx").on(t.projectId),
    uniqueIndex("jobs_dedupe_key_active_idx")
      .on(t.dedupeKey)
      .where(sql`${t.dedupeKey} is not null and ${t.status} in ('queued', 'running')`),
  ],
);

/** One Claude CLI call, with the usage and API-equivalent cost reported in its JSON envelope. */
export type LlmStatus = "ok" | "error";

export const llmCalls = sqliteTable("llm_calls", {
  id: text("id").primaryKey(),
  sourceId: text("source_id").references(() => sources.id, { onDelete: "cascade" }),
  projectId: text("project_id").references(() => projects.id, { onDelete: "set null" }),
  /** No foreign key: moments are recreated on every analysis. */
  momentId: text("moment_id"),
  promptId: text("prompt_id"),
  promptVersion: text("prompt_version"),
  status: text("status").$type<LlmStatus>().notNull().default("ok"),
  error: text("error"),
  /** "moments" (first answer) or "moments-fix" (correction round). */
  purpose: text("purpose").notNull(),
  model: text("model"),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
  cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
  /** What the call would cost at API prices (the CLI may run on a subscription). */
  costUsd: real("cost_usd").notNull().default(0),
  durationMs: integer("duration_ms"),
  createdAt: createdAt(),
});

export type Word = {
  w: string;
  start: number;
  end: number;
  /** Who speaks, from the spoken language of the audio (worker/voices.ts): true = a voice of the content
   *  (game cutscene, watched clip), false = the creator; absent = not determined. */
  vo?: boolean;
};
export type Transcript = { language: string; words: Word[] };

export type Source = typeof sources.$inferSelect;
export type Moment = typeof moments.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type Job = typeof jobs.$inferSelect;
export type ProjectRevision = typeof projectRevisions.$inferSelect;
export type LlmCall = typeof llmCalls.$inferSelect;

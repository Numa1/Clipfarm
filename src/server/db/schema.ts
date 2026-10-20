import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

const createdAt = () =>
  integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date());

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
  hook: text("hook").notNull(),
  reason: text("reason").notNull(),
  score: integer("score").notNull(),
  createdAt: createdAt(),
});

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  sourceId: text("source_id").references(() => sources.id, { onDelete: "set null" }),
  momentId: text("moment_id"),
  /** Timeline JSON (see src/timeline/schema.ts). */
  timeline: text("timeline", { mode: "json" }).notNull(),
  lastExportPath: text("last_export_path"),
  createdAt: createdAt(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export type JobType = "ingest" | "transcribe" | "moments" | "reframe" | "render";
export type JobStatus = "queued" | "running" | "done" | "error";

export const jobs = sqliteTable("jobs", {
  id: text("id").primaryKey(),
  type: text("type").$type<JobType>().notNull(),
  payload: text("payload", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  status: text("status").$type<JobStatus>().notNull().default("queued"),
  progress: real("progress").notNull().default(0),
  result: text("result", { mode: "json" }).$type<Record<string, unknown>>(),
  error: text("error"),
  createdAt: createdAt(),
  startedAt: integer("started_at", { mode: "timestamp_ms" }),
  finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
});

export type Word = { w: string; start: number; end: number };
export type Transcript = { language: string; words: Word[] };

export type Source = typeof sources.$inferSelect;
export type Moment = typeof moments.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type Job = typeof jobs.$inferSelect;

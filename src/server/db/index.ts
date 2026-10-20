import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { DB_PATH, LIBRARY_DIR } from "../paths";
import * as schema from "./schema";

export type DB = BetterSQLite3Database<typeof schema>;

// Shared across Next.js hot reloads and used by the worker process too (WAL handles both).
const globalForDb = globalThis as unknown as { clipfarmDb?: DB };

function open(): DB {
  fs.mkdirSync(LIBRARY_DIR, { recursive: true });
  const sqlite = new Database(DB_PATH);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("busy_timeout = 5000");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: path.join(/*turbopackIgnore: true*/ process.cwd(), "drizzle") });
  return db;
}

export function getDb(): DB {
  return (globalForDb.clipfarmDb ??= open());
}

export { schema };

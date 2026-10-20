import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/server/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.CLIPFARM_LIBRARY ? `${process.env.CLIPFARM_LIBRARY}/clipfarm.db` : "./library/clipfarm.db" },
});

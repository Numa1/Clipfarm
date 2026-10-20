import { sql } from "drizzle-orm";
import type { SourceCost } from "@/lib/cost";

export { shareOf, type SourceCost } from "@/lib/cost";

const sum = (expr: string, sourceId: string) =>
  sql<number>`(select coalesce(sum(${sql.raw(expr)}), 0) from "llm_calls" where "llm_calls"."source_id" = ${sql.raw(sourceId)})`;

/**
 * Select fields summing "llm_calls" for a source id column, written qualified by hand
 * (drizzle renders unqualified column names inside raw subqueries), e.g. `"sources"."id"`.
 */
export const costSelect = (sourceId: string) => ({
  costCalls: sql<number>`(select count(*) from "llm_calls" where "llm_calls"."source_id" = ${sql.raw(sourceId)})`,
  costTokens: sum(`"input_tokens" + "output_tokens" + "cache_read_tokens" + "cache_write_tokens"`, sourceId),
  costOutputTokens: sum(`"output_tokens"`, sourceId),
  costUsd: sum(`"cost_usd"`, sourceId),
});

type CostRow = { [K in keyof ReturnType<typeof costSelect>]: number };

export function toCost(row: CostRow): SourceCost {
  return { calls: row.costCalls, tokens: row.costTokens, outputTokens: row.costOutputTokens, costUsd: row.costUsd };
}

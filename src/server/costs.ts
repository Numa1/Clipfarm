import { eq, sql } from "drizzle-orm";
import { shareByWeight, type SourceCost } from "@/lib/cost";
import type { DB } from "./db";
import { moments, transcripts } from "./db/schema";

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

/**
 * Splits a source's analysis cost across its moments by how many transcript words fall in each one,
 * rather than splitting it equally: a moment's weight is the number of words whose midpoint lands in
 * its [start, end) range. Falls back to an equal split (via `shareByWeight`) when the source has no
 * transcript, or no word midpoint lands in any moment.
 */
export function momentCostSharesByWords(db: DB, sourceId: string, cost: SourceCost): { momentId: string; cost: SourceCost }[] {
  const sourceMoments = db.select().from(moments).where(eq(moments.sourceId, sourceId)).all();
  if (sourceMoments.length === 0) return [];

  const words = db.select().from(transcripts).where(eq(transcripts.sourceId, sourceId)).get()?.json.words ?? [];

  const weights = sourceMoments.map((moment) => {
    let count = 0;
    for (const word of words) {
      const mid = (word.start + word.end) / 2;
      if (mid >= moment.start && mid < moment.end) count++;
    }
    return count;
  });

  const shares = shareByWeight(cost, weights);
  return sourceMoments.map((moment, i) => ({ momentId: moment.id, cost: shares[i] }));
}

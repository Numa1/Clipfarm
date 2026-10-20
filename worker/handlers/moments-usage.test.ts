import { describe, expect, it } from "vitest";
import { envelopeUsage } from "./moments";

describe("envelopeUsage", () => {
  it("reads tokens, cost and model from the CLI's JSON envelope", () => {
    const envelope = {
      type: "result",
      is_error: false,
      duration_ms: 41250,
      total_cost_usd: 0.6213,
      usage: { input_tokens: 12, output_tokens: 2310, cache_read_input_tokens: 18000, cache_creation_input_tokens: 31000 },
      modelUsage: { "claude-opus-5-5": { inputTokens: 12, outputTokens: 2310, costUSD: 0.6213 } },
      structured_output: { moments: [] },
    };
    expect(envelopeUsage(envelope)).toEqual({
      model: "claude-opus-5-5",
      inputTokens: 12,
      outputTokens: 2310,
      cacheReadTokens: 18000,
      cacheWriteTokens: 31000,
      costUsd: 0.6213,
      durationMs: 41250,
    });
  });

  it("falls back to zeros when the CLI reports no usage", () => {
    expect(envelopeUsage({ result: "ok" })).toMatchObject({ model: null, inputTokens: 0, costUsd: 0, durationMs: null });
    expect(envelopeUsage(null)).toMatchObject({ outputTokens: 0, costUsd: 0 });
  });
});

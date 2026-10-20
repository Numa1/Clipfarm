import { describe, expect, it } from "vitest";
import { shareByWeight, type SourceCost } from "./cost";

describe("shareByWeight", () => {
  const total: SourceCost = { calls: 7, tokens: 10_000, outputTokens: 3_333, costUsd: 0.12345 };

  it("splits unequal weights into unequal shares that sum back to the total", () => {
    // Two moments: one much longer (more words) than the other.
    const [short, long] = shareByWeight(total, [10, 90]);

    expect(short.costUsd).not.toBeCloseTo(long.costUsd);
    expect(long.costUsd).toBeGreaterThan(short.costUsd);

    const sum = (key: keyof SourceCost) => short[key] + long[key];
    expect(sum("calls")).toBe(total.calls);
    expect(sum("tokens")).toBe(total.tokens);
    expect(sum("outputTokens")).toBe(total.outputTokens);
    expect(sum("costUsd")).toBeCloseTo(total.costUsd, 10);
  });

  it("falls back to an equal split when every weight is zero", () => {
    const [a, b] = shareByWeight(total, [0, 0]);
    expect(a.tokens).toBeCloseTo(total.tokens / 2, 0);
    expect(a.costUsd).toBeCloseTo(total.costUsd / 2, 10);
    expect(b.costUsd).toBeCloseTo(total.costUsd / 2, 10);
    expect(a.calls + b.calls).toBe(total.calls);
    expect(a.costUsd + b.costUsd).toBeCloseTo(total.costUsd, 10);
  });

  it("sums exactly back to the total across many unequal weights", () => {
    const weights = [1, 4, 2, 17, 0, 9, 3];
    const shares = shareByWeight(total, weights);
    const sum = (key: keyof SourceCost) => shares.reduce((acc, s) => acc + s[key], 0);
    expect(sum("calls")).toBe(total.calls);
    expect(sum("tokens")).toBe(total.tokens);
    expect(sum("outputTokens")).toBe(total.outputTokens);
    expect(sum("costUsd")).toBeCloseTo(total.costUsd, 10);
  });

  it("returns an empty array for no moments", () => {
    expect(shareByWeight(total, [])).toEqual([]);
  });
});

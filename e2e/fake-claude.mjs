#!/usr/bin/env node
// Stand-in for the Claude CLI in the end-to-end test: deterministic, offline, no subscription used.
// Reads the moments prompt on stdin and answers like `claude -p --output-format json --json-schema`.
let input = "";
process.stdin.on("data", (d) => (input += d));
process.stdin.on("end", () => {
  const lines = [...input.matchAll(/^\[(\d+(?:\.\d+)?)\] (?:\[VO\] )?(.+)$/gm)].map((m) => ({ t: Number(m[1]), text: m[2] }));
  if (lines.length < 2) {
    process.stdout.write(JSON.stringify({ type: "result", is_error: true, result: "fake-claude: transcript too short" }));
    process.exit(1);
  }
  const start = lines[0].t;
  const end = Math.min(lines[lines.length - 1].t + 4, start + 45);
  const moment = {
    start,
    end,
    title: "Il teste toute la chaîne de montage d'un coup",
    hook: "Test de bout en bout",
    teaser: { start: lines[1].t, end: lines[1].t + 2 },
    proof: lines[0].text.split(" ").slice(0, 6).join(" "),
    reason: "Moment factice du test de bout en bout.",
    score: 90,
  };
  process.stdout.write(
    JSON.stringify({
      type: "result",
      is_error: false,
      duration_ms: 1200,
      total_cost_usd: 0.0123,
      usage: { input_tokens: 10, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 1500 },
      modelUsage: { "fake-claude": { inputTokens: 10, outputTokens: 200, costUSD: 0.0123 } },
      structured_output: { moments: [moment] },
    }),
  );
});

#!/usr/bin/env node
// Stand-in for the Claude CLI in the end-to-end test: deterministic, offline, no subscription used.
// Reads the moments, niche or hooks prompt on stdin and answers like `claude -p --output-format json
// --json-schema`. The three prompts share this one CLI stand-in (src/server/llm.ts has a single
// CLAUDE_BIN): told apart by a marker unique to each prompt's system prompt, passed on argv
// (--system-prompt).
const isNichePrompt = process.argv.some((a) => a.includes("Niches possibles"));
const isHooksPrompt = process.argv.some((a) => a.includes("candidats d'accroche"));

let input = "";
process.stdin.on("data", (d) => (input += d));
process.stdin.on("end", () => {
  if (isNichePrompt) {
    // Deterministic, plausible-looking answer: the e2e video (a test pattern + narration, no
    // facecam/green screen) is ambiguous for the local scorer, so this is what "Claude" decides.
    process.stdout.write(
      JSON.stringify({
        type: "result",
        is_error: false,
        duration_ms: 400,
        total_cost_usd: 0.0021,
        usage: { input_tokens: 8, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
        modelUsage: { "fake-claude": { inputTokens: 8, outputTokens: 20, costUSD: 0.0021 } },
        structured_output: { niche: "podcast", confidence: 0.75, reason: "Narration continue, pas de facecam ni de terrain détecté." },
      }),
    );
    return;
  }
  if (isHooksPrompt) {
    // Deterministic 4 variants + a chosen index, well within the 3-5 and 0-based-index rules the
    // prompt (src/prompts/hooks.ts) and its response schema (worker/handlers/hooks.ts) require.
    process.stdout.write(
      JSON.stringify({
        type: "result",
        is_error: false,
        duration_ms: 350,
        total_cost_usd: 0.0017,
        usage: { input_tokens: 12, output_tokens: 60, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
        modelUsage: { "fake-claude": { inputTokens: 12, outputTokens: 60, costUSD: 0.0017 } },
        structured_output: {
          variants: [
            { text: "Il n'a pas vu venir ce qui allait suivre 😳", score: 88 },
            { text: "Personne ne s'attendait à ça", score: 74 },
            { text: "Le moment où tout bascule", score: 69 },
            { text: "Ça, c'est du jamais vu", score: 60 },
          ],
          chosen: 0,
          reason: "Candidat factice du test de bout en bout.",
        },
      }),
    );
    return;
  }
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

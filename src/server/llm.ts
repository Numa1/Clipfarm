import { nanoid } from "nanoid";
import { z } from "zod";
import { estimateCostUsd } from "@/config/pricing";
import type { DB } from "@/server/db";
import { llmCalls, type LlmCall } from "@/server/db/schema";
import { run } from "../../worker/exec";

const CLAUDE_BIN = process.env.CLAUDE_BIN ?? "claude";

/**
 * When the worker is started from inside a Claude Code session (e.g. a desktop-app terminal),
 * it inherits that session's CLAUDE_* / ANTHROPIC_* variables — CLAUDE_CODE_SIMPLE disables
 * OAuth/keychain auth and the CLI reports "Not logged in". Run the CLI with a clean env so it
 * uses the user's own subscription login.
 */
function cliEnv(): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(process.env).filter(([k]) => !/^(CLAUDE|ANTHROPIC_)/.test(k)),
  ) as NodeJS.ProcessEnv;
}

/** The usage part of the CLI's JSON envelope (`claude -p --output-format json`). */
const envelopeUsageSchema = z.object({
  total_cost_usd: z.number().optional(),
  duration_ms: z.number().optional(),
  usage: z
    .object({
      input_tokens: z.number().optional(),
      output_tokens: z.number().optional(),
      cache_read_input_tokens: z.number().optional(),
      cache_creation_input_tokens: z.number().optional(),
    })
    .optional(),
  modelUsage: z.record(z.string(), z.unknown()).optional(),
});

export type ClaudeUsage = Pick<
  LlmCall,
  "model" | "inputTokens" | "outputTokens" | "cacheReadTokens" | "cacheWriteTokens" | "costUsd" | "durationMs"
>;

/** Tokens and API-equivalent cost of one call; zeros when the CLI didn't report them. */
export function envelopeUsage(envelope: unknown): ClaudeUsage {
  const e = envelopeUsageSchema.safeParse(envelope);
  const d = e.success ? e.data : {};
  const model = Object.keys(d.modelUsage ?? {}).join(", ") || null;
  const inputTokens = d.usage?.input_tokens ?? 0;
  const outputTokens = d.usage?.output_tokens ?? 0;
  const cacheReadTokens = d.usage?.cache_read_input_tokens ?? 0;
  const cacheWriteTokens = d.usage?.cache_creation_input_tokens ?? 0;
  return {
    model,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    // The CLI reports its own cost when it has one; otherwise estimate it from pricing.ts so a
    // call never goes unaccounted for.
    costUsd: d.total_cost_usd ?? estimateCostUsd(model, { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens }),
    durationMs: d.duration_ms ?? null,
  };
}

const ZERO_USAGE: ClaudeUsage = {
  model: null,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  costUsd: 0,
  durationMs: null,
};

export type ClaudeEnvelope = { structured_output?: unknown; result?: string; is_error?: boolean };

export type CallClaudeArgs = {
  db: DB;
  /** System prompt text. */
  system: string;
  /** User prompt (sent on stdin). */
  prompt: string;
  /** JSON schema the CLI should constrain its structured output to. */
  jsonSchema: string;
  /** Identifies the prompt that produced this call, for attribution (src/prompts/*). */
  promptId: string;
  promptVersion: string;
  /** Free-form label for what this call is for (e.g. "moments", "moments-fix"). */
  purpose: string;
  sourceId?: string | null;
  projectId?: string | null;
  momentId?: string | null;
  signal?: AbortSignal;
};

/**
 * Runs one Claude CLI call (same CLI protocol as before) and ALWAYS records a "llm_calls" row —
 * on success (status "ok") as well as on failure (status "error", with the error message) — so
 * every attempt is attributed and costed, even the ones that never produced a usable answer.
 */
export async function callClaude(args: CallClaudeArgs): Promise<ClaudeEnvelope> {
  const base = {
    id: nanoid(10),
    sourceId: args.sourceId ?? null,
    projectId: args.projectId ?? null,
    momentId: args.momentId ?? null,
    promptId: args.promptId,
    promptVersion: args.promptVersion,
    purpose: args.purpose,
  };
  let usage: ClaudeUsage = ZERO_USAGE;
  try {
    const out = await run(
      CLAUDE_BIN,
      ["-p", "--output-format", "json", "--tools", "", "--no-session-persistence",
        "--system-prompt", args.system, "--json-schema", args.jsonSchema],
      { env: cliEnv(), input: args.prompt, signal: args.signal },
    ).catch((e: Error) => {
      // The CLI exits 1 with its JSON envelope on stdout: surface its message (e.g. usage limit reached).
      const m = /"result":("(?:[^"\\]|\\.)*")/.exec(e.message);
      throw m ? new Error(`Claude : ${JSON.parse(m[1])}`) : e;
    });
    const envelope = JSON.parse(out) as ClaudeEnvelope;
    // Tokens are spent even when the answer turns out unusable: record before checking is_error.
    usage = envelopeUsage(envelope);
    if (envelope.is_error) throw new Error(`claude: ${envelope.result}`);
    args.db.insert(llmCalls).values({ ...base, status: "ok", ...usage }).run();
    return envelope;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    args.db.insert(llmCalls).values({ ...base, status: "error", error: message, ...usage }).run();
    throw e;
  }
}

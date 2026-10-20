import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import type { DB } from "@/server/db";
import { moments, sources, transcripts, type Word } from "@/server/db/schema";
import { run } from "../exec";

const CLAUDE_BIN = process.env.CLAUDE_BIN ?? "claude";

const momentsSchema = z.object({
  moments: z
    .array(
      z.object({
        start: z.number(),
        end: z.number(),
        hook: z.string(),
        reason: z.string(),
        score: z.number().int().min(0).max(100),
      }),
    )
    .max(15),
});

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

const JSON_SCHEMA = JSON.stringify(z.toJSONSchema(momentsSchema));

const SYSTEM = `Tu es un monteur expert en contenus courts (TikTok, YouTube Shorts) en français.
On te donne la transcription horodatée d'une vidéo longue (podcast, interview, stream).
Trouve les 5 à 10 meilleurs passages autonomes de 30 à 60 secondes pour un short viral :
- une accroche forte dans les 3 premières secondes (affirmation choc, question, révélation) ;
- une idée complète, compréhensible sans contexte, avec une chute ;
- commence et termine sur des limites de phrase.
Pour chaque passage : start/end en secondes (pris dans les horodatages), "hook" = texte d'accroche
à afficher à l'écran (max 8 mots, percutant), "reason" = pourquoi ça marche (1 phrase), "score" 0-100.
Réponds uniquement avec l'objet JSON { "moments": [...] }, sans texte autour.`;

/** Group words into lines "[123.4] text" (~every sentence or 12 s) to keep the prompt compact. */
export function formatTranscript(words: Word[]): string {
  const lines: string[] = [];
  let buf: string[] = [];
  let lineStart = 0;
  for (const w of words) {
    if (buf.length === 0) lineStart = w.start;
    buf.push(w.w);
    if (/[.!?…]$/.test(w.w) || w.end - lineStart > 12) {
      lines.push(`[${lineStart.toFixed(1)}] ${buf.join(" ")}`);
      buf = [];
    }
  }
  if (buf.length) lines.push(`[${lineStart.toFixed(1)}] ${buf.join(" ")}`);
  return lines.join("\n");
}

/** Pull the moments JSON out of a free-text answer (```json fences or the outermost {...}). */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const candidate = fenced?.[1] ?? text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  return JSON.parse(candidate);
}

async function askClaude(prompt: string): Promise<z.infer<typeof momentsSchema>> {
  const out = await run(
    CLAUDE_BIN,
    ["-p", "--output-format", "json", "--tools", "", "--no-session-persistence",
      "--system-prompt", SYSTEM, "--json-schema", JSON_SCHEMA],
    { env: cliEnv(), input: prompt },
  );
  const envelope = JSON.parse(out) as { structured_output?: unknown; result?: string; is_error?: boolean };
  if (envelope.is_error) throw new Error(`claude: ${envelope.result}`);
  // On long inputs the model sometimes answers in prose instead of the structured output.
  return momentsSchema.parse(envelope.structured_output ?? extractJson(envelope.result ?? ""));
}

/** Highlight detection through the local Claude Code CLI (uses the user's Claude subscription). */
export async function findMoments(db: DB, payload: { sourceId: string }) {
  const source = db.select().from(sources).where(eq(sources.id, payload.sourceId)).get();
  const tr = db.select().from(transcripts).where(eq(transcripts.sourceId, payload.sourceId)).get();
  if (!source || !tr) throw new Error("transcript missing");
  const duration = source.durationSec ?? Infinity;

  const prompt = `Transcription (secondes entre crochets) :\n\n${formatTranscript(tr.json.words)}`;
  const data = await askClaude(prompt).catch(() => askClaude(prompt)); // one retry

  const rows = data.moments
    .map((m) => ({ ...m, start: Math.max(0, m.start), end: Math.min(duration, m.end) }))
    .filter((m) => m.end - m.start >= 10)
    .map((m) => ({ id: nanoid(10), sourceId: source.id, ...m }));

  db.transaction((tx) => {
    tx.delete(moments).where(eq(moments.sourceId, source.id)).run();
    if (rows.length) tx.insert(moments).values(rows).run();
    tx.update(sources).set({ status: "ready" }).where(eq(sources.id, source.id)).run();
  });
  return { count: rows.length };
}

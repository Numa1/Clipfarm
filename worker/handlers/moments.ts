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
        title: z.string(),
        hook: z.string(),
        teaser: z.object({ start: z.number(), end: z.number() }).nullable().optional(),
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

const SYSTEM = `Tu es un monteur expert en contenus courts (TikTok, YouTube Shorts, Reels) en français.
On te donne le titre d'une vidéo longue (podcast, interview, stream gaming…), le nom du créateur s'il est connu,
et sa transcription horodatée. Les lignes marquées [VO] sont dans une autre langue que celle du créateur :
ce sont les voix du contenu (personnages d'un jeu, cinématique, vidéo regardée), PAS le créateur.

Trouve les 5 à 10 meilleurs moments pour des shorts :
- centrés sur le créateur : ce qu'il dit, ses réactions, ses coups de gueule, son humour, ses histoires.
  Écarte les passages où il regarde passivement (cinématique, menu, chargement) : des lignes [VO] ne servent
  au plus que de courte mise en contexte (quelques secondes) juste avant sa réaction. Ne cite jamais une ligne [VO]
  comme si c'était le créateur ;
- autonomes : compréhensibles sans contexte, une idée complète avec une chute ;
- denses : 20 à 45 secondes, le plus court possible tant que l'histoire tient, sans temps mort ;
- "start" sur la première phrase qui accroche (affirmation choc, question, conflit, révélation), jamais sur de la
  mise en place (« bon », « alors », « allez les gars »…) ; "end" juste après la chute ; des limites de phrase.

Pour chaque moment :
- "title" : titre du short, à la 3e personne, qui parle du créateur et de ce qui lui arrive. Utilise son nom
  uniquement s'il est fourni (n'invente pas de nom, et un nom de personnage du jeu n'est pas le sien) ; sinon
  « il », « ce streamer », « ce joueur »… 40 à 70 caractères, crée un manque (on veut savoir la suite), pas de
  guillemets, au plus un emoji. Exemple : « Élu MVP… et transféré le soir même 😳 » ;
- "hook" : texte affiché à l'écran pendant les 3 premières secondes, 7 mots max, qui donne envie de rester
  (une promesse ou une question, pas le titre recopié, pas une réplique [VO]) ;
- "teaser" : le pic du moment (punchline, cri, réaction), 1,5 à 4 s pris dans [start, end], rejoué en ouverture
  avant le début du moment — seulement si ça rend l'ouverture plus forte, sinon null ;
- "reason" : pourquoi ça marche (1 phrase) ; "score" : 0-100.
Toutes les valeurs de temps sont en secondes, prises dans les horodatages.
Réponds uniquement avec l'objet JSON { "moments": [...] }, sans texte autour.`;

const EN_WORDS = new Set(
  ("the you i my we and to of is it that this what why how did was wasn't your with for get got just gotta don't " +
    "i'm it's you're can will be are have not but so when if in out up he she they them our bro yeah").split(" "),
);
const FR_WORDS = new Set(
  ("le la les de des du un une et est je tu il elle on nous vous ils ce ça c'est que qui pas ne en au avec pour " +
    "mais mon ma mes me te se y j'ai va oui non là bon").split(" "),
);

/** A line in English inside a French video: voices of the content (game cutscene, clip), not the creator. */
export function isForeignLine(text: string): boolean {
  let en = 0;
  let fr = 0;
  for (const raw of text.toLowerCase().replace(/’/g, "'").split(/\s+/)) {
    const w = raw.replace(/^[^\p{L}']+|[^\p{L}']+$/gu, "");
    if (EN_WORDS.has(w)) en++;
    if (FR_WORDS.has(w)) fr++;
  }
  return en > 0 && en >= 2 * fr + 1;
}

/** Group words into lines "[123.4] text" (~every sentence or 12 s) to keep the prompt compact. */
export function formatTranscript(words: Word[]): string {
  const lines: string[] = [];
  let buf: string[] = [];
  let lineStart = 0;
  const flush = () => {
    const text = buf.join(" ");
    lines.push(`[${lineStart.toFixed(1)}] ${isForeignLine(text) ? "[VO] " : ""}${text}`);
    buf = [];
  };
  for (const w of words) {
    if (buf.length === 0) lineStart = w.start;
    buf.push(w.w);
    if (/[.!?…]$/.test(w.w) || w.end - lineStart > 12) flush();
  }
  if (buf.length) flush();
  return lines.join("\n");
}

/** Pull the moments JSON out of a free-text answer (```json fences or the outermost {...}). */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const candidate = fenced?.[1] ?? text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  return JSON.parse(candidate);
}

async function askClaude(prompt: string, signal?: AbortSignal): Promise<z.infer<typeof momentsSchema>> {
  const out = await run(
    CLAUDE_BIN,
    ["-p", "--output-format", "json", "--tools", "", "--no-session-persistence",
      "--system-prompt", SYSTEM, "--json-schema", JSON_SCHEMA],
    { env: cliEnv(), input: prompt, signal },
  ).catch((e: Error) => {
    // The CLI exits 1 with its JSON envelope on stdout: surface its message (e.g. usage limit reached).
    const m = /"result":("(?:[^"\\]|\\.)*")/.exec(e.message);
    throw m ? new Error(`Claude : ${JSON.parse(m[1])}`) : e;
  });
  const envelope = JSON.parse(out) as { structured_output?: unknown; result?: string; is_error?: boolean };
  if (envelope.is_error) throw new Error(`claude: ${envelope.result}`);
  // On long inputs the model sometimes answers in prose instead of the structured output.
  return momentsSchema.parse(envelope.structured_output ?? extractJson(envelope.result ?? ""));
}

/** Highlight detection through the local Claude Code CLI (uses the user's Claude subscription). */
export async function findMoments(db: DB, payload: { sourceId: string }, signal?: AbortSignal) {
  const source = db.select().from(sources).where(eq(sources.id, payload.sourceId)).get();
  const tr = db.select().from(transcripts).where(eq(transcripts.sourceId, payload.sourceId)).get();
  if (!source || !tr) throw new Error("transcript missing");
  const duration = source.durationSec ?? Infinity;

  const prompt = [
    `Titre de la vidéo : ${source.title}`,
    `Créateur : ${source.creator?.trim() || "inconnu (parle de lui à la 3e personne, sans nom)"}`,
    "",
    "Transcription (secondes entre crochets) :",
    "",
    formatTranscript(tr.json.words),
  ].join("\n");
  const data = await askClaude(prompt, signal).catch((e: unknown) => {
    if (signal?.aborted) throw e;
    return askClaude(prompt, signal); // one retry
  });
  signal?.throwIfAborted();

  const rows = data.moments
    .map(({ teaser, ...m }) => {
      const start = Math.max(0, m.start);
      const end = Math.min(duration, m.end);
      // A teaser must replay a short peak from inside the moment; anything else is dropped.
      const ok = teaser && teaser.start >= start && teaser.end <= end && teaser.end - teaser.start >= 1 && teaser.end - teaser.start <= 5;
      return { ...m, start, end, teaserStart: ok ? teaser.start : null, teaserEnd: ok ? teaser.end : null };
    })
    .filter((m) => m.end - m.start >= 10)
    .map((m) => ({ id: nanoid(10), sourceId: source.id, ...m }));

  db.transaction((tx) => {
    tx.delete(moments).where(eq(moments.sourceId, source.id)).run();
    if (rows.length) tx.insert(moments).values(rows).run();
    tx.update(sources).set({ status: "ready" }).where(eq(sources.id, source.id)).run();
  });
  return { count: rows.length };
}

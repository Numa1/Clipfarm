/**
 * End-to-end test of the whole pipeline on a generated video: ingest → transcribe (whisper) →
 * niche (local signals + fake Claude in repli) → moments (fake Claude) → project (dead-air cuts +
 * teaser) → reframe (OpenCV) → render (Remotion).
 * Runs in a throwaway library; needs the local toolchain (ffmpeg, whisper model, uv + models).
 * Usage: pnpm test:e2e   (KEEP=1 keeps the temporary library for inspection)
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const library = fs.mkdtempSync(path.join(os.tmpdir(), "clipfarm-e2e-"));
// Before any import of the app: paths and the DB are resolved at module load.
process.env.CLIPFARM_LIBRARY = library;
process.env.CLAUDE_BIN = path.resolve("e2e/fake-claude.mjs");

// French speech with long pauses, so the dead-air cuts have something to remove.
const SCRIPT = [
  "Bonjour à tous, aujourd'hui on teste toute la chaîne de montage de Clipfarm.",
  "[[slnc 2000]] Cette phrase arrive après un long silence qui doit disparaître du short.",
  "On vérifie la transcription, la recherche des moments et le recadrage vertical.",
  "[[slnc 2000]] Et pour finir, le rendu en neuf seizièmes doit sortir sans erreur.",
].join(" ");

const noop = () => {};

function check(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(`✖ ${message}`);
  console.log(`  ✔ ${message}`);
}

async function step<T>(name: string, fn: () => Promise<T> | T): Promise<T> {
  const t0 = Date.now();
  console.log(`▶ ${name}`);
  const out = await fn();
  console.log(`  ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  return out;
}

function probe(file: string) {
  const out = execFileSync("ffprobe", ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", file]).toString();
  return JSON.parse(out) as { streams: { codec_type: string; width?: number; height?: number }[]; format: { duration: string } };
}

async function main() {
  const { eq } = await import("drizzle-orm");
  const { isNicheId } = await import("@/config/niches");
  const { getDb } = await import("@/server/db");
  const { llmCalls, moments, projects, sources } = await import("@/server/db/schema");
  const { createProject } = await import("@/server/projects");
  const { resolveInLibrary, sourceDir } = await import("@/server/paths");
  const { parseTimeline } = await import("@/timeline/schema");
  const { ingest } = await import("../worker/handlers/ingest");
  const { transcribe } = await import("../worker/handlers/transcribe");
  const { assignNiche } = await import("../worker/handlers/niche");
  const { findMoments } = await import("../worker/handlers/moments");
  const { reframe } = await import("../worker/handlers/reframe");
  const { render } = await import("../worker/handlers/render");
  const db = getDb();
  const sourceId = "e2esource";

  await step("Vidéo de test (say + ffmpeg)", () => {
    const dir = sourceDir(sourceId);
    fs.mkdirSync(dir, { recursive: true });
    const speech = path.join(library, "speech.aiff");
    execFileSync("say", ["-v", "Eddy (Français (France))", "-o", speech, SCRIPT]);
    execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=30", "-i", speech,
      "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", path.join(dir, "original.mp4")]);
    db.insert(sources).values({ id: sourceId, title: "Test de bout en bout", originalPath: `sources/${sourceId}/original.mp4` }).run();
  });

  await step("Ingest", () => ingest(db, { sourceId }, noop));
  const src = db.select().from(sources).where(eq(sources.id, sourceId)).get()!;
  check(src.proxyPath && src.audioPath && src.durationSec && src.durationSec > 15, "proxy, audio et durée enregistrés");

  const { words, contentWords } = await step("Transcription (whisper)", () => transcribe(db, { sourceId }, noop));
  check(words > 20, `${words} mots transcrits`);
  check(contentWords === 0, "aucune ligne attribuée au contenu : tout est la voix du créateur");

  await step("Niche (signaux locaux + faux Claude en repli)", () => assignNiche(db, { sourceId }));
  const afterNiche = db.select().from(sources).where(eq(sources.id, sourceId)).get()!;
  check(isNicheId(afterNiche.niche ?? ""), `niche assignée : ${afterNiche.niche}`);
  check(afterNiche.nicheSource === "auto" || afterNiche.nicheSource === "llm", `nicheSource = ${afterNiche.nicheSource}`);
  check(typeof afterNiche.nicheConfidence === "number" && afterNiche.nicheConfidence! >= 0 && afterNiche.nicheConfidence! <= 1, "confiance de niche entre 0 et 1");

  await step("Moments (faux Claude)", () => findMoments(db, { sourceId }));
  const [moment] = db.select().from(moments).where(eq(moments.sourceId, sourceId)).all();
  check(moment?.title && moment.teaserStart != null, "un moment avec titre et teaser");
  const momentsCalls = db.select().from(llmCalls).where(eq(llmCalls.sourceId, sourceId)).all().filter((c) => c.purpose === "moments");
  check(momentsCalls.length === 1 && momentsCalls[0].costUsd > 0 && momentsCalls[0].outputTokens > 0, "tokens et coût de l'appel moments enregistrés");

  const created = await step("Projet", () => createProject(db, { momentId: moment.id }));
  if ("error" in created) throw new Error(created.error);
  const projectId = created.project.id;
  let timeline = parseTimeline(created.project.timeline);
  const clips = () => timeline.tracks[0].items.filter((i) => i.type === "video");
  check(clips()[0].sourceIn === moment.teaserStart, "le teaser ouvre le short");
  check(clips().length >= 3, `${clips().length} clips : teaser + silences coupés`);
  const length = clips().reduce((n, c) => n + c.sourceOut - c.sourceIn, 0);
  const teaserLength = moment.teaserEnd! - moment.teaserStart!;
  check(length - teaserLength < moment.end - moment.start - 2, `durée montée ${length.toFixed(1)} s, temps morts retirés`);

  await step("Recadrage (OpenCV)", () => reframe(db, { projectId }, noop));
  timeline = parseTimeline(db.select().from(projects).where(eq(projects.id, projectId)).get()!.timeline);
  check(clips().every((c) => c.crop.mode === "auto" && c.crop.shots?.length), "chaque clip a ses plans");

  const { output } = await step("Rendu (Remotion)", () => render(db, { projectId }, noop));
  const file = resolveInLibrary(output)!;
  const info = probe(file);
  const video = info.streams.find((s) => s.codec_type === "video");
  check(video?.width === 1080 && video.height === 1920, "MP4 en 1080×1920");
  check(info.streams.some((s) => s.codec_type === "audio"), "piste audio présente");
  const duration = Number(info.format.duration);
  check(Math.abs(duration - length) < 0.25, `durée ${duration.toFixed(2)} s ≈ timeline ${length.toFixed(2)} s`);
  execFileSync("ffmpeg", ["-v", "error", "-xerror", "-i", file, "-f", "null", "-"]);
  check(true, "le MP4 se décode sans erreur");
}

main()
  .then(() => console.log("\n✔ Chaîne complète OK"))
  .catch((e: unknown) => {
    console.error(`\n${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
  })
  .finally(() => {
    if (process.env.KEEP) console.log(`Bibliothèque conservée : ${library}`);
    else fs.rmSync(library, { recursive: true, force: true });
  });

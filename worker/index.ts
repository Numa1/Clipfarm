import { eq } from "drizzle-orm";
import { getDb } from "@/server/db";
import { sources, type Job } from "@/server/db/schema";
import { claimNextJob, failJob, finishJob, isJobCancelled, requeueStaleJobs, setJobProgress } from "@/server/jobs";
import { ingest } from "./handlers/ingest";
import { findMoments } from "./handlers/moments";
import { reframe, reframeSetupProblem } from "./handlers/reframe";
import { render } from "./handlers/render";
import { transcribe } from "./handlers/transcribe";

const POLL_MS = 1000;
/** How often a running job checks whether it was cancelled from the UI. */
const CANCEL_POLL_MS = 1000;
const db = getDb();

/**
 * Hard limit per job type, in minutes, so a hung process (ffmpeg, whisper, claude, uv…) cannot
 * block the queue forever. Sized for multi-hour sources; override with CLIPFARM_TIMEOUT_<TYPE>.
 */
const TIMEOUT_MIN: Record<Job["type"], number> = {
  ingest: 60,
  transcribe: 90,
  moments: 15,
  reframe: 30,
  render: 30,
};

function timeoutMs(type: Job["type"]): number {
  const override = Number(process.env[`CLIPFARM_TIMEOUT_${type.toUpperCase()}`]);
  return (override > 0 ? override : TIMEOUT_MIN[type]) * 60_000;
}

/** Rejects with the signal's reason once aborted: the queue moves on even if a handler ignores it. */
function untilAborted(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (signal.aborted) reject(signal.reason);
    else signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
}

type Handler = (
  payload: never,
  progress: (p: number) => void,
  signal: AbortSignal,
) => Promise<Record<string, unknown>>;

const handlers: Record<Job["type"], Handler> = {
  ingest: (p: { sourceId: string }, prog, signal) => ingest(db, p, prog, signal),
  transcribe: (p: { sourceId: string }, prog, signal) => transcribe(db, p, prog, signal),
  moments: (p: { sourceId: string }, _prog, signal) => findMoments(db, p, signal),
  reframe: (p: { projectId: string; itemIds?: string[] }, prog, signal) => reframe(db, p, prog, signal),
  render: (p: { projectId: string }, prog, signal) => render(db, p, prog, signal),
};

async function runJob(job: Job) {
  const started = Date.now();
  console.log(`▶ ${job.type} ${job.id}`, job.payload);
  let last = 0;
  const progress = (p: number) => {
    // Throttle DB writes.
    if (Date.now() - last > 500) {
      last = Date.now();
      setJobProgress(db, job.id, p);
    }
  };

  const limit = timeoutMs(job.type);
  const cancel = new AbortController();
  const signal = AbortSignal.any([cancel.signal, AbortSignal.timeout(limit)]);
  const watch = setInterval(() => {
    try {
      if (isJobCancelled(db, job.id)) cancel.abort(new Error("cancelled"));
    } catch {
      // Transient DB contention: check again on the next tick.
    }
  }, CANCEL_POLL_MS);

  try {
    const result = await Promise.race([handlers[job.type](job.payload as never, progress, signal), untilAborted(signal)]);
    if (finishJob(db, job.id, result)) {
      console.log(`✔ ${job.type} ${job.id} in ${((Date.now() - started) / 1000).toFixed(1)}s`, result);
    } else console.log(`■ ${job.type} ${job.id} cancelled after it finished`);
  } catch (e) {
    if (cancel.signal.aborted) {
      // Already marked cancelled (and its source updated) by the API.
      console.log(`■ ${job.type} ${job.id} cancelled`);
      return;
    }
    const message = signal.aborted
      ? `Délai dépassé : le job ${job.type} a été arrêté après ${limit / 60_000} min.`
      : e instanceof Error
        ? e.message
        : String(e);
    if (failJob(db, job.id, message)) {
      const sourceId = (job.payload as { sourceId?: string }).sourceId;
      if (sourceId) db.update(sources).set({ status: "error", error: message }).where(eq(sources.id, sourceId)).run();
    }
    console.error(`✖ ${job.type} ${job.id}: ${message}`);
  } finally {
    clearInterval(watch);
  }
}

async function loop() {
  requeueStaleJobs(db);
  const reframeProblem = reframeSetupProblem();
  if (reframeProblem) console.warn(`⚠ Cadrage auto indisponible — ${reframeProblem}`);
  console.log("Clipfarm worker ready — waiting for jobs…");
  for (;;) {
    let job: Job | null = null;
    try {
      job = claimNextJob(db);
    } catch (e) {
      // Transient DB contention must never kill the worker; retry on next tick.
      console.warn("claim failed, retrying:", e instanceof Error ? e.message : e);
    }
    if (job) await runJob(job);
    else await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

loop();

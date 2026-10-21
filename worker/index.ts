import { getDb } from "@/server/db";
import type { Job, JobLane } from "@/server/db/schema";
import { jobTimeoutMin } from "@/server/job-registry";
import {
  claimNextJob,
  failJob,
  finishJob,
  isJobCancelled,
  markSourceFailed,
  requeueStaleJobs,
  setJobProgress,
} from "@/server/jobs";
import { nextJobsAfter } from "@/server/pipeline";
import { ingest } from "./handlers/ingest";
import { findMoments } from "./handlers/moments";
import { assignNiche } from "./handlers/niche";
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
 * The base value per type lives in the job registry; this only applies the env override.
 */
function timeoutMs(type: Job["type"]): number {
  const override = Number(process.env[`CLIPFARM_TIMEOUT_${type.toUpperCase()}`]);
  return (override > 0 ? override : jobTimeoutMin(type)) * 60_000;
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
  niche: (p: { sourceId: string }, _prog, signal) => assignNiche(db, p, signal),
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
      nextJobsAfter(db, job.type, job.payload as Record<string, unknown>, result);
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
    if (failJob(db, job.id, message)) markSourceFailed(db, job, message);
    console.error(`✖ ${job.type} ${job.id}: ${message}`);
  } finally {
    clearInterval(watch);
  }
}

/** One polling loop per lane, so a long "heavy" job (ingest, transcribe, reframe, render) never
 *  starves the cheap "light" ones (moments): each loop only claims jobs of its own lane. */
async function loop(lane: JobLane) {
  for (;;) {
    let job: Job | null = null;
    try {
      job = claimNextJob(db, lane);
    } catch (e) {
      // Transient DB contention must never kill the worker; retry on next tick.
      console.warn(`[${lane}] claim failed, retrying:`, e instanceof Error ? e.message : e);
    }
    if (job) await runJob(job);
    else await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

async function main() {
  requeueStaleJobs(db);
  const reframeProblem = reframeSetupProblem();
  if (reframeProblem) console.warn(`⚠ Cadrage auto indisponible — ${reframeProblem}`);
  console.log("Clipfarm worker ready — waiting for jobs…");
  // Both lanes run in parallel in this same process: "light" jobs keep moving while a "heavy" one runs.
  await Promise.all([loop("heavy"), loop("light")]);
}

main();

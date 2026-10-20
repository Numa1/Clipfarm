import { eq } from "drizzle-orm";
import { getDb } from "@/server/db";
import { sources, type Job } from "@/server/db/schema";
import { claimNextJob, failJob, finishJob, requeueStaleJobs, setJobProgress } from "@/server/jobs";
import { ingest } from "./handlers/ingest";
import { findMoments } from "./handlers/moments";
import { reframe } from "./handlers/reframe";
import { render } from "./handlers/render";
import { transcribe } from "./handlers/transcribe";

const POLL_MS = 1000;
const db = getDb();

type Handler = (payload: never, progress: (p: number) => void) => Promise<Record<string, unknown>>;

const handlers: Record<Job["type"], Handler> = {
  ingest: (p: { sourceId: string }, prog) => ingest(db, p, prog),
  transcribe: (p: { sourceId: string }, prog) => transcribe(db, p, prog),
  moments: (p: { sourceId: string }) => findMoments(db, p),
  reframe: (p: { projectId: string }, prog) => reframe(db, p, prog),
  render: (p: { projectId: string }, prog) => render(db, p, prog),
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
  try {
    const result = await handlers[job.type](job.payload as never, progress);
    finishJob(db, job.id, result);
    console.log(`✔ ${job.type} ${job.id} in ${((Date.now() - started) / 1000).toFixed(1)}s`, result);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    failJob(db, job.id, message);
    const sourceId = (job.payload as { sourceId?: string }).sourceId;
    if (sourceId) db.update(sources).set({ status: "error", error: message }).where(eq(sources.id, sourceId)).run();
    console.error(`✖ ${job.type} ${job.id}: ${message}`);
  }
}

async function loop() {
  requeueStaleJobs(db);
  console.log("Clipfarm worker ready — waiting for jobs…");
  for (;;) {
    const job = claimNextJob(db);
    if (job) await runJob(job);
    else await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

loop();

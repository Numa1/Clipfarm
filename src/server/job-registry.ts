import { z } from "zod";
import type { JobLane, JobType } from "./db/schema";

const sourceIdSchema = z.object({ sourceId: z.string().min(1) });
const projectIdSchema = z.object({ projectId: z.string().min(1) });
const reframeSchema = z.object({ projectId: z.string().min(1), itemIds: z.array(z.string()).optional() });

interface JobDefinition {
  readonly lane: JobLane;
  /** Hard limit for the job, in minutes (see worker/index.ts for the per-job override). */
  readonly timeoutMin: number;
  /** Parses and normalizes a raw payload; throws (ZodError) when it does not match the job type. */
  validate(payload: unknown): Record<string, unknown>;
  /** Key such that at most one queued or running job of this type shares it (see jobs.dedupeKey). */
  dedupeKey(payload: Record<string, unknown>): string;
}

function job<P extends Record<string, unknown>>(def: {
  lane: JobLane;
  timeoutMin: number;
  schema: z.ZodType<P>;
  dedupeKey: (payload: P) => string;
}): JobDefinition {
  return {
    lane: def.lane,
    timeoutMin: def.timeoutMin,
    validate: (payload) => def.schema.parse(payload),
    dedupeKey: (payload) => def.dedupeKey(def.schema.parse(payload)),
  };
}

/**
 * One entry per job type: its payload shape, which polling lane claims it ("light" for the fast,
 * cheap steps; "heavy" for everything that can run long), its hard timeout, and how to derive the
 * key that keeps at most one active job of that kind on the same source or project.
 */
export const JOB_REGISTRY: Record<JobType, JobDefinition> = {
  ingest: job({
    lane: "heavy",
    timeoutMin: 60,
    schema: sourceIdSchema,
    dedupeKey: (p) => `ingest:source:${p.sourceId}`,
  }),
  transcribe: job({
    lane: "heavy",
    timeoutMin: 90,
    schema: sourceIdSchema,
    dedupeKey: (p) => `transcribe:source:${p.sourceId}`,
  }),
  moments: job({
    lane: "light",
    timeoutMin: 15,
    schema: sourceIdSchema,
    dedupeKey: (p) => `moments:source:${p.sourceId}`,
  }),
  reframe: job({
    lane: "heavy",
    timeoutMin: 30,
    schema: reframeSchema,
    dedupeKey: (p) => `reframe:project:${p.projectId}`,
  }),
  render: job({
    lane: "heavy",
    timeoutMin: 30,
    schema: projectIdSchema,
    dedupeKey: (p) => `render:project:${p.projectId}`,
  }),
};

export function jobLane(type: JobType): JobLane {
  return JOB_REGISTRY[type].lane;
}

export function jobTimeoutMin(type: JobType): number {
  return JOB_REGISTRY[type].timeoutMin;
}

/** Throws a ZodError when the payload does not match what this job type expects. */
export function validateJobPayload(type: JobType, payload: unknown): Record<string, unknown> {
  return JOB_REGISTRY[type].validate(payload);
}

export function jobDedupeKey(type: JobType, payload: Record<string, unknown>): string {
  return JOB_REGISTRY[type].dedupeKey(payload);
}

import type { z } from "zod";
import { localRequestProblem } from "./local-guard";

/** Every error response has this shape; `error` stays a plain string for existing consumers. */
export type ApiError = { error: string; code: string; issues?: z.core.$ZodIssue[] };

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly issues?: z.core.$ZodIssue[],
  ) {
    super(message);
    this.name = "HttpError";
  }
}

const STATUS_CODES: Record<number, string> = {
  400: "bad_request",
  403: "forbidden",
  404: "not_found",
  409: "conflict",
  415: "unsupported_media_type",
  422: "validation",
};

/** For domain helpers that report `{ error, status }`: derive the machine-readable code from the status. */
export function httpError(status: number, message: string): HttpError {
  return new HttpError(status, STATUS_CODES[status] ?? "error", message);
}

export function errorResponse(err: HttpError): Response {
  const body: ApiError = { error: err.message, code: err.code, ...(err.issues && { issues: err.issues }) };
  return Response.json(body, { status: err.status });
}

const IDEMPOTENCY_TTL_MS = 10 * 60_000;
const IDEMPOTENCY_MAX_ENTRIES = 500;

export type StoredResponse = { status: number; body: string; contentType: string | null };

/** Behind an interface so a database-backed store can replace the in-memory one later. */
export interface IdempotencyStore {
  get(key: string): StoredResponse | undefined;
  set(key: string, value: StoredResponse): void;
}

/**
 * In-memory store on globalThis (shared across route modules and dev reloads). Limits: entries
 * vanish on restart and are not shared between processes, so a replay after a restart executes again.
 */
export function createMemoryIdempotencyStore(ttlMs = IDEMPOTENCY_TTL_MS, maxEntries = IDEMPOTENCY_MAX_ENTRIES): IdempotencyStore {
  const entries = new Map<string, StoredResponse & { expiresAt: number }>();
  const prune = () => {
    const now = Date.now();
    for (const [k, v] of entries) if (v.expiresAt <= now) entries.delete(k);
  };
  return {
    get(key) {
      const hit = entries.get(key);
      if (!hit) return undefined;
      if (hit.expiresAt <= Date.now()) {
        entries.delete(key);
        return undefined;
      }
      return hit;
    },
    set(key, value) {
      prune();
      entries.delete(key);
      entries.set(key, { ...value, expiresAt: Date.now() + ttlMs });
      // Map keeps insertion order: drop the oldest first.
      while (entries.size > maxEntries) entries.delete(entries.keys().next().value as string);
    },
  };
}

const globalStore = globalThis as unknown as { __clipfarmIdempotency?: IdempotencyStore };
function idempotencyStore(): IdempotencyStore {
  return (globalStore.__clipfarmIdempotency ??= createMemoryIdempotencyStore());
}

// Dynamic segments of a path literal: "[id]" is a string, "[...path]" a string[].
type ParamsOf<P extends string> = P extends `${string}[${infer K}]${infer Rest}`
  ? (K extends `...${infer Name}` ? { [Q in Name]: string[] } : { [Q in K]: string }) & ParamsOf<Rest>
  : unknown;

export type RouteConfig<S extends z.ZodType | undefined, P extends string | undefined> = {
  /** Route path, only to type `params` (e.g. "/api/jobs/[id]"). */
  path?: P;
  /** Zod schema of the JSON body. Without it the body is left untouched (streamed uploads). */
  body?: S;
  /** Status when the body fails validation. */
  validationStatus?: 400 | 422;
  /** Refuse requests that do not come from this machine's own pages. */
  local?: boolean;
  /** Replay the recorded response for a repeated Idempotency-Key (POST only). */
  idempotent?: boolean;
};

export type RouteArgs<S extends z.ZodType | undefined, P extends string | undefined> = {
  request: Request;
  body: S extends z.ZodType ? z.output<S> : undefined;
  params: P extends string ? ParamsOf<P> : Record<string, never>;
};

/** Wraps a route handler: local guard, safe body validation, one error format, idempotency. */
export function route<S extends z.ZodType | undefined = undefined, P extends string | undefined = undefined>(
  config: RouteConfig<S, P>,
  handler: (args: RouteArgs<S, P>) => Response | Promise<Response>,
) {
  return async (request: Request, ctx?: { params: Promise<unknown> }): Promise<Response> => {
    try {
      if (config.local) {
        const problem = localRequestProblem(request.method, request.headers);
        if (problem) throw new HttpError(403, "forbidden", problem);
      }

      const key = config.idempotent && request.method === "POST" ? request.headers.get("idempotency-key")?.trim() : null;
      const storeKey = key ? `${key}|${request.method}|${new URL(request.url).pathname}` : null;
      if (storeKey) {
        const hit = idempotencyStore().get(storeKey);
        if (hit) {
          const headers = new Headers({ "Idempotent-Replay": "true" });
          if (hit.contentType) headers.set("Content-Type", hit.contentType);
          return new Response(hit.body, { status: hit.status, headers });
        }
      }

      let body: unknown;
      if (config.body) {
        const text = await request.text();
        if (text.trim()) {
          try {
            body = JSON.parse(text);
          } catch {
            throw new HttpError(400, "invalid_json", "invalid JSON body");
          }
        }
        const parsed = config.body.safeParse(body);
        if (!parsed.success) {
          const first = parsed.error.issues[0];
          const where = first?.path.length ? `${first.path.join(".")}: ` : "";
          throw new HttpError(config.validationStatus ?? 422, "validation", `invalid request: ${where}${first?.message ?? "invalid input"}`, parsed.error.issues);
        }
        body = parsed.data;
      }

      const params = ctx ? await ctx.params : {};
      const res = await handler({ request, body, params } as RouteArgs<S, P>);

      if (storeKey && res.status < 500) {
        const text = await res.clone().text();
        idempotencyStore().set(storeKey, { status: res.status, body: text, contentType: res.headers.get("content-type") });
      }
      return res;
    } catch (err) {
      if (err instanceof HttpError) return errorResponse(err);
      console.error(`${request.method} ${new URL(request.url).pathname} failed:`, err);
      return errorResponse(new HttpError(500, "internal", "internal error"));
    }
  };
}

import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createMemoryIdempotencyStore, HttpError, httpError, route } from "./api";

const post = (body: string | undefined, headers: Record<string, string> = {}) =>
  new Request("http://localhost:3100/api/thing", { method: "POST", body, headers: { host: "localhost:3100", ...headers } });

afterEach(() => {
  vi.restoreAllMocks();
  delete (globalThis as { __clipfarmIdempotency?: unknown }).__clipfarmIdempotency;
});

describe("route body validation", () => {
  const handler = route({ body: z.object({ n: z.number() }) }, ({ body }) => Response.json({ double: body.n * 2 }));

  it("passes the parsed body to the handler", async () => {
    const res = await handler(post(JSON.stringify({ n: 2 })));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ double: 4 });
  });

  it("answers 400 on malformed JSON", async () => {
    const res = await handler(post("{nope"));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "invalid_json", error: expect.any(String) });
  });

  it("answers 422 with the zod issues on a schema mismatch", async () => {
    const res = await handler(post(JSON.stringify({ n: "x" })));
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json).toMatchObject({ code: "validation", error: expect.stringContaining("n:") });
    expect(json.issues[0].path).toEqual(["n"]);
  });

  it("treats an empty body as undefined and honours validationStatus", async () => {
    const lenient = route({ body: z.object({ a: z.string().optional() }).default({}), validationStatus: 400 }, ({ body }) => Response.json(body));
    expect(await (await lenient(post(undefined))).json()).toEqual({});
    expect((await lenient(post(JSON.stringify({ a: 1 })))).status).toBe(400);
  });
});

describe("route errors", () => {
  it("formats HttpError and derives codes from statuses", async () => {
    const res = await route({}, () => {
      throw httpError(409, "busy");
    })(post(undefined));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "busy", code: "conflict" });
    const custom = await route({}, () => {
      throw new HttpError(418, "teapot", "short and stout");
    })(post(undefined));
    expect(await custom.json()).toEqual({ error: "short and stout", code: "teapot" });
  });

  it("hides unexpected errors behind a generic 500 and logs them", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await route({}, () => {
      throw new Error("secret detail");
    })(post(undefined));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "internal error", code: "internal" });
    expect(log).toHaveBeenCalled();
  });

  it("refuses foreign hosts with 403 before touching the body", async () => {
    const handler = vi.fn(() => new Response("ok"));
    const res = await route({ local: true }, handler)(post(undefined, { host: "evil.example" }));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "forbidden" });
    expect(handler).not.toHaveBeenCalled();
  });
});

describe("route params and streaming", () => {
  it("awaits typed params", async () => {
    const handler = route({ path: "/api/x/[id]/[...rest]" }, ({ params }) => Response.json({ id: params.id, rest: params.rest }));
    const res = await handler(post(undefined), { params: Promise.resolve({ id: "a", rest: ["b", "c"] }) });
    expect(await res.json()).toEqual({ id: "a", rest: ["b", "c"] });
  });

  it("leaves the request body unread without a body schema", async () => {
    const handler = route({}, ({ request }) => Response.json({ used: request.bodyUsed }));
    const res = await handler(post("raw bytes"));
    expect(await res.json()).toEqual({ used: false });
  });
});

describe("idempotency", () => {
  it("replays the recorded response for the same key, method and path", async () => {
    let calls = 0;
    const handler = route({ idempotent: true }, () => Response.json({ n: ++calls }, { status: 201 }));
    const first = await handler(post(undefined, { "idempotency-key": "k1" }));
    const second = await handler(post(undefined, { "idempotency-key": "k1" }));
    expect(first.headers.get("idempotent-replay")).toBeNull();
    expect(second.headers.get("idempotent-replay")).toBe("true");
    expect(second.status).toBe(201);
    expect(await second.json()).toEqual({ n: 1 });
    const other = await handler(post(undefined, { "idempotency-key": "k2" }));
    expect(await other.json()).toEqual({ n: 2 });
    expect(calls).toBe(2);
  });

  it("ignores the header when the route does not opt in, and never records 5xx", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    let calls = 0;
    const plain = route({}, () => Response.json({ n: ++calls }));
    await plain(post(undefined, { "idempotency-key": "k" }));
    await plain(post(undefined, { "idempotency-key": "k" }));
    expect(calls).toBe(2);
    const failing = route({ idempotent: true }, () => {
      calls++;
      throw new Error("boom");
    });
    await failing(post(undefined, { "idempotency-key": "f" }));
    await failing(post(undefined, { "idempotency-key": "f" }));
    expect(calls).toBe(4);
  });
});

describe("memory idempotency store", () => {
  const value = { status: 200, body: "{}", contentType: null };

  it("expires entries after the TTL", () => {
    vi.useFakeTimers();
    try {
      const store = createMemoryIdempotencyStore(1000, 10);
      store.set("a", value);
      expect(store.get("a")).toBeDefined();
      vi.advanceTimersByTime(1001);
      expect(store.get("a")).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps at most maxEntries, dropping the oldest", () => {
    const store = createMemoryIdempotencyStore(60_000, 3);
    for (const k of ["a", "b", "c", "d"]) store.set(k, value);
    expect(store.get("a")).toBeUndefined();
    expect(store.get("d")).toBeDefined();
  });
});

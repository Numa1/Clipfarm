import { describe, expect, it } from "vitest";
import { localRequestProblem } from "./local-guard";
import { resolveMedia } from "./media";

const h = (init: Record<string, string>) => new Headers(init);

describe("localRequestProblem", () => {
  it("accepts the app's own pages and local tools", () => {
    expect(localRequestProblem("GET", h({ host: "localhost:3100" }))).toBeNull();
    expect(localRequestProblem("GET", h({ host: "127.0.0.1:3100" }))).toBeNull();
    expect(localRequestProblem("GET", h({ host: "[::1]:3100" }))).toBeNull();
    expect(localRequestProblem("POST", h({ host: "localhost:3100", origin: "http://localhost:3100", "sec-fetch-site": "same-origin" }))).toBeNull();
    expect(localRequestProblem("PUT", h({ host: "127.0.0.1:3100" }))).toBeNull(); // curl, worker: no Origin
  });

  it("refuses DNS rebinding (foreign Host)", () => {
    expect(localRequestProblem("GET", h({ host: "evil.example:3100" }))).toMatch(/host/);
    expect(localRequestProblem("GET", h({ host: "192.168.1.148:3100" }))).toMatch(/host/);
    expect(localRequestProblem("GET", h({}))).toMatch(/host/);
  });

  it("refuses cross-site mutations (CSRF)", () => {
    expect(localRequestProblem("POST", h({ host: "localhost:3100", origin: "https://evil.example" }))).toMatch(/origin/);
    expect(localRequestProblem("DELETE", h({ host: "localhost:3100", "sec-fetch-site": "cross-site" }))).toMatch(/cross-site/);
    expect(localRequestProblem("POST", h({ host: "localhost:3100", origin: "null" }))).toMatch(/opaque/);
  });
});

describe("resolveMedia", () => {
  it("serves only video/audio inside media folders", () => {
    expect(resolveMedia("sources/abc/proxy.mp4")).toMatch(/proxy\.mp4$/);
    expect(resolveMedia("exports/p-2026.mp4")).not.toBeNull();
    expect(resolveMedia("sfx/pop.mp3")).not.toBeNull();
    expect(resolveMedia("clipfarm.db")).toBeNull();
    expect(resolveMedia("clipfarm.db-wal")).toBeNull();
    expect(resolveMedia("sources/abc/transcript.json")).toBeNull();
    expect(resolveMedia("sources/../clipfarm.db")).toBeNull();
    expect(resolveMedia("../package.json")).toBeNull();
    expect(resolveMedia("other/movie.mp4")).toBeNull();
  });
});

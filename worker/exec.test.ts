import { describe, expect, it } from "vitest";
import { run } from "./exec";

describe("run", () => {
  it("returns stdout", async () => {
    await expect(run("echo", ["hello"])).resolves.toBe("hello\n");
  });

  it("kills the process when the signal aborts and rejects with its reason", async () => {
    const controller = new AbortController();
    const started = Date.now();
    const pending = run("sleep", ["30"], { signal: controller.signal });
    setTimeout(() => controller.abort(new Error("stop")), 50);
    await expect(pending).rejects.toThrow("stop");
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("escalates to SIGKILL when the process ignores SIGTERM", async () => {
    const pending = run("sh", ["-c", "trap '' TERM; sleep 30"], { signal: AbortSignal.timeout(50) });
    await expect(pending).rejects.toThrow();
  }, 10_000);

  it("does not spawn when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort(new Error("too late"));
    await expect(run("does-not-exist", [], { signal: controller.signal })).rejects.toThrow("too late");
  });
});

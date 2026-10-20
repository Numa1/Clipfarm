import { spawn } from "node:child_process";

/** Grace period between SIGTERM and SIGKILL when a command is aborted. */
const KILL_GRACE_MS = 3000;

/**
 * Run a command, collect stdout, reject with stderr tail on non-zero exit.
 * Aborting `signal` (job cancelled or timed out) terminates the process and rejects with the
 * signal's reason; an already-aborted signal rejects without spawning anything.
 */
export function run(
  cmd: string,
  args: string[],
  opts: {
    input?: string;
    onStderr?: (line: string) => void;
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    signal?: AbortSignal;
  } = {},
): Promise<string> {
  const { signal } = opts;
  if (signal?.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: opts.cwd, env: opts.env ?? process.env, stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    // Partial last line of stderr, completed by the next chunk (lines can straddle chunks).
    let pending = "";
    let killTimer: NodeJS.Timeout | undefined;
    const onAbort = () => {
      child.kill("SIGTERM");
      killTimer = setTimeout(() => child.kill("SIGKILL"), KILL_GRACE_MS);
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d: Buffer) => {
      const s = d.toString();
      err = (err + s).slice(-8000);
      if (!opts.onStderr) return;
      const parts = (pending + s).split(/\r|\n/);
      pending = parts.pop() ?? "";
      for (const line of parts) if (line) opts.onStderr(line);
    });
    // stdin may already be closed when the process is killed mid-write.
    child.stdin.on("error", () => {});
    child.on("error", (e) => reject(new Error(`${cmd}: ${e.message}`)));
    // When aborted, settle as soon as the process exits: a grandchild that survived (e.g. a shell's
    // subprocess) can keep the pipes open, and "close" would never fire.
    child.on("exit", () => {
      if (!signal?.aborted) return;
      clearTimeout(killTimer);
      child.stdout.destroy();
      child.stderr.destroy();
      reject(signal.reason);
    });
    child.on("close", (code) => {
      clearTimeout(killTimer);
      if (pending && opts.onStderr) opts.onStderr(pending);
      signal?.removeEventListener("abort", onAbort);
      if (signal?.aborted) reject(signal.reason);
      else if (code === 0) resolve(out);
      else reject(new Error(`${cmd} exited with ${code}\n${(err || out).slice(-2000)}`));
    });
    if (opts.input !== undefined) child.stdin.end(opts.input);
    else child.stdin.end();
  });
}

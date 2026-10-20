import { spawn } from "node:child_process";

/** Run a command, collect stdout, reject with stderr tail on non-zero exit. */
export function run(
  cmd: string,
  args: string[],
  opts: { input?: string; onStderr?: (line: string) => void; cwd?: string } = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: opts.cwd, stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d: Buffer) => {
      const s = d.toString();
      err = (err + s).slice(-8000);
      if (opts.onStderr) for (const line of s.split(/\r|\n/)) if (line) opts.onStderr(line);
    });
    child.on("error", (e) => reject(new Error(`${cmd}: ${e.message}`)));
    child.on("close", (code) =>
      code === 0 ? resolve(out) : reject(new Error(`${cmd} exited with ${code}\n${(err || out).slice(-2000)}`)),
    );
    if (opts.input !== undefined) child.stdin.end(opts.input);
    else child.stdin.end();
  });
}

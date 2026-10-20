import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { bundle } from "@remotion/bundler";
import { makeCancelSignal, renderMedia, selectComposition } from "@remotion/renderer";
import { eq } from "drizzle-orm";
import type { DB } from "@/server/db";
import { projects } from "@/server/db/schema";
import { EXPORTS_DIR, rel } from "@/server/paths";
import { COMPOSITION_ID } from "@/remotion/Root";
import type { ShortProps } from "@/remotion/ShortComposition";
import { parseTimeline } from "@/timeline/schema";
import { startLibraryServer } from "../file-server";

let bundlePromise: Promise<string> | null = null;
const logLevel = (process.env.REMOTION_LOG_LEVEL ?? "info") as "verbose" | "info" | "warn" | "error";

/** Webpack bundle of the Remotion composition, built once per worker run. */
function getBundle(): Promise<string> {
  return (bundlePromise ??= bundle({
    entryPoint: path.join(process.cwd(), "src/remotion/index.ts"),
    webpackOverride: (config) => ({
      ...config,
      resolve: {
        ...config.resolve,
        alias: { ...(config.resolve?.alias ?? {}), "@": path.join(process.cwd(), "src") },
      },
    }),
  }));
}

/**
 * Remotion's internal server defaults to port 3000+, which collides with other local dev servers
 * (Chrome then loads the wrong app on localhost). Ask the OS for a free port instead.
 */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, () => {
      const { port } = srv.address() as net.AddressInfo;
      srv.close(() => resolve(port));
    });
  });
}

export async function render(
  db: DB,
  payload: { projectId: string },
  progress: (p: number) => void,
  signal?: AbortSignal,
) {
  const project = db.select().from(projects).where(eq(projects.id, payload.projectId)).get();
  if (!project) throw new Error("project not found");
  const timeline = parseTimeline(project.timeline);

  const serveUrl = await getBundle();
  signal?.throwIfAborted();
  const server = await startLibraryServer();
  // Remotion has its own cancellation primitive: stops Chrome and ffmpeg when the job is aborted.
  const { cancelSignal, cancel } = makeCancelSignal();
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    const inputProps: ShortProps = { timeline, media: { baseUrl: server.baseUrl, quality: "full" } };
    const port = await freePort();
    const composition = await selectComposition({ serveUrl, id: COMPOSITION_ID, inputProps, logLevel, port });
    fs.mkdirSync(EXPORTS_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const output = path.join(EXPORTS_DIR, `${project.id}-${stamp}.mp4`);

    await renderMedia({
      serveUrl,
      composition,
      inputProps,
      logLevel,
      port,
      codec: "h264",
      outputLocation: output,
      // Short-form platforms like a high bitrate source; ~12 Mbps at 1080×1920.
      videoBitrate: "12M",
      audioBitrate: "192k",
      cancelSignal,
      onProgress: ({ progress: p }) => progress(p),
    }).catch((e: unknown) => {
      fs.rmSync(output, { force: true }); // No half-written MP4 left in exports/.
      throw e;
    });
    signal?.throwIfAborted();

    db.update(projects).set({ lastExportPath: rel(output) }).where(eq(projects.id, project.id)).run();
    return { output: rel(output) };
  } finally {
    signal?.removeEventListener("abort", cancel);
    server.close();
  }
}

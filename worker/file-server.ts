import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { resolveInLibrary } from "@/server/paths";
import { contentTypeFor, parseRange } from "@/server/media";

/** Loopback-only static server over the library, so Remotion can stream full-quality sources. */
export function startLibraryServer(): Promise<{ baseUrl: string; close: () => void }> {
  const server = http.createServer((req, res) => {
    const relPath = decodeURIComponent((req.url ?? "/").split("?")[0].slice(1));
    const file = resolveInLibrary(relPath);
    if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404).end();
      return;
    }
    const size = fs.statSync(file).size;
    const range = parseRange(req.headers.range ?? null, size);
    const headers: http.OutgoingHttpHeaders = {
      "Content-Type": contentTypeFor(file),
      "Accept-Ranges": "bytes",
      "Access-Control-Allow-Origin": "*",
    };
    if (range) {
      res.writeHead(206, {
        ...headers,
        "Content-Range": `bytes ${range.start}-${range.end}/${size}`,
        "Content-Length": range.end - range.start + 1,
      });
      fs.createReadStream(file, range).pipe(res);
    } else {
      res.writeHead(200, { ...headers, "Content-Length": size });
      fs.createReadStream(file).pipe(res);
    }
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({ baseUrl: `http://127.0.0.1:${port}`, close: () => server.close() });
    });
  });
}

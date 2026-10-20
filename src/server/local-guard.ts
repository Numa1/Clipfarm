const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

function hostnameOf(hostHeader: string): string {
  // "[::1]:3100" → "[::1]", "localhost:3100" → "localhost"
  return hostHeader.startsWith("[") ? hostHeader.slice(0, hostHeader.indexOf("]") + 1) : hostHeader.split(":")[0];
}

/**
 * Clipfarm is a local, single-user app without accounts. Refuse requests that do not come from
 * this machine's own pages:
 * - a Host other than localhost: DNS rebinding (an attacker's domain resolving to 127.0.0.1);
 * - a cross-site Origin on a mutating request: CSRF from any website open in the browser.
 * Returns why the request is refused, or null.
 */
export function localRequestProblem(method: string, headers: Headers): string | null {
  const host = headers.get("host");
  if (!host || !LOCAL_HOSTS.has(hostnameOf(host).toLowerCase())) return `host not allowed: ${host ?? "none"}`;
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return null;
  if (headers.get("sec-fetch-site") === "cross-site") return "cross-site request";
  const origin = headers.get("origin");
  if (origin && origin !== "null") {
    let originHost: string;
    try {
      originHost = new URL(origin).host;
    } catch {
      return "bad origin";
    }
    if (!LOCAL_HOSTS.has(hostnameOf(originHost).toLowerCase())) return `origin not allowed: ${origin}`;
  } else if (origin === "null") return "opaque origin";
  return null;
}

/** For route handlers the proxy does not cover (streamed uploads). */
export function refuseNonLocal(request: Request): Response | null {
  const problem = localRequestProblem(request.method, request.headers);
  return problem ? Response.json({ error: problem }, { status: 403 }) : null;
}

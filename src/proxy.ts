import { type NextRequest, NextResponse } from "next/server";
import { localRequestProblem } from "@/server/local-guard";

export function proxy(request: NextRequest) {
  const problem = localRequestProblem(request.method, request.headers);
  if (problem) return NextResponse.json({ error: problem }, { status: 403 });
  return NextResponse.next();
}

export const config = {
  // Streamed uploads are excluded: a proxy makes Next buffer request bodies (10 MB cap), which
  // would truncate videos. Those two routes call refuseNonLocal() themselves.
  matcher: ["/((?!api/sources$|api/sfx$|_next/static|_next/image|favicon.ico).*)"],
};

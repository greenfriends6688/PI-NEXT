import { NextResponse } from "next/server";
import { scanImports } from "@/lib/import";
import { isImportKind } from "@/lib/import/types";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

// POST /api/import/scan body: { kind: "sessions" | "models" | "skills" | "mcp", cwd? }
//
// Read-only scan of the other agents' local stores. The route deliberately
// accepts no path from the client: the scanner decides what to read from the
// server home. `cwd` is accepted for forward compatibility with project-scoped
// sources and is not used to select read locations in this PR.
export async function POST(request: Request) {
  if (!isApiRequestAllowed(request)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (!hasJsonContentType(request)) {
    return NextResponse.json(
      { error: "Content-Type must be application/json" },
      { status: 415 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const record = typeof body === "object" && body !== null ? body as Record<string, unknown> : {};
  if (!isImportKind(record.kind)) {
    return NextResponse.json(
      { error: "kind must be one of sessions, models, skills, mcp" },
      { status: 400 },
    );
  }
  const cwd = typeof record.cwd === "string" ? record.cwd : undefined;

  try {
    return NextResponse.json(await scanImports(record.kind, { cwd }));
  } catch {
    // Scanners are built to return diagnostics instead of throwing; this is
    // the last-resort guard so a bug can never leak a stack or a secret.
    return NextResponse.json({ error: "Scan failed" }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { applyImports, IMPORT_APPLY_MAX_IDS } from "@/lib/import/apply";
import { isImportKind, isRecord } from "@/lib/import/types";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

// POST /api/import/apply body: { kind: "sessions" | "models" | "skills" | "mcp", ids: string[], cwd? }
//
// The client sends candidate ids only. The handler re-runs the matching scan
// and resolves each id against the fresh result, so the renderer can never
// steer what gets read or written: an id that is not in the latest scan is
// counted `failed`, never treated as a path.
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

  const record = isRecord(body) ? body : {};
  if (!isImportKind(record.kind)) {
    return NextResponse.json(
      { error: "kind must be one of sessions, models, skills, mcp" },
      { status: 400 },
    );
  }
  const ids = record.ids;
  if (
    !Array.isArray(ids)
    || ids.length > IMPORT_APPLY_MAX_IDS
    || ids.some((id) => typeof id !== "string")
  ) {
    return NextResponse.json(
      { error: `ids must be an array of at most ${IMPORT_APPLY_MAX_IDS} strings` },
      { status: 400 },
    );
  }
  const cwd = typeof record.cwd === "string" ? record.cwd : undefined;

  try {
    return NextResponse.json(await applyImports(record.kind, ids as string[], { cwd }));
  } catch {
    // The apply engine is built to bucket per-item failures instead of
    // throwing; this is the last-resort guard so a bug can never leak a stack
    // or a secret.
    return NextResponse.json({ error: "Apply failed" }, { status: 500 });
  }
}

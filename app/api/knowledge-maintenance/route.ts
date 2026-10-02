import { stat } from "fs/promises";
import { resolve } from "path";
import { NextResponse } from "next/server";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "@/lib/file-access";
import {
  isKnowledgeMaintenanceApproved,
  writeKnowledgeMaintenanceApproval,
} from "@/lib/knowledge-store";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

/**
 * fork:proma-51-knowledge — the consent surface for `knowledge_write`.
 *
 * GET  ?cwd=…            → { cwd, approved }
 * POST { cwd, approved } → { cwd, approved }
 *
 * The project directory is validated through the same allowed-root boundary as
 * `/api/project-trust`, so approval can only ever be recorded for a directory the
 * file explorer already trusts. The approval store itself is
 * `~/.pi/agent/knowledge-maintenance.json` (see `lib/knowledge-store.ts`).
 */
async function validateCwd(value: unknown): Promise<
  { cwd: string } | { response: NextResponse }
> {
  if (typeof value !== "string" || !value.trim()) {
    return { response: NextResponse.json({ error: "cwd required" }, { status: 400 }) };
  }

  const cwd = resolve(value);
  try {
    if (!(await stat(cwd)).isDirectory()) {
      return { response: NextResponse.json({ error: "cwd must be a directory" }, { status: 400 }) };
    }
  } catch {
    return { response: NextResponse.json({ error: "Directory does not exist" }, { status: 400 }) };
  }

  const allowedRoots = await getAllowedFileRoots();
  if (!isExistingFilePathAllowed(cwd, allowedRoots)) {
    return { response: NextResponse.json({ error: "Access denied" }, { status: 403 }) };
  }
  return { cwd };
}

export async function GET(req: Request) {
  const result = await validateCwd(new URL(req.url).searchParams.get("cwd"));
  if ("response" in result) return result.response;
  try {
    return NextResponse.json({
      cwd: result.cwd,
      approved: isKnowledgeMaintenanceApproved(result.cwd),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }

  try {
    const body = await req.json() as { cwd?: unknown; approved?: unknown };
    const result = await validateCwd(body.cwd);
    if ("response" in result) return result.response;
    if (typeof body.approved !== "boolean") {
      return NextResponse.json({ error: "approved must be a boolean" }, { status: 400 });
    }
    writeKnowledgeMaintenanceApproval(result.cwd, body.approved);
    return NextResponse.json({
      cwd: result.cwd,
      approved: isKnowledgeMaintenanceApproved(result.cwd),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

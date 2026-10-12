// fork:session-summary-list — upstream-port marker
import { NextResponse } from "next/server";
import { existsSync, statSync } from "fs";
import {
  attachSessionProjectInfo,
  openSessionManager,
  resolveSessionPath,
  resolveSessionIdByPath,
  invalidateSessionListCache,
  invalidateSessionManagerCache,
  buildSessionContext,
  readLatestSessionEntryId,
} from "@/lib/session-reader";
import { deleteSessions } from "@/lib/session-delete";
import { getRpcSession } from "@/lib/rpc-manager";
import { projectTreeForResponse, toSummaryTree } from "@/lib/project-tree";
import { computeSessionTotalActiveMs } from "@/lib/session-timing";
import { computeSessionStats } from "@/lib/session-stats";
import { startServerPerf } from "@/lib/perf";
import { computeSessionRevision } from "@/lib/session-revision";
import type { SessionEntry } from "@/lib/types";
import { readSubagentRun, readSubagentSessionResources } from "@/lib/subagents";
import { readSessionToolSelection } from "@/lib/session-tool-selection";
import { jsonResponse } from "@/lib/json-response";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const perf = startServerPerf("GET /api/sessions/[id]");
  try {
    perf?.span("resolve");
    const rpc = getRpcSession(id);

    // A live wrapper only reflects the appends pi-web itself made. When another
    // pi process (the TUI) writes the same session file, the wrapper's in-memory
    // entries silently diverge from disk and every read — including a manual
    // refresh — keeps serving the stale snapshot. Detect the newest on-disk
    // entry the wrapper never saw and drop the wrapper, so this request rebuilds
    // from the file instead of from memory. Only while idle: mid-run the wrapper
    // owns the write path, so an external write then is the genuinely
    // unsupported concurrent-write case rather than a stale read.
    let liveWrapper = rpc?.isAlive() ? rpc : undefined;
    let wrapperRebuilt = false;
    if (liveWrapper && !liveWrapper.isRunning()) {
      const diskLatestId = readLatestSessionEntryId(liveWrapper.sessionFile);
      if (diskLatestId && !liveWrapper.inner.sessionManager.getEntry(diskLatestId)) {
        liveWrapper.destroy();
        invalidateSessionListCache();
        liveWrapper = undefined;
        wrapperRebuilt = true;
      }
    }
    const liveRpc = liveWrapper;
    const resolvedPath = liveRpc ? null : await resolveSessionPath(id);
    if (!liveRpc && !resolvedPath) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const sm = liveRpc?.inner.sessionManager ?? openSessionManager(resolvedPath!);
    perf?.span("open");
    const filePath = liveRpc?.sessionFile || sm.getSessionFile() || resolvedPath || "";
    const entries = sm.getEntries();
    const leafId = sm.getLeafId();
    const searchParams = new URL(req.url).searchParams;
    const summaryTree = searchParams.get("tree") === "summary";
    const tree = summaryTree
      ? toSummaryTree(projectTreeForResponse(sm.getTree()))
      : projectTreeForResponse(sm.getTree());
    perf?.span("tree");
    const deferThinking = searchParams.has("deferThinking");
    const deferToolResultImages = searchParams.has("deferMedia");
    const rawTail = Number(searchParams.get("tail"));
    const tail = Number.isFinite(rawTail) && rawTail > 0 ? Math.min(rawTail, 1000) : 50;
    const context = buildSessionContext(entries as never, leafId, {
      deferThinking,
      deferToolResultImages,
      tail,
      sessionId: id, // local: lazy URLs for historical tool-result images
    });
    perf?.span("context");
    const totalActiveMs = computeSessionTotalActiveMs(entries);
    // Cumulative usage over ALL entries, including history compacted away —
    // the same aggregation the SDK's getSessionStats() uses. Lets the client
    // keep monotonic token/cost counters across compaction and page reloads.
    const stats = computeSessionStats(entries as unknown as SessionEntry[]);
    perf?.span("stats");
    // Opaque freshness token for the session view cache. Derived from the
    // disk fingerprint and the actual read source; null tells the client the
    // snapshot is unstable and must not be cached as fresh.
    const latestEntry = entries[entries.length - 1] as { id?: string } | undefined;
    const snapshotRevision = computeSessionRevision({
      filePath,
      sourceId: liveRpc ? `runtime:${String(liveRpc.inner.sessionId)}` : "disk",
      entryCount: entries.length,
      latestEntryId: typeof latestEntry?.id === "string" ? latestEntry.id : null,
      leafId: leafId ?? null,
    });
    const sessionName = sm.getSessionName();
    const firstUserEntry = entries.find((entry) => entry.type === "message" && entry.message.role === "user");
    const firstUserMessage = firstUserEntry?.type === "message" ? firstUserEntry.message : undefined;

    const header = sm.getHeader();
    let modified = header?.timestamp ?? new Date().toISOString();
    try { modified = statSync(filePath).mtime.toISOString(); } catch { /* use header timestamp */ }
    const parentSessionId = header?.parentSession
      ? await resolveSessionIdByPath(header.parentSession)
      : undefined;
    const subagent = header
      ? readSubagentRun(entries as never, header.id, filePath)
      : null;
    const toolNames = readSubagentSessionResources(entries as never)?.tools
      ?? readSessionToolSelection(entries as never);
    const info = header ? (await attachSessionProjectInfo([{
      path: filePath,
      id: header.id,
      cwd: header.cwd ?? "",
      name: sessionName,
      created: header.timestamp,
      modified,
      messageCount: stats.totalMessages,
      firstMessage: firstUserMessage
        ? (() => {
            const c = (firstUserMessage as { content: unknown }).content;
            return typeof c === "string" ? c : (Array.isArray(c) ? (c.find((b: { type: string }) => b.type === "text") as { text: string } | undefined)?.text ?? "" : "") || "(no messages)";
          })()
        : "(no messages)",
      parentSessionId,
      ...(subagent
        ? { relation: { kind: "subagent" as const, parentSessionId: subagent.parentSessionId, profile: subagent.profile, description: subagent.description, status: liveRpc?.isRunning() ? "running" as const : subagent.status } }
        : header.parentSession
          ? { relation: { kind: "fork" as const, ...(parentSessionId ? { originSessionId: parentSessionId } : {}) } }
          : {}),
      transient: !filePath || !existsSync(filePath),
    }]))[0] : null;

    return perf?.attach(jsonResponse(
      req,
      {
        sessionId: id,
        filePath,
        info,
        leafId,
        tree,
        ...(summaryTree ? { treeFormat: "summary" as const } : {}),
        snapshotRevision,
        context,
        stats,
        totalActiveMs,
        ...(toolNames !== undefined ? { toolNames } : {}),
        ...(wrapperRebuilt ? { wrapperRebuilt: true } : {}),
      },
    )) ?? jsonResponse(
      req,
      {
        sessionId: id,
        filePath,
        info,
        leafId,
        tree,
        ...(summaryTree ? { treeFormat: "summary" as const } : {}),
        snapshotRevision,
        context,
        stats,
        totalActiveMs,
        ...(toolNames !== undefined ? { toolNames } : {}),
        ...(wrapperRebuilt ? { wrapperRebuilt: true } : {}),
      },
    );
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// PATCH /api/sessions/[id]  body: { name: string }
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const { name } = await req.json() as { name?: string };
    if (typeof name !== "string") {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }
    const filePath = await resolveSessionPath(id);
    if (!filePath) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    // PATCH writes via appendSessionInfo — open fresh, bypassing the cache.
    const sm = openSessionManager(filePath, { mutable: true });
    sm.appendSessionInfo(name.trim());
    invalidateSessionManagerCache(filePath);
    invalidateSessionListCache();
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// DELETE /api/sessions/[id]
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    // fork:upstream-0.12-sidebar-parity —— 删除逻辑抽到 lib/session-delete.ts，单删与
    // 项目「删除全部会话」共用一份级联/重挂/关闭实现（#1182）。
    const { missing } = await deleteSessions([id]);
    if (missing.length > 0) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

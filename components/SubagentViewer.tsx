"use client";

/**
 * fork:upstream-0.12-subagent-parity —— 子代理会话的只读视图，渲染在右侧面板标签里（#1129）。
 *
 * 实时更新刻意轮询 context 端点，而不是打开 agent SSE：`GET /api/sessions/[id]/context`
 * 会返回运行中 wrapper 的内存条目（或落定后的文件），且**从不**创建 wrapper，
 * 所以一个查看器标签永远不会复活或干扰一个子代理运行。条目级粒度：pi 同步追加每条
 * 已完成的 entry，所以 2s 的轮询能看到 message / tool-call 粒度的进展。
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { MessageView } from "./MessageView";
import { buildToolResultsMap, EMPTY_TRANSCRIPT, mergeTailPage, prependOlderPage, type SubagentTranscript } from "./subagent-viewer-state";
import { useI18n } from "@/hooks/useI18n";
import type { SessionInfo, SubagentSessionStatus } from "@/lib/types";
import { TEXT } from "@/lib/typography";

interface Props {
  sessionId: string;
  /** Label from the subagent tool call (`description || profile`), used until the session info loads. */
  fallbackLabel: string;
  running: boolean;
  onOpenFile: (filePath: string, page?: number) => void;
}

const POLL_MS = 2000;
const TAIL = 100;

const STATUS_COLORS: Record<SubagentSessionStatus, string> = {
  starting: "var(--text-dim)",
  queued: "var(--text-dim)",
  running: "var(--accent)",
  completed: "var(--success)",
  failed: "var(--error)",
  aborted: "var(--text-muted)",
  interrupted: "var(--text-muted)",
};

function contextUrl(sessionId: string, before?: string): string {
  const params = new URLSearchParams({ deferThinking: "1", deferMedia: "1", tail: String(TAIL) });
  if (before) params.set("before", before);
  return `/api/sessions/${encodeURIComponent(sessionId)}/context?${params}`;
}

function toTranscript(page: Partial<SubagentTranscript>): SubagentTranscript {
  return {
    messages: page.messages ?? [],
    entryIds: page.entryIds ?? [],
    oldestEntryId: page.oldestEntryId ?? null,
    hasMore: Boolean(page.hasMore),
  };
}

export function SubagentViewer({ sessionId, fallbackLabel, running, onOpenFile }: Props) {
  const { t, locale } = useI18n();
  const [info, setInfo] = useState<SessionInfo | null>(null);
  const [label, setLabel] = useState(fallbackLabel);
  const [transcript, setTranscript] = useState<SubagentTranscript>(EMPTY_TRANSCRIPT);
  const { messages, entryIds, oldestEntryId, hasMore } = transcript;
  const transcriptRef = useRef(transcript);
  transcriptRef.current = transcript;
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // 打开时、运行开始/结束时（用已落盘状态接管实时标志）、以及手动刷新时拉一次会话信息。
  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`, {
          signal: controller.signal,
          cache: "no-store",
        });
        if (res.status === 404) return; // 保留 fallback 标签；context 轮询会报「starting」
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json() as { info?: SessionInfo; error?: string };
        if (!data.info) throw new Error(data.error ?? `HTTP ${res.status}`);
        setInfo(data.info);
        setLabel(data.info.name || data.info.firstMessage || fallbackLabel);
      } catch {
        /* 非致命：下面的 context 视图才是主内容 */
      }
    })();
    return () => controller.abort();
  }, [sessionId, running, refreshKey, fallbackLabel]);

  // 初始加载；运行中时轮询新条目。每次轮询都是最新一页，折进已加载的旧页。
  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    let inFlight = false;
    const load = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const res = await fetch(contextUrl(sessionId), { signal: controller.signal, cache: "no-store" });
        if (res.status === 404) {
          if (!cancelled) setNotFound(true);
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json() as { context: Partial<SubagentTranscript> };
        if (cancelled) return;
        setNotFound(false);
        setError(null);
        setTranscript((current) => mergeTailPage(current, toTranscript(data.context)));
      } catch (err) {
        if (!cancelled && !(err instanceof Error && err.name === "AbortError")) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        inFlight = false;
      }
    };
    void load();
    if (!running) {
      return () => {
        cancelled = true;
        controller.abort();
      };
    }
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
      controller.abort();
    };
  }, [sessionId, running, refreshKey]);

  const listRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const prependAnchorRef = useRef<number | null>(null);
  const loadingEarlierRef = useRef(false);
  const pagingControllerRef = useRef<AbortController | null>(null);
  useEffect(() => () => pagingControllerRef.current?.abort(), []);

  const loadEarlier = useCallback(async () => {
    const cursor = oldestEntryId;
    if (!cursor || loadingEarlierRef.current) return;
    loadingEarlierRef.current = true;
    const controller = new AbortController();
    pagingControllerRef.current = controller;
    setLoadingEarlier(true);
    try {
      const res = await fetch(contextUrl(sessionId, cursor), { signal: controller.signal, cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { context: Partial<SubagentTranscript> };
      if (transcriptRef.current.oldestEntryId !== cursor) return;
      const el = listRef.current;
      prependAnchorRef.current = el ? el.scrollHeight - el.scrollTop : null;
      setTranscript((current) => prependOlderPage(current, cursor, toTranscript(data.context)));
    } catch {
      /* 翻页是尽力而为；按钮留着重试 */
    } finally {
      loadingEarlierRef.current = false;
      if (pagingControllerRef.current === controller) pagingControllerRef.current = null;
      if (!controller.signal.aborted) setLoadingEarlier(false);
    }
  }, [oldestEntryId, sessionId]);

  const handleScroll = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  }, []);
  useLayoutEffect(() => {
    const el = listRef.current;
    const anchor = prependAnchorRef.current;
    prependAnchorRef.current = null;
    if (!el) return;
    if (anchor !== null) el.scrollTop = el.scrollHeight - anchor;
    else if (stickToBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const toolResults = useMemo(() => buildToolResultsMap(messages), [messages]);
  const relation = info?.relation?.kind === "subagent" ? info.relation : null;
  const status: SubagentSessionStatus = running ? "running" : relation?.status ?? "completed";

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", minWidth: 0 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--s2)",
          padding: "6px 12px",
          borderBottom: "1px solid var(--border)",
          background: "var(--bg-panel)",
          flexShrink: 0,
          minHeight: "var(--control-lg)",
        }}
      >
        <span style={{ display: "flex", alignItems: "center", color: "var(--accent)", flexShrink: 0 }} aria-hidden="true">
          <i data-ico="git-fork" data-size="14"></i>
        </span>
        <strong
          style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: TEXT.sm, fontWeight: 600 }}
          title={relation ? `${relation.profile ?? t("agentSwitcher.subagent")} · ${label}` : label}
        >
          {label}
        </strong>
        <span
          style={{ display: "flex", alignItems: "center", gap: "var(--s1)", color: STATUS_COLORS[status], fontSize: TEXT.xs, whiteSpace: "nowrap", flexShrink: 0 }}
          title={relation?.description}
        >
          <i data-ico="circle" data-size="8" aria-hidden="true"></i>
          <span>{t(`agentSwitcher.status.${status}`)}</span>
        </span>
        <button
          type="button"
          onClick={() => setRefreshKey((key) => key + 1)}
          title={t("subagent.refresh")}
          aria-label={t("subagent.refresh")}
          style={{
            display: "grid", placeItems: "center", width: "var(--control-xs)", height: "var(--control-xs)", flexShrink: 0,
            background: "none", border: "none", borderRadius: "var(--nx-radius-control)", color: "var(--text-dim)", cursor: "pointer", padding: 0,
          }}
        >
          <i data-ico="refresh-cw" data-size="13" aria-hidden="true"></i>
        </button>
      </div>

      <div
        ref={listRef}
        onScroll={handleScroll}
        style={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden", padding: "10px 0" }}
        lang={locale}
      >
        {notFound ? (
          <div style={{ padding: "24px 16px", color: "var(--text-muted)", fontSize: TEXT.sm, textAlign: "center" }}>
            {running ? t("subagent.viewer.starting") : t("subagent.viewer.error")}
          </div>
        ) : error && messages.length === 0 ? (
          <div role="alert" style={{ padding: "24px 16px", color: "var(--error)", fontSize: TEXT.sm, textAlign: "center" }}>
            {t("subagent.viewer.error")}
            <div style={{ marginTop: "var(--s1)", color: "var(--text-dim)", fontFamily: "var(--font-mono)", overflowWrap: "anywhere" }}>{error}</div>
          </div>
        ) : (
          <>
            {hasMore && (
              <div style={{ display: "flex", justifyContent: "center", padding: "4px 0 10px" }}>
                <button
                  type="button"
                  onClick={loadEarlier}
                  disabled={loadingEarlier}
                  className="d-btn sm"
                >
                  {t("i18n.loadMore")}
                </button>
              </div>
            )}
            {messages.map((message, index) => (
              <div key={entryIds[index] ?? index} style={{ padding: "2px 12px" }}>
                <MessageView
                  message={message}
                  toolResults={toolResults}
                  cwd={info?.cwd}
                  onOpenFile={onOpenFile}
                  sessionId={sessionId}
                  entryId={entryIds[index]}
                />
              </div>
            ))}
            {messages.length === 0 && !error && (
              <div style={{ padding: "24px 16px", color: "var(--text-dim)", fontSize: TEXT.sm, textAlign: "center" }}>
                {t("subagent.viewer.empty")}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

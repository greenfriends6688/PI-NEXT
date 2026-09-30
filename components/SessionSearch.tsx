// fork:session-catalog — upstream-port marker
"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";
import { formatRelativeTime } from "@/lib/i18n/format";
import type { SessionInfo } from "@/lib/types";
import type { SessionSearchResponse } from "@/lib/session-search";

export function SessionSearch({ open, query, children, selectedSessionId, onSelectSession }: {
  open: boolean;
  query: string;
  children: ReactNode;
  selectedSessionId: string | null;
  onSelectSession: (session: SessionInfo, entryId?: string, blockIndex?: number) => void;
}) {
  const { t, locale } = useI18n();
  const [state, setState] = useState<{ query: string; response?: SessionSearchResponse; failed?: boolean }>({ query: "" });
  const search = query.trim();
  const response = state.query === search ? state.response : undefined;
  const failed = state.query === search && state.failed;

  // Re-runs only when the query changes. It deliberately does not depend on the
  // session-list version: ordinary agent activity bumps that version every few
  // seconds, which used to refetch (and re-order) results while they were being
  // read.
  useEffect(() => {
    if (!open || !search) return;
    const controller = new AbortController();
    setState({ query: search });
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/sessions/search?${new URLSearchParams({ q: search })}`, { signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json() as SessionSearchResponse;
        if (!controller.signal.aborted) setState({ query: search, response: data });
      } catch {
        if (!controller.signal.aborted) setState({ query: search, failed: true });
      }
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, search]);

  return !open || !search ? children : (
    // fork:design-system SW-02 —— 结果区 = 画板 02 帧 C：`.pw-search-results` 容器 +
    // 计数行 + 每条 `.pw-session.child`（标题 / 项目·时间 / 命中片段）。
    <div className="pw-search-results" aria-busy={!response && !failed}>
      <div role="status" className="pw-prow pw-desc">
        {failed ? t("sidebar.sessionSearchFailed") : !response ? t("sidebar.sessionSearching")
          : response.results.length === 0 ? t("sidebar.sessionSearchEmpty")
          : t("sidebar.sessionSearchCount", { count: response.results.length })}
      </div>
      {response?.truncated && (
        <div role="status" className="pw-prow pw-desc">{t("sidebar.sessionSearchPartial")}</div>
      )}
      {response?.results.map(({ session, entryId, blockIndex, before, match, after }) => (
        <button
          key={session.id}
          type="button"
          onClick={() => onSelectSession(session, entryId, blockIndex)}
          aria-current={session.id === selectedSessionId ? "true" : undefined}
          className={`pw-session child${session.id === selectedSessionId ? " is-on" : ""}`}
          style={{ textAlign: "left" }}
        >
          <span className="pw-body">
            <span className="pw-t">{session.name || session.firstMessage}</span>
            <span className="pw-m">
              <span className="pw-search-project" title={session.cwd}>{session.cwd}</span>
              <span className="pw-dim">{formatRelativeTime(session.modified, locale)}</span>
            </span>
            <span className="pw-search-hit">
              {before}<span className="pw-mark">{match}</span>{after}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}

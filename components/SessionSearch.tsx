// fork:session-catalog — upstream-port marker
"use client";

import { useMemo, useEffect, useState, type ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";
import { formatRelativeTime } from "@/lib/i18n/format";
import type { SessionInfo } from "@/lib/types";
import type { SessionSearchResponse, SessionSearchResult } from "@/lib/session-search";

/**
 * fork:design-system SW-02 / fix:search-grouping —— 结果区 = 画板 02 帧 C：
 * `.pw-search-results` 容器 + 计数行 + **按项目分组**（组头 `.pw-row`：folder 图标 +
 * 项目名 + 数量徽章），组内每条命中一行（会话标题 + accent 淡底的高亮片段）。
 *
 * 迁移前这里把每条命中渲染成一整行 `.pw-session.child`（标题 / 项目路径 / 相对时间 /
 * 命中片段四层挤在 26px 高的一格里），还要在每个项目下重复打印一遍同样的 cwd ——
 * 结果就是「乱」：行高不够、路径重复、命中片段被压成一条缝。
 * 画板给的是**分组**形态，所以这里按 `session.cwd` 归组，分组头只出现一次。
 */

interface SearchGroup {
  key: string;
  label: string;
  fullPath: string;
  modified: string;
  results: SessionSearchResult[];
}

/** 项目名取 cwd 的末段；取不到就退回整条路径。 */
export function projectLabelOf(cwd: string): string {
  const trimmed = cwd.replace(/[/\\]+$/, "");
  const segment = trimmed.split(/[/\\]/).pop();
  return segment || trimmed || cwd;
}

/**
 * 归组 + 排序。纯函数，便于单测。
 * - 组按「组内最新一条命中的修改时间」降序；
 * - 组内按修改时间降序。
 */
export function groupSearchResults(results: SessionSearchResult[]): SearchGroup[] {
  const byProject = new Map<string, SearchGroup>();
  for (const result of results) {
    const key = result.session.cwd || "";
    let group = byProject.get(key);
    if (!group) {
      group = {
        key,
        label: projectLabelOf(result.session.cwd || ""),
        fullPath: result.session.cwd || "",
        modified: result.session.modified,
        results: [],
      };
      byProject.set(key, group);
    }
    if (result.session.modified > group.modified) group.modified = result.session.modified;
    group.results.push(result);
  }
  const groups = [...byProject.values()];
  for (const group of groups) {
    group.results.sort((a, b) => b.session.modified.localeCompare(a.session.modified));
  }
  groups.sort((a, b) => b.modified.localeCompare(a.modified));
  return groups;
}

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

  const groups = useMemo(() => groupSearchResults(response?.results ?? []), [response]);

  if (!open || !search) return children;

  const statusLine = failed ? t("sidebar.sessionSearchFailed")
    : !response ? t("sidebar.sessionSearching")
      : response.results.length === 0 ? t("sidebar.sessionSearchEmpty")
        : t("sidebar.sessionSearchCount", { count: response.results.length });

  return (
    <div className="pw-search-results" aria-busy={!response && !failed}>
      <div role="status" className="pw-group-title" style={{ paddingTop: "var(--s1)" }}>{statusLine}</div>

      {groups.map((group) => (
        <section key={group.key} className="pw-search-group">
          <div className="pw-row" title={group.fullPath}>
            <span className="pw-ico"><i data-ico="folder" data-size="14"></i></span>
            <span className="pw-search-project">{group.label}</span>
            <span className="grow" />
            <span className="pw-badge count">{group.results.length}</span>
          </div>
          {group.results.map((result) => {
            const title = result.session.name?.trim() || result.session.firstMessage?.trim();
            const isCurrent = result.session.id === selectedSessionId;
            return (
              <button
                key={`${result.session.id}:${result.entryId ?? ""}:${result.blockIndex}`}
                type="button"
                onClick={() => onSelectSession(result.session, result.entryId, result.blockIndex)}
                aria-current={isCurrent ? "true" : undefined}
                title={title || result.session.cwd}
                className={`pw-search-result${isCurrent ? " is-on" : ""}`}
              >
                <span className="pw-search-result-head">
                  <span className="pw-t">{title || t("i18n.newSession")}</span>
                  <span className="pw-dim">{formatRelativeTime(result.session.modified, locale)}</span>
                </span>
                <span className="pw-search-hit">
                  {result.before}
                  <mark className="pw-mark">{result.match}</mark>
                  {result.after}
                </span>
              </button>
            );
          })}
        </section>
      ))}

      {response?.truncated && (
        <div role="status" className="pw-row muted" style={{ justifyContent: "center", marginTop: "var(--s2)" }}>
          <span style={{ fontSize: "var(--text-meta)" }}>{t("sidebar.sessionSearchPartial")}</span>
        </div>
      )}
    </div>
  );
}

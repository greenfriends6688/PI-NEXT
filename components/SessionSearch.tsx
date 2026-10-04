// fork:session-catalog — upstream-port marker
"use client";

import { useMemo, useEffect, useState, type ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";
// fork:v5-wave-b —— 窄屏（≤640px，与 pwa/system.css 的 @import 媒体条件同一个断点）
// 换成 M-04 的抽屉内命中列表：`.m-list` / `.m-group-title` / `.m-row`（`.m-row-t` + `.m-row-m`）。
// 判据用 `useIsMobile()` 而不是组件里那个触控档判据：d-* 规则只在 ≥641 生效，
// 641–1024 的平板档仍然是 d-* DOM，写窄一点就会在平板上挂到不生效的类。
import { useIsMobile } from "@/hooks/useIsMobile";
import { formatRelativeTime } from "@/lib/i18n/format";
import type { SessionInfo } from "@/lib/types";
import type { SessionSearchResponse, SessionSearchResult } from "@/lib/session-search";

/**
 * fork:v5-landing —— 结果区照画板 **D-02d 帧 E（搜索态）** 抄：
 * `.d-group-title`（`search` 图标 + 计数）作分区头；项目组头用 `.d-group-title`
 * （folder + 组名 + `.d-t-xs` 数量）；每条命中用画板的会话行 `.d-sess`
 * （`.d-sess-t` 标题 + `.d-sess-m` 相对时间 · 命中片段），命中片段用 `.d-cmd-hit`。
 * 结果直接落在侧栏的滚动容器（`listScrollRef`）里，与画板一致，不再自建内层滚动。
 *
 * 迁移前这里把每条命中渲染成一整行 `.pw-session.child`（四层挤在 26px 里、还要在每个
 * 项目下重复打印 cwd）。画板给的是**分组**形态，所以仍按 `session.cwd` 归组，组头只出现一次。
 *
 * fork:v5-wave-b —— 窄屏分支照画板 **M-04 帧 B（搜索命中与分段）** 抄 DOM：
 *   `.m-list` > `.m-group-title`（分区 / 项目组头）+ `.m-row`（`.m-row-t` 标题 +
 *   `.m-row-m` 相对时间 · 命中片段）。数据、分组、i18n、fetch 与桌面分支逐字相同。
 *   命中高亮仍是 `.d-cmd-hit`：**PWA 组件库里没有对应的 m-* 类**（见汇报的缺件一节），
 *   且它是 ≥641 才生效的规则，所以窄屏上落回 `<mark>` 的 UA 表现 —— 与今天一致。
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
  const isPhone = useIsMobile();
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
    <div className={isPhone ? "m-list" : "d-col"} aria-busy={!response && !failed}>
      <div role="status" className={isPhone ? "m-group-title" : "d-group-title"}>
        <i data-ico="search" data-size="12"></i>
        <span className="d-grow">{statusLine}</span>
      </div>

      {groups.map((group) => (
        <section key={group.key} className="d-col">
          <div className={isPhone ? "m-group-title" : "d-group-title"} title={group.fullPath}>
            <i data-ico="folder" data-size="12"></i>
            <span className={isPhone ? "m-grow" : "d-grow"}>{group.label}</span>
            <span className={isPhone ? "m-t-xs" : "d-t-xs"}>{group.results.length}</span>
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
                className={isPhone ? `m-row${isCurrent ? " is-on" : ""}` : `d-sess${isCurrent ? " is-on" : ""}`}
              >
                <span className={isPhone ? "m-row-t" : "d-sess-t"} style={isPhone ? undefined : { display: "block" }}>{title || t("i18n.newSession")}</span>
                <span className={isPhone ? "m-row-m" : "d-sess-m"}>
                  <span style={{ flex: "0 0 auto", whiteSpace: "nowrap" }}>{formatRelativeTime(result.session.modified, locale)}</span>
                  <span aria-hidden="true" style={{ flex: "0 0 auto" }}>·</span>
                  <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {result.before}
                    <mark className="d-cmd-hit">{result.match}</mark>
                    {result.after}
                  </span>
                </span>
              </button>
            );
          })}
        </section>
      ))}

      {response?.truncated && (
        <div role="status" className={isPhone ? "m-t-xs m-t-faint" : "d-t-xs d-t-faint"} style={{ textAlign: "center", padding: "var(--nx-sp-2)" }}>
          {t("sidebar.sessionSearchPartial")}
        </div>
      )}
    </div>
  );
}

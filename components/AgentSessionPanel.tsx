"use client";

import { useMemo, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { SessionInfo, SubagentSessionStatus } from "@/lib/types";
// fork:proma-06-delegation — 展示层用有效状态（重启后不再假装在跑）
import { effectiveSubagentStatus } from "@/lib/subagent-status";
import { TEXT } from "@/lib/typography";

interface Props {
  rootSession: SessionInfo;
  subagents: SessionInfo[];
  selectedSessionId: string;
  runningSessionIds: ReadonlySet<string>;
  onSelectSession: (session: SessionInfo) => void;
}

function sessionTitle(session: SessionInfo): string {
  return session.name || session.firstMessage || session.id.slice(0, 12);
}

function formatRelativeTime(value: string, locale: string): string {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "";
  const elapsedSeconds = Math.round((timestamp - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (Math.abs(elapsedSeconds) < 60) return formatter.format(elapsedSeconds, "second");
  const elapsedMinutes = Math.round(elapsedSeconds / 60);
  if (Math.abs(elapsedMinutes) < 60) return formatter.format(elapsedMinutes, "minute");
  const elapsedHours = Math.round(elapsedMinutes / 60);
  if (Math.abs(elapsedHours) < 24) return formatter.format(elapsedHours, "hour");
  return formatter.format(Math.round(elapsedHours / 24), "day");
}

/**
 * 画板 22「子代理切换」的状态图标词表：六种状态六枚 lucide 图标
 * （运行中 loader-circle / 排队 clock / 已完成 check / 失败 circle-x /
 * 已中止 circle-stop / 已中断 ban），颜色走画板自己的 token。
 */
type StatusIconName = { ico: string; color?: string; spin?: boolean };

const STATUS_ICON: Record<SubagentSessionStatus, StatusIconName> = {
  starting: { ico: "loader-circle", color: "var(--accent-text)", spin: true },
  running: { ico: "loader-circle", color: "var(--accent-text)", spin: true },
  queued: { ico: "clock", color: "var(--warning)" },
  completed: { ico: "check", color: "var(--success)" },
  failed: { ico: "circle-x", color: "var(--error)" },
  aborted: { ico: "circle-stop" },
  interrupted: { ico: "ban" },
};

function StatusIcon({ status }: { status: SubagentSessionStatus }) {
  const { ico, color, spin } = STATUS_ICON[status];
  return (
    <span className={`pw-ico${color ? "" : " pw-dim"}`} style={color ? { color } : undefined}>
      <i data-ico={ico} data-size="14" className={spin ? "pw-anim-spin" : undefined} aria-hidden="true"></i>
    </span>
  );
}

function AgentRow({
  session,
  main,
  selected,
  running,
  onSelect,
}: {
  session: SessionInfo;
  main?: boolean;
  selected: boolean;
  running: boolean;
  onSelect: () => void;
}) {
  const { locale, t } = useI18n();
  const relation = session.relation?.kind === "subagent" ? session.relation : null;
  const status: SubagentSessionStatus = effectiveSubagentStatus(relation?.status, { running });
  const primary = main ? t("agentSwitcher.main") : relation?.description || sessionTitle(session);
  const secondary = main
    ? sessionTitle(session)
    : `${relation?.profile ?? t("agentSwitcher.subagent")} · ${formatRelativeTime(session.modified, locale)}`;

  return (
    /* fork:design-components —— 整块换成画板 22 的 `.pw-pop` + `.pw-pop-title` +
       `.pw-prow(.is-on)` + `.pw-pop-search`：行是「图标槽 + 主副标题（grow）+ 状态短标签
       （pw-desc）」，悬停/选中由 board.css 给，不再手写 onMouseEnter 改背景。 */
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onSelect}
      className={`pw-prow${selected ? " is-on" : ""}`}
      /* fork-reset 已给 button.pw-prow 归零（width 100% / text-align left / 无边框底色）；
         这里只留产品这一行特有的两行高度。 */
      style={{ minHeight: 56 }}
    >
      <span className="pw-ico" style={main ? undefined : { color: "var(--accent-text)" }}>
        <i data-ico={main ? "user" : "bot"} data-size="14" aria-hidden="true"></i>
      </span>
      <span className="grow" style={{ minWidth: 0 }}>
        <span
          className={selected ? "pw-strong" : undefined}
          style={{
            display: "block",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontSize: TEXT.sm,
            fontWeight: selected ? 600 : 500,
          }}
          title={primary}
        >
          {primary}
        </span>
        <span
          className="pw-desc"
          style={{ display: "block", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
          title={secondary}
        >
          {secondary}
        </span>
      </span>
      <span className="pw-desc" style={{ display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>
        {main && !running ? (
          selected ? t("agentSwitcher.current") : null
        ) : (
          <>
            <StatusIcon status={status} />
            <span>{t(`agentSwitcher.status.${status}`)}</span>
          </>
        )}
      </span>
    </button>
  );
}

export function AgentSessionPanel({ rootSession, subagents, selectedSessionId, runningSessionIds, onSelectSession }: Props) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const sortedSubagents = useMemo(() => [...subagents].sort((a, b) => {
    const aRunning = runningSessionIds.has(a.id);
    const bRunning = runningSessionIds.has(b.id);
    if (aRunning !== bRunning) return aRunning ? -1 : 1;
    return b.modified.localeCompare(a.modified);
  }), [runningSessionIds, subagents]);
  const normalizedQuery = query.trim().toLowerCase();
  const visibleSubagents = normalizedQuery
    ? sortedSubagents.filter((session) => {
        const relation = session.relation?.kind === "subagent" ? session.relation : null;
        return [relation?.description, relation?.profile, session.name, session.firstMessage]
          .some((value) => value?.toLowerCase().includes(normalizedQuery));
      })
    : sortedSubagents;
  const runningCount = subagents.filter((session) => runningSessionIds.has(session.id)).length;

  return (
    /* fork:design-components —— 面板本体 = 画板 22 的 `.pw-pop`（320 宽 / radius-6 /
       单一阴影 / padding-s1 / overflow hidden）。左侧贴边、下圆角的旧形态由
       fork-ui.css 的 `.agent-session-panel` 覆盖（见本轮交接说明），这里不再内联边框。 */
    <div
      role="listbox"
      aria-label={t("agentSwitcher.title")}
      className="pw-pop agent-session-panel"
      style={{ width: "auto", minWidth: 320, maxWidth: "100%" }}
    >
      <div className="pw-pop-title" style={{ display: "flex", alignItems: "center", gap: "var(--s2)" }}>
        <span>{t("agentSwitcher.title")}</span>
        <span className="pw-badge count">{t("agentSwitcher.count", { count: subagents.length })}</span>
        <span className="grow" />
        {runningCount > 0 && (
          <span className="pw-badge accent count">{t("agentSwitcher.runningCount", { count: runningCount })}</span>
        )}
      </div>
      {subagents.length > 8 && (
        /* 画板 22 的 `.pw-pop-search`（slash/search 图标槽 + `.pw-input`），钉在列表上方。 */
        <div className="pw-pop-search" style={{ margin: "0 0 var(--s1)" }}>
          <span className="pw-ico"><i data-ico="search" data-size="14" aria-hidden="true"></i></span>
          <input
            className="pw-input"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("agentSwitcher.search")}
            aria-label={t("agentSwitcher.search")}
            style={{ minWidth: 0, flex: 1, height: 24, border: 0, background: "transparent" }}
          />
        </div>
      )}
      <div className="pw-sep" />
      <div style={{ maxHeight: "min(58dvh, 480px)", overflowY: "auto" }}>
        <AgentRow
          session={rootSession}
          main
          selected={rootSession.id === selectedSessionId}
          running={runningSessionIds.has(rootSession.id)}
          onSelect={() => onSelectSession(rootSession)}
        />
        {visibleSubagents.map((session) => (
          <AgentRow
            key={session.id}
            session={session}
            selected={session.id === selectedSessionId}
            running={runningSessionIds.has(session.id)}
            onSelect={() => onSelectSession(session)}
          />
        ))}
        {visibleSubagents.length === 0 && (
          <div className="pw-prow"><span className="pw-desc">{t("agentSwitcher.noMatches")}</span></div>
        )}
      </div>
    </div>
  );
}

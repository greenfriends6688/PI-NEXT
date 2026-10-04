"use client";

import { useMemo, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { SessionInfo, SubagentSessionStatus } from "@/lib/types";
// fork:proma-06-delegation — 展示层用有效状态（重启后不再假装在跑）
import { effectiveSubagentStatus } from "@/lib/subagent-status";

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
  starting: { ico: "loader-circle", color: "var(--nx-accent)", spin: true },
  running: { ico: "loader-circle", color: "var(--nx-accent)", spin: true },
  queued: { ico: "clock", color: "var(--nx-warning)" },
  completed: { ico: "check", color: "var(--nx-success)" },
  failed: { ico: "circle-x", color: "var(--nx-danger)" },
  aborted: { ico: "circle-stop" },
  interrupted: { ico: "ban" },
};

function StatusIcon({ status }: { status: SubagentSessionStatus }) {
  const { ico, color, spin } = STATUS_ICON[status];
  const icon = (
    <i
      data-ico={ico}
      data-size="14"
      aria-hidden="true"
      style={{ flexShrink: 0, color: color ?? "var(--nx-text-3)" }}
    ></i>
  );
  // fork:v5-landing —— 转圈用画板 `.d-run`（首枚 `<i>` 自带 nx-spin），不再用旧 `.pw-anim-spin`。
  return spin ? <span className="d-run" style={{ gap: 0 }}>{icon}</span> : icon;
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
    /* fork:v5-landing —— 行原子 = 画板 D-02b 帧 B ③ 的 `.d-pop-row`（浮层两行行：
       `d-pop-row-t` 主标题 + `d-pop-row-s` 副行，当前项挂 `is-on`）。悬停/选中由
       system.css 给，不再手写 onMouseEnter 改背景。 */
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onSelect}
      className={`d-pop-row${selected ? " is-on" : ""}`}
      style={{ alignItems: "flex-start" }}
    >
      <span className="d-pop-row-t d-row d-grow" style={{ gap: "var(--nx-sp-1)", minWidth: 0, alignItems: "flex-start" }}>
        <i
          data-ico={main ? "user" : "bot"}
          data-size="14"
          aria-hidden="true"
          style={{ flexShrink: 0, marginTop: 2, color: main ? "var(--nx-text-3)" : "var(--nx-accent)" }}
        ></i>
        <span className="d-col d-grow" style={{ gap: 2, minWidth: 0 }}>
          <span
            className={selected ? "d-t-b" : undefined}
            style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
            title={primary}
          >
            {primary}
          </span>
          <span
            className="d-pop-row-s"
            style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
            title={secondary}
          >
            {secondary}
          </span>
        </span>
      </span>
      <span className="d-pop-row-s d-row" style={{ flexShrink: 0, gap: "var(--nx-sp-1)", whiteSpace: "nowrap", marginTop: 2 }}>
        {main && !running ? (
          selected ? <span className="d-badge mute">{t("agentSwitcher.current")}</span> : null
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
    /* fork:v5-landing —— 面板本体不再自带 `pw-pop` 壳：浮窗壳 `.d-pop-float` 由
       AppShell 的顶栏浮窗定位容器承担（它本来就是 fixed 定位）。这里只排内容：
       `d-pop-title`（标题 + 两枚徽章）› `d-searchfield` › `d-sep` › `d-pop-row` 列表
       › `d-pop-foot`。 */
    <div
      role="listbox"
      aria-label={t("agentSwitcher.title")}
      className="agent-session-panel d-col"
      style={{ maxWidth: "100%", gap: 0 }}
    >
      <div className="d-pop-title">
        <span className="d-row">
          <span>{t("agentSwitcher.title")}</span>
          <span className="d-badge mute">{t("agentSwitcher.count", { count: subagents.length })}</span>
          <span className="d-grow" />
          {runningCount > 0 && (
            <span className="d-badge info">{t("agentSwitcher.runningCount", { count: runningCount })}</span>
          )}
        </span>
      </div>
      {subagents.length > 8 && (
        <div className="d-searchfield" style={{ margin: "0 var(--nx-sp-1) var(--nx-sp-1)" }}>
          <i data-ico="search" data-size="13" aria-hidden="true"></i>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("agentSwitcher.search")}
            aria-label={t("agentSwitcher.search")}
          />
        </div>
      )}
      <div className="d-sep" />
      <div className="d-scroll" style={{ maxHeight: "min(58dvh, 480px)" }}>
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
          <div className="d-menu-row" style={{ cursor: "default" }}><span className="d-t-faint">{t("agentSwitcher.noMatches")}</span></div>
        )}
      </div>
    </div>
  );
}

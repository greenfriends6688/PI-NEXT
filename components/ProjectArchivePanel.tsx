"use client";

/**
 * fork:project-archive — 设置 → 项目归档。
 *
 * 项目索引 + 就地展开的检查器。数据源是 `/api/sessions` 派生出来的项目列表
 * （`lib/project-groups.ts` 的 `getRecentProjects`）——与侧栏用的是**同一个**身份
 * （`workspaceKeyOf` = 服务端算的 `projectKey`），所以「一个归档项目」就是侧栏里的
 * 一行，worktree 也不例外。归档标志本身在 `lib/project-flags.ts`，纯 localStorage。
 *
 * 两段而不是参考项目的三段：它那三段里的「置顶」对应的是**项目级**置顶，我们没有这个
 * 标志（只有会话级置顶）。为了凑形状去加一个没人要的标志不合适。
 *
 * 这个页面**永不删东西**：没有删除按钮、不动 `.jsonl`、不动磁盘目录。归档/恢复与打开
 * 是仅有的三个动作。
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import { useI18n } from "@/hooks/useI18n";
import { formatRelativeTime } from "@/lib/i18n/format";
import { getRecentProjects, sessionsForProject, withoutChatProject, type RecentProject } from "@/lib/project-groups";
import { partitionProjects, useProjectFlags } from "@/lib/project-flags";
import type { SessionInfo } from "@/lib/types";
import { ConfigButton } from "./SettingsUi";

export function ProjectArchivePanel({
  onOpenSession,
  onSessionsChanged,
}: {
  onOpenSession?: (id: string) => void;
  onSessionsChanged?: () => void;
}) {
  const { t, locale } = useI18n();
  const { flags, archive, restore } = useProjectFlags();
  const [sessions, setSessions] = useState<SessionInfo[] | null>(null);
  const [chatProjectKey, setChatProjectKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      // The chat workspace is its own sidebar section, so it must not show up here as a
      // project. Its identity is the server-computed key, exactly like every other row —
      // the browser never compares paths.
      const [sessionRes, chatRes] = await Promise.all([
        fetch("/api/sessions"),
        fetch("/api/chat-workspace").catch(() => null),
      ]);
      if (!sessionRes.ok) throw new Error(`HTTP ${sessionRes.status}`);
      const data = await sessionRes.json() as { sessions?: SessionInfo[] };
      const chat = chatRes?.ok ? await chatRes.json() as { projectKey?: string } : null;
      setChatProjectKey(chat?.projectKey ?? null);
      setSessions(data.sessions ?? []);
      setError(null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      setSessions([]);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const allSessions = useMemo(() => sessions ?? [], [sessions]);
  const projects = useMemo(
    () => withoutChatProject(getRecentProjects(allSessions), chatProjectKey),
    [allSessions, chatProjectKey],
  );
  const { visible, archived } = useMemo(
    () => partitionProjects(projects, flags),
    [projects, flags],
  );

  const setArchived = useCallback(async (key: string, next: boolean) => {
    setBusyKey(key);
    // Presentation first: the flag is localStorage, so there is nothing to await and the
    // row must not appear to hang on a network call.
    if (next) archive(key);
    else restore(key);
    setBusyKey(null);
    // A workspace swap can change which sessions exist; re-read rather than assume.
    onSessionsChanged?.();
  }, [archive, restore, onSessionsChanged]);

  // fork:project-archive — 这一页只列**已归档**的。原先还列一份「全部项目」，既是
  // 侧栏已经有的东西、又让这一页看不出自己在管什么（用户：「没归档的显示个鸡毛啊」）。
  // `visible` 仍然算出来是为了「归档了当前项目之后它还留在列表里」的那条规则，
  // 但不再渲染。
  void visible;
  const sections = [
    { id: "archived", label: t("settings.projectsArchived"), rows: archived },
  ].filter((section) => section.rows.length > 0);

  const renderRow = (project: RecentProject, isArchived: boolean) => {
    const own = sessionsForProject(allSessions, project.key);
    const latest = own.reduce((max, session) => (session.modified > max ? session.modified : max), "");
    const expanded = openKey === project.key;
    const archivedAt = flags.archivedAt[project.key];
    return (
      <div key={project.key} className="settings-archived-group">
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <button
            type="button"
            className="settings-archived-title"
            title={project.root}
            aria-expanded={expanded}
            onClick={() => setOpenKey(expanded ? null : project.key)}
          >
            <span className="settings-archived-name">{project.root.split(/[/\\]/).filter(Boolean).pop() || project.root}</span>
            <span className="settings-archived-meta">
              {t("settings.projectsSessionCount", { count: own.length })}
              {latest ? ` · ${formatRelativeTime(new Date(latest), locale)}` : ""}
              {isArchived && archivedAt ? ` · ${t("settings.archivedAt", { time: formatRelativeTime(new Date(archivedAt), locale) })}` : ""}
            </span>
          </button>
          <div className="settings-archived-actions">
            <ConfigButton
              variant="secondary"
              size="small"
              disabled={busyKey === project.key}
              onClick={() => void setArchived(project.key, !isArchived)}
            >
              {isArchived ? t("settings.projectsRestore") : t("settings.projectsArchive")}
            </ConfigButton>
          </div>
        </div>
        {expanded && (
          <div className="settings-archived-row" style={{ display: "block" }}>
            {own.length === 0 && <p className="settings-pi-theme-note">{t("settings.projectsNoSessions")}</p>}
            {own
              .slice()
              .sort((a, b) => b.modified.localeCompare(a.modified))
              .slice(0, 20)
              .map((session) => (
                <button
                  key={session.id}
                  type="button"
                  className="settings-archived-title"
                  title={session.id}
                  disabled={!onOpenSession}
                  onClick={() => onOpenSession?.(session.id)}
                >
                  <span className="settings-archived-name">{session.name || session.firstMessage || session.id.slice(0, 8)}</span>
                  <span className="settings-archived-meta">{formatRelativeTime(new Date(session.modified), locale)}</span>
                </button>
              ))}
            {own.length > 20 && (
              <p className="settings-pi-theme-note">{t("settings.projectsMoreSessions", { count: own.length - 20 })}</p>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <section className="settings-archive-section">
      {/* 头部归整档页所有（SettingsPanel 渲染），这里只出小节标题：原先两页各有自己的
          h3 + 说明，叠在一起像两张不相干的卡片。 */}
      <div className="settings-archive-section-label">{t("settings.projectsArchived")}</div>

      {error && <p className="settings-general-error" role="alert">{error}</p>}
      {sessions === null && <p className="settings-pi-theme-note">{t("i18n.loading")}</p>}
      {sessions !== null && sections.length === 0 && (
        <p className="settings-pi-theme-note">{t("settings.projectsNoneArchived")}</p>
      )}

      {sections.map((section) => (
        <div key={section.id} style={{ marginTop: 12 }}>
          <div className="settings-archived-group-label">{section.label}</div>
          {section.rows.map((project) => renderRow(project, section.id === "archived"))}
        </div>
      ))}
    </section>
  );
}

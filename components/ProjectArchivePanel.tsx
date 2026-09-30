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
 *
 * fork:design-system —— 画板 46 帧「归档历史」上半：`.pw-sec-title`（标题 + 计数徽章）
 * + 每个项目一张 `.pw-detail`（头行 = chevron + folder + 项目名 + 会话数徽章 +
 * 归档时间 + 恢复项目；展开后 `.pw-list` 列会话，行点击即打开）。
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

  return (
    <>
      <div className="pw-sec-title">
        {t("settings.projectsArchived")}
        <span className="pw-grow" aria-hidden="true" />
        <span className="pw-badge count">{archived.length}</span>
      </div>

      {error && (
        <div role="alert" className="pw-alert">
          <span className="pw-ico"><i data-ico="triangle-alert" data-size="14" aria-hidden="true" /></span>
          <span className="grow">{error}</span>
        </div>
      )}
      {sessions === null && <p role="status" className="sub">{t("i18n.loading")}</p>}
      {sessions !== null && archived.length === 0 && (
        <p role="status" className="sub">{t("settings.projectsNoneArchived")}</p>
      )}

      {archived.map((project, index) => {
        const own = sessionsForProject(allSessions, project.key);
        const expanded = openKey === project.key;
        const archivedAt = flags.archivedAt[project.key];
        return (
          <div key={project.key} className="pw-detail" style={index > 0 ? { marginTop: "var(--s2)" } : undefined}>
            <div className="pw-inline">
              <button
                type="button"
                className="pw-inline"
                style={{ minWidth: 0, textAlign: "left" }}
                title={project.root}
                aria-expanded={expanded}
                onClick={() => setOpenKey(expanded ? null : project.key)}
              >
                <span className="pw-ico"><i data-ico={expanded ? "chevron-down" : "chevron-right"} data-size="14" aria-hidden="true" /></span>
                <span className="pw-ico"><i data-ico="folder" data-size="14" aria-hidden="true" /></span>
                <b style={{ fontWeight: 500 }}>{project.root.split(/[/\\]/).filter(Boolean).pop() || project.root}</b>
              </button>
              <span className="pw-badge count">{t("settings.projectsSessionCount", { count: own.length })}</span>
              <span className="pw-grow" aria-hidden="true" />
              {archivedAt && (
                <span className="pw-mono pw-dim">{t("settings.archivedAt", { time: formatRelativeTime(new Date(archivedAt), locale) })}</span>
              )}
              <ConfigButton
                variant="secondary"
                size="small"
                disabled={busyKey === project.key}
                onClick={() => void setArchived(project.key, false)}
              >
                <span className="pw-ico"><i data-ico="archive-restore" data-size="13" aria-hidden="true" /></span>
                {t("settings.projectsRestore")}
              </ConfigButton>
            </div>
            {expanded && (
              <div className="pw-list" style={{ marginTop: "var(--s2)", paddingLeft: "var(--s4)" }}>
                {own.length === 0 && <p role="status" className="sub">{t("settings.projectsNoSessions")}</p>}
                {own
                  .slice()
                  .sort((a, b) => b.modified.localeCompare(a.modified))
                  .slice(0, 20)
                  .map((session) => (
                    <button
                      key={session.id}
                      type="button"
                      className="pw-litem"
                      title={session.id}
                      disabled={!onOpenSession}
                      onClick={() => onOpenSession?.(session.id)}
                    >
                      <span className="pw-ico pw-dim"><i data-ico="message-square" data-size="13" aria-hidden="true" /></span>
                      <span className="grow">
                        <span className="pw-lname">{session.name || session.firstMessage || session.id.slice(0, 8)}</span>
                      </span>
                      <span className="pw-lsub">{formatRelativeTime(new Date(session.modified), locale)}</span>
                    </button>
                  ))}
                {own.length > 20 && (
                  <p role="status" className="sub">{t("settings.projectsMoreSessions", { count: own.length - 20 })}</p>
                )}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

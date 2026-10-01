"use client";

/**
 * fork:project-archive — 设置 → 归档历史（项目 + 会话合页的宿主）。
 *
 * 项目索引 + 就地详情。数据源是 `/api/sessions` 派生出来的项目列表
 * （`lib/project-groups.ts` 的 `getRecentProjects`）——与侧栏用的是**同一个**身份
 * （`workspaceKeyOf` = 服务端算的 `projectKey`），所以「一个归档项目」就是侧栏里的
 * 一行，worktree 也不例外。归档标志本身在 `lib/project-flags.ts`，纯 localStorage。
 *
 * 这个页面**永不删东西**：没有删除按钮、不动 `.jsonl`、不动磁盘目录。归档/恢复与打开
 * 是仅有的几个动作；会话的「彻底删除」住在 ArchivedSessionsPanel.tsx（它的测试把
 * 「这一页对用户数据只读」焊死了）。
 *
 * fork:settings-frame（画板 62，2026-10-01）—— 归档历史从「ProjectArchivePanel +
 * ArchivedSessionsPanel 上下两块」改成**骨架 B（列表 300 + 详情 760）**：
 *
 *   列表列（ConfigSidebar）
 *     .pw-group-title「项目」+ 计数徽章 —— 已归档项目行（folder 图标 + 名称 + 会话数）
 *     <ArchivedSessionsGroup> —— 「会话」分组（组标题带「显示文件已消失」开关，画板 46
 *        的带标签形态）+ 已归档会话行
 *   详情列（ConfigDetail）
 *     选中项目 → 画板 46 项目卡的详情形态：头行（folder + 项目名 + 会话数徽章 +
 *       归档时间 + 恢复项目）+ 展开的会话列表（点行打开会话）
 *     选中会话 → <ArchivedSessionDetail>
 *     未选     → 画板 62 帧 D 的「详情未选」空态（40px 方框图标 + 一句引导）
 *   整页空（两分组都空）→ 画板 62 帧 D 的「整页空」：20px 标题 + 说明 + 一个出口动作
 *
 * 宿主持有**唯一的选中态**（项目行 / 会话行互斥），两处分组都只回调 onSelect。
 *
 * SettingsPanel 已配合迁移：`<SettingsPage title sub fill>` 直挂本组件（旧
 * `div.settings-archive-page` 壳与恒渲染 null 的 ArchivedSessionsPanel 兄弟已删），
 * 两列各自滚由 `.pw-scontent.is-fixed` 出。
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import { useI18n } from "@/hooks/useI18n";
import type { Locale } from "@/lib/i18n/types";
import { formatRelativeTime } from "@/lib/i18n/format";
import { getRecentProjects, sessionsForProject, withoutChatProject, type RecentProject } from "@/lib/project-groups";
import { partitionProjects, useProjectFlags } from "@/lib/project-flags";
import type { SessionInfo } from "@/lib/types";
import { ArchivedSessionDetail, ArchivedSessionsGroup } from "./ArchivedSessionsPanel";
import {
  ConfigBadge,
  ConfigButton,
  ConfigDetail,
  ConfigDetailStack,
  ConfigEmptyState,
  ConfigSidebar,
  ConfigSidebarGroupLabel,
  ConfigSidebarItem,
  ConfigSidebarList,
  ConfigSplitView,
} from "./SettingsUi";

/** 选中态：项目行 / 会话行二选一；null = 详情列出「未选」空态。 */
type ArchiveSelection = { kind: "project"; key: string } | { kind: "session"; id: string } | null;

export function ProjectArchivePanel({
  onOpenSession,
  onSessionsChanged,
  onCloseRequest,
}: {
  onOpenSession?: (id: string) => void;
  onSessionsChanged?: () => void;
  /** 整页空态的出口动作（画板 62 帧 D「去侧栏」）——由设置壳传 onClose。 */
  onCloseRequest?: () => void;
}) {
  const { t, locale } = useI18n();
  const { flags, archive, restore } = useProjectFlags();
  const [sessions, setSessions] = useState<SessionInfo[] | null>(null);
  const [chatProjectKey, setChatProjectKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ArchiveSelection>(null);
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

  // fork:project-archive — 列表列只列**已归档**的。`visible` 仍然算出来是为了
  // 「归档了当前项目之后它还留在列表里」的那条规则，但不再渲染。
  void visible;

  // 选中态有效性：行被恢复 / 删除后选择自动失效，详情列落回「未选」空态。
  const selectedProject = selected?.kind === "project"
    ? archived.find((project) => project.key === selected.key) ?? null
    : null;
  const selectedSessionId = selected?.kind === "session" && flags.archived.includes(selected.id)
    ? selected.id
    : null;
  // 整页空（画板 62 帧 D）：两个分组都没有任何条目。加载中不算空。
  const pageEmpty = sessions !== null && archived.length === 0 && flags.archived.length === 0;

  return (
    <>
      {error && (
        <div role="alert" className="pw-alert">
          <span className="pw-ico"><i data-ico="triangle-alert" data-size="14" aria-hidden="true" /></span>
          <span className="grow">{error}</span>
        </div>
      )}
      {pageEmpty ? (
        <ConfigEmptyState>
          <span className="mark"><i data-ico="archive" data-size="16" aria-hidden="true" /></span>
          <h2>{t("settings.archivedEmpty")}</h2>
          <p>{t("settings.projectsNoneArchived")}</p>
          {onCloseRequest && (
            <ConfigButton variant="secondary" size="small" onClick={onCloseRequest}>
              <span className="pw-ico"><i data-ico="arrow-left" data-size="13" aria-hidden="true" /></span>
              {t("settings.backToWorkspace")}
            </ConfigButton>
          )}
        </ConfigEmptyState>
      ) : (
        <ConfigSplitView>
          <ConfigSidebar>
            {archived.length > 0 ? (
              <>
                <ConfigSidebarGroupLabel>
                  {t("settings.projectsActive")}
                  <span className="pw-grow" aria-hidden="true" />
                  <ConfigBadge tone="count">{archived.length}</ConfigBadge>
                </ConfigSidebarGroupLabel>
                <ConfigSidebarList>
                  {archived.map((project) => {
                    const count = sessionsForProject(allSessions, project.key).length;
                    return (
                      <ConfigSidebarItem
                        key={project.key}
                        active={selectedProject?.key === project.key}
                        title={project.root}
                        onClick={() => setSelected({ kind: "project", key: project.key })}
                      >
                        <span className="pw-ico"><i data-ico="folder" data-size="14" aria-hidden="true" /></span>
                        <span className="grow">
                          <span className="pw-lname">
                            {project.root.split(/[/\\]/).filter(Boolean).pop() || project.root}
                          </span>
                          <span className="pw-lsub">{t("settings.projectsSessionCount", { count })}</span>
                        </span>
                      </ConfigSidebarItem>
                    );
                  })}
                </ConfigSidebarList>
              </>
            ) : (
              sessions !== null && (
                <p role="status" className="sub">{t("settings.projectsNoneArchived")}</p>
              )
            )}
            <ArchivedSessionsGroup
              sessions={allSessions}
              selectedId={selectedSessionId}
              onSelect={(id) => setSelected({ kind: "session", id })}
            />
          </ConfigSidebar>

          <ConfigDetail>
            <ConfigDetailStack>
              {selectedProject ? (
                <ProjectArchiveDetail
                  project={selectedProject}
                  sessions={allSessions}
                  archivedAt={flags.archivedAt[selectedProject.key] ?? null}
                  busy={busyKey === selectedProject.key}
                  locale={locale}
                  t={t}
                  onRestore={() => void setArchived(selectedProject.key, false)}
                  onOpenSession={onOpenSession}
                />
              ) : selectedSessionId ? (
                <ArchivedSessionDetail
                  sessions={allSessions}
                  sessionId={selectedSessionId}
                  onSessionsChanged={onSessionsChanged}
                  onReload={() => void load()}
                />
              ) : (
                <ConfigEmptyState>
                  <span className="mark"><i data-ico="square-mouse-pointer" data-size="16" aria-hidden="true" /></span>
                  <p>{t("settings.archivedDescription")}</p>
                </ConfigEmptyState>
              )}
            </ConfigDetailStack>
          </ConfigDetail>
        </ConfigSplitView>
      )}
    </>
  );
}

/**
 * 选中项目的详情卡（画板 46 项目卡的详情形态）：头行 + 展开的会话列表。
 * 会话行点击即打开（这些会话本身没有被归档，行上不放「恢复」——恢复是项目级的）。
 */
function ProjectArchiveDetail({
  project,
  sessions,
  archivedAt,
  busy,
  locale,
  t,
  onRestore,
  onOpenSession,
}: {
  project: RecentProject;
  sessions: readonly SessionInfo[];
  archivedAt: string | null;
  busy: boolean;
  locale: Locale;
  t: (key: string, params?: Record<string, string | number>) => string;
  onRestore: () => void;
  onOpenSession?: (id: string) => void;
}) {
  const own = sessionsForProject(sessions as SessionInfo[], project.key);
  const recent = own
    .slice()
    .sort((a, b) => b.modified.localeCompare(a.modified))
    .slice(0, 20);

  return (
    <>
      <div className="pw-inline">
        <span className="pw-ico"><i data-ico="folder" data-size="14" aria-hidden="true" /></span>
        <b style={{ fontWeight: 500 }}>
          {project.root.split(/[/\\]/).filter(Boolean).pop() || project.root}
        </b>
        <span className="pw-badge count">{t("settings.projectsSessionCount", { count: own.length })}</span>
        <span className="pw-grow" aria-hidden="true" />
        {archivedAt && (
          <span className="pw-mono pw-dim">
            {t("settings.archivedAt", { time: formatRelativeTime(new Date(archivedAt), locale) })}
          </span>
        )}
        <ConfigButton variant="secondary" size="small" disabled={busy} onClick={onRestore}>
          <span className="pw-ico"><i data-ico="archive-restore" data-size="13" aria-hidden="true" /></span>
          {t("settings.projectsRestore")}
        </ConfigButton>
      </div>
      <div className="pw-list" style={{ paddingLeft: "var(--s4)" }}>
        {own.length === 0 && <p role="status" className="sub">{t("settings.projectsNoSessions")}</p>}
        {recent.map((session) => (
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
    </>
  );
}

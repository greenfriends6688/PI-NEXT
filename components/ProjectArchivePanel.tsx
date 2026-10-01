"use client";

/**
 * fork:project-archive — 设置 → 归档历史（骨架 B 的宿主：一套列表列 + 一套详情列）。
 *
 * 数据源是 `/api/sessions` 派生出来的项目列表（`lib/project-groups.ts` 的
 * `getRecentProjects`）——与侧栏用的是**同一个**身份（`workspaceKeyOf` = 服务端算的
 * `projectKey`），所以「一个归档项目」就是侧栏里的一行，worktree 也不例外。
 *
 * fork:settings-frame（画板 62，2026-10-01）—— 归档历史从「ProjectArchivePanel +
 * ArchivedSessionsPanel 上下两块」改成**骨架 B（列表 300 + 详情 760）**：
 *
 *   列表列（300，`.pw-cols > :first-child` 自己滚）
 *     「项目」分组   —— 已归档项目行：folder + 名称 + 会话数（会话数**只在这里**出现）
 *     「会话」分组   —— 组标题带「显示文件已消失」开关（画板 46 的带标签形态）
 *                       + 计数徽章；行 = 会话名 + 归档时间
 *   详情列（760，`.pw-detail` 自己滚）
 *     选中项目 → 画板 46 项目卡的详情形态：头行（folder + 项目名 + 归档时间 + 恢复项目）
 *                 + 画板 46 原样的会话子列表（缩进 + 点行打开会话）
 *     选中会话 → <ArchivedSessionDetail>
 *     未选     → 画板 62 帧 D 的「详情未选」空态（40px 方框图标 + 一句引导）
 *   整页空（两个分组都空）→ 画板 62 帧 D 的「整页空」：20px 标题 + 说明 + 一个出口动作
 *
 * 宿主持有**唯一的选中态**（项目行 / 会话行互斥），两处分组都只回调 onSelect。
 * SettingsPanel 直挂本组件（`<SettingsPage title sub fill>`），恒渲染 null 的
 * ArchivedSessionsPanel 旧壳已删。
 *
 * fix:archive-selection-scope —— **两种归档是两张表**，别把它们混着读：
 *   `useProjectFlags()` 的 `archived` 里装的是 **projectKey**，
 *   `useSessionFlags()` 的 `archived` 里装的是 **session id**。
 *   原来整页空判定与「选中会话」校验都去问项目表，于是：只归档过会话的用户打开本页
 *   看到的是「还没有归档任何会话。」（会话明明还在 localStorage 里，只是被项目表
 *   判成空），点会话行也永远打不开它的恢复 / 彻底删除卡。
 *
 * 这个页面**永不删东西**：没有删除按钮、不动 `.jsonl`、不动磁盘目录。归档/恢复与打开
 * 是仅有的几个动作；会话的「彻底删除」住在 ArchivedSessionsPanel.tsx（它的测试把
 * 「这一页对用户数据只读」焊死了）。
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import { useI18n } from "@/hooks/useI18n";
import type { Locale } from "@/lib/i18n/types";
import { formatRelativeTime } from "@/lib/i18n/format";
import { getRecentProjects, sessionsForProject, withoutChatProject, type RecentProject } from "@/lib/project-groups";
import { partitionProjects, useProjectFlags } from "@/lib/project-flags";
import { useSessionFlags } from "@/lib/session-flags";
import type { SessionInfo } from "@/lib/types";
import { ArchivedSessionDetail, ArchivedSessionsGroup } from "./ArchivedSessionsPanel";
import {
  ConfigBadge,
  ConfigButton,
  ConfigDetail,
  ConfigDetailHeader,
  ConfigDetailStack,
  ConfigDetailTitle,
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
  // 项目归档在项目表，会话归档在会话表。列表列的两组分别读自己那张。
  const { flags: projectFlags, archive, restore } = useProjectFlags();
  const { flags: sessionFlags } = useSessionFlags();
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
  // 列表列只列**已归档**的项目（`visible` 那半边是侧栏的事，这里不渲染）。
  const archivedProjects = useMemo(
    () => partitionProjects(projects, projectFlags).archived,
    [projects, projectFlags],
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

  // 选中态有效性：行被恢复 / 删除后选择自动失效，详情列落回「未选」空态。
  const selectedProject = selected?.kind === "project"
    ? archivedProjects.find((project) => project.key === selected.key) ?? null
    : null;
  // 会话 id 要问**会话表**（fix:archive-selection-scope）。
  const selectedSessionId = selected?.kind === "session" && sessionFlags.archived.includes(selected.id)
    ? selected.id
    : null;
  // 整页空（画板 62 帧 D）：两个分组都没有任何条目 —— 项目组与会话组各查各的表。
  const pageEmpty = sessions !== null && archivedProjects.length === 0 && sessionFlags.archived.length === 0;

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
          {/* 画板 62 帧 D「整页空」：20px 标题（`.pw-empty-inner h2`）+ 说明 + 一个出口动作。
              标题用 archivedEmptyTitle（画板 62:411 的「还没有归档」），说明落在正文行。 */}
          <h2>{t("settings.archivedEmptyTitle")}</h2>
          <p>{t("settings.projectsNoneArchived")}</p>
          {onCloseRequest && (
            <ConfigButton variant="secondary" size="small" onClick={onCloseRequest}>
              <span className="pw-ico"><i data-ico="arrow-left" data-size="13" aria-hidden="true" /></span>
              {t("settings.backToWorkspace")}
            </ConfigButton>
          )}
          {/* fix:archive-local-only —— 标志只在本机 localStorage（不动 `.jsonl` 是硬规矩）。
              「我明明归档过」的第一嫌疑就是这里，所以代价写在空态本体里，不飘到别处。 */}
          <p className="pw-hint">{t("settings.archiveStoredLocally")}</p>
        </ConfigEmptyState>
      ) : (
        <ConfigSplitView>
          <ConfigSidebar>
            {sessions === null ? (
              <div role="status" className="pw-inline">
                <span className="pw-ico"><i data-ico="loader-circle" data-size="14" className="pw-anim-spin" aria-hidden="true" /></span>
                <span className="grow">{t("i18n.loading")}</span>
              </div>
            ) : (
              <>
                <ConfigSidebarGroupLabel>
                  {t("settings.projectsActive")}
                  <span className="pw-grow" aria-hidden="true" />
                  <ConfigBadge tone="count">{archivedProjects.length}</ConfigBadge>
                </ConfigSidebarGroupLabel>
                {archivedProjects.length === 0 ? (
                  /* 空的项目组也要有落点（画板 62 帧 D 的列表空态形态），不能静默留白。 */
                  <ConfigEmptyState>
                    <span className="mark"><i data-ico="folder" data-size="16" aria-hidden="true" /></span>
                    <p>{t("settings.projectsNoneArchived")}</p>
                  </ConfigEmptyState>
                ) : (
                  <ConfigSidebarList>
                    {archivedProjects.map((project) => (
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
                          {/* 会话数只在这里出现一次 —— 详情列不再复述（画板 62 骨架 B）。 */}
                          <span className="pw-lsub">{t("settings.projectsSessionCount", {
                            count: sessionsForProject(allSessions, project.key).length,
                          })}</span>
                        </span>
                      </ConfigSidebarItem>
                    ))}
                  </ConfigSidebarList>
                )}
                <ArchivedSessionsGroup
                  sessions={allSessions}
                  selectedId={selectedSessionId}
                  onSelect={(id) => setSelected({ kind: "session", id })}
                />
              </>
            )}
          </ConfigSidebar>

          <ConfigDetail>
            <ConfigDetailStack>
              {selectedProject ? (
                <ProjectArchiveDetail
                  project={selectedProject}
                  sessions={allSessions}
                  archivedAt={projectFlags.archivedAt[selectedProject.key] ?? null}
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
 * 选中项目的详情卡（画板 46 项目卡的详情形态）：头行 + 画板 46 原样的会话子列表。
 *
 * 头行里**没有**会话数徽章 —— 左列那行已经写了（画板 62 骨架 B 的列表列 300 宽，
 * 「N 个对话」放在行副标题里正好；详情列要补的是行里没有的：归档时间 + 恢复动作）。
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
      <ConfigDetailHeader>
        <span className="pw-ico"><i data-ico="folder" data-size="14" aria-hidden="true" /></span>
        <ConfigDetailTitle>{project.root.split(/[/\\]/).filter(Boolean).pop() || project.root}</ConfigDetailTitle>
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
      </ConfigDetailHeader>
      {/* 画板 46 的项目卡：子列表缩进一级（`margin-top`/`padding-left` 两个 token，
          照抄画板那一行，不新增几何值）。 */}
      <div className="pw-list" style={{ marginTop: "var(--s2)", paddingLeft: "var(--s4)" }}>
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

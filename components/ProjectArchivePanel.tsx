"use client";

/**
 * fork:project-archive — 设置 → 归档：**画板 D-21 帧 A**（`design/v5/web/boards/D-21-settings-archive-import.html`）。
 *
 * fork:v5-landing-frame · D-21（2026-10-06）—— 这一页原本是 v1 画板 62 的**骨架 B**
 * （列表列 220 + 详情卡两栏），v5 的 D-21 已经把归档画成**一列分节**：
 *
 *   d-set-inner
 *     ├ d-banner                      「归档不是删除」—— 标志位，不是删文件
 *     ├ d-set-sec「归档会话」
 *     │   └ d-card 归档历史（卡头带计数 / 「显示已消失」开关 / 全部恢复）
 *     │       └ d-card-body：批量条（**只在有选中时出现**）+ 项目组 d-group-toggle
 *     │         + 会话行 d-sess（带 d-checkbox）+ 一段脚注
 *     │   └ d-card 已归档的项目        ← D-21 没有这张卡，见下方登记
 *     └ d-set-sec「两种『列不出来』要分开说」
 *         └ d-grid2：两张 d-card，各自一张 d-empty（ico / t / s + 一个出口按钮）
 *
 * 三处**照抄画板、不是设计新意**的判定：
 *   · 批量条**只在有选中时渲染**，一条都没选时整条不出现（不是灰着摆在那儿）；
 *   · 「永久删除」永远二次确认，浮层标题写清对象（选中的 N 条）；
 *   · 两种空态**各给各的出口**：没归档过教你去归档，文件没了给「显示这 N 条」。
 *
 * 已登记偏离（一处）：D-21 只画了**会话**归档，本产品另有一张**项目**归档表
 * （`lib/project-flags.ts`，projectKey 口径）。侧栏归档后只把项目行藏起来，
 * 没有别的恢复入口，所以那张卡必须留着 —— 形态是 D-21 的 `.d-card` + `.d-sess`
 * 行，行尾一枚恢复动作。这是**多出来的一张卡**，不改 D-21 画出来的任何一块。
 *
 * D-21 帧 A 那张「设置卡」（运行中的会话不允许归档 / 超过多久自动归档）是
 * **产品没有的两个开关**（`grep 自动归档` 全仓零命中）。要它们得先有设置项与
 * 落盘路径，本轮不凭空造。
 *
 * 手机（M-05）只有 hub 一行「归档」，没有分节页画板，所以窄屏那一支沿用原样。
 */

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useIsMobile } from "@/hooks/useIsMobile";
import { useI18n } from "@/hooks/useI18n";
import { PwaBanner, PwaSetRow } from "@/components/pwa/PwaPage";
import { PwaSheet } from "@/components/pwa/PwaSheet";
import { PortalDropdown } from "@/components/PortalDropdown";
import { formatRelativeTime } from "@/lib/i18n/format";
import { getRecentProjects, sessionsForProject, withoutChatProject } from "@/lib/project-groups";
import { partitionProjects, useProjectFlags } from "@/lib/project-flags";
import { useSessionFlags } from "@/lib/session-flags";
import type { SessionInfo } from "@/lib/types";
import {
  ArchivedSessionDetail,
  ArchivedSessionsGroup,
  deriveArchivedRows,
  type ArchivedRow,
} from "./ArchivedSessionsPanel";

export function ProjectArchivePanel({
  onOpenSession,
  onSessionsChanged,
  onCloseRequest,
}: {
  onOpenSession?: (id: string) => void;
  onSessionsChanged?: () => void;
  /** 「去侧栏看看」—— 关掉设置回到侧栏（画板 D-21 帧 A 两张空态卡的出口）。 */
  onCloseRequest?: () => void;
}) {
  const { t, locale } = useI18n();
  const mobile = useIsMobile();
  // 项目归档在项目表，会话归档在会话表。两张表各读各的（fix:archive-selection-scope）。
  const { flags: projectFlags, archive, restore } = useProjectFlags();
  const { flags: sessionFlags, archive: archiveSession } = useSessionFlags();
  const [sessions, setSessions] = useState<SessionInfo[] | null>(null);
  const [chatProjectKey, setChatProjectKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  // 窄屏那一支的选中态（项目行 / 会话行互斥，详情落在 `.m-sheet` 里）。
  const [selected, setSelected] = useState<{ kind: "project"; key: string } | { kind: "session"; id: string } | null>(null);
  // D-21 帧 A 的三个桌面态：「显示已消失」开关 / 勾选集 / 永久删除的确认浮层。
  const [showMissing, setShowMissing] = useState(false);
  const [pickedIds, setPickedIds] = useState<string[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // 「永久删除」浮层的定位宿主：`.d-set-main` 是 overflow-y:auto，画板那种
  // `position:absolute` 的 `.d-pop` 挂在这里会被它整个裁掉（LANDING §4 第一条陷阱），
  // 所以走共享的 portal + fixed 下拉（与自动化面板的行菜单同一套）。
  const deleteAnchorRef = useRef<HTMLDivElement | null>(null);

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
  // 列表只列**已归档**的项目（`visible` 那半边是侧栏的事，这里不渲染）。
  const archivedProjects = useMemo(
    () => partitionProjects(projects, projectFlags).archived,
    [projects, projectFlags],
  );

  // ── 会话行（画板帧 A 的两条：可见行 / 缺文件行）────────────────────────
  const rows = useMemo(
    () => deriveArchivedRows(
      sessionFlags.archived,
      sessionFlags.archivedAt,
      allSessions,
      t("settings.archivedMissingProject"),
    ),
    [sessionFlags.archived, sessionFlags.archivedAt, allSessions, t],
  );
  const missingCount = rows.filter((row) => !row.live).length;
  // 窄屏选中态的有效性：行被恢复 / 删除后自动失效，详情面板落回关闭。
  const selectedProject = selected?.kind === "project"
    ? archivedProjects.find((project) => project.key === selected.key) ?? null
    : null;
  const selectedSessionId = selected?.kind === "session" && sessionFlags.archived.includes(selected.id)
    ? selected.id
    : null;
  // 开关关着时缺文件的那几条不列 —— 默认隐藏，画板帧 A 的卡头开关就是出口。
  const visibleRows = showMissing ? rows : rows.filter((row) => row.live);
  /** 选区只认**当前列出来的**行：被恢复 / 文件消失后勾选自动失效。 */
  const selectedRows = visibleRows.filter((row) => pickedIds.includes(row.id));
  /** 文件还在的选中行 —— 恢复只对它们有意义（画板：缺文件行只有「清理标记」）。 */
  const restorableRows = selectedRows.filter((row) => row.live);
  /** 项目分组：`d-group-toggle` 就是一组会话的组标题（画板帧 A 的 PI NEXT 那一行）。 */
  const groups = useMemo(() => {
    const byProject = new Map<string, ArchivedRow[]>();
    for (const row of visibleRows) {
      const bucket = byProject.get(row.projectLabel);
      if (bucket) bucket.push(row);
      else byProject.set(row.projectLabel, [row]);
    }
    return [...byProject.entries()];
  }, [visibleRows]);

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

  const toggleRow = useCallback((id: string) => {
    setPickedIds((current) => current.includes(id)
      ? current.filter((item) => item !== id)
      : [...current, id]);
  }, []);

  const toggleGroup = useCallback((ids: string[]) => {
    setPickedIds((current) => {
      const all = ids.every((id) => current.includes(id));
      return all ? current.filter((id) => !ids.includes(id)) : [...new Set([...current, ...ids])];
    });
  }, []);

  /** 恢复 = 取消归档（`archiveSession` 是 toggle，勾着的 id 调一次就是取消）。 */
  const restoreIds = useCallback((ids: string[]) => {
    for (const id of ids) {
      if (sessionFlags.archived.includes(id)) archiveSession(id);
    }
    setPickedIds((current) => current.filter((id) => !ids.includes(id)));
    setConfirmDelete(false);
    onSessionsChanged?.();
  }, [archiveSession, sessionFlags.archived, onSessionsChanged]);

  /** 永久删除：删文件 + 清标志位。二次确认之后才走到这里（画板帧 A 的浮层）。 */
  const deleteRows = useCallback(async (targets: readonly ArchivedRow[]) => {
    setDeleting(true);
    try {
      for (const row of targets) {
        if (!row.live) continue; // 文件早就不在的只剩标志位，下面统一清
        const res = await fetch(`/api/sessions/${encodeURIComponent(row.id)}`, { method: "DELETE" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      }
      for (const row of targets) {
        if (sessionFlags.archived.includes(row.id)) archiveSession(row.id);
      }
      setPickedIds([]);
      setConfirmDelete(false);
      await load();
      onSessionsChanged?.();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      setConfirmDelete(false);
    } finally {
      setDeleting(false);
    }
  }, [archiveSession, sessionFlags.archived, load, onSessionsChanged]);

  // 窄屏（M-05 只画了 hub 一行「归档」，没有分节页画板）—— 这一支**原样保留**：
  // 两列骨架塌成**一列列表 + 底部面板**，点哪条就在 `.m-sheet` 里看详情。
  // 两个归档态（勾选 / 永久删除浮层）是画板帧 A 桌面那一支的接线，手机不共用。
  const pageEmpty = sessions !== null && archivedProjects.length === 0 && rows.length === 0;

  if (mobile) {
    return (
      <>
        {error && <PwaBanner icon="triangle-alert" tone="err" role="alert">{error}</PwaBanner>}
        {pageEmpty ? (
          <div className="m-empty">
            <span className="m-empty-ico"><i data-ico="archive" data-size="20" aria-hidden="true" /></span>
            <span className="m-empty-t">{t("settings.archivedEmptyTitle")}</span>
            <span className="m-empty-s">{t("settings.projectsNoneArchived")}</span>
            {onCloseRequest && (
              <button type="button" className="m-btn" onClick={onCloseRequest}>
                <i data-ico="arrow-left" data-size="13" aria-hidden="true" />
                {t("settings.backToWorkspace")}
              </button>
            )}
            <span className="m-t-xs m-t-faint">{t("settings.archiveStoredLocally")}</span>
          </div>
        ) : (
          <>
            <div className="m-cardgroup">
              <div className="m-setrow">
                <i data-ico="folder" data-size="16" aria-hidden="true" />
                <span className="m-setrow-body">
                  <span className="m-setrow-t">{t("settings.projectsActive")}</span>
                </span>
                <span className="m-badge mute">{archivedProjects.length}</span>
              </div>
              {archivedProjects.length === 0 ? (
                <PwaSetRow label={t("settings.projectsNoneArchived")} />
              ) : (
                archivedProjects.map((project) => (
                  <button
                    key={project.key}
                    type="button"
                    className="m-setrow"
                    onClick={() => setSelected({ kind: "project", key: project.key })}
                  >
                    <i data-ico="folder" data-size="16" aria-hidden="true" />
                    <span className="m-setrow-body">
                      <span className="m-setrow-t">
                        {project.root.split(/[/\\]/).filter(Boolean).pop() || project.root}
                      </span>
                      <span className="m-setrow-s">
                        {t("settings.projectsSessionCount", {
                          count: sessionsForProject(allSessions, project.key).length,
                        })}
                      </span>
                    </span>
                    <i data-ico="chevron-right" data-size="15" aria-hidden="true" />
                  </button>
                ))
              )}
            </div>

            {sessions === null ? (
              <div role="status" className="m-run">
                <i data-ico="loader-circle" data-size="14" aria-hidden="true" />
                <span className="m-grow">{t("i18n.loading")}</span>
              </div>
            ) : (
              <ArchivedSessionsGroup
                sessions={allSessions}
                selectedId={selectedSessionId}
                onSelect={(id) => setSelected({ kind: "session", id })}
              />
            )}

            <PwaSheet
              open={Boolean(selectedProject || selectedSessionId)}
              title={selectedProject
                ? (selectedProject.root.split(/[/\\]/).filter(Boolean).pop() || selectedProject.root)
                : t("settings.archivedSessionsLabel")}
              onClose={() => setSelected(null)}
              footer={
                <>
                  <button type="button" className="m-picktag" onClick={() => setSelected(null)}>
                    {t("i18n.close")}
                  </button>
                  {selectedProject && (
                    <button
                      type="button"
                      className="m-picktag is-on"
                      disabled={busyKey === selectedProject.key}
                      onClick={() => void setArchived(selectedProject.key, false)}
                    >
                      <i data-ico="archive-restore" data-size="13" aria-hidden="true" />
                      {t("settings.projectsRestore")}
                    </button>
                  )}
                </>
              }
            >
              {selectedProject && (
                <>
                  <div className="m-cardgroup">
                    <PwaSetRow
                      icon="folder"
                      label={selectedProject.root.split(/[/\\]/).filter(Boolean).pop() || selectedProject.root}
                      sub={projectFlags.archivedAt[selectedProject.key]
                        ? t("settings.archivedAt", {
                          time: formatRelativeTime(new Date(projectFlags.archivedAt[selectedProject.key]!), locale),
                        })
                        : undefined}
                    />
                  </div>
                  <div className="m-cardgroup">
                    {sessionsForProject(allSessions, selectedProject.key)
                      .slice()
                      .sort((a, b) => b.modified.localeCompare(a.modified))
                      .slice(0, 20)
                      .map((session) => (
                        <button
                          key={session.id}
                          type="button"
                          className="m-setrow"
                          disabled={!onOpenSession}
                          onClick={() => onOpenSession?.(session.id)}
                        >
                          <i data-ico="message-square" data-size="16" aria-hidden="true" />
                          <span className="m-setrow-body">
                            <span className="m-setrow-t">
                              {session.name || session.firstMessage || session.id.slice(0, 8)}
                            </span>
                            <span className="m-setrow-s">{formatRelativeTime(new Date(session.modified), locale)}</span>
                          </span>
                        </button>
                      ))}
                  </div>
                </>
              )}
              {selectedSessionId && (
                <ArchivedSessionDetail
                  sessions={allSessions}
                  sessionId={selectedSessionId}
                  onSessionsChanged={onSessionsChanged}
                  onReload={() => void load()}
                />
              )}
            </PwaSheet>
          </>
        )}
      </>
    );
  }

  // ── 桌面：画板 D-21 帧 A ────────────────────────────────────────────────
  const bulkBar = selectedRows.length > 0;
  const showNeverArchived = rows.length === 0;
  const showMissingOnly = rows.length > 0 && missingCount > 0 && !showMissing;
  // 画板那张网格是两个空态并排；实际只会有一个成立，单卡时占满整行。
  const emptyCards = [showNeverArchived, showMissingOnly].filter(Boolean).length;

  return (
    <div className="d-set-inner">
      {error && (
        <div role="alert" className="d-banner err">
          <i data-ico="triangle-alert" data-size="14" aria-hidden="true" />
          <span className="d-grow">{error}</span>
        </div>
      )}
      {/* 「归档不是删除」—— 标志位与删文件是两件事，写在整页最上面。 */}
        <div className="d-banner">
          <i data-ico="info" data-size="14" aria-hidden="true" />
          <span>
            <b>{t("settings.archiveNotDeleteTitle")}</b>
            {t("settings.archiveNotDeleteBody")}
          </span>
        </div>

        <div className="d-set-sec">
          <div className="d-set-sec-t">{t("settings.archiveSessionSection")}</div>

          <div className="d-card">
            <div className="d-card-head">
              <i data-ico="archive" data-size="15" aria-hidden="true" />
              <span>{t("settings.archiveHistoryTitle")}</span>
              <span className="d-badge mute">{t("settings.archiveCount", { count: rows.length })}</span>
              <span className="d-grow" aria-hidden="true" />
              {missingCount > 0 && (
                <>
                  <span className="d-t-xs d-t-faint">
                    {t("settings.archivedShowMissing", { count: missingCount })}
                  </span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={showMissing}
                    aria-label={t("settings.archivedShowMissing", { count: missingCount })}
                    title={t("settings.archivedShowMissing", { count: missingCount })}
                    className={`d-switch${showMissing ? " on" : ""}`}
                    onClick={() => setShowMissing((current) => !current)}
                  />
                </>
              )}
              <button
                type="button"
                className="d-btn sm ghost"
                disabled={rows.length === 0}
                onClick={() => restoreIds(visibleRows.map((row) => row.id))}
              >
                <i data-ico="archive-restore" data-size="13" aria-hidden="true" />
                {t("settings.archiveRestoreAll")}
              </button>
            </div>

            <div className="d-card-body d-col" style={{ gap: "var(--nx-sp-3)" }}>
              {/* 批量条：只在有选中时出现（D-21 的判定，不是灰着摆在那儿）。 */}
              {bulkBar && (
                <div className="d-banner">
                  <i data-ico="check-check" data-size="14" aria-hidden="true" />
                  <span>{t("import.selectedOf", { selected: selectedRows.length, total: visibleRows.length })}</span>
                  <span className="d-grow" aria-hidden="true" />
                  <button
                    type="button"
                    className="d-btn sm ghost"
                    onClick={() => setPickedIds(visibleRows.map((row) => row.id))}
                  >
                    {t("import.selectAll")}
                  </button>
                  <button type="button" className="d-btn sm ghost" onClick={() => setPickedIds([])}>
                    {t("import.clearSelection")}
                  </button>
                  <button
                    type="button"
                    className="d-btn sm"
                    disabled={restorableRows.length === 0}
                    onClick={() => restoreIds(restorableRows.map((row) => row.id))}
                  >
                    <i data-ico="archive-restore" data-size="13" aria-hidden="true" />
                    {t("settings.archivedRestore")}
                  </button>
                  <div className="d-anchor" ref={deleteAnchorRef}>
                    <button
                      type="button"
                      className="d-btn sm danger"
                      onClick={() => setConfirmDelete((current) => !current)}
                    >
                      <i data-ico="trash-2" data-size="13" aria-hidden="true" />
                      {t("settings.archiveDeleteForever")}
                    </button>
                  </div>
                  <PortalDropdown
                    open={confirmDelete}
                    anchorRef={deleteAnchorRef}
                    className="d-pop-float"
                    width={340}
                    align="right"
                  >
                    <div className="d-pop-title">
                      {t("settings.archiveDeleteConfirmTitle", { count: selectedRows.length })}
                    </div>
                    <div className="d-pop-body d-col" style={{ gap: "var(--nx-sp-2)" }}>
                      <div className="d-t-xs">{t("settings.archiveDeleteConfirmBody")}</div>
                      <div className="d-banner err">
                        <i data-ico="triangle-alert" data-size="14" aria-hidden="true" />
                        <span>{t("settings.archiveDeleteConfirmWarn")}</span>
                      </div>
                    </div>
                    <div className="d-sep" />
                    <div className="d-row" style={{ padding: "0 var(--nx-sp-3) var(--nx-sp-2)" }}>
                      <span className="d-grow" aria-hidden="true" />
                      <button type="button" className="d-btn ghost" onClick={() => setConfirmDelete(false)}>
                        <i data-ico="x" data-size="13" aria-hidden="true" />
                        {t("i18n.cancel")}
                      </button>
                      <button
                        type="button"
                        className="d-btn danger"
                        disabled={deleting}
                        onClick={() => void deleteRows(selectedRows)}
                      >
                        <i data-ico="trash-2" data-size="13" aria-hidden="true" />
                        {t("settings.archiveDeleteConfirm")}
                      </button>
                    </div>
                  </PortalDropdown>
                </div>
              )}

              {sessions === null ? (
                <div role="status" className="d-run">
                  <i data-ico="loader-circle" data-size="14" aria-hidden="true" />
                  <span className="d-grow">{t("i18n.loading")}</span>
                </div>
              ) : groups.length === 0 ? null : (
                <>
                  {groups.map(([label, groupRows]) => {
                    const groupIds = groupRows.map((row) => row.id);
                    const picked = groupIds.filter((id) => pickedIds.includes(id)).length;
                    const state = picked === 0 ? "off" : picked === groupIds.length ? "on" : "half";
                    return (
                      <Fragment key={label}>
                        <div className="d-group-toggle">
                          <span
                            role="checkbox"
                            aria-checked={state === "half" ? "mixed" : state === "on"}
                            className={`d-checkbox${state === "off" ? "" : ` ${state}`}`}
                            onClick={() => toggleGroup(groupIds)}
                          >
                            <i data-ico={state === "half" ? "minus" : "check"} data-size="11" aria-hidden="true" />
                          </span>
                          <span className="d-t-sm d-t-b">{label}</span>
                          <span className="d-badge mute">
                            {t("import.selectedOf", { selected: picked, total: groupIds.length })}
                          </span>
                        </div>
                        <div className="d-col">
                          {groupRows.map((row) => {
                            const on = pickedIds.includes(row.id);
                            const when = row.archivedAt
                              ? formatRelativeTime(new Date(row.archivedAt), locale)
                              : t("settings.archivedAtUnknown");
                            // 缺文件的行没有项目可写（`projectLabel` 就是「文件已不存在」），
                            // 副行只留时间，不把同一句话写两遍。
                            const meta = row.live
                              ? `${row.projectLabel} · ${when} · ${t("sidebar.messageCount", { count: row.messageCount })}`
                              : t("settings.archivedMissingProject");
                            return (
                              <button
                                key={row.id}
                                type="button"
                                className="d-sess"
                                title={row.id}
                                onClick={() => toggleRow(row.id)}
                              >
                                <span role="checkbox" aria-checked={on} className={`d-checkbox${on ? " on" : ""}`}>
                                  <i data-ico="check" data-size="11" aria-hidden="true" />
                                </span>
                                <span className="d-sess-t">{row.title}</span>
                                <span className="d-sess-m">
                                  <i data-ico={row.live ? "message-square" : "triangle-alert"} data-size="12" aria-hidden="true" />
                                  {meta}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </Fragment>
                    );
                  })}
                </>
              )}

              <div className="d-t-xs d-t-faint">{t("settings.archiveListNote")}</div>
            </div>
          </div>

          {/* 已登记偏离：D-21 只画了会话归档，产品另有一张项目归档表（见文件头）。 */}
          {archivedProjects.length > 0 && (
            <div className="d-card">
              <div className="d-card-head">
                <i data-ico="folder" data-size="15" aria-hidden="true" />
                <span>{t("settings.projectsTitle")}</span>
                <span className="d-badge mute">{archivedProjects.length}</span>
              </div>
              <div className="d-card-body d-col">
                {archivedProjects.map((project) => (
                  <div key={project.key} className="d-sess">
                    <span className="d-row">
                      <i data-ico="folder" data-size="13" aria-hidden="true" />
                      <span className="d-grow">
                        <span className="d-sess-t">
                          {project.root.split(/[/\\]/).filter(Boolean).pop() || project.root}
                        </span>
                        <span className="d-sess-m">
                          {projectFlags.archivedAt[project.key]
                            ? formatRelativeTime(new Date(projectFlags.archivedAt[project.key]!), locale)
                            : t("settings.archivedAtUnknown")}
                        </span>
                      </span>
                      <button
                        type="button"
                        className="d-btn sm ghost"
                        disabled={busyKey === project.key}
                        onClick={() => void setArchived(project.key, false)}
                      >
                        <i data-ico="archive-restore" data-size="13" aria-hidden="true" />
                        {t("settings.projectsRestore")}
                      </button>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 两种「列不出来」各给各的出口：合成一句「暂无数据」，两边用户都无处可去。 */}
        {(showNeverArchived || showMissingOnly) && (
          <div className="d-set-sec">
            <div className="d-set-sec-t">{t("settings.archiveEmptyStatesTitle")}</div>
            <div
              className="d-grid2"
              style={emptyCards === 1 ? { gridTemplateColumns: "1fr" } : undefined}
            >
              {showNeverArchived && (
                <div className="d-card">
                  <div className="d-card-body">
                    <div className="d-empty">
                      <div className="d-empty-ico">
                        <i data-ico="archive" data-size="20" aria-hidden="true" />
                      </div>
                      <div className="d-empty-t">{t("settings.archiveNeverTitle")}</div>
                      <div className="d-empty-s">{t("settings.archiveNeverBody")}</div>
                      {onCloseRequest && (
                        <button type="button" className="d-btn sm" onClick={onCloseRequest}>
                          {t("settings.archiveGoSidebar")}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}
              {showMissingOnly && (
                <div className="d-card">
                  <div className="d-card-body">
                    <div className="d-empty">
                      <div className="d-empty-ico">
                        <i data-ico="triangle-alert" data-size="20" aria-hidden="true" />
                      </div>
                      <div className="d-empty-t">{t("settings.archiveMissingTitle")}</div>
                      <div className="d-empty-s">
                        {t("settings.archiveMissingBody", { count: missingCount })}
                      </div>
                      <button type="button" className="d-btn sm" onClick={() => setShowMissing(true)}>
                        <i data-ico="eye" data-size="13" aria-hidden="true" />
                        {t("settings.archiveShowMissingBtn", { count: missingCount })}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
            <div className="d-t-xs d-t-faint">{t("settings.archiveEmptyNote")}</div>
          </div>
        )}
    </div>
  );
}
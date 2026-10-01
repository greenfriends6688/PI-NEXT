"use client";

/**
 * fork:ui-archive-history — 会话归档：数据、动作与（画板 62 骨架 B 的）列表 / 详情内容。
 *
 * 之前归档是**单向**的：行从项目列表里消失，落到项目底部的折叠区；折叠区又藏在长列表
 * 最下面，等于「归档后找不回来」。Zeno 的做法是把归档做成设置里的一个数据页：按项目
 * 分组列出所有已归档会话，每条都能「恢复」或「彻底删除」。
 *
 *   - 数据源是 `lib/session-flags.ts` 的 `archived` + `archivedAt`（本地、跨标签页同步）；
 *   - 会话标题 / 项目从 `/api/sessions` 取；文件已经不在的归档项照样列出来（按 id 显示）；
 *   - 「恢复」= 取消归档（行回到项目列表）；「删除」= 删掉会话文件（二次确认）。
 *
 * fork:settings-frame（画板 62，2026-10-01）—— 归档历史整页改骨架 B（列表 300 + 详情
 * 760），「项目」「会话」两个分组同住**一个列表列**，详情列显示选中条目。画板 46 帧
 * 「归档历史」的两块（项目卡片在上、会话卡片在下）因此由 ProjectArchivePanel 合页承载：
 *
 *   - `<ArchivedSessionsGroup>`  渲染「会话」分组的组标题（含「显示文件已消失」开关，
 *     画板 46 的带标签形态）与行；由宿主放进列表列；
 *   - `<ArchivedSessionDetail>`  渲染选中会话的详情卡（恢复 / 彻底删除收在详情头右端）；
 *     由宿主放进详情列；
 *   - `<ArchivedSessionsPanel>`  **旧的两段式入口，现在恒渲染 null**：会话内容全部由
 *     宿主承载，这里再渲染一份就是重复。它继续存在只是为了让 SettingsPanel 里
 *     `<ProjectArchivePanel/> <ArchivedSessionsPanel/>` 的旧组合不至于渲染出两份——
 *     SettingsPanel 侧的清理（去掉这个兄弟节点 + div.settings-archive-page + 补 fill）
 *     见交付报告；清掉后这个壳可以整个删除。
 *
 * 会话的**删除**动作只住在这个文件里：ProjectArchivePanel 是项目索引，对用户数据只读
 * （那里的测试把这条焊死了）。
 */

import { useMemo, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useSessionFlags } from "@/lib/session-flags";
import { formatRelativeTime } from "@/lib/i18n/format";
import type { SessionInfo } from "@/lib/types";
import {
  ConfigBadge,
  ConfigButton,
  ConfigSidebarGroupLabel,
  ConfigSidebarItem,
  ConfigSidebarList,
  ConfigSwitch,
} from "./SettingsUi";

export interface ArchivedRow {
  id: string;
  title: string;
  projectLabel: string;
  archivedAt: string | null;
  /** 文件还在（能打开、能删）。 */
  live: boolean;
}

function projectLabelOf(session: SessionInfo): string {
  const root = session.projectRoot || session.cwd || "";
  const parts = root.split(/[/\\]/).filter(Boolean);
  return parts.at(-1) ?? root;
}

/** 纯函数：归档标志 × 会话索引 → 详情 / 列表都要用的行。新的在前。 */
export function deriveArchivedRows(
  archived: readonly string[],
  archivedAt: Record<string, string>,
  sessions: readonly SessionInfo[] | null,
  missingProjectLabel: string,
): ArchivedRow[] {
  const byId = new Map((sessions ?? []).map((session) => [session.id, session]));
  const list = archived.map((id) => {
    const session = byId.get(id);
    return {
      id,
      title: session?.name || session?.firstMessage?.slice(0, 80) || id,
      projectLabel: session ? projectLabelOf(session) : missingProjectLabel,
      archivedAt: archivedAt[id] ?? null,
      live: Boolean(session),
    };
  });
  // 新的在前；没有时间戳的老条目排在最后（保持它们在 id 列表里的相对顺序）。
  return list.sort((a, b) => (b.archivedAt ?? "").localeCompare(a.archivedAt ?? ""));
}

/**
 * 「会话」分组：组标题（画板 46 的带标签形态——文字标签 + 计数徽章 +
 * 「显示文件已消失」开关）+ 列表行。消失的会话用 triangle-alert 图标 + 0.6
 * 透明度，画板 46 原样；默认隐藏，开关显式打开。
 */
export function ArchivedSessionsGroup({
  sessions,
  selectedId,
  onSelect,
}: {
  sessions: readonly SessionInfo[] | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const { t, locale } = useI18n();
  const { flags } = useSessionFlags();
  const [showDeleted, setShowDeleted] = useState(false);

  const rows = useMemo(
    () => deriveArchivedRows(flags.archived, flags.archivedAt, sessions, t("settings.archivedMissingProject")),
    [flags.archived, flags.archivedAt, sessions, t],
  );
  const missing = rows.filter((row) => !row.live).length;
  const visibleRows = showDeleted ? rows : rows.filter((row) => row.live);

  return (
    <>
      <ConfigSidebarGroupLabel>
        {t("settings.archivedSessionsLabel")}
        <span className="pw-grow" aria-hidden="true" />
        {rows.length > 0 && (
          <ConfigSwitch
            checked={showDeleted}
            label={t("settings.archivedShowMissing", { count: missing })}
            onChange={setShowDeleted}
          />
        )}
        <ConfigBadge tone="count">{rows.length}</ConfigBadge>
      </ConfigSidebarGroupLabel>
      {sessions === null ? null : visibleRows.length === 0 ? (
        <p role="status" className="sub">{t("settings.archivedEmpty")}</p>
      ) : (
        <ConfigSidebarList>
          {visibleRows.map((row) => (
            <ConfigSidebarItem
              key={row.id}
              active={row.id === selectedId}
              title={row.id}
              style={row.live ? undefined : { opacity: 0.6 }}
              onClick={() => onSelect(row.id)}
            >
              <span className="pw-ico pw-dim">
                <i data-ico={row.live ? "message-square" : "triangle-alert"} data-size="13" aria-hidden="true" />
              </span>
              <span className="grow">
                <span className="pw-lname">{row.title}</span>
                <span className="pw-lsub">
                  {row.archivedAt
                    ? t("settings.archivedAt", { time: formatRelativeTime(new Date(row.archivedAt), locale) })
                    : t("settings.archivedAtUnknown")}
                </span>
              </span>
            </ConfigSidebarItem>
          ))}
        </ConfigSidebarList>
      )}
    </>
  );
}

/**
 * 选中会话的详情卡（宿主详情列）。恢复与彻底删除收在详情头右端（画板 62 的
 * 条目级动作位）；彻底删除保留二次确认，删完同时刷新宿主的项目数据。
 */
export function ArchivedSessionDetail({
  sessions,
  sessionId,
  onSessionsChanged,
  onReload,
}: {
  sessions: readonly SessionInfo[] | null;
  sessionId: string;
  onSessionsChanged?: () => void;
  /** 删除会话文件之后由宿主重读 /api/sessions（项目索引随之刷新）。 */
  onReload?: () => void;
}) {
  const { t, locale } = useI18n();
  const { flags, archive } = useSessionFlags();
  const [busy, setBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const row = useMemo(
    () => deriveArchivedRows(flags.archived, flags.archivedAt, sessions, t("settings.archivedMissingProject"))
      .find((candidate) => candidate.id === sessionId) ?? null,
    [flags.archived, flags.archivedAt, sessions, t, sessionId],
  );

  if (!row) return null;

  const restore = () => {
    archive(row.id); // toggle → 取消归档
    onSessionsChanged?.();
  };

  const remove = async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(row.id)}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // 文件删掉了，归档标记也要清掉，否则它会永远留在「文件已不存在」那一类里。
      if (flags.archived.includes(row.id)) archive(row.id);
      setPendingDelete(false);
      onReload?.();
      onSessionsChanged?.();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {error && (
        <div role="alert" className="pw-alert">
          <span className="pw-ico"><i data-ico="triangle-alert" data-size="14" aria-hidden="true" /></span>
          <span className="grow">{error}</span>
        </div>
      )}
      <div className="pw-inline">
        <span className="pw-ico pw-dim">
          <i data-ico={row.live ? "message-square" : "triangle-alert"} data-size="14" aria-hidden="true" />
        </span>
        <b style={{ fontWeight: 500 }}>{row.title}</b>
        <span className="pw-grow" aria-hidden="true" />
        {row.archivedAt && (
          <span className="pw-mono pw-dim">
            {t("settings.archivedAt", { time: formatRelativeTime(new Date(row.archivedAt), locale) })}
          </span>
        )}
        <ConfigButton variant="secondary" size="small" onClick={restore}>
          {t("settings.archivedRestore")}
        </ConfigButton>
        {row.live && (pendingDelete ? (
          <>
            <ConfigButton variant="danger" size="small" disabled={busy} onClick={() => void remove()}>
              {t("settings.archivedDeleteConfirm")}
            </ConfigButton>
            <ConfigButton variant="ghost" size="small" onClick={() => setPendingDelete(false)}>
              {t("i18n.cancel")}
            </ConfigButton>
          </>
        ) : (
          <ConfigButton
            variant="danger"
            size="small"
            disabled={busy}
            onClick={() => setPendingDelete(true)}
            title={t("settings.archivedDelete")}
            aria-label={t("settings.archivedDelete")}
          >
            <span className="pw-ico"><i data-ico="trash-2" data-size="13" aria-hidden="true" /></span>
          </ConfigButton>
        ))}
      </div>
      <dl className="pw-kv">
        <dt>{t("settings.projectsActive")}</dt>
        <dd>{row.projectLabel}</dd>
      </dl>
      {!row.live && (
        <p className="pw-hint">
          <span className="pw-ico"><i data-ico="triangle-alert" data-size="12" aria-hidden="true" /></span>
          {t("settings.archivedMissingProject")}
        </p>
      )}
    </>
  );
}

/**
 * 旧的两段式入口。会话内容已全部并入骨架 B 的合页（见文件头注释），这里恒渲染
 * null——渲染任何东西都会与宿主列表列里的 `<ArchivedSessionsGroup>` 重复。
 */
export function ArchivedSessionsPanel(_props: {
  onOpenSession?: (id: string) => void;
  onSessionsChanged?: () => void;
}) {
  void _props;
  return null;
}

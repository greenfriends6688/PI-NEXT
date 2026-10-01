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
 *     由宿主放进详情列。
 *
 * 旧的两段式入口（恒渲染 null）已删：SettingsPanel 里它那个兄弟节点和
 * `div.settings-archive-page` 早已摘除，留着只是一具第二套骨架的残骸。
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
  ConfigDetailHeader,
  ConfigDetailStack,
  ConfigDetailTitle,
  ConfigEmptyState,
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
  sessions: readonly SessionInfo[],
  missingProjectLabel: string,
): ArchivedRow[] {
  const byId = new Map(sessions.map((session) => [session.id, session]));
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
  sessions: readonly SessionInfo[];
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
      {visibleRows.length === 0 ? (
        /* 两种「列不出来」要分开说（画板 62 帧 D：空态必须有落点）：
           一条都没归档过 → 空态 + 本机存储说明（fix:archive-local-only）；
           归档过但文件都没了 → 「文件已不存在」，上面组标题的开关就是出口。 */
        <ConfigEmptyState>
          <span className="mark">
            <i data-ico={rows.length > 0 ? "triangle-alert" : "archive"} data-size="16" aria-hidden="true" />
          </span>
          <p>{rows.length > 0 ? t("settings.archivedMissingProject") : t("settings.archivedEmpty")}</p>
          {rows.length === 0 && <p className="pw-hint">{t("settings.archiveStoredLocally")}</p>}
        </ConfigEmptyState>
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
  sessions: readonly SessionInfo[];
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
    /* 宿主的详情栈只有一个子元素（就是本卡），行高会被拉满。卡里再套一层
       `align-content: start` 的栈：几行内容收回顶部（实测否则是 373 + 367 两行、
       kv 被擑到半空）。一个对齐关键字，不是新尺寸；满屏的项目详情不受影响。 */
    <ConfigDetailStack style={{ alignContent: "start" }}>
      {error && (
        <div role="alert" className="pw-alert">
          <span className="pw-ico"><i data-ico="triangle-alert" data-size="14" aria-hidden="true" /></span>
          <span className="grow">{error}</span>
        </div>
      )}
      <ConfigDetailHeader>
        <span className="pw-ico pw-dim">
          <i data-ico={row.live ? "message-square" : "triangle-alert"} data-size="14" aria-hidden="true" />
        </span>
        {/* 画板 62 帧 B 的详情头第一项是**名字**（h3），不是行内加粗的 `<b>`。 */}
        <ConfigDetailTitle>{row.title}</ConfigDetailTitle>
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
      </ConfigDetailHeader>
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
    </ConfigDetailStack>
  );
}

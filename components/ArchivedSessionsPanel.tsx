"use client";

/**
 * fork:ui-archive-history — 归档**会话**的行推导与窄屏渲染。
 *
 * fork:v5-landing-frame · D-21（2026-10-06）—— 桌面归档页整页改成画板 D-21 帧 A
 * （一列分节：横幅 + 归档历史卡 + 两种空态卡，见 `ProjectArchivePanel.tsx`），
 * 详情列随之退场。因此这个文件现在只留三样东西：
 *
 *   - `deriveArchivedRows` —— 纯函数：归档标志 × 会话索引 → 行（新的在前）；
 *   - `ArchivedSessionsGroup` —— **窄屏**的会话分组卡（M-05 一行一个控件）；
 *   - `ArchivedSessionDetail` —— **窄屏**详情面板里的会话卡（恢复 / 彻底删除）。
 *
 * 会话的**彻底删除**在两处出现，形状不同：桌面是 D-21 帧 A 的批量条 + 二次确认浮层
 * （住在 `ProjectArchivePanel.tsx`），窄屏是详情面板里的确认态（就是下面这个组件）。
 * 桌面那一支的 DELETE 曾经在唯一的这个文件里，现在随批量条一起搬到了宿主。
 */

import { useMemo, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { PwaSetRow, PwaSwitchRow } from "@/components/pwa/PwaPage";
import { useSessionFlags } from "@/lib/session-flags";
import { formatRelativeTime } from "@/lib/i18n/format";
import type { SessionInfo } from "@/lib/types";

export interface ArchivedRow {
  id: string;
  title: string;
  projectLabel: string;
  archivedAt: string | null;
  /** 文件还在（能打开、能删）。 */
  live: boolean;
  /** `.jsonl` 里的消息数（D-21 帧 A 的会话副行要它）。 */
  messageCount: number;
}

function projectLabelOf(session: SessionInfo): string {
  const root = session.projectRoot || session.cwd || "";
  const parts = root.split(/[/\\]/).filter(Boolean);
  return parts.at(-1) ?? root;
}

/** 纯函数：归档标志 × 会话索引 → 列表与详情都要用的行。新的在前。 */
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
      messageCount: session?.messageCount ?? 0,
    };
  });
  // 新的在前；没有时间戳的老条目排在最后（保持它们在 id 列表里的相对顺序）。
  return list.sort((a, b) => (b.archivedAt ?? "").localeCompare(a.archivedAt ?? ""));
}

/**
 * 窄屏的「已归档会话」卡：组标题（文字 + 计数徽章 + 「显示文件已消失」开关）
 * + 一行一个会话。两个「列不出来」要分开说：一条都没归档过 → 空态 + 本机存储说明；
 * 归档过但文件都没了 → 「文件已不存在」，组标题的开关就是出口。
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
    <div className="m-cardgroup">
      <PwaSwitchRow
        icon="archive"
        label={t("settings.archivedSessionsLabel")}
        sub={rows.length > 0 ? t("settings.archivedShowMissing", { count: missing }) : undefined}
        checked={showDeleted}
        switchLabel={t("settings.archivedShowMissing", { count: missing })}
        onChange={setShowDeleted}
        disabled={rows.length === 0}
        trailing={<span className="m-badge mute">{rows.length}</span>}
      />
      {visibleRows.length === 0 ? (
        <PwaSetRow
          label={rows.length > 0 ? t("settings.archivedMissingProject") : t("settings.archivedEmpty")}
          sub={rows.length === 0 ? t("settings.archiveStoredLocally") : undefined}
        />
      ) : (
        visibleRows.map((row) => (
          <button
            key={row.id}
            type="button"
            className="m-setrow"
            aria-current={row.id === selectedId ? "page" : undefined}
            onClick={() => onSelect(row.id)}
          >
            <i data-ico={row.live ? "message-square" : "triangle-alert"} data-size="16" aria-hidden="true" />
            <span className="m-setrow-body">
              <span className="m-setrow-t">{row.title}</span>
              <span className="m-setrow-s">
                {row.archivedAt
                  ? t("settings.archivedAt", { time: formatRelativeTime(new Date(row.archivedAt), locale) })
                  : t("settings.archivedAtUnknown")}
              </span>
            </span>
            {row.id === selectedId && <span className="m-badge ok">{t("settings.archivedSessionsLabel")}</span>}
          </button>
        ))
      )}
    </div>
  );
}

/**
 * 窄屏详情面板里的会话卡：恢复与彻底删除收在底部动作行。删除保留二次确认，
 * 删完同时刷新宿主的项目数据（`onReload`）。
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
    <>
      {error && (
        <div className="m-banner err" role="alert">
          <i data-ico="triangle-alert" data-size="14" aria-hidden="true" />
          <span className="m-grow">{error}</span>
        </div>
      )}
      <div className="m-cardgroup">
        <PwaSetRow
          icon={row.live ? "message-square" : "triangle-alert"}
          label={row.title}
          sub={row.archivedAt
            ? t("settings.archivedAt", { time: formatRelativeTime(new Date(row.archivedAt), locale) })
            : t("settings.archivedAtUnknown")}
        />
        <PwaSetRow label={t("settings.projectsActive")} sub={row.projectLabel} />
        <div className="m-pickbar">
          {row.live && (pendingDelete ? (
            <>
              <button type="button" className="m-picktag danger" disabled={busy} onClick={() => void remove()}>
                {t("settings.archivedDeleteConfirm")}
              </button>
              <button type="button" className="m-picktag" onClick={() => setPendingDelete(false)}>
                {t("i18n.cancel")}
              </button>
            </>
          ) : (
            <button
              type="button"
              className="m-picktag danger"
              disabled={busy}
              onClick={() => setPendingDelete(true)}
              title={t("settings.archivedDelete")}
              aria-label={t("settings.archivedDelete")}
            >
              <i data-ico="trash-2" data-size="13" aria-hidden="true" />
            </button>
          ))}
          <button type="button" className="m-picktag is-on" onClick={restore}>
            {t("settings.archivedRestore")}
          </button>
        </div>
      </div>
      {!row.live && (
        <div className="m-banner warn">
          <i data-ico="triangle-alert" data-size="14" aria-hidden="true" />
          <span className="m-grow">{t("settings.archivedMissingProject")}</span>
        </div>
      )}
    </>
  );
}
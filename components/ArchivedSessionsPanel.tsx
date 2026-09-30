"use client";

/**
 * fork:ui-archive-history — 归档历史（Zeno 设置 → 数据 → 归档 的那一页）。
 *
 * 之前归档是**单向**的：行从项目列表里消失，落到项目底部的折叠区；折叠区又藏在长列表
 * 最下面，等于「归档后找不回来」。Zeno 的做法是把归档做成设置里的一个数据页：按项目
 * 分组列出所有已归档会话，每条都能「恢复」或「彻底删除」。
 *
 * 这里照同样的形状：
 *   - 数据源是 `lib/session-flags.ts` 的 `archived` + `archivedAt`（本地、跨标签页同步）；
 *   - 会话标题/项目从 `/api/sessions` 取；文件已经不在的归档项照样列出来（按 id 显示）；
 *   - 「恢复」= 取消归档（行回到项目列表）；「删除」= 删掉会话文件（二次确认）。
 *
 * fork:design-system —— 画板 46 帧「归档历史」下半：`.pw-sec-title`（标题 + 计数徽章 +
 * 「显示文件已消失」开关）+ `.pw-grid2` 里每项目一张 `.pw-detail`，行是 `.pw-litem`
 * （消失的会话用 triangle-alert 图标 + 0.6 透明度，画板原样）；恢复与删除收在行尾。
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useSessionFlags } from "@/lib/session-flags";
import { formatRelativeTime } from "@/lib/i18n/format";
import type { SessionInfo } from "@/lib/types";
import { ConfigButton, ConfigSwitch } from "./SettingsUi";

interface ArchivedRow {
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

export function ArchivedSessionsPanel({
  onOpenSession,
  onSessionsChanged,
}: {
  onOpenSession?: (id: string) => void;
  onSessionsChanged?: () => void;
}) {
  const { t, locale } = useI18n();
  const { flags, archive } = useSessionFlags();
  const [sessions, setSessions] = useState<SessionInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [showDeleted, setShowDeleted] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/sessions");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { sessions?: SessionInfo[] };
      setSessions(data.sessions ?? []);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const rows = useMemo<ArchivedRow[]>(() => {
    const byId = new Map((sessions ?? []).map((session) => [session.id, session]));
    const list: ArchivedRow[] = flags.archived.map((id) => {
      const session = byId.get(id);
      return {
        id,
        title: session?.name || session?.firstMessage?.slice(0, 80) || id,
        projectLabel: session ? projectLabelOf(session) : t("settings.archivedMissingProject"),
        archivedAt: flags.archivedAt[id] ?? null,
        live: Boolean(session),
      };
    });
    // 新的在前；没有时间戳的老条目排在最后（保持它们在 id 列表里的相对顺序）。
    return list.sort((a, b) => (b.archivedAt ?? "").localeCompare(a.archivedAt ?? ""));
  }, [flags.archived, flags.archivedAt, sessions, t]);

  const grouped = useMemo(() => {
    const map = new Map<string, ArchivedRow[]>();
    for (const row of rows) {
      const bucket = map.get(row.projectLabel);
      if (bucket) bucket.push(row);
      else map.set(row.projectLabel, [row]);
    }
    return [...map.entries()];
  }, [rows]);

  const restore = (id: string) => {
    archive(id); // toggle → 取消归档
    onSessionsChanged?.();
  };

  const remove = async (id: string) => {
    setBusyId(id);
    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // 文件删掉了，归档标记也要清掉，否则它会永远留在「文件已不存在」那一类里。
      if (flags.archived.includes(id)) archive(id);
      setPendingDelete(null);
      await load();
      onSessionsChanged?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusyId(null);
    }
  };

  const missing = rows.filter((row) => !row.live);
  const visibleRows = showDeleted ? rows : rows.filter((row) => row.live);

  return (
    <>
      <div className="pw-sec-title" style={{ marginTop: "var(--s4)" }}>
        {t("settings.archivedSessionsLabel")}
        <span className="pw-grow" aria-hidden="true" />
        <span className="pw-badge count">{rows.length}</span>
        {rows.length > 0 && (
          <span className="pw-inline" style={{ marginLeft: "var(--s3)" }}>
            <ConfigSwitch
              checked={showDeleted}
              label={t("settings.archivedShowMissing", { count: missing.length })}
              onChange={setShowDeleted}
            />
            <span style={{ fontSize: "var(--text-meta)", color: "var(--n-muted)" }}>
              {t("settings.archivedShowMissing", { count: missing.length })}
            </span>
          </span>
        )}
      </div>

      {error && (
        <div role="alert" className="pw-alert">
          <span className="pw-ico"><i data-ico="triangle-alert" data-size="14" aria-hidden="true" /></span>
          <span className="grow">{error}</span>
        </div>
      )}
      {sessions === null && <p role="status" className="sub">{t("i18n.loading")}</p>}
      {sessions !== null && visibleRows.length === 0 && (
        <p role="status" className="sub">{t("settings.archivedEmpty")}</p>
      )}

      <div className="pw-grid2" style={{ gap: "var(--s3)" }}>
        {grouped.map(([project, group]) => {
          const shown = group.filter((row) => showDeleted || row.live);
          if (shown.length === 0) return null;
          return (
            <div key={project} className="pw-detail" style={{ padding: "var(--s2) var(--s3)" }}>
              <div className="pw-inline" style={{ marginBottom: "var(--s2)" }}>
                <span className="pw-ico"><i data-ico="folder" data-size="14" aria-hidden="true" /></span>
                <b style={{ fontWeight: 500, fontSize: "var(--text-secondary)" }}>{project}</b>
                <span className="pw-badge count">{shown.length}</span>
              </div>
              {shown.map((row) => (
                <div key={row.id} className="pw-litem" style={row.live ? undefined : { opacity: 0.6 }}>
                  <span className="pw-ico pw-dim">
                    <i data-ico={row.live ? "message-square" : "triangle-alert"} data-size="13" aria-hidden="true" />
                  </span>
                  <button
                    type="button"
                    className="grow"
                    style={{ minWidth: 0, textAlign: "left" }}
                    title={row.id}
                    disabled={!row.live || !onOpenSession}
                    onClick={() => onOpenSession?.(row.id)}
                  >
                    <span className="pw-lname">{row.title}</span>
                    <span className="pw-lsub">
                      {row.archivedAt
                        ? t("settings.archivedAt", { time: formatRelativeTime(new Date(row.archivedAt), locale) })
                        : t("settings.archivedAtUnknown")}
                    </span>
                  </button>
                  <ConfigButton
                    variant="ghost"
                    size="small"
                    onClick={() => restore(row.id)}
                    disabled={busyId === row.id}
                  >
                    {t("settings.archivedRestore")}
                  </ConfigButton>
                  {row.live && (pendingDelete === row.id ? (
                    <>
                      <ConfigButton
                        variant="danger"
                        size="small"
                        onClick={() => void remove(row.id)}
                        disabled={busyId === row.id}
                      >
                        {t("settings.archivedDeleteConfirm")}
                      </ConfigButton>
                      <ConfigButton variant="ghost" size="small" onClick={() => setPendingDelete(null)}>
                        {t("i18n.cancel")}
                      </ConfigButton>
                    </>
                  ) : (
                    <ConfigButton
                      variant="danger"
                      size="small"
                      onClick={() => setPendingDelete(row.id)}
                      title={t("settings.archivedDelete")}
                      aria-label={t("settings.archivedDelete")}
                    >
                      <span className="pw-ico"><i data-ico="trash-2" data-size="13" aria-hidden="true" /></span>
                    </ConfigButton>
                  ))}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </>
  );
}

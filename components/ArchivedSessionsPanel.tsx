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

import { useMemo, useState, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from "react";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useI18n } from "@/hooks/useI18n";
import { PwaSetRow, PwaSwitchRow } from "@/components/pwa/PwaPage";
import { useSessionFlags } from "@/lib/session-flags";
import { formatRelativeTime } from "@/lib/i18n/format";
import type { SessionInfo } from "@/lib/types";

/* fork:v5-skin-d-only —— 本地内容基件只吐 d-*（同 SkillsConfig 的同名块）。 */
function Btn({
  variant = "secondary",
  size = "default",
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger" | "ghost";
  size?: "small" | "default";
}) {
  const variantClass = variant === "primary" ? "primary"
    : variant === "secondary" ? "outline"
    : variant === "danger" ? "danger"
    : "";
  return (
    <button
      type="button"
      {...props}
      className={["d-btn", variantClass, size === "small" ? "sm" : "", className].filter(Boolean).join(" ")}
    >
      {children}
    </button>
  );
}
function Stack({ className, style, children }: { className?: string; style?: CSSProperties; children: ReactNode }) {
  return (
    <div className={["d-col", className].filter(Boolean).join(" ")} style={{ gap: "var(--nx-sp-3)", ...style }}>
      {children}
    </div>
  );
}
function Title({ children }: { children: ReactNode }) {
  return <h3 className="d-t-title" style={{ margin: 0 }}>{children}</h3>;
}

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
  const mobile = useIsMobile();

  const rows = useMemo(
    () => deriveArchivedRows(flags.archived, flags.archivedAt, sessions, t("settings.archivedMissingProject")),
    [flags.archived, flags.archivedAt, sessions, t],
  );
  const missing = rows.filter((row) => !row.live).length;
  const visibleRows = showDeleted ? rows : rows.filter((row) => row.live);

  // fork:v5-landing Wave B · M-05 · 窄屏：分组变成一张 `.m-cardgroup`
  // （组标题 + 「显示文件已消失」开关行 + 会话行）。**归档口径一字不改**
  //（同一张 `session-flags` 表、同一个「文件已不在就藏起来」的开关）。
  if (mobile) {
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

  return (
    <>
      {/* 画板 D-21 帧 A 的组标题行（`.d-group-toggle`）+ 计数徽章 + 「显示已消失」开关。 */}
      <div className="d-group-toggle d-group-title">
        <i data-ico="archive" data-size="12" aria-hidden="true" />
        <span className="d-t-sm d-t-b">{t("settings.archivedSessionsLabel")}</span>
        <span className="d-grow" aria-hidden="true" />
        {rows.length > 0 && (
          <button
            type="button"
            role="switch"
            aria-checked={showDeleted}
            aria-label={t("settings.archivedShowMissing", { count: missing })}
            title={t("settings.archivedShowMissing", { count: missing })}
            className={`d-switch${showDeleted ? " on" : ""}`}
            onClick={() => setShowDeleted((current) => !current)}
          />
        )}
        <span className="d-badge count">{rows.length}</span>
      </div>
      {visibleRows.length === 0 ? (
        /* 两种「列不出来」要分开说（画板 D-21 帧 A：空态用 `.d-empty`）：
           一条都没归档过 → 空态 + 本机存储说明（fix:archive-local-only）；
           归档过但文件都没了 → 「文件已不存在」，上面组标题的开关就是出口。 */
        <div className="d-empty compact">
          <span className="d-empty-ico">
            <i data-ico={rows.length > 0 ? "triangle-alert" : "archive"} data-size="20" aria-hidden="true" />
          </span>
          <span className="d-empty-t">{rows.length > 0 ? t("settings.archivedMissingProject") : t("settings.archivedEmpty")}</span>
          {rows.length === 0 && <span className="d-empty-s">{t("settings.archiveStoredLocally")}</span>}
        </div>
      ) : (
        <div className="d-col">
          {visibleRows.map((row) => {
            const isActive = row.id === selectedId;
            return (
              <button
                key={row.id}
                type="button"
                aria-current={isActive ? "page" : undefined}
                className={`d-sess${isActive ? " is-on" : ""}`}
                title={row.id}
                style={row.live ? undefined : { opacity: 0.6 }}
                onClick={() => onSelect(row.id)}
              >
                <span className="d-row">
                  <i data-ico={row.live ? "message-square" : "triangle-alert"} data-size="13" className="d-t-faint" aria-hidden="true" />
                  <span className="d-grow">
                    <span className="d-sess-t">{row.title}</span>
                    <span className="d-sess-m">
                      {row.archivedAt
                        ? t("settings.archivedAt", { time: formatRelativeTime(new Date(row.archivedAt), locale) })
                        : t("settings.archivedAtUnknown")}
                    </span>
                  </span>
                </span>
              </button>
            );
          })}
        </div>
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
  const mobile = useIsMobile();
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

  // fork:v5-landing Wave B · M-05 · 窄屏详情 = 一张 `.m-cardgroup`（头行 / 项目行 /
  // 动作 pickbar）。**删除仍是二次确认 + DELETE 同一路由**，本仓对用户数据只读那一条不变。
  if (mobile) {
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

  return (
    /* 宿主的详情栈只有一个子元素（就是本卡），行高会被拉满。卡里再套一层
       `align-content: start` 的栈：几行内容收回顶部。一个对齐关键字，不是新尺寸。 */
    <Stack style={{ alignContent: "start" }}>
      {error && (
        <div role="alert" className="d-banner err">
          <i data-ico="triangle-alert" data-size="14" aria-hidden="true"></i>
          <span className="d-grow">{error}</span>
        </div>
      )}
      <div className="d-row">
        <i data-ico={row.live ? "message-square" : "triangle-alert"} data-size="14" className="d-t-faint" aria-hidden="true" />
        <Title>{row.title}</Title>
        <span className="d-grow" aria-hidden="true" />
        {row.archivedAt && (
          <span className="d-mono d-t-faint">
            {t("settings.archivedAt", { time: formatRelativeTime(new Date(row.archivedAt), locale) })}
          </span>
        )}
        <Btn variant="secondary" size="small" onClick={restore}>
          {t("settings.archivedRestore")}
        </Btn>
        {row.live && (pendingDelete ? (
          <>
            <Btn variant="danger" size="small" disabled={busy} onClick={() => void remove()}>
              {t("settings.archivedDeleteConfirm")}
            </Btn>
            <Btn variant="ghost" size="small" onClick={() => setPendingDelete(false)}>
              {t("i18n.cancel")}
            </Btn>
          </>
        ) : (
          <Btn
            variant="danger"
            size="small"
            disabled={busy}
            onClick={() => setPendingDelete(true)}
            title={t("settings.archivedDelete")}
            aria-label={t("settings.archivedDelete")}
          >
            <i data-ico="trash-2" data-size="13" aria-hidden="true" />
          </Btn>
        ))}
      </div>
      <div className="d-set-sec">
        <div className="d-set-row">
          <div className="d-set-row-box">
            <div className="d-set-row-t">{t("settings.projectsActive")}</div>
            <div className="d-set-row-s">{row.projectLabel}</div>
          </div>
        </div>
      </div>
      {!row.live && (
        <div className="d-banner warn">
          <i data-ico="triangle-alert" data-size="14" aria-hidden="true"></i>
          <span className="d-grow">{t("settings.archivedMissingProject")}</span>
        </div>
      )}
    </Stack>
  );
}

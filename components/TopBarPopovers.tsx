"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";
import { stripAnsi } from "@/lib/ansi";
import type { ExtensionStatusItem, ExtensionWidgetItem } from "@/lib/types";
import type { PluginsResponse } from "@/lib/api-types";
import { AnsiText } from "./AnsiText";
import { ExtensionWidgets } from "./ExtensionWidgets";
import { PortalDropdown, useDismissOnOutside } from "./PortalDropdown";

/**
 * fork:ui-topbar-popovers（用户裁定 2026-09-29）—— 顶栏右侧的两件事：
 *
 *   1. **「分支」芯片可点**：画板 `02-sidebar-topbar.html` 帧 B 给的是
 *      `<button class="d-chipbtn"><git-branch>main<chevron-down></button>` ——
 *      带下拉箭头的芯片，也就是工作区（worktree）切换器。产品里它原本是个
 *      **没有 onClick 的 span**（用户实测「这个 main 点不了」）。
 *
 *   2. **插件一枚图标 + 浮窗**：原来 MCP / ponytail 是聊天区右上角一枚
 *      常驻 mono 胶囊（`ExtensionStatusFloat`）。用户要求改成顶栏图标，
 *      悬停或点击出浮窗。图标取自画板 43 自己的词汇：插件 = `blocks`。
 *      （MCP 那一枚是 2026-10-07 用户裁定去掉的：它只在顶栏重复一遍
 *      设置 → MCP 已经写清楚的服务器清单，浮窗一关就少一处重复。）
 *
 * 浮窗一律走 `PortalDropdown`（body + fixed），顶栏本身有 `overflow` 与 z 叠层，
 * 绝对定位的浮窗会被裁。
 *
 * fork:v5-landing —— 外观照 `design/v5/web/boards/D-02b-topbar-popovers.html`
 * 逐枚落地：浮窗壳 `d-pop-float`、分组标题 `d-pop-title`、行 `d-menu-row`、
 * 脚注 `d-pop-foot`、徽标 `d-badge`、触发钮 `d-iconbtn` / `d-chipbtn`。
 */

const POPOVER_WIDTH = 300;

/** 悬停或点击都能开、移开自动收的浮窗外壳。 */
function HoverPopover({
  label,
  icon,
  title,
  badge,
  width = POPOVER_WIDTH,
  openOnHover = true,
  onOpenChange,
  children,
}: {
  label: string;
  icon: string;
  title: string;
  badge?: ReactNode;
  width?: number;
  /** fork:mcp-click-only（用户 2026-10-05）—— 悬停就开浮窗的只有 MCP/插件两枚，
   *  而 MCP 那一枚现在**只认点击**：指针扫过顶栏就弹出一整块服务器列表，扫一次弹一次。
   *  `false` = 只有点开才开（移开不自动收，关掉靠点外面 / Esc —— `useDismissOnOutside`）。 */
  openOnHover?: boolean;
  /** 浮窗开合状态外传：内容需要「打开时才拉数据」时用（不要在每次悬停都发请求）。 */
  onOpenChange?: (open: boolean) => void;
  children: (close: () => void) => ReactNode;
}) {
  const [hovered, setHovered] = useState(false);
  const [pinned, setPinned] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const open = openOnHover ? hovered || pinned : pinned;
  const close = useCallback(() => {
    setPinned(false);
    setHovered(false);
  }, []);

  useEffect(() => {
    onOpenChange?.(open);
  }, [open, onOpenChange]);

  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current); }, []);

  // 面板 portal 到 body，指针从触发点移到面板时会先触发触发点的 mouseleave ——
  // 给一段宽限期，面板自己的 mouseenter 会把它取消。
  const holdOpen = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setHovered(true);
  }, []);
  const scheduleClose = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setHovered(false), 160);
  }, []);

  useDismissOnOutside(open, anchorRef, panelRef, close);

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        aria-label={label}
        aria-expanded={open}
        title={title}
        /* fork:v5-landing —— 触发钮 = 画板 D-02b 帧 C 的 `.d-iconbtn`（28px / 发丝
           hover）；开合态用 `.is-on`（强调淡底）而不是内联色值。 */
        /* fork:v5-landing-frame · D-02b —— 触发钮是**浮层锚点**：画板里那一层是
           `.d-anchor.d-col`（宿主列），产品这里宿主就是这枚钮 —— 它内部那枚计数
           `.d-badge` 是 `position:absolute`（画板 D-02b 帧 C 的右上角角标），
           所以 `position:relative` 是真的结构需求。原来写在内联 `style` 上，
           现在进 `d-anchor` 类（铁律四：值进类不进 inline）。
           浮窗本体**不在这里**：它走 `PortalDropdown`（portal + fixed），
           所以**不给它加**锚点类 —— 加了是装饰不是结构（LANDING §2②）。 */
        className={`d-iconbtn d-anchor${open ? " is-on" : ""}`}
        onClick={() => setPinned((v) => !v)}
        onMouseEnter={openOnHover ? holdOpen : undefined}
        onMouseLeave={openOnHover ? scheduleClose : undefined}
      >
        <i data-ico={icon} data-size="14" aria-hidden="true"></i>
        {badge}
      </button>
      {/* fork:v5-frame-audit-2026-10-05 —— 浮窗壳就是画板 D-02b 帧 C 的
          `<div class="d-pop-float is-open">`，里面第一件就是 `.d-pop-title`。
          原来多包了一层 `<div role="menu">`，板面上不存在；它也把「行是 role=menuitem
          吗」这件事说错了（这些都是只读状态行）。悬停保持挂在壳上即可。 */}
      <PortalDropdown open={open} anchorRef={anchorRef} panelRef={panelRef} className="d-pop-float" width={width} align="right">
        <div onMouseEnter={openOnHover ? holdOpen : undefined} onMouseLeave={openOnHover ? scheduleClose : undefined}>
          {children(close)}
        </div>
      </PortalDropdown>
    </>
  );
}

/** 打开时才拉一次数据的轻量读法（浮窗不打开就不发请求）。 */
function useLazyJson<T>(open: boolean, url: string | null): { data: T | null; failed: boolean } {
  const [state, setState] = useState<{ url: string; data: T | null; failed: boolean } | null>(null);
  useEffect(() => {
    if (!open || !url) return;
    let cancelled = false;
    fetch(url)
      .then((res) => (res.ok ? res.json() as Promise<T> : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((data) => { if (!cancelled) setState({ url, data, failed: false }); })
      .catch(() => { if (!cancelled) setState({ url, data: null, failed: true }); });
    return () => { cancelled = true; };
  }, [open, url]);
  if (!url) return { data: null, failed: false };
  return state?.url === url ? state : { data: null, failed: false };
}

/** 状态文本按扩展自己的 key / 文案分派：MCP 的进 MCP 浮窗，其余进插件浮窗。 */
export function splitStatusesByKind(statuses: ExtensionStatusItem[]): {
  mcp: ExtensionStatusItem[];
  others: ExtensionStatusItem[];
} {
  const mcp: ExtensionStatusItem[] = [];
  const others: ExtensionStatusItem[] = [];
  for (const status of statuses) {
    const haystack = `${status.key} ${status.text}`.toLowerCase();
    (haystack.includes("mcp") ? mcp : others).push(status);
  }
  return { mcp, others };
}

function StatusRows({ statuses }: { statuses: ExtensionStatusItem[] }) {
  return (
    <>
      {statuses.map((status) => (
        /* fork:v5-landing —— 状态原文是扩展自己打的行，照画板 D-02b 用等宽小字直排。 */
        <div key={status.key} className="d-menu-row" style={{ cursor: "default" }}>
          <span className="d-mono d-t-xs" style={{ minWidth: 0 }}>
            <AnsiText text={status.text} />
          </span>
        </div>
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// 1 · 分支 / 工作区芯片
// ---------------------------------------------------------------------------

interface WorktreeEntry {
  path: string;
  branch?: string | null;
  isMain?: boolean;
}

export function BranchChip({
  branch,
  cwd,
  onSelectWorkspace,
}: {
  branch: string;
  cwd: string;
  /** 选中另一个工作区（= 切换项目目录），与侧栏 worktree 切换器同一动作。
   *  第二个参数是仓库根（worktree 与主仓共享的项目标识）。 */
  onSelectWorkspace: (path: string, projectRoot: string | null) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const url = open && cwd ? `/api/worktrees?cwd=${encodeURIComponent(cwd)}` : null;
  const { data, failed } = useLazyJson<{ projectRoot?: string; worktrees?: WorktreeEntry[] }>(open, url);
  const close = useCallback(() => setOpen(false), []);
  useDismissOnOutside(open, anchorRef, panelRef, close);

  const worktrees = data?.worktrees ?? [];

  return (
    <>
      {/* 画板 02 帧 B：分支芯片带 chevron-down —— 它是下拉触发钮，不是静态标签。 */}
      <button
        ref={anchorRef}
        type="button"
        className="d-chipbtn"
        title={cwd}
        aria-label={t("sidebar.worktrees")}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <i data-ico="git-branch" data-size="13" aria-hidden="true"></i>
        {branch}
        <i data-ico="chevron-down" data-size="12" aria-hidden="true"></i>
      </button>
      {/* fork:v5-frame-audit-2026-10-05 —— 同上：工作区浮窗去掉那层 `role="menu"` 壳，
          `.d-pop-title` 直接是浮窗的第一个子节点（D-02d 帧 C 的「工作区」列表）。 */}
      <PortalDropdown open={open} anchorRef={anchorRef} panelRef={panelRef} className="d-pop-float" width={260} align="left">
        <div>
          <div className="d-pop-title">{t("sidebar.worktrees")}</div>
          {failed && <div className="d-menu-row" style={{ cursor: "default" }}>{t("sidebar.checkingWorktrees")}</div>}
          {!failed && data && worktrees.length === 0 && (
            <div className="d-menu-row" style={{ cursor: "default" }}>{t("sidebar.gitRepoRootOnly")}</div>
          )}
          {worktrees.map((wt) => {
            const isCurrent = wt.path === cwd;
            return (
              <button
                key={wt.path}
                type="button"
                role="menuitem"
                title={wt.path}
                className="d-menu-row"
                style={{ width: "100%" }}
                onClick={() => { close(); if (!isCurrent) onSelectWorkspace(wt.path, data?.projectRoot ?? null); }}
              >
                <i data-ico={isCurrent ? "check" : "git-branch"} data-size="14" aria-hidden="true"></i>
                <span className="d-grow d-mono">
                  {wt.branch ?? wt.path}
                </span>
                {wt.isMain && <span className="d-badge mute">{t("sidebar.main")}</span>}
              </button>
            );
          })}
        </div>
      </PortalDropdown>
    </>
  );
}

// ---------------------------------------------------------------------------
// 3 · 插件图标
// ---------------------------------------------------------------------------

export function PluginStatusButton({
  cwd,
  statuses,
  widgets,
}: {
  cwd: string | null;
  statuses: ExtensionStatusItem[];
  widgets: ExtensionWidgetItem[];
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const url = open && cwd ? `/api/plugins?cwd=${encodeURIComponent(cwd)}` : null;
  const { data, failed } = useLazyJson<PluginsResponse>(open, url);
  const packages = data?.packages ?? [];
  const standalone = data?.standaloneExtensions ?? [];
  // fork:zh-topbar —— 同上：插件钮的 title 之前直接复用扩展的英文状态行（而且 MCP 与
  // 插件两枚拿到的是同一串），改成中文名；明细仍在浮窗里。
  const title = t("topbar.plugins");

  return (
    <HoverPopover
      label={t("topbar.plugins")}
      icon="blocks"
      title={title}
      onOpenChange={setOpen}
    >
      {() => (
        <>
          {statuses.length > 0 && (
            <>
              <div className="d-pop-title">{t("topbar.extensionStatus")}</div>
              <StatusRows statuses={statuses} />
              <div className="d-sep" />
            </>
          )}
          {widgets.length > 0 && <ExtensionWidgets widgets={widgets} />}
          <div className="d-pop-title">{t("topbar.pluginPackages")}</div>
          {failed && <div className="d-menu-row" style={{ cursor: "default" }}>{t("topbar.pluginLoadFailed")}</div>}
          {!failed && !data && <div className="d-menu-row" style={{ cursor: "default" }}>{t("sidebar.loading")}</div>}
          {!failed && data && packages.length === 0 && standalone.length === 0 && (
            <div className="d-menu-row" style={{ cursor: "default" }}>{t("topbar.pluginNone")}</div>
          )}
          {packages.map((pkg) => (
            <div key={`${pkg.scope}:${pkg.source}`} className="d-menu-row" title={pkg.installedPath ?? pkg.source} style={{ cursor: "default" }}>
              <i
                data-ico="package"
                data-size="14"
                aria-hidden="true"
                style={{ color: pkg.status === "loaded" ? "var(--nx-success)" : "var(--nx-text-3)" }}
              ></i>
              <span className="d-grow" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {pkg.packageName ?? pkg.source}
              </span>
              {pkg.version && <span className="d-badge mute">{pkg.version}</span>}
            </div>
          ))}
          {standalone.map((ext) => (
            <div key={ext.path} className="d-menu-row" title={ext.path} style={{ cursor: "default" }}>
              <i
                data-ico="square-function"
                data-size="14"
                aria-hidden="true"
                style={{ color: ext.enabled ? "var(--nx-success)" : "var(--nx-text-3)" }}
              ></i>
              <span className="d-grow" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {ext.name}
              </span>
            </div>
          ))}
          {data && (
            <div className="d-pop-foot">
              {t("topbar.pluginTotals", {
                extensions: data.totals.extensions,
                skills: data.totals.skills,
                prompts: data.totals.prompts,
                themes: data.totals.themes,
              })}
            </div>
          )}
        </>
      )}
    </HoverPopover>
  );
}

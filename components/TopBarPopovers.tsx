"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";
import { stripAnsi } from "@/lib/ansi";
import type { ExtensionStatusItem, ExtensionWidgetItem } from "@/lib/types";
import type { McpResponse, McpServerInfo, PluginsResponse } from "@/lib/api-types";
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
 *   2. **MCP / 插件 两枚图标 + 浮窗**：原来 MCP / ponytail 是聊天区右上角一枚
 *      常驻 mono 胶囊（`ExtensionStatusFloat`）。用户要求改成顶栏两枚图标，
 *      悬停或点击出浮窗。图标取自画板 43 自己的词汇：MCP = `server`，插件 = `blocks`。
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
  style,
  onOpenChange,
  children,
}: {
  label: string;
  icon: string;
  title: string;
  badge?: ReactNode;
  width?: number;
  style?: React.CSSProperties;
  /** 浮窗开合状态外传：内容需要「打开时才拉数据」时用（不要在每次悬停都发请求）。 */
  onOpenChange?: (open: boolean) => void;
  children: (close: () => void) => ReactNode;
}) {
  const [hovered, setHovered] = useState(false);
  const [pinned, setPinned] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const open = hovered || pinned;
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
        className={`d-iconbtn${open ? " is-on" : ""}`}
        style={style}
        onClick={() => setPinned((v) => !v)}
        onMouseEnter={holdOpen}
        onMouseLeave={scheduleClose}
      >
        <i data-ico={icon} data-size="14" aria-hidden="true"></i>
        {badge}
      </button>
      <PortalDropdown open={open} anchorRef={anchorRef} panelRef={panelRef} className="d-pop-float" width={width} align="right">
        <div role="menu" onMouseEnter={holdOpen} onMouseLeave={scheduleClose}>
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
      <PortalDropdown open={open} anchorRef={anchorRef} panelRef={panelRef} className="d-pop-float" width={260} align="left">
        <div role="menu">
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
// 2 · MCP 图标
// ---------------------------------------------------------------------------

function serverDetail(server: McpServerInfo): string {
  if (server.kind === "url") return server.url ?? "url";
  if (server.kind === "socket") return server.socket ?? "socket";
  return [server.command, ...server.args].filter(Boolean).join(" ");
}

/**
 * 从扩展上报的 MCP 状态文本里取「已启用几台」。原来的常驻胶囊写的是
 * `MCP: 3 servers enabled` —— 那台数就是这个徽标的来源。取不到数字就**不显示**
 * 徽标（浮窗里的列表仍然是权威），所以文案变了也不会错得离谱。
 */
function enabledCountFromStatus(statuses: ExtensionStatusItem[]): number {
  for (const status of statuses) {
    const match = stripAnsi(status.text).match(/(\d+)/);
    if (match) return Number(match[1]);
  }
  return 0;
}

export function McpStatusButton({ cwd, statuses }: { cwd: string | null; statuses: ExtensionStatusItem[] }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const url = open && cwd ? `/api/mcp?cwd=${encodeURIComponent(cwd)}` : null;
  const { data, failed } = useLazyJson<McpResponse>(open, url);
  const servers = data?.servers ?? [];
  // 没打开过浮窗时用状态文本里的台数（零请求）；打开过就以真实配置为准。
  const enabled = data ? servers.filter((server) => !server.disabled).length : enabledCountFromStatus(statuses);
  // fork:zh-topbar —— 提示框只说本地话：扩展自己打的状态行是英文（“🔌 MCP: 3 servers
  // enabled”），那串原文留在浮窗正文（StatusRows）里，不拿到 title 上。
  const title = enabled > 0
    ? `${t("topbar.mcp")} · ${t("topbar.enabledCount", { count: enabled })}`
    : t("topbar.mcp");

  return (
    <HoverPopover
      label={t("topbar.mcp")}
      icon="server"
      title={title}
      onOpenChange={setOpen}
      badge={enabled > 0 ? (
        <span className="d-badge info" style={{ position: "absolute", top: 1, right: 1, minWidth: 13, height: 13, padding: "0 3px" }}>
          {enabled}
        </span>
      ) : undefined}
      style={{ position: "relative" }}
    >
      {() => (
        <>
          <div className="d-pop-title">{t("topbar.mcpServers")}</div>
          <StatusRows statuses={statuses} />
          {failed && <div className="d-menu-row" style={{ cursor: "default" }}>{t("topbar.mcpLoadFailed")}</div>}
          {!failed && !data && <div className="d-menu-row" style={{ cursor: "default" }}>{t("sidebar.loading")}</div>}
          {!failed && data && servers.length === 0 && <div className="d-menu-row" style={{ cursor: "default" }}>{t("topbar.mcpNone")}</div>}
          {servers.map((server) => (
            <div key={`${server.scope}:${server.name}`} className="d-menu-row" title={serverDetail(server)} style={{ cursor: "default" }}>
              <i
                data-ico={server.disabled ? "unplug" : "plug"}
                data-size="14"
                aria-hidden="true"
                style={{ color: server.disabled ? "var(--nx-text-3)" : "var(--nx-success)" }}
              ></i>
              <span className="d-grow" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {server.name}
              </span>
              <span className="d-badge mute">{server.scope === "project" ? t("mcp.scopeProject") : t("mcp.scopeGlobal")}</span>
              {server.disabled && <span className="d-badge warn">{t("mcp.itemDisabled")}</span>}
            </div>
          ))}
          {data && data.diagnostics.length > 0 && (
            <div className="d-pop-foot">{data.diagnostics[0]}</div>
          )}
        </>
      )}
    </HoverPopover>
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
      style={{ position: "relative" }}
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

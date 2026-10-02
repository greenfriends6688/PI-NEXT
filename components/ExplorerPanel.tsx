"use client";

import { useEffect, useMemo, useRef, useState, useCallback, type ReactNode } from "react";
import { loadExplorerOpen, saveExplorerOpen } from "@/lib/file-explorer-state";
import { useI18n } from "@/hooks/useI18n";
import { useIsMobile } from "@/hooks/useIsMobile";
import { DismissButton } from "./DismissButton";
import { FileExplorer, type FileExplorerHandle } from "./FileExplorer";
import { PortalDropdown, useDismissMenu } from "./PortalDropdown";
// fork:pwa-sb — 触摸安全的浮层关闭（见那里的注释）：PortalDropdown 自带的
// useDismissOnOutside 在 mousedown 上同步卸载，触摸时会把菜单项的 click 吞掉。
import { TEXT } from "@/lib/typography";

interface FileManagerAvailability {
  supported: boolean;
  reason: string | null;
  platform: string;
}

// 服务端错误码 → 可翻译文案；未收录的错误码按原文显示。
const FILE_MANAGER_ERROR_KEYS: Record<string, string> = {
  remote: "sidebar.openInExplorerRemoteOnly",
  "unsupported-platform": "sidebar.openInExplorerUnsupported",
};

/**
 * fork:design-components —— 面板头的动作钮 = 画板 30 头行右端那一排
 * `<button class="pw-iconbtn sm">`（行 113-119）：22 见方、无边框、默认弱化色、
 * hover 出深色容器、选中态 `.is-on`。视觉全部来自 board.css，本组件不写颜色、
 * 不写背景、不写尺寸 —— 调用方只给「这一瞬间是不是按下的」。
 */
function ToolbarIconButton({
  onClick,
  title,
  disabled,
  active,
  ariaPressed,
  children,
}: {
  onClick: () => void;
  title: string;
  disabled?: boolean;
  /** 画板 `.is-on`：按下 / 刚发生过一次（如刷新完成）的 momentary 状态。 */
  active?: boolean;
  /** 真正的开关（搜索、改动列表）同时给 aria-pressed。 */
  ariaPressed?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      aria-pressed={ariaPressed}
      className={`pw-iconbtn sm${active ? " is-on" : ""}`}
    >
      {children}
    </button>
  );
}

export function ExplorerPanel({
  cwd,
  projectRoot,
  onOpenFile,
  onOpenTerminal,
  explorerRefreshKey,
  onExplorerRefresh,
  onAtMention,
  onAtMentions,
  trailingActions,
}: {
  cwd: string;
  /** fork:gap08-roots — 会话所属项目根（与 cwd 不同时文件树多出一个「项目」根）。 */
  projectRoot?: string | null;
  onOpenFile: (filePath: string, fileName: string, options?: { sourceSessionId?: string | null; modeHint?: "preview" | "diff" }) => void;
  onOpenTerminal?: (cwd: string) => void;
  explorerRefreshKey?: number;
  onExplorerRefresh?: () => void;
  onAtMention?: (relativePath: string, isDir: boolean) => void;
  onAtMentions?: (relativePaths: string[]) => void;
  /** fork:ui-panel-row — panel-level buttons (new browser tab) rendered inline so
   *  the panel header stays a single row of icons. */
  trailingActions?: React.ReactNode;
}) {
  const { t } = useI18n();
  const [explorerOpen, setExplorerOpen] = useState(true);
  // PR #907 — 在系统文件管理器里打开当前工作区。
  const [fileManager, setFileManager] = useState<FileManagerAvailability | null>(null);
  const [fileManagerError, setFileManagerError] = useState<string | null>(null);
  const [explorerKey, setExplorerKey] = useState(0);
  const [explorerUploadBusy, setExplorerUploadBusy] = useState(false);
  const [fileSearchOpen, setFileSearchOpen] = useState(false);
  const [changesCount, setChangesCount] = useState(0);
  const [changesCollapsed, setChangesCollapsed] = useState(true);
  const [explorerRefreshDone, setExplorerRefreshDone] = useState(false);
  // fork:pwa-sb —— 手机档头行的「更多」（见 JSX 里的注释）。
  const isMobile = useIsMobile();
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  const morePanelRef = useRef<HTMLDivElement>(null);
  const closeMore = useCallback(() => setMoreOpen(false), []);
  useDismissMenu(moreOpen, moreRef, morePanelRef, closeMore);
  const fileExplorerRef = useRef<FileExplorerHandle>(null);
  const explorerRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restoredExplorerOpenRef = useRef(false);

  // Restore the persisted collapsed state after mount to avoid hydration drift.
  useEffect(() => {
    if (restoredExplorerOpenRef.current) return;
    restoredExplorerOpenRef.current = true;
    setExplorerOpen(loadExplorerOpen());
  }, []);

  useEffect(() => {
    if (explorerRefreshKey !== undefined) setExplorerKey((k) => k + 1);
  }, [explorerRefreshKey]);

  useEffect(() => () => {
    if (explorerRefreshTimerRef.current) clearTimeout(explorerRefreshTimerRef.current);
  }, []);

  // PR #907 — 只有服务端能弹系统窗口，而且只有浏览器跑在同一台机器上才有意义。
  // 问一次能力，按钮据此选文案（Explorer / Finder / 通用）并在不可用时置灰。
  useEffect(() => {
    let cancelled = false;
    fetch("/api/open-in-explorer")
      .then((res) => res.ok ? res.json() as Promise<FileManagerAvailability> : null)
      .then((data) => { if (!cancelled && data) setFileManager(data); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // 失败提示属于它发生的那个项目。
  useEffect(() => {
    setFileManagerError(null);
  }, [cwd, projectRoot]);

  const openInFileManager = useCallback(async () => {
    try {
      const res = await fetch("/api/open-in-explorer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd }),
      });
      if (res.ok) {
        setFileManagerError(null);
        return;
      }
      const data = await res.json().catch(() => ({})) as { error?: string };
      setFileManagerError(data.error ?? `HTTP ${res.status}`);
    } catch (error) {
      setFileManagerError(error instanceof Error ? error.message : String(error));
    }
  }, [cwd]);

  const fileManagerLabel = t(
    fileManager?.platform === "darwin"
      ? "sidebar.openInFinder"
      : fileManager?.platform === "win32"
        ? "sidebar.openInExplorer"
        : "sidebar.openInFileManager",
  );
  const fileManagerUnavailable = fileManager?.supported === false;
  const fileManagerErrorMessage = fileManagerError
    ? t(FILE_MANAGER_ERROR_KEYS[fileManagerError] ?? fileManagerError)
    : null;

  const refreshExplorer = useCallback(() => {
    if (onExplorerRefresh) onExplorerRefresh();
    else setExplorerKey((k) => k + 1);
    setExplorerRefreshDone(true);
    if (explorerRefreshTimerRef.current) clearTimeout(explorerRefreshTimerRef.current);
    explorerRefreshTimerRef.current = setTimeout(() => setExplorerRefreshDone(false), 2000);
  }, [onExplorerRefresh]);

  /* fork:pwa-sb —— 手机档收进「更多」的那几项。与桌面那一排同源（同一批动作、
     同一批文案），只是换一个容器；顺序照桌面从左到右：文件管理器 / 变更 /
     上传 / 刷新。搜索与终端留在头行（高频，且 `fileSearchOpen` 是搜索框开关）。 */
  const overflowTools = useMemo(() => {
    const tools: {
      key: string;
      icon: string;
      label: string;
      disabled?: boolean;
      onSelect: () => void;
    }[] = [
      {
        key: "file-manager",
        icon: "folder-open",
        label: fileManagerUnavailable
          ? t(fileManager?.reason === "remote" ? "sidebar.openInExplorerRemoteOnly" : "sidebar.openInExplorerUnsupported")
          : fileManagerLabel,
        disabled: fileManagerUnavailable,
        onSelect: () => { void openInFileManager(); },
      },
    ];
    if (explorerOpen) {
      tools.push({
        key: "changes",
        icon: "file-diff",
        label: changesCount > 0 ? t("sidebar.reviewChanges", { count: changesCount }) : t("sidebar.noChanges"),
        disabled: changesCount === 0,
        onSelect: () => setChangesCollapsed((v) => !v),
      });
      tools.push({
        key: "upload",
        icon: "upload",
        label: t("sidebar.uploadFilesTitle"),
        disabled: explorerUploadBusy,
        onSelect: () => fileExplorerRef.current?.openUploadPicker(),
      });
    }
    tools.push({ key: "refresh", icon: "refresh-cw", label: t("sidebar.refreshExplorer"), onSelect: refreshExplorer });
    return tools;
  }, [
    changesCount, cwd, explorerOpen, explorerUploadBusy, fileManager, fileManagerUnavailable,
    fileManagerLabel, onOpenTerminal, openInFileManager, refreshExplorer, t,
  ]);

  return (
    <div
      className="file-explorer-section"
      style={{
        height: "100%",
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        background: "var(--bg)",
      }}
    >
      {/* fork:design-components —— 面板头 = 画板 30 的 `.pw-panel-head`（行 110-120）：
          `<b>文件</b>` + `grow` 把右端一排 `.pw-iconbtn.sm` 顶到最右；高度取
          --topbar-height（36）。`file-explorer-header` 保留：globals.css 的
          min-width/overflow 与容器查询（窄栏收起标签）都挂在它上面。 */}
      <div className="file-explorer-header pw-panel-head" style={{ borderBottom: explorerOpen ? "1px solid var(--n-border-subtle)" : "none" }}>
        <button
          type="button"
          className="file-explorer-toggle pw-grow"
          onClick={() => setExplorerOpen((open) => {
            const next = !open;
            saveExplorerOpen(next);
            return next;
          })}
          /* 折叠 / 展开的触发器：画板 30 的头行没有这一枚（那里是纯 <b>），
             产品要可点，所以是 button —— UA 归零（描边/底/字体/居中）保留在
             行内，报告第 2 节给了可归并到 fork-ui.css 的写法。 */
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-ctrl)",
            minWidth: 0,
            background: "none",
            border: "none",
            color: "inherit",
            cursor: "pointer",
            font: "inherit",
            textAlign: "left",
          }}
        >
          <span className="pw-ico">
            <i data-ico={explorerOpen ? "chevron-down" : "chevron-right"} data-size="12"></i>
          </span>
          {/* Shown instead of the label once the panel is too narrow for it
              (@container query in globals.css). Ported from upstream PR #838.
              The class stays on the outer span because the container query
              toggles its display; the icon slot itself is the board's .pw-ico. */}
          <span className="file-explorer-compact-icon">
            <span className="pw-ico">
              <i data-ico="folder" data-size="15" aria-hidden="true"></i>
            </span>
          </span>
          <b className="file-explorer-title-label">{t("files.explorer")}</b>
          {/* Which directory this tree is listing: without it an empty tree is
              indistinguishable from a wrong cwd. `grow` + ellipsis = the board's
              head-row layout (label left, secondary pushed right). */}
          <span className="file-explorer-title-label pw-mono pw-dim pw-grow" title={cwd}>
            {cwd.split(/[\/]/).filter(Boolean).at(-1) ?? cwd}
          </span>
        </button>
        {/* fork:pwa-sb —— 手机档（≤640px）头行只留「标题 + 搜索 / 终端 / 更多」。
            桌面端是七枚一字排开（画板 30 头行那一排），但 390 宽下每枚 22px、
            中心距只有 26px：按到 40px 命中区必须每侧外扩 9px，相邻两枚就会重叠
            14px —— 手指按哪一枚全看绘制顺序。与其抢命中，不如收进「更多」：
            菜单项是 `.pw-prow`（手机 44px 高），标题也多出 130px。
            留在行内的是两个高频动作（搜索 / 终端）；其余五枚（文件管理器 / 变更 /
            上传 / 刷新 + 头行那枚新建标签由 AppShell 递进来）走「更多」，
            新建标签是 trailingActions，两档都渲染。
            桌面端不渲染 ⋯，那一排一字未动（画板 30 的对位不受影响）。 */}
        {isMobile ? (
          <>
            <ToolbarIconButton
              onClick={() => setFileSearchOpen((open) => !open)}
              title={t("sidebar.searchFiles")}
              active={fileSearchOpen}
              ariaPressed={fileSearchOpen}
            >
              <span className="pw-ico"><i data-ico="search" data-size="14" aria-hidden="true"></i></span>
            </ToolbarIconButton>
            {onOpenTerminal && (
              <ToolbarIconButton onClick={() => onOpenTerminal(cwd)} title={t("terminal.open")}>
                <span className="pw-ico"><i data-ico="square-terminal" data-size="14" aria-hidden="true"></i></span>
              </ToolbarIconButton>
            )}
            <div ref={moreRef} className="fork-pwa-sb-tools-more">
              <ToolbarIconButton
                onClick={() => setMoreOpen((open) => !open)}
                title={t("chat.moreControls")}
                active={moreOpen}
                ariaPressed={moreOpen}
              >
                <span className="pw-ico"><i data-ico="ellipsis" data-size="14" aria-hidden="true"></i></span>
              </ToolbarIconButton>
              <PortalDropdown
                open={moreOpen}
                anchorRef={moreRef}
                panelRef={morePanelRef}
                className="pw-pop fork-pwa-sb-menu"
                width={210}
                align="right"
              >
                <div role="menu" aria-label={t("chat.moreControls")}>
                  {overflowTools.map((tool) => (
                    <button
                      key={tool.key}
                      type="button"
                      role="menuitem"
                      className="pw-prow"
                      style={{ width: "100%" }}
                      onClick={() => { closeMore(); if (tool.disabled) return; tool.onSelect(); }}
                      disabled={tool.disabled}
                    >
                      <span className="pw-ico">
                        <i data-ico={tool.icon} data-size="14" aria-hidden="true"></i>
                      </span>
                      {tool.label}
                    </button>
                  ))}
                </div>
              </PortalDropdown>
            </div>
          </>
        ) : (
          <>
        {/* PR #907 — 在系统文件管理器里打开当前工作区（终端按钮左侧）。字形取画板 30
            头行那一枚（行 114 `folder-open`）；平台差异由 title 文案承担
            （Finder / 资源管理器 / 通用），不再另画一套平台图标。 */}
        <ToolbarIconButton
          onClick={() => { void openInFileManager(); }}
          disabled={fileManagerUnavailable}
          title={fileManagerUnavailable
            ? t(fileManager?.reason === "remote" ? "sidebar.openInExplorerRemoteOnly" : "sidebar.openInExplorerUnsupported")
            : fileManagerLabel}
        >
          <span className="pw-ico"><i data-ico="folder-open" data-size="14" aria-hidden="true"></i></span>
        </ToolbarIconButton>
        {onOpenTerminal && (
          <ToolbarIconButton
            onClick={() => onOpenTerminal(cwd)}
            title={t("terminal.open")}
          >
            <span className="pw-ico"><i data-ico="square-terminal" data-size="14" aria-hidden="true"></i></span>
          </ToolbarIconButton>
        )}
        {/* fork:ui-review-button — the changed-files switch was hidden entirely
            while the tree was clean (so the "review" affordance disappeared) and
            its glyph read as a minus. It now stays in the row, names itself, and
            wears the board's diff glyph. */}
        {explorerOpen && (
          <ToolbarIconButton
            onClick={() => setChangesCollapsed((v) => !v)}
            disabled={changesCount === 0}
            title={changesCount > 0
              ? t("sidebar.reviewChanges", { count: changesCount })
              : t("sidebar.noChanges")}
            active={changesCount > 0 && !changesCollapsed}
            ariaPressed={changesCount > 0 && !changesCollapsed}
          >
            <span className="pw-ico"><i data-ico="file-diff" data-size="14" aria-hidden="true"></i></span>
          </ToolbarIconButton>
        )}
        {explorerOpen && (
          <ToolbarIconButton
            onClick={() => {
              setFileSearchOpen((open) => !open);
            }}
            title={t("sidebar.searchFiles")}
            active={fileSearchOpen}
            ariaPressed={fileSearchOpen}
          >
            <span className="pw-ico"><i data-ico="search" data-size="14" aria-hidden="true"></i></span>
          </ToolbarIconButton>
        )}
        {explorerOpen && (
          <ToolbarIconButton
            onClick={() => fileExplorerRef.current?.openUploadPicker()}
            disabled={explorerUploadBusy}
            title={t("sidebar.uploadFilesTitle")}
          >
            <span className="pw-ico"><i data-ico="upload" data-size="14" aria-hidden="true"></i></span>
          </ToolbarIconButton>
        )}
        <ToolbarIconButton
          onClick={refreshExplorer}
          title={t("sidebar.refreshExplorer")}
          active={explorerRefreshDone}
        >
          <span className="pw-ico">
            <i data-ico={explorerRefreshDone ? "check" : "refresh-cw"} data-size="14" aria-hidden="true"></i>
          </span>
        </ToolbarIconButton>
          </>
        )}
        {/* fork:ui-panel-row —— 调用方（AppShell）递进来的面板级动作（新建浏览器
            标签）。两档都渲染：手机档它与「搜索 / 更多」同属头行右端那一小段，
            间距由 `fork:pwa-sb-hit-pitch` 兜住。 */}
        {trailingActions}
      </div>
      {fileManagerErrorMessage && (
        <div role="alert" style={{ display: "flex", alignItems: "flex-start", gap: "var(--space-row)", padding: "0 10px 6px", fontSize: TEXT["2xs"], lineHeight: 1.35, color: "var(--danger)" }}>
          <span style={{ minWidth: 0, flex: 1, overflowWrap: "anywhere" }}>{fileManagerErrorMessage}</span>
          <DismissButton onClick={() => setFileManagerError(null)} title={t("files.dismissError")} />
        </div>
      )}
      {explorerOpen && (
        <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden" }}>
          <FileExplorer
            ref={fileExplorerRef}
            cwd={cwd}
            projectRoot={projectRoot}
            onOpenFile={onOpenFile}
            refreshKey={explorerKey}
            onAtMention={onAtMention}
            onAtMentions={onAtMentions}
            onUploadBusyChange={setExplorerUploadBusy}
            /* PR #899 — 新建/重命名/删除/解压后在树里刷一次（上游把这一行加在
               SessionSidebar，本 fork 的文件树在 ExplorerPanel）。 */
            onFileMutated={onExplorerRefresh}
            changesCollapsed={changesCollapsed}
            onChangesCountChange={setChangesCount}
            fileSearchOpen={fileSearchOpen}
            onFileSearchOpenChange={setFileSearchOpen}
          />
        </div>
      )}
    </div>
  );
}

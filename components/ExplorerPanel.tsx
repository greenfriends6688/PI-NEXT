"use client";

import { useEffect, useMemo, useRef, useState, useCallback, type ReactNode } from "react";
import { loadExplorerOpen, saveExplorerOpen } from "@/lib/file-explorer-state";
import { useI18n } from "@/hooks/useI18n";
import { useIsMobile } from "@/hooks/useIsMobile";
import { DismissButton } from "./DismissButton";
import { FileExplorer, type FileExplorerHandle, readExplorerPanelViewState, writeExplorerPanelViewState, type ExplorerPanelViewState } from "./FileExplorer";
import { PortalDropdown, useDismissMenu } from "./PortalDropdown";
// fork:pwa-sb — 触摸安全的浮层关闭（见那里的注释）：PortalDropdown 自带的
// useDismissOnOutside 在 mousedown 上同步卸载，触摸时会把菜单项的 click 吞掉。

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
 * fork:file-tree-slot-swap — 按 cwd 取一次上一次的面板视图，同 cwd 的重挂不重取。
 *
 * 与 FileExplorer 里那棵树的快照是同一件事的两半（数据在树里，开关在这里），
 * 放在一起是因为它们回答同一个问题：**右栏把面板搬了槽以后该怎么看起来没搬过。**
 */
function usePanelViewState(cwd: string): ExplorerPanelViewState | null {
  const ref = useRef<{ cwd: string; state: ExplorerPanelViewState | null } | null>(null);
  if (ref.current === null || ref.current.cwd !== cwd) {
    ref.current = { cwd, state: readExplorerPanelViewState(cwd) };
  }
  return ref.current.state;
}

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
      className={`d-iconbtn${active ? " is-on" : ""}`}
    >
      {children}
    </button>
  );
}

/**
 * M-06 帧 A · 手机档顶栏钮（`.m-top-btn`）—— 与桌面的 `.d-iconbtn` 同一个语义
 * （一枚动作钮），只是形态换成手机顶栏那一颗 44px 圆钮。
 */
function MobileTopBarButton({
  onClick,
  title,
  disabled,
  pressed,
  children,
}: {
  onClick: () => void;
  title: string;
  disabled?: boolean;
  pressed?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      aria-pressed={pressed}
      className="m-top-btn"
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
  openChangesSignal,
  onReviewCountChange,
  inPanel,
  onHideColumn,
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
  /* fork:v5-m12 —— M-12 帧 A 六行里的「审查」与 M-06 帧 E 是**同一个入口**：
   * 2026-10-03 裁定删掉了独立改动 tab，改动清单只留在文件树里这一处。
   * 那手机右栏选单要能从外面把这一节叫开，就是这两行：
   *   · openChangesSignal 递增 = 进来一次（不接管用户手折叠）；
   *   · onReviewCountChange 把这一节的真实条数报给 AppShell，写进选单那一行。
   * 之前 AppShell 里的 changesOpen / changesUnseen 声明了但没人用，选单因此
   * 永远只有两行（轨迹 / Git）——「六项常驻」写在脚注上，行却不到六块。 */
  openChangesSignal?: number;
  onReviewCountChange?: (count: number) => void;
  /* fork:v5-m12-pane —— 转发给 FileExplorer：这一份树是不是挂在 M-12 那个 pane 里
     （那条路上上头已经有切换条了，树自己不要再画一条 `.m-top`）。 */
  inPanel?: boolean;
  /* fork:explorer-column-toggle —— 把整列往右收起（不是折叠树内容）。只有挂在
     AppShell 的右侧那一列时才由调用方传进来。 */
  onHideColumn?: () => void;
}) {
  const { t } = useI18n();
  const [explorerOpen, setExplorerOpen] = useState(true);
  // PR #907 — 在系统文件管理器里打开当前工作区。
  const [fileManager, setFileManager] = useState<FileManagerAvailability | null>(null);
  const [fileManagerError, setFileManagerError] = useState<string | null>(null);
  const [explorerKey, setExplorerKey] = useState(0);
  const [explorerUploadBusy, setExplorerUploadBusy] = useState(false);
  /* fork:search-off-by-default（2026-10-05 用户裁定）—— 搜索**默认收起**：
     用户反馈「文件树默认进来是选中搜索按钮」。筛选条（输入框）现在与头行那枚
     search 钮同一个开关（`FileExplorer` 桌面档按 `fileSearchOpen` 画这一行，
     手机档本来就这么画），所以进来是一棵干净的树，要筛再点。 */
  /* fork:file-tree-slot-swap —— 这两个开关原本是纯组件 state，而本面板会被右栏
     在两个槽之间搬（没开文件时占满面板，第一个文件打开后变成树那一列），搬一次
     就是一次重挂：「已改动的文件」会被折回去、筛选条会自己关掉 —— 用户刚点开的
     那一栏在他眼前消失。按 cwd 记住上一份视图，重挂后原样回来。 */
  const panelView = usePanelViewState(cwd);
  const [fileSearchOpen, setFileSearchOpen] = useState(panelView?.fileSearchOpen ?? false);
  const [changesCount, setChangesCount] = useState(0);
  const [changesCollapsed, setChangesCollapsed] = useState(panelView?.changesCollapsed ?? true);
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

  // fork:v5-m12 —— 从右栏选单的「审查」行进来时展开改动那一节（见 props 注释）。
  useEffect(() => {
    if (openChangesSignal) setChangesCollapsed(false);
  }, [openChangesSignal]);

  // fork:v5-m12 —— 真实条数往上报一层，好让选单那行写「N 个文件待看」。
  const reportChangesCount = useCallback((n: number) => {
    setChangesCount(n);
    onReviewCountChange?.(n);
  }, [onReviewCountChange]);

  // fork:file-tree-slot-swap —— 每次切换都记一份（按 cwd，所以换项目不会串）。
  useEffect(() => {
    writeExplorerPanelViewState(cwd, { changesCollapsed, fileSearchOpen });
  }, [cwd, changesCollapsed, fileSearchOpen]);

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
     上传 / 刷新。搜索与终端留在头行（高频，且 `fileSearchOpen` 是搜索框开关）。 */  const overflowTools = useMemo(() => {
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

  /* M-06 帧 A —— 手机档顶栏右侧那一小段动作。**与桌面头行是同一批 state / 同一批
     handler**，只是容器从 `.d-panel-head` 换成 `.m-top`：手机上「层级由顶栏路径承担」，
     顶栏归 `FileExplorer` 自己画（它才知道当前在哪一层），所以这里把动作原样递下去，
     不在手机档另写一套（原来那套 `.d-iconbtn` 手机分支已删）。 */
  const mobileTopBar = (
    <>
      <MobileTopBarButton
        onClick={() => setFileSearchOpen((open) => !open)}
        title={t("sidebar.searchFiles")}
        pressed={fileSearchOpen}
      >
        <i data-ico="search" data-size="16" aria-hidden="true"></i>
      </MobileTopBarButton>
      {onOpenTerminal && (
        <MobileTopBarButton onClick={() => onOpenTerminal(cwd)} title={t("terminal.open")}>
          <i data-ico="square-terminal" data-size="16" aria-hidden="true"></i>
        </MobileTopBarButton>
      )}
      <div ref={moreRef} className="fork-pwa-sb-tools-more">
        <MobileTopBarButton
          onClick={() => setMoreOpen((open) => !open)}
          title={t("chat.moreControls")}
          pressed={moreOpen}
        >
          <i data-ico="ellipsis" data-size="16" aria-hidden="true"></i>
        </MobileTopBarButton>
        <PortalDropdown
          open={moreOpen}
          anchorRef={moreRef}
          panelRef={morePanelRef}
          className="d-pop fork-pwa-sb-menu"
          width={210}
          align="right"
        >
          <div role="menu" aria-label={t("chat.moreControls")}>
            {overflowTools.map((tool) => (
              <button
                key={tool.key}
                type="button"
                role="menuitem"
                className="d-menu-row"
                style={{ width: "100%" }}
                onClick={() => { closeMore(); if (tool.disabled) return; tool.onSelect(); }}
                disabled={tool.disabled}
              >
                <i data-ico={tool.icon} data-size="14" aria-hidden="true"></i>
                {tool.label}
              </button>
            ))}
          </div>
        </PortalDropdown>
      </div>
    </>
  );

  return (
    /* fork:v5-skin D-05 帧 A —— 文件面板：头行照画板 .d-panel-head（folder + .d-viewer-path
       + 右端 .d-iconbtn），树本体由 FileExplorer 渲染 .d-tree / .d-trow。
       `file-explorer-section` / `file-explorer-header` 保留：globals.css 的容器查询（窄栏收起
       标题、换成徽标）与 min-width/overflow 都挂在它们上面，是功能钩子不是视觉来源。 */
    <div
      className="file-explorer-section d-col"
      style={{
        height: "100%",
        minHeight: 0,
        gap: 0,
        overflow: "hidden",
      }}
    >
      {/* M-06 帧 A —— 手机档不画这一行：`.m-top`（返回 / 路径 / 筛选 / 新建）由
          `FileExplorer` 自己画，它才知道当前在哪一层；宿主只把动作递进去。
          头行的折叠开关在手机上也没有落点（整块面板由 AppShell 的面板钮开关），
          所以 `isMobile` 时树**始终**展开，不再受持久化的折叠态影响。 */}
      {!isMobile && (
      <div className="file-explorer-header d-panel-head" style={{ borderBottom: explorerOpen ? "1px solid var(--nx-line)" : "none" }}>
        <button
          type="button"
          className="file-explorer-toggle d-grow"
          onClick={() => setExplorerOpen((open) => {
            const next = !open;
            saveExplorerOpen(next);
            return next;
          })}
          /* 折叠 / 展开的触发器：画板的头行没有这一枚（那里是纯路径 + 动作钮），
             产品要可点，所以是 button —— UA 归零保留在行内。 */
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--nx-sp-1)",
            minWidth: 0,
            background: "none",
            border: "none",
            color: "inherit",
            cursor: "pointer",
            font: "inherit",
            textAlign: "left",
            padding: 0,
          }}
        >
          <i data-ico={explorerOpen ? "chevron-down" : "chevron-right"} data-size="12" aria-hidden="true"></i>
          {/* fork:v5-landing D-05 帧 A —— 板面头行是 `i[folder]` + `span.d-grow.d-viewer-path`
              两件；产品此前给 folder 图标又套了一层 `span.file-explorer-compact-icon`，
              于是这一行多出一件、头行骨架与板面对不上。该类是容器查询钩子
              （globals.css：窄容器时 `display:block`、否则 `none`），挂在 `<i>` 上
              行为完全一致，所以类搬回图标本身、那层壳去掉。 */}
          <i className="file-explorer-compact-icon" data-ico="folder" data-size="14" aria-hidden="true"></i>
          <b className="file-explorer-title-label">{t("files.explorer")}</b>
          {/* 这棵树列的是哪个目录：没有它，空树与错的 cwd 看起来一样。 */}
          <span className="file-explorer-title-label d-viewer-path d-grow" title={cwd}>
            {cwd.split(/[\/]/).filter(Boolean).at(-1) ?? cwd}
          </span>
        </button>
        {/* fork:pwa-sb —— 手机档（≤640px）头行只留「标题 + 搜索 / 终端 / 更多」。
            桌面端是七枚一字排开（画板 30 头行那一排），但 390 宽下每枚 22px、
            中心距只有 26px：按到 40px 命中区必须每侧外扩 9px，相邻两枚就会重叠
            14px —— 手指按哪一枚全看绘制顺序。与其抢命中，不如收进「更多」：
            菜单项是 `.d-menu-row`（手机 44px 高），标题也多出 130px。
            留在行内的是两个高频动作（搜索 / 终端）；其余五枚（文件管理器 / 变更 /
            上传 / 刷新 + 头行那枚新建标签由 AppShell 递进来）走「更多」，
            新建标签是 trailingActions，两档都渲染。
            桌面端不渲染 ⋯，那一排一字未动（画板 30 的对位不受影响）。
            —— 2026-10-04（Wave B / M-06）：手机档这一行整体移入 `.m-top`，
               桌面那一排 `.d-iconbtn` 原样保留，两处是同一批动作的两个容器。 */}
        {(
          <>
        {/* PR #907 — 在系统文件管理器里打开当前工作区（终端按钮左侧）。字形取画板
            头行那一枚（`folder-open`）；平台差异由 title 文案承担
            （Finder / 资源管理器 / 通用），不再另画一套平台图标。 */}
        <ToolbarIconButton
          onClick={() => { void openInFileManager(); }}
          disabled={fileManagerUnavailable}
          title={fileManagerUnavailable
            ? t(fileManager?.reason === "remote" ? "sidebar.openInExplorerRemoteOnly" : "sidebar.openInExplorerUnsupported")
            : fileManagerLabel}
        >
          <i data-ico="folder-open" data-size="14" aria-hidden="true"></i>
        </ToolbarIconButton>
        {/* fork:panel-head-actions —— 2026-10-06 用户裁定：终端那一枚搬去了面板头行
            （排在 git 钮后面，`AppShell.tsx` 里），文件树头行不再重复 —— 这一行是
            「这一块文件树自己的动作」，面板级的动作归面板头。手机档的 `.m-top`
            里那枚（上面 `MobileTopBarButton`）不动。 */}
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
            <i data-ico="file-diff" data-size="14" aria-hidden="true"></i>
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
            <i data-ico="search" data-size="14" aria-hidden="true"></i>
          </ToolbarIconButton>
        )}
        {explorerOpen && (
          <ToolbarIconButton
            onClick={() => fileExplorerRef.current?.openUploadPicker()}
            disabled={explorerUploadBusy}
            title={t("sidebar.uploadFilesTitle")}
          >
            <i data-ico="upload" data-size="14" aria-hidden="true"></i>
          </ToolbarIconButton>
        )}
        <ToolbarIconButton
          onClick={refreshExplorer}
          title={t("sidebar.refreshExplorer")}
          active={explorerRefreshDone}
        >
          <i data-ico={explorerRefreshDone ? "check" : "refresh-cw"} data-size="14" aria-hidden="true"></i>
        </ToolbarIconButton>
          </>
        )}
        {/* fork:ui-panel-row —— 调用方（AppShell）递进来的面板级动作（新建浏览器
            标签）。两档都渲染：手机档它与「搜索 / 更多」同属头行右端那一小段，
            间距由 `fork:pwa-sb-hit-pitch` 兜住。 */}
        {trailingActions}
        {/* fork:explorer-column-toggle —— 整列收起（往右走），排在头行最右端。
            用户 2026-10-09：「文件树隐藏是往右隐藏，不是向上折叠」——头行那个带
            箭头的大钮折的是**树内容**，这一枚收的是**整列**。 */}
        {!isMobile && onHideColumn && (
          <ToolbarIconButton onClick={onHideColumn} title={t("files.hideExplorer")}>
            <i data-ico="chevrons-right-left" data-size="14" aria-hidden="true"></i>
          </ToolbarIconButton>
        )}
      </div>
      )}
      {fileManagerErrorMessage && (
        /* M-06 —— 手机档同一条横幅换成 `.m-banner.err`（视觉同源，语义一样）。 */
        isMobile ? (
          <div role="alert" className="m-banner err" style={{ margin: "8px 12px" }}>
            <i data-ico="circle-alert" data-size="14" aria-hidden="true"></i>
            <span className="m-grow" style={{ overflowWrap: "anywhere" }}>{fileManagerErrorMessage}</span>
            <DismissButton onClick={() => setFileManagerError(null)} title={t("files.dismissError")} />
          </div>
        ) : (
          <div role="alert" className="d-banner err" style={{ margin: "var(--nx-sp-1)" }}>
            <i data-ico="circle-alert" data-size="14" aria-hidden="true"></i>
            <span className="d-grow" style={{ overflowWrap: "anywhere" }}>{fileManagerErrorMessage}</span>
            <DismissButton onClick={() => setFileManagerError(null)} title={t("files.dismissError")} />
          </div>
        )
      )}
      {/* 手机档不受持久化的折叠态影响：那一行的折叠开关在 `.m-top` 上没有落点，
          整块面板由 AppShell 的面板钮开关，所以这里始终展开。 */}
      {(explorerOpen || isMobile) && (
        isMobile ? (
          <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
            <FileExplorer
              ref={fileExplorerRef}
              cwd={cwd}
              projectRoot={projectRoot}
              onOpenFile={onOpenFile}
              refreshKey={explorerKey}
              onAtMention={onAtMention}
              onAtMentions={onAtMentions}
              onUploadBusyChange={setExplorerUploadBusy}
              onFileMutated={onExplorerRefresh}
              changesCollapsed={changesCollapsed}
              onChangesCountChange={reportChangesCount}
              fileSearchOpen={fileSearchOpen}
              onFileSearchOpenChange={setFileSearchOpen}
              /* 宿主那一排动作原样递进 `.m-top`（见上面 `mobileTopBar` 的注释）。 */
              mobileTopBar={mobileTopBar}
              inPanel={inPanel}
            />
          </div>
        ) : (
        <div className="d-panel-body" style={{ flex: 1, minHeight: 0, padding: 0 }}>
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
            onChangesCountChange={reportChangesCount}
            fileSearchOpen={fileSearchOpen}
            onFileSearchOpenChange={setFileSearchOpen}
            inPanel={inPanel}
          />
        </div>
        )
      )}
    </div>
  );
}

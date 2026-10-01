"use client";

/** fork:gap-auto-name — 自动命名尝试标记的持久化键与读写（只保留最近 50 条）。 */
const AUTO_NAME_ATTEMPTED_KEY = "pi-web:auto-name-attempted";
function readAutoNameAttempts(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(AUTO_NAME_ATTEMPTED_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}
function readAutoNameAttempted(sessionId: string): boolean {
  return readAutoNameAttempts().includes(sessionId);
}
function markAutoNameAttempted(sessionId: string): void {
  if (typeof window === "undefined") return;
  try {
    const next = [sessionId, ...readAutoNameAttempts().filter((id) => id !== sessionId)].slice(0, 50);
    window.localStorage.setItem(AUTO_NAME_ATTEMPTED_KEY, JSON.stringify(next));
  } catch {
    // 存储不可用时退化为「本次运行只尝试一次」，不影响命名本身。
  }
}

import { useState, useCallback, useRef, useEffect, useLayoutEffect, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useGlobalKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { SessionSidebar } from "./SessionSidebar";
import { ChatWindow } from "./ChatWindow";
import type { ChatScrollPosition } from "@/lib/chat-scroll-position";
import { FileViewer, type FileLocationTarget, type FileSelectionContext } from "./FileViewer";
import { TabBar, type Tab } from "./TabBar";
import { openFileTab, saveFileViewerState } from "./file-tab-state";
// fork:zc-06 — 「最近关闭」快照的纯逻辑与存储。
import { forgetClosedTab, loadRecentClosedTabs, recordClosedTab, saveRecentClosedTabs, type RestorableTab } from "@/lib/recent-closed-tabs";
import { loadSessionList } from "@/lib/session-list";
import { mergeCatalogRow } from "./session-catalog-helpers";
import { loadRightTabs, saveRightTabs } from "@/lib/right-tabs-memory";
import { resolveRestoreTarget } from "@/lib/workspace-restore";
import { GitGraphTab } from "./GitGraphTab";
// fork:zc-05 — 右栏「变更」单例 tab。
import { SettingsPanel } from "./SettingsPanel";
import { ExplorerPanel } from "./ExplorerPanel";
import { ProjectTrustDialog } from "./ProjectTrustDialog";
import { InstallPromptBanner } from "./fork/InstallPromptBanner";
import { DirectoryPicker } from "./DirectoryPicker";
import { BranchNavigator, hasSessionBranches } from "./BranchNavigator";
// fix:mcp-topbar-icons —— 顶栏右侧两枚状态图标（MCP / 插件）+ 可点的分支芯片。
import { BranchChip, McpStatusButton, PluginStatusButton } from "./TopBarPopovers";
// fix:new-session-pick-dir / topbar-chip-clickable —— 工作区芯片复用输入框上方那枚
// `.pw-chip`（项目列表 + 打开文件夹）。NewSessionTargets 类型来自 ProjectChip。
import type { NewSessionTargets } from "./fork/ProjectChip";
import { SystemPromptPanel } from "./SystemPromptPanel";
import { ToolDefinitionsPanel } from "./ToolDefinitionsPanel";
import { AgentSessionPanel } from "./AgentSessionPanel";
import { TerminalPanel } from "./TerminalPanel";
import { newTerminalTab, restoreTerminalTabs, TERMINAL_TABS_KEY, type TerminalTab } from "./terminal-tab-state";
import { BrowserPanel } from "./BrowserPanel";
import { browserTabLabel, BROWSER_TABS_KEY, newBrowserTab, restoreBrowserTabs, type BrowserTab } from "./browser-tab-state";
import { useTheme } from "@/hooks/useTheme";
import { pickDirectory } from "@/lib/pick-directory";
import { useI18n } from "@/hooks/useI18n";
import { useIsMobile, useIsNarrowMobile, useIsCompact } from "@/hooks/useIsMobile";
import { useViewportHeight } from "@/hooks/useViewportHeight";
// fix:field-focus-modality —— 输入模态标记（焦点环只在键盘焦点时出现，规范 §1.4）。
import { useFocusModality } from "@/hooks/useFocusModality";
import { useResizablePanel } from "@/hooks/useResizablePanel";
// fork:zn-16 — 通知开关矩阵（Zeno 通知页）：取值走 getNotificationPrefs()，
// hook 只用来订阅「设置里改了开关」。
import { getNotificationPrefs, useNotificationPrefs } from "@/hooks/useNotificationPrefs";
import { useAudio } from "@/hooks/useAudio";
import { copyText } from "@/lib/clipboard";
import { sendAgentCommand } from "@/lib/agent-client";
import { getFileName, joinFilePath, sameFilePath } from "@/lib/file-paths";
import { getFileExt } from "@/lib/file-types";
import { buildAtMentionText, buildFileAtMentionsText } from "@/lib/file-fuzzy";
import {
  claimExtensionAttentionNotification,
  shouldShowBrowserNotification,
  showBrowserNotification,
} from "@/lib/browser-notifications";
import { setupPushSubscription } from "@/lib/push-client";
import { getInitialNavigation, withTabOpen } from "@/lib/initial-navigation";
// fork:tab-session — reload restores *this* tab's session, not the shared workspace memory.
import { clearTabOpenSession, getTabOpen, setTabOpenNewSession, setTabOpenSession } from "@/lib/tab-session";
import {
  getDesktopBridge,
  markDesktopShell,
  setDesktopBadge,
  setDesktopKeepAwake,
} from "@/lib/desktop-shell";
import { getRecentProjects, withoutChatProject } from "@/lib/project-groups";
import { rekeyDraft } from "@/lib/draft-store";
import {
  createSelectionContextId,
  serializeSessionReferenceClipboard,
  type SessionReference,
} from "@/lib/composer-context";
import type { SessionRowContextMenuDetail } from "@/lib/session-row-context-menu";
import { ContextMenuProvider } from "./ContextMenu";
import { LinkOpenProvider } from "./LinkOpenContext";
import type { NewSessionProject } from "./fork/ProjectChip";
// fork:proma-05-explore — 右栏并排看探索分支（只读）
import { ExplorationPane } from "./fork/ExplorationPane";
import { SessionRowContextMenuBridge } from "./SessionRowContextMenuBridge";
import { WallpaperLayer } from "./WallpaperLayer";
import { initWallpaper } from "@/hooks/useWallpaper";
import {
  clearLastOpen,
  getLastOpenSession,
  setLastOpenSession,
  workspaceKeyOf,
} from "@/lib/workspace-memory";
import {
  getDefaultRightPanelWidth,
  getRightPanelMaxWidth,
  getSidebarMaxWidth,
  RIGHT_PANEL_FALLBACK_WIDTH,
  RIGHT_PANEL_MAX_WIDTH,
  RIGHT_PANEL_MIN_WIDTH,
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
} from "@/lib/panel-layout";
import type { BlockingExtensionUiRequest, ExtensionStatusItem, ExtensionWidgetItem, SessionInfo, SessionTreeNode } from "@/lib/types";
import type { ProjectTrustStatus } from "@/lib/api-types";
import type { ChatInputHandle } from "./ChatInput";
import type { SessionStatsInfo } from "@/lib/pi-types";
import type { FileViewerState } from "@/lib/file-viewer-state";
import type { ToolEntry } from "@/lib/tool-presets";
import { getSessionFamily } from "@/lib/session-family";
import { getLastSettingsSection, type SettingsSection } from "@/lib/settings-navigation";
import { TEXT } from "@/lib/typography";
import { formatRelativeTime } from "@/lib/i18n/format";

type AutoNameStatus =
  | { kind: "idle" }
  | { kind: "naming" }
  | { kind: "success" }
  | { kind: "error"; message: string };

const TOP_BAR_ICON_BUTTON_SIZE = "var(--topbar-icon-size, 28px)";
// The tree column beside a document only renders when the panel is this wide
// (see the container query on .file-panel-body).
// Widened once when a document opens. Kept at 760 deliberately: on a wide screen the
// comfortable tree+viewer width is what the user wants, and app/fork-ui.css lowers only
// the *floor* to 560 so a clamped (narrow-window) panel still shows the tree at all.
const EXPLORER_COLUMN_MIN_PANEL_WIDTH = 760;
/** fork:git-graph-tab — 单例图谱 tab 的 id（不与文件 tab 的 `file:<path>` 撞名）。 */
const GIT_GRAPH_TAB_ID = "git-graph";
/** fork:zc-05 — 单例变更面板 tab 的 id。 */
const AGENT_PANEL_WIDTH = 420;
/* fork:top-panel-anchor —— 画板 22 的 `.pw-pop` 是 320 宽；系统提示词 / 工具两个
   浮层的内容按这个宽度排版。Agent 面板有自己的宽度（上方 AGENT_PANEL_WIDTH）。 */
const TOP_BAR_PANEL_WIDTH = 320;
/* fix:tools-panel-width —— 工具定义是**双栏**面板（左列表 + 右详情，画板 22 给了
   300px 列表 + 自适应详情 + 四列表格）。按 320 宽排版时左栏被 clamp 到 112px，工具名
   被挤成一个字母加省略号（"I…" / "b…"），右栏正文逐字换行 —— 这就是「没引用成功」
   的观感来源。给它一个真正装得下双栏的宽度，其余单栏浮层仍走 320。 */
const TOP_BAR_WIDE_PANEL_WIDTH = 860;
/** Below this rendered panel width the tree column is dropped so the document keeps room. */

function parkedNewSessionDraftKey(cwd: string): string {
  return `parked-new:${cwd}`;
}

export function AppShell() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [initialNavigation, setInitialNavigation] = useState(() => getInitialNavigation(searchParams));
  // Keep the system-theme subscription mounted for the lifetime of the app.
  useTheme();
  const { locale, t: translate } = useI18n();
  const isMobile = useIsMobile();
  const isCompact = useIsCompact();
  const isNarrowMobile = useIsNarrowMobile();
  useViewportHeight();
  // fix:field-focus-modality —— 全局输入模态标记（样式层据此决定字段要不要画焦点框）。
  useFocusModality();
  const appShellRef = useRef<HTMLDivElement>(null);

  // Once the user has granted notification permission, register a Web Push
  // subscription so the server can notify backgrounded PWAs (notably iOS,
  // which suspends page JS and never receives the SSE completion event).
  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission !== "granted") return;
    void setupPushSubscription(locale);
  }, [locale]);
  // Audio ownership lives here (not in ChatWindow) so the completion tone can
  // also fire for tasks finishing in a non-active workspace whose ChatWindow
  // is not mounted. ChatWindow receives the audio callbacks as props.
  const { soundEnabled, onSoundToggle, playDoneSound, unlockAudio, soundEnabledRef } = useAudio();
  const [quoteSelectionEnabled, setQuoteSelectionEnabled] = useState(false);
  useEffect(() => {
    try {
      setQuoteSelectionEnabled(localStorage.getItem("pi-quote-selection-enabled") === "true");
    } catch {
      // Browser storage is best-effort.
    }
  }, []);
  const handleQuoteSelectionChange = useCallback((enabled: boolean) => {
    setQuoteSelectionEnabled(enabled);
    try {
      localStorage.setItem("pi-quote-selection-enabled", String(enabled));
    } catch {
      // Keep the current page usable when storage is unavailable.
    }
  }, []);
  const notifiedAttentionRequestIdsRef = useRef(new Set<string>());
  const handleBackgroundTaskDone = useCallback(() => {
    if (soundEnabledRef.current) playDoneSound();
  }, [playDoneSound, soundEnabledRef]);
  const [selectedSession, setSelectedSession] = useState<SessionInfo | null>(null);
  const [sessionCatalog, setSessionCatalog] = useState<SessionInfo[]>([]);
  const handleSessionsChange = useCallback((sessions: SessionInfo[]) => {
    setSessionCatalog(sessions);
    // The sidebar hydrates metadata after the selected session has already
    // mounted. Merge that update into the active session without changing the
    // ChatWindow key or restarting its history load.
    setSelectedSession((current) => {
      if (!current) return current;
      const refreshed = sessions.find((session) => session.id === current.id);
      return refreshed ? mergeCatalogRow(current, refreshed) : current;
    });
  }, []);
  const sessionsWithSelection = useMemo(() => {
    if (!selectedSession) return sessionCatalog;
    return [
      ...sessionCatalog.filter((session) => session.id !== selectedSession.id),
      selectedSession,
    ];
  }, [selectedSession, sessionCatalog]);
  const activeSessionFamily = useMemo(
    () => getSessionFamily(sessionsWithSelection, selectedSession?.id),
    [selectedSession?.id, sessionsWithSelection],
  );
  const hasSubagentSessions = Boolean(activeSessionFamily?.subagents.length);
  const [runningSessionIds, setRunningSessionIds] = useState<Set<string>>(() => new Set());
  // fork:gap-perf-monitor — 仅当 URL 带 ?perf=1 时激活（无 query 时是空操作）。
  useEffect(() => {
    let cleanup: (() => void) | undefined;
    void import("@/lib/perf-monitor").then((mod) => { cleanup = mod.initPerfMonitor(); });
    return () => cleanup?.();
  }, []);
  const handleRunningSessionIdsChange = useCallback((ids: Set<string>) => {
    setRunningSessionIds((previous) => {
      if (previous.size === ids.size && [...ids].every((id) => previous.has(id))) return previous;
      return ids;
    });
  }, []);
  // The temporary id distinguishes consecutive fresh composers in one cwd.
  const [newSessionCwd, setNewSessionCwd] = useState<string | null>(null);
  // fork:ui-projectchip — targets shown by the new-session page's workspace selector.
  // The chat workspace identity comes from the server (stable projectKey), exactly like
  // the sidebar's own copy, so the selector never compares paths itself.
  const [chatWorkspaceTarget, setChatWorkspaceTarget] = useState<{ cwd: string; key: string } | null>(null);
  const [homeFolderPickerOpen, setHomeFolderPickerOpen] = useState(false);
  const [homeTargetError, setHomeTargetError] = useState<string | null>(null);
  const [newSessionDraftId, setNewSessionDraftId] = useState("initial");
  const activeNewSessionDraftKeyRef = useRef<string | null>(null);
  const [initialCwdStatus, setInitialCwdStatus] = useState<"idle" | "validating" | "ready" | "error">(
    () => initialNavigation.requestedCwd ? "validating" : "idle",
  );
  const [initialCwdError, setInitialCwdError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  /* fork:zn-21 — 折叠态图标条点「搜索」时 +1，导轨展开后据此打开搜索框。 */
  const [searchRequestId, setSearchRequestId] = useState(0);
  // fork:zn-16 — 订阅一次让设置里改开关后主区立刻生效（回调里走 getNotificationPrefs()）。
  useNotificationPrefs();
  const [sessionKey, setSessionKey] = useState(0);
  const sessionScrollPositionsRef = useRef(new Map<string, ChatScrollPosition>());
  const handleSessionScrollPositionChange = useCallback((sessionId: string, position: ChatScrollPosition) => {
    sessionScrollPositionsRef.current.set(sessionId, position);
  }, []);
  const [searchTarget, setSearchTarget] = useState<{ sessionId: string; entryId: string; blockIndex?: number } | null>(null);
  const handleSearchTargetHandled = useCallback((target: { sessionId: string; entryId: string }) => {
    setSearchTarget((current) => current === target ? null : current);
  }, []);
  const [explorerRefreshKey, setExplorerRefreshKey] = useState(0);
  const [settingsSection, setSettingsSection] = useState<SettingsSection | null>(null);
  const [modelsRefreshKey, setModelsRefreshKey] = useState(0);
  const [projectTrust, setProjectTrust] = useState<ProjectTrustStatus | null>(null);
  const [projectTrustDialogOpen, setProjectTrustDialogOpen] = useState(false);
  const [projectTrustBusy, setProjectTrustBusy] = useState(false);
  const [projectTrustError, setProjectTrustError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(() => !initialNavigation.sidebarCollapsed);
  const [rightPanelOpen, setRightPanelOpen] = useState(false);
  // The grid tracks never swap. This flag only changes which persistent
  // surface occupies the main region and the secondary workspace region.
  const [workspaceSwapped, setWorkspaceSwapped] = useState(false);
  const [mobileToolbarMoreOpen, setMobileToolbarMoreOpen] = useState(false);
  const [mobileSidebarReady, setMobileSidebarReady] = useState(false);
  const sidebarWidthRef = useRef(SIDEBAR_DEFAULT_WIDTH);
  const rightPanelWidthRef = useRef(RIGHT_PANEL_FALLBACK_WIDTH);
  const getResponsiveRightPanelWidth = useCallback(
    () => typeof window === "undefined"
      ? RIGHT_PANEL_FALLBACK_WIDTH
      : getDefaultRightPanelWidth(window.innerWidth),
    [],
  );
  const getResponsiveSidebarMaxWidth = useCallback(
    () => typeof window === "undefined"
      ? SIDEBAR_MAX_WIDTH
      : getSidebarMaxWidth({
        viewportWidth: window.innerWidth,
        rightPanelOpen,
        rightPanelWidth: rightPanelWidthRef.current,
      }),
    [rightPanelOpen],
  );
  const getResponsiveRightPanelMaxWidth = useCallback(
    () => typeof window === "undefined"
      ? RIGHT_PANEL_MAX_WIDTH
      : getRightPanelMaxWidth({
        viewportWidth: window.innerWidth,
        sidebarOpen,
        sidebarWidth: sidebarWidthRef.current,
      }),
    [sidebarOpen],
  );
  const sidebarResizer = useResizablePanel({
    ariaLabel: translate("layout.resizeSidebar"),
    cssVariable: "--sidebar-width",
    cssVariableMirrorRef: appShellRef,
    defaultWidth: SIDEBAR_DEFAULT_WIDTH,
    getMaxWidth: getResponsiveSidebarMaxWidth,
    growthDirection: "right",
    maxWidth: SIDEBAR_MAX_WIDTH,
    minWidth: SIDEBAR_MIN_WIDTH,
    storageKey: "pi-sidebar-width",
    widthRef: sidebarWidthRef,
  });
  const rightPanelResizer = useResizablePanel({
    ariaLabel: translate("layout.resizeSecondaryWorkspace"),
    cssVariable: "--right-panel-width",
    defaultWidth: RIGHT_PANEL_FALLBACK_WIDTH,
    getDefaultWidth: getResponsiveRightPanelWidth,
    getMaxWidth: getResponsiveRightPanelMaxWidth,
    // The secondary workspace is always on the right, even after its content
    // swaps with the main region.
    growthDirection: "left",
    maxWidth: RIGHT_PANEL_MAX_WIDTH,
    minWidth: RIGHT_PANEL_MIN_WIDTH,
    storageKey: "pi-right-panel-width",
    widthRef: rightPanelWidthRef,
  });
  const reclampSidebarWidth = sidebarResizer.reclampWidth;
  const reclampRightPanelWidth = rightPanelResizer.reclampWidth;
  // On mobile the sidebar is an overlay drawer; hide it by default so the chat
  // is visible on load. Runs once the breakpoint resolves after hydration.
  useEffect(() => {
    if (isMobile) {
      setSidebarOpen(false);
      // Phones use a single full-screen secondary workspace, so there is no
      // desktop-style role swap to preserve at this breakpoint.
      setWorkspaceSwapped(false);
      return;
    }
    // fork:pwa-tablet-tier — between 641 and 1024px a docked 288px sidebar is ~38% of the
    // viewport, which left the chat column too narrow for the composer's control row
    // (measured at 768px: that row ran 110px past the column). It starts as a drawer here
    // too; the user can still pin it open, and the desktop role swap still applies.
    if (isCompact) setSidebarOpen(false);
  }, [isMobile, isCompact]);
  useEffect(() => {
    setMobileSidebarReady(true);
  }, []);
  // Re-apply the persisted wallpaper on mount. The bootstrap script cannot do
  // this: the image is an <img> child of the React tree, not a CSS variable.
  useEffect(() => {
    initWallpaper();
  }, []);
  useEffect(() => {
    if (!rightPanelOpen) return;
    reclampSidebarWidth();
    reclampRightPanelWidth();
  }, [reclampRightPanelWidth, reclampSidebarWidth, rightPanelOpen]);
  // Opening and closing belongs to the fixed secondary-workspace role. The
  // editor remains visible whenever it has been assigned to the main region.
  const editorVisible = workspaceSwapped || rightPanelOpen;
  const secondaryWorkspaceId = workspaceSwapped ? "chat-secondary-workspace" : "file-panel";
  const chatInputRef = useRef<ChatInputHandle | null>(null);
  const [pendingQuotePrompt, setPendingQuotePrompt] = useState<{ sessionId: string; text: string } | null>(null);
  const [pendingNewSessionPrompt, setPendingNewSessionPrompt] = useState<{ draftId: string; cwd: string; text: string } | null>(null);
  const topBarRef = useRef<HTMLDivElement>(null);
  // fork:ui-18 — anchor for the title session switcher.
  const topBarTitleRef = useRef<HTMLButtonElement>(null);
  const mobileToolbarRef = useRef<HTMLDivElement>(null);
  // Branch navigator state — populated by ChatWindow via onBranchDataChange
  const [branchTree, setBranchTree] = useState<SessionTreeNode[]>([]);
  const [branchActiveLeafId, setBranchActiveLeafId] = useState<string | null>(null);
  const branchLeafChangeFnRef = useRef<((leafId: string | null) => void) | null>(null);
  const sessionHasBranches = hasSessionBranches(branchTree);

  const handleBranchDataChange = useCallback((tree: SessionTreeNode[], activeLeafId: string | null, onLeafChange: (leafId: string | null) => void) => {
    setBranchTree(tree);
    setBranchActiveLeafId(activeLeafId);
    branchLeafChangeFnRef.current = onLeafChange;
  }, []);

  const handleBranchLeafChange = useCallback((leafId: string | null) => {
    branchLeafChangeFnRef.current?.(leafId);
  }, []);

  const [systemPrompt, setSystemPrompt] = useState<string | null>(null);
  const [systemTools, setSystemTools] = useState<ToolEntry[] | null>(null);
  const [systemInfoLoading, setSystemInfoLoading] = useState(false);
  const systemInfoLoaderRef = useRef<(() => Promise<void>) | null>(null);
  const systemInfoLoadIdRef = useRef(0);
  const systemBtnRef = useRef<HTMLButtonElement>(null);

  const handleSystemPromptChange = useCallback((prompt: string | null) => {
    setSystemPrompt(prompt);
    setSystemInfoLoading(false);
  }, []);

  const handleSystemToolsChange = useCallback((tools: ToolEntry[] | null) => {
    setSystemTools(tools);
  }, []);

  const handleSystemInfoLoaderChange = useCallback((loader: (() => Promise<void>) | null) => {
    systemInfoLoadIdRef.current += 1;
    systemInfoLoaderRef.current = loader;
    setSystemInfoLoading(false);
  }, []);

  // Session stats (tokens + cost) — populated by ChatWindow, displayed in top bar
  const [sessionStats, setSessionStats] = useState<SessionStatsInfo | null>(null);
  const [autoNameStatus, setAutoNameStatus] = useState<AutoNameStatus>({ kind: "idle" });
  const autoNameTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // fork:gap-auto-name — 已尝试自动命名的会话（内存 + localStorage 双保险）。
  const autoNameAttemptedRef = useRef<Set<string>>(new Set());

  const activeSessionIdRef = useRef<string | null>(selectedSession?.id ?? null);
  activeSessionIdRef.current = selectedSession?.id ?? null;
  const handleSessionStatsChange = useCallback((stats: SessionStatsInfo | null) => {
    setSessionStats(stats);
  }, []);

  /* fix:mcp-topbar-icons —— 扩展状态（MCP / 插件）由 ChatWindow 上报（它才持有
     useAgentSession），顶栏那两枚图标读这里。原来这块内容挂在聊天区右上角的常驻
     胶囊上，用户要求改成顶栏两枚 icon + 悬停/点击出浮窗。 */
  const [extensionStatuses, setExtensionStatuses] = useState<ExtensionStatusItem[]>([]);
  const [extensionWidgets, setExtensionWidgets] = useState<ExtensionWidgetItem[]>([]);
  const handleExtensionStatusChange = useCallback((statuses: ExtensionStatusItem[], widgets: ExtensionWidgetItem[]) => {
    setExtensionStatuses(statuses);
    setExtensionWidgets(widgets);
  }, []);

  // Single active panel — only one dropdown open at a time
  const [activeTopPanel, setActiveTopPanel] = useState<"agents" | "branches" | "system" | "tools" | "sessions" | null>(null);
  const TOP_BAR_SESSIONS_MENU_WIDTH = 300;
  const [topPanelPos, setTopPanelPos] = useState<{ top: number; left: number; width: number } | null>(null);

  useEffect(() => {
    if (!sessionHasBranches) {
      setActiveTopPanel((panel) => panel === "branches" ? null : panel);
    }
  }, [sessionHasBranches]);

  useEffect(() => {
    if (!hasSubagentSessions) {
      setActiveTopPanel((panel) => panel === "agents" ? null : panel);
    }
  }, [hasSubagentSessions]);

  /* fork:top-panel-anchor —— 画板 22：所有顶栏浮层都从**各自的图标按钮下方**挂出。
     之前只量 `topBarRef`（整条顶栏），于是除会话切换器外一律贴在顶栏最左、
     横向拉满整条顶栏 —— 点右边那颗按钮，弹层却从左边冒出来。
     这里记下「谁被点了」，定位时量那一个元素；量不到时回落到顶栏左缘。 */
  const topPanelAnchorRef = useRef<HTMLElement | null>(null);
  const toggleTopPanel = useCallback((
    panel: "agents" | "branches" | "system" | "tools" | "sessions",
    keepMobileToolbarOpen = false,
    trigger?: HTMLElement | null,
  ) => {
    if (isMobile) setSidebarOpen(false);
    if (trigger !== undefined) topPanelAnchorRef.current = trigger;
    setActiveTopPanel((cur) => cur === panel ? null : panel);
    if (isMobile && isNarrowMobile && keepMobileToolbarOpen) setMobileToolbarMoreOpen(true);
  }, [isMobile, isNarrowMobile]);

  const handleSystemInfoToggle = useCallback((
    panel: "system" | "tools",
    keepMobileToolbarOpen = false,
    trigger?: HTMLElement | null,
  ) => {
    const opening = activeTopPanel !== panel;
    toggleTopPanel(panel, keepMobileToolbarOpen, trigger);
    if (!opening || systemInfoLoading) return;

    const load = systemInfoLoaderRef.current;
    if (!load) return;
    const loadId = ++systemInfoLoadIdRef.current;
    setSystemInfoLoading(true);
    void load().catch((error) => {
      console.error("Failed to load system information:", error);
    }).finally(() => {
      if (systemInfoLoadIdRef.current === loadId) {
        setSystemInfoLoading(false);
      }
    });
  }, [activeTopPanel, systemInfoLoading, toggleTopPanel]);
  // 面板关闭后别把锚点留在一个已经卸载的按钮上。
  useEffect(() => {
    if (!activeTopPanel) topPanelAnchorRef.current = null;
  }, [activeTopPanel]);

  // fork:ui-stats-inline — 统计面板已搬到 composer 下方的状态条；这里只负责
  // 把 `/session` 之类的入口变成“展开那块面板”，不再切顶栏浮层。
  const openSessionStatsPanel = useCallback(() => {
    if (isMobile) setSidebarOpen(false);
    setMobileToolbarMoreOpen(false);
  }, [isMobile]);

  const handleSidebarToggle = useCallback(() => {
    if (isMobile) {
      setActiveTopPanel(null);
      setMobileToolbarMoreOpen(false);
    }
    setSidebarOpen((open) => !open);
  }, [isMobile]);

  const handleMobileToolbarMoreToggle = useCallback(() => {
    setSidebarOpen(false);
    setActiveTopPanel(null);
    setMobileToolbarMoreOpen((open) => !open);
  }, []);

  const handleRightPanelToggle = useCallback(() => {
    if (isMobile) {
      setSidebarOpen(false);
      setActiveTopPanel(null);
      setMobileToolbarMoreOpen(false);
    }
    setRightPanelOpen((open) => !open);
  }, [isMobile]);

  const handleWorkspacePositionToggle = useCallback(() => {
    if (isMobile) return;
    setWorkspaceSwapped((swapped) => !swapped);
  }, [isMobile]);

  useEffect(() => {
    if (!mobileToolbarMoreOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const toolbar = mobileToolbarRef.current;
      if (toolbar && event.composedPath().includes(toolbar)) return;
      setMobileToolbarMoreOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setMobileToolbarMoreOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [mobileToolbarMoreOpen]);

  useEffect(() => {
    setMobileToolbarMoreOpen(false);
  }, [isMobile, isNarrowMobile, selectedSession?.id, newSessionDraftId]);

  useEffect(() => {
    if (!activeTopPanel || !topBarRef.current) return;
    const update = () => {
      const topBarRect = topBarRef.current!.getBoundingClientRect();
      const widthFor = (preferred: number) => Math.min(preferred, topBarRect.width - 16);
      /* fork:top-panel-anchor —— 优先用「被点的那颗按钮」定位：弹层的左缘对齐按钮
         左缘、上缘紧贴按钮下沿，宽度按画板 22 的 `.pw-pop`（320）而不是整条顶栏。
         右缘贴边时把左缘收回来，保证弹层不出屏。 */
      const anchor = topPanelAnchorRef.current;
      if (anchor) {
        const rect = anchor.getBoundingClientRect();
        const width = widthFor(
          activeTopPanel === "agents" ? AGENT_PANEL_WIDTH
            : activeTopPanel === "sessions" ? TOP_BAR_SESSIONS_MENU_WIDTH
              : activeTopPanel === "tools" ? TOP_BAR_WIDE_PANEL_WIDTH
                : TOP_BAR_PANEL_WIDTH,
        );
        setTopPanelPos({
          top: rect.bottom,
          left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
          width,
        });
        return;
      }
      if (activeTopPanel === "agents") {
        setTopPanelPos({
          top: topBarRect.bottom,
          left: topBarRect.left,
          width: widthFor(AGENT_PANEL_WIDTH),
        });
        return;
      }
      // fix:tools-panel-width —— 工具面板没量到触发钮时**右对齐**顶栏右缘（它挂在
      // 顶栏最右那颗工具钮下面），否则 860 宽的宽面板会从顶栏左缘冒出来、右半截出屏。
      if (activeTopPanel === "tools") {
        const width = widthFor(TOP_BAR_WIDE_PANEL_WIDTH);
        setTopPanelPos({
          top: topBarRect.bottom,
          left: Math.max(8, topBarRect.right - width - 8),
          width,
        });
        return;
      }
      // fork:ui-18 — the session switcher hangs under the title, so it keeps the
      // left edge of the title area instead of the bar's right edge.
      if (activeTopPanel === "sessions") {
        const titleRect = topBarTitleRef.current?.getBoundingClientRect();
        const width = widthFor(TOP_BAR_SESSIONS_MENU_WIDTH);
        setTopPanelPos({
          top: topBarRect.bottom,
          left: Math.max(8, Math.min(titleRect?.left ?? topBarRect.left, topBarRect.right - width - 8)),
          width,
        });
        return;
      }
      setTopPanelPos({ top: topBarRect.bottom, left: topBarRect.left, width: widthFor(TOP_BAR_PANEL_WIDTH) });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(topBarRef.current);
    window.addEventListener("resize", update);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [activeTopPanel, isMobile]);

  // Files unmount when inactive; workspace terminals stay mounted until closed.
  const [fileTabs, setFileTabs] = useState<Tab[]>([]);
  const [activeFileTabId, setActiveFileTabId] = useState<string | null>(null);
  const [pendingFileLocation, setPendingFileLocation] = useState<FileLocationTarget | null>(null);
  const [terminalTabs, setTerminalTabs] = useState<TerminalTab[]>([]);
  const [terminalsRestored, setTerminalsRestored] = useState(false);
  const [browserTabs, setBrowserTabs] = useState<BrowserTab[]>([]);
  // handleOpenBrowser 需要看当前已开的标签（复用同 URL 的），但不能把 browserTabs
  // 写进它的依赖数组——那会让它每个标签变动都重建，连带把 provider value 也换掉。
  const browserTabsRef = useRef<BrowserTab[]>([]);
  browserTabsRef.current = browserTabs;
  // fork:file-tab-keep-alive — 已激活过的文件 tab（首次激活才挂载，关闭后剪枝）。
  const [mountedFileTabs, setMountedFileTabs] = useState<ReadonlySet<string>>(() => new Set());
  // fork:git-graph-tab — 每个工作区一个单例 Git 图谱 tab（不持久化：它是“看一眼”的视图）。
  const [gitGraphOpen, setGitGraphOpen] = useState(false);
  // fork:zc-05 — 单例 Git 变更面板（与图谱同为「看一眼」的视图，不持久化）。
  // fork:proma-05-explore — 探索分支的右栏只读 tab（可与主线并排看）
  const [branchTabs, setBranchTabs] = useState<{ id: string; sessionId: string; parentSessionId: string | null; label: string }[]>([]);
  const [browsersRestored, setBrowsersRestored] = useState(false);
  // fork:right-tabs-memory — 每个工作区记一份文件 tab（含激活项）：切工作区或刷新后
  // 回到该工作区时把 tab 列表恢复回来。只存文件 tab —— 终端持有活 PTY、浏览器有独立
  // 恢复路径，都不适合序列化。恢复出来的文件若已被删除，由 FileViewer 自己显示错误。
  const rightTabsWorkspaceRef = useRef<string | null>(null);
  const fileTabsRef = useRef(fileTabs);
  fileTabsRef.current = fileTabs;
  const activeFileTabIdRef = useRef(activeFileTabId);
  activeFileTabIdRef.current = activeFileTabId;
  // 注意：这里不能用 activeProjectKeyRef —— 它在文件更下方才声明（effect 里读没问题，
  // 渲染期读会命中 TDZ）。
  const activeWorkspaceKey = selectedSession ? workspaceKeyOf(selectedSession) : null;

  useEffect(() => {
    const key = activeWorkspaceKey;
    if (!key) return;
    if (rightTabsWorkspaceRef.current === key) return;
    const previous = rightTabsWorkspaceRef.current;
    rightTabsWorkspaceRef.current = key;
    if (previous) {
      saveRightTabs(previous, {
        fileTabs: fileTabsRef.current.map((tab) => ({
          id: tab.id,
          label: tab.label,
          filePath: tab.filePath,
          sourceSessionId: tab.sourceSessionId ?? null,
          ...(tab.initialDisplayMode ? { initialDisplayMode: tab.initialDisplayMode } : {}),
          ...(tab.viewerState ? { viewerState: tab.viewerState } : {}),
          ...(tab.viewerRevision !== undefined ? { viewerRevision: tab.viewerRevision } : {}),
        })),
        activeTabId: activeFileTabIdRef.current,
      });
    }
    const restored = loadRightTabs(key);
    if (!restored || restored.fileTabs.length === 0) return;
    setFileTabs(restored.fileTabs.map((tab) => ({
      id: tab.id,
      label: tab.label,
      filePath: tab.filePath,
      sourceSessionId: tab.sourceSessionId,
      ...(tab.initialDisplayMode ? { initialDisplayMode: tab.initialDisplayMode } : {}),
      ...(tab.viewerState ? { viewerState: tab.viewerState } : {}),
      ...(tab.viewerRevision !== undefined ? { viewerRevision: tab.viewerRevision } : {}),
    })));
    setMountedFileTabs(new Set(restored.fileTabs.map((tab) => tab.id)));
    if (restored.activeTabId) setActiveFileTabId(restored.activeTabId);
  }, [activeWorkspaceKey]);

  // fork:file-tab-keep-alive — 首次激活才挂载；关闭的 tab 从集合里剪掉，避免常驻实例泄漏。
  useEffect(() => {
    setMountedFileTabs((current) => {
      const open = new Set(fileTabs.map((tab) => tab.id));
      const next = new Set([...current].filter((id) => open.has(id)));
      if (activeFileTabId && open.has(activeFileTabId)) next.add(activeFileTabId);
      if (next.size === current.size && [...next].every((id) => current.has(id))) return current;
      return next;
    });
  }, [activeFileTabId, fileTabs]);

  // fork:zc-06 — memoized so the tab-overview callbacks (close-all / close-others /
  // close-with-history) do not get a new dependency every render.
  const panelTabs: Tab[] = useMemo(() => [...(gitGraphOpen ? [{
    id: GIT_GRAPH_TAB_ID,
    label: translate("git.graph"),
    filePath: "",
    kind: "git-graph" as const,
  }] : []), ...fileTabs, ...terminalTabs.map((tab) => ({
    id: tab.id,
    label: getFileName(tab.cwd) || tab.cwd,
    filePath: tab.cwd,
    kind: "terminal" as const,
    closing: Boolean(tab.closing),
  })), ...browserTabs.map((tab) => ({
    id: tab.id,
    label: browserTabLabel(tab.url) || translate("browser.newTab"),
    filePath: tab.url,
    kind: "browser" as const,
  })), ...branchTabs.map((tab) => ({
    id: tab.id,
    label: tab.label,
    filePath: tab.sessionId,
    kind: "session" as const,
  }))], [branchTabs, browserTabs, fileTabs, gitGraphOpen, terminalTabs, translate]);

  useEffect(() => {
    try {
      const saved = restoreTerminalTabs(window.sessionStorage.getItem(TERMINAL_TABS_KEY));
      setTerminalTabs(saved.tabs);
      if (saved.activeId) {
        setActiveFileTabId(saved.activeId);
        setRightPanelOpen(saved.open);
      }
    } catch { /* storage is optional */ }
    setTerminalsRestored(true);
  }, []);

  useEffect(() => {
    if (!terminalsRestored) return;
    try {
      window.sessionStorage.setItem(TERMINAL_TABS_KEY, JSON.stringify({
        tabs: terminalTabs.map(({ id, cwd }) => ({ id, cwd })),
        activeId: activeFileTabId,
        open: rightPanelOpen,
      }));
    } catch { /* storage is optional */ }
  }, [terminalTabs, activeFileTabId, rightPanelOpen, terminalsRestored]);

  useEffect(() => {
    try {
      const saved = restoreBrowserTabs(window.sessionStorage.getItem(BROWSER_TABS_KEY));
      setBrowserTabs(saved.tabs);
      if (saved.activeId) {
        setActiveFileTabId(saved.activeId);
        setRightPanelOpen(saved.open);
      }
    } catch { /* storage is optional */ }
    setBrowsersRestored(true);
  }, []);

  useEffect(() => {
    if (!browsersRestored) return;
    try {
      window.sessionStorage.setItem(BROWSER_TABS_KEY, JSON.stringify({
        tabs: browserTabs.map(({ id, url }) => ({ id, url })),
        activeId: activeFileTabId,
        open: rightPanelOpen,
      }));
    } catch { /* storage is optional */ }
  }, [browserTabs, activeFileTabId, rightPanelOpen, browsersRestored]);

  const handleFileViewerStateChange = useCallback((
    tabId: string,
    viewerRevision: number,
    viewerState: FileViewerState,
  ) => {
    setFileTabs((prev) => saveFileViewerState(prev, tabId, viewerRevision, viewerState));
  }, []);

  const copySessionReference = useCallback(async (detail: SessionRowContextMenuDetail) => {
    const reference: SessionReference = {
      id: detail.id,
      title: detail.name || detail.id.slice(0, 12),
      cwd: detail.cwd,
    };
    const text = serializeSessionReferenceClipboard(reference);
    if (!text) return;
    await copyText(text);
  }, []);

  const handleFileLocationHandled = useCallback((target: FileLocationTarget) => {
    setPendingFileLocation((current) => current === target ? null : current);
  }, []);

  const handleFileLocationFailed = useCallback((target: FileLocationTarget) => {
    setPendingFileLocation((current) => current === target ? null : current);
  }, []);

  // Same @mention format as the chat input's @ autocomplete, so the agent's
  // read tool resolves it the same way (it strips the @ prefix).
  const handleAtMention = useCallback((relativePath: string, isDir: boolean) => {
    chatInputRef.current?.insertText(buildAtMentionText(relativePath, isDir));
    if (isMobile) { setRightPanelOpen(false); setSidebarOpen(false); }
  }, [isMobile]);

  const handleAtMentions = useCallback((relativePaths: string[]) => {
    const mentions = buildFileAtMentionsText(relativePaths);
    if (mentions) chatInputRef.current?.insertText(mentions);
    if (isMobile) { setRightPanelOpen(false); setSidebarOpen(false); }
  }, [isMobile]);

  const handleFileLineMention = useCallback((selection: FileSelectionContext) => {
    chatInputRef.current?.addSelectionContext({
      id: createSelectionContextId(),
      text: selection.text,
      sourceFilePath: selection.relativePath,
      sourceAbsolutePath: selection.filePath,
      sourceStartLine: selection.startLine,
      sourceEndLine: selection.endLine,
      sourceLanguage: selection.language,
      sourceSessionId: selection.sourceSessionId ?? undefined,
    });
    if (isMobile) { setRightPanelOpen(false); setSidebarOpen(false); }
  }, [isMobile]);

  const initialSessionId = initialNavigation.sessionId;
  const [activeCwd, setActiveCwd] = useState<string | null>(null);
  const activeProjectKeyRef = useRef<string | null>(null);
  // True once the initial ?session= URL param has been resolved (or confirmed absent)
  const [initialSessionRestored, setInitialSessionRestored] = useState<boolean>(() => !initialSessionId);
  // sessionStorage is empty during SSR. Applying the tab's remembered session
  // in the useState initializer made the first client tree differ from the
  // server HTML (sidebar "select project" vs ""). Restore after mount instead.
  useLayoutEffect(() => {
    const next = withTabOpen(initialNavigation, getTabOpen());
    if (next === initialNavigation) return;
    setInitialNavigation(next);
    if (next.sessionId) setInitialSessionRestored(false);
  }, [initialNavigation]);
  // Suppresses sessionKey bump in handleCwdChange during the initial URL restore
  const suppressCwdBumpRef = useRef(false);
  // Guards the async workspace restore so a slow response from an earlier
  // switch cannot resurrect a session into a project the user already left.
  const workspaceRestoreTokenRef = useRef(0);

  const invalidateWorkspaceRestore = useCallback(() => {
    workspaceRestoreTokenRef.current += 1;
  }, []);

  // Persist every active-session transition, including new and forked sessions
  // that bypass the sidebar selection handler. Transient sessions do not yet
  // carry projectKey, so use the active project identity until hydration.
  // The workspace memory is shared by every tab; the tab memory keeps this
  // tab's own session so a reload does not follow another tab's last pick.
  // New session is a selection too: remember the composer cwd so reload stays
  // on that UI instead of resurrecting the previous chat.
  // fork:tab-session
  useEffect(() => {
    if (selectedSession) {
      const projectKey = selectedSession.projectKey
        ?? activeProjectKeyRef.current
        ?? workspaceKeyOf(selectedSession);
      setLastOpenSession(projectKey, selectedSession.id);
      setTabOpenSession(selectedSession.id);
      return;
    }
    if (newSessionCwd) setTabOpenNewSession(newSessionCwd);
  }, [newSessionCwd, selectedSession]);

  useEffect(() => {
    const requestedCwd = initialNavigation.requestedCwd;
    if (!requestedCwd) return;

    const controller = new AbortController();
    setInitialCwdStatus("validating");
    setInitialCwdError(null);

    void fetch("/api/cwd/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cwd: requestedCwd }),
      signal: controller.signal,
    })
      .then(async (response) => {
        const data = await response.json().catch(() => ({})) as { cwd?: string; error?: string };
        if (!response.ok || !data.cwd) {
          throw new Error(data.error ?? `HTTP ${response.status}`);
        }

        // The sidebar will notify us when it adopts this cwd. Avoid remounting
        // the just-created empty chat during that initial synchronization.
        suppressCwdBumpRef.current = true;
        const draftId = `initial:${requestedCwd}`;
        setNewSessionDraftId(draftId);
        activeNewSessionDraftKeyRef.current = `new:${draftId}:${data.cwd}`;
        setNewSessionCwd(data.cwd);
        setInitialCwdStatus("ready");
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setInitialCwdError(error instanceof Error ? error.message : String(error));
        setInitialCwdStatus("error");
      });

    return () => controller.abort();
  }, [initialNavigation]);

  // Restore the workspace's last open session after switching to it. Called
  // from handleCwdChange once the outgoing context has been reset. The session
  // is looked up against the live list so a deleted or drifted session falls
  // back to the default welcome page instead of erroring.
  const restoreWorkspaceContext = useCallback((projectKey: string, cwd: string) => {
    const token = ++workspaceRestoreTokenRef.current;
    const lastOpenSessionId = getLastOpenSession(projectKey);
    const adopt = (d: { sessions: SessionInfo[] } | null) => {
      if (token !== workspaceRestoreTokenRef.current) return; // stale switch
      if (!d) return; // 列表没拿到：保留记忆，下次切回来重试
      const target = resolveRestoreTarget({
        rememberedSessionId: lastOpenSessionId,
        sessions: d.sessions,
        workspaceKey: projectKey,
        keyOf: workspaceKeyOf,
      });
      if (target.kind === "new-draft") return;
      const s = d.sessions.find((x) => x.id === target.sessionId);
      if (!s) return;
      if (target.kind === "newest" && lastOpenSessionId) {
        // 记忆的会话已经不在这个工作区了：顺手把记忆改成真正打开的那条，
        // 否则每次切回来都要重新兜底一次。
        clearLastOpen(projectKey);
      }
      // Keep the temporary composer's draft in its cwd, even when the
      // remembered session belongs to another worktree of this project.
      const activeDraftKey = activeNewSessionDraftKeyRef.current;
      if (activeDraftKey) {
        rekeyDraft(activeDraftKey, parkedNewSessionDraftKey(cwd));
      }
      activeNewSessionDraftKeyRef.current = null;
      // Selecting the session must remount the chat with the session
      // present: useAgentSession loads content in a mount-only effect, so
      // the null-session welcome mount from the switch would never load
      // the restored session's messages.
      setSelectedSession(s);
      setSessionKey((k) => k + 1);
      if (new URLSearchParams(window.location.search).get("session") !== s.id) {
        router.replace(`?session=${encodeURIComponent(s.id)}`, { scroll: false });
      }
    };
    // fork:workspace-restore — 以前没有记忆就整个 return，于是「从没打开过会话的工作区」
    // 切过去永远是空白页。现在无论如何都拉一次列表，按 记忆 → 该工作区最新 → 新草稿 兜底。
    // fork:session-list-cache — 同一帧内的恢复 / 水合 / 侧栏刷新共享一次请求。
    // Fast path: the sidebar already delivered the catalogue — restore
    // without waiting on a fresh /api/sessions round trip.
    if (sessionCatalog.length > 0) {
      adopt({ sessions: sessionCatalog });
      return;
    }
    void loadSessionList()
      .then((d) => d as { sessions: SessionInfo[] } | null)
      .then(adopt)
      .catch(() => {
        // Network hiccup: keep the remembered session for a later retry.
      });
  }, [router, sessionCatalog]);

  const handleCwdChange = useCallback((
    cwd: string | null,
    projectRoot?: string | null,
    projectKey?: string | null,
  ) => {
    invalidateWorkspaceRestore();
    const currentFreshCwd = newSessionCwd ?? activeCwd;
    setActiveCwd(cwd);
    // Skip if cwd is null (initial mount).
    if (!cwd) return;
    const newProject = projectKey ?? projectRoot ?? cwd;
    const currentProject = activeProjectKeyRef.current
      ?? (selectedSession ? workspaceKeyOf(selectedSession) : null);
    activeProjectKeyRef.current = newProject;

    // Keep the project identity in sync during the initial URL restore without
    // remounting the just-created or restored chat.
    if (suppressCwdBumpRef.current) {
      suppressCwdBumpRef.current = false;
      return;
    }
    // The server may hydrate a normalized key after a custom cwd is already
    // active. Updating identity for the exact same cwd is not a user switch.
    if (currentFreshCwd === cwd && currentProject !== newProject) return;
    // Existing sessions stay open when the worktree selector moves within the
    // same project. A fresh composer must remount when its effective cwd moves,
    // otherwise its already-created runtime would keep sending to the old cwd.
    if (
      currentProject === newProject
      && (selectedSession !== null || currentFreshCwd === cwd)
    ) {
      return;
    }
    // Close any session that belongs to a different project — it no longer
    // matches the selected project directory.
    const previousDraftKey = activeNewSessionDraftKeyRef.current;
    if (previousDraftKey && currentFreshCwd) {
      rekeyDraft(previousDraftKey, parkedNewSessionDraftKey(currentFreshCwd));
    }
    const draftId = typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    const draftKey = `new:${draftId}:${cwd}`;
    rekeyDraft(parkedNewSessionDraftKey(cwd), draftKey);
    setNewSessionDraftId(draftId);
    activeNewSessionDraftKeyRef.current = draftKey;
    setSelectedSession(null);
    setNewSessionCwd((prev) => {
      if (prev && prev !== cwd) return null;
      return prev;
    });
    setSessionKey((k) => k + 1);
    setBranchTree([]);
    setBranchActiveLeafId(null);
    setSystemPrompt(null);
    setSystemTools(null);
    setSystemInfoLoading(false);
    setActiveTopPanel(null);
    if (currentProject !== newProject) {
      // File tabs are keyed by absolute path, so tabs opened in the previous
      // project must not linger. Same-project worktree switches keep them.
      setFileTabs([]);
      if (!activeFileTabId || activeFileTabId.startsWith("file:")) {
        setActiveFileTabId(null);
        if (!workspaceSwapped) setRightPanelOpen(false);
      }
      // Restore the workspace we switched to: its last open session, or keep
      // the default welcome page when none is remembered.
      restoreWorkspaceContext(newProject, cwd);
    }
    router.replace(typeof window !== "undefined" ? window.location.pathname : "/", { scroll: false });
  }, [activeCwd, activeFileTabId, invalidateWorkspaceRestore, newSessionCwd, router, selectedSession, restoreWorkspaceContext, workspaceSwapped]);

  const handleSelectSession = useCallback((session: SessionInfo, isRestore = false, entryId?: string, blockIndex?: number) => {
    setSearchTarget(entryId ? { sessionId: session.id, entryId, blockIndex } : null);
    invalidateWorkspaceRestore();
    const activeDraftKey = activeNewSessionDraftKeyRef.current;
    const activeDraftCwd = newSessionCwd ?? (selectedSession === null ? activeCwd : null);
    if (activeDraftKey && activeDraftCwd) {
      rekeyDraft(activeDraftKey, parkedNewSessionDraftKey(activeDraftCwd));
    }
    activeNewSessionDraftKeyRef.current = null;
    // Adopt an explicitly selected session before the sidebar reports its cwd.
    const projectKey = workspaceKeyOf(session);
    if (activeProjectKeyRef.current !== projectKey) {
      setFileTabs([]);
      if (!activeFileTabId || activeFileTabId.startsWith("file:")) {
        setActiveFileTabId(null);
        if (!workspaceSwapped) setRightPanelOpen(false);
      }
      setActiveTopPanel(null);
    }
    activeProjectKeyRef.current = projectKey;
    // Re-clicking the already-open session must not remount the chat and
    // re-run the full load/positioning cycle. Only skip when the effective
    // cwd context already matches — otherwise a pending cwd move still needs
    // the full re-select flow.
    if (!isRestore && selectedSession) {
      const sameProject =
        workspaceKeyOf(selectedSession) === workspaceKeyOf(session);
      if (selectedSession.id === session.id && sameProject) {
        if (isMobile) setSidebarOpen(false);
        return;
      }
    }
    setNewSessionCwd(null);
    setSelectedSession(session);
    setSessionKey((k) => k + 1);
    setBranchTree([]);
    setBranchActiveLeafId(null);
    branchLeafChangeFnRef.current = null;
    setSystemPrompt(null);
    setSystemTools(null);
    setSystemInfoLoading(false);
    setInitialSessionRestored(true);
    // On mobile, collapse the overlay drawer so the chat is revealed after pick.
    if (isMobile && !isRestore) setSidebarOpen(false);
    if (isRestore) {
      // Suppress the redundant sessionKey bump that would come from the
      // onCwdChange effect firing after setSelectedCwd in the sidebar
      suppressCwdBumpRef.current = true;
    }
    // Skip router.replace when the URL already has this session — calling
    // replace in production Next.js triggers a Suspense remount loop.
    // Tab-memory restore lands on `/` and must write `?session=` so reload
    // and copy-link keep this session.
    // fork:tab-session
    if (!isRestore || new URLSearchParams(window.location.search).get("session") !== session.id) {
      router.replace(`?session=${encodeURIComponent(session.id)}`, { scroll: false });
    }
  }, [activeCwd, activeFileTabId, invalidateWorkspaceRestore, router, isMobile, newSessionCwd, selectedSession, workspaceSwapped]);

  const handleNewSession = useCallback((sessionId: string, cwd: string) => {
    invalidateWorkspaceRestore();
    const draftKey = `new:${sessionId}:${cwd}`;
    rekeyDraft(parkedNewSessionDraftKey(cwd), draftKey);
    activeNewSessionDraftKeyRef.current = draftKey;
    setNewSessionDraftId(sessionId);
    setSelectedSession(null);
    setNewSessionCwd(cwd);
    setSessionKey((k) => k + 1);
    setBranchTree([]);
    setBranchActiveLeafId(null);
    setSystemPrompt(null);
    setSystemTools(null);
    setSystemInfoLoading(false);
    setActiveTopPanel(null);
    if (isMobile) setSidebarOpen(false);
    // fork:tab-session — remember the new-session composer cwd for this tab's reload.
    router.replace(`?cwd=${encodeURIComponent(cwd)}`, { scroll: false });
  }, [invalidateWorkspaceRestore, router, isMobile]);

  // Global keyboard shortcuts (handles Esc, Ctrl+Alt+N etc.)
  useGlobalKeyboardShortcuts({
    onNewSession: (cwd: string) => handleNewSession(`kb-${Date.now()}`, cwd),
    activeCwd,
    // fork:zc-04 — 直接给句柄，不再让快捷键层去 DOM 里找按钮点。
    onToggleSidebar: handleSidebarToggle,
    onToggleRightPanel: handleRightPanelToggle,
  });

  // Client-built transient SessionInfo (new session / fork) lacks the
  // server-computed projectKey, which the same-project check in
  // handleCwdChange relies on. Hydrate it from the session list so switching
  // worktrees right after creating a session doesn't close the chat.
  const hydrateSelectedSession = useCallback((sessionId: string) => {
    void loadSessionList({ force: true })
      .then((d) => d as { sessions: SessionInfo[] } | null)
      .then((d) => {
        const full = d?.sessions.find((s) => s.id === sessionId);
        if (!full) return;
        setSelectedSession((prev) => (
          prev?.id === sessionId
            ? { ...prev, ...full, transient: full.transient ?? false }
            : prev
        ));
      })
      .catch(() => {});
  }, []);

  const handleOpenSession = useCallback(async (sessionId: string) => {
    // Prefer the catalogue the sidebar already delivered: selecting from it
    // avoids a full detail round trip just to obtain the SessionInfo.
    const catalogued = sessionCatalog.find((s) => s.id === sessionId);
    if (catalogued && !catalogued.transient) {
      handleSelectSession(catalogued);
      return;
    }
    try {
      const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`, { cache: "no-store" });
      const data = await response.json() as { info?: SessionInfo; error?: string };
      if (!response.ok || !data.info) throw new Error(data.error ?? `HTTP ${response.status}`);
      handleSelectSession(data.info);
    } catch (error) {
      console.error("[pi-web] failed to open session:", error instanceof Error ? error.message : error);
    }
  }, [handleSelectSession, sessionCatalog]);

  // Called by ChatWindow when a new session gets its real id from pi
  const handleSessionCreated = useCallback((session: SessionInfo, sourceDraftKey: string) => {
    setRefreshKey((k) => k + 1);
    if (activeNewSessionDraftKeyRef.current !== sourceDraftKey) return;
    invalidateWorkspaceRestore();
    activeNewSessionDraftKeyRef.current = null;
    setNewSessionCwd(null);
    setSelectedSession(session);
    hydrateSelectedSession(session.id);
    router.replace(`?session=${encodeURIComponent(session.id)}`, { scroll: false });
  }, [invalidateWorkspaceRestore, router, hydrateSelectedSession]);

  const deliverSessionNotification = useCallback(({
    targetSession,
    title,
    body,
    tag,
  }: {
    targetSession: SessionInfo | null;
    title: string;
    body: string;
    tag?: string;
  }) => {
    if (!("Notification" in window)) return;

    const fire = () => {
      const sessionUrl = targetSession ? `/?session=${encodeURIComponent(targetSession.id)}` : "/";
      void showBrowserNotification({
        title,
        body,
        sessionUrl,
        tag,
        onClick: () => {
          window.focus();
          if (targetSession) handleSelectSession(targetSession);
        },
      });
    };

    if (Notification.permission === "granted") {
      fire();
      void setupPushSubscription(locale);
    } else if (Notification.permission === "default") {
      void Notification.requestPermission().then((p) => {
        if (p === "granted") {
          fire();
          void setupPushSubscription(locale);
        }
      });
    }
  }, [handleSelectSession, locale]);

  const handleAgentEnd = useCallback(() => {
    setRefreshKey((k) => k + 1);
    setExplorerRefreshKey((k) => k + 1);
    if (selectedSession) hydrateSelectedSession(selectedSession.id);

    if (selectedSession?.relation?.kind === "subagent") return;
    const prefs = getNotificationPrefs();
    if (!prefs.enabled || !prefs.onComplete) return;
    if (prefs.onlyWhenUnfocused && !shouldShowBrowserNotification()) return;
    const targetSession = selectedSession;
    deliverSessionNotification({
      targetSession,
      title: targetSession?.name ?? translate("i18n.sessionComplete"),
      body: translate("i18n.taskFinished"),
      tag: targetSession ? `pi-session-complete:${targetSession.id}` : "pi-session-complete",
    });
  }, [deliverSessionNotification, hydrateSelectedSession, selectedSession, translate]);

  /* fork:zn-16 — 失败通知（Zeno 通知页的「任务失败时通知」）。与完成通知分开，
     因为两者的开关独立，而且失败时用户更希望知道是**哪一句**话里的什么错。 */
  const handleAgentError = useCallback((message: string) => {
    if (selectedSession?.relation?.kind === "subagent") return;
    const prefs = getNotificationPrefs();
    if (!prefs.enabled || !prefs.onError) return;
    if (prefs.onlyWhenUnfocused && !shouldShowBrowserNotification()) return;
    const targetSession = selectedSession;
    deliverSessionNotification({
      targetSession,
      title: targetSession?.name ?? translate("i18n.taskFailed"),
      body: message,
      tag: targetSession ? `pi-session-failed:${targetSession.id}` : "pi-session-failed",
    });
  }, [deliverSessionNotification, selectedSession, translate]);

  const handleAttentionNeeded = useCallback((request: BlockingExtensionUiRequest) => {
    if (selectedSession?.relation?.kind === "subagent") return;
    const prefs = getNotificationPrefs();
    if (!prefs.enabled) return;
    if (prefs.onlyWhenUnfocused && !shouldShowBrowserNotification()) return;
    if (!claimExtensionAttentionNotification(request, notifiedAttentionRequestIdsRef.current)) return;

    deliverSessionNotification({
      targetSession: selectedSession,
      title: translate("i18n.attentionNeeded"),
      body: request.method === "custom"
        ? translate("i18n.extensionInputNeeded")
        : request.title,
      tag: `pi-extension-ui:${request.id}`,
    });
  }, [deliverSessionNotification, selectedSession, translate]);

  /**
   * fork:gap-auto-name — 会话自动命名。
   *
   * 后端 `/api/sessions/[id]/auto-name` 本来就有，但只挂在工具栏按钮上，
   * 于是新会话的标题一直是「新会话」直到用户想起来点一下。
   * 这里把请求体抽成 `requestAutoName`，由两条路径共用：
   *   - 手动按钮（`handleAutoName`，带状态反馈）；
   *   - 首个 assistant 回复结束后的静默自动命名（下方 effect）。
   * 静默路径不写 autoNameStatus，避免自动触发时工具栏文案闪烁。
   */
  const requestAutoName = useCallback(async (sessionId: string, options?: { silent?: boolean }) => {
    const silent = options?.silent === true;
    if (!silent) {
      if (autoNameTimerRef.current) clearTimeout(autoNameTimerRef.current);
      setActiveTopPanel(null);
      setAutoNameStatus({ kind: "naming" });
    }
    try {
      const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/auto-name`, {
        method: "POST",
      });
      const body = (await response.json().catch(() => ({}))) as { title?: string; error?: string };
      if (!response.ok || !body.title) {
        throw new Error(body.error || `HTTP ${response.status}`);
      }

      const title = body.title.trim();
      setRefreshKey((key) => key + 1);
      if (activeSessionIdRef.current !== sessionId) return title;
      setSelectedSession((current) => current?.id === sessionId ? { ...current, name: title } : current);
      setSessionStats((current) => current?.sessionId === sessionId ? { ...current, sessionName: title } : current);
      if (!silent) {
        setAutoNameStatus({ kind: "success" });
        autoNameTimerRef.current = setTimeout(() => setAutoNameStatus({ kind: "idle" }), 1800);
      }
      return title;
    } catch (error) {
      if (!silent && activeSessionIdRef.current === sessionId) {
        const message = error instanceof Error ? error.message : String(error);
        setAutoNameStatus({ kind: "error", message });
        autoNameTimerRef.current = setTimeout(() => setAutoNameStatus({ kind: "idle" }), 5000);
      }
      return null;
    }
  }, []);

  const handleAutoName = useCallback(async () => {
    const sessionId = selectedSession?.id;
    if (!sessionId || autoNameStatus.kind === "naming") return;
    await requestAutoName(sessionId);
  }, [autoNameStatus.kind, requestAutoName, selectedSession?.id]);

  useEffect(() => {
    if (autoNameTimerRef.current) clearTimeout(autoNameTimerRef.current);
    setAutoNameStatus({ kind: "idle" });
  }, [selectedSession?.id]);

  useEffect(() => {
    // fork:gap-auto-name — 首个回复结束后静默命名一次。
    //
    // 条件（全部满足才触发）：
    //   - 会话已落盘（非 transient）且有名字为空——用户手动改过名就不会再动；
    //   - 已有至少一条消息（否则命名请求拿不到素材，后端也会拒绝）；
    //   - 当前会话没在跑（`runningSessionIds`）——避免和流式渲染抢同一个 API；
    //   - 该会话此前没尝试过（localStorage 标记，避免失败时反复重试）。
    const session = selectedSession;
    if (!session || session.transient || session.name) return;
    if (runningSessionIds.has(session.id)) return;
    const hasMessages = (sessionStats?.userMessages ?? 0) > 0 || session.messageCount > 0;
    if (!hasMessages) return;
    if (autoNameAttemptedRef.current.has(session.id)) return;
    if (readAutoNameAttempted(session.id)) {
      autoNameAttemptedRef.current.add(session.id);
      return;
    }
    autoNameAttemptedRef.current.add(session.id);
    markAutoNameAttempted(session.id);
    void requestAutoName(session.id, { silent: true });
  }, [requestAutoName, runningSessionIds, selectedSession, sessionStats?.userMessages]);

  const handleExplorerRefresh = useCallback(() => {
    setExplorerRefreshKey((k) => k + 1);
  }, []);

  const handleSessionForked = useCallback((newSessionId: string) => {
    invalidateWorkspaceRestore();
    activeNewSessionDraftKeyRef.current = null;
    setRefreshKey((k) => k + 1);
    setSessionKey((k) => k + 1);
    setNewSessionCwd(null);
    setSelectedSession((prev) => ({
      ...(prev ?? { path: "", cwd: "", created: "", modified: "", messageCount: 0, firstMessage: "" }),
      id: newSessionId,
      transient: false,
    }));
    hydrateSelectedSession(newSessionId);
    router.replace(`?session=${encodeURIComponent(newSessionId)}`, { scroll: false });
  }, [invalidateWorkspaceRestore, router, hydrateSelectedSession]);

  const handleAskInNewChat = useCallback(async (
    prompt: string,
    sourceSessionId: string,
    sourceEntryId: string,
  ) => {
    const result = await sendAgentCommand<{ newSessionId?: string }>(sourceSessionId, {
      type: "fork_branch",
      entryId: sourceEntryId,
    });
    if (!result?.newSessionId) throw new Error(translate("chat.quoteForkFailed"));
    setPendingQuotePrompt({ sessionId: result.newSessionId, text: prompt });
    handleSessionForked(result.newSessionId);
  }, [handleSessionForked, translate]);

  const handleFileSelectionInNewChat = useCallback(async (prompt: string) => {
    const cwd = selectedSession?.cwd ?? activeCwd;
    if (!cwd) throw new Error("当前工作区不可用，无法创建新对话。");
    const draftId = `file-selection-${createSelectionContextId()}`;
    setPendingNewSessionPrompt({ draftId, cwd, text: prompt });
    handleNewSession(draftId, cwd);
  }, [activeCwd, handleNewSession, selectedSession?.cwd]);

  const handleInitialRestoreDone = useCallback(() => {
    setInitialSessionRestored(true);
  }, []);

  const handleSessionDeleted = useCallback((sessionId: string) => {
    invalidateWorkspaceRestore();
    setRefreshKey((k) => k + 1);
    if (selectedSession?.id === sessionId) {
      // fork:tab-session — forget this tab's memory before clearing the selection.
      clearTabOpenSession(sessionId);
      const cwd = selectedSession.cwd;
      const draftId = typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
      setNewSessionDraftId(draftId);
      activeNewSessionDraftKeyRef.current = cwd ? `new:${draftId}:${cwd}` : null;
      setSelectedSession(null);
      setNewSessionCwd(cwd ?? null);
      setSessionKey((k) => k + 1);
      setBranchTree([]);
      setBranchActiveLeafId(null);
      setSystemPrompt(null);
      setSystemTools(null);
      setSystemInfoLoading(false);
      setActiveTopPanel(null);
      router.replace(typeof window !== "undefined" ? window.location.pathname : "/", { scroll: false });
    }
  }, [invalidateWorkspaceRestore, selectedSession, router]);

  const handleOpenFile = useCallback((
    filePath: string,
    fileName: string,
    options?: {
      sourceSessionId?: string | null;
      modeHint?: "preview" | "diff";
      locationTarget?: Omit<FileLocationTarget, "filePath">;
      /** fork:pdf-page-fragment — `#page=N` from a markdown link. */
      page?: number;
    },
  ) => {
    const sourceSessionId = options?.sourceSessionId;
    const page = options?.page ?? options?.locationTarget?.page;
    const tabId = `file:${filePath}`;
    // fork:md-preview-default — a markdown document is a document, not source code: it
    // opens on Preview. Only for a tab that is not open yet, so switching the same file
    // to Source and clicking it again keeps the user's choice (the mode is remembered
    // per tab in its viewerState). An explicit hint — a message link, a git-status row —
    // always wins.
    const modeHint = options?.modeHint
      ?? (getFileExt(filePath) === "md" && !fileTabs.some((tab) => tab.id === tabId) ? "preview" as const : undefined);
    setPendingFileLocation(options?.locationTarget ? { filePath, ...options.locationTarget } : null);
    setFileTabs((prev) => openFileTab(prev, {
      fileName,
      filePath,
      modeHint,
      sourceSessionId,
      tabId,
      page,
    }));
    setActiveFileTabId(tabId);
    // The chat never moves: it keeps the main region, and the document + tree live
    // in the right-hand workspace (user feedback 2026-09-16). The panel is widened
    // once, when it is too narrow for the tree column, so both fit without the
    // user having to drag the divider first.
    if (isMobile) {
      // On mobile the file panel is full-screen; close the drawer so it shows.
      setSidebarOpen(false);
      setRightPanelOpen(true);
    } else {
      setRightPanelOpen(true);
      // fork:ui-stable-panel — a document only gets the tree *beside* it when
      // the panel clears the container-query threshold, so widen once when it
      // does not. The previous version asked for min(58vw, 1020) and the
      // responsive maximum (viewport - chat - sidebar) then clamped it back,
      // which is what made the panel resize on its own; clamping the request to
      // that same maximum keeps the widen a one-shot with no snap-back.
      if (rightPanelResizer.width < EXPLORER_COLUMN_MIN_PANEL_WIDTH) {
        rightPanelResizer.setWidth(Math.min(EXPLORER_COLUMN_MIN_PANEL_WIDTH + 60, getResponsiveRightPanelMaxWidth()));
      }
    }
  }, [fileTabs, isMobile, rightPanelResizer, workspaceSwapped, getResponsiveRightPanelMaxWidth]);

  const handleOpenLinkedFile = useCallback((
    filePath: string,
    hint?: number | Omit<FileLocationTarget, "filePath">,
  ) => {
    const page = typeof hint === "number" ? hint : hint?.page;
    const locationTarget = typeof hint === "number" ? undefined : hint;
    const baseCwd = selectedSession?.cwd ?? activeCwd;
    const absolutePath = baseCwd && !/^(?:[a-zA-Z]:[\\/]|\\\\|\/)/.test(filePath)
      ? joinFilePath(baseCwd, filePath)
      : filePath;
    const sourceSessionId = locationTarget?.sourceSessionId ?? selectedSession?.id ?? null;
    handleOpenFile(absolutePath, getFileName(absolutePath), {
      sourceSessionId,
      modeHint: locationTarget && getFileExt(absolutePath) === "md" ? "preview" : undefined,
      locationTarget,
      page,
    });
  }, [activeCwd, handleOpenFile, selectedSession?.cwd, selectedSession?.id]);

  const handleOpenTerminal = useCallback((cwd: string) => {
    const existing = terminalTabs.find((tab) => tab.cwd === cwd);
    const tab = existing ?? newTerminalTab(cwd);
    if (!existing) setTerminalTabs((tabs) => [...tabs, tab]);
    setActiveFileTabId(tab.id);
    if (!workspaceSwapped) setRightPanelOpen(true);
    if (isMobile) setSidebarOpen(false);
  }, [terminalTabs, isMobile, workspaceSwapped]);

  const handleOpenBrowser = useCallback((url = "") => {
    // fork:open-link-in-app — 同一个 URL 已经开着就切过去。正文里反复引同一个
    // 链接、或者来回点同一处时，不该每点一次就多一个标签页。
    const existing = url ? browserTabsRef.current.find((open: BrowserTab) => open.url === url) : undefined;
    if (existing) {
      setActiveFileTabId(existing.id);
      setRightPanelOpen(true);
      return;
    }
    const tab = newBrowserTab(url);
    setBrowserTabs((tabs) => [...tabs, tab]);
    setActiveFileTabId(tab.id);
    // Same rule as opening a document: the chat keeps the main region and the
    // panel opens (widened once when it is too narrow) so the page gets the same
    // room a file preview would, instead of covering the conversation.
    if (isMobile) {
      setSidebarOpen(false);
      setRightPanelOpen(true);
    } else {
      setRightPanelOpen(true);
      // fork:ui-stable-panel — same one-shot widen as handleOpenFile.
      if (rightPanelResizer.width < EXPLORER_COLUMN_MIN_PANEL_WIDTH) {
        rightPanelResizer.setWidth(Math.min(EXPLORER_COLUMN_MIN_PANEL_WIDTH + 60, getResponsiveRightPanelMaxWidth()));
      }
    }
  }, [isMobile, rightPanelResizer, getResponsiveRightPanelMaxWidth]);

  const handleBrowserUrlChange = useCallback((tabId: string, url: string) => {
    setBrowserTabs((tabs) => tabs.map((tab) => (tab.id === tabId ? { ...tab, url } : tab)));
  }, []);

  const handleTerminalClosed = (tab: TerminalTab) => {
    const replacement = tab.closing === "restart" ? newTerminalTab(tab.cwd) : null;
    const remaining = terminalTabs.filter((item) => item.id !== tab.id);
    setTerminalTabs((tabs) => tabs.flatMap((item) => item.id !== tab.id ? [item] : replacement ? [replacement] : []));
    setActiveFileTabId((current) => current !== tab.id ? current : replacement?.id ?? remaining.at(-1)?.id ?? fileTabs.at(-1)?.id ?? null);
    if (!workspaceSwapped && !replacement && !remaining.length && !fileTabs.length) setRightPanelOpen(false);
  };

  // fork:proma-05-explore — 打开/切换探索分支的右栏 tab
  const openBranchTab = useCallback((sessionId: string, parentSessionId?: string | null) => {
    const id = `branch:${sessionId}`;
    setBranchTabs((tabs) => (tabs.some((tab) => tab.id === id)
      ? tabs
      : [...tabs, { id, sessionId, parentSessionId: parentSessionId ?? null, label: translate("explore.title") }]));
    setActiveFileTabId(id);
    setRightPanelOpen(true);
  }, [translate]);

  const openGitGraphTab = useCallback(() => {
    setGitGraphOpen(true);
    setActiveFileTabId(GIT_GRAPH_TAB_ID);
    setRightPanelOpen(true);
  }, []);

  const handleCloseFileTab = useCallback((tabId: string) => {
    if (tabId === GIT_GRAPH_TAB_ID) {
      setGitGraphOpen(false);
      const siblingSingleton: string[] = [];
      const remainingIds = [
        ...fileTabs.map((tab) => tab.id),
        ...terminalTabs.map((tab) => tab.id),
        ...browserTabs.map((tab) => tab.id),
        ...branchTabs.map((tab) => tab.id),
        ...siblingSingleton,
      ];
      setActiveFileTabId((current) => current !== tabId ? current : remainingIds.at(-1) ?? null);
      if (!workspaceSwapped && remainingIds.length === 0) setRightPanelOpen(false);
      return;
    }
    if (branchTabs.some((tab) => tab.id === tabId)) {
      const remaining = branchTabs.filter((tab) => tab.id !== tabId);
      setBranchTabs(remaining);
      setActiveFileTabId((current) => current !== tabId ? current : remaining.at(-1)?.id ?? fileTabs.at(-1)?.id ?? null);
      return;
    }
    if (browserTabs.some((tab) => tab.id === tabId)) {
      const remaining = browserTabs.filter((tab) => tab.id !== tabId);
      setBrowserTabs(remaining);
      setActiveFileTabId((cur) => (cur !== tabId
        ? cur
        : fileTabs.at(-1)?.id ?? terminalTabs.at(-1)?.id ?? remaining.at(-1)?.id ?? null));
      if (!workspaceSwapped && remaining.length === 0 && fileTabs.length === 0 && terminalTabs.length === 0) {
        setRightPanelOpen(false);
      }
      return;
    }
    if (terminalTabs.some((tab) => tab.id === tabId)) {
      setTerminalTabs((tabs) => tabs.map((tab) => tab.id === tabId && !tab.closing ? { ...tab, closing: "close" } : tab));
      return;
    }
    setFileTabs((prev) => {
      const next = prev.filter((t) => t.id !== tabId);
      if (!workspaceSwapped && next.length === 0 && terminalTabs.length === 0) setRightPanelOpen(false);
      return next;
    });
    setActiveFileTabId((cur) => {
      if (cur !== tabId) return cur;
      const remaining = fileTabs.filter((t) => t.id !== tabId);
      return remaining.at(-1)?.id ?? terminalTabs.at(-1)?.id ?? null;
    });
  }, [branchTabs, browserTabs, fileTabs, terminalTabs, workspaceSwapped]);

  // fork:zc-06 — tab 概览：记录「最近关闭」，并提供批量关闭 / 重开。
  //
  // 记录点放在「关闭」这个动作的包装层，而不是散在 handleCloseFileTab 的各条分支里：
  // 它有六条分支（git-graph / 会话分支 / 浏览器 / 终端 / 文件），逐条插一遍必然漏一条。
  // 只有能靠一个路径重建的 tab 会被记下（见 lib/recent-closed-tabs.ts 的头注释）。
  const [recentClosedTabs, setRecentClosedTabs] = useState<RestorableTab[]>([]);
  useEffect(() => {
    // localStorage 只能在浏览器里读，所以放到 effect 而不是 useState 初始化器。
    setRecentClosedTabs(loadRecentClosedTabs());
  }, []);
  useEffect(() => {
    saveRecentClosedTabs(recentClosedTabs);
  }, [recentClosedTabs]);

  const handleCloseTabWithHistory = useCallback((tabId: string) => {
    const tab = panelTabs.find((item) => item.id === tabId);
    if (tab) setRecentClosedTabs((prev) => recordClosedTab(prev, tab));
    handleCloseFileTab(tabId);
  }, [handleCloseFileTab, panelTabs]);

  // 批量关闭不循环调 handleCloseFileTab：它每次都从闭包里的旧数组推导剩余项，
  // 同一 tick 连调会用第一次的结果覆盖第二次（越关越剩）。这里一次性算完。
  const handleCloseAllTabs = useCallback(() => {
    setRecentClosedTabs((prev) => panelTabs.reduce((list, tab) => recordClosedTab(list, tab), prev));
    setFileTabs([]);
    setTerminalTabs([]);
    setBrowserTabs([]);
    setBranchTabs([]);
    setGitGraphOpen(false);
    setActiveFileTabId(null);
    if (!workspaceSwapped) setRightPanelOpen(false);
  }, [panelTabs, workspaceSwapped]);

  const handleCloseOtherTabs = useCallback(() => {
    const keep = activeFileTabId;
    const closing = panelTabs.filter((tab) => tab.id !== keep);
    setRecentClosedTabs((prev) => closing.reduce((list, tab) => recordClosedTab(list, tab), prev));
    setFileTabs((tabs) => tabs.filter((tab) => tab.id === keep));
    setBrowserTabs((tabs) => tabs.filter((tab) => tab.id === keep));
    setBranchTabs((tabs) => tabs.filter((tab) => tab.id === keep));
    // 终端 tab 走 closing 标记（要等 PTY 收尾），与单个关闭时的行为一致。
    setTerminalTabs((tabs) => tabs.map((tab) => (tab.id === keep ? tab : { ...tab, closing: "close" as const })));
    setGitGraphOpen(keep === GIT_GRAPH_TAB_ID);
  }, [activeFileTabId, panelTabs]);

  const handleRestoreClosedTab = useCallback((tab: RestorableTab) => {
    // 重开成功就从历史里拿掉，否则它会在列表里留着，看起来像没打开。
    setRecentClosedTabs((prev) => forgetClosedTab(prev, tab.id));
    if (tab.kind === "git-graph") {
      openGitGraphTab();
      return;
    }
    handleOpenFile(tab.filePath, tab.label);
  }, [handleOpenFile, openGitGraphTab]);

  const handleViewFullHistory = useCallback(() => {
    if (!selectedSession) return;
    window.open(
      `/api/sessions/${encodeURIComponent(selectedSession.id)}/export?inline=1`,
      "_blank",
      "noopener,noreferrer",
    );
  }, [selectedSession]);

  // Show chat area if a session is selected, or if we have a cwd to start a new session in
  const effectiveNewSessionCwd = newSessionCwd ?? (selectedSession === null && activeCwd ? activeCwd : null);
  const newSessionDraftKey = selectedSession === null && effectiveNewSessionCwd
    ? `new:${newSessionDraftId}:${effectiveNewSessionCwd}`
    : null;
  useLayoutEffect(() => {
    activeNewSessionDraftKeyRef.current = newSessionDraftKey;
  }, [newSessionDraftKey]);
  // fork:desktop-shell — Dock badge (how many runs are live) and keep-awake for the
  // duration of a run. Both are no-ops in the browser.
  useEffect(() => {
    setDesktopBadge(runningSessionIds.size);
    setDesktopKeepAwake(runningSessionIds.size > 0);
    return () => setDesktopKeepAwake(false);
  }, [runningSessionIds]);

  const showChat = selectedSession !== null || effectiveNewSessionCwd !== null;
  // fork:zn-03 — empty-chat signal reported up by ChatWindow (Zeno hides
  // ThreadHeader until the timeline has activity). Mobile keeps the bar: the
  // sidebar drawer toggle lives there and empty state has no other entry.
  const [chatEmpty, setChatEmpty] = useState(false);
  // fork:design-components —— 画板 01 帧 A 在空会话时**仍然画顶栏**（标题 + 分支 + 动作），
  // 所以不再隐藏；移动端本来就是抽屉开合按钮的载体。
  const hideTopBar = false;
  // fork:ui-projectchip — the new-session page's workspace selector. Mirrors what the
  // sidebar's NewTaskPicker already offers, minus the two actions it lacks:
  // "open folder" (validate a folder, then start there) and "new blank project".
  const refreshChatWorkspaceTarget = useCallback(async () => {
    try {
      const res = await fetch("/api/chat-workspace", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json() as { cwd?: string; projectKey?: string };
      if (data.cwd && data.projectKey) setChatWorkspaceTarget({ cwd: data.cwd, key: data.projectKey });
    } catch {
      // Offline or route missing: the selector still lists projects and disables
      // "not in a project" instead of silently pointing at a stale directory.
    }
  }, []);
  useEffect(() => {
    void refreshChatWorkspaceTarget();
  }, [refreshChatWorkspaceTarget]);

  // Move the workspace, then open a fresh composer there. Same two steps the sidebar
  // performs for 新建任务 (setSelectedCwd + onNewSession); handleCwdChange keeps the
  // project identity, file tabs and per-workspace memory in step.
  // fork:desktop-shell — native-only signals: tell CSS it can install the drag
  // region, and follow notification clicks / system theme flips. Re-subscribes when
  // the catalog changes (cheap: one listener swap) instead of caching refs.
  useEffect(() => {
    markDesktopShell();
    const bridge = getDesktopBridge();
    if (!bridge) return;
    return bridge.onAction((action) => {
      if (action.kind === "notification-clicked") {
        const match = /[?&]session=([^&]+)/.exec(action.url);
        const sessionId = match ? decodeURIComponent(match[1]) : null;
        if (!sessionId) return;
        const session = sessionCatalog.find((item) => item.id === sessionId);
        if (session) handleSelectSession(session, true);
        return;
      }
      if (action.kind === "theme-changed") {
        // The app has its own palettes; an "auto" palette can listen for this.
        window.dispatchEvent(new CustomEvent("pi-desktop-theme", { detail: action.dark }));
      }
    });
  }, [sessionCatalog, handleSelectSession]);

  const startSessionIn = useCallback((cwd: string, projectRoot?: string | null, projectKey?: string | null) => {
    handleCwdChange(cwd, projectRoot ?? null, projectKey ?? null);
    const tempId = typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    handleNewSession(tempId, cwd);
  }, [handleCwdChange, handleNewSession]);

  // Resolve server-side identity (and add the root to the files allow-list) before a
  // picked path becomes active — the contract /api/cwd/validate provides the sidebar.
  // Returns an error message, or null on success.
  const startSessionAtPath = useCallback(async (path: string): Promise<string | null> => {
    try {
      const res = await fetch("/api/cwd/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: path }),
      });
      const data = await res.json().catch(() => ({})) as {
        cwd?: string;
        projectRoot?: string;
        projectKey?: string;
        error?: string;
      };
      if (!res.ok || !data.cwd || !data.projectRoot || !data.projectKey) {
        return data.error ?? `HTTP ${res.status}`;
      }
      startSessionIn(data.cwd, data.projectRoot, data.projectKey);
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }, [startSessionIn]);


  const newSessionTargets = useMemo<NewSessionTargets | null>(() => {
    if (selectedSession !== null) return null;
    const projects: NewSessionProject[] = withoutChatProject(
      getRecentProjects(sessionCatalog),
      chatWorkspaceTarget?.key ?? null,
    ).map((project) => ({
      key: project.key,
      root: project.root,
      name: getFileName(project.root) || project.root,
    }));
    return {
      projects,
      chatPath: chatWorkspaceTarget?.cwd ?? null,
      activeCwd: effectiveNewSessionCwd,
      error: homeTargetError,
      onRefresh: () => { void refreshChatWorkspaceTarget(); },
      onPickProject: (project) => {
        setHomeTargetError(null);
        startSessionIn(project.root, project.root, project.key);
      },
      onPickChat: () => {
        setHomeTargetError(null);
        if (chatWorkspaceTarget) startSessionIn(chatWorkspaceTarget.cwd, chatWorkspaceTarget.cwd, chatWorkspaceTarget.key);
      },
      /* fork:ui-ctxbar —— 输入框上方那枚分支芯片点开的工作区（worktree）列表；
         选中另一个工作区 = 切目录并在那里开一条新会话，与侧栏/顶栏同一动作。 */
      onPickWorkspace: (path, projectRoot) => {
        setHomeTargetError(null);
        startSessionIn(path, projectRoot ?? path);
      },
      onOpenFolder: () => {
        setHomeTargetError(null);
        // fork:ui-pick-directory — 优先系统原生文件夹选择器；桌面版直接拿到绝对路径并
        // 切到那个目录。拿不到（浏览器/远程）才回退到手输路径的弹窗。
        // fix:pick-directory-cancel — 用户在系统选框里点「取消」时**什么都不做**：
        // 取消不是「没有原生能力」，再弹一个手输弹窗就是二次打扰（用户实测）。
        void (async () => {
          const result = await pickDirectory();
          if (result.status === "picked") {
            startSessionIn(result.cwd, result.cwd);
            return;
          }
          if (result.status === "cancelled") return;
          setHomeFolderPickerOpen(true);
        })();
      },
    };
  }, [
    chatWorkspaceTarget,
    effectiveNewSessionCwd,
    homeTargetError,
    refreshChatWorkspaceTarget,
    selectedSession,
    sessionCatalog,
    startSessionIn,
  ]);
  const projectTrustCwd = selectedSession?.cwd ?? effectiveNewSessionCwd;
  // While restoring initial session from URL, don't show the placeholder
  const showPlaceholder = initialSessionRestored && !showChat;

  useEffect(() => {
    setProjectTrust(null);
    setProjectTrustDialogOpen(false);
    setProjectTrustError(null);
    if (!projectTrustCwd) return;

    const controller = new AbortController();
    fetch(`/api/project-trust?cwd=${encodeURIComponent(projectTrustCwd)}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        const data = await response.json() as ProjectTrustStatus & { error?: string };
        if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
        setProjectTrust(data);
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        console.error("Failed to load project trust:", error);
      });
    return () => controller.abort();
  }, [projectTrustCwd]);

  const handleTrustProject = useCallback(async () => {
    if (!projectTrustCwd || projectTrustBusy) return;
    setProjectTrustBusy(true);
    setProjectTrustError(null);
    try {
      const response = await fetch("/api/project-trust", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: projectTrustCwd }),
      });
      const data = await response.json() as ProjectTrustStatus & { error?: string };
      if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
      setProjectTrust(data);
      setProjectTrustDialogOpen(false);
      setModelsRefreshKey((key) => key + 1);
      setSessionKey((key) => key + 1);
    } catch (error) {
      setProjectTrustError(error instanceof Error ? error.message : String(error));
    } finally {
      setProjectTrustBusy(false);
    }
  }, [projectTrustBusy, projectTrustCwd]);

  const activeFileTab = fileTabs.find((tab) => tab.id === activeFileTabId) ?? null;
  const activeCwdName = activeCwd ? getFileName(activeCwd) || activeCwd : null;
  const windowTitle = activeCwdName ? `${activeCwdName} - PI NEXT` : "PI NEXT";
  const topBarSessionTitle = selectedSession
    ? (selectedSession.name?.trim()
      || selectedSession.firstMessage?.trim().replace(/\s+/g, " ").slice(0, 80)
      || translate("i18n.newSession"))
    : translate("i18n.newSession");
  // fork:design-components —— 画板 01/02 顶栏的 .pw-chipbtn：有会话时给分支（工作区列表
  // 的触发钮）。新会话那枚工作区芯片已按用户要求撤掉 —— 它的两个职责都有更好的去处：
  // 换工作区/目录在输入框上方的 `.pw-ctxbar`（ProjectChip + 分支芯片），
  // 标题旁不再重复一枚可点的项目名。
  const topBarBranch = selectedSession?.branch?.trim() || null;

  useEffect(() => {
    const syncWindowTitle = () => {
      if (document.title !== windowTitle) document.title = windowTitle;
    };

    syncWindowTitle();
    const observer = new MutationObserver(syncWindowTitle);
    observer.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [windowTitle]);

  const sidebarContent = (
    <>
      <SessionSidebar
        selectedSessionId={selectedSession?.id ?? null}
        onSelectSession={handleSelectSession}
        onNewSession={handleNewSession}
        initialSessionId={initialSessionId}
        skipInitialProjectSelection={initialNavigation.requestedCwd !== null}
        onInitialRestoreDone={handleInitialRestoreDone}
        refreshKey={refreshKey}
        onSessionDeleted={handleSessionDeleted}
        selectedCwd={selectedSession?.cwd ?? newSessionCwd ?? null}
        onCwdChange={handleCwdChange}
        onBackgroundTaskDone={handleBackgroundTaskDone}
        onRunningSessionIdsChange={handleRunningSessionIdsChange}
        onSessionsChange={handleSessionsChange}
        onToggleSidebar={handleSidebarToggle}
        searchRequestId={searchRequestId}
      />
      {/* fork:design-components —— 导轨底栏 = 画板 02 的 .pw-side-foot
          （settings 图标 + 「设置」+ 右端版本徽章），整行可点开设置。 */}
      <button
        type="button"
        onClick={() => setSettingsSection(getLastSettingsSection(projectTrustCwd))}
        title={translate("common.settings")}
        aria-label={translate("common.settings")}
        className="pw-side-foot"
      >
        <span className="pw-ico"><i data-ico="settings" data-size="14"></i></span>
        {translate("common.settings")}
        <span className="grow" />
        <span className="pw-badge count">v{process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0"}</span>
      </button>
    </>
  );

  const renderProjectTrustWarning = (mobileBanner: boolean) => {
    if (!showChat || !projectTrust?.requiresTrust || projectTrust.trusted) return null;
    // fork:design-system SW-16 —— 画板 60 帧 D（用户裁定）：移动端**不弹模态框**
    // （窄屏会把输入框整个挡掉），改成顶栏下方这条常驻 `.pw-banner`，横幅内联
    // 「信任」按钮直接完成信任动作；桌面维持「点开画板 50 的 pw-modal」。
    if (mobileBanner) {
      return (
        <div
          className="pw-banner"
          data-mobile-trust-banner="true"
          role={projectTrustError ? "alert" : "status"}
          style={{ flexShrink: 0 }}
        >
          <span className="pw-ico" style={{ color: "var(--warning)" }}>
            <i data-ico="shield-question" data-size="16" aria-hidden="true"></i>
          </span>
          <span className="grow" style={{ fontSize: "var(--text-secondary)" }}>
            {translate("trust.mobileBannerBody")}
            {projectTrustError ? <span className="pw-dim"> · {projectTrustError}</span> : null}
          </span>
          <button
            type="button"
            className="pw-btn primary sm"
            disabled={projectTrustBusy}
            onClick={() => void handleTrustProject()}
          >
            {projectTrustBusy ? translate("trust.trusting") : translate("trust.trustShort")}
          </button>
        </div>
      );
    }
    return (
      <button
        type="button"
        onClick={() => {
          setProjectTrustError(null);
          setProjectTrustDialogOpen(true);
        }}
        title={translate("trust.resourcesNotLoaded")}
        aria-label={translate("trust.resourcesNotLoaded")}
        /* fork:design-components —— 桌面是画板的一条 `.pw-alert`（错误底 + 红色）；
           底色 / 圆角 / 字号全部来自 board.css，组件里只剩 UA 归零这一档。
           fork:board-diff-2026-10-01 —— `font: "inherit"` 与上一行注释矛盾：
           它把 board.css:872 的 `font-size: var(--text-secondary)`（12px）顶成了
           继承正文 13px（`50-dialogs` 的 spec 报出 fs 13 ≠ 12 / lh 19.5 ≠ 18）。
           只归零 UA 的话删掉 font 即可，字号由类给。 */
        style={{
          alignSelf: "center",
          margin: 0,
          border: 0,
          textAlign: "left",
          cursor: "pointer",
          flexShrink: 0,
        }}
        className="pw-alert"
      >
        <span className="pw-ico"><i data-ico="shield-question" data-size="13"></i></span>
        <span>{translate("trust.resourcesNotLoaded")}</span>
      </button>
    );
  };

  const renderChatToolbarActions = (mobile: boolean) => {
    if (!mobile && !showChat) return null;
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
        {/* fork:ui-14b — 完整历史 / 生成标题 / 导出 / 系统提示词 / 工具定义
            现在都是顶栏右上角的图标按钮（原来桌面上折进 ⋯ 菜单，点两次才到位）。 */}
        <button
          type="button"
          onClick={() => {
            handleViewFullHistory();
            if (mobile && isNarrowMobile) setMobileToolbarMoreOpen(true);
          }}
          disabled={!selectedSession}
          title={selectedSession ? translate("history.full") : translate("history.unsaved")}
          aria-label={translate("history.full")}
          /* fork:design-components —— 顶栏动作钮 = 画板 .pw-iconbtn（桌面 28px）
             / 画板 60 的 .pw-touch（手机 36px 触控靶）；盒子由这两个类给，
             组件里不再重复 width/height。 */
          style={{
            margin: 0,
            padding: 0,
            color: selectedSession ? undefined : "var(--text-dim)",
            cursor: selectedSession ? "pointer" : "not-allowed",
            opacity: selectedSession ? 1 : 0.45,
          }}
          data-mobile-toolbar-action={mobile ? "history" : undefined}
          className={mobile ? "pw-touch" : "pw-iconbtn"}
        >
          <span className="pw-ico"><i data-ico="history" data-size="14"></i></span>

        </button>
        {(() => {
          // 上下文压缩后当前消息可能不再包含 user 消息，需同时参考会话文件的消息总数。
          const hasMessages = Boolean(
            selectedSession
            && ((sessionStats?.userMessages ?? 0) > 0 || selectedSession.messageCount > 0),
          );
          const disabled = !selectedSession || selectedSession.transient || !hasMessages || autoNameStatus.kind === "naming";
          const isSuccess = autoNameStatus.kind === "success";
          const isError = autoNameStatus.kind === "error";
          const label = autoNameStatus.kind === "naming"
            ? translate("title.generating")
            : isSuccess
              ? translate("title.updated")
              : isError
                ? translate("title.failed")
                : translate("title.generate");
          const title = !selectedSession || selectedSession.transient
            ? translate("title.unsaved")
            : !hasMessages
              ? translate("title.noMessages")
              : isError
                ? autoNameStatus.message
                : translate("title.generateSession");

          return (
            <button
              type="button"
              onClick={() => {
                void handleAutoName();
                if (mobile && isNarrowMobile) setMobileToolbarMoreOpen(true);
              }}
              disabled={disabled}
              title={title}
              aria-label={label}
              /* fork:design-components —— 画板 .pw-iconbtn / .pw-touch；
                 naming=loader-circle / success=check / 默认=wand-sparkles。 */
              style={{
                margin: 0,
                padding: 0,
                color: isError ? "var(--error)" : isSuccess ? "var(--accent-text)" : disabled ? "var(--text-dim)" : undefined,
                cursor: disabled ? "not-allowed" : "pointer",
                opacity: disabled && autoNameStatus.kind !== "naming" ? 0.45 : 1,
              }}
              data-mobile-toolbar-action={mobile ? "name" : undefined}
              className={mobile ? "pw-touch" : "pw-iconbtn"}
            >
              {autoNameStatus.kind === "naming" ? (
                <span className="pw-ico" style={{ animation: "spin 0.8s linear infinite" }}><i data-ico="loader-circle" data-size="14"></i></span>
              ) : isSuccess ? (
                <span className="pw-ico"><i data-ico="check" data-size="14"></i></span>
              ) : (
                <span className="pw-ico"><i data-ico="wand-sparkles" data-size="14"></i></span>
              )}

            </button>
          );
        })()}
        {hasSubagentSessions && (
          <button
            type="button"
            onClick={(event) => toggleTopPanel("agents", mobile, event.currentTarget)}
            title={translate("agentSwitcher.title")}
            aria-label={translate("agentSwitcher.title")}
            aria-pressed={activeTopPanel === "agents"}
            /* fork:design-components —— 图标 + 数量徽标这一档用画板的 `.pw-iconbtn sm`
               再按内容放宽（`width: auto` 是按钮 UA 的收缩宽度，画板静态件是 div，
               所以这一条必须由产品侧给）；data-ico=bot。 */
            style={{
              width: "auto",
              margin: 0,
              padding: "0 6px",
              display: "inline-flex",
              alignItems: "center",
              gap: "var(--s1)",
              background: activeTopPanel === "agents" ? "var(--bg-selected)" : undefined,
              color: activeTopPanel === "agents" ? "var(--text)" : undefined,
            }}
            data-mobile-toolbar-action={mobile ? "agents" : undefined}
            className="pw-iconbtn sm"
          >
            <span className="pw-ico" style={{ flexShrink: 0 }}><i data-ico="bot" data-size="14"></i></span>

            <span
              aria-hidden="true"
              style={{
                minWidth: 15, height: 15, padding: "0 4px", display: "grid", placeItems: "center",
                borderRadius: "var(--radius-sm)", background: "var(--bg-selected)", color: "var(--accent)",
                fontSize: TEXT["2xs"], lineHeight: 1, fontVariantNumeric: "tabular-nums",
                ...(mobile ? { position: "absolute", top: 2, right: 2, minWidth: 13, height: 13, padding: "0 3px", fontSize: TEXT["2xs"] } : {}),
              }}
            >
              {activeSessionFamily!.subagents.length}
            </span>
          </button>
        )}
        {sessionHasBranches && (mobile ? (
          <button
            type="button"
            onClick={(event) => toggleTopPanel("branches", true, event.currentTarget)}
            title={translate("i18n.branches")}
            aria-label={translate("i18n.branches")}
            aria-pressed={activeTopPanel === "branches"}
            /* fork:design-components —— 画板 .pw-iconbtn / .pw-touch；会话分支用 git-fork，
               与左侧 git-branch 的 main 芯片区分。 */
            style={{
              background: activeTopPanel === "branches" ? "var(--bg-selected)" : undefined,
              color: activeTopPanel === "branches" ? "var(--text)" : undefined,
            }}
            data-mobile-toolbar-action="branches"
            className={mobile ? "pw-touch" : "pw-iconbtn"}
          >
            <span className="pw-ico" style={{ color: branchTree.length > 0 ? "var(--accent)" : undefined }}><i data-ico="git-fork" data-size="14"></i></span>
          </button>
        ) : (
          <BranchNavigator
            tree={branchTree}
            activeLeafId={branchActiveLeafId}
            onLeafChange={handleBranchLeafChange}
            inline
            open={activeTopPanel === "branches"}
            onToggle={() => toggleTopPanel("branches")}
            hasSession
          />
        ))}
        <button
          ref={systemBtnRef}
          type="button"
          onClick={(event) => handleSystemInfoToggle("system", mobile, event.currentTarget)}
          disabled={mobile && !showChat}
          title={translate("system.prompt")}
          aria-label={translate("system.prompt")}
          aria-pressed={activeTopPanel === "system"}
          style={{
            alignSelf: "center", margin: 0,
            background: activeTopPanel === "system" ? "var(--bg-selected)" : undefined,
            cursor: mobile && !showChat ? "not-allowed" : "pointer",
            color: activeTopPanel === "system" ? "var(--text)" : undefined,
            opacity: mobile && !showChat ? 0.45 : 1,
          }}
          data-mobile-toolbar-action={mobile ? "system" : undefined}
          className={mobile ? "pw-touch" : "pw-iconbtn"}
        >
          <span className="pw-ico" style={{ color: systemPrompt ? "var(--accent)" : undefined, flexShrink: 0 }}><i data-ico="file-text" data-size="14"></i></span>

        </button>
        <button
          type="button"
          onClick={(event) => handleSystemInfoToggle("tools", mobile, event.currentTarget)}
          disabled={mobile && !showChat}
          title={translate("tools.title")}
          aria-label={translate("tools.title")}
          aria-pressed={activeTopPanel === "tools"}
          style={{
            alignSelf: "center", margin: 0,
            background: activeTopPanel === "tools" ? "var(--bg-selected)" : undefined,
            cursor: mobile && !showChat ? "not-allowed" : "pointer",
            color: activeTopPanel === "tools" ? "var(--text)" : undefined,
            opacity: mobile && !showChat ? 0.45 : 1,
          }}
          data-mobile-toolbar-action={mobile ? "tools" : undefined}
          className={mobile ? "pw-touch" : "pw-iconbtn"}
        >
          <span className="pw-ico" style={{ color: systemTools?.some((tool) => tool.active) ? "var(--accent)" : undefined, flexShrink: 0 }}><i data-ico="wrench" data-size="14"></i></span>

        </button>
        {/* fork:ui-14b — 导出 Markdown 从 ⋯ 菜单搬成图标：与其它四个动作同一行，
            一眼看得见；新窗口打开（?format=md 让浏览器直接渲染，方便复制片段）。 */}
        <button
          type="button"
          onClick={() => {
            if (!selectedSession) return;
            window.open(`/api/sessions/${encodeURIComponent(selectedSession.id)}/export?format=md`, "_blank", "noopener,noreferrer");
            if (mobile && isNarrowMobile) setMobileToolbarMoreOpen(true);
          }}
          disabled={!selectedSession}
          title={translate("session.exportMarkdown")}
          aria-label={translate("session.exportMarkdown")}
          /* fork:design-components —— 画板 .pw-iconbtn / .pw-touch；data-ico=download。 */
          style={{
            alignSelf: "center", margin: 0,
            color: selectedSession ? undefined : "var(--text-dim)",
            cursor: selectedSession ? "pointer" : "not-allowed",
            opacity: selectedSession ? 1 : 0.45,
          }}
          className={mobile ? "pw-touch" : "pw-iconbtn"}
        >
          <span className="pw-ico"><i data-ico="download" data-size="14"></i></span>
        </button>
      </div>
    );
  };

  /* fork:design-components —— 顶栏标题 = 画板 01/02 的 `.pw-tb-title`：一枚淡色
     panel-left + 标题文本，省略号由 `.pw-topbar .pw-tb-title span` 给（board.css
     line 224-225），所以这里不再自绘盒子。标题同时是「最近会话」下拉的触发钮
     （fork:ui-18），激活档由 `is-on` 表达。手机上表头左侧已经有自己的
     panel-left / menu 钮，所以这里不再重复一枚图标。 */
  const renderSessionTitle = () => (
<button
  type="button"
  ref={topBarTitleRef}
  title={topBarSessionTitle}
  aria-label={translate("sidebar.recentSessions")}
  aria-expanded={activeTopPanel === "sessions"}
  onClick={() => toggleTopPanel("sessions", false)}
  style={{ border: 0, background: "transparent", fontFamily: "inherit", cursor: "pointer", textAlign: "left" }}
  onMouseEnter={(event) => { event.currentTarget.style.background = activeTopPanel === "sessions" ? "var(--bg-selected)" : "var(--bg-hover)"; }}
  onMouseLeave={(event) => { event.currentTarget.style.background = activeTopPanel === "sessions" ? "var(--bg-selected)" : "transparent"; }}
  className={activeTopPanel === "sessions" ? "pw-tb-title is-on" : "pw-tb-title"}
>
  {!isMobile && <span className="pw-ico pw-dim"><i data-ico="panel-left" data-size="14"></i></span>}
  <span>{topBarSessionTitle}</span>
</button>
  );


  /* fork:zn-21 / fork:design-components —— 折叠导轨照画板 02 帧 C 重抄（2026-09-30）。
     画板那一条是**全高竖列**：logo 在顶，展开 / 搜索 / 新建会话居中，设置贴底，
     面板底 + 发丝右线。原实现是绝对定位在顶栏左端的 3 按钮浮块 —— 少了 logo 与设置，
     也不占列宽（顶栏只能靠 92px 的 leading inset 给它让位），与画板结构不同。
     macOS 的红绿灯压住这一列顶端：那一段让位放在 fork-ui.css 的平台钩子里，
     不写进内联（`[data-desktop-platform="darwin"] .pw-rail`）。 */
  const renderCollapsedRail = () => (
    <div
      className="pw-rail"
      style={{
        flexShrink: 0,
        zIndex: 200,
      }}
    >
      {/* 画板 02 的导轨顶端是应用标记（口径 24×24 + canvas 底 + 发丝边，
          board.css 的 `.pw-rail .pw-logo` 承担全部视觉）。 */}
      <span className="pw-logo" aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element -- 静态品牌资产，不走 next/image 优化器 */}
        <img src="/pi-next-logo.png" alt="" draggable={false} style={{ display: "block", width: "var(--icon-md)", height: "auto" }} />
      </span>
      <button
        type="button"
        onClick={handleSidebarToggle}
        aria-controls="session-sidebar"
        aria-expanded={false}
        title={translate("sidebar.show")}
        aria-label={translate("sidebar.show")}
        className="pw-iconbtn"
      >
        {/* 画板 02 的导轨第一枚是 panel-right（把侧栏拉回来）。 */}
        <span className="pw-ico"><i data-ico="panel-right" data-size="16"></i></span>
      </button>
      <button
        type="button"
        onClick={() => {
          setSidebarOpen(true);
          setSearchRequestId((id) => id + 1);
        }}
        title={translate("sidebar.toggleSessionSearch")}
        aria-label={translate("sidebar.toggleSessionSearch")}
        className="pw-iconbtn"
      >
        <span className="pw-ico"><i data-ico="search" data-size="16"></i></span>
      </button>
      <button
        type="button"
        onClick={() => {
          // 与导轨里的「新建任务」同义：在当前目录开一条新会话。`startSessionIn`
          // 已经是 AppShell 里「切目录 + 起新会话」的既有入口，不另写一份。
          setSidebarOpen(true);
          const cwd = selectedSession?.cwd ?? newSessionCwd ?? activeCwd ?? null;
          if (cwd) startSessionIn(cwd, projectTrustCwd, null);
        }}
        title={translate("sidebar.newTask")}
        aria-label={translate("sidebar.newTask")}
        className={`pw-iconbtn${selectedSession ? "" : " is-on"}`}
      >
        <span className="pw-ico"><i data-ico="square-pen" data-size="16"></i></span>
      </button>
      <span className="grow" />
      {/* 画板 02 的导轨贴底是设置入口（侧栏展开时它在 .pw-side-foot）。 */}
      <button
        type="button"
        onClick={() => setSettingsSection(getLastSettingsSection(projectTrustCwd))}
        title={translate("common.settings")}
        aria-label={translate("common.settings")}
        className="pw-iconbtn"
      >
        <span className="pw-ico"><i data-ico="settings" data-size="16"></i></span>
      </button>
    </div>
  );

  const renderSidebarToggle = (mobile: boolean) => (
    <button
      type="button"
      onClick={handleSidebarToggle}
      className={mobile ? undefined : "desktop-sidebar-toggle"}
      aria-controls="session-sidebar"
      aria-expanded={sidebarOpen}
      title={sidebarOpen ? translate("sidebar.hide") : translate("sidebar.show")}
      aria-label={sidebarOpen ? translate("sidebar.hide") : translate("sidebar.show")}
      style={{
        position: "relative",
        display: "flex", alignItems: "center", justifyContent: "center",
        width: "var(--control-xs)", height: "var(--control-xs)", padding: 0,
        background: "transparent", border: "none",
        color: "var(--text-muted)", cursor: "pointer", flexShrink: 0, transition: "color 0.12s",
      }}
      onMouseEnter={(event) => { event.currentTarget.style.color = "var(--text)"; }}
      onMouseLeave={(event) => { event.currentTarget.style.color = "var(--text-muted)"; }}
    >
      <span className="pw-ico"><i data-ico="menu" data-size="18"></i></span>
    </button>
  );

  const renderMainFileToggle = (mobile: boolean) => {
    const covered = mobile && isNarrowMobile && mobileToolbarMoreOpen;
    const label = mobile
      ? rightPanelOpen ? translate("files.hidePanel") : translate("files.showPanel")
      : rightPanelOpen ? translate("layout.hideSecondaryWorkspace") : translate("layout.showSecondaryWorkspace");
    return (
      <button
        type="button"
        onClick={handleRightPanelToggle}
        className={mobile ? undefined : "desktop-secondary-workspace-toggle"}
        disabled={covered}
        tabIndex={covered ? -1 : undefined}
        aria-controls={mobile ? "file-panel" : secondaryWorkspaceId}
        aria-expanded={rightPanelOpen}
        aria-hidden={covered ? true : undefined}
        title={label}
        aria-label={label}
        data-mobile-toolbar-file={mobile ? "true" : undefined}
        style={{
          // fork:ui-topbar-align — see the sidebar toggle: same 9px offset.
          position: mobile ? "relative" : "absolute",
          top: mobile ? undefined : "calc(env(safe-area-inset-top, 0px) + (var(--height-toolbar, 36px) - var(--control-md, 28px)) / 2)",
          // The resizer writes this CSS variable on every pointer move, while
          // React state is intentionally committed only when dragging ends.
          // Reading the variable here keeps the divider control in lockstep.
          // When the secondary region is collapsed, the role-switch control
          // is absent, so this is the only remaining desktop control.
          right: mobile ? undefined : rightPanelOpen
            ? "var(--right-panel-width)"
            : "0px",
          zIndex: mobile ? undefined : 260,
          marginLeft: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
          width: TOP_BAR_ICON_BUTTON_SIZE, height: TOP_BAR_ICON_BUTTON_SIZE, padding: 0, borderRadius: "var(--radius-md)",
          visibility: covered ? "hidden" : "visible",
          pointerEvents: covered ? "none" : "auto",
          // Keep the boundary control on the same light surface as the
          // header. The open state is conveyed by the accent color instead
          // of a heavy selected background.
          background: rightPanelOpen ? "var(--bg-panel)" : "none",
          border: "none", borderLeft: "1px solid var(--border)",
          color: rightPanelOpen ? "var(--accent)" : "var(--text-muted)",
          cursor: "pointer", flexShrink: 0, transition: "color 0.12s, background 0.12s",
        }}
        onMouseEnter={(event) => { if (!covered) event.currentTarget.style.color = "var(--text)"; }}
        onMouseLeave={(event) => { event.currentTarget.style.color = rightPanelOpen ? "var(--accent)" : "var(--text-muted)"; }}
      >
        {/* fork:pwa-tablet-tier — a bare rect + divider read as an empty box (a loading
            placeholder) at 16px in a 44px bar. The skin's lucide panel-right keeps the
            "page with a side panel" reading and stays inside the icon system. */}
        {/* fork:design-components —— 皮肤 lucide 图标：panel-right。 */}
        <span className="pw-ico">
          <i data-ico="panel-right" data-size="16"></i>
        </span>
      </button>
    );
  };

  const renderWorkspaceRoleToggle = () => (
    <button
      type="button"
      onClick={handleWorkspacePositionToggle}
      className="desktop-workspace-role-toggle"
      aria-pressed={workspaceSwapped}
      data-layout-switch="workspace-chat"
      title={translate("layout.switchChatWorkspace")}
      aria-label={translate("layout.switchChatWorkspace")}
      style={{
        position: "absolute",
        // fork:ui-topbar-align — third boundary control, same centring fix.
        top: "calc(env(safe-area-inset-top, 0px) + (var(--height-toolbar, 36px) - var(--control-md, 28px)) / 2)",
        right: 0,
        zIndex: 261,
        display: "flex", alignItems: "center", justifyContent: "center",
        width: TOP_BAR_ICON_BUTTON_SIZE, height: TOP_BAR_ICON_BUTTON_SIZE, padding: 0,
        background: workspaceSwapped ? "var(--bg-selected)" : "var(--bg-panel)",
        border: "none", borderLeft: "1px solid var(--border)",
        color: "var(--text)", cursor: "pointer", flexShrink: 0, transition: "color 0.12s, background 0.12s",
      }}
      onMouseEnter={(event) => { event.currentTarget.style.color = "var(--accent)"; }}
      onMouseLeave={(event) => { event.currentTarget.style.color = "var(--text)"; }}
    >
      {/* fork:design-components —— 皮肤 lucide 图标：columns-2（工作区对调）。 */}
      <span className="pw-ico">
        <i data-ico="columns-2" data-size="16"></i>
      </span>
    </button>
  );

  // The tree is rendered in two places: as the panel's own content when no tab is
  // open, and as a right-hand column beside the active viewer. Sharing one node
  // keeps the two spots from drifting apart.
  // fork:ui-panel-row — true when the tree itself occupies the panel, i.e. no
  // file/terminal/browser tab is active. Then the panel-level buttons move into
  // the tree's toolbar row.
  const showExplorerToolbarRow = Boolean(
    activeCwd
    && !activeFileTab?.filePath
    && !terminalTabs.some((tab) => tab.id === activeFileTabId)
    && !browserTabs.some((tab) => tab.id === activeFileTabId),
  );

  const browserTabButton = (
    /* fork:design-components —— 面板头行的动作钮一律是画板 30/01 的 `.pw-iconbtn.sm`
       （22px / 发丝 hover 叠色），原来挂的是自绘的 `file-viewer-icon-button`
       （26px / 自己的颜色与 hover），比同排其余钮大一圈、颜色也对不上。 */
    <button
      type="button"
      className="pw-iconbtn sm"
      title={translate("browser.newTab")}
      aria-label={translate("browser.newTab")}
      onClick={() => handleOpenBrowser()}
    >
      <span className="pw-ico"><i data-ico="globe" data-size="14"></i></span>
    </button>
  );

  const explorerPanel = activeCwd ? (
    <ExplorerPanel
      cwd={activeCwd}
      // fork:gap08-roots — 会话在 worktree 里时 cwd ≠ 项目根，文件树会多出一个「项目」根
      projectRoot={selectedSession?.projectRoot ?? null}
      onOpenFile={handleOpenFile}
      onOpenTerminal={handleOpenTerminal}
      explorerRefreshKey={explorerRefreshKey}
      onExplorerRefresh={handleExplorerRefresh}
      onAtMention={handleAtMention}
      onAtMentions={handleAtMentions}
      trailingActions={showExplorerToolbarRow ? browserTabButton : null}
    />
  ) : null;
  // Only wide panels can afford a tree column next to the document (PiDeck-style
  // "document in the middle, file tree on the right"). The width itself is
  // measured by a container query on .file-panel-body — the panel's rendered
  // width comes from the layout grid (1fr in the main region) and is not the
  // resizer's stored width.
  const showExplorerColumn = Boolean(
    explorerPanel
    && !isMobile
    && (activeFileTab?.filePath
      || terminalTabs.some((tab) => tab.id === activeFileTabId)
      || browserTabs.some((tab) => tab.id === activeFileTabId)),
  );

  return (
    <ContextMenuProvider>
    {/* fork:open-link-in-app — 全应用的外链都先走内置浏览器面板；
        带修饰键/中键点仍然交给系统浏览器（见 MarkdownBody 的 ExternalLink）。 */}
    <LinkOpenProvider onOpenLink={handleOpenBrowser}>
    <>
    <style>{`
      @media (max-width: 640px) {
        .sidebar-overlay-backdrop.sidebar-mobile-pending {
          opacity: 0 !important;
          pointer-events: none !important;
        }
        .sidebar-container.sidebar-mobile-pending.sidebar-open {
          transform: translateX(calc(-100% - env(safe-area-inset-left)));
          box-shadow: none;
        }
      }
    `}</style>
    {/* The tree is rendered in two places: as the panel's own content when no tab
        is open, and as a right-hand column beside the active viewer. One node
        keeps the two spots from drifting apart. */}
    {(() => {})()}
    <div ref={appShellRef} className="app-shell-layout pw-app" style={{
      position: "relative",
      display: "flex",
      width: "100%",
      height: "var(--app-viewport-height, 100dvh)",
      "--sidebar-width": `${sidebarResizer.width}px`,
      paddingLeft: "env(safe-area-inset-left)",
      paddingRight: "env(safe-area-inset-right)",
      overflow: "hidden",
      background: "var(--bg)",
    } as React.CSSProperties}>
      {/* Full-window wallpaper, behind the sidebar, chat and right panel.
          First child of the workspace row so every later sibling paints above
          it, and a sibling of the chat column for the scrim rules in
          app/wallpaper.css. */}
      <WallpaperLayer />
      {/* Mobile overlay backdrop */}
      <div
        className={`sidebar-overlay-backdrop pw-scrim-layer${mobileSidebarReady ? "" : " sidebar-mobile-pending"}`}
        onClick={() => setSidebarOpen(false)}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 199,
          background: "var(--scrim)",
          opacity: sidebarOpen ? 1 : 0,
          pointerEvents: sidebarOpen ? "auto" : "none",
          transition: "opacity 0.25s ease",
        }}
      />

      {/* Left sidebar */}
      <div
        ref={sidebarResizer.panelRef}
        id="session-sidebar"
        className={`sidebar-container pw-side${isMobile ? " pw-drawer" : ""}${sidebarOpen ? " sidebar-open" : " sidebar-closed"}${mobileSidebarReady ? "" : " sidebar-mobile-pending"}${sidebarResizer.isResizing ? " sidebar-resizing" : ""}`}
        style={{
          "--sidebar-width": `${sidebarResizer.width}px`,
          flexShrink: 0,
          paddingTop: "env(safe-area-inset-top)",
          paddingBottom: "env(safe-area-inset-bottom)",
          zIndex: 200,
        } as React.CSSProperties}
      >
        {sidebarContent}
      </div>
      {sidebarOpen && (
        <div
          {...sidebarResizer.separatorProps}
          aria-controls="session-sidebar"
          className={`panel-resize-handle sidebar-resize-handle${sidebarResizer.isResizing ? " is-resizing" : ""}`}
          data-resize-handle="sidebar"
          title={`${translate("layout.resizeSidebar")}: ${translate("layout.resizeHint")}`}
        />
      )}
      {/* fork:zn-21 — 桌面：折叠时才在这条线上出现图标条；展开时折叠按钮在导轨品牌行里。 */}
      {!isMobile && !sidebarOpen && renderCollapsedRail()}

       <div
         ref={rightPanelResizer.panelRef}
         className={`main-panels${workspaceSwapped ? " workspace-swapped" : ""}${rightPanelOpen ? " workspace-panel-open" : " workspace-panel-closed"}${rightPanelResizer.isResizing ? " main-panels-resizing" : ""}`}
         style={{
           "--right-panel-width": `${rightPanelResizer.width}px`,
           // The sidebar control is deliberately outside the workspace header.
           // Reserve its hit-target width inside whichever surface is currently
           // in the main region, so the control never covers its first action.
           // fork:zn-21 — 折叠态导轨现在是**占列**的（画板 02 的全高竖列），
           // 顶栏第一个动作不会再被它压住，两态都用画板自己的 --s2；
           // 原先折叠态那个 92px 的让位宽度随绝对定位浮块一起去掉了。
           // 手机保留原值：移动端的开合按钮是表头里的**流内**元素。
          "--main-workspace-header-leading-inset": isMobile
            ? TOP_BAR_ICON_BUTTON_SIZE
            : "var(--s2, 8px)",
          // The right-edge role control is independent of both content
          // surfaces, so keep it out of the last header action as well.
          "--main-workspace-header-trailing-inset": TOP_BAR_ICON_BUTTON_SIZE,
         } as React.CSSProperties}
       >
       {!isMobile && renderMainFileToggle(false)}
       {!isMobile && rightPanelOpen && renderWorkspaceRoleToggle()}
       {/* Chat slot */}
       <div
        id={workspaceSwapped ? "chat-secondary-workspace" : undefined}
        aria-hidden={workspaceSwapped && !rightPanelOpen ? true : undefined}
        inert={workspaceSwapped && !rightPanelOpen ? true : undefined}
        className={`chat-slot${workspaceSwapped ? ` secondary-workspace${rightPanelOpen ? " secondary-workspace-open" : " secondary-workspace-closed"}` : " main-workspace"}`}
        style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0 }}
       >
        {/* Top bar with sidebar toggle */}
        {/* fork:zn-03 — no bar over an empty chat (desktop only): display:none
            keeps refs mounted (no unmount/remount churn for the dropdown
            positioning effect) while removing the bar from layout and the
            accessibility tree. Mobile keeps the bar (drawer toggle). */}
        <div ref={topBarRef} style={{ flexShrink: 0, background: "var(--bg)", display: hideTopBar ? "none" : undefined }}>
        {/* fork:design-components —— 顶栏挂画板 .pw-topbar（36px / 发丝底线 / 间距节奏）。 */}
        <div className="main-workspace-header pw-topbar" style={{ position: "relative", height: "calc(var(--height-toolbar, 36px) + env(safe-area-inset-top))", paddingTop: "env(safe-area-inset-top)" }}>
          {/* fork:desktop-shell — the drag handle is a real element, not the header box:
              it is inset past the boundary toggles so the drag region never covers them.
              `no-drag` alone only helps elements the region rule can reach, and those two
              toggles are siblings of the header, which is why they stayed unclickable. */}
          <div className="desktop-drag-handle" aria-hidden="true" />
          {isMobile && <button
            onClick={handleSidebarToggle}
             title={sidebarOpen ? translate("sidebar.hide") : translate("sidebar.show")}
             aria-label={sidebarOpen ? translate("sidebar.hide") : translate("sidebar.show")}
            /* fork:design-components —— 手机上是画板 60 的 `.pw-touch`（36px 触控靶）；
               皮肤 lucide 图标：展开态 panel-left，收起态 menu。 */
            style={{
              margin: 0, padding: 0,
              color: "var(--text-muted)", cursor: "pointer", flexShrink: 0, transition: "color 0.12s",
            }}
            className="pw-touch"
            onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-muted)"; }}
          >
            <span className="pw-ico">
              <i data-ico={sidebarOpen ? "panel-left" : "menu"} data-size={sidebarOpen ? 16 : 17}></i>
            </span>
          </button>}
          {/* fork:ui-18 — the title doubles as the session switcher (MusePi
              GuiHeader.tsx:748): recent sessions open from here, so switching
              does not require going back to the sidebar. The `.pw-tb-title`
              frame (panel-left + text) lives inside `renderSessionTitle`. */}
          {!isMobile && renderSessionTitle()}
          {!isMobile && selectedSession && runningSessionIds.has(selectedSession.id) && (
            // 画板 01 帧 B：运行中在标题右侧给一枚状态芯片。
            <span className="pw-chipbtn">
              <span className="pw-ico" style={{ color: "var(--accent-text)" }}><i data-ico="loader-circle" data-size="14"></i></span>
              {translate("chat.running")}
            </span>
          )}
          {!isMobile && topBarBranch && (
            /* fix:branch-chip-clickable —— 画板 01 帧 A/B / 02 帧 B：分支芯片是**可点
               的下拉触发钮**（git-branch + 分支名 + chevron-down），点开是工作区
               （worktree）列表。原来这里是个没有 onClick 的 `<span class="pw-chipbtn">`
               —— 用户实测「这个 main 点不了」。改用 TopBarPopovers 的 BranchChip
               （它本来就是照画板写的，只是没接线）。选中另一个工作区 = 切目录并在
               那里开一个新 composer，与侧栏 worktree 切换同一动作。 */
            <BranchChip
              branch={topBarBranch}
              cwd={selectedSession?.cwd ?? newSessionCwd ?? ""}
              onSelectWorkspace={(path, projectRoot) => startSessionIn(path, projectRoot)}
            />
          )}
          {/* fix:mcp-topbar-icons —— MCP / 插件两枚状态图标（原来在聊天区右上角是一枚
              常驻胶囊）。悬停或点击出画板 22 的浮窗：MCP = server 图标 + 已启用台数
              徽标，插件 = blocks 图标。内容全在 TopBarPopovers 里，浮窗一律只读。 */}
          {!isMobile && showChat && (
            <>
              <McpStatusButton cwd={selectedSession?.cwd ?? newSessionCwd ?? null} statuses={extensionStatuses} />
              <PluginStatusButton cwd={selectedSession?.cwd ?? newSessionCwd ?? null} statuses={extensionStatuses} widgets={extensionWidgets} />
            </>
          )}
          {isMobile && (
            <div
              ref={mobileToolbarRef}
              data-mobile-toolbar="true"
              style={{
                position: "relative",
                display: "flex",
                alignItems: "stretch",
                flex: 1,
                minWidth: 0,
                height: "100%",
              }}
            >
              {isNarrowMobile && (
                <button
                  type="button"
                  onClick={handleMobileToolbarMoreToggle}
                  title={mobileToolbarMoreOpen ? translate("chat.close") : translate("chat.moreControls")}
                  aria-label={mobileToolbarMoreOpen ? translate("chat.close") : translate("chat.moreControls")}
                  aria-controls="mobile-toolbar-actions"
                  aria-expanded={mobileToolbarMoreOpen}
                  data-mobile-toolbar-more="true"
                  /* fork:design-components —— 画板 60 的「更多控件」钮 = .pw-iconbtn sm
                     （ellipsis / x）；它是工具条里的一枚紧凑方钮，触控靶由外层
                     `.pw-mobile-actions` 那一条覆盖层承担。 */
                  className="pw-iconbtn sm"
                  style={{ position: "relative", zIndex: mobileToolbarMoreOpen ? 21 : undefined }}
                >
                  {mobileToolbarMoreOpen ? (
                    <span className="pw-ico"><i data-ico="x" data-size="15"></i></span>
                  ) : (
                    <span className="pw-ico"><i data-ico="ellipsis" data-size="17"></i></span>
                  )}
                </button>
              )}
              {!isNarrowMobile && renderChatToolbarActions(true)}
              {/* fork:pwa-tablet-tier — the phone bar used to show three icons and no
                  session identity at all; which conversation you are in is the one thing
                  it has to answer. Same session-switcher popover as the desktop header,
                  ellipsised into whatever space the icons leave. */}
              <div style={{ display: "flex", alignItems: "center", flex: 1, minWidth: 0, padding: "0 2px" }}>
                {renderSessionTitle()}
              </div>
              {renderMainFileToggle(true)}
              {isNarrowMobile && mobileToolbarMoreOpen && (
                <div
                  id="mobile-toolbar-actions"
                  role="toolbar"
                  aria-label={translate("chat.moreControls")}
                  data-mobile-toolbar-actions="true"
                  style={{
                    position: "absolute",
                    top: 0,
                    right: 0,
                    bottom: 0,
                    left: TOP_BAR_ICON_BUTTON_SIZE,
                    zIndex: 20,
                    display: "flex",
                    alignItems: "stretch",
                    background: "color-mix(in srgb, var(--bg-panel) 94%, var(--bg))",
                    boxShadow: "var(--shadow-popover)",
                    backdropFilter: "blur(10px)",
                  }}
                >
                  {renderChatToolbarActions(true)}
                </div>
              )}
            </div>
          )}
          {!isMobile && (
            <div style={{ display: "flex", alignItems: "center", gap: "var(--s1)", paddingRight: "var(--s1)", marginLeft: "auto", minWidth: 0 }}>
              {renderProjectTrustWarning(false)}
              {renderChatToolbarActions(false)}
              {/* The workspace toggle is rendered once, as the boundary control on
                  .main-panels (line ~2209): a second copy here showed up as two
                  identical panel icons in the same row. */}
            </div>
          )}
          {isMobile && sessionHasBranches && (
            <BranchNavigator
              tree={branchTree}
              activeLeafId={branchActiveLeafId}
              onLeafChange={handleBranchLeafChange}
              inline
              compact
              open={activeTopPanel === "branches"}
              onToggle={() => toggleTopPanel("branches")}
              hasSession={showChat}
              hideInlineButton
            />
          )}
          {/* Top panel dropdown — shared, only one active at a time */}
          {activeTopPanel && topPanelPos && (
            <div className="anim-popover-down" style={{
              position: "fixed",
              top: topPanelPos.top,
              left: topPanelPos.left,
              width: topPanelPos.width,
              maxHeight: `calc(100dvh - ${topPanelPos.top}px)`,
              overflowY: "auto",
              zIndex: 500,
            }}>
              {activeTopPanel === "agents" && activeSessionFamily && selectedSession && (
                <AgentSessionPanel
                  rootSession={activeSessionFamily.root}
                  subagents={activeSessionFamily.subagents}
                  selectedSessionId={selectedSession.id}
                  runningSessionIds={runningSessionIds}
                  onSelectSession={handleSelectSession}
                />
              )}
              {activeTopPanel === "system" && (
                <SystemPromptPanel
                  loading={systemInfoLoading}
                  prompt={systemPrompt}
                  translate={translate}
                />
              )}
              {activeTopPanel === "tools" && (
                <ToolDefinitionsPanel
                  loading={systemInfoLoading}
                  tools={systemTools}
                  translate={translate}
                />
              )}
              {activeTopPanel === "sessions" && (
                // fork:ui-18 — recent sessions, newest first.
                // fix:top-panel-board22 —— 这一块原来是**整段自绘**（`--bg-elev` /
                // `--radius-lg` / `--shadow-lg` 那套旧 token，行是 30px 的内联盒子），
                // 与画板 22 的「最近会话」不是一个东西。改成画板原件：
                //   `.pw-pop` 外壳 + `.pw-pop-title` 标题 + 每行 `.pw-prow`
                //   （message-square 图标 + 标题 + 相对时间 `.pw-desc`；当前项 `is-on`）
                //   + `.pw-sep` + `.pw-prow` 新建任务行（带 `.pw-kbd`）。
                <div className="pw-pop" style={{ margin: "var(--s1)" }}>
                  <div className="pw-pop-title">{translate("sidebar.recentSessions")}</div>
                  {[...sessionCatalog]
                    .sort((a, b) => b.modified.localeCompare(a.modified))
                    .slice(0, 10)
                    .map((session) => {
                      const label = session.name?.trim()
                        || session.firstMessage?.trim().replace(/\s+/g, " ").slice(0, 60)
                        || translate("i18n.newSession");
                      const isCurrent = session.id === selectedSession?.id;
                      return (
                        <button
                          key={session.id}
                          type="button"
                          title={session.cwd}
                          className={`pw-prow${isCurrent ? " is-on" : ""}`}
                          style={{ width: "100%" }}
                          onClick={() => {
                            toggleTopPanel("sessions", false);
                            handleSelectSession(session, true);
                          }}
                        >
                          <span className="pw-ico"><i data-ico="message-square" data-size="14"></i></span>
                          <span className="grow" style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
                          <span className="pw-desc">
                            {isCurrent
                              ? translate("sidebar.currentSession")
                              : formatRelativeTime(session.modified, locale)}
                          </span>
                        </button>
                      );
                    })}
                  <div className="pw-sep" />
                  <button
                    type="button"
                    className="pw-prow"
                    style={{ width: "100%" }}
                    onClick={() => {
                      const cwd = selectedSession?.cwd ?? activeCwd;
                      toggleTopPanel("sessions", false);
                      if (!cwd) return;
                      const tempId = typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now().toString(36)}`;
                      handleNewSession(tempId, cwd);
                    }}
                  >
                    <span className="pw-ico"><i data-ico="square-pen" data-size="14"></i></span>
                    <span className="grow">{translate("sidebar.newTask")}</span>
                    <span className="pw-kbd">⌘N</span>
                  </button>
                </div>
              )}
            </div>
          )}

        </div>
        {isMobile && renderProjectTrustWarning(true)}
        {/* fork:design-system SW-16 —— 画板 60 帧 B 的分平台安装提示（Android
            beforeinstallprompt / iOS 教学；standalone 或已关闭时自隐藏）。 */}
        {isMobile && <InstallPromptBanner />}
        </div>

        {/* Chat content */}
        <div style={{ flex: 1, overflow: "hidden", position: "relative" }}>
          {showChat ? (
            <ChatWindow
              key={sessionKey}
              session={selectedSession}
              searchTarget={searchTarget?.sessionId === selectedSession?.id ? searchTarget : null}
              onSearchTargetHandled={handleSearchTargetHandled}
              initialScrollPosition={selectedSession ? sessionScrollPositionsRef.current.get(selectedSession.id) ?? null : null}
              onScrollPositionChange={handleSessionScrollPositionChange}
              sessionRunning={Boolean(selectedSession && runningSessionIds.has(selectedSession.id))}
              newSessionCwd={effectiveNewSessionCwd}
              newSessionDraftKey={newSessionDraftKey}
              onAgentEnd={handleAgentEnd}
              onAgentError={handleAgentError}
              onAttentionNeeded={handleAttentionNeeded}
              onSessionCreated={handleSessionCreated}
              // fork:zn-03 — empty-chat signal (setChatEmpty is stable, so the
              // ChatWindow effect only refires when emptiness flips).
              onEmptyChange={setChatEmpty}
              onSessionForked={handleSessionForked}
              onOpenSessionPane={openBranchTab}
              modelsRefreshKey={modelsRefreshKey}
              chatInputRef={chatInputRef}
              onBranchDataChange={handleBranchDataChange}
              onSystemPromptChange={handleSystemPromptChange}
              onSystemToolsChange={handleSystemToolsChange}
              onSystemInfoLoaderChange={handleSystemInfoLoaderChange}
              onSessionStatsChange={handleSessionStatsChange}
              onExtensionStatusChange={handleExtensionStatusChange}
              onSessionStatsPanelOpen={openSessionStatsPanel}
              onOpenFile={handleOpenLinkedFile}
              onOpenSession={handleOpenSession}
              onAskInNewChat={handleAskInNewChat}
              quoteSelectionEnabled={quoteSelectionEnabled}
              initialPrompt={pendingQuotePrompt?.sessionId === selectedSession?.id
                ? pendingQuotePrompt?.text
                : pendingNewSessionPrompt?.draftId === newSessionDraftId && pendingNewSessionPrompt.cwd === effectiveNewSessionCwd
                  ? pendingNewSessionPrompt.text
                  : undefined}
              onInitialPromptConsumed={() => { setPendingQuotePrompt(null); setPendingNewSessionPrompt(null); }}
              newSessionTargets={newSessionTargets}
              soundEnabled={soundEnabled}
              onSoundToggle={onSoundToggle}
              playDoneSound={playDoneSound}
              unlockAudio={unlockAudio}
            />
          ) : initialCwdStatus === "validating" ? (
            <div
              role="status"
              style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "var(--s2)", padding: "var(--s5)", color: "var(--text-muted)", textAlign: "center" }}
            >
               <div style={{ fontSize: TEXT.lg, color: "var(--text)" }}>{translate("workspace.opening")}</div>
              <div style={{ maxWidth: "min(720px, 100%)", overflowWrap: "anywhere", fontFamily: "var(--font-mono)", fontSize: TEXT.sm }}>
                {initialNavigation.requestedCwd}
              </div>
            </div>
          ) : initialCwdStatus === "error" ? (
            <div
              role="alert"
              style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "var(--s2)", padding: "var(--s5)", color: "var(--text-muted)", textAlign: "center" }}
            >
               <div style={{ fontSize: TEXT.lg, color: "var(--danger)" }}>{translate("workspace.unable")}</div>
              <div style={{ maxWidth: "min(720px, 100%)", overflowWrap: "anywhere", fontFamily: "var(--font-mono)", fontSize: TEXT.sm }}>
                {initialNavigation.requestedCwd}
              </div>
              <div style={{ maxWidth: 720, fontSize: TEXT.sm }}>{initialCwdError}</div>
            </div>
          ) : showPlaceholder ? (
            activeCwd ? (
              <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: TEXT.xl }}>
                 {translate("workspace.selectSession")}
              </div>
            ) : (
              /* fork:design-components —— 画板 01 的空态：`.pw-empty` 撑满并居中，
                 `.pw-empty-inner` 收拢 logo 标记 + 标题 + 两步说明；原来是绝对定位
                 贴在左上角的一枚 44px 手绘箭头 + 一段自绘字号。 */
              <div className="pw-empty" style={{ height: "100%" }}>
                <div className="pw-empty-inner">
                  <span className="mark"><i data-ico="pi" data-size="20" aria-hidden="true"></i></span>
                  <h2>{translate("workspace.getStarted")}</h2>
                  <p>
                    <span className="pw-dim">1.</span> {translate("workspace.selectProject")}<br />
                    <span className="pw-dim">2.</span> {translate("workspace.addModels")}
                  </p>
                </div>
              </div>
            )
          ) : null}
        </div>
      </div>

      <div
        aria-hidden="true"
        className={`right-panel-overlay-backdrop${rightPanelOpen ? " is-open" : ""}`}
        onClick={() => setRightPanelOpen(false)}
      />
      {rightPanelOpen && (
        <div
          {...rightPanelResizer.separatorProps}
          aria-controls={secondaryWorkspaceId}
          className={`panel-resize-handle right-panel-resize-handle${rightPanelResizer.isResizing ? " is-resizing" : ""}`}
          data-resize-handle="right-panel"
          title={`${translate("layout.resizeSecondaryWorkspace")}: ${translate("layout.resizeHint")}`}
        />
      )}

      {/* Right panel: file viewer — always mounted, width animated via CSS */}
      <div
        id="file-panel"
        aria-hidden={!workspaceSwapped && !rightPanelOpen ? true : undefined}
        inert={!workspaceSwapped && !rightPanelOpen ? true : undefined}
        className={`right-panel-container workspace-slot pw-panel${workspaceSwapped ? " main-workspace" : ` secondary-workspace${rightPanelOpen ? " secondary-workspace-open" : " secondary-workspace-closed"}`}${rightPanelOpen ? " right-panel-open" : " right-panel-closed"}${rightPanelResizer.isResizing ? " right-panel-resizing" : ""}`}
        style={{
          display: "flex",
          flexDirection: "column",
        } as React.CSSProperties}
      >
        {/* Right panel tab bar */}
        <div className="main-workspace-header pw-panel-head" style={{
          height: "calc(var(--topbar-height, 36px) + env(safe-area-inset-top))",
          paddingTop: "env(safe-area-inset-top)",
          position: "relative",
        }}>
          {/* fork:desktop-shell — the drag handle is a real element, not the header box:
              it is inset past the boundary toggles so the drag region never covers them.
              `no-drag` alone only helps elements the region rule can reach, and those two
              toggles are siblings of the header, which is why they stayed unclickable. */}
          <div className="desktop-drag-handle" aria-hidden="true" />
          <div style={{ flex: 1, overflow: "hidden" }}>
            <TabBar
              tabs={panelTabs}
              activeTabId={activeFileTabId ?? ""}
              onSelectTab={setActiveFileTabId}
              onCloseTab={handleCloseTabWithHistory}
              overview={{
                recentClosed: recentClosedTabs,
                onCloseAll: handleCloseAllTabs,
                onCloseOthers: handleCloseOtherTabs,
                onRestore: handleRestoreClosedTab,
                onClearRecent: () => setRecentClosedTabs([]),
              }}
            />
          </div>
          {/* fork:ui-panel-row — while the file tree is the panel content this
              button lives in the tree's own toolbar row, so the panel shows one
              row of icons instead of two stacked ones. */}
          {!showExplorerToolbarRow && browserTabButton}
          {activeCwd && !gitGraphOpen && (
            <button
              type="button"
              onClick={openGitGraphTab}
              title={translate("git.graph")}
              aria-label={translate("git.graph")}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                width: "var(--control-xs)", height: "var(--control-xs)", padding: 0,
                borderRadius: "var(--radius-md)", background: "none", border: "none",
                color: "var(--text-muted)", cursor: "pointer", flexShrink: 0, transition: "color 0.12s",
              }}
              onMouseEnter={(event) => { event.currentTarget.style.color = "var(--accent)"; }}
              onMouseLeave={(event) => { event.currentTarget.style.color = "var(--text-muted)"; }}
            >
              <span className="pw-ico"><i data-ico="git-branch" data-size="15"></i></span>
            </button>
          )}
          {isMobile && (
            <button
              type="button"
              onClick={() => setRightPanelOpen(false)}
              aria-controls="file-panel"
              aria-expanded={rightPanelOpen}
              title={translate("files.hidePanel")}
              aria-label={translate("files.hidePanel")}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                width: "var(--control-xs)", height: "var(--control-xs)", padding: 0, borderRadius: "var(--radius-md)",
                background: "var(--bg-selected)", border: "none", borderLeft: "1px solid var(--border)",
                color: "var(--text)", cursor: "pointer", flexShrink: 0, transition: "color 0.12s",
              }}
              onMouseEnter={(event) => { event.currentTarget.style.color = "var(--accent)"; }}
              onMouseLeave={(event) => { event.currentTarget.style.color = "var(--text)"; }}
            >
              <span className="pw-ico"><i data-ico="panel-right" data-size="16"></i></span>
            </button>
          )}
        </div>

        {/* Body: the active viewer plus an optional tree column. Both live in the
            same container so the tree no longer replaces the document. */}
        <div className="file-panel-body pw-panel-body">
        <div className="file-panel-main">
          {activeFileTabId === GIT_GRAPH_TAB_ID && gitGraphOpen ? (
            // fork:git-graph-tab — 点提交里的文件直接开 diff 视图（FileViewer 已支持 modeHint）。
            <GitGraphTab
              cwd={activeCwd ?? ""}
              onOpenFile={(filePath, fileName) => handleOpenFile(filePath, fileName, { modeHint: "diff" })}
            />
          ) : null}
          {fileTabs.filter((tab) => mountedFileTabs.has(tab.id)).map((tab) => {
            const isActive = tab.id === activeFileTabId;
            return (
              // fork:file-tab-keep-alive — 文件 tab 不再「切走即卸载」：首次激活后常驻，
              // 切走只 hidden，滚动位置/搜索/未保存的 markdown 编辑态都保留；
              // 关闭后由下面的剪枝 effect 从 mountedFileTabs 剔除。
              <div key={`${tab.id}:${tab.viewerRevision ?? 0}`} hidden={!isActive} style={{ width: "100%", height: "100%" }}>
                <FileViewer
                  filePath={tab.filePath}
                  cwd={activeCwd ?? undefined}
                  sourceSessionId={tab.sourceSessionId}
                  locationTarget={isActive && pendingFileLocation && sameFilePath(pendingFileLocation.filePath, tab.filePath)
                    ? pendingFileLocation
                    : null}
                  onLocationHandled={handleFileLocationHandled}
                  onLocationFailed={handleFileLocationFailed}
                  gitRefreshKey={explorerRefreshKey}
                  initialDisplayMode={tab.initialDisplayMode}
                  initialPage={tab.page}
                  initialState={tab.viewerState}
                  watchEnabled={editorVisible && isActive}
                  onStateChange={(viewerState) => handleFileViewerStateChange(
                    tab.id,
                    tab.viewerRevision ?? 0,
                    viewerState,
                  )}
                  onMentionLines={editorVisible && isActive ? handleFileLineMention : undefined}
                  onAskInNewChat={editorVisible && isActive ? handleFileSelectionInNewChat : undefined}
                  onAtMention={handleAtMention}
                  onOpenFile={(filePath, page) => handleOpenFile(
                    filePath,
                    getFileName(filePath),
                    { sourceSessionId: tab.sourceSessionId, page },
                  )}
                />
              </div>
            );
          })}
          {fileTabs.length === 0
            && !terminalTabs.some((tab) => tab.id === activeFileTabId)
            && !browserTabs.some((tab) => tab.id === activeFileTabId)
            && !branchTabs.some((tab) => tab.id === activeFileTabId)
            && activeFileTabId !== GIT_GRAPH_TAB_ID
            // fork:zc-05 — 变更 tab 也占满 file-panel-main，不能再叠一层文件树。
            ? (
            activeCwd ? (
              explorerPanel
            ) : (
              <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-dim)", fontSize: TEXT.sm }}>
                 {translate("files.noneOpen")}
              </div>
            )
          ) : null}
          {branchTabs.map((tab) => (
            <div key={tab.id} hidden={tab.id !== activeFileTabId} style={{ width: "100%", height: "100%" }}>
              <ExplorationPane
                sessionId={tab.sessionId}
                parentSessionId={tab.parentSessionId}
                onOpenAsMain={handleOpenSession}
              />
            </div>
          ))}
          {browserTabs.map((tab) => (
            <div key={tab.id} hidden={tab.id !== activeFileTabId} style={{ width: "100%", height: "100%" }}>
              <BrowserPanel tab={tab} onChangeUrl={handleBrowserUrlChange} />
            </div>
          ))}
          {terminalTabs.map((tab) => (
            <div key={tab.id} hidden={tab.id !== activeFileTabId} style={{ width: "100%", height: "100%" }}>
              <TerminalPanel
                tab={tab}
                active={editorVisible && tab.id === activeFileTabId}
                onRestart={() => setTerminalTabs((tabs) => tabs.map((item) => item.id === tab.id ? { ...item, closing: "restart" } : item))}
                onClosed={() => handleTerminalClosed(tab)}
                onCloseError={() => setTerminalTabs((tabs) => tabs.map((item) => item.id === tab.id ? { ...item, closing: undefined } : item))}
              />
            </div>
          ))}
        </div>
        {showExplorerColumn ? (
          /* fork:board-diff-2026-10-01 —— 这一列就是画板 30 的 `.pw-tree`
             （board.css:578：padding var(--s1)/font-size var(--text-secondary)=12px/
             发丝右边线）。此前产品只挂了 `.explorer-column`（自己的类），
             画板那整条规则全部落空 —— 树行字号退回 13px（与会话行同大，
             「比会话行密一倍」的设计意图没了）、没有发丝右边线，
             `30-files-panel` 的 spec 把它报成了漂移（fs 12≠13 / lh 18≠19.5）。
             `explorer-column` 保留（宽度档位在 fork-ui.css:449）。 */
          <div className="explorer-column pw-tree">{explorerPanel}</div>
        ) : null}
        </div>
      </div>
      </div>
    </div>
    <SessionRowContextMenuBridge onCopyReference={copySessionReference} />
    {settingsSection && (
      <SettingsPanel
        onOpenSession={handleOpenSession}
        onOpenFile={(filePath) => handleOpenFile(filePath, getFileName(filePath))}
        sessionId={selectedSession?.id ?? null}
        initialSection={settingsSection}
        sidebarWidth={sidebarResizer.width}
        onSidebarWidthChange={sidebarResizer.setWidth}
        soundEnabled={soundEnabled}
        onSoundToggle={onSoundToggle}
        quoteSelectionEnabled={quoteSelectionEnabled}
        onQuoteSelectionChange={handleQuoteSelectionChange}
        onClose={() => {
          setSettingsSection(null);
          setModelsRefreshKey((key) => key + 1);
        }}
        onSessionReloaded={() => setSessionKey((key) => key + 1)}
        cwd={projectTrustCwd}
      />
    )}
    {projectTrustDialogOpen && projectTrustCwd && (
      <ProjectTrustDialog
        cwd={projectTrustCwd}
        busy={projectTrustBusy}
        error={projectTrustError}
        onCancel={() => {
          if (!projectTrustBusy) setProjectTrustDialogOpen(false);
        }}
        onConfirm={() => void handleTrustProject()}
      />
    )}
    {/* fork:ui-projectchip — "open folder" for the new-session workspace selector. */}
    {homeFolderPickerOpen && (
      <DirectoryPicker
        initialPath={newSessionCwd ?? activeCwd ?? undefined}
        onCancel={() => setHomeFolderPickerOpen(false)}
        onSelect={(path) => {
          void startSessionAtPath(path).then((failure) => {
            setHomeTargetError(failure);
            setHomeFolderPickerOpen(failure !== null);
          });
        }}
      />
    )}
    </>
    </LinkOpenProvider>
    </ContextMenuProvider>
  );
}
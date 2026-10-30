"use client";

import { useState, useCallback, useRef, useEffect, useLayoutEffect, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useGlobalKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { SessionSidebar, type SelectSessionOptions, type SessionSidebarControl } from "./SessionSidebar";
import { SidebarFoot } from "./shell/SidebarFoot";
import { Icon } from "./v3/Icon";
import { buildExtensionStatusCells } from "./ExtensionStatusBar";
import { ExtensionWidgets } from "./ExtensionWidgets";
import { Spin } from "./v3/Spin";
import { ChatWindow } from "./ChatWindow";
import { NewSessionContextBar, type NewSessionContextControl } from "./NewSessionContextBar";
import type { ChatScrollPosition } from "@/lib/chat-scroll-position";
import { FileViewer } from "./FileViewer";
import { FileExplorer, type FileExplorerHandle } from "./FileExplorer";
import { TabBar, type Tab } from "./TabBar";
import { openFileTab, saveFileViewerState, saveParkedFileViewerState, switchFileWorkspace, type ParkedFileWorkspace } from "./file-tab-state";
import { SettingsPanel } from "./SettingsPanel";
import { ChangesPanel } from "./ChangesPanel";
import { ProjectTrustDialog, type ProjectTrustFailure } from "./ProjectTrustDialog";
import { BranchNavigator, hasSessionBranches } from "./BranchNavigator";
import { SystemPromptPanel } from "./SystemPromptPanel";
import { ToolDefinitionsPanel } from "./ToolDefinitionsPanel";
import { AgentSessionPanel } from "./AgentSessionPanel";
import { DebugPanel, DebugPanelBoundary } from "./DebugPanel";
import { SubagentViewer } from "./SubagentViewer";
import { TerminalPanel } from "./TerminalPanel";
import { newTerminalTab, restoreTerminalTabs, TERMINAL_TABS_KEY, type TerminalTab } from "./terminal-tab-state";
import { useTheme } from "@/hooks/useTheme";
import { useFontPreferences } from "@/hooks/useFontPreferences";
import { useI18n } from "@/hooks/useI18n";
import { useIsMobile, useIsNarrowMobile } from "@/hooks/useIsMobile";
import { useViewportHeight } from "@/hooks/useViewportHeight";
import { useResizablePanel } from "@/hooks/useResizablePanel";
import { useAudio } from "@/hooks/useAudio";
import { copyText } from "@/lib/clipboard";
import { sendAgentCommand } from "@/lib/agent-client";
import { getFileName } from "@/lib/file-paths";
import { focusDesktopWindow } from "@/lib/desktop-shell";
import type { GitStatusResponse } from "@/lib/git-types";
import type { ExtensionStatusItem, ExtensionWidgetItem } from "@/lib/types";
import { buildAtMentionText, buildFileAtMentionsText, buildFileLineMentionText } from "@/lib/file-fuzzy";
import {
  claimExtensionAttentionNotification,
  shouldShowBrowserNotification,
  showBrowserNotification,
} from "@/lib/browser-notifications";
import { setupPushSubscription } from "@/lib/push-client";
import { completionNotificationsEnabled, ensureNotificationPermission } from "@/lib/notification-preference";
import { startPageVisibilityTracking } from "@/lib/page-debug";
import type { DebugClientSession } from "@/lib/debug-types";
import { getInitialNavigation, linkedSessionId, withTabOpen } from "@/lib/initial-navigation";
import { clearTabOpenSession, getTabOpen, setTabOpenNewSession, setTabOpenSession } from "@/lib/tab-session";
import { mergeCatalogRow } from "./session-catalog-helpers";
import { getDraft, parkedNewSessionDraftKey, rekeyDraft } from "@/lib/draft-store";
import {
  contextForCwd,
  type NewSessionContext,
  type NewSessionMove,
  type NewSessionOptions,
  type NewSessionTarget,
  type ProjectChoice,
} from "@/lib/new-session-context";
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
import type { BlockingExtensionUiRequest, SessionInfo, SessionTreeNode } from "@/lib/types";
import type { McpErrorResponse, ProjectTrustStatus } from "@/lib/api-types";
import type { ChatInputHandle } from "./ChatInput";
import type { AgentEndInfo, NewSessionChoices } from "@/hooks/useAgentSession";
import type { SessionStatsInfo } from "@/lib/pi-types";
import { formatActiveDuration, formatCompactCount, formatCostShort } from "@/lib/session-stats-format";
import type { FileViewerState } from "@/lib/file-viewer-state";
import { PRESET_READ_ONLY, type ToolEntry } from "@/lib/tool-presets";
import { getAgentsBadge, getFoldedMoreAgentsBadge, getSessionFamily } from "@/lib/session-family";
import { getLastSettingsSection, type SettingsSection } from "@/lib/settings-navigation";
import { focusIfLost } from "@/lib/stacked-dialog";

type SessionCopyField = "file" | "id" | "projectDir" | "gitBranch" | "gitWorktree";
type AutoNameStatus =
  | { kind: "idle" }
  | { kind: "naming" }
  | { kind: "success" }
  | { kind: "error"; message: string };

const TOP_BAR_ICON_BUTTON_SIZE = 36;
const AGENT_PANEL_WIDTH = 420;
// pi's built-in tools that never change a file; any other tool may (#1144).
const READ_ONLY_TOOL_NAMES = new Set(PRESET_READ_ONLY);
const TOOL_END_REFRESH_MS = 1000;

/** Panel tab id of the last sub-agent tab, or null when there is none. */
function lastAgentTabId(tabs: readonly { sessionId: string }[]): string | null {
  const last = tabs.at(-1);
  return last ? `agent:${last.sessionId}` : null;
}

export function AppShell() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [initialNavigation, setInitialNavigation] = useState(() => getInitialNavigation(searchParams));
  // Keep the system-theme subscription mounted for the lifetime of the app.
  useTheme();
  // Restore fonts even when Settings and the chat composer have not been opened.
  useFontPreferences();
  const { locale, t: translate } = useI18n();
  const isMobile = useIsMobile();
  const isNarrowMobile = useIsNarrowMobile();
  useViewportHeight();

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
  const { soundEnabled, onSoundToggle, playDoneSound, unlockAudio, holdAudio, soundEnabledRef } = useAudio();
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
  // Latest selection readable from async callbacks whose captured state is
  // stale (e.g. a delete that completes after the user navigated away).
  const selectedSessionRef = useRef(selectedSession);
  selectedSessionRef.current = selectedSession;
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
  const handleRunningSessionIdsChange = useCallback((ids: Set<string>) => {
    setRunningSessionIds((previous) => {
      if (previous.size === ids.size && [...ids].every((id) => previous.has(id))) return previous;
      return ids;
    });
  }, []);
  const agentsBadge = activeSessionFamily ? getAgentsBadge(activeSessionFamily.subagents, runningSessionIds) : null;
  const agentsButtonLabel = agentsBadge?.running
    ? translate("agentSwitcher.titleRunning", { count: agentsBadge.count })
    : translate("agentSwitcher.title");
  // The temporary id distinguishes consecutive fresh composers in one cwd.
  const [newSessionCwd, setNewSessionCwd] = useState<string | null>(null);
  const [newSessionDraftId, setNewSessionDraftId] = useState("initial");
  const activeNewSessionDraftKeyRef = useRef<string | null>(null);
  // The bar above a fresh composer (NewSessionContextBar): the sidebar reports
  // what it shows and carries out its moves, which remount the composer. Its
  // model and reasoning picks, as it last reported them, go along with the
  // draft to the composer that replaces it, which takes them once.
  const sidebarControlRef = useRef<SessionSidebarControl | null>(null);
  const [sidebarNewSessionContext, setSidebarNewSessionContext] = useState<NewSessionContext | null>(null);
  // The bar's last move until the sidebar reports that cwd (a commit later),
  // so the bar of the new composer shows the target's project, and a worktree
  // it just created, from its first frame.
  const newSessionMoveRef = useRef<NewSessionMove | null>(null);
  const handleSidebarNewSessionContext = useCallback((context: NewSessionContext | null) => {
    if (context && context.cwd === newSessionMoveRef.current?.cwd) newSessionMoveRef.current = null;
    setSidebarNewSessionContext(context);
  }, []);
  const newSessionBarFocusRef = useRef<NewSessionContextControl | null>(null);
  const newSessionChoicesRef = useRef<NewSessionChoices | null>(null);
  const [carriedNewSessionChoices, setCarriedNewSessionChoices] = useState<NewSessionChoices | null>(null);
  const handleNewSessionChoicesChange = useCallback((choices: NewSessionChoices) => {
    newSessionChoicesRef.current = choices;
    setCarriedNewSessionChoices(null);
  }, []);
  const [initialCwdStatus, setInitialCwdStatus] = useState<"idle" | "validating" | "ready" | "error">(
    () => initialNavigation.requestedCwd ? "validating" : "idle",
  );
  const [initialCwdError, setInitialCwdError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
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
  // 18-diff / web-changes：`± 所有变更` 卡片（顶栏那颗「变更」钮、手机「更多」菜单同用）。
  // The file tree in the right panel: its own search field and ignored-file switch.
  const [treeSearchOpen, setTreeSearchOpen] = useState(false);
  const [treeShowIgnored, setTreeShowIgnored] = useState(false);
  const fileTreeRef = useRef<FileExplorerHandle>(null);
  // 顶栏 open-in 那颗钮能不能点：只有 Pi Web 跑在本机、且当前平台有文件管理器时才有意义。
  const [fileManager, setFileManager] = useState<{ supported: boolean; reason: string | null } | null>(null);
  const [settingsSection, setSettingsSection] = useState<SettingsSection | null>(null);
  const [modelsRefreshKey, setModelsRefreshKey] = useState(0);
  const [projectTrust, setProjectTrust] = useState<ProjectTrustStatus | null>(null);
  const [projectTrustDialogOpen, setProjectTrustDialogOpen] = useState(false);
  const [projectTrustBusy, setProjectTrustBusy] = useState(false);
  const [projectTrustError, setProjectTrustError] = useState<ProjectTrustFailure | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(() => !initialNavigation.sidebarCollapsed);
  const desktopSidebarOpenRef = useRef(!initialNavigation.sidebarCollapsed);
  const [rightPanelOpen, setRightPanelOpen] = useState(false);
  // 打开文件时把文件树让出来（主人要求）：只留查看器；顶上那颗钮再把它叫回来。
  const [fileTreeOpen, setFileTreeOpen] = useState(true);
  const [rightPanelExpanded, setRightPanelExpanded] = useState(false);
  const rightPanelFullWidth = rightPanelOpen && rightPanelExpanded && !isMobile;
  useEffect(() => {
    if (!rightPanelOpen || isMobile) setRightPanelExpanded(false);
  }, [rightPanelOpen, isMobile]);
  const [mobileToolbarMoreOpen, setMobileToolbarMoreOpen] = useState(false);
  // 桌面会话头的「⋯」：历史 / 生成标题 / 系统提示词 / 工具定义 收进一张下拉卡，
  // 顶栏只留多 agent 那一颗（截图里一排五颗图标认不出谁是谁）。
  const [chromeMoreOpen, setChromeMoreOpen] = useState(false);
  const chromeMoreRef = useRef<HTMLDivElement>(null);
  // 右栏的「+」：像参考桌面端那样，一个加号里挑要开的页——文件树 / 终端 / 变更 / 系统文件夹。
  const [panelAddOpen, setPanelAddOpen] = useState(false);
  const panelAddRef = useRef<HTMLDivElement>(null);
  // A narrow phone folds the Agents button into More: the folded button says that subagents run.
  const foldedMoreAgentsBadge = isNarrowMobile ? getFoldedMoreAgentsBadge(agentsBadge, mobileToolbarMoreOpen) : null;
  const moreControlsLabel = mobileToolbarMoreOpen
    ? translate("chat.close")
    : foldedMoreAgentsBadge
      ? translate("chat.moreControlsAgentsRunning", { count: foldedMoreAgentsBadge.count })
      : translate("chat.moreControls");
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
    defaultWidth: SIDEBAR_DEFAULT_WIDTH,
    getMaxWidth: getResponsiveSidebarMaxWidth,
    growthDirection: "right",
    maxWidth: SIDEBAR_MAX_WIDTH,
    minWidth: SIDEBAR_MIN_WIDTH,
    storageKey: "pi-sidebar-width",
    widthRef: sidebarWidthRef,
  });
  const rightPanelResizer = useResizablePanel({
    ariaLabel: translate("layout.resizeFilePanel"),
    cssVariable: "--right-panel-width",
    defaultWidth: RIGHT_PANEL_FALLBACK_WIDTH,
    getDefaultWidth: getResponsiveRightPanelWidth,
    getMaxWidth: getResponsiveRightPanelMaxWidth,
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
  // Mobile drawer actions must not change the remembered desktop preference.
  useEffect(() => {
    setSidebarOpen(isMobile ? false : desktopSidebarOpenRef.current);
  }, [isMobile]);
  useEffect(() => {
    setMobileSidebarReady(true);
  }, []);
  useEffect(() => {
    if (!rightPanelOpen) return;
    reclampSidebarWidth();
    reclampRightPanelWidth();
  }, [reclampRightPanelWidth, reclampSidebarWidth, rightPanelOpen]);
  const chatInputRef = useRef<ChatInputHandle | null>(null);
  const [pendingQuotePrompt, setPendingQuotePrompt] = useState<{ sessionId: string; text: string } | null>(null);
  const topBarRef = useRef<HTMLDivElement>(null);
  const mobileToolbarRef = useRef<HTMLDivElement>(null);
  // Branch navigator state — populated by ChatWindow via onBranchDataChange
  const [branchTree, setBranchTree] = useState<SessionTreeNode[]>([]);
  const [branchActiveLeafId, setBranchActiveLeafId] = useState<string | null>(null);
  const [branchSwitchLocked, setBranchSwitchLocked] = useState(false);
  const branchLeafChangeFnRef = useRef<((leafId: string | null) => void) | null>(null);
  const sessionHasBranches = hasSessionBranches(branchTree);

  const handleBranchDataChange = useCallback((tree: SessionTreeNode[], activeLeafId: string | null, onLeafChange: (leafId: string | null) => void, locked: boolean) => {
    setBranchTree(tree);
    setBranchActiveLeafId(activeLeafId);
    setBranchSwitchLocked(locked);
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

  // The debug panel's reader of the chat's own state: kept in a ref, so registering renders
  // nothing, and read only by the open panel (DebugPanel), never on AppShell's renders.
  const debugSnapshotReaderRef = useRef<(() => DebugClientSession) | null>(null);
  const handleDebugSnapshotReaderChange = useCallback((reader: (() => DebugClientSession) | null) => {
    debugSnapshotReaderRef.current = reader;
  }, []);
  // The panel reports the page's visibility history from the first mount on, opened or not.
  useEffect(() => {
    startPageVisibilityTracking();
  }, []);

  // Session stats (tokens + cost) — populated by ChatWindow, displayed in top bar
  const [sessionStats, setSessionStats] = useState<SessionStatsInfo | null>(null);
  const [autoNameStatus, setAutoNameStatus] = useState<AutoNameStatus>({ kind: "idle" });
  const autoNameTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeSessionIdRef = useRef<string | null>(selectedSession?.id ?? null);
  activeSessionIdRef.current = selectedSession?.id ?? null;
  const handleSessionStatsChange = useCallback((stats: SessionStatsInfo | null) => {
    setSessionStats(stats);
  }, []);
  const [copiedSessionField, setCopiedSessionField] = useState<SessionCopyField | null>(null);
  const sessionCopyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleCopySessionField = useCallback((field: SessionCopyField, value: string) => {
    void copyText(value).then(() => {
      if (sessionCopyTimerRef.current) clearTimeout(sessionCopyTimerRef.current);
      setCopiedSessionField(field);
      sessionCopyTimerRef.current = setTimeout(() => setCopiedSessionField(null), 1400);
    });
  }, []);

  useEffect(() => {
    return () => {
      if (sessionCopyTimerRef.current) clearTimeout(sessionCopyTimerRef.current);
      if (autoNameTimerRef.current) clearTimeout(autoNameTimerRef.current);
    };
  }, []);

  // Context usage — populated by ChatWindow, displayed in top bar
  const [contextUsage, setContextUsage] = useState<{ percent: number | null; contextWindow: number; tokens: number | null } | null>(null);
  const handleContextUsageChange = useCallback((usage: { percent: number | null; contextWindow: number; tokens: number | null } | null) => {
    setContextUsage(usage);
  }, []);

  // Single active panel — only one dropdown open at a time
  const [activeTopPanel, setActiveTopPanel] = useState<"agents" | "branches" | "system" | "tools" | "session" | "debug" | null>(null);
  // Extension status cells reported by the open ChatWindow. The narrow phone
  // shows them in the More sheet instead of a floating dock.
  const [extensionUi, setExtensionUi] = useState<{
    statuses: ExtensionStatusItem[];
    widgets: ExtensionWidgetItem[];
    runCommand: (command: string) => void;
    commandsDisabled: boolean;
  } | null>(null);
  const onExtensionStatusChange = useCallback((ui: {
    statuses: ExtensionStatusItem[];
    widgets: ExtensionWidgetItem[];
    runCommand: (command: string) => void;
    commandsDisabled: boolean;
  }) => {
    setExtensionUi(ui);
  }, []);
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

  useEffect(() => {
    if (rightPanelFullWidth) setActiveTopPanel(null);
  }, [rightPanelFullWidth]);

  const toggleTopPanel = useCallback((
    panel: "agents" | "branches" | "system" | "tools" | "session" | "debug",
    keepMobileToolbarOpen = false,
  ) => {
    if (isMobile) setSidebarOpen(false);
    setActiveTopPanel((cur) => cur === panel ? null : panel);
    if (isMobile && isNarrowMobile && keepMobileToolbarOpen) setMobileToolbarMoreOpen(true);
  }, [isMobile, isNarrowMobile]);

  // The Debug button on screen (one of its three places at a time); Escape gives focus back to it.
  const debugButtonRef = useRef<HTMLButtonElement | null>(null);

  // Escape inside the debug panel; it never closes another panel that took its place. With focus
  // in the panel, that focus leaves the page with it: once the panel is gone (the next frame), the
  // Debug button gets it back, unless the user moved it meanwhile (focusIfLost).
  const closeDebugPanel = useCallback((restoreFocus: boolean) => {
    setActiveTopPanel((panel) => panel === "debug" ? null : panel);
    if (restoreFocus) requestAnimationFrame(() => focusIfLost(document, debugButtonRef.current));
  }, []);

  const handleSystemInfoToggle = useCallback((
    panel: "system" | "tools",
    keepMobileToolbarOpen = false,
  ) => {
    const opening = activeTopPanel !== panel;
    toggleTopPanel(panel, keepMobileToolbarOpen);
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

  const openSessionStatsPanel = useCallback(() => {
    if (isMobile) setSidebarOpen(false);
    setMobileToolbarMoreOpen(false);
    setActiveTopPanel("session");
  }, [isMobile]);

  // The composer opens Settings too: a bare /mcp opens Settings › MCP (useAgentSession).
  const openSettingsSection = useCallback((section: SettingsSection) => {
    setSettingsSection(section);
  }, []);

  const handleSidebarToggle = useCallback(() => {
    if (isMobile) {
      setActiveTopPanel(null);
      setMobileToolbarMoreOpen(false);
    }
    setSidebarOpen((open) => {
      const next = !open;
      if (!isMobile) desktopSidebarOpenRef.current = next;
      return next;
    });
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

  const handleRightPanelExpandToggle = useCallback(() => {
    setActiveTopPanel(null);
    setRightPanelExpanded((expanded) => !expanded);
  }, []);

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
      if (activeTopPanel === "agents") {
        setTopPanelPos({
          top: topBarRect.bottom,
          left: topBarRect.left,
          width: Math.min(AGENT_PANEL_WIDTH, topBarRect.width),
        });
        return;
      }
      setTopPanelPos({ top: topBarRect.bottom, left: topBarRect.left, width: topBarRect.width });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(topBarRef.current);
    return () => ro.disconnect();
  }, [activeTopPanel, isMobile]);

  // Files unmount when inactive; workspace terminals stay mounted until closed.
  // 「文件」与「审查」是页签里的一类（fastvibe 的 files / git 页签），不是文件本身：
  // 一个会话只开一个，`+` 里点它们就是切到这一类页。
  const [paneTabs, setPaneTabs] = useState<Tab[]>([]);
  const [fileTabs, setFileTabs] = useState<Tab[]>([]);
  const [activeFileTabId, setActiveFileTabId] = useState<string | null>(null);
  const fileWorkspaceStatesRef = useRef(new Map<string, ParkedFileWorkspace>());
  // Bumped on every workspace switch. The active viewer reports its state as
  // it unmounts, tagged with the generation it rendered in, so the report of a
  // tab just parked goes to its workspace, not to a same-path tab restored.
  const [fileWorkspaceGeneration, setFileWorkspaceGeneration] = useState(0);
  const fileWorkspaceGenerationRef = useRef(0);
  const [terminalTabs, setTerminalTabs] = useState<TerminalTab[]>([]);
  const [terminalsRestored, setTerminalsRestored] = useState(false);
  // Subagent work tabs are session-scoped and transient: no persistence, and
  // they are dropped when the project changes (they belong to its sessions).
  const [agentTabs, setAgentTabs] = useState<{ sessionId: string; label: string }[]>([]);
  const panelTabs: Tab[] = [
    ...paneTabs,
    ...fileTabs,
    ...terminalTabs.map((tab) => ({
      id: tab.id,
      label: getFileName(tab.cwd) || tab.cwd,
      filePath: tab.cwd,
      kind: "terminal" as const,
      closing: Boolean(tab.closing),
    })),
    ...agentTabs.map((tab) => ({
      id: `agent:${tab.sessionId}`,
      label: tab.label,
      filePath: tab.label,
      kind: "agent" as const,
    })),
  ];

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

  const handleFileViewerStateChange = useCallback((
    generation: number,
    tabId: string,
    viewerRevision: number,
    viewerState: FileViewerState,
  ) => {
    if (generation !== fileWorkspaceGenerationRef.current) {
      saveParkedFileViewerState(fileWorkspaceStatesRef.current, generation, tabId, viewerRevision, viewerState);
      return;
    }
    setFileTabs((prev) => saveFileViewerState(prev, tabId, viewerRevision, viewerState));
  }, []);

  const changeFileWorkspace = useCallback((currentKey: string | null, nextKey: string) => {
    if (currentKey === nextKey) return;
    const activeFileId = activeFileTabId?.startsWith("file:") ? activeFileTabId : null;
    const next = switchFileWorkspace(fileWorkspaceStatesRef.current, currentKey, nextKey, {
      tabs: fileTabs,
      activeTabId: activeFileId,
      open: rightPanelOpen && Boolean(activeFileId),
    }, fileWorkspaceGenerationRef.current);
    fileWorkspaceGenerationRef.current += 1;
    setFileWorkspaceGeneration(fileWorkspaceGenerationRef.current);
    setFileTabs(next.tabs);
    // Subagent tabs belong to the previous project's sessions: dropped, not parked.
    setAgentTabs([]);
    // Terminal tabs span workspaces and keep control of the panel while active.
    if (!activeFileTabId || activeFileId || activeFileTabId.startsWith("agent:")) {
      setActiveFileTabId(next.activeTabId);
      setRightPanelOpen(next.open);
    }
  }, [activeFileTabId, fileTabs, rightPanelOpen]);

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

  const handleFileLineMention = useCallback((relativePath: string, startLine: number, endLine: number) => {
    chatInputRef.current?.insertText(buildFileLineMentionText(relativePath, startLine, endLine));
    if (isMobile) { setRightPanelOpen(false); setSidebarOpen(false); }
  }, [isMobile]);

  const initialSessionId = initialNavigation.sessionId;
  const initialLinkedSessionId = linkedSessionId(initialNavigation);
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
  // Set when the session the URL linked to is gone: the project the sidebar
  // adopts next keeps a fresh composer instead of restoring its last session.
  const skipWorkspaceRestoreRef = useRef(false);
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
        if (!new URLSearchParams(window.location.search).get("cwd")) {
          router.replace(`?cwd=${encodeURIComponent(data.cwd)}`, { scroll: false });
        }
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setInitialCwdError(error instanceof Error ? error.message : String(error));
        setInitialCwdStatus("error");
      });

    return () => controller.abort();
  }, [initialNavigation, router]);

  // Restore the workspace's last open session after switching to it. Called
  // from handleCwdChange once the outgoing context has been reset. The session
  // is looked up against the live list so a deleted or drifted session falls
  // back to the default welcome page instead of erroring.
  const restoreWorkspaceContext = useCallback((projectKey: string, cwd: string) => {
    const token = ++workspaceRestoreTokenRef.current;
    const lastOpenSessionId = getLastOpenSession(projectKey);
    if (!lastOpenSessionId) return;
    const adopt = (d: { sessions: SessionInfo[] } | null) => {
      if (token !== workspaceRestoreTokenRef.current) return; // stale switch
      const s = d?.sessions.find((x) => x.id === lastOpenSessionId);
      if (!s) {
        // The list loaded but the remembered session is gone — forget it.
        // When the list itself failed (d === null) keep the memory so a
        // later switch retries the restore.
        if (d) clearLastOpen(projectKey);
        return;
      }
      if (workspaceKeyOf(s) !== projectKey) {
        // Defensive: the remembered session drifted out of this workspace.
        clearLastOpen(projectKey);
        return;
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
    // Fast path: the sidebar already delivered the catalogue — restore
    // without waiting on a fresh /api/sessions round trip.
    if (sessionCatalog.length > 0) {
      adopt({ sessions: sessionCatalog });
      return;
    }
    void fetch("/api/sessions")
      .then((r) => (r.ok ? (r.json() as Promise<{ sessions: SessionInfo[] }>) : null))
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
    const skipWorkspaceRestore = skipWorkspaceRestoreRef.current;
    skipWorkspaceRestoreRef.current = false;
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
    setBranchSwitchLocked(false);
    setSystemPrompt(null);
    setSystemTools(null);
    setSystemInfoLoading(false);
    // The debug panel stays open across the switch: it follows whichever session is shown.
    setActiveTopPanel((panel) => panel === "debug" ? panel : null);
    if (currentProject !== newProject) {
      // Keep #281's project isolation, but park each workspace's file tabs
      // instead of discarding them so they return when the user switches back.
      changeFileWorkspace(currentProject, newProject);
      // Restore the workspace we switched to: its last open session, or keep
      // the default welcome page when none is remembered.
      if (!skipWorkspaceRestore) restoreWorkspaceContext(newProject, cwd);
    }
    router.replace(typeof window !== "undefined" ? window.location.pathname : "/", { scroll: false });
  }, [activeCwd, changeFileWorkspace, invalidateWorkspaceRestore, newSessionCwd, router, selectedSession, restoreWorkspaceContext]);

  const handleSelectSession = useCallback((session: SessionInfo, isRestore = false, entryId?: string, blockIndex?: number, options?: SelectSessionOptions) => {
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
      changeFileWorkspace(activeProjectKeyRef.current, projectKey);
      setActiveTopPanel((panel) => panel === "debug" ? panel : null);
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
    setBranchSwitchLocked(false);
    branchLeafChangeFnRef.current = null;
    setSystemPrompt(null);
    setSystemTools(null);
    setSystemInfoLoading(false);
    setInitialSessionRestored(true);
    // On mobile, collapse the overlay drawer so the chat is revealed after pick
    // (unless the sidebar still has something to show: a fork's row and toast).
    if (isMobile && !isRestore && !options?.keepSidebarOpen) setSidebarOpen(false);
    if (isRestore) {
      // Suppress the redundant sessionKey bump that would come from the
      // onCwdChange effect firing after setSelectedCwd in the sidebar
      suppressCwdBumpRef.current = true;
    }
    // Skip router.replace when the URL already has this session — calling
    // replace in production Next.js triggers a Suspense remount loop.
    // Tab-memory restore lands on `/` and must write `?session=` so reload
    // and copy-link keep this session.
    if (!isRestore || new URLSearchParams(window.location.search).get("session") !== session.id) {
      router.replace(`?session=${encodeURIComponent(session.id)}`, { scroll: false });
    }
  }, [activeCwd, changeFileWorkspace, invalidateWorkspaceRestore, router, isMobile, newSessionCwd, selectedSession]);

  const handleNewSession = useCallback((sessionId: string, cwd: string, projectKey?: string | null, options?: NewSessionOptions) => {
    invalidateWorkspaceRestore();
    const draftKey = `new:${sessionId}:${cwd}`;
    // Leaving a fresh composer for another cwd parks its draft there, as a
    // workspace switch does; New in the same cwd still starts empty. The bar
    // above the composer moves the composer instead: its draft (the live
    // text, as promoteNewSession takes it) and its model picks go along.
    const activeDraftKey = activeNewSessionDraftKeyRef.current;
    const activeDraftCwd = newSessionCwd ?? (selectedSession === null ? activeCwd : null);
    if (options?.carryComposer && selectedSession === null && activeDraftKey) {
      const input = chatInputRef.current;
      if (input) input.rekeyDraft(activeDraftKey, draftKey);
      else rekeyDraft(activeDraftKey, draftKey);
      setCarriedNewSessionChoices(newSessionChoicesRef.current);
    } else if (activeDraftKey && activeDraftCwd && activeDraftCwd !== cwd) {
      rekeyDraft(activeDraftKey, parkedNewSessionDraftKey(activeDraftCwd));
    }
    // Adopt the target project before the sidebar reports its cwd, as an
    // explicit session pick does. Without a key (Ctrl+Alt+N) the current cwd
    // keeps its project.
    const targetProject = projectKey ?? (cwd === activeCwd ? activeProjectKeyRef.current : null) ?? cwd;
    if (activeProjectKeyRef.current !== targetProject) {
      changeFileWorkspace(activeProjectKeyRef.current, targetProject);
    }
    activeProjectKeyRef.current = targetProject;
    // A draft parked in this cwd comes back, unless one was carried here: it
    // stays parked for the next time, never merged into what was carried.
    if (!getDraft(draftKey)) rekeyDraft(parkedNewSessionDraftKey(cwd), draftKey);
    activeNewSessionDraftKeyRef.current = draftKey;
    setNewSessionDraftId(sessionId);
    setSelectedSession(null);
    setNewSessionCwd(cwd);
    setSessionKey((k) => k + 1);
    setBranchTree([]);
    setBranchActiveLeafId(null);
    setBranchSwitchLocked(false);
    setSystemPrompt(null);
    setSystemTools(null);
    setSystemInfoLoading(false);
    setActiveTopPanel((panel) => panel === "debug" ? panel : null);
    if (isMobile) setSidebarOpen(false);
    router.replace(`?cwd=${encodeURIComponent(cwd)}`, { scroll: false });
    // The fresh composer takes the caret once it renders (#1313), unless the
    // move came from the new-session bar, whose control keeps focus instead
    // (newSessionBarFocusRef), or a phone would raise the keyboard for it.
    // A dialog still open over the page (Ctrl+Alt+N under Settings) keeps it.
    if (!isMobile && !newSessionBarFocusRef.current) {
      requestAnimationFrame(() => {
        if (document.activeElement?.closest("[aria-modal='true']")) return;
        chatInputRef.current?.focus();
      });
    }
  }, [activeCwd, changeFileWorkspace, invalidateWorkspaceRestore, isMobile, newSessionCwd, router, selectedSession]);

  // Global keyboard shortcuts (handles Esc, Ctrl+Alt+N etc.)
  useGlobalKeyboardShortcuts({
    onNewSession: (cwd: string) => handleNewSession(`kb-${Date.now()}`, cwd),
    activeCwd,
  });

  // Client-built transient SessionInfo (new session / fork) lacks the
  // server-computed projectKey, which the same-project check in
  // handleCwdChange relies on. Hydrate it from the session list so switching
  // worktrees right after creating a session doesn't close the chat.
  const hydrateSelectedSession = useCallback((sessionId: string) => {
    void fetch("/api/sessions", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<{ sessions: SessionInfo[] }>) : null))
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
          void focusDesktopWindow();
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

  // 通知默认是开的，所以挂载时顺手申请一次权限（已经决定过就不再弹）。
  // 打包的桌面壳里这一步不弹框，权限本来就是给的。
  useEffect(() => {
    if (!completionNotificationsEnabled()) return;
    void ensureNotificationPermission();
  }, []);

  const handleAgentEnd = useCallback((end: AgentEndInfo) => {
    // The sidebar's reload merges the selected session's new row into it
    // (handleSessionsChange), so no list fetch of its own here.
    setRefreshKey((k) => k + 1);
    setExplorerRefreshKey((k) => k + 1);

    if (end.aborted || end.subagentsActive || selectedSession?.relation?.kind === "subagent") return;
    if (!completionNotificationsEnabled() || !shouldShowBrowserNotification()) return;
    const targetSession = selectedSession;
    deliverSessionNotification({
      targetSession,
      title: targetSession?.name ?? translate("i18n.sessionComplete"),
      body: translate("i18n.taskFinished"),
      tag: targetSession ? `pi-session-complete:${targetSession.id}` : "pi-session-complete",
    });
  }, [deliverSessionNotification, selectedSession, translate]);

  const handleAttentionNeeded = useCallback((request: BlockingExtensionUiRequest) => {
    if (selectedSession?.relation?.kind === "subagent") return;
    if (!completionNotificationsEnabled() || !shouldShowBrowserNotification()) return;
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

  const handleAutoName = useCallback(async () => {
    const sessionId = selectedSession?.id;
    if (!sessionId || autoNameStatus.kind === "naming") return;
    if (autoNameTimerRef.current) clearTimeout(autoNameTimerRef.current);
    setActiveTopPanel(null);
    setAutoNameStatus({ kind: "naming" });

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
      if (activeSessionIdRef.current !== sessionId) return;
      setSelectedSession((current) => current?.id === sessionId ? { ...current, name: title } : current);
      setSessionStats((current) => current?.sessionId === sessionId ? { ...current, sessionName: title } : current);
      setAutoNameStatus({ kind: "success" });
      autoNameTimerRef.current = setTimeout(() => setAutoNameStatus({ kind: "idle" }), 1800);
    } catch (error) {
      if (activeSessionIdRef.current !== sessionId) return;
      const message = error instanceof Error ? error.message : String(error);
      setAutoNameStatus({ kind: "error", message });
      autoNameTimerRef.current = setTimeout(() => setAutoNameStatus({ kind: "idle" }), 5000);
    }
  }, [autoNameStatus.kind, selectedSession?.id]);

  useEffect(() => {
    if (autoNameTimerRef.current) clearTimeout(autoNameTimerRef.current);
    setAutoNameStatus({ kind: "idle" });
  }, [selectedSession?.id]);

  const handleExplorerRefresh = useCallback(() => {
    setExplorerRefreshKey((k) => k + 1);
  }, []);

  // A run's writes show in the file tree as they happen, not only when it ends
  // (#1144): at most one refresh a second, after any tool but the read-only ones.
  const toolEndRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleToolEnd = useCallback((toolName: string) => {
    if (READ_ONLY_TOOL_NAMES.has(toolName) || toolEndRefreshTimerRef.current) return;
    toolEndRefreshTimerRef.current = setTimeout(() => {
      toolEndRefreshTimerRef.current = null;
      setExplorerRefreshKey((k) => k + 1);
    }, TOOL_END_REFRESH_MS);
  }, []);
  useEffect(() => () => {
    if (toolEndRefreshTimerRef.current) clearTimeout(toolEndRefreshTimerRef.current);
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

  // The sidebar calls this when the initial session is not in its list.
  const handleInitialRestoreDone = useCallback(() => {
    setInitialSessionRestored(true);
    if (initialLinkedSessionId) skipWorkspaceRestoreRef.current = true;
  }, [initialLinkedSessionId]);

  const handleSessionDeleted = useCallback((sessionId: string) => {
    invalidateWorkspaceRestore();
    setRefreshKey((k) => k + 1);
    // The DELETE can outlive a session switch: this callback's captured
    // selectedSession is from the delete click. Read the latest selection
    // and only fall back to the empty composer when the user is still on
    // the deleted session at the moment removal completes.
    const active = selectedSessionRef.current;
    if (active?.id === sessionId) {
      clearTabOpenSession(sessionId);
      const cwd = active.cwd;
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
      setBranchSwitchLocked(false);
      setSystemPrompt(null);
      setSystemTools(null);
      setSystemInfoLoading(false);
      setActiveTopPanel((panel) => panel === "debug" ? panel : null);
      router.replace(cwd ? `?cwd=${encodeURIComponent(cwd)}` : (typeof window !== "undefined" ? window.location.pathname : "/"), { scroll: false });
    }
  }, [invalidateWorkspaceRestore, router]);

  const handleOpenFile = useCallback((
    filePath: string,
    fileName: string,
    options?: { sourceSessionId?: string | null; modeHint?: "diff"; page?: number },
  ) => {
    const sourceSessionId = options?.sourceSessionId;
    const modeHint = options?.modeHint;
    const page = options?.page;
    const tabId = `file:${filePath}`;
    setFileTabs((prev) => openFileTab(prev, {
      fileName,
      filePath,
      modeHint,
      page,
      sourceSessionId,
      tabId,
    }));
    setActiveFileTabId(tabId);
    setRightPanelOpen(true);
    setFileTreeOpen(false);
    // On mobile the file panel is full-screen; close the drawer so it shows.
    if (isMobile) setSidebarOpen(false);
  }, [isMobile]);

  const handleOpenLinkedFile = useCallback((filePath: string, page?: number) => {
    handleOpenFile(filePath, getFileName(filePath), { sourceSessionId: selectedSession?.id ?? null, page });
  }, [handleOpenFile, selectedSession?.id]);

  // 「文件」页：右栏回到文件树 + 查看器那一面。
  const openFilesPane = useCallback(() => {
    setPaneTabs((tabs) => tabs.some((tab) => tab.kind === "files")
      ? tabs
      : [...tabs, { id: "pane:files", label: translate("files.paneTitle"), filePath: "", kind: "files" as const }]);
    setActiveFileTabId("pane:files");
    setRightPanelOpen(true);
    setFileTreeOpen(true);
    if (isMobile) setSidebarOpen(false);
  }, [isMobile, translate]);

  // 「审查」页：右栏里直接看 git 变更（fastvibe 的 review 页签），不再另开浮窗。
  const openReviewPane = useCallback(() => {
    setPaneTabs((tabs) => tabs.some((tab) => tab.kind === "review")
      ? tabs
      : [...tabs, { id: "pane:review", label: translate("changes.title"), filePath: "", kind: "review" as const }]);
    setActiveFileTabId("pane:review");
    setRightPanelOpen(true);
    if (isMobile) setSidebarOpen(false);
  }, [isMobile, translate]);

  // 「子代理」页：多 agent 的列表（原来顶栏那颗人形钮 + 浮层），现在也是右栏的一页。
  const openAgentsPane = useCallback(() => {
    setPaneTabs((tabs) => tabs.some((tab) => tab.kind === "agents")
      ? tabs
      : [...tabs, { id: "pane:agents", label: translate("sidebar.agents"), filePath: "", kind: "agents" as const }]);
    setActiveFileTabId("pane:agents");
    setRightPanelOpen(true);
    if (isMobile) setSidebarOpen(false);
  }, [isMobile, translate]);

  const handleOpenTerminal = useCallback((cwd: string) => {
    const existing = terminalTabs.find((tab) => tab.cwd === cwd);
    const tab = existing ?? newTerminalTab(cwd);
    if (!existing) setTerminalTabs((tabs) => [...tabs, tab]);
    setActiveFileTabId(tab.id);
    setRightPanelOpen(true);
    if (isMobile) setSidebarOpen(false);
  }, [terminalTabs, isMobile]);

  // Subagent work opens in a right-panel tab instead of hijacking the main chat.
  const handleOpenSubagentTab = useCallback((sessionId: string, label: string) => {
    setAgentTabs((prev) => prev.some((tab) => tab.sessionId === sessionId) ? prev : [...prev, { sessionId, label }]);
    setActiveFileTabId(`agent:${sessionId}`);
    setRightPanelOpen(true);
    if (isMobile) setSidebarOpen(false);
  }, [isMobile]);

  // The agent switcher's side-panel button: opens a subagent's tab, or closes
  // it when the open panel already has it (the panel closes with its last tab).
  // The switcher stays open beside the panel, except on phones, where the
  // panel covers the chat.
  const openSubagentTabIds = useMemo(
    () => new Set(rightPanelOpen ? agentTabs.map((tab) => tab.sessionId) : []),
    [agentTabs, rightPanelOpen],
  );
  const handleToggleSubagentTab = (sessionId: string, label: string) => {
    if (openSubagentTabIds.has(sessionId)) {
      handleCloseFileTab(`agent:${sessionId}`);
      return;
    }
    if (isMobile) setActiveTopPanel(null);
    handleOpenSubagentTab(sessionId, label);
  };

  const handleTerminalClosed = (tab: TerminalTab) => {
    const replacement = tab.closing === "restart" ? newTerminalTab(tab.cwd) : null;
    const remaining = terminalTabs.filter((item) => item.id !== tab.id);
    setTerminalTabs((tabs) => tabs.flatMap((item) => item.id !== tab.id ? [item] : replacement ? [replacement] : []));
    setActiveFileTabId((current) => current !== tab.id ? current : replacement?.id ?? remaining.at(-1)?.id ?? fileTabs.at(-1)?.id ?? lastAgentTabId(agentTabs));
    if (!replacement && !remaining.length && !fileTabs.length && !agentTabs.length && !paneTabs.length) setRightPanelOpen(false);
  };

  // 右键菜单的「关闭其他 / 全部关闭」：只动右栏的页签，最后全关掉就收起面板。
  const handleCloseOtherTabs = useCallback((keepId: string) => {
    const keepPane = paneTabs.filter((tab) => tab.id === keepId);
    const keepFile = fileTabs.filter((tab) => tab.id === keepId);
    const keepTerminal = terminalTabs.filter((tab) => tab.id === keepId);
    const keepAgent = agentTabs.filter((tab) => `agent:${tab.sessionId}` === keepId);
    setPaneTabs(keepPane);
    setFileTabs(keepFile);
    setTerminalTabs(keepTerminal);
    setAgentTabs(keepAgent);
    setActiveFileTabId(keepId);
  }, [paneTabs, fileTabs, terminalTabs, agentTabs]);

  const handleCloseAllTabs = useCallback(() => {
    setPaneTabs([]);
    setFileTabs([]);
    setTerminalTabs([]);
    setAgentTabs([]);
    setActiveFileTabId(null);
    setRightPanelOpen(false);
  }, []);

  const handleCloseFileTab = useCallback((tabId: string) => {
    // 页签里的「文件 / 审查」两类页：关掉就回到别的页签，全没了才收起右栏。
    if (paneTabs.some((tab) => tab.id === tabId)) {
      const remainingPanes = paneTabs.filter((tab) => tab.id !== tabId);
      setPaneTabs(remainingPanes);
      setActiveFileTabId((cur) => {
        if (cur !== tabId) return cur;
        return fileTabs.at(-1)?.id ?? terminalTabs.at(-1)?.id ?? lastAgentTabId(agentTabs) ?? remainingPanes.at(-1)?.id ?? null;
      });
      if (remainingPanes.length === 0 && fileTabs.length === 0 && terminalTabs.length === 0 && agentTabs.length === 0) setRightPanelOpen(false);
      return;
    }
    if (terminalTabs.some((tab) => tab.id === tabId)) {
      setTerminalTabs((tabs) => tabs.map((tab) => tab.id === tabId && !tab.closing ? { ...tab, closing: "close" } : tab));
      return;
    }
    if (tabId.startsWith("agent:")) {
      const remainingAgents = agentTabs.filter((tab) => `agent:${tab.sessionId}` !== tabId);
      setAgentTabs(remainingAgents);
      setActiveFileTabId((cur) => {
        if (cur !== tabId) return cur;
        return fileTabs.at(-1)?.id ?? terminalTabs.at(-1)?.id ?? lastAgentTabId(remainingAgents) ?? paneTabs.at(-1)?.id ?? null;
      });
      if (fileTabs.length === 0 && terminalTabs.length === 0 && paneTabs.length === 0 && remainingAgents.length === 0) setRightPanelOpen(false);
      return;
    }
    setFileTabs((prev) => {
      const next = prev.filter((t) => t.id !== tabId);
      if (next.length === 0 && terminalTabs.length === 0 && agentTabs.length === 0 && paneTabs.length === 0) setRightPanelOpen(false);
      return next;
    });
    setActiveFileTabId((cur) => {
      if (cur !== tabId) return cur;
      const remaining = fileTabs.filter((t) => t.id !== tabId);
      return remaining.at(-1)?.id ?? terminalTabs.at(-1)?.id ?? lastAgentTabId(agentTabs) ?? paneTabs.at(-1)?.id ?? null;
    });
  }, [fileTabs, terminalTabs, agentTabs, paneTabs]);

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

  // The bar above a fresh composer. Only a fresh composer moves, and only
  // somewhere else: the folder in use would remount it for nothing. The
  // control the move came from takes focus in the bar of the new composer.
  const handlePickNewSessionContext = useCallback((target: NewSessionTarget, from: NewSessionContextControl) => {
    if (selectedSession !== null || !effectiveNewSessionCwd || target.cwd === effectiveNewSessionCwd) return;
    newSessionBarFocusRef.current = from;
    // A worktree just created already left its move, with the branch.
    if (target.projectKey && target.projectRoot && newSessionMoveRef.current?.cwd !== target.cwd) {
      newSessionMoveRef.current = { cwd: target.cwd, project: { key: target.projectKey, root: target.projectRoot }, branch: null };
    }
    sidebarControlRef.current?.startNewSessionIn({ ...target, carryComposer: true });
  }, [effectiveNewSessionCwd, selectedSession]);
  // The folder picker answers later: its pick runs the newest closure, guard included.
  const pickNewSessionContextRef = useRef(handlePickNewSessionContext);
  pickNewSessionContextRef.current = handlePickNewSessionContext;
  const handleOpenFolderForNewSession = useCallback((opener: HTMLElement | null) => {
    sidebarControlRef.current?.openFolderForNewSession((target) => pickNewSessionContextRef.current(target, "project"), opener);
  }, []);
  const handleDefaultDirectoryForNewSession = useCallback(() => {
    sidebarControlRef.current?.openDefaultDirectoryForNewSession((target) => pickNewSessionContextRef.current(target, "project"));
  }, []);
  const handleRefreshNewSessionWorktrees = useCallback(() => {
    sidebarControlRef.current?.refreshWorktrees();
  }, []);
  const handleCreateNewSessionWorktree = useCallback(async (project: ProjectChoice, branch: string) => {
    const control = sidebarControlRef.current;
    if (!control) throw new Error("The session sidebar is not mounted");
    const result = await control.createWorktree(project, branch);
    // The bar moves there next, before any report lists it.
    if ("path" in result) newSessionMoveRef.current = { cwd: result.path, project, branch };
    return result;
  }, []);
  const handleNewSessionBarFocusDone = useCallback(() => {
    newSessionBarFocusRef.current = null;
  }, []);
  const newSessionContextBar = selectedSession === null && effectiveNewSessionCwd ? (
    <NewSessionContextBar
      context={contextForCwd(sidebarNewSessionContext, effectiveNewSessionCwd, newSessionMoveRef.current)}
      mobile={isMobile}
      initialFocus={newSessionBarFocusRef.current}
      onInitialFocusDone={handleNewSessionBarFocusDone}
      onPick={handlePickNewSessionContext}
      onUseDefaultDirectory={handleDefaultDirectoryForNewSession}
      onOpenFolder={handleOpenFolderForNewSession}
      onRefreshWorktrees={handleRefreshNewSessionWorktrees}
      onCreateWorktree={handleCreateNewSessionWorktree}
    />
  ) : null;
  const showChat = selectedSession !== null || effectiveNewSessionCwd !== null;
  const projectTrustCwd = selectedSession?.cwd ?? effectiveNewSessionCwd;
  // While restoring initial session from URL, don't show the placeholder
  const showPlaceholder = initialSessionRestored && !showChat;

  // The Debug button shows with a chat only: without one, its panel would have nothing to close it.
  useEffect(() => {
    if (!showChat) setActiveTopPanel((panel) => panel === "debug" ? null : panel);
  }, [showChat]);

  useEffect(() => {
    setProjectTrust(null);
    setProjectTrustDialogOpen(false);
    setProjectTrustError(null);
    if (!projectTrustCwd) return;

    const controller = new AbortController();
    // The answer also lists the project's MCP servers (`mcpFile`, `mcpServers`), unused here: the
    // trust dialog fetches the listing again when it opens, since the file can change in between.
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
      const data = await response.json() as ProjectTrustStatus & Partial<McpErrorResponse>;
      if (!response.ok || data.error) {
        // The dialog translates the reason; the English error is only its diagnostic.
        setProjectTrustError({ error: data.error ?? `HTTP ${response.status}`, ...(data.reason ? { reason: data.reason } : {}) });
        return;
      }
      setProjectTrust(data);
      setProjectTrustDialogOpen(false);
      setModelsRefreshKey((key) => key + 1);
      setSessionKey((key) => key + 1);
    } catch (error) {
      setProjectTrustError({ error: error instanceof Error ? error.message : String(error) });
    } finally {
      setProjectTrustBusy(false);
    }
  }, [projectTrustBusy, projectTrustCwd]);

  // The restricted-mode banner and Settings › MCP's trust notice open the same dialog.
  const openProjectTrustDialog = useCallback(() => {
    setProjectTrustError(null);
    setProjectTrustDialogOpen(true);
  }, []);

  // Settings › MCP added a project server: `.pi/mcp.json` alone makes a folder require trust, and a
  // fresh folder was trusted in the same step. Every mounted section reloads in place on the new
  // status (projectTrustReloadKey); nothing was rebuilt, so the chat needs no new session key.
  const handleProjectTrustChanged = useCallback((cwd: string, status: ProjectTrustStatus) => {
    if (cwd === projectTrustCwd) setProjectTrust(status);
  }, [projectTrustCwd]);

  const activeFileTab = fileTabs.find((tab) => tab.id === activeFileTabId) ?? null;
  const activePaneTab = paneTabs.find((tab) => tab.id === activeFileTabId) ?? null;
  // 文件树只属于「文件」页：切到审查 / 终端 / 子代理时它不该一直杵在旁边。
  // 没有任何页签时（空态）也不画，空态自己给了入口。
  const isFilesPaneFace = activePaneTab?.kind === "files"
    || (!activePaneTab && Boolean(activeFileTab?.filePath));
  // Subagent work tabs: like files, only the active one is mounted.
  const activeAgentTab = agentTabs.find((tab) => `agent:${tab.sessionId}` === activeFileTabId) ?? null;
  // With nothing open the panel is only the file tree: the viewer column and its
  // body wait for a click on a file instead of showing an empty pane.
  const panelHasContent = Boolean(
    activePaneTab
    || (activeFileTab && activeFileTab.filePath)
    || activeAgentTab
    || terminalTabs.some((tab) => tab.id === activeFileTabId),
  );
  // 没有文件时树就是这一页（空态），有文件时听那颗「文件树」钮的。
  const showFileTree = isFilesPaneFace && (!panelHasContent || fileTreeOpen);
  const activeCwdName = activeCwd ? getFileName(activeCwd) || activeCwd : null;
  const windowTitle = activeCwdName ? `${activeCwdName} - PI NEXT` : "PI NEXT";

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
        controlRef={sidebarControlRef}
        onNewSessionContextChange={handleSidebarNewSessionContext}
        initialSessionId={initialSessionId}
        initialSessionLinked={initialLinkedSessionId !== null}
        skipInitialProjectSelection={initialNavigation.requestedCwd !== null}
        onInitialRestoreDone={handleInitialRestoreDone}
        refreshKey={refreshKey}
        onSessionDeleted={handleSessionDeleted}
        selectedCwd={selectedSession?.cwd ?? newSessionCwd ?? null}
        onCwdChange={handleCwdChange}
        onBackgroundTaskDone={handleBackgroundTaskDone}
        onRunningSessionIdsChange={handleRunningSessionIdsChange}
        onSessionsChange={handleSessionsChange}
        onCloseMobile={() => setSidebarOpen(false)}
      />
      <div className="sidebar-footer">
        <SidebarFoot
          label={translate("common.settings")}
          title={translate("common.settings")}
          onClick={() => setSettingsSection(getLastSettingsSection(projectTrustCwd))}
        />
      </div>
    </>
  );

  const renderProjectTrustWarning = (mobileBanner: boolean) => {
    if (!showChat || !projectTrust?.requiresTrust || projectTrust.trusted) return null;
    return (
      <button
        type="button"
        onClick={openProjectTrustDialog}
        title={translate("trust.resourcesNotLoaded")}
        aria-label={translate("trust.resourcesNotLoaded")}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: mobileBanner ? "flex-start" : "center",
          gap: 6,
          width: mobileBanner ? "100%" : undefined,
          minHeight: mobileBanner ? 32 : undefined,
          height: mobileBanner ? undefined : "100%",
          padding: mobileBanner ? "6px 12px" : "0 12px",
          background: mobileBanner ? "color-mix(in srgb, #d97706 8%, var(--bg-panel))" : "none",
          border: "none",
          borderRight: mobileBanner ? "none" : "1px solid var(--border)",
          borderBottom: mobileBanner ? "1px solid var(--border)" : "none",
          color: "#d97706",
          cursor: "pointer",
          flexShrink: 0,
          fontSize: 11,
          lineHeight: 1.35,
          textAlign: "left",
        }}
        data-mobile-trust-banner={mobileBanner ? "true" : undefined}
      >
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          style={{ flexShrink: 0 }}
        >
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
          <path d="M12 8v4" />
          <path d="M12 16h.01" />
        </svg>
        <span>{translate("trust.resourcesNotLoaded")}</span>
      </button>
    );
  };

  // ---------------------------------------------------------------- 顶栏按钮组
  // 画板 design/v3/boards/web-running.html 帧 A / 帧 B 的 `.chrome` 行，原样搬过来：
  // 左起 `.cbtn`（新建会话）· `.ccap--text`（分支）· `h1.chrome__title` · `.chrome__right`
  // 里两组 `.ccap`（在文件管理器打开 / 文件 · 终端 / 变更）。
  // 画板有、产品没有的两颗不渲染（权限模式、运行项目脚本），记在 design/v3/DIVERGENCE.md。

  // 本机文件管理器可用性，问法与侧栏同一支 API（GET 只回答能不能开）。
  useEffect(() => {
    let cancelled = false;
    fetch("/api/open-in-explorer")
      .then((res) => (res.ok ? res.json() as Promise<{ supported?: boolean; reason?: string | null }> : null))
      .then((data) => {
        if (cancelled || !data) return;
        setFileManager({ supported: data.supported !== false, reason: data.reason ?? null });
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // 在资源管理器中打开当前工作区：与侧栏那颗同一个 API。
  const handleChromeOpenInExplorer = useCallback(() => {
    if (!activeCwd) return;
    void fetch("/api/open-in-explorer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cwd: activeCwd }),
    }).catch(() => {});
  }, [activeCwd]);

  // 终端：右侧面板已经停在同一台上时收起面板，否则开到当前工作区的终端。
  // ⌘B / Ctrl+B：帧 B 里那颗胶囊上写着 ⌘B，键就得真的能收放侧栏。
  // 输入框里按 Ctrl+B 是别的意思，所以只处理不在可编辑元素里的那一次。
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
      if (event.key.toLowerCase() !== "b") return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      if (document.querySelector("[aria-modal='true']")) return;
      event.preventDefault();
      handleSidebarToggle();
    };
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [handleSidebarToggle]);

  // 「⋯」下拉：点外面或按 Esc 收起来（和侧栏菜单一样的规矩）。
  useEffect(() => {
    if (!chromeMoreOpen) return;
    const onDown = (event: MouseEvent) => {
      if (chromeMoreRef.current?.contains(event.target as Node)) return;
      setChromeMoreOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setChromeMoreOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [chromeMoreOpen]);

  useEffect(() => {
    if (!panelAddOpen) return;
    const onDown = (event: MouseEvent) => {
      if (panelAddRef.current?.contains(event.target as Node)) return;
      setPanelAddOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPanelAddOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [panelAddOpen]);
  // While subagents run: their count, ringed by a spinner; otherwise all of them.
  const renderAgentsBadge = (badge: { count: number; running: boolean }, mobile: boolean) => (
    <span
      aria-hidden="true"
      style={{
        position: "relative",
        minWidth: 15, height: 15, padding: "0 4px", display: "grid", placeItems: "center",
        borderRadius: 7,
        background: badge.running ? "color-mix(in srgb, var(--accent) 22%, var(--bg-panel))" : "var(--bg-selected)",
        color: "var(--accent)",
        fontSize: 10, lineHeight: 1, fontVariantNumeric: "tabular-nums",
        fontWeight: badge.running ? 600 : undefined,
        ...(mobile ? { position: "absolute", top: 3, right: 3, minWidth: 13, height: 13, padding: "0 3px", fontSize: 9 } : {}),
      }}
    >
      {badge.running && (
        <svg
          className="animate-spin motion-reduce:animate-none"
          viewBox="0 0 24 24" fill="none" aria-hidden="true"
          style={{ position: "absolute", top: -3, left: -3, width: "calc(100% + 6px)", height: "calc(100% + 6px)", pointerEvents: "none" }}
        >
          <circle cx="12" cy="12" r="11" stroke="currentColor" strokeWidth="2" opacity="0.2" />
          <path d="M23 12a11 11 0 0 0-11-11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      )}
      {badge.count}
    </span>
  );

  const renderChatToolbarActions = (mobile: boolean) => {
    // design/v3 的会话头右侧（部件 01-chrome）：一组 `.ccap` 胶囊，里面是 28 圆的
    // `.cbtn`。桌面走这一支；手机顶栏是另一套分段钮（部件 32-m-top），原样保留。
    if (!mobile) {
      const hasMessages = Boolean(
        selectedSession
        && ((sessionStats?.userMessages ?? 0) > 0 || selectedSession.messageCount > 0),
      );
      const naming = autoNameStatus.kind === "naming";
      const named = autoNameStatus.kind === "success";
      const nameError = autoNameStatus.kind === "error";
      const nameDisabled = !selectedSession || selectedSession.transient || !hasMessages || naming;
      const nameTitle = !selectedSession || selectedSession.transient
        ? translate("title.unsaved")
        : !hasMessages
          ? translate("title.noMessages")
          : nameError
            ? autoNameStatus.message
            : translate("title.generateSession");

      return (
        <div className="chrome__right">
          {/* 产品自己的这一组（历史 / 生成标题 / 子代理 / 系统提示词 / 工具定义）：
              画板没有，但产品更强，按 BOARDS.md 的口径不删；没有会话时整组不出现，
              与改动前的空态一致。 */}
          {showChat && (
            <>
              <div className="ccap chrome-more" ref={chromeMoreRef}>
                <button
                  type="button"
                  className={`cbtn${chromeMoreOpen ? " is-on" : ""}`}
                  onClick={() => setChromeMoreOpen((open) => !open)}
                  title={translate("chat.moreControls")}
                  aria-label={translate("chat.moreControls")}
                  aria-haspopup="menu"
                  aria-expanded={chromeMoreOpen}
                  aria-controls="chrome-more-menu"
                >
                  <Icon name="ellipsis" />
                </button>
                {chromeMoreOpen && (
                  <div id="chrome-more-menu" role="menu" aria-label={translate("chat.moreControls")} className="chrome-more-menu">
                    <button
                      type="button"
                      role="menuitem"
                      className="chrome-more-row"
                      onClick={() => { setChromeMoreOpen(false); void handleViewFullHistory(); }}
                      disabled={!selectedSession}
                      title={selectedSession ? translate("history.full") : translate("history.unsaved")}
                    >
                      <Icon name="clock" />
                      <span>{translate("history.full")}</span>
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className={`chrome-more-row${named ? " is-on" : ""}`}
                      onClick={() => { setChromeMoreOpen(false); void handleAutoName(); }}
                      disabled={nameDisabled}
                      title={nameTitle}
                    >
                      {naming ? <Spin variant="mini" label={translate("title.generating")} /> : <Icon name={nameError ? "alert" : named ? "check" : "sparkle"} />}
                      <span>{translate("title.generate")}</span>
                    </button>
                    {sessionHasBranches && (
                      <button
                        type="button"
                        role="menuitem"
                        className={`chrome-more-row${activeTopPanel === "branches" ? " is-on" : ""}`}
                        onClick={() => { setChromeMoreOpen(false); toggleTopPanel("branches", false); }}
                        title={translate("i18n.branches")}
                      >
                        <Icon name="branch" />
                        <span>{translate("i18n.branches")}</span>
                      </button>
                    )}
                    <button
                      type="button"
                      role="menuitem"
                      className={`chrome-more-row${activeTopPanel === "system" ? " is-on" : ""}`}
                      onClick={() => { setChromeMoreOpen(false); handleSystemInfoToggle("system", false); }}
                      title={translate("system.prompt")}
                    >
                      <Icon name="doc-text" />
                      <span>{translate("system.prompt")}</span>
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className={`chrome-more-row${activeTopPanel === "tools" ? " is-on" : ""}`}
                      onClick={() => { setChromeMoreOpen(false); handleSystemInfoToggle("tools", false); }}
                      title={translate("tools.title")}
                    >
                      <Icon name="wrench" />
                      <span>{translate("tools.title")}</span>
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className={`chrome-more-row${activeTopPanel === "debug" ? " is-on" : ""}`}
                      onClick={() => { setChromeMoreOpen(false); toggleTopPanel("debug", false); }}
                      title={translate("debug.title")}
                    >
                      <Icon name="bug" />
                      <span>{translate("debug.title")}</span>
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
          {/* 顶栏只剩两颗：右栏的开关（面板图标——它开的就是右栏）和多出来的那颗「⋯」。
              终端 / 审查 / 文件都搬进右栏的页签里了，「在文件管理器打开」搬到文件树头上，
              扩展状态那颗也不再占这一排。 */}
          {/* 单颗钮不套胶囊：胶囊比圆钮高出一圈，看着就成了椭圆。 */}
          {renderMainFileToggle(false)}
        </div>
      );
    }
    return (
      <div className="app-toolbar-group">
        <button
          type="button"
          onClick={() => {
            handleViewFullHistory();
            if (mobile && isNarrowMobile) setMobileToolbarMoreOpen(true);
          }}
          disabled={!selectedSession}
          title={selectedSession ? translate("history.full") : translate("history.unsaved")}
          aria-label={translate("history.full")}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            width: mobile ? TOP_BAR_ICON_BUTTON_SIZE : undefined,
            height: "100%",
            padding: mobile ? 0 : "0 12px",
            background: "none",
            border: "none",
            borderTop: "2px solid transparent",
            borderRight: "1px solid var(--border)",
            color: selectedSession ? "var(--text-muted)" : "var(--text-dim)",
            cursor: selectedSession ? "pointer" : "not-allowed",
            opacity: selectedSession ? 1 : 0.45,
            flexShrink: 0,
            fontSize: 11,
            whiteSpace: "nowrap",
            transition: "color 0.1s, background 0.1s, opacity 0.1s",
          }}
          onMouseEnter={(event) => {
            if (!selectedSession) return;
            event.currentTarget.style.color = "var(--text)";
            event.currentTarget.style.background = "var(--bg-hover)";
          }}
          onMouseLeave={(event) => {
            event.currentTarget.style.color = selectedSession ? "var(--text-muted)" : "var(--text-dim)";
            event.currentTarget.style.background = "none";
          }}
          data-mobile-toolbar-action={mobile ? "history" : undefined}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{
              color: selectedSession ? "var(--text-muted)" : "var(--text-dim)",
              flexShrink: 0,
            }}
            aria-hidden="true"
          >
            <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
            <path d="M3 3v5h5" />
            <path d="M12 7v5l3 2" />
          </svg>
          {!mobile && <span>{translate("history.label")}</span>}
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
              style={{
                display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                width: mobile ? TOP_BAR_ICON_BUTTON_SIZE : undefined,
                height: "100%", padding: mobile ? 0 : "0 12px",
                background: "none", border: "none",
                borderTop: "2px solid transparent",
                borderRight: "1px solid var(--border)",
                color: isError ? "#dc2626" : isSuccess ? "var(--accent)" : disabled ? "var(--text-dim)" : "var(--text-muted)",
                cursor: disabled ? "not-allowed" : "pointer",
                opacity: disabled && autoNameStatus.kind !== "naming" ? 0.45 : 1,
                flexShrink: 0, fontSize: 11, whiteSpace: "nowrap",
                transition: "color 0.1s, background 0.1s, opacity 0.1s",
              }}
              onMouseEnter={(event) => {
                if (disabled) return;
                event.currentTarget.style.color = isError ? "#dc2626" : "var(--text)";
                event.currentTarget.style.background = "var(--bg-hover)";
              }}
              onMouseLeave={(event) => {
                event.currentTarget.style.color = isError ? "#dc2626" : isSuccess ? "var(--accent)" : disabled ? "var(--text-dim)" : "var(--text-muted)";
                event.currentTarget.style.background = "none";
              }}
              data-mobile-toolbar-action={mobile ? "name" : undefined}
            >
              {autoNameStatus.kind === "naming" ? (
                <svg className="animate-spin" width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" opacity="0.25" />
                  <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              ) : isSuccess ? (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="m15 4 5 5L7 22l-5-5Z" />
                  <path d="m14 5 5 5" />
                  <path d="M6 4V2M5 3H3M19 19v3M17.5 20.5h3" />
                </svg>
              )}
              {!mobile && <span>{label}</span>}
            </button>
          );
        })()}
        {hasSubagentSessions && agentsBadge && (
          <button
            type="button"
            onClick={() => toggleTopPanel("agents", mobile)}
            title={agentsButtonLabel}
            aria-label={agentsButtonLabel}
            aria-pressed={activeTopPanel === "agents"}
            style={{
              position: "relative",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              width: mobile ? TOP_BAR_ICON_BUTTON_SIZE : undefined,
              height: "100%", padding: mobile ? 0 : "0 12px",
              background: activeTopPanel === "agents" ? "var(--bg-selected)" : "none",
              border: "none",
              borderTop: activeTopPanel === "agents" ? "2px solid var(--accent)" : "2px solid transparent",
              borderRight: "1px solid var(--border)",
              color: activeTopPanel === "agents" ? "var(--text)" : "var(--text-muted)",
              cursor: "pointer", flexShrink: 0, fontSize: 11, whiteSpace: "nowrap",
              transition: "color 0.1s, background 0.1s",
            }}
            data-mobile-toolbar-action={mobile ? "agents" : undefined}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="5" y="7" width="14" height="11" rx="2" /><path d="M9 11h.01M15 11h.01M9 15h6M12 7V4M10 4h4" />
            </svg>
            {!mobile && <span>{translate("agentSwitcher.title")}</span>}
            {renderAgentsBadge(agentsBadge, mobile)}
          </button>
        )}
        {sessionHasBranches && (mobile ? (
          <button
            type="button"
            onClick={() => toggleTopPanel("branches", true)}
            title={translate("i18n.branches")}
            aria-label={translate("i18n.branches")}
            aria-pressed={activeTopPanel === "branches"}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              width: TOP_BAR_ICON_BUTTON_SIZE, height: "100%", padding: 0,
              background: activeTopPanel === "branches" ? "var(--bg-selected)" : "none",
              border: "none",
              borderTop: activeTopPanel === "branches" ? "2px solid var(--accent)" : "2px solid transparent",
              borderRight: "1px solid var(--border)",
              color: activeTopPanel === "branches" ? "var(--text)" : "var(--text-muted)",
              cursor: "pointer", flexShrink: 0,
            }}
            data-mobile-toolbar-action="branches"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: branchTree.length > 0 ? "var(--accent)" : "var(--text-dim)" }} aria-hidden="true">
              <line x1="6" y1="3" x2="6" y2="15" />
              <circle cx="18" cy="6" r="3" />
              <circle cx="6" cy="18" r="3" />
              <path d="M18 9a9 9 0 0 1-9 9" />
            </svg>
          </button>
        ) : (
          <BranchNavigator
            tree={branchTree}
            activeLeafId={branchActiveLeafId}
            onLeafChange={handleBranchLeafChange}
            locked={branchSwitchLocked}
            inline
            containerRef={topBarRef}
            open={activeTopPanel === "branches"}
            onToggle={() => toggleTopPanel("branches")}
            hasSession
          />
        ))}
        <button
          ref={systemBtnRef}
          type="button"
          onClick={() => handleSystemInfoToggle("system", mobile)}
          disabled={mobile && !showChat}
          title={translate("system.prompt")}
          aria-label={translate("system.prompt")}
          aria-pressed={activeTopPanel === "system"}
          style={{
            display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
            width: mobile ? TOP_BAR_ICON_BUTTON_SIZE : undefined,
            height: "100%", padding: mobile ? 0 : "0 12px",
            background: activeTopPanel === "system" ? "var(--bg-selected)" : "none",
            border: "none",
            borderTop: activeTopPanel === "system" ? "2px solid var(--accent)" : "2px solid transparent",
            borderRight: "1px solid var(--border)",
            cursor: mobile && !showChat ? "not-allowed" : "pointer",
            color: activeTopPanel === "system" ? "var(--text)" : "var(--text-muted)",
            opacity: mobile && !showChat ? 0.45 : 1,
            fontSize: 11, whiteSpace: "nowrap", transition: "color 0.1s, background 0.1s",
          }}
          onMouseEnter={(event) => {
            if (mobile && !showChat) return;
            event.currentTarget.style.color = "var(--text)";
          }}
          onMouseLeave={(event) => {
            event.currentTarget.style.color = activeTopPanel === "system" ? "var(--text)" : "var(--text-muted)";
          }}
          data-mobile-toolbar-action={mobile ? "system" : undefined}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: systemPrompt ? "var(--accent)" : "var(--text-dim)", flexShrink: 0 }} aria-hidden="true">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="8" y1="13" x2="16" y2="13" />
            <line x1="8" y1="17" x2="13" y2="17" />
          </svg>
          {!mobile && <span>{translate("system.label")}</span>}
        </button>
        <button
          type="button"
          onClick={() => handleSystemInfoToggle("tools", mobile)}
          disabled={mobile && !showChat}
          title={translate("tools.title")}
          aria-label={translate("tools.title")}
          aria-pressed={activeTopPanel === "tools"}
          style={{
            display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
            width: mobile ? TOP_BAR_ICON_BUTTON_SIZE : undefined,
            height: "100%", padding: mobile ? 0 : "0 12px",
            background: activeTopPanel === "tools" ? "var(--bg-selected)" : "none",
            border: "none",
            borderTop: activeTopPanel === "tools" ? "2px solid var(--accent)" : "2px solid transparent",
            borderRight: "1px solid var(--border)",
            cursor: mobile && !showChat ? "not-allowed" : "pointer",
            color: activeTopPanel === "tools" ? "var(--text)" : "var(--text-muted)",
            opacity: mobile && !showChat ? 0.45 : 1,
            fontSize: 11, whiteSpace: "nowrap", transition: "color 0.1s, background 0.1s",
          }}
          onMouseEnter={(event) => {
            if (mobile && !showChat) return;
            event.currentTarget.style.color = "var(--text)";
          }}
          onMouseLeave={(event) => {
            event.currentTarget.style.color = activeTopPanel === "tools" ? "var(--text)" : "var(--text-muted)";
          }}
          data-mobile-toolbar-action={mobile ? "tools" : undefined}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: systemTools?.some((tool) => tool.active) ? "var(--accent)" : "var(--text-dim)", flexShrink: 0 }} aria-hidden="true">
            <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9z" />
          </svg>
          {!mobile && <span>{translate("tools.label")}</span>}
        </button>
      </div>
    );
  };

  const renderSessionStatsButton = (mobile: boolean) => {
    if (!mobile && (!showChat || (!sessionStats && !contextUsage))) return null;

    const tokens = sessionStats?.tokens;
    const cost = sessionStats?.cost ?? 0;
    const formatCompact = formatCompactCount;
    const costText = formatCostShort(cost);

    let contextColor = "var(--text-muted)";
    let desktopContextText: string | null = null;
    let mobileContextText: string | null = null;
    if (contextUsage?.contextWindow) {
      const percent = contextUsage.percent;
      if (percent !== null && percent > 90) contextColor = "#ef4444";
      else if (percent !== null && percent > 70) contextColor = "rgba(234,179,8,0.95)";
      desktopContextText = percent !== null
        ? `${percent.toFixed(0)}% / ${formatCompact(contextUsage.contextWindow)}`
        : `? / ${formatCompact(contextUsage.contextWindow)}`;
      mobileContextText = percent !== null ? `${percent.toFixed(0)}%` : null;
    }

    const tooltipParts: string[] = [];
    if (tokens) {
      tooltipParts.push(`${translate("session.input")}: ${tokens.input.toLocaleString(locale)}`);
      tooltipParts.push(`${translate("session.output")}: ${tokens.output.toLocaleString(locale)}`);
      tooltipParts.push(`${translate("session.cacheRead")}: ${tokens.cacheRead.toLocaleString(locale)}`);
      tooltipParts.push(`${translate("session.cacheWrite")}: ${tokens.cacheWrite.toLocaleString(locale)}`);
      if (cost > 0) tooltipParts.push(`${translate("session.cost")}: $${cost.toFixed(4)}`);
    }
    if (contextUsage?.contextWindow) {
      const percent = contextUsage.percent;
      tooltipParts.push(`${translate("session.context")}: ${percent !== null ? `${percent.toFixed(1)}%` : "?"} / ${contextUsage.contextWindow.toLocaleString(locale)}`);
    }
    const tooltip = tooltipParts.join("  |  ");
    const hasMobileValues = Boolean(
      (tokens && (tokens.input > 0 || tokens.output > 0))
      || costText
      || mobileContextText,
    );

    return (
      <button
        type="button"
        onClick={() => toggleTopPanel("session")}
        disabled={!showChat}
        title={tooltip || translate("session.title")}
        aria-label={translate("session.title")}
        aria-pressed={activeTopPanel === "session"}
        className={mobile ? "mobile-session-stats app-stats-trigger" : "app-stats-trigger"}
        data-mobile-toolbar-stats={mobile ? "true" : undefined}
        style={{
          // The Debug button before it takes the free space (renderDebugButton).
          marginLeft: 0,
          display: "flex", alignItems: "center", justifyContent: "flex-end",
          flex: mobile ? 1 : undefined,
          flexShrink: mobile ? 1 : 0,
          minWidth: mobile ? 0 : "auto",
          gap: mobile ? 7 : 10,
          paddingLeft: mobile ? 6 : 12,
          paddingRight: mobile ? 6 : 12,
          height: "100%",
          overflow: "hidden",
          background: activeTopPanel === "session" ? "var(--bg-selected)" : "none",
          border: "none",
          borderTop: activeTopPanel === "session" ? "2px solid var(--accent)" : "2px solid transparent",
          fontSize: 11, color: "var(--text-muted)",
          whiteSpace: "nowrap", cursor: showChat ? "pointer" : "default",
          fontVariantNumeric: "tabular-nums",
          transition: "color 0.1s, background 0.1s",
        }}
        onMouseEnter={(event) => {
          if (showChat) event.currentTarget.style.color = "var(--text)";
        }}
        onMouseLeave={(event) => {
          event.currentTarget.style.color = activeTopPanel === "session" ? "var(--text)" : "var(--text-muted)";
        }}
      >
        {mobile ? (
          <>
            {tokens && tokens.input > 0 && (
              <span className="mobile-session-stat-io" style={{ display: "flex", alignItems: "center", gap: 2, flexShrink: 0 }}>
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <line x1="5" y1="8.5" x2="5" y2="1.5" /><polyline points="2 4 5 1.5 8 4" />
                </svg>
                {formatCompact(tokens.input)}
              </span>
            )}
            {tokens && tokens.output > 0 && (
              <span className="mobile-session-stat-io" style={{ display: "flex", alignItems: "center", gap: 2, flexShrink: 0 }}>
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <line x1="5" y1="1.5" x2="5" y2="8.5" /><polyline points="2 6 5 8.5 8 6" />
                </svg>
                {formatCompact(tokens.output)}
              </span>
            )}
            {costText && (
              <span className="mobile-session-stat-cost" style={{ color: "var(--text)", fontWeight: 500, flexShrink: 0 }}>
                {costText}
              </span>
            )}
            {mobileContextText && (
              <span style={{ color: contextColor, flexShrink: 0 }}>
                {mobileContextText}
              </span>
            )}
            {!hasMobileValues && showChat && (
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", color: "var(--text-dim)" }}>
                {translate("session.title")}
              </span>
            )}
          </>
        ) : (
          <>
            {tokens && tokens.input > 0 && (
              <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <svg width="12" height="12" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <line x1="5" y1="8.5" x2="5" y2="1.5" /><polyline points="2 4 5 1.5 8 4" />
                </svg>
                {formatCompact(tokens.input)}
              </span>
            )}
            {tokens && tokens.output > 0 && (
              <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <svg width="12" height="12" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <line x1="5" y1="1.5" x2="5" y2="8.5" /><polyline points="2 6 5 8.5 8 6" />
                </svg>
                {formatCompact(tokens.output)}
              </span>
            )}
            {tokens && tokens.cacheRead > 0 && (
              <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <svg width="12" height="12" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M8.5 5a3.5 3.5 0 1 1-1-2.45" /><polyline points="6.5 1.5 8.5 2.5 7.5 4.5" />
                </svg>
                {formatCompact(tokens.cacheRead)}
              </span>
            )}
            {costText && (
              <span style={{ display: "flex", alignItems: "center", color: "var(--text)", fontWeight: 500 }}>
                {costText}
              </span>
            )}
            {desktopContextText && (
              <span style={{ display: "flex", alignItems: "center", gap: 4, color: contextColor }}>
                <svg width="12" height="12" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M1 9 L1 5 Q1 1 5 1 Q9 1 9 5 L9 9" /><line x1="1" y1="9" x2="9" y2="9" />
                </svg>
                {desktopContextText}
              </span>
            )}
          </>
        )}
      </button>
    );
  };

  // Icon only, right of the chat's actions; on a desktop it takes the bar's free space, so it
  // sits left of the session stats. It only opens or closes its panel: nothing is loaded here.
  const renderDebugButton = (mobile: boolean) => {
    if (!showChat) return null;
    const open = activeTopPanel === "debug";
    return (
      <button
        ref={debugButtonRef}
        type="button"
        onClick={() => toggleTopPanel("debug", mobile)}
        title={translate("debug.title")}
        aria-label={translate("debug.title")}
        aria-pressed={open}
        style={{
          marginLeft: mobile ? 0 : "auto",
          display: "flex", alignItems: "center", justifyContent: "center",
          width: TOP_BAR_ICON_BUTTON_SIZE, height: "100%", padding: 0,
          background: open ? "var(--bg-selected)" : "none",
          border: "none",
          borderTop: open ? "2px solid var(--accent)" : "2px solid transparent",
          ...(mobile ? { borderRight: "1px solid var(--border)" } : { borderLeft: "1px solid var(--border)" }),
          color: open ? "var(--text)" : "var(--text-muted)",
          cursor: "pointer", flexShrink: 0, transition: "color 0.1s, background 0.1s",
        }}
        onMouseEnter={(event) => {
          event.currentTarget.style.color = "var(--text)";
        }}
        onMouseLeave={(event) => {
          event.currentTarget.style.color = open ? "var(--text)" : "var(--text-muted)";
        }}
        data-mobile-toolbar-action={mobile ? "debug" : undefined}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: open ? "var(--accent)" : "var(--text-dim)", flexShrink: 0 }} aria-hidden="true">
          <path d="M8 2l1.9 1.9M16 2l-1.9 1.9M9 7.1v-1a3 3 0 0 1 6 0v1" />
          <path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6zM12 20v-9" />
          <path d="M6.5 9C4.6 8.8 3 7.1 3 5M6 13H2M3 21c0-2.1 1.7-3.9 3.8-4M21 5c0 2.1-1.6 3.8-3.5 4M22 13h-4M17.2 17c2.1.1 3.8 1.9 3.8 4" />
        </svg>
      </button>
    );
  };

  const renderMainFileToggle = (mobile: boolean) => {
    // design/v3：桌面的文件开关是会话头里的一颗 `.cbtn`（画板右侧胶囊里的文件夹）。
    if (!mobile) {
      return (
        <button
          type="button"
          className={`cbtn${rightPanelOpen ? " is-on" : ""}`}
          onClick={handleRightPanelToggle}
          aria-controls="file-panel"
          aria-expanded={rightPanelOpen}
          title={rightPanelOpen ? translate("files.hidePanel") : translate("files.showPanel")}
          aria-label={rightPanelOpen ? translate("files.hidePanel") : translate("files.showPanel")}
        >
          {/* 右栏开关用面板图标（它开关的就是右栏），不是文件夹——文件夹是「文件」页。 */}
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="4" width="18" height="16" rx="2.4" />
            <line x1="14" y1="4" x2="14" y2="20" />
          </svg>
        </button>
      );
    }
    return (
      <button
        type="button"
        onClick={handleRightPanelToggle}
        aria-controls="file-panel"
        aria-expanded={rightPanelOpen}
        title={rightPanelOpen ? translate("files.hidePanel") : translate("files.showPanel")}
        aria-label={rightPanelOpen ? translate("files.hidePanel") : translate("files.showPanel")}
        data-mobile-toolbar-file={mobile ? "true" : undefined}
        className="app-file-trigger"
        style={{
          // With a chat the Debug button is right-aligned instead (renderDebugButton).
          marginLeft: !mobile && !showChat ? "auto" : 0,
          display: "flex", alignItems: "center", justifyContent: "center",
          width: TOP_BAR_ICON_BUTTON_SIZE, height: TOP_BAR_ICON_BUTTON_SIZE, padding: 0,
          background: rightPanelOpen ? "var(--bg-selected)" : "none",
          border: "none",
          color: rightPanelOpen ? "var(--text)" : "var(--text-muted)",
          cursor: "pointer", flexShrink: 0, transition: "color 0.12s, background 0.12s",
        }}
        onMouseEnter={(event) => { event.currentTarget.style.color = "var(--text)"; }}
        onMouseLeave={(event) => { event.currentTarget.style.color = rightPanelOpen ? "var(--text)" : "var(--text-muted)"; }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="3" width="18" height="18" rx="2" /><line x1="15" y1="3" x2="15" y2="21" />
        </svg>
      </button>
    );
  };

  /**
   * The narrow phone's `⋯` sheet (design/v3/boards/pwa-menu.html): one action
   * per row with its own icon and a word, instead of the row of unlabelled
   * 44px squares this used to be.
   */
  const renderMobileToolbarMenu = () => {
    const panelOn = (panel: "agents" | "system" | "tools" | "session" | "debug") => activeTopPanel === panel;
    const hasMessages = Boolean(
      selectedSession
      && ((sessionStats?.userMessages ?? 0) > 0 || selectedSession.messageCount > 0),
    );
    const naming = autoNameStatus.kind === "naming";
    const rows: { key: string; label: string; icon: string; on: boolean; disabled?: boolean; danger?: boolean; onSelect: () => void }[] = [
      {
        key: "history",
        label: translate("history.full"),
        icon: "clock",
        on: false,
        disabled: !selectedSession,
        onSelect: () => handleViewFullHistory(),
      },
      {
        key: "name",
        label: translate("title.generate"),
        icon: naming ? "refresh" : "sparkle",
        on: autoNameStatus.kind === "success",
        disabled: !selectedSession || selectedSession.transient || !hasMessages || naming,
        onSelect: () => { void handleAutoName(); },
      },
    ];
    if (hasSubagentSessions && agentsBadge) {
      rows.push({
        key: "agents",
        label: translate("agentSwitcher.title"),
        icon: "person-2",
        on: panelOn("agents"),
        onSelect: () => toggleTopPanel("agents", false),
      });
    }
    rows.push(
      {
        key: "session",
        label: translate("session.title"),
        icon: "info",
        on: panelOn("session"),
        disabled: !showChat,
        onSelect: () => toggleTopPanel("session", false),
      },
      {
        key: "system",
        label: translate("system.prompt"),
        icon: "doc-text",
        on: panelOn("system"),
        disabled: !showChat,
        onSelect: () => handleSystemInfoToggle("system", false),
      },
      {
        key: "tools",
        label: translate("tools.title"),
        icon: "wrench",
        on: panelOn("tools"),
        disabled: !showChat,
        onSelect: () => handleSystemInfoToggle("tools", false),
      },
      {
        key: "files",
        label: translate(rightPanelOpen ? "files.hidePanel" : "files.showPanel"),
        icon: "folder-fill",
        on: rightPanelOpen,
        onSelect: () => handleRightPanelToggle(),
      },
      {
        key: "debug",
        label: translate("debug.title"),
        icon: "bug",
        on: panelOn("debug"),
        disabled: !showChat,
        onSelect: () => toggleTopPanel("debug", false),
      },
    );
    return (
      <>
        {rows.map((row) => (
          <button
            key={row.key}
            type="button"
            role="menuitem"
            className={`m-menu-row${row.on ? " is-on" : ""}${row.danger ? " is-danger" : ""}`}
            disabled={row.disabled}
            title={row.label}
            onClick={() => {
              setMobileToolbarMoreOpen(false);
              row.onSelect();
            }}
          >
            <Icon name={row.icon} />
            <span className="m-menu-row__label">{row.label}</span>
            {row.on && <Icon name="check" className="m-menu-row__check" />}
          </button>
        ))}
        {extensionUi && (extensionUi.statuses.length > 0 || extensionUi.widgets.length > 0) && (
          <>
            <div className="m-menu-sep" role="separator" />
            <div className="m-menu-ext__head">
              <Icon name="puzzle" />
              <span>{translate("extensionStatus.title")}</span>
            </div>
            {buildExtensionStatusCells(extensionUi.statuses).map((cell, index) => cell.kind === "command" ? (
              <button
                key={index}
                type="button"
                role="menuitem"
                className="m-menu-row m-menu-row--ext is-command"
                disabled={extensionUi.commandsDisabled}
                title={cell.command}
                onClick={() => {
                  setMobileToolbarMoreOpen(false);
                  extensionUi.runCommand(cell.command);
                }}
              >
                <span className="m-menu-row__label">{cell.label}</span>
              </button>
            ) : (
              <div key={index} className="m-menu-row m-menu-row--ext is-static">
                <span className="m-menu-row__label">{cell.text}</span>
              </div>
            ))}
            {extensionUi.widgets.length > 0 && (
              <div className="m-menu-row m-menu-row--ext is-widget">
                <ExtensionWidgets widgets={extensionUi.widgets} />
              </div>
            )}
          </>
        )}
      </>
    );
  };

  return (
    <>
    <style>{`
      @keyframes session-info-pop {
        0% {
          opacity: 0;
          transform: translateY(-24px);
          filter: blur(6px);
          box-shadow: 0 2px 8px rgba(0,0,0,0);
        }
        55% {
          opacity: 1;
          transform: translateY(0);
          filter: blur(0);
          background: color-mix(in srgb, var(--accent) 8%, var(--bg-panel));
          box-shadow: 0 18px 44px rgba(37,99,235,0.16);
        }
        100% {
          opacity: 1;
          transform: translateY(0);
          filter: blur(0);
          background: var(--bg-panel);
          box-shadow: 0 10px 28px rgba(0,0,0,0.10);
        }
      }
      @keyframes session-info-light-wash {
        0% {
          opacity: 0;
          transform: translateX(-110%) skewX(-16deg);
        }
        24% {
          opacity: 0.42;
        }
        100% {
          opacity: 0;
          transform: translateX(115%) skewX(-16deg);
        }
      }
      .session-info-popover {
        position: relative;
        overflow: hidden;
        transform-origin: top right;
        animation: session-info-pop 360ms ease-out both;
        will-change: transform, opacity, filter, background, box-shadow;
      }
      .session-info-popover::after {
        content: "";
        position: absolute;
        top: 0;
        bottom: 0;
        left: 0;
        width: 44%;
        pointer-events: none;
        background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--accent) 24%, transparent), transparent);
        animation: session-info-light-wash 620ms ease-out both;
      }
      @media (prefers-reduced-motion: reduce) {
        .session-info-popover,
        .session-info-popover::after {
          animation: none;
        }
      }
      .mobile-session-stats {
        container-type: inline-size;
      }
      @container (max-width: 158px) {
        .mobile-session-stat-io {
          display: none !important;
        }
      }
      @container (max-width: 88px) {
        .mobile-session-stat-cost {
          display: none !important;
        }
      }
      @media (max-width: 767px) {
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
    <div
      className="app-shell win"
      data-layout={isMobile ? "mobile" : "desktop"}
      data-sidebar-open={sidebarOpen ? "true" : "false"}
      data-right-panel-open={rightPanelOpen ? "true" : "false"}
    >
      {/* Mobile overlay backdrop */}
      <div
        className={`sidebar-overlay-backdrop${mobileSidebarReady ? "" : " sidebar-mobile-pending"}`}
        data-open={sidebarOpen ? "true" : "false"}
        onClick={() => setSidebarOpen(false)}
      />

      {/* Left sidebar */}
      <div
        ref={sidebarResizer.panelRef}
        id="session-sidebar"
        inert={rightPanelFullWidth}
        className={`app-sidebar sidebar-container side${sidebarOpen ? " sidebar-open" : " sidebar-closed"}${mobileSidebarReady ? "" : " sidebar-mobile-pending"}${sidebarResizer.isResizing ? " sidebar-resizing" : ""}`}
        style={{
          "--sidebar-width": `${sidebarResizer.width}px`,
          // Kept inline: the quote toolbar asserts it sits above this value.
          zIndex: 200,
        } as React.CSSProperties}
      >
        {sidebarContent}
      </div>
      {sidebarOpen && (
        <div
          {...sidebarResizer.separatorProps}
          inert={rightPanelFullWidth}
          aria-controls="session-sidebar"
          className={`panel-resize-handle sidebar-resize-handle${sidebarResizer.isResizing ? " is-resizing" : ""}`}
          data-resize-handle="sidebar"
          title={`${translate("layout.resizeSidebar")}: ${translate("layout.resizeHint")}`}
        />
      )}

      {/* Center: chat */}
      <div className="app-main detail" inert={rightPanelFullWidth}>
        {/* Top bar with sidebar toggle */}
        <div ref={topBarRef} className="app-topbar">
        <div className={`app-topbar-row chrome${isMobile ? " m-top" : ""}`}>
          {/* 画板 design/v3/boards/pwa-running.html 的 `.m-top`：44 高、左右 10 内边距、
              间距 10，左一颗 34 圆（返回）· 中间标题 + 副行 · 右一颗 34 圆（更多）。
              手机走这一支；桌面仍是 web-running.html 帧 A / 帧 B 的 `.chrome` 分段。
              画板的左钮是「返回会话列表」，产品里对应抽屉开关，图标留产品自己的
              （hamburger / panel），因为它描述的是「打开会话抽屉」而不是回上一页。 */}
          {/* 画板 design/v3/boards/web-running.html 帧 A / 帧 B 的顶栏，左起：
              侧栏开关（帧 B 的 `.ccap--text` 胶囊：面板图标 + ⌘B）· `.cbtn` 新建会话 ·
              `.ccap--text` 分支胶囊 · `h1.chrome__title` · `.chrome__right`。
              画板帧 A 里侧栏是开的，没画这颗开关；产品桌面收起侧栏只有这一个入口，
              所以两帧都留着，摆成帧 B 的形状（收起/展开同一颗，title 换文案）。
              画板里新建会话后面还有一颗「权限：受监督」，产品没有权限模式，不渲染。 */}
          {isMobile ? (
            <button
              onClick={handleSidebarToggle}
              title={sidebarOpen ? translate("sidebar.hide") : translate("sidebar.show")}
              aria-label={sidebarOpen ? translate("sidebar.hide") : translate("sidebar.show")}
              className="app-chrome-button cbtn app-chrome-button--sidebar"
            >
              {sidebarOpen ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2" /><line x1="9" y1="3" x2="9" y2="21" />
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" />
                </svg>
              )}
            </button>
          ) : (
            <>
              <button
                type="button"
                className="ccap ccap--text app-chrome-sidebar"
                onClick={handleSidebarToggle}
                title={sidebarOpen ? translate("sidebar.hide") : translate("sidebar.show")}
                aria-label={sidebarOpen ? translate("sidebar.hide") : translate("sidebar.show")}
                aria-controls="session-sidebar"
                aria-expanded={sidebarOpen}
              >
                {/* 图标 sprite 里没有 panel-left，这两笔按画板的 #i-panel-left 手绘（同一几何）。 */}
                <svg className="ic" viewBox="0 0 24 24" aria-hidden="true">
                  <rect x="3" y="4.4" width="18" height="15.2" rx="3.2" />
                  <path d="M9.8 4.4v15.2" />
                </svg>
              </button>
            </>
          )}
          {!isMobile && (
            <>
              {/* 分支胶囊：有分叉时是可点的胶囊（开产品原有的分支浮层）；没有分叉时
                  什么都不画——一颗点了没反应的胶囊只是在骗人。 */}
              {selectedSession && sessionHasBranches && (
                <button
                  type="button"
                  className="ccap ccap--text"
                  onClick={() => toggleTopPanel("branches", false)}
                  title={translate("i18n.branches")}
                  aria-label={translate("i18n.branches")}
                  aria-expanded={activeTopPanel === "branches"}
                >
                  <Icon name="branch" />
                  <span className="trunc">{selectedSession.branch || getFileName(selectedSession.cwd) || translate("sidebar.tabSessions")}</span>
                  <Icon name="chevron-down" className="chev" />
                </button>
              )}
              {/* 分支浮层仍由 BranchNavigator 供给（产品原有的树、锁定态都在里面），
                  触发器换成上面那枚胶囊，所以它自己那颗钮藏起来。 */}
              {sessionHasBranches && (
                <BranchNavigator
                  tree={branchTree}
                  activeLeafId={branchActiveLeafId}
                  onLeafChange={handleBranchLeafChange}
                  locked={branchSwitchLocked}
                  inline
                  hideInlineButton
                  containerRef={topBarRef}
                  open={activeTopPanel === "branches"}
                  onToggle={() => toggleTopPanel("branches", false)}
                  hasSession
                />
              )}
              <h1 className="chrome__title" title={selectedSession?.name || selectedSession?.firstMessage}>
                {selectedSession
                  ? selectedSession.name || selectedSession.firstMessage || translate("workspace.selectSession")
                  : translate("workspace.getStarted")}
              </h1>
            </>
          )}
          {isMobile && (
            <div
              ref={mobileToolbarRef}
              data-mobile-toolbar="true"
                  className="app-mobile-toolbar"
                >
              {/* 画板 .m-top 的中间栏：会话名 + 运行中的一条副标题。 */}
              <div className="m-top__title">
                <b>
                  {selectedSession
                    ? selectedSession.name || selectedSession.firstMessage || translate("workspace.selectSession")
                    : translate("workspace.getStarted")}
                </b>
                {selectedSession && runningSessionIds.has(selectedSession.id) && (
                  <span className="m-top__sub">
                    <Spin variant="mini" />
                    <span>{translate("sidebar.agentRunning")}</span>
                  </span>
                )}
              </div>
              {/* 390 宽（画板那一档）：两侧只剩画板的「返回 · 标题 · 更多」。
                  统计 / 文件是产品真实入口，不删——挪进「更多」那层面板里。 */}
              {!isNarrowMobile && renderChatToolbarActions(true)}
              {!isNarrowMobile && renderDebugButton(true)}
              {!isNarrowMobile && renderSessionStatsButton(true)}
              {!isNarrowMobile && renderMainFileToggle(true)}
              {isNarrowMobile && (
                <button
                  type="button"
                  className="cbtn app-mobile-toolbar-more"
                  onClick={handleMobileToolbarMoreToggle}
                  title={moreControlsLabel}
                  aria-label={moreControlsLabel}
                  aria-controls="mobile-toolbar-actions"
                  aria-expanded={mobileToolbarMoreOpen}
                  data-mobile-toolbar-more="true"
                  style={{ position: "relative", zIndex: mobileToolbarMoreOpen ? 21 : undefined }}
                >
                  <Icon name={mobileToolbarMoreOpen ? "xmark" : "ellipsis"} />
                  {foldedMoreAgentsBadge && renderAgentsBadge(foldedMoreAgentsBadge, true)}
                </button>
              )}
              {isNarrowMobile && mobileToolbarMoreOpen && (
                <div
                  id="mobile-toolbar-actions"
                  role="menu"
                  aria-label={translate("chat.moreControls")}
                  data-mobile-toolbar-actions="true"
                  className="app-mobile-toolbar-actions"
                >
                  {/* 手机上这层是画板 pwa-menu 的 action sheet：一行一个带文字的动作，
                      不再是几颗只有图标的 44 方块（截图里那几个图标根本认不出是什么）。 */}
                  {renderMobileToolbarMenu()}
                </div>
              )}
            </div>
          )}
          {!isMobile && (
            <>
              {renderProjectTrustWarning(false)}
              {/* 会话信息钮已拆：token / 费用 / 占用现在在输入区的上下文浮窗里（画板底栏的 .ring）。 */}
              {renderChatToolbarActions(false)}
            </>
          )}
          {isMobile && sessionHasBranches && (
            <BranchNavigator
              tree={branchTree}
              activeLeafId={branchActiveLeafId}
              onLeafChange={handleBranchLeafChange}
              locked={branchSwitchLocked}
              inline
              compact
              containerRef={topBarRef}
              open={activeTopPanel === "branches"}
              onToggle={() => toggleTopPanel("branches")}
              hasSession={showChat}
              hideInlineButton
            />
          )}
          {/* Top panel dropdown — shared, only one active at a time */}
          {activeTopPanel && topPanelPos && (
            <div style={{
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
                  openSubagentTabIds={openSubagentTabIds}
                  onToggleSubagentTab={handleToggleSubagentTab}
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
              {activeTopPanel === "session" && (
                <div className="session-info-popover" style={{
                  background: "var(--bg-panel)",
                  borderBottom: "1px solid var(--border)",
                  boxShadow: "0 10px 28px rgba(0,0,0,0.10)",
                  padding: "12px 16px",
                }}>
                  {sessionStats ? (() => {
                    const totalActiveMs = sessionStats.totalActiveMs ?? 0;
                    const ws = selectedSession;
                    const sessionRows = [
                       ...(sessionStats.sessionName ? [{ label: translate("session.name"), value: sessionStats.sessionName, copyField: null }] : []),
                       { label: translate("session.file"), value: sessionStats.sessionFile ?? translate("session.inMemory"), copyField: "file" as const },
                       { label: translate("session.id"), value: sessionStats.sessionId, copyField: "id" as const },
                       ...(totalActiveMs > 0 ? [{ label: translate("session.totalActive"), value: formatActiveDuration(totalActiveMs), copyField: null }] : []),
                    ];
                    const projectRows = [
                      ...(ws ? [{ label: translate("session.projectDir"), value: ws.projectRoot ?? ws.cwd, copyField: "projectDir" as const }] : []),
                      ...(ws?.branch ? [{ label: translate("session.gitBranch"), value: ws.branch, copyField: "gitBranch" as const }] : []),
                      ...(ws?.isWorktree ? [{ label: translate("session.gitWorktree"), value: ws.cwd, copyField: "gitWorktree" as const }] : []),
                    ];
                    const messageRows = [
                       [translate("session.user"), sessionStats.userMessages.toLocaleString(locale)],
                       [translate("session.assistant"), sessionStats.assistantMessages.toLocaleString(locale)],
                       [translate("session.toolCalls"), sessionStats.toolCalls.toLocaleString(locale)],
                       [translate("session.toolResults"), sessionStats.toolResults.toLocaleString(locale)],
                       [translate("session.total"), sessionStats.totalMessages.toLocaleString(locale)],
                    ];
                    const tokenRows = [
                       [translate("session.input"), sessionStats.tokens.input.toLocaleString(locale)],
                       [translate("session.output"), sessionStats.tokens.output.toLocaleString(locale)],
                       ...(sessionStats.tokens.cacheRead > 0 ? [[translate("session.cacheRead"), sessionStats.tokens.cacheRead.toLocaleString(locale)]] : []),
                       ...(sessionStats.tokens.cacheWrite > 0 ? [[translate("session.cacheWrite"), sessionStats.tokens.cacheWrite.toLocaleString(locale)]] : []),
                       [translate("session.total"), sessionStats.tokens.total.toLocaleString(locale)],
                    ];
                    const ctx = contextUsage ?? sessionStats.contextUsage;
                    const extraTokenRows = [
                       ...(sessionStats.cost > 0 ? [[translate("session.cost"), `$${sessionStats.cost.toFixed(4)}`]] : []),
                       ...(ctx?.contextWindow ? [[translate("session.context"), `${ctx.percent !== null ? `${ctx.percent.toFixed(1)}%` : "?"} / ${formatCompactCount(ctx.contextWindow)}`]] : []),
                       // Cache hit rate = cache reads / (input + cache writes + cache reads) — the denominator covers all input-class tokens.
                       ...(sessionStats.tokens.cacheRead + sessionStats.tokens.cacheWrite > 0 && sessionStats.tokens.cacheRead + sessionStats.tokens.cacheWrite + sessionStats.tokens.input > 0
                         ? [[translate("session.cacheHitRate"), `${(sessionStats.tokens.cacheRead / (sessionStats.tokens.cacheRead + sessionStats.tokens.cacheWrite + sessionStats.tokens.input) * 100).toFixed(1)}%`]]
                         : []),
                    ];
                    const section = (
                      title: string,
                      sectionRows: string[][],
                      valueAlign: "left" | "right" = "left",
                      compact = false,
                    ) => (
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text)", marginBottom: 6 }}>{title}</div>
                          <div style={{
                            display: "grid",
                            gridTemplateColumns: compact ? "max-content max-content" : "auto minmax(0, 1fr)",
                            columnGap: compact ? 14 : 12,
                            rowGap: 4,
                            justifyContent: compact ? "start" : undefined,
                          }}>
                            {sectionRows.map(([label, value]) => (
                              <div key={`${title}:${label}`} style={{ display: "contents" }}>
                                <div style={{ color: "var(--text-dim)", whiteSpace: "nowrap" }}>{label}</div>
                                <div style={{
                                  color: "var(--text-muted)",
                                  minWidth: 0,
                                  overflowWrap: compact ? "normal" : "anywhere",
                                  textAlign: valueAlign,
                                  whiteSpace: valueAlign === "right" ? "nowrap" : "normal",
                                }}>{value}</div>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    const copyTitleKey: Record<SessionCopyField, string> = {
                      file: "session.copyFile",
                      id: "session.copyId",
                      projectDir: "session.copyProjectDir",
                      gitBranch: "session.copyGitBranch",
                      gitWorktree: "session.copyGitWorktree",
                    };
                    const copyButton = (field: SessionCopyField, value: string) => {
                      const copied = copiedSessionField === field;
                      return (
                        <button
                          type="button"
                          title={copied ? translate("session.copied") : translate(copyTitleKey[field])}
                          onClick={() => handleCopySessionField(field, value)}
                          style={{
                            alignSelf: "start",
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            width: 22,
                            height: 22,
                            marginTop: -2,
                            color: copied ? "var(--accent)" : "var(--text-dim)",
                            background: "transparent",
                            border: "1px solid var(--border)",
                            borderRadius: 4,
                            cursor: "pointer",
                            flex: "0 0 auto",
                            transition: "color 0.12s, border-color 0.12s, background 0.12s",
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.color = "var(--accent)";
                            e.currentTarget.style.borderColor = "var(--accent)";
                            e.currentTarget.style.background = "var(--bg-hover)";
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.color = copied ? "var(--accent)" : "var(--text-dim)";
                            e.currentTarget.style.borderColor = "var(--border)";
                            e.currentTarget.style.background = "transparent";
                          }}
                        >
                          {copied ? (
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          ) : (
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                            </svg>
                          )}
                        </button>
                      );
                    };
                    const sessionInfoSection = (
                      <div style={{ minWidth: 0 }}>
                         <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text)", marginBottom: 6 }}>{translate("session.infoSection")}</div>
                        <div style={{ display: "grid", gridTemplateColumns: "auto minmax(0, 1fr) auto", columnGap: 12, rowGap: 8, alignItems: "start" }}>
                          {sessionRows.map((row) => (
                            <div key={`session-info:${row.label}`} style={{ display: "contents" }}>
                              <div style={{ color: "var(--text-dim)", whiteSpace: "nowrap" }}>{row.label}</div>
                              <div style={{
                                color: "var(--text-muted)",
                                minWidth: 0,
                                overflowWrap: "anywhere",
                                wordBreak: "break-word",
                                whiteSpace: "normal",
                              }}>{row.value}</div>
                              <div>{row.copyField ? copyButton(row.copyField, row.value) : null}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                    const projectInfoSection = projectRows.length > 0 ? (
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text)", marginBottom: 6 }}>{translate("session.projectSection")}</div>
                        <div style={{ display: "grid", gridTemplateColumns: "auto minmax(0, 1fr) auto", columnGap: 12, rowGap: 8, alignItems: "start" }}>
                          {projectRows.map((row) => (
                            <div key={`project-info:${row.label}`} style={{ display: "contents" }}>
                              <div style={{ color: "var(--text-dim)", whiteSpace: "nowrap" }}>{row.label}</div>
                              <div style={{
                                color: "var(--text-muted)",
                                minWidth: 0,
                                overflowWrap: "anywhere",
                                wordBreak: "break-word",
                                whiteSpace: "normal",
                              }}>{row.value}</div>
                              <div>{row.copyField ? copyButton(row.copyField, row.value) : null}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null;

                    return (
                      <div style={{
                        display: "grid",
                        gridTemplateColumns: isMobile
                          ? "1fr"
                          : "minmax(360px, 1.7fr) minmax(140px, 0.55fr) minmax(190px, 0.75fr)",
                        gap: isMobile ? 16 : 24,
                        fontSize: 12,
                        lineHeight: 1.5,
                        fontFamily: "var(--font-mono)",
                      }}>
                        <div style={{ display: "flex", flexDirection: "column", gap: isMobile ? 16 : 20 }}>
                          {sessionInfoSection}
                          {projectInfoSection}
                        </div>
                         {section(translate("session.messages"), messageRows)}
                         {section(translate("session.tokens"), [...tokenRows, ...extraTokenRows], "right", true)}
                      </div>
                    );
                  })() : (
                    <div style={{ fontSize: 12, color: "var(--text-muted)", fontStyle: "italic" }}>
                       {translate("session.load")}
                    </div>
                  )}
                </div>
              )}
              {activeTopPanel === "debug" && (
                <DebugPanelBoundary fallback={translate("debug.failed")}>
                  <DebugPanel
                    readerRef={debugSnapshotReaderRef}
                    selectedSessionId={selectedSession?.id ?? null}
                    sessions={sessionsWithSelection}
                    onClose={closeDebugPanel}
                  />
                </DebugPanelBoundary>
              )}
            </div>
          )}

        </div>
        {isMobile && renderProjectTrustWarning(true)}
        </div>

        {/* Chat content */}
        <div className="app-content">
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
              newSessionContextBar={newSessionContextBar}
              initialNewSessionChoices={selectedSession === null ? carriedNewSessionChoices : null}
              onNewSessionChoicesChange={handleNewSessionChoicesChange}
              onAgentEnd={handleAgentEnd}
              onToolEnd={handleToolEnd}
              onAttentionNeeded={handleAttentionNeeded}
              onSessionCreated={handleSessionCreated}
              onSessionForked={handleSessionForked}
              modelsRefreshKey={modelsRefreshKey}
              chatInputRef={chatInputRef}
              onBranchDataChange={handleBranchDataChange}
              onSystemPromptChange={handleSystemPromptChange}
              onSystemToolsChange={handleSystemToolsChange}
              onSystemInfoLoaderChange={handleSystemInfoLoaderChange}
              onDebugSnapshotReaderChange={handleDebugSnapshotReaderChange}
              onSessionStatsChange={handleSessionStatsChange}
              onSessionStatsPanelOpen={openSessionStatsPanel}
              onOpenSettings={openSettingsSection}
              onContextUsageChange={handleContextUsageChange}
              onOpenFile={handleOpenLinkedFile}
              onFilesUploaded={handleExplorerRefresh}
              onOpenSubagent={handleOpenSubagentTab}
              onAskInNewChat={handleAskInNewChat}
              quoteSelectionEnabled={quoteSelectionEnabled}
              initialPrompt={pendingQuotePrompt?.sessionId === selectedSession?.id ? pendingQuotePrompt?.text : undefined}
              onInitialPromptConsumed={() => setPendingQuotePrompt(null)}
              soundEnabled={soundEnabled}
              onSoundToggle={onSoundToggle}
              onExtensionStatusChange={onExtensionStatusChange}
              playDoneSound={playDoneSound}
              unlockAudio={unlockAudio}
              holdAudio={holdAudio}
            />
          ) : initialCwdStatus === "validating" ? (
            <div
              role="status"
              style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, padding: 24, color: "var(--text-muted)", textAlign: "center" }}
            >
               <div style={{ fontSize: 14, color: "var(--text)" }}>{translate("workspace.opening")}</div>
              <div style={{ maxWidth: "min(720px, 100%)", overflowWrap: "anywhere", fontFamily: "var(--font-mono)", fontSize: 12 }}>
                {initialNavigation.requestedCwd}
              </div>
            </div>
          ) : initialCwdStatus === "error" ? (
            <div
              role="alert"
              style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, padding: 24, color: "var(--text-muted)", textAlign: "center" }}
            >
               <div style={{ fontSize: 14, color: "#dc2626" }}>{translate("workspace.unable")}</div>
              <div style={{ maxWidth: "min(720px, 100%)", overflowWrap: "anywhere", fontFamily: "var(--font-mono)", fontSize: 12 }}>
                {initialNavigation.requestedCwd}
              </div>
              <div style={{ maxWidth: 720, fontSize: 12 }}>{initialCwdError}</div>
            </div>
          ) : showPlaceholder ? (
            activeCwd ? (
              <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: 15 }}>
                 {translate("workspace.selectSession")}
              </div>
            ) : (
              <div style={{ position: "absolute", top: 12, left: 12, display: "flex", alignItems: "flex-start", gap: 8, userSelect: "none", pointerEvents: "none" }}>
                <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.7, flexShrink: 0 }}>
                  <line x1="20" y1="12" x2="4" y2="12" /><polyline points="10 6 4 12 10 18" />
                </svg>
                <div>
                   <div style={{ fontSize: 18, fontWeight: 600, color: "var(--text)", marginBottom: 8 }}>{translate("workspace.getStarted")}</div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.8 }}>
                     <span style={{ color: "var(--text-dim)", marginRight: 6 }}>1.</span>{translate("workspace.selectProject")}<br />
                     <span style={{ color: "var(--text-dim)", marginRight: 6 }}>2.</span>{translate("workspace.addModels")}
                  </div>
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
          inert={rightPanelFullWidth}
          aria-controls="file-panel"
          className={`panel-resize-handle right-panel-resize-handle${rightPanelResizer.isResizing ? " is-resizing" : ""}`}
          data-resize-handle="right-panel"
          title={`${translate("layout.resizeFilePanel")}: ${translate("layout.resizeHint")}`}
        />
      )}

      {/* Right panel: file viewer — always mounted, width animated via CSS */}
      <div
        ref={rightPanelResizer.panelRef}
        id="file-panel"
        className={`app-right-panel right-panel-container${rightPanelOpen ? " right-panel-open" : " right-panel-closed"}${rightPanelFullWidth ? " right-panel-full-width" : ""}${rightPanelResizer.isResizing ? " right-panel-resizing" : ""}`}
        style={{
          "--right-panel-width": `${rightPanelResizer.width}px`,
        } as React.CSSProperties}
      >
        <div className={`panel-split${panelHasContent ? "" : " is-tree-only"}`}>
        <div className="panel-viewer">
        {/* 右栏头照 fastvibe 的 `data-side-pane-header`：左边一颗「+」开新页，
            中间一列圆角页签，右边是展开 / 收起。 */}
        <div className="app-panel-toolbar side-pane-header">
          {/* 参考桌面端右栏的「+」：文件树 / 终端 / 变更 / 系统文件夹，一处挑要开的页。 */}
          <div className="panel-add" ref={panelAddRef}>
            <button
              type="button"
              className="panel-add-button"
              onClick={() => setPanelAddOpen((open) => !open)}
              aria-haspopup="menu"
              aria-expanded={panelAddOpen}
              aria-controls="panel-add-menu"
              title={translate("chat.moreControls")}
              aria-label={translate("chat.moreControls")}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden="true">
                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>
            {panelAddOpen && (
              <div id="panel-add-menu" role="menu" aria-label={translate("chat.moreControls")} className="panel-add-menu">
                {/* 顺序照 fastvibe 的「+」：文件 · 审查 · 终端，然后才是系统动作。
                    文件 / 审查 / 终端都开成页签（同一个会话只开一个）。 */}
                <button
                  type="button"
                  role="menuitem"
                  className="chrome-more-row"
                  onClick={() => { setPanelAddOpen(false); openFilesPane(); }}
                  disabled={!activeCwd}
                >
                  <Icon name="folder-fill" />
                  <span>{translate("files.paneTitle")}</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="chrome-more-row"
                  onClick={() => { setPanelAddOpen(false); openReviewPane(); }}
                  disabled={!activeCwd}
                >
                  <Icon name="plusminus" />
                  <span>{translate("changes.title")}</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="chrome-more-row"
                  onClick={() => { setPanelAddOpen(false); if (activeCwd) handleOpenTerminal(activeCwd); }}
                  disabled={!activeCwd}
                >
                  <Icon name="terminal" />
                  <span>{translate("terminal.open")}</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="chrome-more-row"
                  onClick={() => { setPanelAddOpen(false); openAgentsPane(); }}
                  disabled={!activeCwd}
                >
                  <Icon name="person-2" />
                  <span>{translate("sidebar.agents")}</span>
                </button>
              </div>
            )}
          </div>
          <div className="side-pane-tabs">
            <TabBar
              tabs={panelTabs}
              activeTabId={activeFileTabId ?? ""}
              onSelectTab={setActiveFileTabId}
              onCloseTab={handleCloseFileTab}
              onCloseOthers={handleCloseOtherTabs}
              onCloseAll={handleCloseAllTabs}
            />
          </div>
          {!isMobile && isFilesPaneFace && panelHasContent && (
            <button
              type="button"
              className={`app-chrome-button${fileTreeOpen ? " is-on" : ""}`}
              onClick={() => setFileTreeOpen((open) => !open)}
              aria-controls="file-tree-panel"
              aria-pressed={fileTreeOpen}
              title={translate(fileTreeOpen ? "files.hideTree" : "files.showTree")}
              aria-label={translate(fileTreeOpen ? "files.hideTree" : "files.showTree")}
            >
              <Icon name="folder-fill" />
            </button>
          )}
          <button
            type="button"
            className="file-panel-expand-button"
            onClick={handleRightPanelExpandToggle}
            aria-controls="file-panel"
            aria-pressed={rightPanelFullWidth}
            title={translate(rightPanelFullWidth ? "files.restorePanelWidth" : "files.expandPanel")}
            aria-label={translate(rightPanelFullWidth ? "files.restorePanelWidth" : "files.expandPanel")}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d={rightPanelFullWidth
                ? "M9 3v6H3m12-6v6h6M9 21v-6H3m12 6v-6h6M3 3l6 6m12-6-6 6M3 21l6-6m12 6-6-6"
                : "M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M3 3l6 6m12-6-6 6M3 21l6-6m12 6-6-6"} />
            </svg>
          </button>
          <button
            type="button"
            className="app-chrome-button app-panel-close"
            onClick={() => setRightPanelOpen(false)}
            aria-controls="file-panel"
            aria-expanded={rightPanelOpen}
            title={translate("files.hidePanel")}
            aria-label={translate("files.hidePanel")}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="3" width="18" height="18" rx="2" /><line x1="15" y1="3" x2="15" y2="21" />
            </svg>
          </button>
        </div>

        {/* Only the active viewer is mounted. Lightweight per-tab state is restored on activation. */}
        <div className="app-panel-body" style={{ flex: 1, minHeight: 0, overflow: "hidden", paddingBottom: "env(safe-area-inset-bottom)" }}>
          {activePaneTab?.kind === "agents" ? (
            <div className="panel-agents">
              {activeSessionFamily && activeSessionFamily.subagents.length > 0 ? (
                activeSessionFamily.subagents.map((agent) => {
                  const running = runningSessionIds.has(agent.id);
                  const label = agent.name
                    || (agent.relation?.kind === "subagent" ? agent.relation.description : "")
                    || agent.id.slice(0, 8);
                  return (
                    <button
                      key={agent.id}
                      type="button"
                      className="panel-agent-row"
                      onClick={() => handleOpenSubagentTab(agent.id, label)}
                    >
                      <span className={`panel-agent-dot${running ? " is-running" : ""}`} aria-hidden="true" />
                      <span className="panel-agent-label" title={label}>{label}</span>
                      <span className="panel-agent-meta">{running ? translate("sidebar.agentRunning") : ""}</span>
                    </button>
                  );
                })
              ) : (
                <div className="side-pane-empty__inner" style={{ padding: "32px 16px" }}>
                  <p>{translate("files.noSubagents")}</p>
                </div>
              )}
            </div>
          ) : activePaneTab?.kind === "review" && activeCwd ? (
            <div className="panel-review">
              <ChangesPanel
                cwd={activeCwd}
                onClose={() => handleCloseFileTab("pane:review")}
                onOpenFile={handleOpenFile}
                inline
              />
            </div>
          ) : activeFileTab?.filePath ? (
            <FileViewer
              key={`${fileWorkspaceGeneration}:${activeFileTab.id}:${activeFileTab.viewerRevision ?? 0}`}
              filePath={activeFileTab.filePath}
              cwd={activeCwd ?? undefined}
              sourceSessionId={activeFileTab.sourceSessionId}
              gitRefreshKey={explorerRefreshKey}
              initialDisplayMode={activeFileTab.initialDisplayMode}
              initialPage={activeFileTab.page}
              initialState={activeFileTab.viewerState}
              watchEnabled={rightPanelOpen}
              onStateChange={(viewerState) => handleFileViewerStateChange(
                fileWorkspaceGeneration,
                activeFileTab.id,
                activeFileTab.viewerRevision ?? 0,
                viewerState,
              )}
              onMentionLines={rightPanelOpen ? handleFileLineMention : undefined}
              onAtMention={handleAtMention}
              onOpenFile={(filePath, page) => handleOpenFile(
                filePath,
                getFileName(filePath),
                { sourceSessionId: activeFileTab.sourceSessionId, page },
              )}
            />
          ) : !terminalTabs.some((tab) => tab.id === activeFileTabId) && !activeAgentTab ? (
            /* 空态照 fastvibe 的 `side-pane-open-tab-shell`：一句话 + 一列大卡。 */
            <div className="side-pane-empty">
              <div className="side-pane-empty__inner">
                <h2>{translate("files.openTabs")}</h2>
                <p>{translate("files.openTabsDesc")}</p>
                <div className="side-pane-empty__list">
                  <button type="button" className="side-pane-empty__card" onClick={openFilesPane} disabled={!activeCwd}>
                    <Icon name="folder-fill" />
                    <span>{translate("files.paneTitle")}</span>
                  </button>
                  <button type="button" className="side-pane-empty__card" onClick={openReviewPane} disabled={!activeCwd}>
                    <Icon name="plusminus" />
                    <span>{translate("changes.title")}</span>
                  </button>
                  <button type="button" className="side-pane-empty__card" onClick={() => activeCwd && handleOpenTerminal(activeCwd)} disabled={!activeCwd}>
                    <Icon name="terminal" />
                    <span>{translate("terminal.open")}</span>
                  </button>
                  <button type="button" className="side-pane-empty__card" onClick={openAgentsPane} disabled={!activeCwd}>
                    <Icon name="person-2" />
                    <span>{translate("sidebar.agents")}</span>
                  </button>
                </div>
              </div>
            </div>
          ) : null}
          {terminalTabs.map((tab) => (
            <div key={tab.id} hidden={tab.id !== activeFileTabId} style={{ width: "100%", height: "100%" }}>
              <TerminalPanel
                tab={tab}
                active={rightPanelOpen && tab.id === activeFileTabId}
                onRestart={() => setTerminalTabs((tabs) => tabs.map((item) => item.id === tab.id ? { ...item, closing: "restart" } : item))}
                onClosed={() => handleTerminalClosed(tab)}
                onCloseError={() => setTerminalTabs((tabs) => tabs.map((item) => item.id === tab.id ? { ...item, closing: undefined } : item))}
              />
            </div>
          ))}
          {activeAgentTab && (
            <SubagentViewer
              key={activeAgentTab.sessionId}
              sessionId={activeAgentTab.sessionId}
              fallbackLabel={activeAgentTab.label}
              running={runningSessionIds.has(activeAgentTab.sessionId)}
              onOpenFile={handleOpenLinkedFile}
            />
          )}
        </div>
        </div>
        {/* 19-filetree / web-files 帧 A：文件树是右侧的一栅，在查看器右边（桌面）。
            手机上仍是抽屉里的文件页（画板 pwa-files 的 sheet）。
            面板关着就不挂载：树的 /api/files 与 /api/git/status 很贵，不能为看不见的栏付钱。 */}
        {rightPanelOpen && showFileTree && (!isMobile || !activeFileTab?.filePath) && (newSessionCwd ?? selectedSession?.cwd ?? activeCwd) && (
          <aside id="file-tree-panel" className="filetree filetree-panel">
            <FileExplorer
              ref={fileTreeRef}
              cwd={(newSessionCwd ?? selectedSession?.cwd ?? activeCwd) as string}
              onOpenFile={(filePath, fileName, options) => handleOpenFile(filePath, fileName, options)}
              refreshKey={explorerRefreshKey}
              onAtMention={handleAtMention}
              changesCollapsed
              fileSearchOpen={treeSearchOpen}
              onFileSearchOpenChange={setTreeSearchOpen}
              showHidden={treeShowIgnored}
              activePath={activeFileTab?.filePath ?? null}
              headExtra={(
                <>
                  <button
                    type="button"
                    className="cbtn cbtn--sm"
                    title={translate("sidebar.searchFiles")}
                    aria-label={translate("sidebar.searchFiles")}
                    aria-pressed={treeSearchOpen}
                    onClick={() => setTreeSearchOpen((open) => !open)}
                  >
                    <Icon name="search" />
                  </button>
                  <button
                    type="button"
                    className="cbtn cbtn--sm"
                    title={translate("sidebar.showIgnoredFiles")}
                    aria-label={translate("sidebar.showIgnoredFiles")}
                    aria-pressed={treeShowIgnored}
                    onClick={() => setTreeShowIgnored((shown) => !shown)}
                  >
                    <Icon name="eye" />
                  </button>
                  <button
                    type="button"
                    className="cbtn cbtn--sm"
                    onClick={handleChromeOpenInExplorer}
                    disabled={!activeCwd || fileManager?.supported === false}
                    title={fileManager?.supported === false
                      ? translate(fileManager.reason === "remote" ? "sidebar.openInExplorerRemoteOnly" : "sidebar.openInExplorerUnsupported")
                      : translate("sidebar.openInExplorer")}
                    aria-label={translate("sidebar.openInExplorer")}
                  >
                    {/* 文件夹 + 箭头：这是「在系统文件夹里打开」，不是分享/外链。 */}
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M3 7.5A1.8 1.8 0 0 1 4.8 5.7h3.7l1.7 1.8h8A1.8 1.8 0 0 1 20 9.3v7.9a1.8 1.8 0 0 1-1.8 1.8H4.8A1.8 1.8 0 0 1 3 17.2z" />
                      <path d="M10.4 13.6h4M13 11.7l1.9 1.9-1.9 1.9" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    className="cbtn cbtn--sm"
                    title={translate("files.hidePanel")}
                    aria-label={translate("files.hidePanel")}
                    onClick={() => setRightPanelOpen(false)}
                  >
                    <Icon name="xmark" />
                  </button>
                </>
              )}
            />
          </aside>
        )}
        </div>
      </div>
    </div>
    {settingsSection && (
      <SettingsPanel        cwd={projectTrustCwd}
        sessionId={selectedSession?.id ?? null}
        initialSection={settingsSection}
        quoteSelectionEnabled={quoteSelectionEnabled}
        onQuoteSelectionChange={handleQuoteSelectionChange}
        onClose={() => {
          setSettingsSection(null);
          setModelsRefreshKey((key) => key + 1);
        }}
        onSessionReloaded={() => setSessionKey((key) => key + 1)}
        projectTrust={projectTrust}
        onOpenTrustDialog={openProjectTrustDialog}
        onProjectTrustChanged={handleProjectTrustChanged}
        soundEnabled={soundEnabled}
        onSoundToggle={onSoundToggle}
      />
    )}
    {/* After Settings, so it opens above it (z-index 1100 over 1000) when Settings › MCP asks for it. */}
    {projectTrustDialogOpen && projectTrustCwd && (
      <ProjectTrustDialog
        cwd={projectTrustCwd}
        busy={projectTrustBusy}
        error={projectTrustError}
        onCancel={() => {
          if (!projectTrustBusy) setProjectTrustDialogOpen(false);
        }}
        onConfirm={() => void handleTrustProject()}
        onStatus={setProjectTrust}
      />
    )}
    </>
  );
}

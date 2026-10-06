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
import { useDismissOnOutside } from "./PortalDropdown";
// fork:proma-38-tab-boundary —— 每个 tab 的内容各包一层错误边界。
import { TabErrorBoundary } from "./TabErrorBoundary";
// fork:proma-38-tab-reorder / fork:proma-38-tab-mru —— 拖拽排序与关闭回退的纯逻辑。
import { applyTabOrder, moveTabBefore } from "@/lib/tab-reorder";
import { EMPTY_TAB_MRU, focusAfterClose, rememberTabVisit, type TabMru } from "@/lib/tab-mru";
// fork:pr40-split —— 右栏双 Pane 分屏的接线（逻辑层与壳都不改，这里只把状态接上）。
import { useSplitPanes } from "@/hooks/useSplitPanes";
import { SplitPaneHost } from "./fork/SplitPaneHost";
import { groupRightPanelSplitTabs, type RightPanelPane } from "@/lib/right-panel-split";
import { MobileRightPanels, type MobileRightPanelItem } from "./pwa/RightPanelsMobile";
// fork:v5-landing E4 —— M-11 帧 A 的两条手机手势（下拉刷新指示器 `.m-pull` /
// 左缘侧滑返回 `.m-swipe`）与 M-10 帧 C-1 的 `.m-trust` 常驻条。
// 手势逻辑住在 `components/pwa/**`（PWA 形态组件的家），这里只传它在产品里的真实动作。
import { PwaPullToRefresh } from "./pwa/MobileGestures";
import { openFileTab, saveFileViewerState } from "./file-tab-state";
// fork:zc-06 — 「最近关闭」快照的纯逻辑与存储。
import { forgetClosedTab, loadRecentClosedTabs, recordClosedTab, saveRecentClosedTabs, type RestorableTab } from "@/lib/recent-closed-tabs";
import { loadSessionList } from "@/lib/session-list";
import { mergeCatalogRow } from "./session-catalog-helpers";
import { loadRightTabs, saveRightTabs } from "@/lib/right-tabs-memory";
import { resolveRestoreTarget } from "@/lib/workspace-restore";
import { GitGraphTab } from "./GitGraphTab";
// fork:proma-39-changes — 右栏「改动」单例 tab（合并 Git / 会话 / 记忆三路来源）。
import { SettingsPanel } from "./SettingsPanel";
import { ExplorerPanel } from "./ExplorerPanel";
import { ProjectTrustDialog } from "./ProjectTrustDialog";
import { PwaTrustBanner } from "./pwa/PwaTrustSheet";
import { InstallPromptBanner, PwaOfflineBanner, PwaUpdateBanner } from "./fork/InstallPromptBanner";
import { DirectoryPicker } from "./DirectoryPicker";
import { BranchNavigator, findSiblingIndex, hasSessionBranches } from "./BranchNavigator";
// fix:mcp-topbar-icons —— 顶栏右侧两枚状态图标（MCP / 插件）+ 可点的分支芯片。
import { BranchChip, McpStatusButton, PluginStatusButton, splitStatusesByKind } from "./TopBarPopovers";
import { MobileActionPanel } from "./fork/MobileActionPanel";
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
import { useIsMobile, useIsCompact } from "@/hooks/useIsMobile";
import { useViewportHeight } from "@/hooks/useViewportHeight";
import { usePresenceHeartbeat } from "@/hooks/usePresenceHeartbeat";
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
// fork:mobile-tb-subtitle —— 副行里的目录名与项目行同一个规则（lib/project-prefs.ts）。
import { pathBasename } from "@/lib/project-prefs";
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

import { TraceFrame } from "./TraceFrame";
import { SessionActionsMenu } from "./fork/SessionActionsMenu";
import { markSessionUnread, useReadCursors } from "@/lib/session-unread";
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
import { getLastSettingsSection, SETTINGS_SECTIONS, type SettingsSection } from "@/lib/settings-navigation";
// fork:command-palette —— ⌘K / ⌘⇧P 的统一入口（命令 / 会话 / 文件）。
import { CommandPalette, type PaletteCommand } from "./fork/CommandPalette";
import { TEXT } from "@/lib/typography";

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
/** fork:proma-39-changes — 单例改动面板 tab 的 id（同样不与 `file:<path>` 撞名）。 */
/** fork:trace-pane — 单例「调用轨迹」tab 的 id（同一约定）。 */
const TRACE_TAB_ID = "trace";
/* fork:v5-m12 —— 手机右栏选单里那六块的固定 key（画板 M-12 帧 A，一块一行）。
   轨迹 / Git 直接用它们自己的单例 tab id；文件这一块在手机上就是文件面板
   （正文是那一列树，所以给一个不进 `panelTabs` 的独立 id，不会与 `file:<path>` 撞名）；
   终端 / 浏览器开着时用真实页签 id、关着时用这两个占位（点它现开一个），
   「审查」是文件树里那一节，所以它的正文就是树。 */
const FILE_PANEL_TAB_ID = "file-panel";
const TERMINAL_BLOCK_KEY = "terminal-block";
const BROWSER_BLOCK_KEY = "browser-block";
const REVIEW_BLOCK_KEY = "review-block";
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
  useViewportHeight();
  // fork:mobile-shell —— 壳内用原生 insets 覆盖 --safe-*（安卓 WebView 的 env() 失效，
  // 见 globals.css :root 的安全区块）。桌面/PWA 上 initShellInsets 是 no-op。
  useEffect(() => {
    void import("@/lib/mobile-shell").then((mod) => mod.initShellInsets());
  }, []);
  // fork:mobile-shell —— 壳内静默镜像同步：启动 / 回前台 / 每 5 分钟拉增量。
  // 桌面上 isMobileShell() 恒 false，runMobileSync 是 no-op；离线时 fetch 静默失败。
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const shell = await import("@/lib/mobile-shell");
      if (cancelled || !shell.isMobileShell()) return;
      const sync = await import("@/lib/mobile-sync");
      await sync.runMobileSync();
    };
    void run();
    const timer = window.setInterval(() => void run(), 5 * 60_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void run();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
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
  // fork:mobile-shell — 在场心跳：服务端据此裁决 Web Push 发不发（你在任何一台设备前
  // 有交互，推送就静音，交给未读点/完成音；全离场才推）。见 lib/notification-plan.ts。
  usePresenceHeartbeat(selectedSession?.id ?? null);
  const [sessionKey, setSessionKey] = useState(0);
  /* 板 05 B 类转场：「重载会话」**不再** bump sessionKey（那会把整个 ChatWindow
     remount 成骨架屏）。reload 换成转录列降到 0.5 的就地刷新，见 ChatWindow 的
     reloadToken。其余六处 sessionKey（切会话 / 换 cwd / fork / 项目信任）仍然是真 remount。 */
  const [sessionReloadToken, setSessionReloadToken] = useState(0);
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
  /* fork:command-palette —— 面板开关 + 命令清单。命令全部直接调既有 setState，
     所以清单是纯数据、随渲染重建也无所谓（useMemo 只为不每帧新建数组）。 */
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);

  // fork:trace-menu —— ⋯ 菜单「重命名会话」：标题原地变成输入框（ZCode 的任务标题
  // 也是这么改的），回车提交 / Esc 取消，失焦也提交。PATCH 之后 bump refreshKey
  // 让侧栏列表立刻重新读一次（不等它 2.5s 的轮询）。
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null);
  // fork:trace-menu —— 极简通知宿主：菜单里的系统级动作（在访达里打开项目目录）
  // 失败时必须有地方报，否则就是「点了没反应」。固定一条 `.pw-toast`，3s 自动收。
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = useCallback((message: string) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast(message);
    toastTimerRef.current = setTimeout(() => setToast(null), 3000);
  }, []);
  useEffect(() => () => { if (toastTimerRef.current) clearTimeout(toastTimerRef.current); }, []);

  /* fork:trace-menu —— 菜单里的三条复制：成功只剩剪贴板（用户自己看不见），失败必须
   看得见。`copyText` 永远 resolve 成 {ok}，所以在这里判一次，失败弹那条 .pw-toast。
   菜单项仍带 `feedbackLabel: 已复制`，那是成功路径的即时回执。 */
  const copyWithFeedback = useCallback(async (value: string | null) => {
    if (!value) {
      showToast(translate("session.copyFailed"));
      return;
    }
    const result = await copyText(value);
    if (!result.ok) showToast(translate("session.copyFailed"));
  }, [showToast, translate]);

  /* 同源下载：临时 <a download> 点一下就撤。不用 window.open（桌面端会把它交给
     系统浏览器），也不用 fetch + blob URL（多一次读，导出页可达 1.5MB）。 */
  function downloadSessionFile(url: string) {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.rel = "noopener";
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }

/* fork:trace-menu —— 菜单里的「在访达中打开」：走 `/api/files/reveal`（与文件树
     `PathActions` 同一个端点、同一份 allowed roots 判定）。会话文件在
     `~/.pi/agent/sessions` 下、不在 roots 里，所以这里开的是**项目目录**。 */
  const revealProjectDir = useCallback(async (dir: string) => {
    if (!dir) return;
    try {
      const res = await fetch("/api/files/reveal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: dir, action: "reveal" }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch {
      showToast(translate("session.revealFailed"));
    }
  }, [showToast, translate]);

  const commitSessionRename = useCallback((sessionId: string, name: string) => {
    setRenamingSessionId(null);
    const trimmed = name.trim();
    if (!trimmed) return;
    void (async () => {
      try {
        const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: trimmed }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setRefreshKey((key) => key + 1);
      } catch {
        showToast(translate("session.renameFailed"));
      }
    })();
  }, [showToast, translate]);
  // fork:proma-32-skill-usage —— 本轮 skill chip 的落点：打开设置并定位到 Skills 分节里的那一条。
  const [settingsSkillSlug, setSettingsSkillSlug] = useState<string | null>(null);
  const handleOpenSkill = useCallback((slug: string) => {
    setSettingsSkillSlug(slug);
    setSettingsSection("skills");
  }, []);
  const [modelsRefreshKey, setModelsRefreshKey] = useState(0);
  const [projectTrust, setProjectTrust] = useState<ProjectTrustStatus | null>(null);
  const [projectTrustDialogOpen, setProjectTrustDialogOpen] = useState(false);
  const [projectTrustBusy, setProjectTrustBusy] = useState(false);
  const [projectTrustError, setProjectTrustError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(() => !initialNavigation.sidebarCollapsed);
  const [rightPanelOpen, setRightPanelOpen] = useState(false);

  /* fork:command-palette —— 命令清单。**只收本仓真实存在的开关**，不编：
     设置分节直接用 `SETTINGS_SECTIONS`（单一真值，加一个分节面板里自动有），
     其余只放确实存在的开关。命令直接调既有 setState，所以面板不必知道
     「设置怎么开、会话怎么切」。 */
  const paletteCommands = useMemo<PaletteCommand[]>(() => [
    // fork:cmd-palette-clean —— 不写 `hint`。之前给每一行都挂了
    // 「命令」两个字做右侧说明，十几行一模一样地重复 —— 那是**域**信息，
    // 域已经写在顶部的「全部/命令/会话/文件」四个切换里了，每行再说一遍
    // 就是噪音。右侧那个位置留给真正逐行不同的东西（路径、片段、快捷键）。
    ...SETTINGS_SECTIONS.map((entry) => ({
      id: `settings:${entry.id}`,
      label: translate(entry.labelKey),
      icon: "settings",
      group: "settings",
      run: () => setSettingsSection(entry.id),
    })),
    {
      id: "panel:right",
      label: translate(rightPanelOpen ? "palette.hideRightPanel" : "palette.showRightPanel"),
      icon: "panel-right",
      group: "panels",
      run: () => setRightPanelOpen((open) => !open),
    },
  ], [translate, rightPanelOpen]);
  // The grid tracks never swap. This flag only changes which persistent
  // surface occupies the main region and the secondary workspace region.
  const [workspaceSwapped, setWorkspaceSwapped] = useState(false);
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
  // fork:pr40-split —— 分屏只**借用**右栏的 resizer：宽度归它、存储归它，
  // 分屏下限 720 只活在会话记忆里（`useSplitPanes` 走 `setWidth(width)` 不落盘）。
  // `useResizablePanel` 不导出上限，这里按它内部同一口径补一个稳定的壳对象。
  const splitPanelResizer = useMemo(() => ({
    width: rightPanelResizer.width,
    maxWidth: Math.min(RIGHT_PANEL_MAX_WIDTH, getResponsiveRightPanelMaxWidth()),
    isResizing: rightPanelResizer.isResizing,
    setWidth: rightPanelResizer.setWidth,
  }), [getResponsiveRightPanelMaxWidth, rightPanelResizer.isResizing, rightPanelResizer.setWidth, rightPanelResizer.width]);
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
  const mobileToolbarRef = useRef<HTMLDivElement>(null);
  /* fork:v5-landing E4 —— 手机的聊天面（顶栏之下、消息之上）。`.m-pull` 挂在这一层，
     下拉手势也只在这棵子树里找 `.m-scroll`（窄屏转录区）。 */
  const mobileChatSurfaceRef = useRef<HTMLDivElement>(null);
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
  // fork:mcp-topbar-dedupe-status —— 两个浮窗原先各自渲染**整份** statuses，于是
  // `ponytail: FULL` 与 `MCP: 5 servers enabled` 在两个浮窗里各出现一次（用户截图）。
  // `splitStatusesByKind` 一直是死代码：MCP 的进 MCP 浮窗，其余进插件浮窗，按 key/文案
  // 里有没有 "mcp" 判。接线点只有这一处，别再把全量数组递进任何一个浮窗。
  const { mcp: mcpStatuses, others: pluginStatuses } = useMemo(() => splitStatusesByKind(extensionStatuses), [extensionStatuses]);
  const [extensionWidgets, setExtensionWidgets] = useState<ExtensionWidgetItem[]>([]);
  const handleExtensionStatusChange = useCallback((statuses: ExtensionStatusItem[], widgets: ExtensionWidgetItem[]) => {
    setExtensionStatuses(statuses);
    setExtensionWidgets(widgets);
  }, []);

  // Single active panel — only one dropdown open at a time
  // fork:no-recent-sessions（用户 2026-10-01）—— 顶栏标题原先是「最近会话」下拉的
  // 触发钮（`"sessions"` 那一档）。整块撤掉：侧栏本来就是切会话的地方。
  const [activeTopPanel, setActiveTopPanel] = useState<"agents" | "branches" | "system" | "tools" | null>(null);
  const [topPanelPos, setTopPanelPos] = useState<{ top: number; left: number; width: number } | null>(null);
  /* fix:branch-panel-anchor（2026-10-06）—— 窄屏分支浮层的锚点 = 那枚 `.m-branch`
     芯片。`BranchNavigator` 的定位优先量 `containerRef`，量不到才退回它自己的按钮；
     窄屏那枚内联按钮是 `hideInlineButton`（`display:none`，rect 全 0），于是浮层落到
     top:6 / left:8 的屏幕左上角。把芯片的 ref 交给它。 */
  const mobileBranchRef = useRef<HTMLButtonElement>(null);

  /* fork:d03-frame-c —— 顶栏「N 条新消息」（画板 D-03 帧 C）。与转录里那条分割线读
     同一个 store（`lib/session-unread.ts` 的读到哪）：没读数（首次打开）或不剩新
     条目都是 0。`messageCount` 是会话接口给的**总**条数，与渲染窗口无关，所以这枚
     徽标在窗口还没翻到分割线时就已经在了。 */
  const readCursors = useReadCursors();
  const newMessageCount = selectedSession
    ? Math.max(0, selectedSession.messageCount - (readCursors[selectedSession.id] ?? selectedSession.messageCount))
    : 0;

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
  /* fork:top-panel-dismiss（用户 2026-10-05）—— 「点了「工具定义 / 系统提示」，点旁边
     其它地方它不消失，非得再点一次那枚钮」：这一族顶栏浮层此前**只有触发钮的 toggle**
     与分支浮层自己的关法，没有「点外面就关」。`useDismissOnOutside` 就是那份现成判据
     （PortalDropdown 里，MCP / 插件两枚浮窗在用），接上锚点与浮层本体两个 ref 就够。 */
  const topPanelRef = useRef<HTMLDivElement>(null);
  const closeTopPanel = useCallback(() => setActiveTopPanel(null), []);
  useDismissOnOutside(Boolean(activeTopPanel), topPanelAnchorRef, topPanelRef, closeTopPanel);
  const toggleTopPanel = useCallback((
    panel: "agents" | "branches" | "system" | "tools",
    trigger?: HTMLElement | null,
  ) => {
    if (isMobile) setSidebarOpen(false);
    if (trigger !== undefined) topPanelAnchorRef.current = trigger;
    setActiveTopPanel((cur) => cur === panel ? null : panel);
  }, [isMobile]);

  const handleSystemInfoToggle = useCallback((
    panel: "system" | "tools",
    trigger?: HTMLElement | null,
  ) => {
    const opening = activeTopPanel !== panel;
    toggleTopPanel(panel, trigger);
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

  /* fork:v5-frame-audit（2026-10-05）—— 手机顶栏的分支条 = 画板 M-02 帧 A / B / C 与
     M-01 帧 B 那一枚 `<button class="m-branch">`：
     `git-branch` · `2 / 3`（当前分支 / 分支总数）· `chevron-right`。
     口径：`branchTree` 的**顶层**就是各条分支（与 `BranchNavigator` 的 `topLevel`
     同一份数据），当前分支 = 走到底命中 `branchActiveLeafId` 的那条顶层分支。
     行为不变：点它仍然开同一个「分支」顶栏面板（`toggleTopPanel("branches")`），
     面板本体仍由下面那个 `BranchNavigator` 渲染 —— 这里只补画板上那枚可见入口
     （此前窄屏把 `hideInlineButton` 打开，顶栏上看不到任何分支痕迹）。 */
  const mobileBranchChip = (() => {
    if (!sessionHasBranches || branchTree.length === 0) return null;
    // 序号口径复用 `findSiblingIndex`（与顶栏芯片同一份遍历，且是迭代的 —— 线性会话
    // 深到 6000 条时这里原来的递归 `hits` 会打爆调用栈）。
    const activeIdx = findSiblingIndex(branchTree, branchActiveLeafId);
    const shown = activeIdx >= 0 ? activeIdx + 1 : branchTree.length;
    return (
      <button
        type="button"
        ref={mobileBranchRef}
        className="m-branch"
        onClick={() => toggleTopPanel("branches")}
        aria-expanded={activeTopPanel === "branches"}
        title={translate("i18n.branches")}
        aria-label={translate("i18n.branches")}
      >
        <i data-ico="git-branch" data-size="12" aria-hidden="true" />
        {`${shown} / ${branchTree.length}`}
        <i data-ico="chevron-right" data-size="12" aria-hidden="true" />
      </button>
    );
  })();

  // fork:ui-stats-inline — 统计面板已搬到 composer 下方的状态条；这里只负责
  // 把 `/session` 之类的入口变成“展开那块面板”，不再切顶栏浮层。
  const openSessionStatsPanel = useCallback(() => {
    if (isMobile) setSidebarOpen(false);
  }, [isMobile]);

  const handleSidebarToggle = useCallback(() => {
    if (isMobile) {
      setActiveTopPanel(null);
    }
    setSidebarOpen((open) => !open);
  }, [isMobile]);

  const handleRightPanelToggle = useCallback(() => {
    if (isMobile) {
      setSidebarOpen(false);
      setActiveTopPanel(null);
    }
    setRightPanelOpen((open) => !open);
  }, [isMobile]);

  const handleWorkspacePositionToggle = useCallback(() => {
    if (isMobile) return;
    setWorkspaceSwapped((swapped) => !swapped);
  }, [isMobile]);

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
  // fork:proma-39-changes — 单例「改动」面板（与图谱同为「看一眼」的视图，不持久化）。
  const [changesOpen, setChangesOpen] = useState(false);
  /* fork:v5-m12 —— 「审查」块进来一次就递增一次，ExplorerPanel 拿它展开改动那一节
     （见 ExplorerPanel 的 openChangesSignal）。2026-10-03 之前这两个 state 是
     声明了没人用的残留，选单因此只有两行。 */
  const [changesSignal, setChangesSignal] = useState(0);
  const [reviewCount, setReviewCount] = useState(0);
  // 有新改动但用户没在看改动 tab 时的未读标记（只提示，绝不自动切 tab）。
  const [changesUnseen, setChangesUnseen] = useState(false);

  // fork:trace-pane — 单例「调用轨迹」tab（顶栏原「完整历史」钮打开它）。
  const [traceOpen, setTraceOpen] = useState(false);
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

  /* fork:proma-38-tab-reorder —— 用户拖过的 tab 顺序（`null` = 没拖过，保持默认的
     「图谱 / 改动 / 文件 / 终端 / 浏览器 / 探索分支」分组顺序）。
     只存 id：具体 tab 的元数据仍在各自的 state 里，`panelTabs` 按这张表重排。 */
  const [tabOrder, setTabOrder] = useState<string[] | null>(null);
  /* fork:proma-38-tab-mru —— 关掉激活 tab 后回到**这个会话上一次访问过的 tab**。
     每个会话各记各的（键与右栏 tab 记忆同一把 `workspaceKeyOf` 钥匙）。
     state / ref 先在这里声明，记录用的 effect 挂在 `panelTabs` 之后（它要用
     panelTabs 判断「上一个 tab 是不是已经被关掉了」）。 */
  const [tabMru, setTabMru] = useState<TabMru>(EMPTY_TAB_MRU);
  const tabVisitRef = useRef<{ sessionKey: string | null; tabId: string | null }>({
    sessionKey: activeWorkspaceKey,
    tabId: activeFileTabId,
  });

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

  // fork:proma-38-tab-reorder —— 拖过的顺序覆盖默认分组顺序；没拖过（`tabOrder === null`）
  // 时 applyTabOrder 原样返回，分组顺序一个字不变。
  /* fork:trace-pane-2026-10-06（用户反馈「调用轨迹的 × 关不掉」）—— 依赖表里**必须有**
     `traceOpen`：漏掉它时 `setTraceOpen` 不会让这张表重算，于是打开后标签要等别的
     state 变化才出现、关掉后标签还挂着（× 看着「没反应」）。`gitGraphOpen` 一直有，
     当初只漏了这一枚。 */
  const panelTabs: Tab[] = useMemo(() => applyTabOrder<Tab>([...(gitGraphOpen ? [{
    id: GIT_GRAPH_TAB_ID,
    label: translate("git.graph"),
    filePath: "",
    kind: "git-graph" as const,
  }] : []), ...(traceOpen ? [{
    id: TRACE_TAB_ID,
    label: translate("trace.title"),
    filePath: "",
    kind: "trace" as const,
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
  }))], tabOrder), [branchTabs, browserTabs, changesOpen, changesUnseen, fileTabs, gitGraphOpen, tabOrder, terminalTabs, traceOpen, translate]);

  // fork:proma-38-tab-reorder —— 拖拽落点只说「插到谁前面」；第一次拖就把当前默认顺序
  // 整张物化成顺序表（之后只在这张表上搬），所以关掉重开 tab 不会把顺序打回去。
  const handleMoveTab = useCallback((tabId: string, beforeTabId: string | null) => {
    setTabOrder((current) => moveTabBefore(current ?? panelTabs.map((tab) => tab.id), tabId, beforeTabId));
  }, [panelTabs]);

  useEffect(() => {
    const previous = tabVisitRef.current;
    tabVisitRef.current = { sessionKey: activeWorkspaceKey, tabId: activeFileTabId };
    // 刚被关掉的 tab 不记：否则下一次关闭会拿到一个已经不存在的「上次」。
    const previousTabId = previous.tabId && panelTabs.some((tab) => tab.id === previous.tabId)
      ? previous.tabId
      : null;
    // 换会话时前后两个 tab 分属不同会话，不记（判定在 lib/tab-mru.ts）。
    setTabMru((current) => rememberTabVisit(current, {
      sessionKey: activeWorkspaceKey,
      previousSessionKey: previous.sessionKey,
      previousTabId,
      currentTabId: activeFileTabId,
    }));
  }, [activeFileTabId, activeWorkspaceKey, panelTabs]);

  // fork:pr40-split —— 右栏双 Pane 分屏的接线。四件事都在 hook 里（比例 clamp /
  // 落点解析 / 两套宽度记忆 / 窄栏退化），这里只负责把 AppShell 自己的 tab 列表
  // 和激活项喂进去，再把 `selectTab` 接到顶栏。
  const panelTabIds = useMemo(() => panelTabs.map((tab) => tab.id), [panelTabs]);
  const splitPanes = useSplitPanes({
    sessionId: selectedSession?.id ?? null,
    availableTabIds: panelTabIds,
    activeTabId: activeFileTabId,
    onActiveTabIdChange: setActiveFileTabId,
    isMobile,
    resizer: splitPanelResizer,
    dividerAriaLabel: translate("split.divider"),
  });

  // 分屏的两个 tab 排到相邻位置（其余顺序不变）—— 否则「左格开着 A、右格开着 B」
  // 却在顶栏被别的 tab 隔开，键盘用户找不到第二个 Pane 的内容。
  const orderedPanelTabs: Tab[] = useMemo(() => (
    splitPanes.split
      ? groupRightPanelSplitTabs(panelTabs, splitPanes.leftTabId, splitPanes.rightTabId)
      : panelTabs
  ), [panelTabs, splitPanes.leftTabId, splitPanes.rightTabId, splitPanes.split]);

  // Pane 的可读名字（顶栏 tab 标题），给 `SplitPaneHost` 的 aria-label。
  const splitPaneLabels = useMemo(() => {
    const labelOf = (id: string | null) => panelTabs.find((tab) => tab.id === id)?.label ?? "";
    return { left: labelOf(splitPanes.leftTabId), right: labelOf(splitPanes.rightTabId) };
  }, [panelTabs, splitPanes.leftTabId, splitPanes.rightTabId]);

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
    /* fork:fix-clipboard —— `copyText` 永不 reject，只会 resolve 出 `{ok,reason}`；
       之前 `await copyText(text)` 把结果整个丢掉，写入被拒时用户**什么都看不到**。

       成功路径一个字没动：这一串动作的可见反馈不在 AppShell，而在菜单那一侧 ——
       会话行右键 →「复制会话引用」的 `feedbackLabel`（t("session.copied")，
       components/SessionRowContextMenuBridge.tsx）。

       失败路径**目前接不上**（已查遍，能说明原因）：
         - 那枚反馈标签是**无条件**的：`ContextMenu.runItem` 先 `setFeedbackIndex`
           再 `await onSelect()`，拿不到本次复制的结果，所以失败时菜单照样闪
           「已复制」；改它要动 components/ContextMenu.tsx + 上面的 Bridge
           （例如让 `onSelect` 返回 `{ok}`，菜单按结果在
           `feedbackLabel` / `feedbackLabelFailed` 之间切）。
         - AppShell 自己也没有可接的通知区：没有 toast / NoticeShelf，notices 是
           `useAgentSession` 的状态、在 ChatWindow 另一棵子树里渲染；
           `deliverSessionNotification` 是 OS 级通知，且由用户偏好与「仅未聚焦时」
           把关，拿它报一个右键菜单的复制失败是滥用。

       所以这里先把失败记下来（不静默当成功），可见反馈等上面两处支持按结果
       切换文案后补上。 */
    const result = await copyText(text);
    if (!result.ok) console.error(`[pi-web] copy session reference failed: ${result.reason}`);
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
    // fork:command-palette — ⌘K / ⌘⇧P。
    onToggleCommandPalette: () => setCommandPaletteOpen((open) => !open),
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
    setActiveFileTabId((current) => (current !== tab.id
      ? current
      // 重启换的那一个新终端此刻还没进 panelTabs，得显式算进「还开着」里。
      : pickFocusAfterClose(
        tab.id,
        replacement?.id ?? remaining.at(-1)?.id ?? fileTabs.at(-1)?.id ?? null,
        replacement ? [replacement.id] : [],
      )));
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


  // fork:proma-39-changes — 面板上报未读：只亮圆点，绝不调 setActiveFileTabId。
  const handleChangesUnseen = useCallback((unseen: number) => {
    setChangesUnseen(unseen > 0);
  }, []);

  // fork:proma-39-changes — ChatWindow 聚合的本会话写入文件（非 Git 项目来源）。

  /* fork:proma-38-tab-mru —— 关掉激活 tab 之后的落点。
     `remainingTabIds(closedId)` 是「关掉它之后**全部**还开着的 tab」（不分类别：
     MRU 记的是整个右栏工作区的上一次访问），`fallbackId` 是原来的相邻 / 末尾行为
     —— MRU 答不出来时用它，所以这次改动只会让落点更贴近「上次去过的地方」。 */
  const remainingTabIds = useCallback(
    (closedTabId: string) => panelTabs.filter((tab) => tab.id !== closedTabId).map((tab) => tab.id),
    [panelTabs],
  );

  const pickFocusAfterClose = useCallback((closedTabId: string, fallbackId: string | null, extraOpenIds: string[] = []) => (
    focusAfterClose(tabMru, {
      sessionKey: activeWorkspaceKey,
      closedTabId,
      // `extraOpenIds`：这一刻正要新开、但还没进 panelTabs 的 tab（终端重启换的那一个）。
      openTabIds: extraOpenIds.length > 0 ? [...remainingTabIds(closedTabId), ...extraOpenIds] : remainingTabIds(closedTabId),
      fallbackId,
    })
  ), [activeWorkspaceKey, remainingTabIds, tabMru]);


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
      setActiveFileTabId((current) => (current !== tabId
        ? current
        : pickFocusAfterClose(tabId, remainingIds.at(-1) ?? null)));
      if (!workspaceSwapped && remainingIds.length === 0) setRightPanelOpen(false);
      return;
    }
    if (tabId === TRACE_TAB_ID) {
      // fork:trace-pane — 单例 tab 关闭后从面板里拿掉（与图谱同一套）。
      setTraceOpen(false);
      const remainingIds = [
        ...fileTabs.map((tab) => tab.id),
        ...terminalTabs.map((tab) => tab.id),
        ...browserTabs.map((tab) => tab.id),
        ...branchTabs.map((tab) => tab.id),
        ...(gitGraphOpen ? [GIT_GRAPH_TAB_ID] : []),
      ];
      setActiveFileTabId((current) => (current !== tabId
        ? current
        : pickFocusAfterClose(tabId, remainingIds.at(-1) ?? null)));
      if (!workspaceSwapped && remainingIds.length === 0) setRightPanelOpen(false);
      return;
    }
    if (branchTabs.some((tab) => tab.id === tabId)) {
      const remaining = branchTabs.filter((tab) => tab.id !== tabId);
      setBranchTabs(remaining);
      setActiveFileTabId((current) => (current !== tabId
        ? current
        : pickFocusAfterClose(tabId, remaining.at(-1)?.id ?? fileTabs.at(-1)?.id ?? null)));
      return;
    }
    if (browserTabs.some((tab) => tab.id === tabId)) {
      const remaining = browserTabs.filter((tab) => tab.id !== tabId);
      setBrowserTabs(remaining);
      setActiveFileTabId((cur) => (cur !== tabId
        ? cur
        : pickFocusAfterClose(tabId, fileTabs.at(-1)?.id ?? terminalTabs.at(-1)?.id ?? remaining.at(-1)?.id ?? null)));
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
      return pickFocusAfterClose(tabId, remaining.at(-1)?.id ?? terminalTabs.at(-1)?.id ?? null);
    });
  }, [branchTabs, browserTabs, fileTabs, gitGraphOpen, pickFocusAfterClose, terminalTabs, workspaceSwapped]);

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
    setTraceOpen(false);
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
    setTraceOpen(keep === TRACE_TAB_ID);
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

  // fork:trace-pane —— 顶栏原「完整历史」图标钮（位置、图标、名字都不动，用户
  // 2026-10-02 裁定）现在开右栏的单例「调用轨迹」tab，而不是 window.open 导出
  // 的整页 HTML；导出仍从 ⋯ 菜单与侧栏行菜单进。
  const handleViewFullHistory = useCallback(() => {
    if (!selectedSession) return;
    setTraceOpen(true);
    setActiveFileTabId(TRACE_TAB_ID);
    setRightPanelOpen(true);
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

  /* fix:switch-workspace-authorize（用户 2026-10-03：「选了新任务后提示没有模型」）——
     「切到某个目录开新会话」的全部入口（输入框上方那枚工作区芯片的菜单、上方分支
     芯片的 worktree 列表、导轨的「新建任务」、首页指南的最近项目、手输目录弹窗）
     都走这一个漏斗，所以授权也只有这一步：`/api/cwd/validate` 解析服务端身份
     并把该目录加进文件白名单（allowFileRoot），之后按 cwd 授权的接口才认它。

     之前芯片菜单 / worktree / 最近项目直接 `handleCwdChange`，目录没进白名单，
     新会话立刻去拉 `/api/models?cwd=…` → 403「Access denied」→ 模型清单空 →
     选择器显示「No models」。浏览器算出来的 projectRoot/projectKey 也一并丢掉：
     服务端是权威（worktree 归并到主仓、Windows 大小写）。 */
  const startSessionIn = useCallback(async (cwd: string): Promise<string | null> => {
    let data: { cwd?: string; projectRoot?: string; projectKey?: string; error?: string };
    try {
      const res = await fetch("/api/cwd/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd }),
      });
      data = await res.json().catch(() => ({})) as typeof data;
      if (!res.ok || !data.cwd || !data.projectRoot || !data.projectKey) {
        return data.error ?? `HTTP ${res.status}`;
      }
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
    handleCwdChange(data.cwd!, data.projectRoot!, data.projectKey!);
    const tempId = typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    handleNewSession(tempId, data.cwd!);
    return null;
  }, [handleCwdChange, handleNewSession]);


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
        void startSessionIn(project.root).then(setHomeTargetError);
      },
      onPickChat: () => {
        setHomeTargetError(null);
        if (chatWorkspaceTarget) void startSessionIn(chatWorkspaceTarget.cwd).then(setHomeTargetError);
      },
      /* fork:ui-ctxbar —— 输入框上方那枚分支芯片点开的工作区（worktree）列表；
         选中另一个工作区 = 切目录并在那里开一条新会话，与侧栏/顶栏同一动作。 */
      onPickWorkspace: (path) => {
        setHomeTargetError(null);
        void startSessionIn(path).then(setHomeTargetError);
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
            setHomeTargetError(await startSessionIn(result.cwd));
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
  // fork:design-components —— 画板 01/02 顶栏的 .d-chipbtn：有会话时给分支（工作区列表
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
      {/* fork:v5-landing E4 —— 画板 M-01 / M-04 每一帧里助手身份行的品牌件
          `<img class="m-brand">`（`.m-brand` = 26px / width auto，唯一的品牌图形
          尺寸来源）。产品里那条身份行在 MessageView（属另一波），而这条工作包把
          `m-brand` 交给抽屉：手机抽屉顶部就是品牌位，`.m-drawer-head`（会话 + 关闭）
          仍按画板保持在它下面。
          尾件是画板同一行的 `.m-badge mute`，接**真实数据**：板面写的是模型名，
          而这一层（AppShell 的抽屉头）拿不到模型标签，能拿到的真数据是当前项目名。
          版本号不重复写在这里 —— 它是 `.m-drawer-foot` 的尾件（M-04 帧 A 原文）。 */}
      {isMobile && (
        <div className="nx-row m-t-sm" style={{ gap: "var(--nx-sp-2)", padding: "0 var(--nx-sp-3) var(--nx-sp-2)" }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- 静态品牌资产，不走 next/image 优化器 */}
          <img className="m-brand" src="/pi-next-logo.png" alt="PI NEXT" draggable={false} />
          <span className="m-t-b">PI NEXT</span>
          {activeCwdName ? <span className="m-badge mute">{activeCwdName}</span> : null}
        </div>
      )}
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
      {/* fork:phone-push —— 底栏 = 画板 D-02 的 `.d-side-foot`：设置行（`d-row d-grow`）
          + 手机钮（`d-iconbtn`）+ 版本徽章（`d-badge mute`）三件同排。
          手机钮只能做兄弟、不能塞进按钮里（按钮套按钮既非法也过不了无障碍）。
          fork:v5-landing —— 旧 `pw-side-foot` / `pw-side-scroll` 已从 DOM 退场
          （旧 CSS 保留待收尾波清）；board-specs / e2e 里按 `button.pw-side-foot`
          选行的脚本需在收尾波改到 `.d-side-foot`。
          fork:v5-wave-b —— 手机上换成画板 M-04 的 `.m-drawer-foot`（设置行
          `.m-row.m-grow` + 手机钮 + 版本 `.m-badge.mute`，同一顺序、
          同一组回调与 data-fork-quick）。
          fork:v5-frame-audit（2026-10-05）—— 末两件逐节点照板面抄：手机钮是
          `<button class="m-top-btn"><i data-ico="smartphone" data-size="15">`（画板
          M-04 帧 A/C/D 的 `.m-drawer-foot` 三帧都是这一枚，产品此前用的是
          `.m-iconbtn`）；图标尺寸 14 → 15，与板面一致。 */}
      <div className={isMobile ? "m-drawer-foot" : "d-side-foot"} style={isMobile ? undefined : { marginTop: "auto" }}>
        <button
          type="button"
          onClick={() => setSettingsSection(getLastSettingsSection(projectTrustCwd))}
          title={translate("common.settings")}
          aria-label={translate("common.settings")}
          className={isMobile ? "m-row m-grow" : "d-row d-grow"}
        >
          <i data-ico="settings" data-size="14" aria-hidden="true"></i>
          <span>{translate("common.settings")}</span>
        </button>
        <button
          type="button"
          onClick={() => setSettingsSection("phonePush")}
          title={translate("phonePush.quickOpen")}
          aria-label={translate("phonePush.quickOpen")}
          className={isMobile ? "m-top-btn" : "d-iconbtn"}
          data-fork-quick="phone-push"
        >
          <i data-ico="smartphone" data-size={isMobile ? "15" : "14"} aria-hidden="true"></i>
        </button>
        {/* fork:sw-cache-version —— 这里**只印发行号**。`NEXT_PUBLIC_APP_VERSION` 自
            2026-10-06 起是 `包版本+短sha[-dirty]`（源码指纹，SW 靠它轮换缓存，用户实测
            「改的没效果」时加的），拿它直接印出来就是 `0.1.9-beta.1+31a3fac4-dirty`
            —— 指纹对用户没有意义，只会把底栏撑长（用户 2026-10-05 实拍）。
            `+` 之后那一段是给机器看的，这里切掉；完整指纹仍在 SW 与更新检查里生效。 */}
        <span className={isMobile ? "m-badge mute" : "d-badge mute"}>
          v{(process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0").split("+")[0]}
        </span>
      </div>
    </>
  );

  const renderProjectTrustWarning = (mobileBanner: boolean) => {
    if (!showChat || !projectTrust?.requiresTrust || projectTrust.trusted) return null;
    // fork:design-system SW-16 —— 画板 60 帧 D（用户裁定）：移动端**不弹模态框**
    // （窄屏会把输入框整个挡掉），改成顶栏下方这条常驻 `.pw-banner`，横幅内联
    // 「信任」按钮直接完成信任动作；桌面维持「点开画板 50 的 pw-modal」。
    if (mobileBanner) {
      return (
        <PwaTrustBanner
          cwd={projectTrustCwd ?? ""}
          busy={projectTrustBusy}
          error={projectTrustError}
          onTrust={() => void handleTrustProject()}
        />
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
        /* fork:v5-landing —— 桌面信任提示 = 画板 D-26 的 `.d-banner.err`（错误底 + 描边）。
           组件里只做 UA 归零（margin / text-align / cursor / font-family），
           底色 / 圆角 / 字号 / 描边全部由类给。 */
        style={{
          alignSelf: "center",
          margin: 0,
          textAlign: "left",
          cursor: "pointer",
          flexShrink: 0,
          width: "auto",
          fontFamily: "inherit",
        }}
        className="d-banner err"
      >
        <i data-ico="shield-question" data-size="13" aria-hidden="true"></i>
        <span>{translate("trust.resourcesNotLoaded")}</span>
      </button>
    );
  };

  /* fork:mobile-toolbar-slim —— 会话动作 ⋯ 菜单抽成一个函数：桌面在工具条末尾、
     手机在顶栏（它是手机顶栏上**唯一**的动作）。 */
  const renderSessionActionsMenu = (mobile: boolean) => (
    /* fork:trace-menu —— 会话动作 ⋯ 菜单（置顶 / 归档 / 复制路径与 ID / 导出）。 */
    <SessionActionsMenu
          session={selectedSession
            ? {
              id: selectedSession.id,
              path: selectedSession.path,
              cwd: selectedSession.cwd,
              projectRoot: selectedSession.projectRoot,
              // fork:v5-frame-audit-2026-10-05 —— 画板 D-02d 帧D 的浮窗顶部那枚
              // `.d-pop-title` 是「会话动作 · <会话名>」。
              name: topBarSessionTitle,
            }
            : null}
          mobile={mobile}
          onRename={() => { if (selectedSession) setRenamingSessionId(selectedSession.id); }}
          onMarkUnread={() => { if (selectedSession) markSessionUnread(selectedSession.id); }}
          onReveal={() => { void revealProjectDir(selectedSession?.projectRoot ?? selectedSession?.cwd ?? ""); }}
          onCopyProjectPath={() => { void copyWithFeedback(selectedSession?.projectRoot ?? selectedSession?.cwd ?? null); }}
          onCopySessionFilePath={() => { void copyWithFeedback(selectedSession?.path ?? null); }}
          onCopySessionId={() => { void copyWithFeedback(selectedSession?.id ?? null); }}
          // fork:trace-menu-2026-10-02 —— 系统提示词 / 工具定义从顶栏收进这里，
          // 触发钮（⋯）当定位锚点，面板仍是原来那两个。
          onViewSystemPrompt={(trigger) => handleSystemInfoToggle("system", trigger)}
          onViewTools={(trigger) => handleSystemInfoToggle("tools", trigger)}
          // fork:trace-menu-2026-10-02 —— 导出改成**下载**（attachment）而不是
          // window.open：桌面端 main.js 的 setWindowOpenHandler 会把 window.open 一律
          // 交给系统浏览器，在应用里表现就是「点了没反应」。同源 <a download> 在
          // 浏览器与 Electron 里行为一致。
          onExportHtml={() => {
            if (!selectedSession) return;
            downloadSessionFile(`/api/sessions/${encodeURIComponent(selectedSession.id)}/export`);
          }}
          onExportMarkdown={() => {
            if (!selectedSession) return;
            downloadSessionFile(`/api/sessions/${encodeURIComponent(selectedSession.id)}/export?format=md`);
          }}
        />
  );

  /* fork:v5-frame-audit-2026-10-05 —— 桌面顶栏本体用 `<header>`（画板 D-01 / D-02 /
     D-02b / D-02c / D-02d 每一帧都是 `<header class="d-topbar">`），手机那一支是 PWA
     的 `<div class="m-top">` —— 板面上就是 div，不动。 */
  const TopBarTag = isMobile ? "div" : "header";

  const renderChatToolbarActions = (mobile: boolean) => {
    if (!mobile && !showChat) return null;
    /* fork:mobile-toolbar-slim（2026-10-03）—— 手机上这条工具条**只留会话动作 ⋯**。
       历史 / 生成标题 / 子代理 / 分支 / 导出 Markdown 五枚全部搬进输入区的「更多动作」
       宫格（那一格有文字、拇指够得到），于是窄屏不再需要那条**盖住会话标题**的
       覆盖层（原来五枚放不下，只能铺一层浮层盖在标题上 —— 那是「同构 + 不新增底部
       条」这条裁定的必然后果，而不是一个设计）。桌面这条不动：那里一行摆得下，
       而且顶栏本来就是它最快的入口。 */
    if (mobile) {
      return (
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-tight)" }}>
          {renderSessionActionsMenu(true)}
        </div>
      );
    }
    // fork:v5-frame-audit-2026-10-05 —— 桌面这一簇返回的是 <>...</>（平铺），外面那层
    // 无类 flex div 去掉了：画板 D-02 帧 A 的顶栏右端就是 `.d-tb-spacer` 之后
    // 一枚枚 `button.d-iconbtn` 平铺（`.d-topbar` 自带 flex + gap）。
    return (
      <>
        {/* fork:ui-14b — 完整历史 / 生成标题 / 导出 / 系统提示词 / 工具定义
            现在都是顶栏右上角的图标按钮（原来桌面上折进 ⋯ 菜单，点两次才到位）。 */}
        <button
          type="button"
          onClick={() => {
            handleViewFullHistory();
          }}
          disabled={!selectedSession}
          title={selectedSession ? translate("history.full") : translate("history.unsaved")}
          aria-label={translate("history.full")}
          /* fork:design-components —— 顶栏动作钮 = 画板 .d-iconbtn（桌面 28px）
             / 画板 60 的 .pw-touch（手机 36px 触控靶）；盒子由这两个类给，
             组件里不再重复 width/height。 */
          style={{
            margin: 0,
            padding: 0,
            color: selectedSession ? undefined : "var(--text-dim)",
            cursor: selectedSession ? "pointer" : "not-allowed",
            opacity: selectedSession ? 1 : 0.45,
          }}
          className="d-iconbtn"
        >
          <i data-ico="history" data-size="15" aria-hidden="true"></i>

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
              }}
              disabled={disabled}
              title={title}
              aria-label={label}
              /* fork:design-components —— 画板 .d-iconbtn / .pw-touch；
                 naming=loader-circle / success=check / 默认=wand-sparkles。 */
              style={{
                margin: 0,
                padding: 0,
                color: isError ? "var(--error)" : isSuccess ? "var(--accent-text)" : disabled ? "var(--text-dim)" : undefined,
                cursor: disabled ? "not-allowed" : "pointer",
                opacity: disabled && autoNameStatus.kind !== "naming" ? 0.45 : 1,
              }}
              className="d-iconbtn"
            >
              {autoNameStatus.kind === "naming" ? (
                <i data-ico="loader-circle" data-size="15" aria-hidden="true" style={{ animation: "spin var(--motion-spin) linear infinite" }}></i>
              ) : isSuccess ? (
                <i data-ico="check" data-size="15" aria-hidden="true"></i>
              ) : (
                <i data-ico="wand-sparkles" data-size="15" aria-hidden="true"></i>
              )}

            </button>
          );
        })()}
        {hasSubagentSessions && (
          <button
            type="button"
            onClick={(event) => toggleTopPanel("agents", event.currentTarget)}
            title={translate("agentSwitcher.title")}
            aria-label={translate("agentSwitcher.title")}
            aria-pressed={activeTopPanel === "agents"}
            /* fork:design-components —— 图标 + 数量徽标这一档用画板的 `.d-iconbtn`
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
            className="d-iconbtn"
          >
            <i data-ico="bot" data-size="15" aria-hidden="true"></i>

            {/* fork:v5-frame-audit-2026-10-05 —— 数量角标用库里的 `.d-badge.mute`
                （画板 D-02 帧 A：`<i data-ico="bot">` + `<span class="d-badge mute">2</span>`），
                不再是一枚内联复刻徽章盒子的无类 span。 */}
            <span
              aria-hidden="true"
              className={mobile ? undefined : "d-badge mute"}
              style={mobile ? {
                position: "absolute", top: 2, right: 2, minWidth: 13, height: 13, padding: "0 3px",
              } : { ...(activeTopPanel === "agents" ? { background: "var(--bg-selected)", color: "var(--accent)" } : {}) }}
            >
              {activeSessionFamily!.subagents.length}
            </span>
          </button>
        )}
        {sessionHasBranches && (mobile ? (
          <button
            type="button"
            onClick={(event) => toggleTopPanel("branches", event.currentTarget)}
            title={translate("i18n.branches")}
            aria-label={translate("i18n.branches")}
            aria-pressed={activeTopPanel === "branches"}
            /* fork:design-components —— 画板 .d-iconbtn / .pw-touch；会话分支用 git-fork，
               与左侧 git-branch 的 main 芯片区分。 */
            style={{
              background: activeTopPanel === "branches" ? "var(--bg-selected)" : undefined,
              color: activeTopPanel === "branches" ? "var(--text)" : undefined,
            }}
            className="d-iconbtn"
          >
            <span style={{ color: branchTree.length > 0 ? "var(--accent)" : undefined }}><i data-ico="git-fork" data-size="14"></i></span>
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
      </>
    );
  };

  /* fork:v5-frame-audit-2026-10-05 —— 顶栏**尾段**（导出 Markdown + 会话动作 ⋯）。
     画板 D-02b 帧 A 的「顶栏动作全景」把这两枚排在 MCP / 插件两枚**之后**：
       身份块 · 垫片 · 历史 · 命名 · 子代理 · 分支 · │ · MCP · 插件 · 导出 · ⋯
     此前它们和前四枚一起挂在 `renderChatToolbarActions` 里，只能落在竖分隔左边。
     回调、禁用条件、title / aria 与 icon 一字未改，只是挪了渲染位置。 */
  const renderChatToolbarTail = () => {
    if (!showChat) return null;
    return (
      <>
        {/* fork:ui-14b — 导出 Markdown 从 ⋯ 菜单搬成图标：与其它四个动作同一行，
            一眼看得见；新窗口打开（?format=md 让浏览器直接渲染，方便复制片段）。 */}
        <button
          type="button"
          onClick={() => {
            if (!selectedSession) return;
            window.open(`/api/sessions/${encodeURIComponent(selectedSession.id)}/export?format=md`, "_blank", "noopener,noreferrer");
          }}
          disabled={!selectedSession}
          title={translate("session.exportMarkdown")}
          aria-label={translate("session.exportMarkdown")}
          /* fork:design-components —— 画板 .d-iconbtn / .pw-touch；data-ico=download。 */
          style={{
            alignSelf: "center", margin: 0,
            color: selectedSession ? undefined : "var(--text-dim)",
            cursor: selectedSession ? "pointer" : "not-allowed",
            opacity: selectedSession ? 1 : 0.45,
          }}
          className="d-iconbtn"
        >
          <i data-ico="download" data-size="15" aria-hidden="true"></i>
        </button>
        {/* fork:trace-menu-2026-10-04 —— 桌面这条工具条末尾**一直缺着**会话动作 ⋯：
            `renderSessionActionsMenu` 只有 `if (mobile)` 那一处调用，所以桌面上
            置顶 / 归档 / 重命名 / 在访达中打开 / 复制路径与 ID / 导出这几项
            （手机顶栏唯一的那一枚）压根没有入口。补回同一个组件同一个参数，零新代码。 */}
        {renderSessionActionsMenu(false)}
      </>
    );
  };

  /* fork:design-components —— 顶栏标题 = 画板 D-01/D-02 的 `.d-tb-stack`：
     `d-tb-title`（一枚淡色 panel-left + 标题文本）+ `d-tb-sub`（手机副行）。
     它曾经是「最近会话」下拉的触发钮（fork:ui-18），那一档已按用户要求撤掉
     （fork:no-recent-sessions），所以现在是纯文本而不是 `<button>`。手机上表头左侧
     已经有自己的 panel-left / menu 钮，所以这里不再重复一枚图标。 */
  /* fork:mobile-tb-subtitle（2026-10-03）—— 手机顶栏的**会话身份副行**。

     窄屏看不到这个会话在哪个目录里 —— 桌面靠侧栏项目树与输入框上方的 `.pw-ctxbar`，
     而手机上抽屉是关着的，副行是唯一能一眼说清「我在哪」的地方。上下文百分比同理：
     环只在浮窗里报数，副行是常驻的那个数字。

     **刻意只放这两项**，不照搬参照物的五项（`cwd · model · thinking · Context% · 运行中`）：
       · model 与 thinking 已经在输入区常驻（行一的模型选择器、行二的思考芯片）——
         再放一份就是「同一块屏上摆两枚同一个读数」，AGENTS.md 为这种事记过好几次裁定；
       · 「运行中」也不用写：发送钮这时已经翻成「停止」，比一个词更明确。
     副行只在手机渲染（`is-stacked` 只挂窄屏），桌面那一行一字不变。 */
  const topBarSubtitle = (() => {
    if (!selectedSession) return null;
    const parts: string[] = [];
    if (selectedSession.cwd) parts.push(pathBasename(selectedSession.cwd));
    const percent = sessionStats?.contextUsage?.percent;
    if (typeof percent === "number") parts.push(`${translate("topbar.context")} ${Math.round(percent)}%`);
    return parts.length > 0 ? parts.join(" · ") : null;
  })();

  const renderSessionTitle = () => {
    const subtitle = topBarSubtitle;
    /* fork:v5-wave-b-2026-10-04 —— 窄屏标题照画板 M-01 帧 A / M-04 帧 A / M-12 帧 A
       的 `<span class="m-top-title m-grow">设计体系 V5 · PWA 画板</span>` 落成：
       `.m-top-title`（fs-lg / 600 / 单行省略）此前在产品里没挂过 —— 手机顶栏标题
       一直是 `.d-tb-stack` 一套，而 d-* 只在 ≥641 生效，所以 ≤640 上这一格**没有任何
       规则命中**（长标题不省略、不换行控制）。
       副行保留（fork:mobile-tb-subtitle 的既有功能，删它就是删功能），但换 PWA 的
       字号件：`.m-t-xs.m-t-faint` 承担 `.d-tb-sub` 在画板里的角色。
       桌面那一支逐字不动。 */
    if (isMobile) {
      return (
        <div
          /* fork:v5-frame-audit —— 画板那一格是 `<span class="m-top-title m-grow">`：
             `m-grow`（flex:1 / min-width:0）就是那一格在 `.m-top`（flex 行）里的
             位置。产品此前用内联 flex/minWidth 复刻同一件事（间距值第二个来源），
             换成库里的类；副行（cwd · 上下文占用）是 fork:mobile-tb-subtitle 的
             既有行为，保留。 */
          className="m-grow"
          title={subtitle ? `${topBarSessionTitle} · ${subtitle}` : topBarSessionTitle}
          style={{ display: "flex", flexDirection: "column", justifyContent: "center", minWidth: 0 }}
        >
          <span className="m-top-title">{topBarSessionTitle}</span>
          {subtitle && <span className="m-t-xs m-t-faint">{subtitle}</span>}
        </div>
      );
    }
    return (
<div
  title={subtitle ? `${topBarSessionTitle} · ${subtitle}` : topBarSessionTitle}
  className="d-tb-stack"
>
  {/* fork:v5-frame-audit-2026-10-05 —— 身份块逐节点照画板：
      · 没有运行中芯片 / 分支芯片时（D-01 帧 A/B、D-02 帧 B/D、D-02b、D-02c、D-02d
        每一帧的顶栏）就是 `d-tb-stack` 的两个平级子节点：
        `<span class="d-tb-title">` + `<span class="d-tb-sub">`；
      · 有芯片时（D-02 帧 A/C）板面把两者包进一枚 `span.d-row`，芯片接在标题后面。
      产品此前无条件套了 `span.d-row`，并给标题前面多加了一枚 `panel-left` 图标
      （板面标题左边是空的）—— 两处都按板面去掉。
      · 副行：此前只在手机渲染（fork:mobile-tb-subtitle）。画板 D-01 帧 A/B/C/D 与
        D-02 帧 A/B/C/D 的**桌面**顶栏都有一行 `d-tb-sub`，内容就是
        「项目 · 上下文 %」—— 补上（同一份数据，零新取值）。
        fork:no-tb-sub（2026-10-05 用户裁定）—— 那一行随后被去掉：项目名在侧栏、
        在文件面板头、在输入卡上都已经写着，顶栏再写一遍是第四遍；而且两行叠起来
        把标题挤到顶上去。桌面只留标题（`.d-tb-stack` 一行即居中），窄屏那行
        （fork:mobile-tb-subtitle 的既有功能）不动。 */}
  {selectedSession && (runningSessionIds.has(selectedSession.id) || topBarBranch) ? (
    <span className="d-row" style={{ gap: "var(--nx-sp-2)" }}>
      <span className="d-tb-title">{topBarSessionTitle}</span>
      {runningSessionIds.has(selectedSession.id) && (
        // 画板 01 帧 B：运行中在标题右侧给一枚状态芯片。
        <span className="d-chipbtn">
          {/* fork:v5-landing —— 运行中 spinner = 画板 `.d-run`（首枚 `<i>` 自带 nx-spin），
              不再用旧 `.pw-anim-spin`。 */}
          <span className="d-run" style={{ gap: 0 }}>
            <i data-ico="loader-circle" data-size="14" aria-hidden="true"></i>
          </span>
          {translate("chat.running")}
        </span>
      )}
      {topBarBranch && (
        /* fix:branch-chip-clickable —— 画板 01 帧 A/B / 02 帧 B：分支芯片是**可点
           的下拉触发钮**（git-branch + 分支名 + chevron-down），点开是工作区
           （worktree）列表。原来这里是个没有 onClick 的 `<span class="d-chipbtn">`
           —— 用户实测「这个 main 点不了」。改用 TopBarPopovers 的 BranchChip
           （它本来就是照画板写的，只是没接线）。选中另一个工作区 = 切目录并在
           那里开一个新 composer，与侧栏 worktree 切换同一动作。 */
        <BranchChip
          branch={topBarBranch}
          cwd={selectedSession?.cwd ?? newSessionCwd ?? ""}
          onSelectWorkspace={(path) => void startSessionIn(path).then((failure) => { if (failure) showToast(failure); })}
        />
      )}
    </span>
  ) : (
    <span className="d-tb-title">{topBarSessionTitle}</span>
  )}
</div>
    );
  };

  /* fork:mobile-action-panel（2026-10-03）—— 窄屏「更多动作」宫格的内容。
     这些动作的实现本来就都在 AppShell 里（handleViewFullHistory / handleAutoName /
     导出 / 顶栏浮层），所以在这里组装成节点交给 ChatInput，而不是往它那条已经很长的
     属性表上再接九个回调。

     为什么只有这七格：**同一块屏上不摆第二个入口**。
     · 「压缩上下文」与「会话信息」已经在输入区上下文环的浮窗里（AGENTS.md 记过
       一次为此删掉重复入口的裁定），再放一格就是「一眼看去像两件事」。
     · 「系统提示词 / 工具定义」是低频只读诊断，刚从顶栏收进 ⋯ 菜单（fork:trace-menu），
       再搬回宫格等于把那次裁定撤销。
     · 「置顶 / 重命名 / 归档 / 复制路径」是一族菜单项，留在 ⋯ 菜单里成组，不拆进宫格。
     宫格与顶栏的旧入口在 PR-1 里**并存**（纯增量），顶栏瘦身在 PR-2。 */
  const renderMobileActionPanel = () => {
    const hasMessages = Boolean(
      selectedSession
      && ((sessionStats?.userMessages ?? 0) > 0 || selectedSession.messageCount > 0),
    );
    const namingBusy = autoNameStatus.kind === "naming";
    return (
      <MobileActionPanel
        cells={[
          {
            id: "trace",
            label: translate("actionPanel.trace"),
            icon: "history",
            disabled: !selectedSession,
            onSelect: () => handleViewFullHistory(),
          },
          {
            id: "name",
            label: namingBusy ? translate("title.generating") : translate("title.generate"),
            icon: "wand-sparkles",
            busy: namingBusy,
            disabled: !selectedSession || selectedSession.transient || !hasMessages,
            onSelect: () => void handleAutoName(),
          },
          hasSubagentSessions ? {
            id: "agents",
            label: translate("actionPanel.agents"),
            icon: "bot",
            onSelect: (trigger: HTMLElement) => toggleTopPanel("agents", trigger),
          } : null,
          sessionHasBranches ? {
            id: "branches",
            label: translate("actionPanel.branches"),
            icon: "git-fork",
            onSelect: (trigger: HTMLElement) => toggleTopPanel("branches", trigger),
          } : null,
          {
            id: "export-html",
            label: translate("actionPanel.exportHtml"),
            icon: "download",
            disabled: !selectedSession,
            onSelect: () => {
              if (selectedSession) downloadSessionFile(`/api/sessions/${encodeURIComponent(selectedSession.id)}/export`);
            },
          },
          {
            id: "export-md",
            label: translate("actionPanel.exportMarkdown"),
            icon: "file-text",
            disabled: !selectedSession,
            onSelect: () => {
              if (selectedSession) downloadSessionFile(`/api/sessions/${encodeURIComponent(selectedSession.id)}/export?format=md`);
            },
          },
          {
            id: "image",
            label: translate("chat.sendImage"),
            icon: "image",
            disabled: !selectedSession,
            onSelect: () => chatInputRef.current?.openImagePicker(),
          },
        ]}
      />
    );
  };

  /* fork:trace-menu —— 重命名态：同一个位置换成输入框（画板 02 那一行的 `.d-input`）。
     回车提交、Esc 取消、失焦提交；提交后 bump refreshKey 让侧栏立刻跟上。 */
  const renderSessionRename = () => {
    const sessionId = renamingSessionId && selectedSession?.id === renamingSessionId ? renamingSessionId : null;
    if (!sessionId || !selectedSession) return renderSessionTitle();
    return (
      <input
        className="d-input"
        defaultValue={selectedSession.name ?? ""}
        placeholder={selectedSession.firstMessage?.slice(0, 50) ?? ""}
        autoFocus
        aria-label={translate("session.rename")}
        style={{ width: "min(360px, 46vw)", height: "var(--control-sm)", margin: 0 }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            setRenamingSessionId(null);
            return;
          }
          if (event.key !== "Enter") return;
          event.preventDefault();
          commitSessionRename(sessionId, event.currentTarget.value);
        }}
        onBlur={(event) => commitSessionRename(sessionId, event.currentTarget.value)}
      />
    );
  };


  /* fork:zn-21 / fork:design-components —— 折叠导轨照画板 02 帧 C 重抄（2026-09-30）。
     画板那一条是**全高竖列**：logo 在顶，展开 / 搜索 / 新建会话居中，设置贴底，
     面板底 + 发丝右线。原实现是绝对定位在顶栏左端的 3 按钮浮块 —— 少了 logo 与设置，
     也不占列宽（顶栏只能靠 92px 的 leading inset 给它让位），与画板结构不同。
     macOS 的红绿灯压住这一列顶端：那一段让位放在 fork-ui.css 的平台钩子里，
     不写进内联（`[data-desktop-platform="darwin"] .pw-rail`）。 */
  const renderCollapsedRail = () => (
    // fork:v5-frame-audit-2026-10-05 —— 导轨逐节点照画板 D-02 帧 B：
    //   `<nav class="d-rail"><div class="d-logo"><img></div>`
    //   `<button class="d-iconbtn is-on"><i panel-right></button>…</nav>`
    // 三处改动：导轨本体 `nav`（板面是导航地标）、品牌盒 `div`、四枚动作钮里的
    // `<span>` 壳去掉（板面上 `<i data-ico>` 就是按钮的直接子节点）；第一枚
    // `is-on` 现在跟「侧栏此刻是不是收着的」绑定 —— 导轨存在就意味着收着，
    // 此前挂在「有没有选中会话」上，语义反了。
    <nav
      className="d-rail"
      style={{
        flexShrink: 0,
        zIndex: 200,
      }}
    >
      {/* 画板 02 的导轨顶端是应用标记（口径 24×24 + canvas 底 + 发丝边，
          board.css 的 `.pw-rail .d-logo` 承担全部视觉）。 */}
      <div className="d-logo" aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element -- 静态品牌资产，不走 next/image 优化器 */}
        <img src="/pi-next-logo.png" alt="" draggable={false} style={{ display: "block", width: "var(--icon-md)", height: "auto" }} />
      </div>
      <button
        type="button"
        onClick={handleSidebarToggle}
        aria-controls="session-sidebar"
        aria-expanded={false}
        title={translate("sidebar.show")}
        aria-label={translate("sidebar.show")}
        className="d-iconbtn is-on"
      >
        {/* 画板 02 的导轨第一枚是 panel-right（把侧栏拉回来）。 */}
        <i data-ico="panel-right" data-size="16"></i>
      </button>
      <button
        type="button"
        onClick={() => {
          setSidebarOpen(true);
          setSearchRequestId((id) => id + 1);
        }}
        title={translate("sidebar.toggleSessionSearch")}
        aria-label={translate("sidebar.toggleSessionSearch")}
        className="d-iconbtn"
      >
        <i data-ico="search" data-size="16"></i>
      </button>
      <button
        type="button"
        onClick={() => {
          // 与导轨里的「新建任务」同义：在当前目录开一条新会话。`startSessionIn`
          // 已经是 AppShell 里「切目录 + 起新会话」的既有入口，不另写一份。
          setSidebarOpen(true);
          const cwd = selectedSession?.cwd ?? newSessionCwd ?? activeCwd ?? null;
          if (cwd) void startSessionIn(cwd).then((failure) => { if (failure) showToast(failure); });
        }}
        title={translate("sidebar.newTask")}
        aria-label={translate("sidebar.newTask")}
        className="d-iconbtn"
      >
        <i data-ico="square-pen" data-size="16"></i>
      </button>
      <span className="d-grow" />
      {/* 画板 02 的导轨贴底是设置入口（侧栏展开时它在 .pw-side-foot）。 */}
      {/* fork:lan-access —— 手机配对在设置里当一个分节（`lanPair`），**不**往这里加第五枚
          按钮：导轨几何是画板 02 登记过的（`AppShell.design-components.test.mjs` 数着
          按钮个数），机器级动作归设置页。 */}
      <button
        type="button"
        onClick={() => setSettingsSection(getLastSettingsSection(projectTrustCwd))}
        title={translate("common.settings")}
        aria-label={translate("common.settings")}
        className="d-iconbtn"
      >
        <i data-ico="settings" data-size="16"></i>
      </button>
    </nav>
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
      <span><i data-ico="menu" data-size="18"></i></span>
    </button>
  );

  /* fork:v5-m12 —— M-12 · 手机右栏面板入口（窄屏）。
     列表项以当前右栏真实页签（`panelTabs`）为准：轨迹 / Git / 文件 / 终端 /
     浏览器 / 会话 —— 「审查」已在 2026-10-03 裁定里从右栏删掉，画板还写着六项，
     这里以产品为准（画板待设计侧跟进）。之所以复用同一份数据而不是另列一份：
     另列一份就会与真实页签漂移（多一个「轨迹」入口却选不到、或少一个已打开的
     终端），而这正是「同一个视觉两个来源」。
     `render: () => renderTabContent(tab.id, false)` 是惰性的 —— 只有切到那一块
     才挂载，所以不会出现「终端起两个 PTY / 查看器双份取数」的双挂载。
     fork:m12-resident-blocks（2026-10-05 用户反馈「选单空了」）—— 轨迹 / Git 是
     **单例布尔块**，关着时 `panelTabs` 里没有它们，选单就只剩一句脚注、什么也
     进不去；这违背 M-12 帧 A「六项常驻」的裁定。所以这两块关闭时也补一行
     （`onSelect` 先把块打开，key 就是单例 tab id —— 打开后 `panelTabs` 里的
     同 key 行接替它，选单既不重复也不换来源）。文件 / 终端 / 浏览器 / 会话
     仍是「开了才列」：它们没有不依赖具体页签的正文。 */
  /* fork:v5-m12 —— M-12 帧 A「六项常驻」：**一行 = 一块**，不是一行 = 一个页签。
     之前这里以 `panelTabs` 为准（开着什么列什么），于是手机上常常只剩两行 ——
     「六块共用一层切换条」写在选单分组标题上，行却不到六块。
     现在固定六行，与画板同序：轨迹 / 文件 / 终端 / 浏览器 / Git / 审查。
     每行的现状一句取自真实数据（关着就写「未打开 · 点按打开」），点它是
     「开着就切过去，没开先把块打开」，所以这六行永远进得去。
     「审查」与 M-06 帧 E 是同一个入口：2026-10-03 裁定删掉了独立改动 tab，
     清单只留在文件树里那一节，所以这一行进的是树 + 展开改动（`openChangesSignal`），
     不是另起一块正文 —— 那才是「同一个视觉两个来源」。
     `renderTabContent` 在本函数之后才声明（它依赖下面的面板区 JSX），所以这里不能用它
     做依赖。改成**惰性 ref**：列表项的 render 只在切到那一块时才读它，
     而那一块能渲染出来时它必然已经初始化 —— 既不提前读，也不在依赖数组里出现。
     终端 / 浏览器关着时 `onSelect` 现开一个页签，`openKey` 与它同批提交，
     重渲染后本行已指向那个新页签，所以 `render` 第一次调用就拿得到正文。 */
  const renderTabContentRef = useRef<((tabId: string, resident: boolean) => React.ReactNode) | null>(null);
  /* 「文件」与「审查」两块的正文就是文件面板那一列树。它在本函数**之后**才声明
     （它依赖 handleOpenFile 等一串回调），所以同样走惰性 ref：render 切到那两块
     时才读，那时它必然已经赋值。 */
  const explorerPanelRef = useRef<React.ReactNode>(null);
  /* 与 openGitGraphTab / handleViewFullHistory 同一动作，但不 setRightPanelOpen ——
     手机上没有桌面右栏，别为它留一个「回到桌面时面板突然开着」的尾巴。 */
  const openMobileTrace = useCallback(() => {
    setTraceOpen(true);
    setActiveFileTabId(TRACE_TAB_ID);
  }, []);
  const openMobileGitGraph = useCallback(() => {
    setGitGraphOpen(true);
    setActiveFileTabId(GIT_GRAPH_TAB_ID);
  }, []);
  /* 「审查」块：2026-10-03 裁定后它是文件树里那一节，所以这一块打开的是文件面板，
     并把改动那一节叫开（`openChangesSignal` 递增）。正文直接给 `explorerPanel`
     ——与桌面右栏那一列同一个节点，不另画一份树。 */
  const openMobileReview = useCallback(() => {
    setChangesOpen(true);
    setChangesSignal((n) => n + 1);
    if (!fileTabs.length && activeFileTabId !== FILE_PANEL_TAB_ID) setActiveFileTabId(FILE_PANEL_TAB_ID);
  }, [activeFileTabId, fileTabs.length]);

  const mobileRightPanelItems = useMemo<MobileRightPanelItem[]>(() => {
    /* 一块 = 图标 / 名字 / 现状一句 / 行尾徽章 / 点它做什么 / 正文。
       「开着没」决定 onSelect 是切过去还是先开，而现状一句照实写：开着写它真实的
       标识（页签名 / 路径 / URL），关着写「未打开 · 点按打开」——板面上那六个数字
       （1,284 个文件 / 领先 3 个提交…）本仓此刻拿不到就不编，写不出就照实说关着。 */
    const closed = translate("pwa.rightPanels.closedHint");
    const terminalTab = terminalTabs[0];
    const browserTab = browserTabs[0];
    const fileTab = fileTabs.find((tab) => tab.id === activeFileTabId) ?? fileTabs[0];

    return [
      {
        key: TRACE_TAB_ID,
        icon: "history",
        label: translate("trace.title"),
        description: traceOpen ? translate("trace.title") : closed,
        trailing: traceOpen ? <span className="m-dot" /> : undefined,
        onSelect: openMobileTrace,
        render: () => (renderTabContentRef.current?.(TRACE_TAB_ID, false) ?? null),
      },
      {
        key: FILE_PANEL_TAB_ID,
        icon: "folder-tree",
        label: translate("pwa.rightPanels.files"),
        description: fileTab ? fileTab.label : closed,
        trailing: fileTab ? <span className="m-badge mute">{translate("pwa.rightPanels.treeAndViewer")}</span> : undefined,
        onSelect: () => { if (fileTab) setActiveFileTabId(fileTab.id); },
        render: () => (fileTab
          ? renderTabContentRef.current?.(fileTab.id, false) ?? null
          : explorerPanelRef.current),
      },
      {
        /* fork:v5-m12-key（2026-10-06）—— key **必须是块的 id，不能是页签 id**。
           `RightPanelsMobile` 把选中的那一块记在 `openKey` state 里，而 `onSelect`
           与 `enter(key)` 在同一个点击里跑：关着的终端一点，onSelect 就新建了一个
           页签，本行的 key 于是从 `terminal-block` 变成那个真实页签 id，而 `openKey`
           还停在旧值 —— `items.find(i => i.key === openKey)` 找不到任何一行，
           `layerItem` 变 undefined，整层**什么都不渲染**（实测：切到终端是一片空白，
           连键排都没有）。所以 key 恒为块 id，页签 id 只在 `render` / `onSelect`
           里面现算。 */
        key: TERMINAL_BLOCK_KEY,
        icon: "terminal",
        label: translate("pwa.rightPanels.terminal"),
        description: terminalTab ? terminalTab.cwd : closed,
        trailing: terminalTab ? <span className="m-dot" /> : undefined,
        containerClassName: "m-panel-scroll m-term-mobile",
        onSelect: () => { if (terminalTab) setActiveFileTabId(terminalTab.id); else handleOpenTerminal(activeCwd ?? ""); },
        render: () => (terminalTab ? renderTabContentRef.current?.(terminalTab.id, false) ?? null : null),
      },
      {
        key: BROWSER_BLOCK_KEY,
        icon: "globe",
        label: translate("pwa.rightPanels.browser"),
        description: browserTab ? browserTab.url : closed,
        trailing: browserTab ? <span className="m-badge mute">{translate("pwa.rightPanels.readOnly")}</span> : undefined,
        onSelect: () => { if (browserTab) setActiveFileTabId(browserTab.id); else handleOpenBrowser(); },
        render: () => (browserTab ? renderTabContentRef.current?.(browserTab.id, false) ?? null : null),
      },
      {
        key: GIT_GRAPH_TAB_ID,
        icon: "git-branch",
        label: translate("git.graph"),
        description: gitGraphOpen ? (activeCwd ?? "") : closed,
        onSelect: openMobileGitGraph,
        render: () => (renderTabContentRef.current?.(GIT_GRAPH_TAB_ID, false) ?? null),
      },
      {
        key: REVIEW_BLOCK_KEY,
        icon: "file-diff",
        label: translate("pwa.rightPanels.review"),
        description: reviewCount > 0
          ? translate("pwa.rightPanels.reviewCount", { count: reviewCount })
          : closed,
        trailing: reviewCount > 0 ? <span className="m-badge mute">{reviewCount}</span> : undefined,
        onSelect: openMobileReview,
        render: () => explorerPanelRef.current,
      },
    ];
  }, [
    activeCwd, activeFileTabId, browserTabs, fileTabs, gitGraphOpen,
    handleOpenBrowser, handleOpenTerminal, openMobileGitGraph, openMobileReview,
    openMobileTrace, reviewCount, terminalTabs, traceOpen, translate,
  ]);

  const renderMainFileToggle = (mobile: boolean) => {
    if (mobile) {
      /* fork:v5-m12 —— 窄屏：入口与两层（底部选单 → 全屏层）都由 M-12 组件自带，
         它内部就发那枚 `.m-top-btn` 入口钮，所以这一支不再另外画按钮。 */
      return (
        <MobileRightPanels
          items={mobileRightPanelItems}
          title={translate("pwa.rightPanels.title")}
          closeLabel={translate("chat.close")}
        />
      );
    }
    /* fork:mobile-toolbar-slim —— 这枚钮原来在窄屏要被「盖住」处理（覆盖层铺开时
       把它 visibility:hidden + disabled + aria-hidden）。覆盖层拆了，这套三件套
       也一起删：一枚永远可点、永远在无障碍树里的面板开关。 */
    const label = mobile
      ? rightPanelOpen ? translate("files.hidePanel") : translate("files.showPanel")
      : rightPanelOpen ? translate("layout.hideSecondaryWorkspace") : translate("layout.showSecondaryWorkspace");
    return (
      <button
        type="button"
        onClick={handleRightPanelToggle}
        /* fork:v5-wave-b —— 手机上这一枚是画板 **M-12 帧 A** 的入口钮：`.m-top-btn`
           （玻璃圆钮 / 44px 触控靶 / panel-right）。框由 m-top-btn 给，所以窄屏那条
           不再挂内联几何；handler / aria-controls / aria-expanded / title / 两条
           data-* 全部不变，桌面那一支一个字也没改。 */
        className="desktop-secondary-workspace-toggle"
        aria-controls={secondaryWorkspaceId}
        aria-expanded={rightPanelOpen}
        title={label}
        aria-label={label}
        data-mobile-toolbar-file={mobile ? "true" : undefined}
        style={mobile ? undefined : {
          // fork:ui-topbar-align — see the sidebar toggle: same 9px offset.
          position: "absolute",
          top: "calc(var(--safe-top) + (var(--height-toolbar, 36px) - var(--control-md, 28px)) / 2)",
          // The resizer writes this CSS variable on every pointer move, while
          // React state is intentionally committed only when dragging ends.
          // Reading the variable here keeps the divider control in lockstep.
          // When the secondary region is collapsed, the role-switch control
          // is absent, so this is the only remaining desktop control.
          right: rightPanelOpen
            ? "var(--right-panel-width)"
            : "0px",
          zIndex: 260,
          marginLeft: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
          width: TOP_BAR_ICON_BUTTON_SIZE, height: TOP_BAR_ICON_BUTTON_SIZE, padding: 0, borderRadius: "var(--radius-md)",
          // Keep the boundary control on the same light surface as the
          // header. The open state is conveyed by the accent color instead
          // of a heavy selected background.
          background: rightPanelOpen ? "var(--bg-panel)" : "none",
          border: "none", borderLeft: "1px solid var(--border)",
          color: rightPanelOpen ? "var(--accent)" : "var(--text-muted)",
          cursor: "pointer", flexShrink: 0, transition: "color 0.12s, background 0.12s",
        }}
        onMouseEnter={(event) => { event.currentTarget.style.color = "var(--text)"; }}
        onMouseLeave={(event) => { event.currentTarget.style.color = rightPanelOpen ? "var(--accent)" : "var(--text-muted)"; }}
      >
        {/* fork:pwa-tablet-tier — a bare rect + divider read as an empty box (a loading
            placeholder) at 16px in a 44px bar. The skin's lucide panel-right keeps the
            "page with a side panel" reading and stays inside the icon system. */}
        {/* fork:design-components —— 皮肤 lucide 图标：panel-right。 */}
        {mobile ? (
          <i data-ico="panel-right" data-size="16"></i>
        ) : (
        <span>
          <i data-ico="panel-right" data-size="16"></i>
        </span>
        )}
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
        top: "calc(var(--safe-top) + (var(--height-toolbar, 36px) - var(--control-md, 28px)) / 2)",
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
      <span>
        <i data-ico="columns-2" data-size="16"></i>
      </span>
    </button>
  );

  // The tree is rendered in two places: as the panel's own content when no tab is
  // open, and as a right-hand column beside the active viewer. Sharing one node
  // keeps the two spots from drifting apart.
  // fork:ui-panel-row — true when the tree itself occupies the panel, i.e. no
  // file/terminal/browser tab is active. 手机档它还管着面板级动作（浏览器钮）要不要
  // 进 `.m-top`；桌面档 2026-10-06 起这两枚动作都住在面板头行（见下面的
  // `panelHeadActions`），文件树头行不再重复。
  const showExplorerToolbarRow = Boolean(
    activeCwd
    && !activeFileTab?.filePath
    && !terminalTabs.some((tab) => tab.id === activeFileTabId)
    && !browserTabs.some((tab) => tab.id === activeFileTabId),
  );

  const browserTabButton = (
    /* fork:design-components —— 面板头行的动作钮一律是画板 30/01 的 `.d-iconbtn.sm`
       （22px / 发丝 hover 叠色），原来挂的是自绘的 `file-viewer-icon-button`
       （26px / 自己的颜色与 hover），比同排其余钮大一圈、颜色也对不上。 */
    <button
      type="button"
      className="d-iconbtn"
      title={translate("browser.newTab")}
      aria-label={translate("browser.newTab")}
      onClick={() => handleOpenBrowser()}
    >
      <span><i data-ico="globe" data-size="14"></i></span>
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
      /* fork:v5-m12 —— 手机选单里那两行（「审查」行写几个文件待看 / 点它展开改动）。 */
      openChangesSignal={changesSignal}
      onReviewCountChange={setReviewCount}
      /* fork:v5-m12-pane —— 手机上这棵树**永远**在另一条顶栏底下：要么是 M-12 那个
         pane 的六项横滚切换条，要么是文件查看器自己的 `.m-viewer-bar`。所以窄屏
         一律不再画第二条 `.m-top`（画板 M-12 帧 B 的 pane 里只有一层内容）。 */
      inPanel={isMobile}
      trailingActions={isMobile && showExplorerToolbarRow ? browserTabButton : null}
    />
  ) : null;
  explorerPanelRef.current = explorerPanel;

  // fork:pr40-split —— 一个 tab 的内容。单列与分屏共用同一个函数，避免两条渲染路径
  // 各自漂移（上一轮自动合并就是在这块 JSX 上断的）。
  //   `resident` = 单列常驻：切走只 `hidden`，滚动位置 / 搜索 / 未保存的 markdown
  //     编辑态都保留（fork:file-tab-keep-alive）。
  //   分屏时 `resident = false`：**每个 Pane 只挂自己那一个 tab** —— 沿用「全量常驻
  //     + hidden」会让同一个终端 tab 被两个 Pane 各起一个 PTY。
  const renderTabContent = (tabId: string, resident: boolean) => {
    const isActive = resident ? tabId === activeFileTabId : true;
    // 常驻模式需要一层盒子才能 hidden；分屏模式那一层由 SplitPaneHost 提供。
    const box = (node: React.ReactNode, key: string) => (
      resident
        ? <div key={key} hidden={!isActive} style={{ width: "100%", height: "100%" }}>{node}</div>
        : node
    );
    if (tabId === GIT_GRAPH_TAB_ID) {
      if (!gitGraphOpen) return null;
      // fork:git-graph-tab — 点提交里的文件直接开 diff 视图（FileViewer 已支持 modeHint）。
      return box(
        <GitGraphTab
          cwd={activeCwd ?? ""}
          onOpenFile={(filePath, fileName) => handleOpenFile(filePath, fileName, { modeHint: "diff" })}
        />,
        tabId,
      );
    }
    if (tabId === TRACE_TAB_ID) {
      if (!traceOpen) return null;
      // fork:trace-frame —— 内容就是「完整历史」那一页（pi 自己导出的会话页），
      // 装进右栏这个单例 tab，页头另有刷新与全屏两枚钮。
      return box(
        <TraceFrame
          key={selectedSession?.id ?? "no-session"}
          sessionId={selectedSession?.id ?? ""}
          title={selectedSession?.name ?? topBarSessionTitle}
          active={isActive}
        />,
        tabId,
      );
    }
    const fileTab = fileTabs.find((tab) => tab.id === tabId);
    if (fileTab) {
      // 常驻模式下文件 tab 只在首次激活后挂载（关闭后由剪枝 effect 剔除）；
      // 分屏时这一格就是它自己的内容，没有「先激活再挂」这一步。
      if (resident && !mountedFileTabs.has(fileTab.id)) return null;
      return box(
        <FileViewer
          key={`${fileTab.id}:${fileTab.viewerRevision ?? 0}`}
          filePath={fileTab.filePath}
          cwd={activeCwd ?? undefined}
          sourceSessionId={fileTab.sourceSessionId}
          locationTarget={isActive && pendingFileLocation && sameFilePath(pendingFileLocation.filePath, fileTab.filePath)
            ? pendingFileLocation
            : null}
          onLocationHandled={handleFileLocationHandled}
          onLocationFailed={handleFileLocationFailed}
          gitRefreshKey={explorerRefreshKey}
          initialDisplayMode={fileTab.initialDisplayMode}
          initialPage={fileTab.page}
          initialState={fileTab.viewerState}
          watchEnabled={editorVisible && isActive}
          onStateChange={(viewerState) => handleFileViewerStateChange(
            fileTab.id,
            fileTab.viewerRevision ?? 0,
            viewerState,
          )}
          onMentionLines={editorVisible && isActive ? handleFileLineMention : undefined}
          onAskInNewChat={editorVisible && isActive ? handleFileSelectionInNewChat : undefined}
          onAtMention={handleAtMention}
          onOpenFile={(filePath, page) => handleOpenFile(
            filePath,
            getFileName(filePath),
            { sourceSessionId: fileTab.sourceSessionId, page },
          )}
        />,
        fileTab.id,
      );
    }
    const branchTab = branchTabs.find((tab) => tab.id === tabId);
    if (branchTab) {
      return box(
        <ExplorationPane
          sessionId={branchTab.sessionId}
          parentSessionId={branchTab.parentSessionId}
          onOpenAsMain={handleOpenSession}
        />,
        branchTab.id,
      );
    }
    const browserTab = browserTabs.find((tab) => tab.id === tabId);
    if (browserTab) {
      return box(<BrowserPanel tab={browserTab} onChangeUrl={handleBrowserUrlChange} />, browserTab.id);
    }
    const terminalTab = terminalTabs.find((tab) => tab.id === tabId);
    if (terminalTab) {
      return box(
        <TerminalPanel
          tab={terminalTab}
          active={editorVisible && isActive}
          onRestart={() => setTerminalTabs((tabs) => tabs.map((item) => item.id === terminalTab.id ? { ...item, closing: "restart" } : item))}
          onClosed={() => handleTerminalClosed(terminalTab)}
          onCloseError={() => setTerminalTabs((tabs) => tabs.map((item) => item.id === terminalTab.id ? { ...item, closing: undefined } : item))}
        />,
        terminalTab.id,
      );
    }
    return null;
  };

  // fork:v5-m12 —— 手机 M-12 那一层的惰性入口：挂在声明之后。列表项的 render
  // 只在切到那一块时才读它（那时它必然已初始化）。
  renderTabContentRef.current = renderTabContent;

  // Only wide panels can afford a tree column next to the document (PiDeck-style
  // "document in the middle, file tree on the right"). The width itself is
  // measured by a container query on .file-panel-body — the panel's rendered
  // width comes from the layout grid (1fr in the main region) and is not the
  // resizer's stored width.
  const showExplorerColumn = Boolean(
    explorerPanel
    && !isMobile
    // fork:pr40-split — 分屏时不要再抢一列树：两个 Pane 已经把 720px 的下限用满，
    // 再塞一列树就是三个都读不了。退分屏后这一列自己回来。
    && !splitPanes.isSplitActive
    // fork:trace-pane-2026-10-04 —— 文件树不再被「调用轨迹」挤掉。原来这一列的
    // 条件是「**激活的**那个 tab 有没有路径」，于是切到 trace（无路径）整列消失，
    // 用户说的就是「开了轨迹就看不到文件夹了」。它是个只读视图、有路径的邻居还开着，
    // 给它一列树才是对的；真正需要整块宽度的是 Git 图谱，仍旧独占。
    && activeFileTabId !== GIT_GRAPH_TAB_ID
    && (fileTabs.length > 0
      || terminalTabs.length > 0
      || browserTabs.length > 0
      || activeFileTabId === TRACE_TAB_ID),
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
          transform: translateX(calc(-100% - var(--safe-left)));
          box-shadow: none;
        }
      }
    `}</style>
    {/* The tree is rendered in two places: as the panel's own content when no tab
        is open, and as a right-hand column beside the active viewer. One node
        keeps the two spots from drifting apart. */}
    {(() => {})()}
    <div ref={appShellRef} className="app-shell-layout d-shell" style={{
      position: "relative",
      display: "flex",
      width: "100%",
      height: "var(--app-viewport-height, 100dvh)",
      "--sidebar-width": `${sidebarResizer.width}px`,
      paddingLeft: "var(--safe-left)",
      paddingRight: "var(--safe-right)",
      overflow: "hidden",
      background: "var(--bg)",
    } as React.CSSProperties}>
      {/* Full-window wallpaper, behind the sidebar, chat and right panel.
          First child of the workspace row so every later sibling paints above
          it, and a sibling of the chat column for the scrim rules in
          app/wallpaper.css. */}
      <WallpaperLayer />
      {/* Mobile overlay backdrop */}
      {/* fork:v5-wave-b —— 遮罩用画板 M-04 的 `.m-scrim`（≤640 生效），≥641 仍是
          `.d-scrim`。两套类名在**不同媒体条件**里（d-* 只在 min-width:641px、m-* 只在
          max-width:640px），所以同一个节点挂两个类不冲突，也不会互相覆盖 —— 这是
          Wave B 过渡口径下唯一允许的“双类”（故在此注释说明为什么）。 */}
      <div
        className={`sidebar-overlay-backdrop d-scrim${isMobile ? ` m-scrim${sidebarOpen ? " is-open" : ""}` : ""}${mobileSidebarReady ? "" : " sidebar-mobile-pending"}`}
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
        /* fork:v5-wave-b —— 抽屉本体 = 画板 M-04 的 `.m-drawer`（≤640 生效）：
           `width: min(84%, 320px)` / 右侧大圆角 / translateX 推拉 320ms，开合由
           `.is-open` 表达（与 `sidebar-open` 同一个 state，不新增状态）。≥641 仍是
           `.d-side` + globals.css 的停靠宽度。两套形态类各在自己的媒体条件里生效。 */
        className={`sidebar-container d-side${isMobile ? " m-drawer" : ""}${sidebarOpen ? " sidebar-open" : " sidebar-closed"}${sidebarOpen && isMobile ? " is-open" : ""}${mobileSidebarReady ? "" : " sidebar-mobile-pending"}${sidebarResizer.isResizing ? " sidebar-resizing" : ""}`}
        style={{
          "--sidebar-width": `${sidebarResizer.width}px`,
          flexShrink: 0,
          paddingTop: "var(--safe-top)",
          paddingBottom: "var(--safe-bottom)",
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
           // fork:pr40-split — 分屏激活时这里的 px 是 `useSplitPanes` 算出来的
           // 「宽工作区宽度」（下限临时换成 720）；用户自己拖出来的普通宽度记在
           // 另一套会话记忆里，退分屏后原样回来（hook 走 `setWidth(width)`，不落盘）。
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
        /* fork:design-components —— 主区壳 = 画板 01 的 .pw-main
           （flex 列 / min-width:0 / min-height:0 / canvas 底色，board.css 承担）。
           flex:1 与 overflow:hidden 画板没写，仍内联；底色由 board.css 的
           var(--surface-canvas) 接管（globals.css 的 .chat-slot var(--bg) 同权重、
           在它之前，故画板值取胜）。 */
        /* fork:v5-frame-audit（2026-10-05）—— 窄屏这一层就是画板 M-01 / M-02 /
           M-04 每一帧里 `.m-phone-inner` 里的 `.m-workspace`：`position: relative`
           给下面那枚绝对定位的 `.m-top` / `.m-fade` 当定位层。桌面那一支不加
           （`d-*` 只在 ≥641 生效，多挂一个类不会有效果，但会让「哪一形态」这件事
           在 DOM 上看不出来）。 */
        className={`chat-slot d-main${isMobile ? " m-workspace" : ""}${workspaceSwapped ? ` secondary-workspace${rightPanelOpen ? " secondary-workspace-open" : " secondary-workspace-closed"}` : " main-workspace"}`}
        style={{ flex: 1, overflow: "hidden" }}
       >
        {/* fork:v5-frame-audit —— 画板 M-01 帧 A / M-02 帧 A-C / M-04 帧 A-D 的
           `.m-fade`（96px 的顶栏渐隐）：DOM 上写在 `.m-top` 之前、内容滚到顶也
           不出现硬边。产品此前只有底端那一枚 `.m-fade-tail`（在输入卡里），顶栏
           是实底色的一条，顶端没有这段过渡。 */}
        {isMobile && <div className="m-fade" aria-hidden="true" />}
        {/* Top bar with sidebar toggle */}
        {/* fork:zn-03 — no bar over an empty chat (desktop only): display:none
            keeps refs mounted (no unmount/remount churn for the dropdown
            positioning effect) while removing the bar from layout and the
            accessibility tree. Mobile keeps the bar (drawer toggle). */}
        <div ref={topBarRef} style={{ flexShrink: 0, background: "var(--bg)", display: hideTopBar ? "none" : undefined }}>
        {/* fork:design-components —— 顶栏挂画板 .pw-topbar（36px / 发丝底线 / 间距节奏）。
            fork:v5-frame-audit —— 窄屏换成画板 M-01 帧 A / M-02 帧 A 的 `.m-top`：
            绝对定位 + 渐隐底，**浮在内容上**，消息从下方穿过（留白由 `.m-scroll`
            的 `padding-top: 108px` 承担）。此前窄屏这一行既没有 `.m-top` 也没有
            `.m-fade`，于是「顶栏压在内容上」这件事在真机上根本没有发生。 */}
        {/* fork:v5-frame-audit-2026-10-05 —— 桌面顶栏本体是 `<header>`（画板 D-01 / D-02 /
            D-02b / D-02c / D-02d 每一帧都是 `<header class="d-topbar">`）；手机那一支
            是 PWA 的 `<div class="m-top">`，板面上就是 div，不动。 */}
        <TopBarTag
          className={isMobile ? "m-top" : "main-workspace-header d-topbar"}
          style={isMobile
            ? { paddingTop: "var(--safe-top)" }
            : { position: "relative", height: "calc(var(--height-toolbar, 36px) + var(--safe-top))", paddingTop: "var(--safe-top)" }}
        >
          {/* fork:desktop-shell — the drag handle is a real element, not the header box:
              it is inset past the boundary toggles so the drag region never covers them.
              `no-drag` alone only helps elements the region rule can reach, and those two
              toggles are siblings of the header, which is why they stayed unclickable. */}
          <div className="desktop-drag-handle" aria-hidden="true" />
          {isMobile && <button
            onClick={handleSidebarToggle}
             title={sidebarOpen ? translate("sidebar.hide") : translate("sidebar.show")}
             aria-label={sidebarOpen ? translate("sidebar.hide") : translate("sidebar.show")}
            /* fork:design-components —— 皮肤 lucide 图标：展开态 panel-left，收起态 menu。
               fork:v5-wave-b —— 这一枚**只在手机渲染**（外层就是 `{isMobile && …}`），
               所以直接换成画板 M-01/M-04 的抽屉入口钮 `.m-top-btn`（玻璃圆钮 / 44px
               触控靶）：框与配色由 PWA 组件库给，内联几何撤掉；handler / title /
               aria-label / 图标切换一字未动。桌面分支根本不渲染这一枚。 */
            className="m-top-btn"
            onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-muted)"; }}
          >
            <span>
              {/* fork:v5-frame-audit（2026-10-05）—— 抽屉入口钮的图标按画板 M-01/M-02/M-04
                  每一帧写死 `panel-left`（收起态也用它）：板上没有「menu / panel-left
                  两态切换」这回事，而这两个字形在 16px 下几乎一样，转起来只会让人以
                  为按钮换了个功能。按钮的 title / aria-label 仍随 `sidebarOpen` 变
                  （“抽屉里写的是什么”与“抽屉外写的是什么”是两句话）。 */}
              <i data-ico="panel-left" data-size="16"></i>
            </span>
          </button>}
          {/* fork:ui-18 — the title doubles as the session switcher (MusePi
              GuiHeader.tsx:748): recent sessions open from here, so switching
              does not require going back to the sidebar. The `.pw-tb-title`
              frame (panel-left + text) lives inside `renderSessionTitle`. */}
          {/* fork:v5-frame-audit-2026-10-05 —— 「运行中」芯片与分支芯片搬进
              `.d-tb-stack`（画板 D-02 帧 A / 帧 C：身份两行里的第一行就是
              `span.d-row` = 标题 + 运行中芯片 + 分支芯片）。此前它们是
              `.d-tb-stack` 的**兄弟节点**，于是顶栏左边多了两件、身份块里少了
              两件 —— 板面与产品的顶栏左端结构对不上。两枚组件与回调一字未动。 */}
          {!isMobile && renderSessionRename()}
          {/* fork:v5-frame-audit-2026-10-05 —— 弹性垫片的**位置**也照画板：它在身份块
              正后方（`.d-tb-stack · .d-tb-spacer · 动作簇`），此前它排在 MCP / 插件
              两枚之后，于是这一段在 DOM 上读成「标题 · 扩展图标 · 空档 · 会话动作」。
              画板 D-02b 帧 A 的次序是：身份块 · 垫片 · 会话动作（历史 / 命名 / 子代理 /
              分支 / 导出 / ⋯）· **竖分隔** · MCP · 插件。 */}
          {!isMobile && <div className="d-tb-spacer" />}
          {/* fork:d03-frame-c —— 顶栏那枚「3 条新消息」（画板 D-03 帧 C 的
              `d-badge info`，紧跟垫片、动作簇之前）。数 = 该会话总条数 − 上次离开时
              看到的条数（同一个 store，转录里那条分割线读的就是它）。没有新条目时
              整个节点不画 —— 平时顶栏左侧除标题外不该多东西。 */}
          {!isMobile && selectedSession && newMessageCount > 0 && (
            <span className="d-badge info">{translate("chat.newMessages", { count: newMessageCount })}</span>
          )}
          {/* fix:mcp-topbar-icons —— MCP / 插件两枚状态图标（原来在聊天区右上角是一枚
              常驻胶囊）。悬停或点击出画板 22 的浮窗：MCP = server 图标 + 已启用台数
              徽标，插件 = blocks 图标。内容全在 TopBarPopovers 里，浮窗一律只读。 */}
          {isMobile && (
            /* fork:v5-wave-b —— 手机顶栏与画板 **M-01 帧 A** 的三处对照（都记在这里，
               避免下次看代码的人以为是漏抄）：
               ① 两枚端钮（抽屉 / 右栏面板）已经换成 `.m-top-btn`（`SessionActionsMenu`
                  里的 ⋯ 同理），逐字对应画板的 `m-top` 里那两枚；
               ② **没有**给这一行挂 `.m-top` / `.m-fade`：那两个类是绝对定位 + 渐隐，
                  画板靠 `.m-scroll` 的 `padding-top: 108px` 让消息从下方穿过，而那段
                  内边距在 ChatWindow / MessageView 那边（不是本波的文件）—— 只挂类
                  不改那一侧的留白，结果就是渐隐盖住第一屏消息。需要 ChatInput /
                  ChatWindow 那一波一起落；
               ③ 中间那一格仍渲染 `.d-tb-stack`（标题 + 副行）。副行是 fork:mobile-tb-subtitle
                  的既有行为（cwd + 上下文占用），而 PWA 库没有副行类（`.m-top-title`
                  是单行件）。删副行就是删功能，所以保留 d-* 件并登记为需设计侧裁定。 */
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
              {/* fork:pwa-tablet-tier — the phone bar used to show three icons and no
                  session identity at all; which conversation you are in is the one thing
                  it has to answer. Same session-switcher popover as the desktop header,
                  ellipsised into whatever space the icons leave.
                  fork:v5-wave-b —— 自左向右的次序按画板 M-01 帧 A：中间让给会话标题，
                  「⋯」与右栏面板钮排在标题之后（旧 DOM 是 ⋯ 在前，窄屏上就变成
                  「第一个动作 + 标题 + 末位入口」）。只动次序，不动任何一个回调。 */}
              <div style={{ display: "flex", alignItems: "center", flex: 1, minWidth: 0, padding: "0 2px" }}>
                {renderSessionRename()}
              </div>
              {/* fork:no-mobile-branch-chip（2026-10-06 用户裁定）—— 窄屏顶栏不再放那枚
                  `.m-branch` 分支芯片。用户原话：「分支会话在 pwa 这个模式下，就可以
                  隐藏掉了，地方不够大」。390px 上标题 + ⋯ + 右栏面板钮已经把一行占满，
                  再插一枚带序号的分支芯片，标题只剩两三个字（实测被挤成「重构本…」）。
                  分支本身仍进得去：会话抽屉里的分支行（BranchNavigator 的 `topLevel`）
                  与 `.m-branch` 读的是同一份数据，只是不再占顶栏那一格。 */}
              {renderChatToolbarActions(true)}
              {renderMainFileToggle(true)}            </div>
          )}
          {/* fork:v5-landing-2026-10-04 —— 顶栏的弹性垫片照画板 D-01 / D-02 /
              D-02b / D-02c / D-02d 每一条桌面顶栏的原样结构补上：
              `标题两行（.d-tb-stack） · <div class="d-tb-spacer"></div> · 动作簇`。
              原来这条垫片是动作簇自己的 `margin-left:auto`，视觉一样但结构不是
              画板那一段（结构相同 ≠ 类名相同，见 LANDING §0）；现在由
              `.d-tb-spacer`（flex:1 1 auto）承担，动作簇的 margin 一并撤掉。
              只在桌面渲染：手机那一支的标题区自带 `flex:1`，插垫片会把标题挤没。 */}
          {!isMobile && renderProjectTrustWarning(false)}
          {/* fork:v5-frame-audit-2026-10-05 —— 动作簇不再包一层无类 `div`：
              画板 D-01 / D-02 / D-02b / D-02c / D-02d 每一条桌面顶栏里，
              `.d-tb-spacer` 之后就是一枚枚 `button.d-iconbtn` 平铺（中间夹一枚
              `div.d-sep-v`）。`.d-topbar` 自己就是 flex 行 + gap，壳可以去掉。 */}
          {!isMobile && renderChatToolbarActions(false)}
          {/* fork:v5-frame-audit-2026-10-05 —— 顶栏右端的次序按画板 D-02b 帧 A 的
              「顶栏动作全景」：会话动作（历史 / 命名 / 子代理 / 分支 / 导出 / ⋯）
              → `div.d-sep-v` 竖分隔 → MCP（server）· 插件（blocks）。
              分隔线把「对这条会话做什么」和「扩展状态」分成两段；产品此前既没有
              这一件，两簇图标也是反过来的（扩展在前、动作在后）。 */}
          {!isMobile && showChat && (
            <>
              <div className="d-sep-v" />
              <McpStatusButton cwd={selectedSession?.cwd ?? newSessionCwd ?? null} statuses={mcpStatuses} />
              <PluginStatusButton cwd={selectedSession?.cwd ?? newSessionCwd ?? null} statuses={pluginStatuses} widgets={extensionWidgets} />
            </>
          )}
          {!isMobile && renderChatToolbarTail()}
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
              containerRef={mobileBranchRef}
            />
          )}
          {/* Top panel dropdown — shared, only one active at a time */}
          {/* fix:branch-panel-ghost（2026-10-06 用户报「点了会话分支，左边还留着一个
              空框」）—— **`branches` 不进这只共用壳**：它的实体是 `BranchNavigator`
              自己那个浮层（桌面在顶栏芯片下、窄屏在 `.m-branch` 下），而这只壳里只有
              agents / system / tools 三种 body，`branches` 会渲染出一个**没有内容**的
              `.d-pop-float`；又因为窄屏芯片那路 `toggleTopPanel("branches")` 不带锚点，
              定位回落到顶栏左缘，于是空框贴在屏幕左上、还顺带盖住一块可点区域。 */}
          {activeTopPanel && activeTopPanel !== "branches" && topPanelPos && (
            /* fork:v5-landing —— 顶栏浮窗壳 = 画板 D-02b 的 `.d-pop-float`（浮窗的
               唯一一种描边/圆角/阴影/内边距）。它本来就是 fixed 定位，所以把壳放在这层
               定位容器上，里面的 SystemPromptPanel / ToolDefinitionsPanel /
               AgentSessionPanel 只负责内容（`d-pop-title` / `d-code` / `d-table` 等），
               不再各自套一层 `pw-pop`。 */
            <div ref={topPanelRef} className="anim-popover-down d-pop-float" style={{
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
            </div>
          )}

        </TopBarTag>
        {/* fork:v5-landing E4 —— M-10 帧 B-2 / C-1 的两条顶部横幅。
            次序也是库里的兄弟次序：`.m-offline ~ .m-trust { top: 30px }` —— 两件必须是
            兄弟（中间不许再包一层），断网条在前。两条都只把 `position` 摆回流内
            （产品的顶栏是绝对定位的渐隐层，横幅若真跑到 top:0 会把抽屉钮盖住），
            位置以外的形态全由类给。 */}
        {isMobile && <PwaOfflineBanner />}
        {isMobile && renderProjectTrustWarning(true)}
        {/* fork:design-system SW-16 —— 画板 60 帧 B 的分平台安装提示（Android
            beforeinstallprompt / iOS 教学；standalone 或已关闭时自隐藏）。 */}
        {isMobile && <InstallPromptBanner />}
        {isMobile && <PwaUpdateBanner />}
        </div>

        {/* Chat content */}
        <div ref={mobileChatSurfaceRef} style={{ flex: 1, overflow: "hidden", position: "relative" }}>
          {/* fork:v5-landing E4 —— M-11 帧 A-1 的下拉刷新：`.m-pull` 活在顶栏之下、
              消息之上（那张板的原话：「位置本身就在讲你在拉动这一屏」）。
              刷新动作接的是**已有**的会话重载 —— 设置里「重载会话」走的是同一条
              `reloadToken`（转录列就地刷新，不 remount、不动草稿）。 */}
          {isMobile && showChat && (
            <PwaPullToRefresh
              surfaceRef={mobileChatSurfaceRef}
              onRefresh={() => setSessionReloadToken((key) => key + 1)}
            />
          )}
          {showChat ? (
            <ChatWindow
              key={sessionKey}
              reloadToken={sessionReloadToken}
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
              actionPanel={renderMobileActionPanel()}
              onSessionStatsPanelOpen={openSessionStatsPanel}
              // fork:mcp-slash —— 会话里打 `/mcp` 直接落到设置页的 MCP 分节。
              onOpenSettingsSection={(section) => setSettingsSection(section as SettingsSection)}
              onOpenFile={handleOpenLinkedFile}
              onOpenSession={handleOpenSession}
              // fork:proma-32-skill-usage
              onOpenSkill={handleOpenSkill}
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
              /* fork:v5-landing —— 画板 D-01 的空态：`.d-empty` 撑满并居中，
                 `.d-empty-ico` + `.d-empty-t` + `.d-empty-s`。 */
              <div className="d-empty" style={{ height: "100%" }}>
                <div className="d-empty-ico">
                  {/* fork:brand-mark-2026-10-04 —— 这里是**主品牌图形**
                      （public/pi-next-logo.png），不是 pi 的 π 字形：品牌只此一处。 */}
                  {/* eslint-disable-next-line @next/next/no-img-element -- 静态品牌资产，不走 next/image 优化器 */}
                  <img src="/pi-next-logo.png" alt="" draggable={false} />
                </div>
                <div className="d-empty-t">{translate("workspace.getStarted")}</div>
                <p className="d-empty-s">
                  <span className="d-t-faint">1.</span> {translate("workspace.selectProject")}<br />
                  <span className="d-t-faint">2.</span> {translate("workspace.addModels")}
                </p>
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
        /* fork:v5-landing —— 右栏宿主 = 画板 D-05 的 `.d-panel`。
           ⚠ 冲突（待收尾波裁定）：`.d-panel` 自带 `width:320px`，在 641–959 的紧凑
           浮层里会压掉 `.secondary-workspace { width: min(560px, calc(100vw - 48px)) }`
           （两者同为 0-1-0，system.css 在后）。宽屏网格有 `width:100% !important`、
           移动态有 `.secondary-workspace-open { width:auto }`（0-2-0），均不受影响。
           建议收尾波加一条 `.right-panel-container.d-panel` 的宽度守卫。 */
        className={`right-panel-container workspace-slot d-panel${workspaceSwapped ? " main-workspace" : ` secondary-workspace${rightPanelOpen ? " secondary-workspace-open" : " secondary-workspace-closed"}`}${rightPanelOpen ? " right-panel-open" : " right-panel-closed"}${rightPanelResizer.isResizing ? " right-panel-resizing" : ""}`}
        style={{
          display: "flex",
          flexDirection: "column",
        } as React.CSSProperties}
      >
        {/* Right panel tab bar */}
        <div className="main-workspace-header d-panel-head" style={{
          height: "calc(var(--topbar-height, 36px) + var(--safe-top))",
          paddingTop: "var(--safe-top)",
          position: "relative",
        }}>
          {/* fork:desktop-shell — the drag handle is a real element, not the header box:
              it is inset past the boundary toggles so the drag region never covers them.
              `no-drag` alone only helps elements the region rule can reach, and those two
              toggles are siblings of the header, which is why they stayed unclickable. */}
          <div className="desktop-drag-handle" aria-hidden="true" />
          <div style={{ flex: 1, overflow: "hidden" }}>
            <TabBar
              tabs={orderedPanelTabs}
              activeTabId={activeFileTabId ?? ""}
              onSelectTab={splitPanes.selectTab}
              onCloseTab={handleCloseTabWithHistory}
              onMoveTab={handleMoveTab}
              overview={{
                recentClosed: recentClosedTabs,
                onCloseAll: handleCloseAllTabs,
                onCloseOthers: handleCloseOtherTabs,
                onRestore: handleRestoreClosedTab,
                onClearRecent: () => setRecentClosedTabs([]),
              }}
              /* fork:pr40-split —— 分屏接线（不传就退回改动前的单列行为）。
                 `isSplitUnavailable` 只提示「分屏态还在、宽度回来自动恢复」，
                 所以退分屏钮在窄栏/手机下依然渲染，否则用户会以为分屏丢了。 */
              handleTabDragChange={splitPanes.handleTabDragChange}
              handleTabDrop={splitPanes.handleTabDrop}
              endTabDrag={splitPanes.endTabDrag}
              isDraggingTab={splitPanes.isDraggingTab}
              isSplitActive={splitPanes.isSplitActive || splitPanes.isSplitUnavailable}
              collapseSplit={splitPanes.collapseSplit}
              collapseSplitLabel={splitPanes.isSplitUnavailable
                ? translate("split.collapseUnavailable")
                : translate("split.collapse")}
            />
          </div>
          {activeCwd && !gitGraphOpen && (
            <button
              type="button"
              onClick={openGitGraphTab}
              title={translate("git.graph")}
              aria-label={translate("git.graph")}
              /* fork:pwa-hit-slop-2 —— 内联 `--control-xs`（24）是画板值，手机上指腹
                 按不准；挂一枚 `fork-*` 接线钩子让 CSS 用 `::after` 外扩命中区
                 （不新造 `pw-*`，也不改盒子）。 */
              className="fork-panel-head-act"
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                width: "var(--control-xs)", height: "var(--control-xs)", padding: 0,
                borderRadius: "var(--radius-md)", background: "none", border: "none",
                color: "var(--text-muted)", cursor: "pointer", flexShrink: 0, transition: "color 0.12s",
              }}
              onMouseEnter={(event) => { event.currentTarget.style.color = "var(--accent)"; }}
              onMouseLeave={(event) => { event.currentTarget.style.color = "var(--text-muted)"; }}
            >
              <span><i data-ico="git-branch" data-size="15"></i></span>
            </button>
          )}
          {/* fork:panel-head-actions —— 2026-10-06 用户裁定：终端与浏览器两枚从
              文件树头行搬到面板头行，**排在 git 钮后面**（手机档它们仍在 `.m-top`
              里，那边是横排动作条，头行放不下也没必要）。
              这两枚与 git 钮同属面板级动作，用画板 30/01 头行那一排的 `.d-iconbtn`；
              git 钮自己那套 24px 内联样式是它的历史，不顺手动。 */}
          {!isMobile && activeCwd && (
            <button
              type="button"
              className="d-iconbtn"
              title={translate("terminal.open")}
              aria-label={translate("terminal.open")}
              onClick={() => handleOpenTerminal(activeCwd)}
            >
              <span><i data-ico="square-terminal" data-size="14"></i></span>
            </button>
          )}
          {!isMobile && browserTabButton}
          {/* 2026-10-03 用户裁定 —— 这里原有的第二枚「改动」（git 图谱钮右侧、标题栏里那枚
            `file-diff`）已删除，随它一起删掉的还有整个改动 tab（`ChangesPanel` +
            `CHANGES_TAB_ID` + `/api/changes`）：文件树头行里有同一个入口（ExplorerPanel
            的 `file-diff`，“变更（N 个文件）”，fork:ui-review-button），它同时驱动树里的
            改动目录高亮与按钮上的文件数，是被两处引用的那一个。改动清单只留这一处。 */}
          {isMobile && (
            <button
              type="button"
              onClick={() => setRightPanelOpen(false)}
              aria-controls="file-panel"
              aria-expanded={rightPanelOpen}
              title={translate("files.hidePanel")}
              aria-label={translate("files.hidePanel")}
              /* fork:pwa-hit-slop-2 —— 同上：24 的盒子不动，命中区由 CSS 外扩。 */
              className="fork-panel-head-act"
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                width: "var(--control-xs)", height: "var(--control-xs)", padding: 0, borderRadius: "var(--radius-md)",
                background: "var(--bg-selected)", border: "none", borderLeft: "1px solid var(--border)",
                color: "var(--text)", cursor: "pointer", flexShrink: 0, transition: "color 0.12s",
              }}
              onMouseEnter={(event) => { event.currentTarget.style.color = "var(--accent)"; }}
              onMouseLeave={(event) => { event.currentTarget.style.color = "var(--text)"; }}
            >
              <span><i data-ico="panel-right" data-size="16"></i></span>
            </button>
          )}
        </div>

        {/* Body: the active viewer plus an optional tree column. Both live in the
            same container so the tree no longer replaces the document. */}
        <div className="file-panel-body d-panel-body flush">
        <div className="file-panel-main">
          {/* fork:pr40-split —— 分屏时两个 Pane 各挂**一个** tab（见 renderTabContent）。
              窄栏 / 手机下 `isSplitActive` 为假，这里自动退回单列的全量常驻渲染，
              分屏态本身留在 `useSplitPanes` 里，宽度一够就自己回来。 */}
          {splitPanes.isSplitActive && splitPanes.leftTabId && splitPanes.rightTabId ? (
            <SplitPaneHost
              ratio={splitPanes.ratio}
              leftTabId={splitPanes.leftTabId}
              rightTabId={splitPanes.rightTabId}
              focusedPane={splitPanes.focusedPane as RightPanelPane}
              dropTargetPane={splitPanes.dropTargetPane}
              isDividerResizing={splitPanes.isDividerResizing}
              dividerProps={splitPanes.dividerProps}
              paneLabels={splitPaneLabels}
              dropHint={translate("split.dropHint")}
            >
              {(_pane, paneTabId) => renderTabContent(paneTabId, false)}
            </SplitPaneHost>
          ) : (
            <>
          {fileTabs.map((tab) => renderTabContent(tab.id, true))}
          {branchTabs.map((tab) => renderTabContent(tab.id, true))}
          {browserTabs.map((tab) => renderTabContent(tab.id, true))}
          {terminalTabs.map((tab) => renderTabContent(tab.id, true))}
          {/* fork:git-graph-tab / fork:trace-pane —— 两个单例 tab 常驻（hidden 而非卸载），
              折叠状态与搜索查询不因切 tab 丢失。 */}
          {gitGraphOpen ? renderTabContent(GIT_GRAPH_TAB_ID, true) : null}
          {traceOpen ? renderTabContent(TRACE_TAB_ID, true) : null}

          {fileTabs.length === 0
            && !terminalTabs.some((tab) => tab.id === activeFileTabId)
            && !browserTabs.some((tab) => tab.id === activeFileTabId)
            && !branchTabs.some((tab) => tab.id === activeFileTabId)
            && activeFileTabId !== GIT_GRAPH_TAB_ID
            && activeFileTabId !== TRACE_TAB_ID
            // fork:proma-39-changes — 图谱 tab 占满 file-panel-main，不能再叠一层文件树。
            ? (
            activeCwd ? (
              explorerPanel
            ) : (
              <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-dim)", fontSize: TEXT.sm }}>
                 {translate("files.noneOpen")}
              </div>
            )
          ) : null}
</>
          )}
        </div>
        {showExplorerColumn ? (
          /* fork:board-diff-2026-10-01 —— 这一列就是画板 30 的 `.pw-tree`
             （board.css:578：padding var(--s1)/font-size var(--text-secondary)=12px/
             发丝右边线）。此前产品只挂了 `.explorer-column`（自己的类），
             画板那整条规则全部落空 —— 树行字号退回 13px（与会话行同大，
             「比会话行密一倍」的设计意图没了）、没有发丝右边线，
             `30-files-panel` 的 spec 把它报成了漂移（fs 12≠13 / lh 18≠19.5）。
             `explorer-column` 保留（宽度档位在 fork-ui.css:449）。 */
          <div className="explorer-column">{explorerPanel}</div>
        ) : null}
        </div>
      </div>
      </div>
    </div>
    <SessionRowContextMenuBridge onCopyReference={copySessionReference} />
    {settingsSection && (
      <SettingsPanel
        onOpenSession={handleOpenSession}
        sessionId={selectedSession?.id ?? null}
        initialSection={settingsSection}
        focusSkillSlug={settingsSkillSlug}
        sidebarWidth={sidebarResizer.width}
        onSidebarWidthChange={sidebarResizer.setWidth}
        soundEnabled={soundEnabled}
        onSoundToggle={onSoundToggle}
        quoteSelectionEnabled={quoteSelectionEnabled}
        onQuoteSelectionChange={handleQuoteSelectionChange}
        onClose={() => {
          setSettingsSection(null);
          setSettingsSkillSlug(null);
          setModelsRefreshKey((key) => key + 1);
        }}
        onSessionReloaded={() => setSessionReloadToken((key) => key + 1)}
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
          void startSessionIn(path).then((failure) => {
            setHomeTargetError(failure);
            setHomeFolderPickerOpen(failure !== null);
          });
        }}
      />
    )}
    {/* fork:trace-menu —— 极简通知宿主：系统级动作（在访达里打开、改名失败）没地方报
        就是「点了没反应」，所以这里补一条 `.pw-toast`（3s 自动收，不堆栈不排队）。 */}
    {toast ? (
      <div
        role="status"
        className={isMobile ? "m-toast" : "d-toast bad"}
        style={{
          position: "fixed",
          /* fork:pwa-hit-slop-2 —— 原来只给 `var(--s5)`，standalone 下正好压在
              iOS home indicator 上（那一条 34px 不吃点击）。取 max()：非全面屏
             仍是最初的 `--s5`，全面屏额外让出安全区 + `--s3` 的呼吸。 */
          bottom: "max(var(--s5), calc(var(--safe-bottom) + var(--s3)))",
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 900,
        }}
      >
        {toast}
      </div>
    ) : null}

    {/* fork:command-palette —— ⌘K / ⌘⇧P 打开的统一入口（命令 / 会话 / 文件）。
        三个域全部复用既有 API，零新后端：会话走 `/api/sessions/search`
        （流式扫正文），文件走 `/api/file-index`（内部已是 `lib/file-fuzzy.ts`
        的真评分），命令是内存里那份清单。命令清单直接调既有的 setState，
        所以面板不需要自己知道「设置怎么开、会话怎么切」。 */}
    <CommandPalette
      open={commandPaletteOpen}
      onClose={() => setCommandPaletteOpen(false)}
      cwd={activeCwd ?? ""}
      commands={paletteCommands}
      onOpenSession={(id) => { void handleOpenSession(id); }}
      onOpenFile={(path) => handleOpenFile(path, path.split("/").pop() ?? path)}
    />
    </>
    </LinkOpenProvider>
    </ContextMenuProvider>
  );
}
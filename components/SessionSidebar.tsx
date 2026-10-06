"use client";

import { useEffect, useLayoutEffect, useState, useCallback, useMemo, useRef, type CSSProperties, type ReactNode } from "react";
// fork:ui-pop-portal-fix —— worktree 切换 / 项目 ⋯ 菜单共用这一份（容器带 `--z-popover`）。
import { PortalDropdown, useDismissMenu } from "./PortalDropdown";
import type { SessionInfo } from "@/lib/types";
import { listSessionFamilies, type SessionFamily } from "@/lib/session-family";
import { dispatchSessionRowContextMenu } from "@/lib/session-row-context-menu";
import { skillExpansionToCommand } from "@/lib/slash-display";
import { chatProjectOf, getProjectActivity, getRecentProjects, sessionsForProject, withoutChatProject } from "@/lib/project-groups";
import type { RecentProject } from "@/lib/project-groups";
import { applySessionFlags, useSessionFlags } from "@/lib/session-flags";
// fork:trace-menu —— 未读标记的共享存储（侧栏画点，顶栏 ⋯ 菜单写）。
import {
  clearSessionUnread,
  markSessionUnread,
  pruneReadCursors,
  pruneSessionUnread,
  useUnreadSessions,
} from "@/lib/session-unread";
import { filterArchivedProjects, useProjectFlags } from "@/lib/project-flags";
// fork:zc-11 — 用户自定义项目分组 + 拖拽排序（localStorage 展示层偏好）。
import { useSessionGroups } from "@/lib/session-groups";
import { filterHiddenProjects, projectDisplayName, useProjectPrefs } from "@/lib/project-prefs";
import { flatTimeGroupEntries, type TimeGroupEntry } from "@/lib/time-groups";
import { desktopTrafficLightInset } from "@/lib/desktop-shell";
import { workspaceKeyOf } from "@/lib/workspace-memory";
import { formatRelativeTime } from "@/lib/i18n/format";
import { useI18n } from "@/hooks/useI18n";
import { readStoredSidebarPane, writeStoredSidebarPane, type SidebarPane } from "@/lib/sidebar-pane";
import { DirectoryPicker } from "./DirectoryPicker";
// fork:zc-11 + fork:zm-06 — 分组/排序列表渲染（含 FLIP 重排）。
import { GroupedProjectList, useProjectDrag } from "./fork/GroupedProjectList";
// fork:chat-workspace — standalone chat section (docs/patches/0001-chat-workspace.md)
import { ChatWorkspaceRow } from "./ChatWorkspaceRow";
import { SessionSearch } from "./SessionSearch";
import { PwaSheet } from "./pwa/PwaSheet";
import { useIsCompact, useIsMobile } from "@/hooks/useIsMobile";
import { useTheme } from "@/hooks/useTheme";

// fork:design-system — 会话行按画板 02 重做成**两行**（标题 + 元信息行）。
// 状态标记一律在**右侧**（`N 条消息` 之后），左侧不放任何点。
//
// fork:session-row-overlap（用户 2026-10-05 截图「元信息叠在下一行标题上」）——
// 窗口化的行高**只有一个真值：真行自己的盒高**。写死的 48 是 v1 `.pw-session`
// 的遗留值，而 v5 的 `.d-sess` 是 52.6、PWA 的 `.m-row` 是 108.7（`.m-row-m`
// 那枚 44px 触控钮独占第三行）：行盒画到 48、文字画到 52.6 / 108.7，于是每一行
// 的元信息都压在下一行的标题上 —— 实测桌面溢出 4.6px、手机 60.7px。
// 上游 pi-web 当时写的是 54，也没追上 v5。
//
// 所以这里量（`useSessionRowHeight`）：这个数只是**首帧兜底**（无 DOM 时），
// 真值由 `useLayoutEffect` 在绘制前量到并重排，肉眼看不到跳。派生出来的窗口
// 与偏移共用同一个数，所以两边不可能再各写一份。
export const SESSION_LIST_ITEM_HEIGHT = 54;

/** fork:session-tree —— 虚拟列表的槽位：分桶头 / 主会话 / 子代理会话（缩进一级）。 */
type SidebarEntry =
  | { type: "header"; bucket: string }
  | { type: "family"; family: SessionFamily }
  | { type: "child"; session: SessionInfo };

/** 主会话后面接上它的子代理会话；**默认收起**，只有显式展开过的根会话才摊开
 *  子树（fork:session-tree-collapsed，用户 2026-10-05：「带多个 agent 的对话默认不
 *  展开，只有点击这个下拉框了再展开」）。
 *  fork:session-tree —— 此前这里传的是「收起的 id 集合」，初始为空集 = 全部摊开：
 *  一棵子树三五行，一屏就被子会话吃掉，而折叠箭头夹在元信息行里也不起眼。状态
 *  正好反过来记（记**展开过**的），收起的集合就不必在会话异步到达时补初始化。 */
function expandSidebarEntries(
  entries: readonly TimeGroupEntry<SessionFamily>[],
  expanded: ReadonlySet<string>,
): SidebarEntry[] {
  const out: SidebarEntry[] = [];
  for (const entry of entries) {
    if (entry.type !== "item") {
      out.push(entry);
      continue;
    }
    out.push({ type: "family", family: entry.item });
    if (!expanded.has(entry.item.root.id)) continue;
    for (const child of entry.item.subagents) out.push({ type: "child", session: child });
  }
  return out;
}

/** 每行顶部偏移数组（长度 count + 1，末项是总高）。 */
export function sessionListOffsets(count: number, itemHeight: number = SESSION_LIST_ITEM_HEIGHT): number[] {
  const offsets = new Array<number>(count + 1);
  for (let index = 0; index <= count; index += 1) offsets[index] = index * itemHeight;
  return offsets;
}

export function getSessionListIndices(count: number, scrollTop: number, viewportHeight: number, focusedIndex = -1, itemHeight: number = SESSION_LIST_ITEM_HEIGHT): number[] {
  const overscan = 8;
  const visibleCount = Math.ceil((viewportHeight || 600) / itemHeight) + overscan * 2;
  const start = Math.max(0, Math.min(Math.floor(scrollTop / itemHeight) - overscan, count - visibleCount));
  const end = Math.min(count, start + visibleCount);

  const indices = Array.from({ length: Math.max(0, end - start) }, (_, offset) => start + offset);
  // Keep a focused row mounted so scrolling cannot discard an inline rename.
  if (focusedIndex >= 0 && focusedIndex < start) indices.unshift(focusedIndex);
  if (focusedIndex >= end && focusedIndex < count) indices.push(focusedIndex);
  return indices;
}

declare global {
  interface Window {
    piDesktop?: {
      selectDirectory: () => Promise<string | null>;
    };
  }
}


function sessionListUrl(summary: boolean, force: boolean): string {
  if (summary) return "/api/sessions?summary=1";
  if (force) return "/api/sessions?force=1";
  return "/api/sessions";
}

interface Props {
  selectedSessionId: string | null;
  onSelectSession: (session: SessionInfo, isRestore?: boolean, entryId?: string, blockIndex?: number) => void;
  onNewSession?: (sessionId: string, cwd: string) => void;
  initialSessionId?: string | null;
  skipInitialProjectSelection?: boolean;
  onInitialRestoreDone?: () => void;
  refreshKey?: number;
  onSessionDeleted?: (sessionId: string) => void;
  selectedCwd?: string | null;
  onCwdChange?: (
    cwd: string | null,
    projectRoot?: string | null,
    projectKey?: string | null,
  ) => void;
  /** Fired when a session that is not currently selected finishes running.
   *  Lets the app play a cross-workspace completion tone. */
  onBackgroundTaskDone?: () => void;
  onRunningSessionIdsChange?: (ids: Set<string>) => void;
  onSessionsChange?: (sessions: SessionInfo[]) => void;
  /** fork:zn-21 — 折叠按钮搬进导轨品牌行（原来它浮在导轨右边界上，压在主区顶栏里）。
   *  未折叠时由导轨自己渲染，所以由 AppShell 注入回调。 */
  onToggleSidebar?: () => void;
  /** fork:zn-21 — 折叠态的图标条点「搜索」时，把这里的计数 +1；
   *  SessionSidebar 借此在被展开的那一刻把搜索框打开。 */
  searchRequestId?: number;
}

interface WorktreeEntry {
  path: string;
  branch: string | null;
  isMain: boolean;
}

interface WorktreeState {
  /** The cwd this data was fetched for — guards against stale responses */
  forCwd: string;
  projectRoot: string;
  /** Stable server-computed identity; never derive OS path semantics here. */
  projectKey: string;
  isGit: boolean;
  /** False when forCwd is a repo subdirectory — the switcher is hidden there
   *  because subdir sessions keep their own project identity */
  isTopLevel: boolean;
  /** Canonical path of the checkout containing forCwd, resolved server-side. */
  currentWorktreePath: string | null;
  worktrees: WorktreeEntry[];
}

interface ProjectSelection {
  root: string;
  key: string;
}

interface ValidatedProject {
  cwd: string;
  root: string;
  key: string;
}

const LAST_CUSTOM_CWD_STORAGE_KEY = "pi-web:last-custom-cwd";
const RUNNING_SESSIONS_POLL_MS = 2500;
const SESSION_DETAILS_HYDRATION_DELAY_MS = 750;

function loadLastCustomCwd(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(LAST_CUSTOM_CWD_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

function saveLastCustomCwd(cwd: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LAST_CUSTOM_CWD_STORAGE_KEY, cwd);
  } catch {
    // Persistence is best-effort.
  }
}

/** Substitute the home dir prefix with ~ (no path truncation — see PathLabel) */
function displayCwd(cwd: string, homeDir?: string): string {
  return (homeDir && cwd.startsWith(homeDir)) ? "~" + cwd.slice(homeDir.length) : cwd;
}

/**
 * Path label that ellipsizes on the LEFT, keeping the (most relevant) trailing
 * segments visible: "…orkspace/pi-web". Shows as much of the path as fits
 * instead of a fixed number of segments. The rtl container moves the ellipsis
 * to the left edge; the inner plaintext bidi isolation keeps the path itself
 * rendered strictly left-to-right (no punctuation reordering).
 */
function PathLabel({ text, style }: { text: string; style?: CSSProperties }) {
  return (
    <span
      style={{
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        display: "block",
        minWidth: 0,
        lineHeight: 1.35,
        direction: "rtl",
        textAlign: "left",
        ...style,
      }}
    >
      <span style={{ unicodeBidi: "plaintext" }}>{text}</span>
    </span>
  );
}

// fork:ui-pop-portal-fix —— 侧栏的两个下拉（worktree 切换 / 项目 ⋯ 菜单）改用共享的
// `components/PortalDropdown.tsx`。这里此前留着一份 2026-09-29 的**旧副本**，
// 而那份副本没有 portal 容器的 z-index 修复：浮窗虽然 portal 到了 body，
// 但自身在根层叠上下文里是第 0 层，被 `.sidebar-container`（`z-index: 200`）整块盖住 ——
// DOM 里有、点不到、看不见，用户看到的就是「这个 main 点不了 / 这三个点点了没反应」。
// 共享版把容器包在 `position: relative; z-index: var(--z-popover)` 里，改一处全治。

function PiWebTitle() {
  // fork:brand-logo — 产品名图（public/pi-next-wordmark.png）里「PI」是深藏青，
  // 深色主题下压在侧栏底上等于看不见，所以深色退回同字号的实色文字。
  const { theme } = useTheme();
  const wordmark = theme === "light";

  /* 用户 2026-10-05 —— 「点品牌翻版本号」这个彩蛋删掉。原来点一下字标会把它换成
     `${APP_VERSION}p${PI_VERSION}` 滚 3 秒：品牌行只有 ~200px 宽，那串
     `0.1.9-beta.1+31a3fac4-dirtyp1.0.0` 顶到行外、把搜索/折叠两枚钮挤没，读起来就是
     「版本号炸了」。版本号在侧栏底栏有一处（只印发行号），那才是它该在的地方。
     连带删掉 `useScramble` 与相关 state —— 只有一个消费者。
     DOM 仍是画板 D-01/D-02/D-02d 的 `.d-logo` + `.d-wordmark` 两件并排，不套按钮。 */
  if (wordmark) {
    // fork:v5-landing-2026-10-04 —— 品牌字标照画板 D-01/D-02/D-02d 的
    // `<img class="d-wordmark" src="…/wordmark.png" alt="PI NEXT">` 原样抄：
    // 高 / 宽 / display / flex 收缩全部由 system.css 的 `.d-wordmark`
    // （height:20px / width:auto / display:block / flex:0 0 auto）给，
    // 这里不再内联第二份值（原来内联 height:10，让同一个尺寸有了两个来源，
    // 整行也比画板矮一半）。
    return (
      // eslint-disable-next-line @next/next/no-img-element -- 静态品牌资产，不走 next/image 优化器
      <img className="d-wordmark" src="/pi-next-wordmark.png" alt="PI NEXT" draggable={false} />
    );
  }
  // 深色主题：字标位换成实色文字，仍占同一个盒子（class 不换）。
  return <span className="d-wordmark">PI NEXT</span>;
}

/**
 * fork:session-row-overlap —— 虚拟列表的行高，量自真行。
 *
 * 为什么不写死：会话列表走**绝对定位的固定行距窗口化**，行距一旦短过行的真实
 * 盒高，行盒只画到行距、文字画到盒高 —— 每一行的元信息都压在下一行的标题上
 * （用户 2026-10-05 截图；桌面 `.d-sess` 52.6 vs 48、手机 `.m-row` 108.7 vs 48）。
 * 行高是 CSS 的产物（字号、padding、触控钮都在变），写死的数字必然再漂一次。
 *
 * 量的是滚动区里的**第一枚会话行**：`.d-sess` / `.m-row` 都是**内容高 ≥ 拉伸高**
 * 的弹性项，所以读到的就是内容高，与当前行距无关（不会自激）。首帧用兜底值渲染，
 * `useLayoutEffect` 在**绘制前**把真值写回 state 并重排，肉眼看不到跳。
 *
 * 这里**每次渲染后都量一次**而不是挂 ResizeObserver：会话行是异步到的（列表请求
 * 回来才有第一枚行），挂观察器就得猜「第一行什么时候换人」；每次渲染量一次的代价
 * 是一次 `getBoundingClientRect`，值没变时 `setState` 直接被 React 吞掉，不会转。
 */
function useSessionRowHeight(ref: React.RefObject<HTMLElement | null>): number {
  const [height, setHeight] = useState(SESSION_LIST_ITEM_HEIGHT);
  useLayoutEffect(() => {
    const row = ref.current?.querySelector<HTMLElement>(".d-sess, .m-row");
    const next = row ? Math.ceil(row.getBoundingClientRect().height) : 0;
    if (next > 0) setHeight(next);
  });
  return height;
}

function ProjectRow({
  projectKey,
  label,
  title,
  selected,
  activity,
  onClick,
  onNewSession,
  onOpenFolder,
  onRename,
  onRemove,
  onArchive,
  archived = false,
  renaming = false,
  onRenameCommit,
  onRenameCancel,
}: {
  projectKey: string;
  label: string;
  title: string;
  selected: boolean;

  activity?: { running: number; unread: number };
  onClick: () => void;
  /** fork:ui-project-actions — 项目行右侧的两个入口（照 workbuddy）：+ 在该项目里开新会话，
      ⋯ 里是三个项目动作。 */
  onNewSession?: () => void;
  onOpenFolder?: () => void;
  onRename?: () => void;
  onRemove?: () => void;
  /** fork:project-archive — 归档 / 恢复（纯展示，不动磁盘）。 */
  onArchive?: () => void;
  archived?: boolean;
  renaming?: boolean;
  onRenameCommit?: (name: string) => void;
  onRenameCancel?: () => void;
}) {
  const { t } = useI18n();
  const [hovered, setHovered] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [renameDraft, setRenameDraft] = useState(label);
  // fork:pwa-sb —— 触控设备上没有 hover：行内动作区默认隐藏，等用户「恰好」把手指
  // 落在行上才出现（合成 mouseenter），而抽屉一点就跟着关掉，等于永远点不到。
  // 更糟的是隐藏不等于不可点：`opacity: 0` 的 ⊕ 仍然吃 tap（实测 390 宽下
  // 14 个项目行各有一个 22×36 的隐形命中区压在行尾，探针 .probe-hitsize.mjs
  // 的「opacity:0 但仍可命中」计数 13 → 0 就是这条）。
  // 所以判据用 `useIsCompact`（≤1024，含手机）而不是 `useIsMobile`：平板档的
  // 侧栏虽然停靠而不是抽屉，hover 一样不存在。几何（间距 / 命中区）交给
  // app/fork-ui.css 的 fork:pwa-sidebar-files 段。
  const isMobile = useIsCompact();
  // fork:v5-wave-b —— 形态判据必须是 `useIsMobile`（≤640，与 pwa/system.css 的
  // @import 媒体条件同一个断点）：d-* 只在 ≥641 生效，平板档（641–1024）仍是 d-* DOM。
  const isPhone = useIsMobile();
  // fork:v5-frame-audit-2026-10-05 —— 行内动作回到板面上的真 `button`，锚点也跟着
  // 从「定位壳 div」变成那枚按钮本身（PortalDropdown 是 fixed + rect 计算）。
  const menuRef = useRef<HTMLButtonElement>(null);
  // fork:ui-pop-portal — 菜单本体 portal 到 body，关闭判据要连同面板一起算。
  const menuPanelRef = useRef<HTMLDivElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !menuPanelRef.current?.contains(target)) setMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  useEffect(() => {
    if (!renaming) return;
    setRenameDraft(label);
    const id = requestAnimationFrame(() => renameInputRef.current?.select());
    return () => cancelAnimationFrame(id);
  }, [renaming, label]);

  // fork:zc-11 — 拖拽句柄由 GroupedProjectList 的 context 注入；
  // 不在分组列表里（或 context 缺失）时是禁用态，点击/展开行为不变。
  const drag = useProjectDrag(projectKey);

  // 重命名时这一行换成输入框：`<input>` 不能嵌在 `<button>` 里，所以整行换元素。
  // 画板 D-02d 帧 B「就地改名」：`.d-group-title` 里直接放 `.d-input`，不弹对话框。
  if (renaming) {
    return (
      <div className="d-group-title" style={{ width: "100%" }}>
        <input
          ref={renameInputRef}
          value={renameDraft}
          onChange={(event) => setRenameDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") { event.preventDefault(); onRenameCommit?.(renameDraft); }
            if (event.key === "Escape") { event.preventDefault(); onRenameCancel?.(); }
          }}
          onBlur={() => onRenameCommit?.(renameDraft)}
          aria-label={t("sidebar.renameProject")}
          maxLength={60}
          className="d-input d-grow fork-pwa-sb-input"
        />
      </div>
    );
  }

  return (
    // fork:v5-frame-audit-2026-10-05 —— 项目行照画板 D-02 帧 A / D-02d 帧 A 的**原文**：
    //   `<div class="d-group-title"><i chevron><span class="d-grow">名称</span><span class="d-t-xs">N</span>`
    //   `<button class="d-iconbtn" ⋯><button class="d-iconbtn" ＋></div>`
    // 板面上这一行是 **div**：行尾两枚动作是真正的 `button`。产品此前把整行做成了
    // `<button class="d-group-title">`，于是行尾动作只能降级成 `span[role=button]`，
    // 并被塞进一层 `span.d-msg-acts` + 一层 `div` 定位壳 —— 嵌套可点元素本来就非法，
    // 现在按板面改成 div + role=button（与板面「项目」分区头同一写法），
    // 键盘（Enter / 空格）、拖拽源、菜单、回调、拖放落点全部原样接回。
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        onClick();
      }}
      title={title}
      aria-current={selected ? "page" : undefined}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      draggable={drag.draggable}
      // fix:row-actions-drag —— 项目行整体是拖拽源，而 ⋯ / ⊕ 这些动作钮只有 22px。
      // 在 draggable 的元素上按下再抬起，只要有 2-3px 位移，浏览器就开始 HTML5 拖拽
      // 并**取消这次 click** —— 表现就是「这三个点点了没反应」（实测在 WebKit/Electron
      // 下尤其容易触发）。从动作区起手的拖拽一律取消，让点击照常派发。
      onDragStart={(event) => {
        if ((event.target as HTMLElement | null)?.closest?.("[data-project-actions]")) {
          event.preventDefault();
          return;
        }
        drag.onDragStart(event);
      }}
      onDragEnd={drag.onDragEnd}
      // fork:v5-landing —— 项目行照画板 D-02/D-02d 的 `.d-group-title`：
      // 折叠箭头 + 名称（d-grow）+ 计数（d-t-xs）+ 行尾 ⋯ / ⊕（d-iconbtn）。
      // fork:v5-wave-b —— 窄屏换成画板 M-06 的单行件 `.m-trow`（图标 + 名称 + 计数 +
      // 行尾动作，选中态 `.is-on`）；行内动作在触控档本来就常驻，所以 `.m-msg-acts`
      // 直接带 `is-on`。拖拽源 / 拖放 / 菜单 / 回调一字未动。
      // fork:sidebar-project-name（用户 2026-10-05）—— 名称格叠加产品类抬字号，
      // 规则在 fork-ui.css；分区头 / 分支行不带这个类，维持画板原档。
      className={`${isPhone ? "m-trow" : "d-group-title"} fork-proj-title${selected ? " is-on" : ""}`}
      style={{
        width: "100%",
        cursor: "pointer",
        opacity: drag.dragging ? 0.55 : 1,
      }}
    >
      {/* 用户 2026-10-05 —— 前面的折叠箭头换成文件夹图标，行尾的会话计数整列去掉
          （数字浮在行尾一大片留白中间，视觉上像是另一列）。展开/折叠仍在整行点击上：
          选中后再点一次即折叠，见调用点的 onClick。 */}
      <i data-ico="folder" data-size="14"></i>
      <span className={isPhone ? "m-grow" : "d-grow"} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
      {showProjectActivity(activity, t, isPhone)}
      {/* fork:ui-project-actions — hover 才出现的两个入口（照 Zeno 的次序：⋯ 在内、⊕ 贴行尾）。
          fix:row-actions-drag —— `data-project-actions` 让行上的 dragstart 识别「这次
          是从动作区起手的」，直接取消拖拽、保住点击。 */}
      <span className={isPhone ? "m-msg-acts is-on" : `d-msg-acts fork-pwa-sb-proj-acts${hovered || menuOpen || isMobile ? " is-on" : ""}`} data-project-actions="" draggable={false} style={{ flexShrink: 0 }}>
      {(onOpenFolder || onRename || onRemove || onArchive) && (
        <button
          ref={menuRef}
          type="button"
          aria-label={t("sidebar.projectActions")}
          aria-expanded={menuOpen}
          title={t("sidebar.projectActions")}
          onClick={(event) => {
            event.stopPropagation();
            setMenuOpen((open) => !open);
          }}
          // fork:v5-frame-audit-2026-10-05 —— 行已经是 div，这两枚可以回到板面上的
          // 真 `button.d-iconbtn`（原来被挤成 span[role=button] 是因为整行是 button）。
          // 键盘语义由 button 自带，Enter / 空格由浏览器派发 click，与原逻辑等价。
          className={`d-iconbtn${menuOpen ? " is-on" : ""}`}
        >
          <i data-ico="ellipsis" data-size="13"></i>
        </button>
      )}
      {/* fork:ui-pop-portal —— 项目菜单 = 画板 D-02c 的 .d-pop + .d-menu-row，
          portal 到 body 定值定位：项目行在滚动区下部时菜单不再被裁/撑长列表。
          fork:v5-frame-audit-2026-10-05 —— 原来套在行内的一层 `div[style=position:relative]`
          只是历史绝对定位时代的定位锚点；PortalDropdown 是 fixed + rect 计算，锚点
          直接用那枚 button 即可，这一层从 DOM 里去掉（板面上也没有）。 */}
      <PortalDropdown
        open={menuOpen}
        anchorRef={menuRef}
        panelRef={menuPanelRef}
        className={isPhone ? "m-pop-float" : "d-pop-float"}
        width={210}
        align="right"
      >
        <div role="menu">
          {onOpenFolder && (
            <button type="button" role="menuitem" className={isPhone ? "m-menu-row" : "d-menu-row"} style={{ width: "100%" }} onClick={(event) => { event.stopPropagation(); setMenuOpen(false); onOpenFolder(); }}>
              <i data-ico="folder-open" data-size="14"></i>
              {t("sidebar.openProjectFolder")}
            </button>
          )}
          {onRename && (
            <button type="button" role="menuitem" className={isPhone ? "m-menu-row" : "d-menu-row"} style={{ width: "100%" }} onClick={(event) => { event.stopPropagation(); setMenuOpen(false); onRename(); }}>
              <i data-ico="square-pen" data-size="14"></i>
              {t("sidebar.renameProject")}
            </button>
          )}
          {onArchive && (
            <button type="button" role="menuitem" className={isPhone ? "m-menu-row" : "d-menu-row"} style={{ width: "100%" }} onClick={(event) => { event.stopPropagation(); setMenuOpen(false); onArchive(); }}>
              <i data-ico="archive" data-size="14"></i>
              {archived ? t("sidebar.restoreProject") : t("sidebar.archiveProject")}
            </button>
          )}
          {onRemove && (
            <>
              <div className={isPhone ? "m-sep" : "d-sep"} />
              <button type="button" role="menuitem" className={isPhone ? "m-menu-row danger" : "d-menu-row danger"} style={{ width: "100%" }} onClick={(event) => { event.stopPropagation(); setMenuOpen(false); onRemove(); }}>
                <i data-ico="minus" data-size="14"></i>
                {t("sidebar.removeProject")}
              </button>
            </>
          )}
        </div>
      </PortalDropdown>
      {/* ⊕：直接在这个项目里开新会话（workbuddy 的 ⊕），排在 ⋯ 右侧、贴行尾。 */}
      {onNewSession && (
        <button
          type="button"
          aria-label={t("sidebar.newSessionInProject")}
          title={t("sidebar.newSessionInProject")}
          onClick={(event) => {
            event.stopPropagation();
            onNewSession();
          }}
          className={isPhone ? "m-iconbtn" : "d-iconbtn"}
        >
          <i data-ico="plus" data-size="13"></i>
        </button>
      )}
      </span>
    </div>
  );
}

export function SessionSidebar({ selectedSessionId, onSelectSession, onNewSession, initialSessionId, skipInitialProjectSelection, onInitialRestoreDone, refreshKey, onSessionDeleted, selectedCwd: selectedCwdProp, onCwdChange, onBackgroundTaskDone, onRunningSessionIdsChange, onSessionsChange, onToggleSidebar, searchRequestId = 0 }: Props) {
  const { t } = useI18n();
  const [allSessions, setAllSessions] = useState<SessionInfo[]>([]);
  // Tracked in a ref only: the version is compared against the polled value to
  // decide whether the list needs reloading, and no render reads it.
  const sessionListVersionRef = useRef<number | null>(null);
  const [sessionListVersion, setSessionListVersion] = useState<number | null>(null);
  const sessionLoadIdRef = useRef(0);
  // fork:fix-url-session-restore — whether /api/sessions has answered at least once.
  // The `?session=` restore is one-shot, and it must not be spent while the list is
  // still empty-but-coming (see the restore effect below).
  const sessionsLoadedRef = useRef(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCwd, setSelectedCwd] = useState<string | null>(null);
  const [homeDir, setHomeDir] = useState<string>("");
  const [wtFilter, setWtFilter] = useState("");
  const [customPathOpen, setCustomPathOpen] = useState(false);
  const [customPathValue, setCustomPathValue] = useState(loadLastCustomCwd);
  const [customPathError, setCustomPathError] = useState<string | null>(null);
  const [customPathValidating, setCustomPathValidating] = useState(false);
  const [nativePicking, setNativePicking] = useState(false);
  const isMobile = useIsMobile();
  const [validatedProject, setValidatedProject] = useState<ValidatedProject | null>(null);
  // fork:chat-workspace — standalone chat workspace, identified by the server key.
  const [chatWorkspace, setChatWorkspace] = useState<{ cwd: string; key: string } | null>(null);
  const [chatWorkspaceBusy, setChatWorkspaceBusy] = useState(false);
  const [chatPathOpen, setChatPathOpen] = useState(false);
  const [chatPathError, setChatPathError] = useState<string | null>(null);
  // ponytail: 每個項目獨立展開，避免只能看選中項的傻折疊
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  // fork:ui-10 — list order + the "expand/collapse all" switch.
  // fork:ui — 排序开关已移除（用户要求）：会话固定按最后修改时间倒序，state 一并删掉。
  // fix:no-time-groups —— 时间分组头的折叠状态（今天/昨天/本周…）整块退役：
  // 侧栏列表改成一行一个会话，不再分桶。
  // `lib/time-group-state`（及其测试）随之删除：它只剩这里这句注释在提，
  // 没有任何模块 import 它 —— 真正还在跑的置顶分区是 `applySessionFlags`
  // （`lib/session-flags.ts`），那条路由 `lib/session-flags.test.mjs` 盖着。
  // 归档区默认折叠；每个项目独立记忆展开状态（取消归档的右键菜单入口）。
  // fork:zc-11 — 项目分组/顺序的 localStorage store（状态 + 纯操作封装）。
  const sessionGroups = useSessionGroups();
  const sessionListRef = useRef<HTMLDivElement>(null);
  const [sessionListOffsetTop, setSessionListOffsetTop] = useState(0);
  // Worktree switcher state
  const [worktreeState, setWorktreeState] = useState<WorktreeState | null>(null);
  const [wtDropdownOpen, setWtDropdownOpen] = useState(false);
  const [wtNewOpen, setWtNewOpen] = useState(false);
  const [wtNewBranch, setWtNewBranch] = useState("");
  const [wtError, setWtError] = useState<string | null>(null);
  const [wtBusy, setWtBusy] = useState(false);
  const [wtConfirmRemove, setWtConfirmRemove] = useState<string | null>(null);
  const [worktreeLoadingCwd, setWorktreeLoadingCwd] = useState<string | null>(null);
  const wtDropdownRef = useRef<HTMLDivElement>(null);
  // fork:ui-pop-portal — 下拉本体 portal 到 body，关闭判据要连同面板一起算。
  const wtPanelRef = useRef<HTMLDivElement>(null);
  const wtNewInputRef = useRef<HTMLInputElement>(null);
  /* fix:search-collapsed —— 搜索是**一个状态**，不是一个常驻格子：
     默认收起（画板 02 帧 A 的项目 pane 根本没有搜索格），点头部搜索钮才展开并聚焦，
     清除钮 / Esc / 清空后失焦即收起。台账见 DIVERGENCE 38。
     `searchRequestId` 是折叠导轨点搜索时 AppShell 递过来的计数，收到就展开并聚焦。 */
  const [sessionSearchOpen, setSessionSearchOpen] = useState(false);
  const [sessionSearchQuery, setSessionSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchToggleRef = useRef<HTMLButtonElement>(null);
  const closeSessionSearch = useCallback(() => {
    setSessionSearchQuery("");
    setSessionSearchOpen(false);
    // 焦点还留在正在卸载的输入框上会掉到 body，键盘 Tab 要从头开始 —— 交还给触发钮。
    searchToggleRef.current?.focus();
  }, []);
  useEffect(() => {
    if (searchRequestId <= 0) return;
    setSessionSearchOpen(true);
    requestAnimationFrame(() => searchInputRef.current?.focus());
  }, [searchRequestId]);
  /* fork:v5-landing-2026-10-04 —— 搜索格本体（画板 D-02 帧 D / D-02d 帧 E 的
     `.d-searchfield`，窄屏换 M-04 帧 B 的 `.m-searchfield`）。
     input 只有这一份：两支共用同一个 ref / id / maxLength / autoComplete /
     aria-label / placeholder / onChange / Esc 行为，所以抽成一个取类名的函数，
     而不是把整段 JSX 复制两遍（复制 = 下一处改动漏一半）。清除钮的类名跟着
     形态走（`d-iconbtn` / `m-iconbtn`），与画板两帧一致。 */
  const sessionSearchField = (className: string) => (
    // fork:v5-frame-audit-2026-10-05 —— 画板 D-02 帧 D / D-02d 帧 E 的搜索格是
    // `<div class="d-searchfield"><i><input …><button class="d-iconbtn">×</button></div>`
    // —— 一个 div（不是 label）。label 那一层还会给整格叠一层 UA 的点击行为，
    // 与板面不一致；输入框本来就有 aria-label，可访问名一字不变。
    <div className={className}>
      <i data-ico="search" data-size={isMobile ? "14" : "13"}></i>
      <input
        id="session-search-input"
        ref={searchInputRef}
        type="search"
        value={sessionSearchQuery}
        maxLength={200}
        autoComplete="off"
        aria-label={t("sidebar.searchSessions")}
        placeholder={t("sidebar.searchSessions")}
        onChange={(event) => {
          setSessionSearchQuery(event.target.value);
          /* fork:v5-frame-audit（2026-10-05）—— 窄屏那一格**常驻**（画板 M-04 帧 A/B：
             「抽屉只配三样东西 —— 搜索、分段、会话行」，搜索不是折叠态才出现的格子）。
             桌面仍然只在 `sessionSearchOpen` 时才挂这一格（DIVERGENCE 38 的用户裁定
             不动），所以多写这一次 `setSessionSearchOpen(true)` 在桌面是空操作 ——
             那里输入框存在就意味着已经开着。 */
          setSessionSearchOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            closeSessionSearch();
          }
        }}
      />
      {/* fork:v5-frame-audit —— 画板 M-04 帧 A 的搜索格是 `i[search] + input` 两件；
          清除钮只在**真装了检索词**时才占那一格（常驻一枚空按钮会在帧 A 上多出一个
          板面没有的控件）。桌面那一格保持原样：它本来就只在 `sessionSearchOpen`
          时挂载，清除钮常驻是 D-02 帧 D 那一档的形状。 */}
      {(sessionSearchQuery || !isMobile) && (
        <button
          type="button"
          onClick={closeSessionSearch}
          title={t("sidebar.clearSearch")}
          aria-label={t("sidebar.clearSearch")}
          className={isMobile ? "m-iconbtn" : "d-iconbtn"}
        >
          <i data-ico="x" data-size="13"></i>
        </button>
      )}
    </div>
  );
  const [sidebarPane, setSidebarPane] = useState<SidebarPane>(readStoredSidebarPane);
  const selectPane = (next: SidebarPane) => {
    setSidebarPane(next);
    writeStoredSidebarPane(next);
    /* 切到「聊天」时顺手把它展开：用户点这一下就是想看会话，结果给一行收起的
       标题（还要再点一次）等于没切。只在没展开时加，所以再点标题仍能收起。
       `chatProject` 在上面之后才声明，但闭包在点击时才求值 —— 那时已初始化。 */
    if (next === "chat" && chatProject) {
      setExpandedProjects((prev) => (prev.has(chatProject.key) ? prev : new Set(prev).add(chatProject.key)));
    }
  };
  // fix:search-collapsed —— 搜索态 = 「盒子展开」且「有检索词」。列表虚拟化与
  // SessionSearch 都以这个值为准（展开但没输入时仍然显示正常会话列表）。
  const sessionSearchActive = sessionSearchOpen && Boolean(sessionSearchQuery.trim());
  const [runningSessionIds, setRunningSessionIds] = useState<Set<string>>(() => new Set());
  // fork:design-system — 「等你处理」（画板 02 第三态）：挂起扩展请求、不在跑的会话。
  // 与 running 同一次轮询取回，所以不额外发请求。
  const [awaitingSessionIds, setAwaitingSessionIds] = useState<Set<string>>(() => new Set());
  const [awaitingSessionKinds, setAwaitingSessionKinds] = useState<Record<string, "approval" | "input">>({});
  // fork:trace-menu —— 未读标记搬进 lib/session-unread.ts，顶栏 ⋯ 菜单的「标记为未读」
  // 与这里画的未读点共用一份存储（原来是本文件私有的 useState，外部点不到）。
  const unreadSessionIds = useUnreadSessions();
  const { flags: sessionFlags } = useSessionFlags();
  const previousRunningSessionIdsRef = useRef<Set<string>>(new Set());
  const currentSuppressedCompletionSessionIdsRef = useRef<Set<string>>(new Set());
  const previousSuppressedCompletionSessionIdsRef = useRef<Set<string>>(new Set());
  // Once polling has delivered a snapshot it is the source of truth for
  // running state; late /api/sessions responses must not overwrite it.
  const runningPollAuthoritativeRef = useRef(false);
  const detailsHydrationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Virtualized session list: only the visible window of rows is mounted.
  const listScrollRef = useRef<HTMLDivElement>(null);
  const [listViewportH, setListViewportH] = useState(0);
  const [listScrollTop, setListScrollTop] = useState(0);
  const [focusedSessionId, setFocusedSessionId] = useState<string | null>(null);
  const listScrollRafRef = useRef<number | null>(null);

  /* fork:pwa-drawer-gesture —— 手机抽屉的两条手势（点遮罩关闭由 AppShell 的遮罩
     onClick 负责，这里补另两条）。抽屉壳在 AppShell 里，但这一列由本组件渲染、
     `onToggleSidebar` 由 AppShell 递进来，所以监听挂在 `#session-sidebar` 上：

       · **左滑关闭**：`touchstart → touchend`，只在抽屉已打开时生效，且要求横向位移
         明显大于纵向（不然会把「上下滑列表」误判成关闭）。阈���从
         `--fork-pwa-sb-swipe` 读，值与其它间距一起放在 fork-ui.css。
       · **Esc 关闭**：气泡阶段监听且跳过 `defaultPrevented` / 已有对话框在场的情形
         —— 设置、模型等弹层都自己 document 级监听 Esc，本组件比它们先挂载，
         不让位的话一次 Esc 会把弹层和抽屉一起关掉。

     只在 ≤640px 的抽屉态接线（`useIsMobile`），桌面端这两个监听根本不注册。 */
  const isMobileDrawer = useIsMobile();
  useEffect(() => {
    if (!onToggleSidebar || !isMobileDrawer) return;
    const drawer = document.getElementById("session-sidebar");
    if (!drawer) return;

    let startX = 0;
    let startY = 0;
    let tracking = false;
    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) { tracking = false; return; }
      if (!drawer.classList.contains("sidebar-open")) { tracking = false; return; }
      startX = event.touches[0].clientX;
      startY = event.touches[0].clientY;
      tracking = true;
    };
    const onTouchEnd = (event: TouchEvent) => {
      if (!tracking) return;
      tracking = false;
      const touch = event.changedTouches[0];
      if (!touch) return;
      /* 阈值从样式表读（`--fork-pwa-sb-swipe`），组件里不写死像素。
         自定义属性的计算值是**代入之后**的 token 表达式（`calc(36px + 12px)`），
         不是 `48px`，所以按 px 项加总，而不是 parseFloat 整个串。 */
      const raw = getComputedStyle(drawer).getPropertyValue("--fork-pwa-sb-swipe");
      let threshold = 0;
      for (const match of raw.matchAll(/(-?[\d.]+)px/g)) threshold += Number.parseFloat(match[1]);
      if (threshold <= 0) return;
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;
      if (dx > -threshold) return;
      if (Math.abs(dx) < Math.abs(dy)) return;
      onToggleSidebar();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (document.querySelector('[role="dialog"], [aria-modal="true"]')) return;
      if (!drawer.classList.contains("sidebar-open")) return;
      event.preventDefault();
      onToggleSidebar();
    };
    drawer.addEventListener("touchstart", onTouchStart, { passive: true });
    drawer.addEventListener("touchend", onTouchEnd, { passive: true });
    drawer.addEventListener("touchcancel", () => { tracking = false; }, { passive: true });
    document.addEventListener("keydown", onKeyDown);
    return () => {
      drawer.removeEventListener("touchstart", onTouchStart);
      drawer.removeEventListener("touchend", onTouchEnd);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onToggleSidebar, isMobileDrawer]);

  const handleListScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const top = e.currentTarget.scrollTop;
    if (listScrollRafRef.current != null) return;
    listScrollRafRef.current = requestAnimationFrame(() => {
      listScrollRafRef.current = null;
      setListScrollTop(top);
    });
  }, []);
  useLayoutEffect(() => {
    const el = listScrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) setListViewportH(entry.contentRect.height);
    });
    ro.observe(el);
    setListViewportH(el.clientHeight);
    setListScrollTop(el.scrollTop);
    return () => ro.disconnect();
  }, [sessionSearchActive]);

  const loadSessions = useCallback(async (showLoading = false, force = false, summary = false) => {
    const loadId = ++sessionLoadIdRef.current;
    try {
      if (showLoading) setLoading(true);
      const res = await fetch(sessionListUrl(summary, force), {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as {
        sessions: SessionInfo[];
        sessionListVersion: number;
        runningSessionIds?: string[];
        awaitingSessionIds?: string[];
        awaitingSessionKinds?: Record<string, "approval" | "input">;
        completionNotificationSuppressedSessionIds?: string[];
      };
      if (loadId !== sessionLoadIdRef.current) return;
      sessionListVersionRef.current = data.sessionListVersion;
      sessionsLoadedRef.current = true;
      setSessionListVersion(data.sessionListVersion);
      setAllSessions(data.sessions);
      // Treat the fetched running set as an initial fallback only. Once the
      // lightweight poll is live, a slow session-list fetch cannot overwrite it.
      if (!runningPollAuthoritativeRef.current) {
        currentSuppressedCompletionSessionIdsRef.current = new Set(
          data.completionNotificationSuppressedSessionIds ?? [],
        );
        setRunningSessionIds(new Set(data.runningSessionIds ?? []));
        setAwaitingSessionIds(new Set(data.awaitingSessionIds ?? []));
        setAwaitingSessionKinds(data.awaitingSessionKinds ?? {});
      }
      // Drop markers for deleted sessions and for subagents, whose completion
      // is intentionally silent even if an older client marked them unread.
      const unreadEligibleIds = new Set(
        data.sessions
          .filter((session) => session.relation?.kind !== "subagent")
          .map((session) => session.id),
      );
      pruneSessionUnread(unreadEligibleIds);
      // fork:d03-frame-c —— 读到哪（D-03 帧 C 的分割线）与未读点同寿命：会话没了，
      // 它的读数也不能留（否则 localStorage 里的键只增不减）。
      pruneReadCursors(unreadEligibleIds);
      setError(null);
    } catch (e) {
      if (loadId === sessionLoadIdRef.current) setError(String(e));
    } finally {
      if (loadId === sessionLoadIdRef.current) setLoading(false);
    }
  }, []);

  /* fork:mobile-drawer-2026-10-03 —— 列表**下拉刷新**。
     侧栏本来就有 2.5s 一次的 running 轮询，但它只改运行态、不重读会话列表；
     在 PC 上开着的会话（新终端、新目录）只有重新拉列表才看得到，而手机上没有
     别的刷新口（搜索行是筛选不是刷新）。
     判定全部在手算里：必须已经在顶部（scrollTop<=0）且方向朝下，否则这是滚动。
     不调preventDefault —— 容器已有 overscroll-behavior: contain，浏览器自己不会
     橡皮筋回弹，而抢下默认行为会把手势与抽屉左滑关闭打架。
     阈值/上限是像素常量（JS 数值，不是样式字面量，不受 check-style-literals 管）。 */
  const PULL_TRIGGER_PX = 64;
  const PULL_MAX_PX = 56;
  const [pullPx, setPullPx] = useState(0);
  const [pullRefreshing, setPullRefreshing] = useState(false);
  const pullStartRef = useRef<{ y: number; armed: boolean } | null>(null);
  const handleListTouchStart = useCallback((event: React.TouchEvent<HTMLDivElement>) => {
    if (pullRefreshing) return;
    const el = listScrollRef.current;
    pullStartRef.current = { y: event.touches[0]?.clientY ?? 0, armed: (el?.scrollTop ?? 1) <= 0 };
    setPullPx(0);
  }, [pullRefreshing]);
  const handleListTouchMove = useCallback((event: React.TouchEvent<HTMLDivElement>) => {
    const start = pullStartRef.current;
    if (!start?.armed || pullRefreshing) return;
    const dy = (event.touches[0]?.clientY ?? 0) - start.y;
    if (dy <= 0) {
      // 回到顶部以内（或改成上滑）就撤销这次下拉 —— 否则松手时仍会触发。
      start.armed = false;
      setPullPx(0);
      return;
    }
    // 阻尼：拉得越多越沉，永远到不了阈值上限的无穷大。
    setPullPx(Math.min(PULL_MAX_PX, dy * 0.5));
  }, [pullRefreshing]);
  const handleListTouchEnd = useCallback(() => {
    const start = pullStartRef.current;
    pullStartRef.current = null;
    if (!start?.armed || pullRefreshing) return;
    setPullPx(0);
    if (pullPx < PULL_TRIGGER_PX / 2) return;
    setPullRefreshing(true);
    void loadSessions(false, true).finally(() => setPullRefreshing(false));
  }, [loadSessions, pullPx, pullRefreshing]);

  const initialLoadDone = useRef(false);
  useEffect(() => {
    const isFirst = !initialLoadDone.current;
    initialLoadDone.current = true;
    let active = true;

    if (isFirst) {
      // Header/stat metadata is enough to select the URL session and paint the
      // sidebar. Hydrate exact counts, names, and first messages once the
      // selected chat has had a chance to start loading.
      void loadSessions(true, false, true).then(() => {
        if (!active) return;
        detailsHydrationTimerRef.current = setTimeout(() => {
          detailsHydrationTimerRef.current = null;
          if (active) void loadSessions(false, true);
        }, SESSION_DETAILS_HYDRATION_DELAY_MS);
      });
    } else {
      void loadSessions(false, true);
    }

    return () => {
      active = false;
      if (detailsHydrationTimerRef.current) {
        clearTimeout(detailsHydrationTimerRef.current);
        detailsHydrationTimerRef.current = null;
      }
    };
  }, [loadSessions, refreshKey]);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let controller: AbortController | null = null;

    const clearTimer = () => {
      if (timer) clearTimeout(timer);
      timer = null;
    };

    const schedule = () => {
      clearTimer();
      if (stopped || document.visibilityState !== "visible") return;
      timer = setTimeout(() => void poll(), RUNNING_SESSIONS_POLL_MS);
    };

    const poll = async () => {
      if (stopped || document.visibilityState !== "visible") return;
      const current = new AbortController();
      controller?.abort();
      controller = current;
      try {
        const res = await fetch("/api/agent/running", {
          cache: "no-store",
          signal: current.signal,
        });
        if (!res.ok) return;
        const data = await res.json() as {
          sessionListVersion: number;
          runningSessionIds?: string[];
        awaitingSessionIds?: string[];
        awaitingSessionKinds?: Record<string, "approval" | "input">;
          completionNotificationSuppressedSessionIds?: string[];
        };
        if (stopped || controller !== current) return;
        runningPollAuthoritativeRef.current = true;
        currentSuppressedCompletionSessionIdsRef.current = new Set(
          data.completionNotificationSuppressedSessionIds ?? [],
        );
        setRunningSessionIds(new Set(data.runningSessionIds ?? []));
        setAwaitingSessionIds(new Set(data.awaitingSessionIds ?? []));
        setAwaitingSessionKinds(data.awaitingSessionKinds ?? {});
        if (data.sessionListVersion !== sessionListVersionRef.current) {
          // Reuse the invalidated cache; forcing a scan would change the version again.
          await loadSessions();
        }
      } catch {
        // Keep the last known state; the next visible-tab poll retries.
      } finally {
        if (controller === current) controller = null;
        schedule();
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void poll();
        return;
      }
      clearTimer();
      controller?.abort();
      controller = null;
    };

    void poll();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      stopped = true;
      clearTimer();
      controller?.abort();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [loadSessions]);

  useEffect(() => {
    onRunningSessionIdsChange?.(runningSessionIds);
  }, [onRunningSessionIdsChange, runningSessionIds]);

  useEffect(() => {
    onSessionsChange?.(allSessions);
  }, [allSessions, onSessionsChange]);

  useEffect(() => {
    const previous = previousRunningSessionIdsRef.current;
    const completedInBackground = [...previous].filter((id) => !runningSessionIds.has(id) && id !== selectedSessionId);
    const knownSubagentIds = new Set(
      allSessions
        .filter((session) => session.relation?.kind === "subagent")
        .map((session) => session.id),
    );
    const completedWithNotifications = completedInBackground.filter(
      (id) => !previousSuppressedCompletionSessionIdsRef.current.has(id) && !knownSubagentIds.has(id),
    );
    const newlyRunning = [...runningSessionIds].filter((id) => !previous.has(id));

    if (completedWithNotifications.length > 0 || newlyRunning.length > 0) {
      runningSessionIds.forEach(clearSessionUnread);
      completedWithNotifications.forEach(markSessionUnread);
    }
    const hasUnlistedRunningSession = newlyRunning.some(
      (id) => !allSessions.some((session) => session.id === id),
    );
    if (completedInBackground.length > 0 || hasUnlistedRunningSession) {
      loadSessions(false, true);
    }
    if (completedWithNotifications.length > 0) {
      onBackgroundTaskDone?.();
    }

    previousRunningSessionIdsRef.current = runningSessionIds;
    previousSuppressedCompletionSessionIdsRef.current = new Set(
      [...runningSessionIds].filter(
        (id) => currentSuppressedCompletionSessionIdsRef.current.has(id) || knownSubagentIds.has(id),
      ),
    );
  }, [runningSessionIds, selectedSessionId, allSessions, loadSessions, onBackgroundTaskDone]);

  useEffect(() => {
    if (!selectedSessionId) return;
    clearSessionUnread(selectedSessionId);
  }, [selectedSessionId]);

  useEffect(() => {
    fetch("/api/home").then((r) => r.json()).then((d: { home?: string }) => {
      if (d.home) setHomeDir(d.home);
    }).catch(() => {});
  }, []);

  // fork:chat-workspace — read (and create) the standalone chat workspace once per
  // mount. It lives in state instead of being derived from sessions so the section
  // stays available with zero chats.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/chat-workspace", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { cwd?: string; projectKey?: string } | null) => {
        if (cancelled || !d?.cwd || !d.projectKey) return;
        setChatWorkspace({ cwd: d.cwd, key: d.projectKey });
        // Seed the validated identity so projectFor() resolves the server key
        // before the first standalone chat session exists.
        setValidatedProject((prev) => prev ?? { cwd: d.cwd!, root: d.cwd!, key: d.projectKey! });
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const restoredRef = useRef(false);

  const projectSelection = useCallback((root: string, key: string): ProjectSelection => ({
    root,
    key,
  }), []);

  /** Resolve both display root and stable identity from server-provided data. */
  const projectFor = useCallback((cwd: string | null): ProjectSelection | null => {
    if (!cwd) return null;
    // /api/cwd/validate resolves identity before a custom path becomes active,
    // preventing one render with a raw path key from looking like a switch.
    if (validatedProject?.cwd === cwd) {
      return projectSelection(validatedProject.root, validatedProject.key);
    }
    if (worktreeState && worktreeState.forCwd === cwd) {
      return projectSelection(worktreeState.projectRoot, worktreeState.projectKey);
    }
    // Any path in the loaded worktree list belongs to that project — covers
    // worktrees without sessions, so switching to them keeps the row mounted.
    if (worktreeState?.worktrees.some((w) => w.path === cwd)) {
      return projectSelection(worktreeState.projectRoot, worktreeState.projectKey);
    }
    const match = allSessions.find((session) => (
      session.cwd === cwd || (session.projectRoot ?? session.cwd) === cwd
    ));
    return match
      ? projectSelection(match.projectRoot ?? match.cwd, workspaceKeyOf(match))
      : projectSelection(cwd, cwd);
  }, [validatedProject, worktreeState, allSessions, projectSelection]);

  // A worktree/session refresh can hydrate the stable key without changing
  // cwd, so notify when either changes. The parent treats same-cwd key changes
  // as identity hydration rather than a workspace switch.
  const lastNotifiedProjectRef = useRef<{ cwd: string | null; key: string | null } | null>(null);
  useEffect(() => {
    const project = projectFor(selectedCwd);
    const previous = lastNotifiedProjectRef.current;
    if (previous?.cwd === selectedCwd && previous.key === (project?.key ?? null)) return;
    lastNotifiedProjectRef.current = { cwd: selectedCwd, key: project?.key ?? null };
    onCwdChange?.(
      selectedCwd,
      project?.root ?? null,
      project?.key ?? null,
    );
  }, [selectedCwd, onCwdChange, projectFor]);

  // Sync the worktree switcher to the selected session's cwd. Sessions of all
  // worktrees in a project share one list, so clicking a session from another
  // worktree should move the effective cwd there. Only fires when the prop
  // value changes, so a manual switcher change is not snapped back.
  const lastSyncedCwdPropRef = useRef<string | null>(null);
  useEffect(() => {
    if (selectedCwdProp && selectedCwdProp !== lastSyncedCwdPropRef.current) {
      lastSyncedCwdPropRef.current = selectedCwdProp;
      setSelectedCwd(selectedCwdProp);
    }
  }, [selectedCwdProp]);

  // Load worktrees for the current effective cwd
  const [wtRefreshKey, setWtRefreshKey] = useState(0);
  useLayoutEffect(() => {
    if (!selectedCwd) {
      setWorktreeState(null);
      setWorktreeLoadingCwd(null);
      return;
    }
    let cancelled = false;
    setWorktreeLoadingCwd(selectedCwd);
    fetch(`/api/worktrees?cwd=${encodeURIComponent(selectedCwd)}`)
      .then((r) => r.json())
      .then((d: { projectRoot?: string; projectKey?: string; isGit?: boolean; isTopLevel?: boolean; currentWorktreePath?: string | null; worktrees?: WorktreeEntry[]; error?: string }) => {
        if (cancelled) return;
        setWorktreeLoadingCwd(null);
        if (d.error || !d.projectRoot) {
          setWorktreeState(null);
          return;
        }
        setWorktreeState({
          forCwd: selectedCwd,
          projectRoot: d.projectRoot,
          projectKey: d.projectKey ?? d.projectRoot,
          isGit: d.isGit ?? false,
          isTopLevel: d.isTopLevel ?? false,
          currentWorktreePath: d.currentWorktreePath ?? null,
          worktrees: d.worktrees ?? [],
        });
      })
      .catch(() => {
        if (!cancelled) {
          setWorktreeLoadingCwd(null);
          setWorktreeState(null);
        }
      });
    return () => { cancelled = true; };
  }, [selectedCwd, wtRefreshKey, refreshKey]);

  // Auto-select cwd and restore session from URL on first load
  useEffect(() => {
    // fork:chat-workspace — with zero sessions the chat workspace is still a valid
    // landing spot, so only the URL-restore skip short-circuits here.
    if (skipInitialProjectSelection || (allSessions.length === 0 && !chatWorkspace)) return;

    if (selectedCwd === null) {
      // If restoring a session, set cwd to match that session
      if (initialSessionId && !restoredRef.current) {
        const target = allSessions.find((s) => s.id === initialSessionId);
        if (target) {
          restoredRef.current = true;
          setSelectedCwd(target.cwd);
          onSelectSession(target, true);
          return;
        }
        // fork:fix-url-session-restore — this effect can run before /api/sessions
        // lands: the `/api/chat-workspace` fetch resolves first, which clears the
        // `allSessions.length === 0` guard above and opens this branch with an
        // empty list. Spending the one-shot attempt there made `?session=<id>`
        // open the welcome page instead of the session on every install that has
        // a chat workspace — the e2e fixtures have none, which is why it stayed
        // invisible. Wait for the list: the effect re-runs when it arrives.
        if (!sessionsLoadedRef.current) return;
        restoredRef.current = true;
        // Session not found — notify parent so it can show the placeholder
        onInitialRestoreDone?.();
      }
      const projects = getRecentProjects(allSessions);
      // fork:chat-workspace — projects win; with none, land on the chat workspace so
      // the composer is the first screen instead of the "getting started" panel.
      const fallback = projects[0]?.root ?? chatWorkspace?.cwd ?? null;
      if (fallback) setSelectedCwd(fallback);
    }
  }, [allSessions, chatWorkspace, selectedCwd, initialSessionId, skipInitialProjectSelection, onSelectSession, onInitialRestoreDone]);

  // Prefer an exact UI selection while a refetch is in flight. Once the
  // response catches up, the server-resolved path handles Windows case and
  // separator differences without teaching the browser OS path semantics.
  const currentWorktree = worktreeState
    ? worktreeState.worktrees.find((worktree) => worktree.path === selectedCwd)
      ?? (worktreeState.forCwd === selectedCwd && worktreeState.currentWorktreePath
        ? worktreeState.worktrees.find((worktree) => worktree.path === worktreeState.currentWorktreePath)
        : undefined)
      ?? worktreeState.worktrees.find((worktree) => worktree.isMain)
    : undefined;
  const currentWorktreePath = currentWorktree?.path ?? null;

  const commitCustomPath = useCallback(async (candidate?: string) => {
    const path = (candidate ?? customPathValue).trim();
    if (!path || customPathValidating) return;

    setCustomPathValidating(true);
    setCustomPathError(null);
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
      if (!res.ok || data.error || !data.cwd || !data.projectRoot || !data.projectKey) {
        setCustomPathError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      setValidatedProject({
        cwd: data.cwd,
        root: data.projectRoot,
        key: data.projectKey,
      });
      saveLastCustomCwd(data.cwd);
      setCustomPathValue(data.cwd);
      setSelectedCwd(data.cwd);
      setCustomPathOpen(false);
    } catch (e) {
      setCustomPathError(e instanceof Error ? e.message : String(e));
    } finally {
      setCustomPathValidating(false);
    }
  }, [customPathValue, customPathValidating]);

  const handleCustomPathClick = useCallback(() => {
    setCustomPathOpen(true);
    setCustomPathError(null);
  }, []);
  // ponytail: 桌面走服务端原生选框，手机直走弹窗；服务端失败再试浏览器，最后回退
  const handleAddProjectClick = useCallback(async () => {
    if (isMobile) {
      handleCustomPathClick();
      return;
    }
    if (nativePicking || customPathValidating) return;
    setNativePicking(true);
    setCustomPathError(null);
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 65000);
      const res = await fetch("/api/cwd/pick", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPath: customPathValue || selectedCwd || undefined }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      const data = (await res.json().catch(() => ({}))) as { cwd?: string; cancelled?: boolean; fallback?: boolean; error?: string };
      if (res.ok && data.cwd) {
        await commitCustomPath(data.cwd);
        return;
      }
      if (data.cancelled) return;
      if (res.status === 501 && typeof window !== "undefined" && "showDirectoryPicker" in window) {
        try {
          const handle = await (window as unknown as { showDirectoryPicker: (opts?: unknown) => Promise<{ name: string }> }).showDirectoryPicker({ mode: "read" });
          const hint = handle.name;
          const guessed = customPathValue ? `${customPathValue.replace(/\/+$/, "")}/${hint}` : hint;
          setCustomPathValue(guessed);
        } catch (pickError: unknown) {
          const name = pickError instanceof Error ? pickError.name : "";
          if (name === "AbortError") return;
        }
      }
    } catch {
      // 静默回退到自定义弹窗
    } finally {
      setNativePicking(false);
    }
    handleCustomPathClick();
  }, [isMobile, nativePicking, customPathValidating, customPathValue, selectedCwd, commitCustomPath, handleCustomPathClick]);

  const handleCreateWorktree = useCallback(async () => {
    const branch = wtNewBranch.trim();
    if (!branch || wtBusy || !worktreeState) return;
    setWtBusy(true);
    setWtError(null);
    try {
      const res = await fetch("/api/worktrees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: worktreeState.projectRoot, branch }),
      });
      const data = await res.json().catch(() => ({})) as { path?: string; error?: string };
      if (!res.ok || data.error || !data.path) {
        setWtError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      setWtNewOpen(false);
      setWtNewBranch("");
      setWtDropdownOpen(false);
      // Optimistically register the new worktree so projectFor() resolves
      // it to the main repo before the refetch lands (keeps AppShell from
      // treating the new cwd as a different project).
      setWorktreeState((prev) => prev ? {
        ...prev,
        forCwd: data.path!,
        currentWorktreePath: data.path!,
        worktrees: [...prev.worktrees, { path: data.path!, branch, isMain: false }],
      } : prev);
      setSelectedCwd(data.path);
      setWtRefreshKey((k) => k + 1);
    } catch (e) {
      setWtError(e instanceof Error ? e.message : String(e));
    } finally {
      setWtBusy(false);
    }
  }, [wtNewBranch, wtBusy, worktreeState]);

  const handleRemoveWorktree = useCallback(async (path: string, force: boolean) => {
    if (!worktreeState || wtBusy) return;
    setWtBusy(true);
    setWtError(null);
    try {
      const res = await fetch("/api/worktrees", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: worktreeState.projectRoot, path, force }),
      });
      const data = await res.json().catch(() => ({})) as { error?: string; dirty?: boolean };
      if (!res.ok) {
        if (data.dirty && !force) {
          // Dirty worktree — ask the user to confirm a force removal
          setWtConfirmRemove(path);
          return;
        }
        setWtError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      setWtConfirmRemove(null);
      if (currentWorktreePath === path) setSelectedCwd(worktreeState.projectRoot);
      setWtRefreshKey((k) => k + 1);
    } catch (e) {
      setWtError(e instanceof Error ? e.message : String(e));
    } finally {
      setWtBusy(false);
    }
  }, [worktreeState, wtBusy, currentWorktreePath]);

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (wtDropdownRef.current?.contains(target) || wtPanelRef.current?.contains(target)) return;
      setWtDropdownOpen(false);
      setWtNewOpen(false);
      setWtNewBranch("");
      setWtError(null);
      setWtConfirmRemove(null);
      setWtFilter("");
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Clicking a session moves the effective cwd to that session's worktree.
  // Done on the click path (not via the selectedCwd prop sync) so it also
  // works when the prop value won't change — e.g. re-clicking the already
  // open session after manually switching worktrees.
  const handleSelectSessionFromList = useCallback((s: SessionInfo, entryId?: string, blockIndex?: number) => {
    setAllSessions((current) => current.some((session) => session.id === s.id) ? current : [s, ...current]);
    if (s.cwd) setSelectedCwd(s.cwd);
    onSelectSession(s, false, entryId, blockIndex);
  }, [onSelectSession]);

  // fork:chat-workspace — persist a different chat directory, and follow it when it
  // was the active workspace.
  const commitChatWorkspace = useCallback(async (path: string) => {
    if (chatWorkspaceBusy) return;
    setChatWorkspaceBusy(true);
    setChatPathError(null);
    try {
      const res = await fetch("/api/chat-workspace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: path }),
      });
      const data = await res.json().catch(() => ({})) as { cwd?: string; projectKey?: string; error?: string };
      if (!res.ok || !data.cwd || !data.projectKey) {
        setChatPathError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      const identity = { cwd: data.cwd, root: data.cwd, key: data.projectKey };
      setChatWorkspace({ cwd: identity.cwd, key: identity.key });
      setValidatedProject(identity);
      if (chatWorkspace && selectedCwd === chatWorkspace.cwd) setSelectedCwd(identity.cwd);
      setChatPathOpen(false);
    } catch (e) {
      setChatPathError(e instanceof Error ? e.message : String(e));
    } finally {
      setChatWorkspaceBusy(false);
    }
  }, [chatWorkspace, chatWorkspaceBusy, selectedCwd]);

  // fork:chat-workspace — start a session in an explicit workspace (chat or project):
  // move the workspace first so the explorer, file tabs and per-workspace session
  // memory follow it.
  const startSessionIn = useCallback((cwd: string) => {
    const tempId = typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
    setSelectedCwd(cwd);
    setCustomPathError(null);
    onNewSession?.(tempId, cwd);
  }, [onNewSession]);

  // fork:chat-workspace — resolve the default workspace when a task is started.
  // Reading it from render state handed `""`/`"/"` to the API whenever the async
  // /api/home or /api/chat-workspace response had not landed yet, which created a
  // session whose cwd was the filesystem root.
  const resolveDefaultCwd = useCallback(async (): Promise<string | null> => {
    if (selectedCwd) return selectedCwd;
    if (chatWorkspace?.cwd) return chatWorkspace.cwd;
    try {
      const res = await fetch("/api/chat-workspace", { cache: "no-store" });
      const data = await res.json() as { cwd?: string; projectKey?: string };
      if (data.cwd && data.projectKey) {
        setChatWorkspace({ cwd: data.cwd, key: data.projectKey });
        setValidatedProject((prev) => prev ?? { cwd: data.cwd!, root: data.cwd!, key: data.projectKey! });
        return data.cwd;
      }
    } catch {
      // fall back to the home directory below
    }
    return homeDir || null;
  }, [chatWorkspace, homeDir, selectedCwd]);

  const handleNewSession = useCallback(() => {
    void resolveDefaultCwd().then((cwd) => {
      if (cwd) startSessionIn(cwd);
    });
  }, [resolveDefaultCwd, startSessionIn]);

  // Sessions of every worktree in the selected project are shown together
  /**
   * fork:ui-10 — one place that turns "all sessions" into "this project's rows in the
   * requested order", so the five list call sites cannot drift apart.
   */
  /** 该项目的全部会话（含已归档），按最后修改时间倒序。 */
  const sortedProjectSessions = useCallback((projectKey: string) => {
    const rows = sessionsForProject(allSessions, projectKey);
    return [...rows].sort((a, b) => (
      // fork:ui — 排序开关已移除，固定按最后修改时间倒序。
      b.modified.localeCompare(a.modified)
    ));
  }, [allSessions]);

  const orderedProjectSessions = useCallback((projectKey: string) => (
    applySessionFlags(sortedProjectSessions(projectKey), sessionFlags)
  ), [sortedProjectSessions, sessionFlags]);

  const selectedProject = projectFor(selectedCwd);
  const projectChoices = useMemo(() => {
    const recent = getRecentProjects(allSessions);
    if (!selectedProject || recent.some((project) => project.key === selectedProject.key)) return recent;
    return [{ key: selectedProject.key, root: selectedProject.root }, ...recent];
  }, [allSessions, selectedProject]);
  // fork:chat-workspace — 聊天 与 项目 平级：聊天工作区永远在最上面，且从项目列表
  // （和工作区下拉）里剔除；两者靠各自的标题行区分，标题下各自渲染自己的会话。
  const chatProjectKey = chatWorkspace?.key ?? null;
  // 项目全部展示，靠外层滚动查看，不再截断
  // fork:ui-project-actions — 本地偏好：显示名 + 「从列表中移除」。当前选中的项目永远保留，
  // 否则移除后连自己在哪都看不出来。
  const { prefs: projectPrefs, setAlias: setProjectAlias, hideProject } = useProjectPrefs();
  // fork:project-archive — 归档只影响这一份列表：标志在 localStorage，选中项永远保留
  // （否则归档掉当前项目就看不出自己在哪了）。
  const { flags: projectFlags, archive: archiveProject, restore: restoreProject } = useProjectFlags();
  const [renamingProjectKey, setRenamingProjectKey] = useState<string | null>(null);
  const visibleProjects = filterArchivedProjects(
    filterHiddenProjects(
      withoutChatProject(projectChoices, chatProjectKey),
      projectPrefs,
      selectedProject?.root ?? null,
    ),
    projectFlags,
    selectedProject?.key ?? null,
  );
  const chatProject: RecentProject | null = chatWorkspace
    ? chatProjectOf(projectChoices, chatProjectKey) ?? { key: chatWorkspace.key, root: chatWorkspace.cwd }
    : null;
  // fork:design-system 判据⑦ —— 画板 01/02 的 `.pw-group-title` 左侧就是那枚
  // chevrons-up-down（展开 / 折叠全部的记号），右端才是动作位；画板里它是静态 div。
  // 这里把那一行整体接上同一个动作，元素层级保持与画板一致（不再另起一枚按钮，
  // 否则 22px 的 `.pw-iconbtn.sm` 会把标题推右 10px、行高从 29 增到 34）。
  const toggleAllProjects = () => {
    const keys = visibleProjects.map((project) => project.key);
    const allOpen = keys.length > 0 && keys.every((key) => expandedProjects.has(key));
    setExpandedProjects(allOpen ? new Set() : new Set(keys));
  };

  // Per-project activity counts (running / unread) for the workspace selector.
  // Uses the same stable server key as the project list and filtering.
  const projectActivity = useMemo(
    () => getProjectActivity(allSessions, runningSessionIds, unreadSessionIds),
    [allSessions, runningSessionIds, unreadSessionIds],
  );
  // ponytail: 跟随选中项目自动展开（仅 key 变化时触发，避免每次渲染都把手动折叠覆盖掉）
  useEffect(() => {
    if (selectedProject) {
      const key = selectedProject.key;
      setExpandedProjects((prev) => {
        if (prev.has(key)) return prev;
        const next = new Set(prev);
        next.add(key);
        return next;
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProject?.key]);

  const filteredSessions = selectedProject
    ? sessionsForProject(allSessions, selectedProject.key)
    : allSessions;
  const showWorktreeSwitcher = Boolean(
    worktreeState?.isGit
    && worktreeState.isTopLevel
    && selectedCwd
    && selectedProject?.key === worktreeState.projectKey
  );
  const worktreeGuide = selectedCwd
    && worktreeState
    && selectedProject?.key === worktreeState.projectKey
    && !showWorktreeSwitcher
    ? (worktreeState.isGit
        ? {
             label: t("sidebar.openRepoRoot"),
             title: t("sidebar.openRepoRootTitle"),
          }
        : {
             label: t("sidebar.gitRepoRootOnly"),
             title: t("sidebar.gitRepoRootOnlyTitle"),
          })
    : null;
  const worktreeLoading = Boolean(selectedCwd && worktreeLoadingCwd === selectedCwd);
  const inactiveWorktreeSelector = worktreeGuide
    ?? (worktreeLoading && !showWorktreeSwitcher
      ? {
           label: t("sidebar.worktrees"),
           title: t("sidebar.checkingWorktrees"),
        }
      : null);

  // fix:pin-partition —— 顺序在这里给（modified 倒序 → `applySessionFlags` 的置顶分区），
  // `listSessionFamilies` 不再自己按 `latestModified` 重排 —— 那个重排会把刚分出来的
  // 置顶分区又洗回时间序，置顶因此“点了没反应”。
  const sessionFamilies = listSessionFamilies(applySessionFlags(
    [...filteredSessions].sort((a, b) => b.modified.localeCompare(a.modified)),
    sessionFlags,
  ));

  // fix:no-time-groups —— 不再按时间分桶（今天 / 昨天 / 本周 / 本月 / 更早）。
  // 顺序完全由上面的 modified 倒序 + `applySessionFlags` 的置顶分区决定，
  // 所以「置顶在最前、其余新的在前」保持不变。
  // 虚拟列表的口径也简单了：每个元素都是一个会话行，槽位高度只可能是
  // SESSION_LIST_ITEM_HEIGHT / _TALL 两种。
  const sessionListEntries = useMemo<TimeGroupEntry<SessionFamily>[]>(
    () => flatTimeGroupEntries(sessionFamilies),
    [sessionFamilies],
  );

  // fork:session-tree（用户 2026-10-02）—— 侧栏第二层：**子代理会话缩进挂在父会话下面**。
  // 此前它们一条都没渲染（`renderFamilyRow` 只画 `family.root`），而每一行都写着
  // `.pw-session.child`（26px 缩进 + 弱化标题），于是整个会话列表看上去像一棵分支树，
  // 实际全是平级会话 —— 用户把三条普通会话认成了「分支机构」。
  // 现在：根会话用 `.pw-session`（与画板一致），子会话才 `.child` + 一条竖线 + 分支图标，
  // 父行右侧的 chevron 收放整棵子树。子树行进入虚拟列表（与根行同一种槽位高度）。
  const [expandedFamilies, setExpandedFamilies] = useState<ReadonlySet<string>>(() => new Set());
  const toggleFamilyCollapsed = useCallback((rootId: string) => {
    setExpandedFamilies((current) => {
      const next = new Set(current);
      if (next.has(rootId)) next.delete(rootId);
      else next.add(rootId);
      return next;
    });
  }, []);
  const sidebarEntries = useMemo<SidebarEntry[]>(
    () => expandSidebarEntries(sessionListEntries, expandedFamilies),
    [sessionListEntries, expandedFamilies],
  );

  // fork:session-row-overlap —— 窗口化的行高量自真行（见文件头 SESSION_LIST_ITEM_HEIGHT）。
  // 量的是滚动区里的第一行：`.d-sess`（Web）与 `.m-row`（PWA）都是**内容高 ≥ 拉伸高**
  // 的弹性项，所以这里读到的就是内容高；`ResizeObserver` 兜住形态/文案把行撑高的改动。
  const rowHeight = useSessionRowHeight(listScrollRef);

  useLayoutEffect(() => {
    const list = listScrollRef.current;
    const section = sessionListRef.current;
    if (!list || !section) {
      setSessionListOffsetTop(0);
      return;
    }
    const updateOffset = () => {
      const listTop = list.getBoundingClientRect().top;
      const sectionTop = section.getBoundingClientRect().top;
      setSessionListOffsetTop(Math.max(0, sectionTop - listTop + list.scrollTop));
    };
    updateOffset();
    const observer = new ResizeObserver(updateOffset);
    observer.observe(list);
    observer.observe(section);
    return () => observer.disconnect();
  }, [expandedProjects, selectedProject?.key, sessionListEntries.length, visibleProjects.length, sessionGroups.state]);

  // fork:session-row-overlap —— v5 的行只有一种高度（运行中 / 等你处理那枚徽标
  // 只比普通行高 0.3px，`Math.ceil` 之后落进同一档），所以「高行」这套偏移分支
  // 连同它的两处下标计算一起删掉了：行高既然是量出来的，就只有一个数。
  const virtualIndices = getSessionListIndices(
    sidebarEntries.length,
    Math.max(0, listScrollTop - sessionListOffsetTop),
    listViewportH,
    sidebarEntries.findIndex((entry) => entry.type === "family" && entry.family.root.id === focusedSessionId),
    rowHeight,
  );

  // 所有列表表面共用的行渲染。
  const renderFamilyRow = (family: SessionFamily) => {
    const familySessions = [family.root, ...family.subagents];
    const displaySession = family.latestModified === family.root.modified ? family.root : { ...family.root, modified: family.latestModified };
    return (
      <div style={{ flex: 1, minWidth: 0 }}>
        <SessionItem
          session={displaySession}
          isSelected={familySessions.some((session) => session.id === selectedSessionId)}
          isRunning={familySessions.some((session) => runningSessionIds.has(session.id))}
          isAwaiting={familySessions.some((session) => awaitingSessionIds.has(session.id))}
          awaitingKind={familySessions.map((session) => awaitingSessionKinds[session.id]).find(Boolean)}
          isUnread={familySessions.some((session) => unreadSessionIds.has(session.id))}
          hasChildren={family.subagents.length > 0}
          collapsed={!expandedFamilies.has(family.root.id)}
          onToggleCollapse={family.subagents.length > 0 ? () => toggleFamilyCollapsed(family.root.id) : undefined}
          onClick={() => handleSelectSessionFromList(family.root)}
          onRenamed={loadSessions}
          onDeleted={(id) => { onSessionDeleted?.(id); loadSessions(); }}
        />
      </div>
    );
  };
  /** 子代理会话：缩进一级 + 竖线 + 分支图标（画板 02 的子代理行）。 */
  const renderChildRow = (session: SessionInfo) => (
    <div style={{ flex: 1, minWidth: 0, marginLeft: 8, paddingLeft: 6, borderLeft: "1px solid var(--nx-line)" }}>
      <SessionItem
        session={session}
        depth={1}
        isSelected={selectedSessionId === session.id}
        isRunning={runningSessionIds.has(session.id)}
        isAwaiting={awaitingSessionIds.has(session.id)}
        awaitingKind={awaitingSessionKinds[session.id]}
        isUnread={unreadSessionIds.has(session.id)}
        onClick={() => handleSelectSessionFromList(session)}
        onRenamed={loadSessions}
        onDeleted={(id) => { onSessionDeleted?.(id); loadSessions(); }}
      />
    </div>
  );
  const sessionEntryKey = (entry: TimeGroupEntry<SessionFamily>) => (
    entry.type === "header" ? `time-group-${entry.bucket}` : entry.item.root.id
  );
  // fork:zc-11 — 项目节点仍按 visibleProjects 构建（保持原有每个项目的完整树），
  // 但改存进 Map，由 GroupedProjectList 按用户分组与拖拽顺序决定渲染位置。
  const projectRowNodes = new Map<string, ReactNode>();

  return (
    <>
      {customPathOpen && (
        <DirectoryPicker
          initialPath={customPathValue}
          busy={customPathValidating}
          error={customPathError}
          onCancel={() => {
            setCustomPathOpen(false);
            setCustomPathError(null);
          }}
          onSelect={(path) => void commitCustomPath(path)}
        />
      )}
      {/* fork:chat-workspace — the chat directory picker is separate from the project one
          so the validated-project flow above stays untouched. */}
      {chatPathOpen && (
        <DirectoryPicker
          initialPath={chatWorkspace?.cwd ?? homeDir}
          busy={chatWorkspaceBusy}
          error={chatPathError}
          onCancel={() => {
            setChatPathOpen(false);
            setChatPathError(null);
          }}
          onSelect={(path) => void commitChatWorkspace(path)}
        />
      )}
      {/* fork:v5-landing —— 侧栏头照画板 D-02 的 `.d-side-head`：
          品牌（.d-logo + PiWebTitle）/ 搜索 / 折叠三件。
          fork:desktop-shell — 红绿灯压在这行左端，品牌右移一个安全距离，整行兼作窗口拖拽区。
          fork:v5-wave-b —— 手机上这一行换成画板 **M-04 帧 A** 的 `.m-drawer-head`
          （标题 + 一个关闭钮）。搜索**不再是头部一枚钮**：它就是抽屉头正下方那一格
          `.m-searchfield`，按画板「搜索常驻」。三个 i18n / handler / aria 与桌面同源。 */}
      {isMobile ? (
        <div className="m-drawer-head">
          <span className="m-top-title">{t("palette.scope.sessions")}</span>
          {onToggleSidebar && (
            <button
              type="button"
              onClick={onToggleSidebar}
              title={t("sidebar.hide")}
              aria-label={t("sidebar.hide")}
              aria-controls="session-sidebar"
              aria-expanded
              className="m-top-btn"
            >
              <i data-ico="x" data-size="15"></i>
            </button>
          )}
        </div>
      ) : (
      <div className="d-side-head" style={{ paddingLeft: Math.max(12, desktopTrafficLightInset()) }}>
        {/* fork:v5-frame-audit-2026-10-05 —— 照画板 D-01/D-02/D-02d 帧 A 的
            `.d-side-head` 逐节点抄：`div.d-logo` · `img.d-wordmark` · `span.d-grow`
            · 两枚 `button.d-iconbtn`。原来这三件被折进一层 `span.d-brand-lockup`，
            板面上不存在这一层（库里也没有任何画板在用这件类）。 */}
        <div className="d-logo" aria-hidden="true">
          {/* fork:brand-logo — 主品牌渐变图形（public/pi-next-logo.png）原图直出，
              占满画板 D-02 的 .d-logo 盒；尺寸由 `.d-logo > img` 承担，不做重绘。 */}
          {/* eslint-disable-next-line @next/next/no-img-element -- 静态品牌资产，不走 next/image 优化器 */}
          <img src="/pi-next-logo.png" alt="" draggable={false} />
        </div>
        <PiWebTitle />
        <span className="d-grow" />
        <button
          type="button"
          ref={searchToggleRef}
          onClick={() => {
            setSessionSearchOpen(true);
            // 展开后输入框才存在，焦点要等这一帧挂上去。
            requestAnimationFrame(() => searchInputRef.current?.focus());
          }}
          aria-expanded={sessionSearchOpen}
          title={t("sidebar.toggleSessionSearch")}
          aria-label={t("sidebar.toggleSessionSearch")}
          className={`d-iconbtn${sessionSearchOpen ? " is-on" : ""}`}
        >
          <i data-ico="search" data-size="15"></i>
        </button>
          {/* fork:zn-21 — 折叠按钮。搬进品牌行（原来浮在导轨右边界，一半压在主区顶栏上，
              和顶栏那排图标抢同一条线）。放在品牌行末尾意味着它在 `-webkit-app-region: drag`
              的区域里，靠 fork-ui.css 的 `.sidebar-brand-row button` 规则挖洞。 */}
        {onToggleSidebar && (
          <button
            type="button"
            onClick={onToggleSidebar}
            title={t("sidebar.hide")}
            aria-label={t("sidebar.hide")}
            aria-controls="session-sidebar"
            aria-expanded
            className="d-iconbtn"
          >
            <i data-ico="panel-left" data-size="15"></i>
          </button>
        )}
      </div>
      )}
      {/* fork:v5-frame-audit —— 画板 M-04 帧 A/B 的次序是
          `抽屉头 → 搜索 → 新建任务 → 分段`：搜索紧贴抽屉头，因为抽屉里它只有
          这一个出口。窄屏那一格常驻（不再有折叠态），input 本体与桌面共用同一份
          `sessionSearchField`（同一个 ref / id / maxLength / Esc 行为）。 */}
      {isMobile && sessionSearchField("m-searchfield")}
      {/* fork:v5-landing —— 新建任务 = 画板 D-02 的 .d-side-nav > .d-row。
          fork:side-actions（用户 2026-10-05）—— 这一行按参考稿放大（图标 / 文案 /
          行高见 app/fork-ui.css 的 `.fork-side-action`）。搜索仍只有抽屉头那枚放大镜
          一个入口（点开在它下面那一格展开）。
          fork:drop-fake-kbd —— ⌘N 徽章删掉：`lib/shortcuts.ts` 里 newSession 的真实
          键位是 **Ctrl+Alt+N**（⌥⌘N），⌘N 什么都不是 —— 用户 2026-10-05 指出「那个
          根本就不是他的快捷命令」。画板那枚 .d-kbd 仍在库里，只是不再印在产品上。
          fork:v5-wave-b —— 手机上这一格是画板 M-04 帧 A 的 `.m-setrow`。 */}
      {isMobile ? (
        <button
          type="button"
          onClick={handleNewSession}
          aria-label={t("sidebar.newTask")}
          title={selectedCwd ? t("sidebar.newSessionTitle", { path: selectedCwd }) : t("sidebar.newTask")}
          className="m-setrow"
        >
          <i data-ico="square-pen" data-size="14"></i>
          <span className="m-grow">{t("sidebar.newTask")}</span>
        </button>
      ) : (
      <div className="d-side-nav">
        <button
          type="button"
          onClick={handleNewSession}
          aria-label={t("sidebar.newTask")}
          title={selectedCwd ? t("sidebar.newSessionTitle", { path: selectedCwd }) : t("sidebar.newTask")}
          className="d-row fork-side-action"
        >
          <i data-ico="square-pen" data-size="17"></i>
          <span className="d-grow">{t("sidebar.newTask")}</span>
        </button>
      </div>
      )}

      {/* fork:v5-landing —— 项目 / 聊天 左右切换 = 画板 D-02 的 .d-seg。
          fork:v5-wave-b —— 画板 M-04 帧 A 的分段也是 `.m-seg`，DOM 逐层相同
          （两个 button + `.is-on`），只换类名。 */}
      <div className={isMobile ? "m-seg" : "d-seg"} role="tablist" aria-label={t("sidebar.paneSwitch")}>
        <button
          type="button"
          role="tab"
          aria-selected={sidebarPane === "projects"}
          className={sidebarPane === "projects" ? "is-on" : undefined}
          onClick={() => selectPane("projects")}
        >
          {t("sidebar.projects")}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={sidebarPane === "chat"}
          className={sidebarPane === "chat" ? "is-on" : undefined}
          onClick={() => selectPane("chat")}
        >
          {t("sidebar.chatWorkspace")}
        </button>
      </div>

      {/* fork:v5-frame-audit —— 桌面那一格仍然只在 `sessionSearchOpen` 时渲染，并包在
          `.d-side-nav` 盒子里（画板 D-02 帧 D/E）；窄屏那一格已经挪到抽屉头正下方、
          且常驻，所以这里只剩桌面一支。搜索格所在的**那一行**照画板 D-02 帧 D /
          D-02d 帧 E 补上外层 `.d-side-nav`（`padding: 0 var(--nx-sp-2)`）。
          原来产品用内联 `margin: 0 var(--nx-sp-2)` 顶替那个盒子 —— 间距值因此有了
          第二个来源（铁律三）。input 本体只有一份，两支共用同一个 ref / id / 事件。 */}
      {!isMobile && sessionSearchOpen && (
        <div className="d-side-nav">{sessionSearchField("d-searchfield")}</div>
      )}

      {/* fork:v5-landing —— 列表区 = 画板 D-02 的 .d-side-scroll。
          fork:v5-wave-b —— 手机抽屉本体就是这一个滚动区：画板 M-04 的 `.m-drawer-body`
          （flex:1 / min-height:0 / overflow-y:auto —— 不带它底栏会被顶出屏）。 */}
      <div className={isMobile ? "m-drawer-body" : "d-side-scroll"}>

        <SessionSearch open={sessionSearchActive} query={sessionSearchQuery} selectedSessionId={selectedSessionId} onSelectSession={handleSelectSessionFromList}>
        {/* fix:sidebar-scroll —— 这个容器**才是**会话列表的滚动容器。
            原来写的是 `flex: 1 1 auto`，但父级 `.d-side-scroll` 曾是 `overflow:hidden`
            的普通块（不是 flex），flex 简写在这里完全失效 → 容器高度=内容高度，
            超出的部分被父级直接裁掉，整列**滚不动**（用户实测「左侧无法滑动」）。
            改成占满父级高度 + 自己滚，与结果区同一口径。 */}
        <div
          ref={listScrollRef}
          onScroll={handleListScroll}
          onTouchStart={handleListTouchStart}
          onTouchMove={handleListTouchMove}
          onTouchEnd={handleListTouchEnd}
          onTouchCancel={handleListTouchEnd}
          style={{ height: "100%", minHeight: 0, overflowY: "auto", overscrollBehavior: "contain" }}
        >
          {/* fork:mobile-drawer-2026-10-03 —— 下拉指示器：在滚动容器**里面**、
              列表**上面**的一行，高度跟着手指走。照画板 D-02d 帧 A 的
              `.d-row` + `.d-run` + `.d-t-xs`，不新增类。
              高度是动态量（模板字符串），不是写死的像素几何。
              fork:v5-wave-b —— 窄屏用 PWA 的 `.m-t-xs` + `.m-run`，横向居中的几何仍内联
              （只写 display / 对齐，不写颜色与字号：那两个值由类给）。 */}
          {(pullPx > 0 || pullRefreshing) && (
            <div
              className={isMobile ? "m-t-xs" : "d-row"}
              aria-hidden={!pullRefreshing}
              role={pullRefreshing ? "status" : undefined}
              style={{
                height: `${pullRefreshing ? PULL_MAX_PX : pullPx}px`,
                ...(isMobile
                  ? { display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }
                  : { justifyContent: "center", color: "var(--nx-text-3)", fontSize: "var(--nx-fs-xs)" }),
                overflow: "hidden",
                transition: pullRefreshing ? undefined : "height 120ms var(--nx-ease)",
              }}
            >
              <span className={isMobile ? "m-run" : "d-run"}>
                <i data-ico="loader-circle" data-size="13"></i>
              </span>
              <span>{pullRefreshing ? t("sidebar.refreshing") : t("sidebar.pullToRefresh")}</span>
            </div>
          )}
          {loading && projectChoices.length === 0 && (
            <div className={isMobile ? "m-t-sm m-t-faint" : "d-t-sm d-t-faint"} style={{ padding: isMobile ? "12px 14px" : "var(--nx-sp-4) var(--nx-sp-3)" }}>
              {t("sidebar.loading")}
            </div>
          )}
          {error && (
            <div className={isMobile ? "m-err" : "d-err"} style={{ padding: isMobile ? "10px 14px" : "var(--nx-sp-3) var(--nx-sp-4)" }}>
              {error}
            </div>
          )}
          {!loading && !error && visibleProjects.length === 0 && !chatProject && (
            <div className={isMobile ? "m-t-sm m-t-faint" : "d-t-sm d-t-faint"} style={{ padding: isMobile ? "12px 14px" : "var(--nx-sp-4) var(--nx-sp-3)" }}>
              {t("sidebar.noSessions")}
            </div>
          )}
          {/* fork:zn-20 — 切到「聊天」但还没建过聊天工作区时，说清楚该怎么建，
              否则整列是空的，看着像坏了。 */}
          {sidebarPane === "chat" && !chatProject && !loading && !error && (
            <div className={isMobile ? "m-t-sm m-t-faint" : "d-t-sm d-t-faint"} style={{ padding: isMobile ? "12px 14px" : "var(--nx-sp-4) var(--nx-sp-3)", ...(isMobile ? {} : { lineHeight: "var(--nx-lh-body)" }) }}>
              {t("sidebar.noChatWorkspace")}
            </div>
          )}

          {/* fork:zn-20 — 两段各自只在被选中时渲染：项目段（分区头 + 项目树 + 分组）
              与聊天段（下面那个 IIFE）互斥。不用 hidden 保活：两段加起来可能上百行，
              留一半在 DOM 里只为了切换快 20ms 不值得。 */}
          {sidebarPane === "projects" && (
          <>
          {/* fork:v5-landing —— 分区头 = 画板 D-02 的 `.d-group-title`：
              左侧组图标（画板画的就是 chevrons-up-down = 展开 / 折叠全部的记号）；
              右端原本是 filter + plus，「添加项目」已按用户要求移除（DIVERGENCE 84）。
              整行接上「展开 / 折叠全部」那一个动作，元素层级与画板一字不动。
              fork:v5-wave-b —— 窄屏换成画板 M-04 的 `.m-group-title`（同形状）。 */}
          <div
            className={isMobile ? "m-group-title" : "d-group-title"}
            role="button"
            tabIndex={0}
            title={t("sidebar.expandCollapseAll")}
            aria-label={t("sidebar.expandCollapseAll")}
            onClick={toggleAllProjects}
            onKeyDown={(event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              toggleAllProjects();
            }}
          >
            <i data-ico="chevrons-up-down" data-size="12"></i>
            <span className={isMobile ? "m-grow" : "d-grow"}>{t("sidebar.projects")}</span>
          </div>

          {visibleProjects.map((project) => {
            const isSelectedProject = project.key === selectedProject?.key;
            const isExpanded = expandedProjects.has(project.key);
            projectRowNodes.set(project.key, (
              <div key={project.key}>
                <ProjectRow
                  projectKey={project.key}
                  label={projectDisplayName(project.root, projectPrefs)}
                  title={project.root}
                  renaming={renamingProjectKey === project.key}
                  onRenameCommit={(name) => { setProjectAlias(project.root, name); setRenamingProjectKey(null); }}
                  onRenameCancel={() => setRenamingProjectKey(null)}
                  onNewSession={() => startSessionIn(project.root)}
                  onRename={() => setRenamingProjectKey(project.key)}
                  archived={projectFlags.archived.includes(project.key)}
                  onArchive={() => {
                    if (projectFlags.archived.includes(project.key)) restoreProject(project.key);
                    else archiveProject(project.key);
                  }}
                  onRemove={() => {
                    hideProject(project.root);
                    // 移除的是列表条目，不是磁盘目录：只把它从侧栏藏起来（可再次添加回来）。
                    if (selectedProject?.key === project.key) setSelectedCwd(null);
                  }}
                  onOpenFolder={() => {
                    void fetch("/api/open-in-explorer", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ cwd: project.root }),
                    });
                  }}
                  selected={isSelectedProject}
                  activity={projectActivity.get(project.key)}
                  onClick={() => {
                    if (isSelectedProject) {
                      // 再次点击已选中的项目：折叠/展开切换，而不是无意义地重选
                      setExpandedProjects((prev) => {
                        const next = new Set(prev);
                        if (next.has(project.key)) next.delete(project.key);
                        else next.add(project.key);
                        return next;
                      });
                      return;
                    }
                    setSelectedCwd(project.root);
                    setCustomPathError(null);
                  }}
                />
                {/* fork:design-G47 —— 工作区（分支）行按画板 02 挪到**选中项目行**下面：
                    画板把它画成项目行的嵌套子行，不是滚动区顶部的孤立一行。
                    仅当选中的项目处于展开态时渲染。 */}
                {isExpanded && project.key === selectedProject?.key && (
                <>
                {/* Worktree switcher — shown only for git projects at a checkout top
                    level (repo subdirs keep their own project identity, so switching
                    from them would jump projects). Rendered whenever the selected cwd
                    belongs to the loaded project (not just when forCwd matches), so
                    switching between worktrees of one project keeps the row mounted
                    instead of flickering while data refetches: all worktrees of a
                    project share the same list anyway. */}
                {showWorktreeSwitcher && (() => {
                  if (!worktreeState) return null;
                  const showWtFilter = worktreeState.worktrees.length >= 8;
                  const visibleWorktrees = showWtFilter && wtFilter.trim()
                    ? worktreeState.worktrees.filter((w) =>
                        (w.branch ?? displayCwd(w.path, homeDir)).toLowerCase().includes(wtFilter.trim().toLowerCase()))
                    : worktreeState.worktrees;
                  return (
                    <div ref={wtDropdownRef} style={{ position: "relative" }}>
                      {/* fork:v5-landing —— 工作区（分支）行 = 画板 D-02d 帧 C 的嵌套
                          `.d-group-title`：git-branch + 分支名（等宽）+ 右端 chevron-down。
                          fork:v5-wave-b —— 窄屏抄画板 M-01/M-04 的那一行
                          `.m-rowlabel`（git-branch + 分支名 worktree），同一个下拉与
                          同一个 worktree 数据源。 */}
                      <button
                        type="button"
                        onClick={() => setWtDropdownOpen((v) => !v)}
                        title={currentWorktree ? t("sidebar.switchWorktreeTitle", { path: currentWorktree.path }) : t("sidebar.switchWorktree")}
                        aria-expanded={wtDropdownOpen}
                        className={isMobile ? "m-rowlabel" : "d-group-title"}
                        style={isMobile
                          ? { width: "100%", border: 0, background: "none", font: "inherit", color: "inherit", textAlign: "left", cursor: "pointer", display: "flex", alignItems: "center", gap: "6px" }
                          : { width: "100%", paddingLeft: "var(--nx-sp-6)", border: 0, background: "none", font: "inherit", color: "inherit", textAlign: "left", cursor: "pointer" }}
                      >
                        <i data-ico="git-branch" data-size="12" style={{ color: currentWorktree && !currentWorktree.isMain ? "var(--nx-accent)" : undefined }}></i>
                        <PathLabel
                          text={currentWorktree ? (currentWorktree.branch ?? displayCwd(currentWorktree.path, homeDir)) : "…"}
                          style={{ flex: 1, fontFamily: "var(--nx-font-mono)", fontSize: "var(--nx-fs-xs)" }}
                        />
                        {currentWorktree?.isMain && (
                           <span className={isMobile ? "m-badge mute" : "d-badge mute"}>{t("sidebar.main")}</span>
                        )}
                        {worktreeState.worktrees.length > 1 && (
                          <span className={isMobile ? "m-badge mute" : "d-badge mute"}>{worktreeState.worktrees.length}</span>
                        )}
                        <i data-ico="chevron-down" data-size="12"></i>
                      </button>

                      {/* fork:ui-pop-portal —— 下拉本体 = 画板 D-02c 的 .d-pop，portal 到 body：
                          分支行被滚到列表下部时，下拉不再被滚动区裁掉/把列表撑长。
                          fork:v5-wave-b —— 窄屏换成 PWA 的同义件 `.m-pop-float`（描边 /
                          圆角 / 阴影 / 内边距都在库里），浮层宿主竖向必须 visible ——
                          PortalDropdown 是 fixed 定位，天然不被裁。 */}
                      <PortalDropdown
                        open={wtDropdownOpen}
                        anchorRef={wtDropdownRef}
                        panelRef={wtPanelRef}
                        className={isMobile ? "m-pop-float" : "d-pop-float"}
                      >
                          {showWtFilter && (
                            <div style={{ padding: "var(--nx-sp-1) var(--nx-sp-1) 0" }}>
                              <input
                                value={wtFilter}
                                onChange={(e) => setWtFilter(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Escape") {
                                    setWtFilter("");
                                    setWtDropdownOpen(false);
                                  }
                                }}
                                placeholder={t("sidebar.filterWorktrees")}
                                autoFocus
                                className={isMobile ? "m-input" : "d-input"}
                                style={{ width: "100%", fontFamily: "var(--nx-font-mono)" }}
                              />
                            </div>
                          )}
                          <div style={{ maxHeight: "min(40vh, 300px)", overflowY: "auto" }}>
                            {visibleWorktrees.map((wt) => {
                              const isCurrent = wt.path === currentWorktreePath;
                              if (wtConfirmRemove === wt.path) {
                                return (
                                  <div key={wt.path} style={{ padding: "var(--nx-sp-1)" }}>
                                    <div className={isMobile ? "m-banner err" : "d-banner err"}>
                                      <i data-ico="triangle-alert" data-size="14"></i>
                                      <span className={isMobile ? "m-grow" : "d-grow"}>{t("sidebar.forceRemoveCheckout")}</span>
                                    </div>
                                    {/* fork:v5-wave-b —— 窄屏这两枚等宽钮用画板 M-04 帧 D
                                        底部确定条那件 `.m-pickbar`（两钮等宽，正是删除确认
                                        的那一档）。 */}
                                    <div className={isMobile ? "m-pickbar" : "d-row"} style={isMobile ? undefined : { paddingTop: "var(--nx-sp-1)" }}>
                                      <button
                                        type="button"
                                        onClick={() => setWtConfirmRemove(null)}
                                        className={isMobile ? "m-btn sm ghost m-grow" : "d-btn sm ghost d-grow"}
                                        style={{ justifyContent: "center" }}
                                      >
                                        {t("sidebar.cancel")}
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => void handleRemoveWorktree(wt.path, true)}
                                        disabled={wtBusy}
                                        className={isMobile ? "m-btn sm danger m-grow" : "d-btn sm danger d-grow"}
                                        style={{ justifyContent: "center" }}
                                      >
                                        {t("sidebar.force")}
                                      </button>
                                    </div>
                                  </div>
                                );
                              }
                              return (
                                <div
                                  key={wt.path}
                                  className={isMobile ? "m-trow" : "d-row"}
                                >
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setSelectedCwd(wt.path);
                                      setWtDropdownOpen(false);
                                      setWtError(null);
                                      setWtFilter("");
                                    }}
                                    title={wt.path}
                                    className={isMobile
                                      ? `m-menu-row m-grow${isCurrent ? " is-on" : ""}`
                                      : `d-menu-row d-grow${isCurrent ? " is-on" : ""}`}
                                    style={{ fontFamily: "var(--nx-font-mono)" }}
                                  >
                                    {isCurrent
                                      ? <i data-ico="check" data-size="12"></i>
                                      : <span style={{ width: 12, flex: "0 0 auto" }} />}
                                    <PathLabel text={wt.branch ?? displayCwd(wt.path, homeDir)} style={{ flex: 1 }} />
                                    {wt.isMain && <span className={isMobile ? "m-badge mute" : "d-badge mute"}>{t("sidebar.main")}</span>}
                                  </button>
                                  {!wt.isMain && (
                                    <button
                                      type="button"
                                      onClick={() => void handleRemoveWorktree(wt.path, false)}
                                      disabled={wtBusy}
                                      title={t("sidebar.removeWorktreeTitle", { path: wt.path })}
                                      aria-label={t("sidebar.removeWorktreeTitle", { path: wt.path })}
                                      className={isMobile ? "m-iconbtn" : "d-iconbtn"}
                                      style={{ color: "var(--nx-danger)", flexShrink: 0 }}
                                    >
                                      <i data-ico="trash-2" data-size="12"></i>
                                    </button>
                                  )}
                                </div>
                              );
                            })}
                            {showWtFilter && visibleWorktrees.length === 0 && wtFilter.trim() && (
                              <div className={isMobile ? "m-menu-row m-t-faint" : "d-menu-row d-t-faint"}>{t("sidebar.noMatchingWorktrees")}</div>
                            )}
                          </div>

                          {!wtNewOpen ? (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setWtNewOpen(true);
                                setWtError(null);
                                setTimeout(() => wtNewInputRef.current?.focus(), 0);
                              }}
                              title={t("sidebar.createWorktreeTitle")}
                              className={isMobile ? "m-menu-row" : "d-menu-row"}
                              style={{ width: "100%" }}
                            >
                              <i data-ico="plus" data-size="13"></i>
                              {t("sidebar.newWorktree")}
                            </button>
                          ) : (
                            <div style={{ padding: "var(--nx-sp-1)" }}>
                              <input
                                ref={wtNewInputRef}
                                value={wtNewBranch}
                                onChange={(e) => {
                                  setWtNewBranch(e.target.value);
                                  setWtError(null);
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    e.preventDefault();
                                    void handleCreateWorktree();
                                  }
                                  if (e.key === "Escape") {
                                    setWtNewOpen(false);
                                    setWtNewBranch("");
                                    setWtError(null);
                                  }
                                }}
                                placeholder={t("sidebar.branchName")}
                                className={isMobile ? "m-input" : "d-input"}
                                style={{ width: "100%", fontFamily: "var(--nx-font-mono)" }}
                              />
                              <div className={isMobile ? "m-pickbar" : "d-row"} style={isMobile ? undefined : { paddingTop: "var(--nx-sp-1)" }}>
                                <button
                                  type="button"
                                  onClick={() => void handleCreateWorktree()}
                                  disabled={wtBusy || !wtNewBranch.trim()}
                                  className={isMobile ? "m-btn sm primary m-grow" : "d-btn sm primary d-grow"}
                                  style={{ justifyContent: "center" }}
                                >
                                   {wtBusy ? t("sidebar.creating") : t("sidebar.create")}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => { setWtNewOpen(false); setWtNewBranch(""); setWtError(null); }}
                                  className={isMobile ? "m-btn sm ghost m-grow" : "d-btn sm ghost d-grow"}
                                  style={{ justifyContent: "center" }}
                                >
                                   {t("sidebar.cancel")}
                                </button>
                              </div>
                            </div>
                          )}
                          {wtError && (
                            <div className={isMobile ? "m-menu-row m-t-faint" : "d-menu-row d-t-faint"} style={{ color: "var(--nx-danger)", overflowWrap: "anywhere" }}>
                              {wtError}
                            </div>
                          )}
                      </PortalDropdown>
                    </div>
                  );
                })()}
                {inactiveWorktreeSelector && (
                  <button
                    type="button"
                    aria-disabled="true"
                    tabIndex={-1}
                    title={inactiveWorktreeSelector.title}
                    className={isMobile ? "m-rowlabel" : "d-group-title"}
                    style={isMobile
                      ? { width: "100%", border: 0, background: "none", font: "inherit", textAlign: "left", color: "var(--nx-text-3)", cursor: "default", display: "flex", alignItems: "center", gap: "6px" }
                      : { width: "100%", paddingLeft: "var(--nx-sp-6)", border: 0, background: "none", font: "inherit", textAlign: "left", color: "var(--nx-text-3)", cursor: "default" }}
                  >
                    <i data-ico="git-branch" data-size="12"></i>
                    <span className={isMobile ? "m-grow" : "d-grow"} style={{ fontFamily: "var(--nx-font-mono)", fontSize: "var(--nx-fs-xs)" }}>{inactiveWorktreeSelector.label}</span>
                  </button>
                )}

                </>
                )}
                {isExpanded &&
                  (() => {
                    const projectSessions = orderedProjectSessions(project.key);
                    const families = listSessionFamilies(projectSessions);
                    // fork:ui-archive-history — 归档的会话不再在项目下开折叠区，
                    // 统一去 设置 → 归档历史 里看（用户要求）。
                    // fix:no-time-groups —— 项目下不再按「今天/昨天/本周」分段，
                    // 一行一个会话（顺序来自 orderedProjectSessions 的倒序 + 置顶分区）。
                    const projectEntries = flatTimeGroupEntries(families);
                    if (families.length === 0) {
                      return (
                        <div className={isMobile ? "m-t-sm m-t-faint" : "d-t-sm d-t-faint"} style={{ padding: isMobile ? "6px 14px" : "var(--nx-sp-2) 0 var(--nx-sp-1) 34px" }}>{t("sidebar.noTasks")}</div>
                      );
                    }
                    if (project.key === selectedProject?.key) {
                      const rowOffsets = sessionListOffsets(sidebarEntries.length, rowHeight);
                      return (
                        <div ref={sessionListRef} style={{ minHeight: sidebarEntries.length > 0 ? rowOffsets[sidebarEntries.length] : 34 }}>
                          {sidebarEntries.length > 0 && (
                            <div style={{ position: "relative", height: rowOffsets[sidebarEntries.length] }}>
                              {virtualIndices.map((index) => {
                                const entry = sidebarEntries[index];
                                if (!entry || entry.type === "header") return null;
                                const top = rowOffsets[index] ?? index * SESSION_LIST_ITEM_HEIGHT;
                                const height = (rowOffsets[index + 1] ?? top + SESSION_LIST_ITEM_HEIGHT) - top;
                                const sessionId = entry.type === "family" ? entry.family.root.id : entry.session.id;
                                return (
                                  <div key={sessionId} data-session-id={sessionId} onFocus={() => setFocusedSessionId(sessionId)} onBlur={() => setFocusedSessionId(null)} style={{ position: "absolute", top, left: 0, right: 0, height, display: "flex" }}>
                                    {entry.type === "family" ? renderFamilyRow(entry.family) : renderChildRow(entry.session)}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    }
                    return (
                      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-hair)", marginLeft: "var(--space-hair)", borderLeft: "1px solid var(--nx-line)", paddingLeft: "var(--nx-sp-1)" }}>
                        {expandSidebarEntries(projectEntries, expandedFamilies).map((entry) => {
                          if (entry.type === "header") return null;
                          return (
                            <div key={entry.type === "family" ? entry.family.root.id : entry.session.id} style={{ display: "flex" }}>
                              {entry.type === "family" ? renderFamilyRow(entry.family) : renderChildRow(entry.session)}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}
              </div>
            ));
            return null;
          })}
          <GroupedProjectList
            projects={visibleProjects}
            store={sessionGroups}
            renderProject={(project) => projectRowNodes.get(project.key) ?? null}
          />
          {/* fork:ui-project-actions — 「添加项目」从项目栏标题的 + 按钮搬到这里：
              标题行只留展开/折叠，项目自己的动作（打开文件夹/重命名/移除）挂在每个项目行上。 */}
          </>
          )}

          {/* fork:chat-workspace / fork:zn-13 — 聊天分区（Zeno 里「对话」分区的位置：
              排在项目分区之后、导轨底部之前）。自带标题行（新建 / 设置目录 / 折叠），
              会话列表沿用项目那套高亮与虚拟窗口逻辑。 */}
          {sidebarPane === "chat" && chatProject && (() => {
            const isSelectedChat = chatProject.key === selectedProject?.key;
            const isChatExpanded = expandedProjects.has(chatProject.key);
            const chatFamilies = listSessionFamilies(orderedProjectSessions(chatProject.key));
            // fix:no-time-groups —— 聊天列表与项目列表同一口径：不再分桶，
            // 一行一个会话。窗口单独计算，避免与项目列表的 entries 长度耦合。
            const chatEntries = flatTimeGroupEntries(chatFamilies);
            // fork:session-tree —— 聊天分区与项目分区同一套展开（子代理缩进一级）。
            const chatSidebarEntries = expandSidebarEntries(chatEntries, expandedFamilies);
            const chatOffsets = sessionListOffsets(chatSidebarEntries.length, rowHeight);
            const chatVirtualIndices = getSessionListIndices(
              chatSidebarEntries.length,
              Math.max(0, listScrollTop - sessionListOffsetTop),
              listViewportH,
              chatSidebarEntries.findIndex((entry) => entry.type === "family" && entry.family.root.id === focusedSessionId),
              rowHeight,
            );
            const toggleChatExpanded = () => {
              setExpandedProjects((prev) => {
                const next = new Set(prev);
                if (next.has(chatProject.key)) next.delete(chatProject.key);
                else next.add(chatProject.key);
                return next;
              });
            };
            return (
              <>
              {/* 用户 2026-10-05 —— 删掉聊天 pane 上方那枚**光秃秃的 `.d-group-title`
                  「聊天」**（2026-10-05 帧审补的）：它下面紧跟着 `ChatWorkspaceRow`，
                  而那一行本身就是 `.d-group-title`（chevron + 名字 + ＋ / folder-cog）——
                  两行同字同件摞在一起，看起来就是「多了一个聊天」。现在只留下面那行：
                  分区名、折叠、新建聊天、换聊天目录全在它身上，DOM 少一层。
                  （聊天工作区没建时那句 `sidebar.noChatWorkspace` 提示不动。） */}
              {/* fork:zn-13 —— 分区之间原本靠 `marginTop: 18` 分开；fork:zn-20 把项目段与
                  聊天段改成**互斥渲染**之后，这个 margin 失去了对象：在「聊天」pane 上
                  它就是 `.d-seg` 与第一行之间凭空多出来的一截空白（用户 2026-10-05 报
                  「中间空白太多」）。画板 D-02 是 `.d-seg → .d-side-scroll → .d-group-title`
                  **直连**，没有这一截；`.d-side-scroll` 的 `padding: var(--nx-sp-2)` 加上
                  `.d-group-title` 自己的 `padding-top` 就是全部节奏，与项目段同口径。 */}
              <div>
                <ChatWorkspaceRow
                  label={t("sidebar.chatWorkspace")}
                  title={chatProject.root}
                  selected={isSelectedChat}
                  expanded={isChatExpanded}
                  busy={chatWorkspaceBusy}
                  activity={projectActivity.get(chatProject.key)}
                  onToggle={toggleChatExpanded}
                  onConfigure={() => {
                    setChatPathError(null);
                    setChatPathOpen(true);
                  }}
                  onNewChat={() => startSessionIn(chatProject.root)}
                  onSelect={() => {
                    if (isSelectedChat) {
                      toggleChatExpanded();
                      return;
                    }
                    setSelectedCwd(chatProject.root);
                    setCustomPathError(null);
                    }}
                />
                {isChatExpanded && (chatFamilies.length === 0 ? (
                  <div className={isMobile ? "m-t-sm m-t-faint" : "d-t-sm d-t-faint"} style={{ padding: isMobile ? "6px 14px" : "var(--nx-sp-2) 0 var(--nx-sp-1) 24px" }}>{t("sidebar.noTasks")}</div>
                ) : isSelectedChat ? (
                  <div ref={sessionListRef} style={{ minHeight: chatSidebarEntries.length > 0 ? chatOffsets[chatSidebarEntries.length] : 34 }}>
                    {chatSidebarEntries.length > 0 && (
                      <div style={{ position: "relative", height: chatOffsets[chatSidebarEntries.length] }}>
                        {chatVirtualIndices.map((index) => {
                          const entry = chatSidebarEntries[index];
                          if (!entry || entry.type === "header") return null;
                          const sessionId = entry.type === "family" ? entry.family.root.id : entry.session.id;
                          return (
                            <div key={sessionId} data-session-id={sessionId} onFocus={() => setFocusedSessionId(sessionId)} onBlur={() => setFocusedSessionId(null)} style={{ position: "absolute", top: chatOffsets[index], left: 0, right: 0, height: (chatOffsets[index + 1] ?? chatOffsets[index]) - chatOffsets[index], display: "flex" }}>
                              {entry.type === "family" ? renderFamilyRow(entry.family) : renderChildRow(entry.session)}
                            </div>
                          );
                        })}
                      </div>
                    )}
                          </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-hair)" }}>
                    {chatSidebarEntries.map((entry) => {
                      if (entry.type === "header") return null;
                      return (
                        <div key={entry.type === "family" ? entry.family.root.id : entry.session.id} style={{ display: "flex" }}>
                          {entry.type === "family" ? renderFamilyRow(entry.family) : renderChildRow(entry.session)}
                        </div>
                      );
                    })}
                        </div>
                ))}
              </div>
              </>
            );
          })()}
        </div>
      </SessionSearch>
      </div>
    </>
  );
}

/** fork:ui-10 — the manual-status dot (tooltip carries the wording). */

/**
 * Per-project activity badge for the workspace/project row: **未读绿点 + 计数**。
 * Renders nothing when the project has no unread session.
 *
 * fork:no-running-badge-on-project-row-2026-10-02 —— 这里原先还有一枚「转圈 + 运行中
 * 会话数」（旧的 agentRunning 标签）。两处都不合画板：
 *   · 画板 02 三者互斥表：**运行中 → 右侧标记 = 无**，会话行的运行态一律由
 *     `.pw-session.running` 的底边扫掠线表达（产品已有，board.css）；
 *   · 那枚 `⟳N` 的家在**顶栏**（画板 02 帧 B：工作区上下文的动作区，挨着 `⚠N`），
 *     不在侧栏项目行 —— 侧栏项目行画板只画悬浮动作。
 * 顺带去掉一处「画板上没有的动效」：会话在跑、图标却钉在侧栏第一行转，读起来是
 * 「有个项目卡住了」，而不是「这个会话在跑」。
 * 计数本身仍在（会话行扫掠线 + 顶栏运行中芯片 + 转录区过程抬头 spinner 三处表达）。
 */
function showProjectActivity(
  activity: { running: number; unread: number } | undefined,
  t: (key: string) => string,
  // fork:v5-wave-b —— 窄屏（≤640）走 PWA 形态的同义件 `.m-badge.ok`。
  isPhone = false,
): ReactNode {
  if (!activity || activity.unread === 0) return null;
  return (
    <span className={isPhone ? undefined : "d-row"} style={{ flexShrink: 0, ...(isPhone ? { display: "inline-flex" } : null) }}>
      {activity.unread > 0 && (
        <span
          className={isPhone ? "m-badge ok" : "d-badge ok"}
          title={t("sidebar.newSessionActivity")}
          aria-label={`${t("sidebar.newSessionActivity")} (${activity.unread})`}
        >
          <i data-ico="circle" data-size="8"></i>
          {activity.unread}
        </span>
      )}
    </span>
  );
}

function SessionItem({
  session,
  isSelected,
  isRunning,
  isAwaiting,
  awaitingKind,
  isUnread,
  onClick,
  onRenamed,
  onDeleted,
  depth = 0,
  hasChildren = false,
  collapsed = false,
  onToggleCollapse,
}: {
  session: SessionInfo;
  isSelected: boolean;
  isRunning?: boolean;
  /** fork:design-system — 挂起扩展请求、等人回应（画板 02 的第三态）。 */
  isAwaiting?: boolean;
  awaitingKind?: "approval" | "input";
  isUnread?: boolean;
  onClick: () => void;
  onRenamed?: () => void;
  onDeleted?: (id: string) => void;
  depth?: number;
  hasChildren?: boolean;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}) {
  const { locale, t } = useI18n();
  // fork:pwa-sb —— 触控档（`useIsCompact` = ≤1024，含手机）把四个行内动作收进
  // 一枚 ⋯：四枚 22px 钉死就是 88px，外扩到 40px 命中区需要 160px 行宽
  // （390 抽屉里行只有 255px，标题会被压到 60px）。收进菜单后行尾只占一枚，
  // 标题多拿 66px，命中区也就不再互相抢；桌面端这段不渲染，行内四枚一字未动。
  const isMobile = useIsCompact();
  // fork:v5-wave-b —— 形态判据必须是 `useIsMobile`（≤640，与 pwa/system.css 的
  // @import 媒体条件同一个断点）：d-* 只在 ≥641 生效，平板档仍是 d-* DOM。
  const isPhone = useIsMobile();
  // fork:ui — 置顶/归档的行内入口。与右键菜单共用 session-flags store
  //（useSyncExternalStore，toggle 后所有订阅者自动重渲）。
  const { flags: sessionFlagState, pin, archive } = useSessionFlags();
  const isPinned = sessionFlagState.pinned.includes(session.id);
  const isArchived = sessionFlagState.archived.includes(session.id);
  const [hovered, setHovered] = useState(false);
  const showHover = hovered;
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuPanelRef = useRef<HTMLDivElement>(null);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  useDismissMenu(menuOpen, menuRef, menuPanelRef, closeMenu);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Select the whole name once the rename input is mounted (startRename's
  // immediate setTimeout can fire before the input exists).
  useEffect(() => {
    if (renaming) {
      const id = requestAnimationFrame(() => inputRef.current?.select());
      return () => cancelAnimationFrame(id);
    }
  }, [renaming]);

  // A stored first message may be an SDK-expanded <skill> block; collapse it
  // back to the compact /skill:name args command the user typed before using
  // it as the auto-name fallback, mirroring MessageView's rendering.
  const displayFirstMessage = skillExpansionToCommand(session.firstMessage) ?? session.firstMessage;
  const title = session.name || displayFirstMessage.slice(0, 50) || session.id.slice(0, 12);

  const startRename = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (session.transient) return;
    setRenameValue(session.name || displayFirstMessage.slice(0, 50) || session.id.slice(0, 12));
    setRenaming(true);
  }, [session.name, session.transient, displayFirstMessage, session.id]);

  const commitRename = useCallback(async () => {
    const name = renameValue.trim();
    setRenaming(false);
    // No-op when unchanged: the fallback title (first message / id) isn't a
    // real stored name, so don't persist it as one. (The rename input seeds
    // from the same collapsed displayFirstMessage, so an untouched rename of
    // a skill-invoked session stays a no-op instead of persisting raw XML.)
    if (renameValue === title || name === (session.name ?? "")) return;
    try {
      await fetch(`/api/sessions/${encodeURIComponent(session.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      onRenamed?.();
    } catch {
      // ignore
    }
  }, [renameValue, session.id, session.name, onRenamed, title]);

  const performDelete = useCallback(async () => {
    if (session.transient) return;
    setConfirmDelete(false);
    setDeleting(true);
    try {
      await fetch(`/api/sessions/${encodeURIComponent(session.id)}`, { method: "DELETE" });
      onDeleted?.(session.id);
    } catch {
      setDeleting(false);
    }
  }, [session.id, session.transient, onDeleted]);

  const handleDeleteClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (e.shiftKey) {
      void performDelete();
    } else {
      setConfirmDelete(true);
    }
  }, [performDelete]);

  // fork:v5-frame-audit —— 事件参数改成可选：这两个回调现在既挂在行内按钮上
  // （有事件，要 stopPropagation），也被 M-04 帧 D 的 `.m-sheet` 调用（遮罩 / Esc /
  // 底部那枚 `取消` 都没有事件）。语义不变，只是少了一个强转的 `as`。
  const handleDeleteConfirm = useCallback((e?: React.MouseEvent) => {
    e?.stopPropagation();
    void performDelete();
  }, [performDelete]);

  const handleDeleteCancel = useCallback((e?: React.MouseEvent) => {
    e?.stopPropagation();
    setConfirmDelete(false);
  }, []);

  const handleContextMenu = useCallback((e: React.MouseEvent<HTMLElement>) => {
    const handled = dispatchSessionRowContextMenu({
      id: session.id,
      path: session.path,
      cwd: session.cwd,
      name: session.name,
      clientX: e.clientX,
      clientY: e.clientY,
      refresh: () => { onRenamed?.(); },
    });
    if (!handled) return;
    e.preventDefault();
    e.stopPropagation();
  }, [onRenamed, session.cwd, session.id, session.name, session.path]);

  // fork:v5-wave-b —— 手机抽屉里的会话行照画板 **M-04 帧 A/B** 抄 DOM：
  //   `<button class="m-row">` > `.m-row-t`（标题）+ `.m-row-m`（时间 · N 条消息 ·
  //   运行中转圈 / 待授权文字徽章 / 未读绿点）。行状态仍然只有画板那三种，形状与文字
  //   各管一段；父会话缩进、子代理竖线、右键菜单、重命名 / 删除确认与 ⋯ 菜单全部接回。
  if (isPhone) {
    return (
      <>
      <button
        type="button"
        className={[
          "fork-row-enter",
          "m-row",
          // 运行中在画板 M-04 里是**行内转圈**（下方 `.m-run`），行本身没有状态类 ——
          // 所以这里不挂桌面那条 `.d-sess.running`（它是 ≥641 的扫描线，与转圈重复）。
          isSelected ? "is-on" : "",
        ].filter(Boolean).join(" ")}
        onClick={confirmDelete || renaming ? undefined : onClick}
        onContextMenu={confirmDelete || renaming ? undefined : handleContextMenu}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => { setHovered(false); }}
        style={{
          width: "100%",
          cursor: confirmDelete || renaming ? "default" : "pointer",
          opacity: deleting ? 0.5 : 1,
        }}
      >
        {renaming ? (
          <input
            ref={inputRef}
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") setRenaming(false);
            }}
            autoFocus
            className="m-input m-grow"
          />
        ) : (
          <>
            {/* fork:session-row-ghost —— 与桌面行同一处病：`.m-row` 是 flex-column，
                单独一个 `.m-row-t` 图标格在手机档是**独占一行**（每个子代理行顶上
                都悬着一个孤零零的 ↳）。并进标题行内，间距走 system.css。 */}
            <span className="m-row-t" title={`${title} · ${formatRelativeTime(session.modified, locale)}`}>
              {depth > 0 && (
                <i data-ico="corner-down-right" data-size="13" aria-hidden="true"></i>
              )}
              {title}
            </span>
            <span className="m-row-m">
              <span>{formatRelativeTime(session.modified, locale)}</span>
              <span aria-hidden="true">·</span>
              <span>{t("sidebar.messageCount", { count: session.messageCount })}</span>
              {isRunning && (
                <span className="m-run" title={t("chat.running")} aria-label={t("chat.running")}>
                  <i data-ico="loader-circle" data-size="12" aria-hidden="true"></i>
                </span>
              )}
              {isAwaiting ? (
                <span className="m-badge warn" title={t(awaitingKind === "input" ? "sidebar.awaitingInput" : "sidebar.awaitingApproval")}>
                  <i data-ico="triangle-alert" data-size="11"></i>
                  {t(awaitingKind === "input" ? "sidebar.awaitingInputShort" : "sidebar.awaitingApprovalShort")}
                </span>
              ) : isUnread ? (
                <span className="m-dot ok" title={t("sidebar.newActivity")} aria-label={t("sidebar.newSessionActivity")} />
              ) : null}
              {session.isWorktree && session.branch && (
                <i data-ico="git-branch" data-size="12" aria-hidden="true"></i>
              )}
              {/* fork:session-row-overlap —— 折叠钮与 ⋯ 菜单**进元信息行**。
                  `.m-row` 是 flex-column，这两个原来是它的直接子节点，于是各自
                  独占一行：一枚 36px 的 ⋯ 把两行的行撑成三行（108.7px，一屏只剩
                  7 条），而窗口化的行距又是按行高量的 —— 行越撑越离谱。画板 M-04
                  的 `.m-row` 就是两行（`.m-row-t` + `.m-row-m`），行尾控件贴在元信息
                  那一行右端，与桌面的 `.d-sess` 同一形态。 */}
              {hasChildren && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onToggleCollapse?.(); }}
                  title={t(collapsed ? "sidebar.expandSubagents" : "sidebar.collapseSubagents")}
                  aria-label={t(collapsed ? "sidebar.expandSubagents" : "sidebar.collapseSubagents")}
                  className="m-iconbtn"
                >
                  <i data-ico={collapsed ? "chevron-right" : "chevron-down"} data-size="12"></i>
                </button>
              )}
              {/* fork:pwa-sb —— 手机档的行内四枚动作收进一枚 ⋯（菜单内容与行为不变，
                  面板本体换成 PWA 库的 `.m-pop-float` + `.m-menu-row`；仍是 fixed 定位，
                  浮层宿主竖向 visible 不会被裁）。 */}
              {!session.transient ? (
                <div ref={menuRef} className="fork-pwa-sb-row-menu">
                <button
                  type="button"
                  onClick={(event) => { event.stopPropagation(); setMenuOpen((open) => !open); }}
                  title={t("chat.moreControls")}
                  aria-label={t("chat.moreControls")}
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  className={`m-iconbtn${menuOpen ? " is-on" : ""}`}
                >
                  <i data-ico="ellipsis" data-size="14" aria-hidden="true"></i>
                </button>
                <PortalDropdown
                  open={menuOpen}
                  anchorRef={menuRef}
                  panelRef={menuPanelRef}
                  className="m-pop-float fork-pwa-sb-menu"
                  width={200}
                  align="right"
                >
                  <div role="menu" aria-label={t("chat.moreControls")}>
                    <button
                      type="button"
                      role="menuitem"
                      className="m-menu-row"
                      style={{ width: "100%" }}
                      onClick={(event) => { event.stopPropagation(); closeMenu(); pin(session.id); }}
                    >
                      <i data-ico="pin" data-size="14" aria-hidden="true"></i>
                      {t(isPinned ? "session.unpin" : "session.pin")}
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="m-menu-row"
                      style={{ width: "100%" }}
                      onClick={(event) => { event.stopPropagation(); closeMenu(); archive(session.id); }}
                    >
                      <i data-ico="archive" data-size="14" aria-hidden="true"></i>
                      {t(isArchived ? "session.unarchive" : "session.archive")}
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="m-menu-row"
                      style={{ width: "100%" }}
                      onClick={(event) => { event.stopPropagation(); closeMenu(); startRename(event); }}
                    >
                      <i data-ico="square-pen" data-size="14" aria-hidden="true"></i>
                      {t("sidebar.rename")}
                    </button>
                    <div className="m-sep" />
                    <button
                      type="button"
                      role="menuitem"
                      className="m-menu-row danger"
                      style={{ width: "100%" }}
                      onClick={(event) => { event.stopPropagation(); closeMenu(); handleDeleteClick(event); }}
                    >
                      <i data-ico="trash-2" data-size="14" aria-hidden="true"></i>
                      {t("sidebar.delete")}
                    </button>
                  </div>
                </PortalDropdown>
              </div>
            ) : null}
            </span>
          </>
        )}
      </button>
      {/* fork:v5-frame-audit（2026-10-05）—— M-04 帧 D 的删除确认**不是就地换行**，
          是底部面板：`m-scrim` + `m-sheet is-open`（`m-sheet-grab` /
          `m-sheet-title` 写清删的是哪条 / `m-sheet-body` 一句代价 / `m-pickbar`
          两个等宽 `m-picktag`，取消在左、破坏性的那一个在右且**不预选**）。
          产品此前把确认塞回这一行（行高不变、两枚按钮挤在行尾），手机上根本看不清
          删的是哪条。行为不变：仍是同一个 `confirmDelete` 状态、同一组
          `performDelete` 回调；遮罩 / Esc / 焦点由 `PwaSheet` 承担（它抄的就是画板
          M-09/M-10 那一段 `.m-sheet`，与 M-04 帧 D 是同一件东西）。
          行本体此时保持原样（不再被确认态顶掉），点它仍会关掉确认。 */}
      <PwaSheet
        open={confirmDelete}
        title={t("sidebar.deleteSession", { title: title.slice(0, 22) + (title.length > 22 ? "…" : "") })}
        onClose={handleDeleteCancel}
        footer={(
          <>
            <button type="button" className="m-picktag" onClick={() => handleDeleteCancel()}>
              {t("sidebar.cancel")}
            </button>
            <button type="button" className="m-picktag danger is-on" onClick={() => handleDeleteConfirm()}>
              {t("sidebar.delete")}
            </button>
          </>
        )}
      >
        <div className="m-md">
          <p>{t("sidebar.deleteBody")}</p>
        </div>
      </PwaSheet>
      </>
    );
  }

  // Fixed-height outer wrapper — content swaps in place so the list never reflows
  return (
    <button
      type="button"
      // fork:design-components —— 会话行**直接使用画板 02 的 .pw-session**：
      // 48 / 58 两档行高、.child 缩进 26px、hover 叠色、.is-on 选中、
      // .running 底边扫掠线、.awaiting 底边常亮线，全部来自 board.css。
      // fork:session-tree（用户 2026-10-02）—— `child` 改为**只有子代理行**才带：
      // 此前写死 `pw-session child`，于是**每一条**会话都缩进 26px、标题弱化，
      // 整个列表看上去是一棵分支树，实际全是平级会话（用户把三条普通会话认成了
      // 「分支机构」）。主会话回到画板 02 的 `.pw-session`（8px 内边距），
      // 子代理行才 `.child`（26px）+ 竖线（父容器 border-left）+ 分支图标。
      className={[
        "fork-row-enter",
        "d-sess",
        isRunning ? "running" : "",
        isSelected ? "is-on" : "",
      ].filter(Boolean).join(" ")}
      onClick={confirmDelete || renaming ? undefined : onClick}
      onContextMenu={confirmDelete || renaming ? undefined : handleContextMenu}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); }}
      style={{
        width: "100%",
        // fork:v5-frame-audit-2026-10-05 —— `.d-sess` 回到画板的 **block 两行件**
        // （system.css 的 `.d-sess { display:block }`）：行内不再内联 flex。
        // 状态标记（转圈 / 等你处理 / 未读点）、worktree 角标、折叠钮与 hover 动作
        // 全部搬进 `.d-sess-m` —— 画板 D-02 帧 D / D-02d 帧 D 的五态行就是这么摆的
        // （`.d-sess-m` 是 flex 行，徽标就在那一格末尾）。
        // 子代理缩进一级 + corner-down-right 图标。
        paddingLeft: depth > 0 ? 8 + depth * 6 : undefined,
        cursor: confirmDelete || renaming ? "default" : "pointer",
        opacity: deleting ? 0.5 : 1,
      }}
    >
      {confirmDelete ? (
        /* ── Delete confirmation: same height, two flat buttons ── */
        <>
          <span className="d-sess-t d-grow">
            {t("sidebar.deleteSession", { title: title.slice(0, 22) + (title.length > 22 ? "…" : "") })}
          </span>
          <span className="d-row" style={{ flexShrink: 0 }}>
            <button
              type="button"
              onClick={handleDeleteConfirm}
              className="d-btn sm danger"
            >
              <i data-ico="trash-2" data-size="13"></i>
              {t("sidebar.delete")}
            </button>
            <button type="button" onClick={handleDeleteCancel} className="d-btn sm ghost">
              {t("sidebar.cancel")}
            </button>
          </span>
        </>
      ) : renaming ? (
        /* ── Rename: input fills the same row ── */
        <input
          ref={inputRef}
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitRename();
            if (e.key === "Escape") setRenaming(false);
          }}
          autoFocus
          className="d-input d-grow"
        />
      ) : (
        /* ── Normal view：两行（标题 + 元信息），状态标记一律在右侧 ── */
        <>
          {/* fork:session-row-ghost（用户 2026-10-05 报的「重影」）—— 子代理行的
              corner-down-right 必须待在**标题行内部**，不能是标题前面的兄弟节点：
              会话列表是虚拟化的绝对定位行（行高固定 48 / 58），`.d-sess-t` 是
              nowrap 的整段不可断文本，图标与标题作为两个相邻内联节点放不下时，
              整段标题会换到第二行 —— 行内变成三行，第三行（元信息）溢出行盒，
              叠在下一行的标题上，就是截图里那种两段文字重影。图标进标题行内
              （与画板 D-02b「图标内联贴文字」同一形态）后，行高回到恒定两行。
              颜色 / 间距由 system.css 的 `.d-sess-t > i[data-ico]` 给。 */}
          {/* fork:v5-frame-audit-2026-10-05 —— 标题格与元信息格是 `.d-sess` 的**直接子节点**
              （画板 D-01 / D-02 / D-02d 每一帧的会话行都是这样），中间那层
              `span.d-col.d-grow` 去掉；元信息内部的三段（时间 · 条数）也回到
              板面上的三个平级 `<span>`，原来那层 `fork-pwa-sb-meta` 的 CSS
              只在 `.pw-session .pw-m` 下命中，v5 DOM 上本来就是死规则。 */}
          <span
            title={`${title} · ${formatRelativeTime(session.modified, locale)}`}
            className="d-sess-t"
          >
            {depth > 0 && (
              <i data-ico="corner-down-right" data-size="13" aria-hidden="true"></i>
            )}
            {title}
          </span>
          {/* fork:caret-corner（用户 2026-10-05）—— 折叠箭头从**元信息行**搬到**行右上角**：
              它原来挤在「N 条消息」与四枚 hover 动作之间，读起来像元信息的一部分，而且
              指针停在它上面时它自己的 hover 底色在行里画出第二个盒子（用户报的重影）。
              它是 `.d-sess` 的**直接子节点**且绝对定位（`fork-sess-caret`，见
              app/design/v5-forms.css）—— 绝对定位是这里唯一安全的做法：行高被
              `useSessionRowHeight` 量成定数（`.d-sess` 恒 58.89），任何「进流的盒子」
              都会把行顶出槽位，也就是那个重影。 */}
          {hasChildren && (
            <span className="fork-sess-caret">
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onToggleCollapse?.(); }}
                title={t(collapsed ? "sidebar.expandSubagents" : "sidebar.collapseSubagents")}
                aria-label={t(collapsed ? "sidebar.expandSubagents" : "sidebar.collapseSubagents")}
                aria-expanded={!collapsed}
                className="d-iconbtn"
              >
                <i data-ico={collapsed ? "chevron-right" : "chevron-down"} data-size="12"></i>
              </button>
            </span>
          )}
          <span className="d-sess-m fork-session-meta">
              <span style={{ flexShrink: 0 }}>{formatRelativeTime(session.modified, locale)}</span>
              <span aria-hidden="true">·</span>
              <span style={{ flexShrink: 0 }}>{t("sidebar.messageCount", { count: session.messageCount })}</span>
              {/* 两者互斥：等你处理 > 未读。
                  fork:no-session-tag（用户 2026-10-01）—— 手动「状态标记」及其彩色点已撤掉。 */}
              {/* fork:session-row-running-spinner（用户 2026-10-02）—— 运行中**在行内**
                  再挂一枚转圈：上一轮按画板把项目行的 `⟳N` 徽标删掉后，运行态只剩
                  底边那条 1px 扫掠线 —— 实测用户根本看不出哪条会话在跑（「现在我都不
                  好看出来哪个对话是正在运行中的」）。画板 02 的互斥表写的是
                  「运行中 → 右侧标记 = 无」，这条按用户 2026-10-02 的要求记为分叉
                  （design/pi-web-design/DIVERGENCE.md 第 90 条）：扫掠线保留（行高 58
                  + 底边扫掠），转圈加在 `N 条消息` 之后 —— 与未读点/等你处理同一位，
                  三者不同时出现（liveness 与 attention 是两件事）。*/}
              {isRunning && (
                <span className="d-run fork-pwa-sb-flag" title={t("chat.running")} aria-label={t("chat.running")}>
                  <i data-ico="loader-circle" data-size="11" aria-hidden="true"></i>
                </span>
              )}
              {isAwaiting ? (
                <span className="d-badge warn fork-pwa-sb-flag" title={t(awaitingKind === "input" ? "sidebar.awaitingInput" : "sidebar.awaitingApproval")}>
                  <i data-ico="triangle-alert" data-size="11"></i>
                  {t(awaitingKind === "input" ? "sidebar.awaitingInputShort" : "sidebar.awaitingApprovalShort")}
                </span>
              ) : isUnread ? (
                <span className="d-dot ok fork-pwa-sb-flag" title={t("sidebar.newActivity")} aria-label={t("sidebar.newSessionActivity")} />
              ) : null}
              {session.isWorktree && session.branch && (
                <span
                  title={`Worktree: ${session.cwd}`}
                  style={{ display: "inline-flex", flex: "0 0 auto", color: "var(--nx-accent)" }}
                >
                  <i data-ico="git-branch" data-size="12"></i>
                </span>
              )}

              {/* fork:caret-corner —— 折叠箭头已搬到标题行之后的 `.fork-sess-caret`（行右上角）。 */}

          {/* fork:pwa-sb —— 手机档（`useIsMobile` = ≤640px）换成一枚常驻的 ⋯，
              菜单本体是画板 D-02c 的 `.d-pop` + `.d-menu-row`（与项目行同一个壳），
              菜单项在手机上有 44px 命中高。桌面端这段不渲染，行内四枚一字未动。 */}
          {isMobile && !session.transient && !confirmDelete && !renaming ? (
            <div ref={menuRef} className="fork-pwa-sb-row-menu">
              <button
                type="button"
                onClick={(event) => { event.stopPropagation(); setMenuOpen((open) => !open); }}
                title={t("chat.moreControls")}
                aria-label={t("chat.moreControls")}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                className={`d-iconbtn${menuOpen ? " is-on" : ""}`}
              >
                <i data-ico="ellipsis" data-size="14" aria-hidden="true"></i>
              </button>
              <PortalDropdown
                open={menuOpen}
                anchorRef={menuRef}
                panelRef={menuPanelRef}
                className="d-pop-float fork-pwa-sb-menu"
                width={200}
                align="right"
              >
                <div role="menu" aria-label={t("chat.moreControls")}>
                  <button
                    type="button"
                    role="menuitem"
                    className="d-menu-row"
                    style={{ width: "100%" }}
                    onClick={(event) => { event.stopPropagation(); closeMenu(); pin(session.id); }}
                  >
                    <i data-ico="pin" data-size="14" aria-hidden="true"></i>
                    {t(isPinned ? "session.unpin" : "session.pin")}
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="d-menu-row"
                    style={{ width: "100%" }}
                    onClick={(event) => { event.stopPropagation(); closeMenu(); archive(session.id); }}
                  >
                    <i data-ico="archive" data-size="14" aria-hidden="true"></i>
                    {t(isArchived ? "session.unarchive" : "session.archive")}
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="d-menu-row"
                    style={{ width: "100%" }}
                    onClick={(event) => { event.stopPropagation(); closeMenu(); startRename(event); }}
                  >
                    <i data-ico="square-pen" data-size="14" aria-hidden="true"></i>
                    {t("sidebar.rename")}
                  </button>
                  <div className="d-sep" />
                  <button
                    type="button"
                    role="menuitem"
                    className="d-menu-row danger"
                    style={{ width: "100%" }}
                    onClick={(event) => { event.stopPropagation(); closeMenu(); handleDeleteClick(event); }}
                  >
                    <i data-ico="trash-2" data-size="14" aria-hidden="true"></i>
                    {t("sidebar.delete")}
                  </button>
                </div>
              </PortalDropdown>
            </div>
          ) : null}

          {/* Hover actions appear over the title's trailing edge; nothing is
              reserved when idle so the title uses the full row width. The
              relative time stays available in the title tooltip above.
              Also shown when a row slides under a stationary pointer after a
              delete reflows the list (see syncPointerSession).
              手机档走上面的 ⋯ 菜单，这里只在指针设备上渲染。 */}
          {!isMobile && showHover && !session.transient ? (
            <span className="d-msg-acts is-on" style={{ flexShrink: 0 }}>
              {/* fork:ui — 置顶（选中态实心 + accent 色）。 */}
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); pin(session.id); }}
                title={t(isPinned ? "session.unpin" : "session.pin")}
                aria-label={t(isPinned ? "session.unpin" : "session.pin")}
                className={`d-iconbtn${isPinned ? " is-on" : ""}`}
              >
                <i data-ico="pin" data-size="13"></i>
              </button>
              {/* fork:ui — 归档（归档后行会落到项目的「已归档」折叠区）。 */}
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); archive(session.id); }}
                title={t(isArchived ? "session.unarchive" : "session.archive")}
                aria-label={t(isArchived ? "session.unarchive" : "session.archive")}
                className={`d-iconbtn${isArchived ? " is-on" : ""}`}
              >
                <i data-ico="archive" data-size="13"></i>
              </button>
              <button
                type="button"
                onClick={startRename}
                title={t("sidebar.rename")}
                aria-label={t("sidebar.rename")}
                className="d-iconbtn"
              >
                <i data-ico="square-pen" data-size="13"></i>
              </button>
              <button
                type="button"
                onClick={handleDeleteClick}
                title={t("sidebar.deleteWithShiftClick")}
                aria-label={t("sidebar.delete")}
                className="d-iconbtn"
                style={{ color: "var(--nx-danger)" }}
              >
                <i data-ico="trash-2" data-size="13"></i>
              </button>
            </span>
          ) : null}
          </span>
        </>
      )}
    </button>
  );
}

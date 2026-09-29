"use client";

import { useEffect, useLayoutEffect, useState, useCallback, useMemo, useRef, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { SessionInfo } from "@/lib/types";
import { listSessionFamilies, type SessionFamily } from "@/lib/session-family";
import { dispatchSessionRowContextMenu } from "@/lib/session-row-context-menu";
import { skillExpansionToCommand } from "@/lib/slash-display";
import { chatProjectOf, getProjectActivity, getRecentProjects, sessionsForProject, withoutChatProject } from "@/lib/project-groups";
import type { RecentProject } from "@/lib/project-groups";
import { SESSION_TAG_TONES, applySessionFlags, useSessionFlags, type SessionTag } from "@/lib/session-flags";
import { filterArchivedProjects, useProjectFlags } from "@/lib/project-flags";
// fork:zc-11 — 用户自定义项目分组 + 拖拽排序（localStorage 展示层偏好）。
import { useSessionGroups } from "@/lib/session-groups";
import { filterHiddenProjects, projectDisplayName, useProjectPrefs } from "@/lib/project-prefs";
import { bucketOf, groupByTimeBucket, timeBucketKey, type TimeBucket, type TimeGroupEntry } from "@/lib/time-groups";
import { loadCollapsedTimeGroups, saveCollapsedTimeGroups, type CollapsedTimeGroups } from "@/lib/time-group-state";
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
import { useIsMobile } from "@/hooks/useIsMobile";
import { TEXT } from "@/lib/typography";

// fork:design-system — 会话行按画板 02 重做成**两行**（标题 + 元信息行），
// 行高 48，运行中 / 等你处理 58（设计 §2.6 的五态表）。
// 状态标记一律在**右侧**（`N 条消息` 之后），左侧不放任何点。
// 列表仍走固定高度窗口化，所以两种高度都要参与偏移计算。
export const SESSION_LIST_ITEM_HEIGHT = 48;
/** 运行中 / 等你处理的行高（多出的 10px 是给底边扫掠线留的呼吸）。 */
export const SESSION_LIST_ITEM_HEIGHT_TALL = 58;

/** 把稀疏的「高行下标」收敛成升序数组，窗口与偏移计算共用。 */
function normalizeTallIndices(tallIndices: readonly number[] | undefined): number[] {
  if (!tallIndices || tallIndices.length === 0) return [];
  return [...new Set(tallIndices)].filter((index) => Number.isInteger(index) && index >= 0).sort((a, b) => a - b);
}

/** 升序数组里小于 `index` 的元素个数（二分）。 */
function countBelow(sorted: readonly number[], index: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < index) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** 第 `index` 行的顶部偏移。高行比普通行多 10px，逐行累加。 */
export function sessionRowOffset(index: number, tallSorted: readonly number[]): number {
  return index * SESSION_LIST_ITEM_HEIGHT + countBelow(tallSorted, index) * (SESSION_LIST_ITEM_HEIGHT_TALL - SESSION_LIST_ITEM_HEIGHT);
}

/** 列表总高（含底部最后一行）。 */
export function sessionListHeight(count: number, tallSorted: readonly number[]): number {
  return sessionRowOffset(count, tallSorted);
}

/** 把稀疏下标展开成每行顶部偏移数组（长度 count + 1，末项是总高）。 */
export function sessionListOffsets(count: number, tallIndices: readonly number[] | undefined): number[] {
  const tall = new Set(normalizeTallIndices(tallIndices));
  const offsets = new Array<number>(count + 1);
  let cursor = 0;
  for (let index = 0; index < count; index += 1) {
    offsets[index] = cursor;
    cursor += tall.has(index) ? SESSION_LIST_ITEM_HEIGHT_TALL : SESSION_LIST_ITEM_HEIGHT;
  }
  offsets[count] = cursor;
  return offsets;
}

export function getSessionListIndices(count: number, scrollTop: number, viewportHeight: number, focusedIndex = -1, tallIndices?: readonly number[]): number[] {
  const overscan = 8;
  const visibleCount = Math.ceil((viewportHeight || 600) / SESSION_LIST_ITEM_HEIGHT) + overscan * 2;
  const tall = normalizeTallIndices(tallIndices);

  let start: number;
  let end: number;
  if (tall.length === 0) {
    // 快路径：全部等高，直接除（现有调用方与测试走的就是这条）。
    start = Math.max(0, Math.min(Math.floor(scrollTop / SESSION_LIST_ITEM_HEIGHT) - overscan, count - visibleCount));
    end = Math.min(count, start + visibleCount);
  } else {
    // 有高行：先找可见区的首尾行，再各留 overscan。
    // 行数在真实列表里是百量级，线性扫一遍比维护区间树便宜得多。
    const offsets = sessionListOffsets(count, tall);
    let first = 0;
    while (first < count - 1 && offsets[first + 1] <= scrollTop) first += 1;
    let last = first;
    const bottom = scrollTop + (viewportHeight || 600);
    while (last < count - 1 && offsets[last] < bottom) last += 1;
    start = Math.max(0, first - overscan);
    end = Math.min(count, Math.max(last + 1 + overscan, start + visibleCount));
  }

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

const UNREAD_SESSIONS_STORAGE_KEY = "pi-web:unread-session-ids";
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

function loadUnreadSessionIds(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(UNREAD_SESSIONS_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return new Set(parsed.filter((id): id is string => typeof id === "string"));
    return new Set();
  } catch {
    return new Set();
  }
}

function saveUnreadSessionIds(ids: Set<string>): void {
  if (typeof window === "undefined") return;
  try {
    if (ids.size === 0) window.localStorage.removeItem(UNREAD_SESSIONS_STORAGE_KEY);
    else window.localStorage.setItem(UNREAD_SESSIONS_STORAGE_KEY, JSON.stringify([...ids]));
  } catch {
    // ignore storage quota / privacy-mode errors
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

const DROPDOWN_ANIMATION_MS = 140;

function AnimatedDropdown({ open, children, style, className }: { open: boolean; children: ReactNode; style: CSSProperties; className?: string }) {
  const [mounted, setMounted] = useState(open);
  const [visible, setVisible] = useState(open);

  useEffect(() => {
    let frame: number | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;

    if (open) {
      setMounted(true);
      setVisible(false);
      frame = window.requestAnimationFrame(() => {
        frame = window.requestAnimationFrame(() => setVisible(true));
      });
    } else {
      setVisible(false);
      timeout = setTimeout(() => setMounted(false), DROPDOWN_ANIMATION_MS);
    }

    return () => {
      if (frame !== undefined) window.cancelAnimationFrame(frame);
      if (timeout) clearTimeout(timeout);
    };
  }, [open]);

  if (!mounted) return null;

  return (
    <div
      className={className}
      style={{
        ...style,
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0) scale(1)" : "translateY(-8px) scale(0.96)",
        transformOrigin: "top center",
        transition: `opacity ${DROPDOWN_ANIMATION_MS}ms ease, transform ${DROPDOWN_ANIMATION_MS}ms ease`,
        pointerEvents: open ? "auto" : "none",
      }}
    >
      {children}
    </div>
  );
}

/**
 * fork:ui-pop-portal — 渲染在 <body> 上的定值定位下拉。
 *
 * 侧栏的下拉（worktree 切换、项目 ⋯ 菜单）以前是 `position:absolute` 挂在滚动区
 * 里的行上：行靠近滚动区底部时浮窗要么被 `overflow` 裁掉、要么把滚动区撑长。
 * portal + fixed 让浮窗脱离所有裁切祖先；展开方向沿用 ModelSelector 的规则——
 * 下面放不下（<260px）才朝上，否则贴着触发点向下开。
 */
function PortalDropdown({
  open,
  anchorRef,
  panelRef,
  className,
  width,
  align,
  children,
}: {
  open: boolean;
  anchorRef: React.RefObject<HTMLElement | null>;
  panelRef?: React.RefObject<HTMLDivElement | null>;
  className?: string;
  /** 期望宽度；缺省跟随触发点宽度。 */
  width?: number;
  /** right = 浮窗右缘对齐触发点右缘（⋯ 菜单）；left = 左缘对齐触发点左缘。 */
  align?: "left" | "right";
  children: ReactNode;
}) {
  const [rect, setRect] = useState<{ left: number; top: number; bottom: number; width: number } | null>(null);
  const [above, setAbove] = useState(false);
  const [maxH, setMaxH] = useState(360);

  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const el = anchorRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const viewportH = window.innerHeight;
      const viewportW = window.innerWidth;
      const w = width ?? r.width;
      const spaceBelow = viewportH - r.bottom - 8;
      const spaceAbove = r.top - 8;
      // 与 ModelSelector 相同的规则：下方还有一段就不朝上。
      const openAbove = spaceBelow < 260 && spaceAbove > spaceBelow;
      setAbove(openAbove);
      setMaxH(Math.max(180, Math.min(openAbove ? spaceAbove : spaceBelow, viewportH * 0.6)));
      const left = align === "right"
        ? Math.max(8, Math.min(r.right - w, viewportW - w - 8))
        : Math.max(8, Math.min(r.left, viewportW - w - 8));
      setRect({ left, top: r.top, bottom: r.bottom, width: w });
    };
    update();
    window.addEventListener("resize", update);
    // 捕获阶段才能收到侧栏滚动容器的滚动。
    document.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      document.removeEventListener("scroll", update, true);
    };
  }, [open, align, width]);

  if (!rect) return null;

  return createPortal(
    <div ref={panelRef}>
      <AnimatedDropdown
        open={open}
        className={className}
        style={{
          position: "fixed",
          left: rect.left,
          width: rect.width,
          ...(above
            ? { bottom: window.innerHeight - rect.top + 6, maxHeight: maxH }
            : { top: rect.bottom + 6, maxHeight: maxH }),
          overflowY: "auto",
        }}
      >
        {children}
      </AnimatedDropdown>
    </div>,
    document.body,
  );
}

const SCRAMBLE_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*";

function useScramble(target: string, running: boolean): string {
  const [display, setDisplay] = useState(target);
  const frameRef = useRef<number | null>(null);
  const iterRef = useRef(0);

  useEffect(() => {
    if (!running) {
      setDisplay(target);
      return;
    }
    iterRef.current = 0;
    const totalFrames = target.length * 4;

    const step = () => {
      iterRef.current += 1;
      const progress = iterRef.current / totalFrames;
      const resolved = Math.floor(progress * target.length);

      setDisplay(
        target
          .split("")
          .map((char, i) => {
            if (char === " ") return " ";
            if (i < resolved) return char;
            return SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)];
          })
          .join("")
      );

      if (iterRef.current < totalFrames) {
        frameRef.current = requestAnimationFrame(step);
      } else {
        setDisplay(target);
      }
    };

    frameRef.current = requestAnimationFrame(step);
    return () => { if (frameRef.current) cancelAnimationFrame(frameRef.current); };
  }, [target, running]);

  return display;
}

function PiWebTitle() {
  const [showVersion, setShowVersion] = useState(false);
  const [scrambling, setScrambling] = useState(false);
  const revertTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const target = showVersion ? `${process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0"}p${process.env.NEXT_PUBLIC_PI_VERSION ?? "0.0.0"}` : "Pi Agent";
  const display = useScramble(target, scrambling);

  const triggerScramble = useCallback((toVersion: boolean) => {
    setShowVersion(toVersion);
    // Vestibular-sensitive users get an instant swap instead of the scramble.
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    setScrambling(true);
    setTimeout(() => setScrambling(false), (toVersion ? 6 : 8) * 4 * (1000 / 60) + 100);
  }, []);

  const handleClick = useCallback(() => {
    if (revertTimerRef.current) clearTimeout(revertTimerRef.current);

    const next = !showVersion;
    triggerScramble(next);

    if (next) {
      revertTimerRef.current = setTimeout(() => triggerScramble(false), 3000);
    }
  }, [showVersion, triggerScramble]);

  useEffect(() => () => { if (revertTimerRef.current) clearTimeout(revertTimerRef.current); }, []);

  return (
    <button
      type="button"
      onClick={handleClick}
      // fork:design-components —— 字号 / 字重 / 颜色交给 .pw-brand（画板 01/02：13px · 500 · n-strong）。
      style={{
        background: "none", border: 0, padding: 0, cursor: "default",
        color: showVersion ? "var(--accent-text)" : undefined,
        // 版本号与名字长度不同，固定 6ch 避免刷新时品牌行抽动。
        minWidth: "6ch",
      }}
    >
      {display}
    </button>
  );
}

function ProjectRow({
  projectKey,
  label,
  title,
  selected,
  count,
  expanded,
  onToggle,
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
  count?: number;
  expanded?: boolean;
  onToggle?: () => void;
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
  const menuRef = useRef<HTMLDivElement>(null);
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
  if (renaming) {
    return (
      <div className="pw-row is-on" style={{ width: "100%" }}>
        <span className="pw-ico"><i data-ico="folder" data-size="14"></i></span>
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
          className="pw-input"
          style={{ flex: 1, minWidth: 0, height: "var(--control-xs)", minInlineSize: 0 }}
        />
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-current={selected ? "page" : undefined}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      draggable={drag.draggable}
      onDragStart={drag.onDragStart}
      onDragEnd={drag.onDragEnd}
      // fork:design-components —— 项目行 = 画板 01/02 的 .pw-row（30 高 / 内缩 8px /
      // hover 叠色 / .is-on 选中）+ .pw-name + .pw-count + .pw-acts。
      className={`pw-row${selected ? " is-on" : ""}${archived ? " muted" : ""}`}
      style={{
        width: "100%",
        opacity: drag.dragging ? 0.55 : 1,
        // fork:zc-11 — 落点指示用 inset box-shadow（不改高度，避免触发假 FLIP）。
        boxShadow: drag.dropActive ? "inset 0 2px 0 0 var(--accent)" : "none",
      }}
    >
      <span className="pw-ico"><i data-ico="folder" data-size="14"></i></span>
      <span className="pw-name">{label}</span>
      {/* fork:ui-project-row — 折叠箭头紧跟标题（照 Zeno：名字 → ›，右端才是动作）。 */}
      {onToggle && (
        <span
          role="button"
          tabIndex={0}
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              e.stopPropagation();
              onToggle();
            }
          }}
          aria-label={expanded ? t("sidebar.collapseSubagents") : t("sidebar.expandSubagents")}
          className="pw-ico"
        >
          <i data-ico={expanded ? "chevron-down" : "chevron-right"} data-size="12"></i>
        </span>
      )}
      <span className="grow" />
      {typeof count === "number" && <span className="pw-count">{count}</span>}
      {showProjectActivity(activity, t)}
      {/* fork:ui-project-actions — hover 才出现的两个入口（照 Zeno 的次序：⋯ 在内、⊕ 贴行尾）。 */}
      <span className="pw-acts" style={{ opacity: hovered || menuOpen ? 1 : 0, flexShrink: 0 }}>
      {(onOpenFolder || onRename || onRemove || onArchive) && (
        <div ref={menuRef} style={{ position: "relative", flexShrink: 0 }}>
          <span
            role="button"
            tabIndex={0}
            aria-label={t("sidebar.projectActions")}
            aria-expanded={menuOpen}
            title={t("sidebar.projectActions")}
            onClick={(event) => {
              event.stopPropagation();
              setMenuOpen((open) => !open);
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              event.stopPropagation();
              setMenuOpen((open) => !open);
            }}
            className={`pw-iconbtn sm${menuOpen ? " is-on" : ""}`}
          >
            <span className="pw-ico"><i data-ico="ellipsis" data-size="14"></i></span>
          </span>
          {/* fork:ui-pop-portal —— 项目菜单 = 画板 02 的 .pw-pop + .pw-prow，
              portal 到 body 定值定位：项目行在滚动区下部时菜单不再被裁/撑长列表。 */}
          <PortalDropdown
            open={menuOpen}
            anchorRef={menuRef}
            panelRef={menuPanelRef}
            className="pw-pop"
            width={210}
            align="right"
          >
            <div role="menu">
              {onOpenFolder && (
                <button type="button" role="menuitem" className="pw-prow" style={{ width: "100%" }} onClick={(event) => { event.stopPropagation(); setMenuOpen(false); onOpenFolder(); }}>
                  <span className="pw-ico"><i data-ico="folder-open" data-size="14"></i></span>
                  {t("sidebar.openProjectFolder")}
                </button>
              )}
              {onRename && (
                <button type="button" role="menuitem" className="pw-prow" style={{ width: "100%" }} onClick={(event) => { event.stopPropagation(); setMenuOpen(false); onRename(); }}>
                  <span className="pw-ico"><i data-ico="square-pen" data-size="14"></i></span>
                  {t("sidebar.renameProject")}
                </button>
              )}
              {onArchive && (
                <button type="button" role="menuitem" className="pw-prow" style={{ width: "100%" }} onClick={(event) => { event.stopPropagation(); setMenuOpen(false); onArchive(); }}>
                  <span className="pw-ico"><i data-ico="archive" data-size="14"></i></span>
                  {archived ? t("sidebar.restoreProject") : t("sidebar.archiveProject")}
                </button>
              )}
              {onRemove && (
                <>
                  <div className="pw-sep" />
                  <button type="button" role="menuitem" className="pw-prow" style={{ width: "100%", color: "var(--error)" }} onClick={(event) => { event.stopPropagation(); setMenuOpen(false); onRemove(); }}>
                    <span className="pw-ico" style={{ color: "var(--error)" }}><i data-ico="minus" data-size="14"></i></span>
                    {t("sidebar.removeProject")}
                  </button>
                </>
              )}
            </div>
          </PortalDropdown>
        </div>
      )}
      {/* ⊕：直接在这个项目里开新会话（workbuddy 的 ⊕），排在 ⋯ 右侧、贴行尾。 */}
      {onNewSession && (
        <span
          role="button"
          tabIndex={0}
          aria-label={t("sidebar.newSessionInProject")}
          title={t("sidebar.newSessionInProject")}
          onClick={(event) => {
            event.stopPropagation();
            onNewSession();
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            event.stopPropagation();
            onNewSession();
          }}
          className="pw-iconbtn sm"
          style={{ opacity: hovered ? 1 : 0 }}
        >
          <span className="pw-ico"><i data-ico="plus" data-size="14"></i></span>
        </span>
      )}
      </span>
      </button>
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
  // PR-03 — 时间分组头的折叠状态（earlier 默认折叠），写 localStorage 跨刷新保留。
  const [collapsedGroups, setCollapsedGroups] = useState<CollapsedTimeGroups>(() => loadCollapsedTimeGroups());
  const toggleGroup = useCallback((bucket: TimeBucket) => {
    setCollapsedGroups((prev) => {
      const next = { ...prev, [bucket]: !prev[bucket] };
      saveCollapsedTimeGroups(next);
      return next;
    });
  }, []);
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
  /* fork:design-components —— 画板 02 的搜索是**常显**一格（.pw-side-search），
     所以不再有「开/关搜索框」的状态：输入框一直在，头部那个搜索钮只负责聚焦它。
     `searchRequestId` 是折叠导轨点搜索时 AppShell 递过来的计数，收到就聚焦。 */
  const searchInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (searchRequestId > 0) searchInputRef.current?.focus();
  }, [searchRequestId]);
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
  const [sessionSearchQuery, setSessionSearchQuery] = useState("");
  const sessionSearchActive = Boolean(sessionSearchQuery.trim());
  const [runningSessionIds, setRunningSessionIds] = useState<Set<string>>(() => new Set());
  // fork:design-system — 「等你处理」（画板 02 第三态）：挂起扩展请求、不在跑的会话。
  // 与 running 同一次轮询取回，所以不额外发请求。
  const [awaitingSessionIds, setAwaitingSessionIds] = useState<Set<string>>(() => new Set());
  const [awaitingSessionKinds, setAwaitingSessionKinds] = useState<Record<string, "approval" | "input">>({});
  const [unreadSessionIds, setUnreadSessionIds] = useState<Set<string>>(() => loadUnreadSessionIds());
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
      setUnreadSessionIds((prev) => {
        if (prev.size === 0) return prev;
        const next = new Set([...prev].filter((id) => unreadEligibleIds.has(id)));
        return next.size === prev.size ? prev : next;
      });
      setError(null);
    } catch (e) {
      if (loadId === sessionLoadIdRef.current) setError(String(e));
    } finally {
      if (loadId === sessionLoadIdRef.current) setLoading(false);
    }
  }, []);

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

  // Persist unread markers so they survive a browser refresh before the user
  // has actually opened the completed session.
  useEffect(() => {
    saveUnreadSessionIds(unreadSessionIds);
  }, [unreadSessionIds]);

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
      setUnreadSessionIds((prev) => {
        const next = new Set(prev);
        runningSessionIds.forEach((id) => next.delete(id));
        completedWithNotifications.forEach((id) => next.add(id));
        return next;
      });
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
    setUnreadSessionIds((prev) => {
      if (!prev.has(selectedSessionId)) return prev;
      const next = new Set(prev);
      next.delete(selectedSessionId);
      return next;
    });
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

  const sessionFamilies = listSessionFamilies(applySessionFlags(filteredSessions, sessionFlags));

  // PR-03 — 时间分组：pinned 单独成桶并置顶（延续 applySessionFlags 的分区意图），
  // 其余按 family.latestModified 的本地日历日分桶。同一桶内保持传入顺序，
  // 因此 sessionSort / worktree 合并后的相对顺序不会被重排。
  const pinnedSessionIds = useMemo(() => new Set(sessionFlags.pinned), [sessionFlags.pinned]);
  const bucketOfFamily = useCallback(
    (family: SessionFamily): TimeBucket => (
      pinnedSessionIds.has(family.root.id) ? "pinned" : bucketOf(family.latestModified)
    ),
    [pinnedSessionIds],
  );
  // 虚拟列表关键坑：分组头与条目共用这条扁平数组，每个元素恰好占一个
  // SESSION_LIST_ITEM_HEIGHT 槽位（TimeGroupHeader 也强制同高）。因此
  // getSessionListIndices 用 entries.length 计数后，index 与实际槽位一一对应，
  // 插入分组头不会造成偏移或越界；折叠分组只是从数组里移除条目。
  const sessionListEntries = useMemo(
    () => groupByTimeBucket(sessionFamilies, bucketOfFamily, collapsedGroups),
    [sessionFamilies, bucketOfFamily, collapsedGroups],
  );

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

  // fork:design-system — 运行中 / 等你处理的会话行高 58，其余 48。
  // 这是「行是不是高行」的唯一判据，虚拟窗口、绝对定位偏移、行渲染三处共用。
  const isFamilyTall = useCallback(
    (family: SessionFamily) =>
      [family.root, ...family.subagents].some(
        (session) => runningSessionIds.has(session.id) || awaitingSessionIds.has(session.id),
      ),
    [runningSessionIds, awaitingSessionIds],
  );

  const sessionListTallIndices = useMemo(
    () =>
      sessionListEntries
        .map((entry, index) => (entry.type === "item" && isFamilyTall(entry.item) ? index : -1))
        .filter((index) => index >= 0),
    [sessionListEntries, isFamilyTall],
  );

  const virtualIndices = getSessionListIndices(
    sessionListEntries.length,
    Math.max(0, listScrollTop - sessionListOffsetTop),
    listViewportH,
    sessionListEntries.findIndex((entry) => entry.type === "item" && entry.item.root.id === focusedSessionId),
    sessionListTallIndices,
  );

  // 所有列表表面共用的行渲染；分组头渲染也走同一份 collapsedGroups。
  const renderFamilyRow = (family: SessionFamily) => {
    const familySessions = [family.root, ...family.subagents];
    const displaySession = family.latestModified === family.root.modified ? family.root : { ...family.root, modified: family.latestModified };
    return (
      <div style={{ flex: 1, minWidth: 0 }}>
        <SessionItem session={displaySession} isSelected={familySessions.some((session) => session.id === selectedSessionId)} isRunning={familySessions.some((session) => runningSessionIds.has(session.id))} isAwaiting={familySessions.some((session) => awaitingSessionIds.has(session.id))} awaitingKind={familySessions.map((session) => awaitingSessionKinds[session.id]).find(Boolean)} isUnread={familySessions.some((session) => unreadSessionIds.has(session.id))} tag={sessionFlags.tags[family.root.id]} onClick={() => handleSelectSessionFromList(family.root)} onRenamed={loadSessions} onDeleted={(id) => { onSessionDeleted?.(id); loadSessions(); }} />
      </div>
    );
  };
  const renderGroupHeader = (bucket: TimeBucket, count: number) => (
    <TimeGroupHeader
      bucket={bucket}
      count={count}
      collapsed={collapsedGroups[bucket]}
      onToggle={() => toggleGroup(bucket)}
    />
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
      {/* fork:design-components —— 侧栏头**直接使用画板 02 的 .pw-side-head**：
          品牌（.pw-brand + .pw-logo）/ 搜索 / 折叠三件，高度取 --topbar-height。
          fork:desktop-shell — 红绿灯压在这行左端，品牌右移一个安全距离，整行兼作窗口拖拽区。 */}
      <div className="pw-side-head" style={{ paddingLeft: Math.max(12, desktopTrafficLightInset()) }}>
        <span className="pw-brand">
          <span className="pw-logo" aria-hidden="true">
            {/* fork:brand-logo — 画板 brand/ 的 π 几何（一条横杠 + 两条竖腿）。 */}
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M4 7h16" /><path d="M8 7v11" /><path d="M16 7v11" />
            </svg>
          </span>
          <PiWebTitle />
        </span>
        <span className="grow" />
        <button
          type="button"
          onClick={() => searchInputRef.current?.focus()}
          title={t("sidebar.toggleSessionSearch")}
          aria-label={t("sidebar.toggleSessionSearch")}
          className="pw-iconbtn"
        >
          <span className="pw-ico"><i data-ico="search"></i></span>
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
            className="pw-iconbtn"
          >
            <span className="pw-ico"><i data-ico="panel-left"></i></span>
          </button>
        )}
      </div>
      {/* fork:design-components —— 新建任务 = 画板 02 的 .pw-side-nav > .pw-row。 */}
      <div className="pw-side-nav">
        <button
          type="button"
          onClick={handleNewSession}
          aria-label={t("sidebar.newTask")}
          title={selectedCwd ? t("sidebar.newSessionTitle", { path: selectedCwd }) : t("sidebar.newTask")}
          className="pw-row"
        >
          <span className="pw-ico"><i data-ico="square-pen"></i></span>
          <span className="pw-name">{t("sidebar.newTask")}</span>
          <span className="grow" />
        </button>
      </div>

      {/* fork:design-components —— 项目 / 聊天 左右切换 = 画板 02 的 .pw-seg。 */}
      <div className="pw-seg" role="tablist" aria-label={t("sidebar.paneSwitch")}>
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

      {/* fork:design-components —— 会话搜索 = 画板 02 的 .pw-side-search（常显）。
          画板里是一个静态盒，产品里换成真输入框；视觉全取 board.css。 */}
      <label className="pw-side-search">
        <span className="pw-ico"><i data-ico="search" data-size="14"></i></span>
        <input
          id="session-search-input"
          ref={searchInputRef}
          type="search"
          value={sessionSearchQuery}
          maxLength={200}
          aria-label={t("sidebar.searchSessions")}
          placeholder={t("sidebar.searchSessions")}
          onChange={(event) => setSessionSearchQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              setSessionSearchQuery("");
            }
          }}
        />
      </label>

      {/* fork:design-components —— 列表区 = 画板 02 的 .pw-side-scroll（flex-1 + 内缩 8px）。 */}
      <div className="pw-side-scroll">

        <SessionSearch open={sessionSearchActive} query={sessionSearchQuery} selectedSessionId={selectedSessionId} onSelectSession={handleSelectSessionFromList}>
        <div
          ref={listScrollRef}
          onScroll={handleListScroll}
          style={{ flex: "1 1 auto", overflowY: "auto", minHeight: 80 }}
        >
          {loading && projectChoices.length === 0 && (
            <div style={{ padding: "16px 14px", color: "var(--text-muted)", fontSize: TEXT.sm }}>
              {t("sidebar.loading")}
            </div>
          )}
          {error && (
            <div style={{ padding: "12px 14px", color: "var(--danger)", fontSize: TEXT.sm }}>
              {error}
            </div>
          )}
          {!loading && !error && visibleProjects.length === 0 && !chatProject && (
            <div style={{ padding: "16px 14px", color: "var(--text-muted)", fontSize: TEXT.sm }}>
              {t("sidebar.noSessions")}
            </div>
          )}
          {/* fork:zn-20 — 切到「聊天」但还没建过聊天工作区时，说清楚该怎么建，
              否则整列是空的，看着像坏了。 */}
          {sidebarPane === "chat" && !chatProject && !loading && !error && (
            <div style={{ padding: "16px 14px", color: "var(--text-muted)", fontSize: TEXT.sm, lineHeight: 1.5 }}>
              {t("sidebar.noChatWorkspace")}
            </div>
          )}

          {/* fork:zn-20 — 两段各自只在被选中时渲染：项目段（分区头 + 项目树 + 分组）
              与聊天段（下面那个 IIFE）互斥。不用 hidden 保活：两段加起来可能上百行，
              留一半在 DOM 里只为了切换快 20ms 不值得。 */}
          {sidebarPane === "projects" && (
          <>
          {/* fork:design-components —— 分区头 = 画板 01/02 的 .pw-group-title：
              左侧组图标（装饰），右端动作位。本产品只有「展开 / 折叠全部」
              一个动作 —— 「添加项目」按用户要求已从这里移除。 */}
          <div className="pw-group-title">
            <span className="pw-ico"><i data-ico="list-tree" data-size="12"></i></span>
            {t("sidebar.projects")}
            <span className="grow" />
            <button
              type="button"
              onClick={() => {
                const keys = visibleProjects.map((project) => project.key);
                const allOpen = keys.length > 0 && keys.every((key) => expandedProjects.has(key));
                setExpandedProjects(allOpen ? new Set() : new Set(keys));
              }}
              title={t("sidebar.expandCollapseAll")}
              aria-label={t("sidebar.expandCollapseAll")}
              className="pw-iconbtn sm"
            >
              <span className="pw-ico"><i data-ico="chevrons-up-down" data-size="12"></i></span>
            </button>
          </div>

          {visibleProjects.map((project) => {
            const isSelectedProject = project.key === selectedProject?.key;
            const count = sessionsForProject(allSessions, project.key).length;
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
                  count={count}
                  expanded={isExpanded}
                  onToggle={() => {
                    setExpandedProjects((prev) => {
                      const next = new Set(prev);
                      if (next.has(project.key)) next.delete(project.key);
                      else next.add(project.key);
                      return next;
                    });
                  }}
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
                      {/* fork:design-components —— 工作区（分支）行 = 画板 02 的嵌套 .pw-row：
                          git-branch + 分支名（等宽）+ 右端 chevron-down。 */}
                      <button
                        type="button"
                        onClick={() => setWtDropdownOpen((v) => !v)}
                        title={currentWorktree ? t("sidebar.switchWorktreeTitle", { path: currentWorktree.path }) : t("sidebar.switchWorktree")}
                        aria-expanded={wtDropdownOpen}
                        className="pw-row"
                        style={{ width: "100%", paddingLeft: 26, height: 26 }}
                      >
                        <span className="pw-ico" style={{ color: currentWorktree && !currentWorktree.isMain ? "var(--accent-text)" : undefined }}>
                          <i data-ico="git-branch" data-size="12"></i>
                        </span>
                        <PathLabel
                          text={currentWorktree ? (currentWorktree.branch ?? displayCwd(currentWorktree.path, homeDir)) : "…"}
                          style={{ flex: 1, fontFamily: "var(--font-mono)", fontSize: "var(--text-meta)" }}
                        />
                        {currentWorktree?.isMain && (
                           <span className="pw-badge">{t("sidebar.main")}</span>
                        )}
                        {worktreeState.worktrees.length > 1 && (
                          <span className="pw-badge count">{worktreeState.worktrees.length}</span>
                        )}
                        <span className="pw-ico"><i data-ico="chevron-down" data-size="12"></i></span>
                      </button>

                      {/* fork:ui-pop-portal —— 下拉本体 = 画板 02 的 .pw-pop，portal 到 body：
                          分支行被滚到列表下部时，下拉不再被滚动区裁掉/把列表撑长。 */}
                      <PortalDropdown
                        open={wtDropdownOpen}
                        anchorRef={wtDropdownRef}
                        panelRef={wtPanelRef}
                        className="pw-pop"
                      >
                          {showWtFilter && (
                            <div style={{ padding: "4px 4px 0" }}>
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
                                className="pw-input"
                                style={{ width: "100%", minWidth: 0, fontFamily: "var(--font-mono)" }}
                              />
                            </div>
                          )}
                          <div style={{ maxHeight: "min(40vh, 300px)", overflowY: "auto" }}>
                            {visibleWorktrees.map((wt) => {
                              const isCurrent = wt.path === currentWorktreePath;
                              if (wtConfirmRemove === wt.path) {
                                return (
                                  <div key={wt.path} className="pw-prow" style={{ background: "var(--error-soft)" }}>
                                    <span className="grow" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                      {t("sidebar.forceRemoveCheckout")}
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => void handleRemoveWorktree(wt.path, true)}
                                      disabled={wtBusy}
                                      className="pw-btn sm"
                                      style={{ background: "var(--error)", color: "var(--accent-on)", flexShrink: 0 }}
                                    >
                                      {t("sidebar.force")}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setWtConfirmRemove(null)}
                                      className="pw-btn sm outline"
                                      style={{ flexShrink: 0 }}
                                    >
                                      {t("sidebar.cancel")}
                                    </button>
                                  </div>
                                );
                              }
                              return (
                                <div
                                  key={wt.path}
                                  className="wt-row"
                                  style={{ display: "flex", alignItems: "center" }}
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
                                    className={`pw-prow${isCurrent ? " is-on" : ""}`}
                                    style={{ flex: 1, minWidth: 0, fontFamily: "var(--font-mono)" }}
                                  >
                                    {isCurrent
                                      ? <span className="pw-ico"><i data-ico="check" data-size="12"></i></span>
                                      : <span className="pw-ico" style={{ width: 12 }} />}
                                    <PathLabel text={wt.branch ?? displayCwd(wt.path, homeDir)} style={{ flex: 1 }} />
                                    {wt.isMain && <span className="pw-badge">{t("sidebar.main")}</span>}
                                  </button>
                                  {!wt.isMain && (
                                    <button
                                      type="button"
                                      onClick={() => void handleRemoveWorktree(wt.path, false)}
                                      disabled={wtBusy}
                                      title={t("sidebar.removeWorktreeTitle", { path: wt.path })}
                                      aria-label={t("sidebar.removeWorktreeTitle", { path: wt.path })}
                                      className="pw-iconbtn sm"
                                      style={{ color: "var(--error)", marginRight: 4, flexShrink: 0 }}
                                    >
                                      <span className="pw-ico"><i data-ico="trash-2" data-size="12"></i></span>
                                    </button>
                                  )}
                                </div>
                              );
                            })}
                            {showWtFilter && visibleWorktrees.length === 0 && wtFilter.trim() && (
                              <div className="pw-prow pw-desc">{t("sidebar.noMatchingWorktrees")}</div>
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
                              className="pw-prow"
                              style={{ width: "100%" }}
                            >
                              <span className="pw-ico"><i data-ico="plus" data-size="13"></i></span>
                              {t("sidebar.newWorktree")}
                            </button>
                          ) : (
                            <div style={{ padding: "4px" }}>
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
                                className="pw-input"
                                style={{ width: "100%", minWidth: 0, fontFamily: "var(--font-mono)", borderColor: "var(--accent)" }}
                              />
                              <div className="pw-inline" style={{ gap: 4, marginTop: 4 }}>
                                <button
                                  type="button"
                                  onClick={() => void handleCreateWorktree()}
                                  disabled={wtBusy || !wtNewBranch.trim()}
                                  className="pw-btn sm primary"
                                  style={{ flex: 1, justifyContent: "center" }}
                                >
                                   {wtBusy ? t("sidebar.creating") : t("sidebar.create")}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => { setWtNewOpen(false); setWtNewBranch(""); setWtError(null); }}
                                  className="pw-btn sm outline"
                                  style={{ flex: 1, justifyContent: "center" }}
                                >
                                   {t("sidebar.cancel")}
                                </button>
                              </div>
                            </div>
                          )}
                          {wtError && (
                            <div className="pw-prow pw-desc" style={{ color: "var(--error)", overflowWrap: "anywhere" }}>
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
                    className="pw-row"
                    style={{ width: "100%", height: 26, paddingLeft: 26, color: "var(--n-placeholder)", cursor: "default" }}
                  >
                    <span className="pw-ico"><i data-ico="git-branch" data-size="12"></i></span>
                    <span className="pw-name" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-meta)" }}>{inactiveWorktreeSelector.label}</span>
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
                    const projectEntries = groupByTimeBucket(families, bucketOfFamily, collapsedGroups);
                    if (families.length === 0) {
                      return (
                        <div style={{ padding: "6px 0 6px 34px", color: "var(--text-dim)", fontSize: TEXT.sm }}>{t("sidebar.noTasks")}</div>
                      );
                    }
                    if (project.key === selectedProject?.key) {
                      const rowOffsets = sessionListOffsets(sessionListEntries.length, sessionListTallIndices);
                      return (
                        <div ref={sessionListRef} style={{ minHeight: sessionListEntries.length > 0 ? rowOffsets[sessionListEntries.length] : 34 }}>
                          {sessionListEntries.length > 0 && (
                            <div style={{ position: "relative", height: rowOffsets[sessionListEntries.length] }}>
                              {virtualIndices.map((index) => {
                                const entry = sessionListEntries[index];
                                if (!entry) return null;
                                const isItem = entry.type === "item";
                                const top = rowOffsets[index] ?? index * SESSION_LIST_ITEM_HEIGHT;
                                const height = (rowOffsets[index + 1] ?? top + SESSION_LIST_ITEM_HEIGHT) - top;
                                return (
                                  <div key={sessionEntryKey(entry)} data-session-id={isItem ? entry.item.root.id : undefined} onFocus={isItem ? () => setFocusedSessionId(entry.item.root.id) : undefined} onBlur={isItem ? () => setFocusedSessionId(null) : undefined} style={{ position: "absolute", top, left: 0, right: 0, height }}>
                                    {isItem ? renderFamilyRow(entry.item) : renderGroupHeader(entry.bucket, entry.count)}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    }
                    return (
                      <div style={{ display: "flex", flexDirection: "column", gap: 1, marginLeft: 8, borderLeft: "1px solid var(--border-faint)", paddingLeft: 4 }}>
                        {projectEntries.map((entry) => (
                          <div key={sessionEntryKey(entry)}>
                            {entry.type === "item" ? renderFamilyRow(entry.item) : renderGroupHeader(entry.bucket, entry.count)}
                          </div>
                        ))}
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
            // 聊天列表复用同一套时间分组与折叠状态；窗口单独计算，避免与项目
            // 列表的 entries 长度耦合，index 永远落在 chatEntries 范围内。
            const chatEntries = groupByTimeBucket(chatFamilies, bucketOfFamily, collapsedGroups);
            const chatTallIndices = chatEntries
              .map((entry, index) => (entry.type === "item" && isFamilyTall(entry.item) ? index : -1))
              .filter((index) => index >= 0);
            const chatOffsets = sessionListOffsets(chatEntries.length, chatTallIndices);
            const chatVirtualIndices = getSessionListIndices(
              chatEntries.length,
              Math.max(0, listScrollTop - sessionListOffsetTop),
              listViewportH,
              chatEntries.findIndex((entry) => entry.type === "item" && entry.item.root.id === focusedSessionId),
              chatTallIndices,
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
              // fork:zn-13 — 分区之间靠 marginTop 分开（与项目分区头同一个 18px
              // 节奏），不用分隔线；Zeno 的导轨同样是不划线、只用间距。
              <div style={{ marginTop: 18 }}>
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
                  <div style={{ padding: "6px 0 6px 24px", color: "var(--text-dim)", fontSize: TEXT.sm }}>{t("sidebar.noTasks")}</div>
                ) : isSelectedChat ? (
                  <div ref={sessionListRef} style={{ minHeight: chatEntries.length > 0 ? chatOffsets[chatEntries.length] : 34 }}>
                    {chatEntries.length > 0 && (
                      <div style={{ position: "relative", height: chatOffsets[chatEntries.length] }}>
                        {chatVirtualIndices.map((index) => {
                          const entry = chatEntries[index];
                          if (!entry) return null;
                          const isItem = entry.type === "item";
                          return (
                            <div key={sessionEntryKey(entry)} data-session-id={isItem ? entry.item.root.id : undefined} onFocus={isItem ? () => setFocusedSessionId(entry.item.root.id) : undefined} onBlur={isItem ? () => setFocusedSessionId(null) : undefined} style={{ position: "absolute", top: chatOffsets[index], left: 0, right: 0, height: (chatOffsets[index + 1] ?? chatOffsets[index]) - chatOffsets[index] }}>
                              {isItem ? renderFamilyRow(entry.item) : renderGroupHeader(entry.bucket, entry.count)}
                            </div>
                          );
                        })}
                      </div>
                    )}
                          </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                    {chatEntries.map((entry) => (
                      <div key={sessionEntryKey(entry)}>
                        {entry.type === "item" ? renderFamilyRow(entry.item) : renderGroupHeader(entry.bucket, entry.count)}
                      </div>
                    ))}
                        </div>
                ))}
              </div>
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
 * Compact per-project activity badges for the workspace selector dropdown items:
 * a spinning running icon + count and an unread dot + count. Renders nothing
 * when the project has no activity. Counts share the accent / unread colors of
 * the per-session indicators so the two stay visually consistent.
 */
function showProjectActivity(
  activity: { running: number; unread: number } | undefined,
  t: (key: string) => string,
): ReactNode {
  if (!activity || (activity.running === 0 && activity.unread === 0)) return null;
  return (
    <span className="pw-inline" style={{ gap: 4, flexShrink: 0 }}>
      {activity.running > 0 && (
        <span
          className="pw-badge accent count"
          title={t("sidebar.agentRunning")}
          aria-label={`${t("sidebar.agentRunning")} (${activity.running})`}
        >
          <span className="pw-ico"><i data-ico="loader-circle" data-size="11"></i></span>
          {activity.running}
        </span>
      )}
      {activity.unread > 0 && (
        <span
          className="pw-badge ok count"
          title={t("sidebar.newSessionActivity")}
          aria-label={`${t("sidebar.newSessionActivity")} (${activity.unread})`}
        >
          <span className="pw-ico"><i data-ico="circle" data-size="8"></i></span>
          {activity.unread}
        </span>
      )}
    </span>
  );
}

/**
 * PR-03 — 会话列表的时间分组头（可点击折叠，earlier 默认折叠）。
 *
 * 高度固定为 SESSION_LIST_ITEM_HEIGHT 是关键：虚拟列表把分组头和会话行当成同一种
 * 槽位来计算 index，若头部高度不同，绝对定位的 top 就会错位/越界。
 */
function TimeGroupHeader({ bucket, count, collapsed, onToggle }: {
  bucket: TimeBucket;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={!collapsed}
      title={t(collapsed ? "session.expandGroup" : "session.collapseGroup")}
      // fork:design-components —— 时间分组头 = 画板 02 的 .pw-group-title；
      // 高度必须保持 SESSION_LIST_ITEM_HEIGHT（虚拟列表把分组头与会话行当同一种槽位）。
      className="pw-group-title"
      style={{ width: "100%", height: SESSION_LIST_ITEM_HEIGHT, cursor: "pointer" }}
    >
      <span className="pw-ico">
        <i data-ico={collapsed ? "chevron-right" : "chevron-down"} data-size="12"></i>
      </span>
      {t(timeBucketKey(bucket), { count })}
      <span className="grow" />
    </button>
  );
}

function SessionItem({
  session,
  isSelected,
  isRunning,
  isAwaiting,
  awaitingKind,
  isUnread,
  tag,
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
  /** fork:ui-10 — manual status tag; drives the coloured dot. */
  tag?: SessionTag;
  onClick: () => void;
  onRenamed?: () => void;
  onDeleted?: (id: string) => void;
  depth?: number;
  hasChildren?: boolean;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}) {
  const { locale, t } = useI18n();
  // fork:ui — 置顶/归档的行内入口。与右键菜单共用 session-flags store
  //（useSyncExternalStore，toggle 后所有订阅者自动重渲）。
  const { flags: sessionFlagState, pin, archive } = useSessionFlags();
  const isPinned = sessionFlagState.pinned.includes(session.id);
  const isArchived = sessionFlagState.archived.includes(session.id);
  const [hovered, setHovered] = useState(false);
  const showHover = hovered;
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

  const handleDeleteConfirm = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    void performDelete();
  }, [performDelete]);

  const handleDeleteCancel = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
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

  // Fixed-height outer wrapper — content swaps in place so the list never reflows
  return (
    <button
      type="button"
      // fork:design-components —— 会话行**直接使用画板 02 的 .pw-session**：
      // 48 / 58 两档行高、.child 缩进 26px、hover 叠色、.is-on 选中、
      // .running 底边扫掠线、.awaiting 底边常亮线，全部来自 board.css。
      // 行入场挂在行容器上是安全的：列表 key 稳定时不重挂载，动画只播一次。
      className={[
        "fork-row-enter",
        "pw-session child",
        isRunning ? "running" : "",
        isAwaiting ? "awaiting" : "",
        isSelected ? "is-on" : "",
      ].filter(Boolean).join(" ")}
      onClick={confirmDelete || renaming ? undefined : onClick}
      onContextMenu={confirmDelete || renaming ? undefined : handleContextMenu}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); }}
      style={{
        width: "100%",
        // 子代理再缩进一级（画板 02：子代理缩进一级 + corner-down-right 图标）。
        paddingLeft: depth > 0 ? 26 + depth * 10 : undefined,
        cursor: confirmDelete || renaming ? "default" : "pointer",
        opacity: deleting ? 0.5 : 1,
      }}
    >
      {confirmDelete ? (
        /* ── Delete confirmation: same height, two flat buttons ── */
        <>
          <span className="pw-body">
            <span className="pw-t">
              {t("sidebar.deleteSession", { title: title.slice(0, 22) + (title.length > 22 ? "…" : "") })}
            </span>
          </span>
          <span className="pw-inline" style={{ flexShrink: 0 }}>
            <button
              type="button"
              onClick={handleDeleteConfirm}
              className="pw-btn sm"
              style={{ background: "var(--error)", color: "var(--accent-on)" }}
            >
              <span className="pw-ico"><i data-ico="trash-2" data-size="13"></i></span>
              {t("sidebar.delete")}
            </button>
            <button type="button" onClick={handleDeleteCancel} className="pw-btn sm outline">
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
          className="pw-input"
          style={{ flex: 1, minWidth: 0, height: "var(--control-xs)" }}
        />
      ) : (
        /* ── Normal view：两行（标题 + 元信息），状态标记一律在右侧 ── */
        <>
          {/* Subagent indicator for child sessions（画板 02：corner-down-right） */}
          {depth > 0 && (
            <span className="pw-ico" style={{ color: "var(--accent-text)" }}>
              <i data-ico="corner-down-right" data-size="13"></i>
            </span>
          )}
          <span className="pw-body">
            <span
              title={`${title} · ${formatRelativeTime(session.modified, locale)}`}
              className="pw-t"
            >
              {title}
            </span>
            <span className="pw-m">
              <span>{formatRelativeTime(session.modified, locale)}</span>
              <span aria-hidden="true"> · </span>
              <span>{t("sidebar.messageCount", { count: session.messageCount })}</span>
              {/* 三者互斥：等你处理 > 未读 > 手动标签。运行中不出右侧标记（它靠底边扫掠表达）。 */}
              {isAwaiting ? (
                <span className="pw-await" title={t(awaitingKind === "input" ? "sidebar.awaitingInput" : "sidebar.awaitingApproval")}>
                  <span className="pw-ico"><i data-ico="triangle-alert" data-size="11"></i></span>
                  {t(awaitingKind === "input" ? "sidebar.awaitingInputShort" : "sidebar.awaitingApprovalShort")}
                </span>
              ) : tag ? (
                <span title={t(`session.tag.${tag}`)} aria-label={t(`session.tag.${tag}`)} style={{ display: "inline-flex", flex: "none", marginLeft: 5 }}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: SESSION_TAG_TONES[tag] }} />
                </span>
              ) : isUnread ? (
                <span className="pw-dot unread" title={t("sidebar.newActivity")} aria-label={t("sidebar.newSessionActivity")} />
              ) : null}
            </span>
          </span>
          {session.isWorktree && session.branch && (
            <span
              title={`Worktree: ${session.cwd}`}
              className="pw-ico"
              style={{ color: "var(--accent-text)" }}
            >
              <i data-ico="git-branch" data-size="12"></i>
            </span>
          )}

          {/* Collapse toggle — always visible when has children */}
          {hasChildren && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onToggleCollapse?.(); }}
              title={t(collapsed ? "sidebar.expandSubagents" : "sidebar.collapseSubagents")}
              aria-label={t(collapsed ? "sidebar.expandSubagents" : "sidebar.collapseSubagents")}
              className="pw-iconbtn sm"
            >
              <span className="pw-ico">
                <i data-ico={collapsed ? "chevron-right" : "chevron-down"} data-size="12"></i>
              </span>
            </button>
          )}

          {/* Hover actions appear over the title's trailing edge; nothing is
              reserved when idle so the title uses the full row width. The
              relative time stays available in the title tooltip above.
              Also shown when a row slides under a stationary pointer after a
              delete reflows the list (see syncPointerSession). */}
          {showHover && !session.transient ? (
            <span className="pw-acts" style={{ opacity: 1, flexShrink: 0 }}>
              {/* fork:ui — 置顶（选中态实心 + accent 色）。 */}
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); pin(session.id); }}
                title={t(isPinned ? "session.unpin" : "session.pin")}
                aria-label={t(isPinned ? "session.unpin" : "session.pin")}
                className={`pw-iconbtn sm${isPinned ? " is-on" : ""}`}
              >
                <span className="pw-ico"><i data-ico="pin" data-size="13"></i></span>
              </button>
              {/* fork:ui — 归档（归档后行会落到项目的「已归档」折叠区）。 */}
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); archive(session.id); }}
                title={t(isArchived ? "session.unarchive" : "session.archive")}
                aria-label={t(isArchived ? "session.unarchive" : "session.archive")}
                className={`pw-iconbtn sm${isArchived ? " is-on" : ""}`}
              >
                <span className="pw-ico"><i data-ico="archive" data-size="13"></i></span>
              </button>
              <button
                type="button"
                onClick={startRename}
                title={t("sidebar.rename")}
                aria-label={t("sidebar.rename")}
                className="pw-iconbtn sm"
              >
                <span className="pw-ico"><i data-ico="square-pen" data-size="13"></i></span>
              </button>
              <button
                type="button"
                onClick={handleDeleteClick}
                title={t("sidebar.deleteWithShiftClick")}
                aria-label={t("sidebar.delete")}
                className="pw-iconbtn sm"
                style={{ color: "var(--error)" }}
              >
                <span className="pw-ico"><i data-ico="trash-2" data-size="13"></i></span>
              </button>
            </span>
          ) : null}
        </>
      )}
    </button>
  );
}

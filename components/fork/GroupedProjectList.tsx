"use client";

/**
 * fork:zc-11 + fork:zm-06 — 侧栏项目列表的「用户分组 + 拖拽排序」渲染层。
 *
 * WHY：项目行原来直接 `visibleProjects.map(...)` 平铺；用户要把项目归到自建分组里、
 * 并手动调整顺序。这个组件把分组表（`lib/session-groups.ts`）翻译成可拖拽的 DOM：
 *
 * - 分组行可折叠、可改名、可删除；空分组保留，作为拖拽落点；
 * - 拖拽源是**项目标题行本身**（通过 `useProjectDrag` 注入 `draggable` 与事件），
 *   不是整个项目节点 —— 展开的会话列表里选择文字不会误触发排序；
 * - 拖到另一个项目行上 = 排到它前面并跟随它所在的分组；拖到分组头上 = 加入该组；
 *   拖到底部的「移出分组」区 = 回到未分组；
 * - 每次重排 / 折叠后，用 `lib/flip-animate.ts` 做 FLIP：元素从旧位置飞到新位置，
 *   而不是瞬移（fork:zm-06）。reduced-motion / SSR / jsdom 下整体跳过。
 *
 * 输入数据是 `RecentProject` 形状的最小约束（`{ key }`），排序/分组全部由纯函数完成，
 * 组件本身不读 localStorage（store 由 SessionSidebar 传入），便于测试与复用。
 *
 * 视觉沿用 SessionSidebar 的内联样式 + CSS 变量 + `TEXT`，不引入 Tailwind。
 */

import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useI18n } from "@/hooks/useI18n";
// fork:v5-wave-b —— 窄屏（≤640）用 PWA 形态的类；d-* 只在 ≥641 生效。
import { useIsMobile } from "@/hooks/useIsMobile";
import { animateFlip, diffFlip, type ElementRect, type FlipSnapshot } from "@/lib/flip-animate";
import {
  groupProjects,
  type SessionGroup,
  type SessionGroupsStore,
} from "@/lib/session-groups";

export interface GroupedProjectListProps<T extends { key: string }> {
  /** 项目列表（默认顺序由调用方给，组件按存储的 order 重排）。 */
  projects: readonly T[];
  /** `useSessionGroups()` 返回的 store（state + actions）。 */
  store: SessionGroupsStore;
  /** 单个项目的完整节点（含自身展开的会话列表），由 SessionSidebar 提供。 */
  renderProject: (project: T) => ReactNode;
}

const ROW_HEIGHT = 28;

interface ProjectDragContextValue {
  draggingKey: string | null;
  dropKey: string | null;
  begin: (event: React.DragEvent, projectKey: string) => void;
  end: () => void;
}

const ProjectDragContext = createContext<ProjectDragContextValue | null>(null);

export interface ProjectDragHandle {
  draggable: boolean;
  dragging: boolean;
  dropActive: boolean;
  onDragStart: (event: React.DragEvent) => void;
  onDragEnd: () => void;
}

/**
 * fork:zc-11 — 项目标题行用的拖拽句柄。
 *
 * 只有渲染在 `GroupedProjectList` 内的项目标题行会拿到真实句柄（来自 context）；
 * 其它上下文（单测、复用）返回禁用态，组件不需要自己判断是否存在分组列表。
 */
export function useProjectDrag(projectKey: string): ProjectDragHandle {
  const context = useContext(ProjectDragContext);
  if (!context) {
    return { draggable: false, dragging: false, dropActive: false, onDragStart: () => {}, onDragEnd: () => {} };
  }
  return {
    draggable: true,
    dragging: context.draggingKey === projectKey,
    dropActive: context.dropKey === projectKey,
    onDragStart: (event: React.DragEvent) => context.begin(event, projectKey),
    onDragEnd: context.end,
  };
}

export function GroupedProjectList<T extends { key: string }>({
  projects,
  store,
  renderProject,
}: GroupedProjectListProps<T>) {
  const { t } = useI18n();
  const sections = useMemo(() => groupProjects(projects, store.state), [projects, store.state]);
  // fork:v5-wave-b —— 窄屏形态判据（≤640，与 pwa/system.css 的 @import 媒体条件同断点）。
  const isPhone = useIsMobile();

  const [dragKey, setDragKey] = useState<string | null>(null);
  const [dropKey, setDropKey] = useState<string | null>(null);
  const [dropGroupId, setDropGroupId] = useState<string | null>(null);
  const [ungroupDropActive, setUngroupDropActive] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  /* ------------------------------------------------------------------ */
  /* fork:zm-06 — FLIP：每次提交后对比矩形，元素飞向新位置。               */
  /* ------------------------------------------------------------------ */

  const flipNodesRef = useRef(new Map<string, HTMLElement>());
  const listRootRef = useRef<HTMLDivElement | null>(null);
  const previousRectsRef = useRef<FlipSnapshot | null>(null);
  const flipAnimationsRef = useRef<Animation[]>([]);

  const registerFlipNode = useCallback((key: string) => (node: HTMLElement | null) => {
    if (node) flipNodesRef.current.set(key, node);
    else flipNodesRef.current.delete(key);
  }, []);

  useLayoutEffect(() => {
    // 动画飞行途中不重新测量：getBoundingClientRect() 会包含当前 transform，
    // 用中间态做快照会让下一次计算从错误的位置起飞。
    if (flipAnimationsRef.current.some((animation) => animation.playState === "running")) return;
    // 以列表容器为原点：外层滚动（用户滚侧栏）不应被误判成「元素移动了」。
    const rootRect = listRootRef.current?.getBoundingClientRect();
    const originTop = rootRect?.top ?? 0;
    const originLeft = rootRect?.left ?? 0;
    const next = new Map<string, ElementRect>();
    flipNodesRef.current.forEach((element, key) => {
      if (!element.isConnected) return;
      const rect = element.getBoundingClientRect();
      next.set(key, {
        top: rect.top - originTop,
        left: rect.left - originLeft,
        width: rect.width,
        height: rect.height,
      });
    });
    const previous = previousRectsRef.current;
    if (previous) {
      const deltas = diffFlip(previous, next);
      if (deltas.length > 0) {
        flipAnimationsRef.current = animateFlip(deltas, (key) => flipNodesRef.current.get(key) ?? null);
      }
    }
    previousRectsRef.current = next;
  });

  const clearDragState = useCallback(() => {
    setDragKey(null);
    setDropKey(null);
    setDropGroupId(null);
    setUngroupDropActive(false);
  }, []);

  const sourceKeyOf = (event: React.DragEvent): string | null => {
    if (dragKey) return dragKey;
    try {
      return event.dataTransfer.getData("text/plain") || null;
    } catch {
      return null;
    }
  };

  const beginDrag = useCallback((event: React.DragEvent, projectKey: string) => {
    event.dataTransfer.effectAllowed = "move";
    try {
      event.dataTransfer.setData("text/plain", projectKey);
    } catch {
      // 某些浏览器在 dragstart 之外不暴露 dataTransfer；dragKey state 仍是兜底。
    }
    setDragKey(projectKey);
  }, []);

  const dragContext = useMemo<ProjectDragContextValue>(
    () => ({ draggingKey: dragKey, dropKey, begin: beginDrag, end: clearDragState }),
    [dragKey, dropKey, beginDrag, clearDragState],
  );

  const overProject = (projectKey: string) => {
    if (dropKey !== projectKey) setDropKey(projectKey);
    if (dropGroupId !== null) setDropGroupId(null);
  };

  const dropOnProject = (event: React.DragEvent, targetKey: string) => {
    event.preventDefault();
    const source = sourceKeyOf(event);
    const groupId = store.state.assignments[targetKey] ?? null;
    clearDragState();
    if (!source || source === targetKey) return;
    store.moveProject({ projectKey: source, beforeKey: targetKey, groupId });
  };

  const dropOnGroup = (event: React.DragEvent, groupId: string) => {
    event.preventDefault();
    const source = sourceKeyOf(event);
    clearDragState();
    if (!source) return;
    store.moveProject({ projectKey: source, beforeKey: null, groupId });
  };

  const dropOnUngrouped = (event: React.DragEvent) => {
    event.preventDefault();
    const source = sourceKeyOf(event);
    clearDragState();
    if (!source) return;
    store.moveProject({ projectKey: source, beforeKey: null, groupId: null });
  };


  const commitRename = (id: string) => {
    store.renameGroup(id, renameValue);
    setRenamingId(null);
  };

  const draggingGrouped = Boolean(dragKey && store.state.assignments[dragKey]);

  const renderProjectRow = (project: T) => (
    <div
      key={project.key}
      ref={registerFlipNode(`project:${project.key}`)}
      data-fork-project-row={project.key}
      onDragOver={(event) => {
        event.preventDefault();
        overProject(project.key);
      }}
      onDrop={(event) => dropOnProject(event, project.key)}
      style={{ borderRadius: "var(--nx-r-md)" }}
    >
      {renderProject(project)}
    </div>
  );

  return (
    <ProjectDragContext.Provider value={dragContext}>
      <div ref={listRootRef} data-fork-grouped-projects="true" style={{ display: "flex", flexDirection: "column", gap: "var(--space-hair)" }}>
        {sections.map((section) => {
          const group = section.group;
          if (!group) {
            return (
              <div key="__ungrouped" style={{ display: "flex", flexDirection: "column", gap: "var(--space-hair)" }}>
                {section.projects.map(renderProjectRow)}
              </div>
            );
          }
          return (
            <div key={group.id} style={{ display: "flex", flexDirection: "column", gap: "var(--space-hair)" }}>
              <GroupHeader
                group={group}
                count={section.projects.length}
                dropActive={dropGroupId === group.id}
                renaming={renamingId === group.id}
                renameValue={renameValue}
                registerFlipNode={registerFlipNode}
                onRenameValue={setRenameValue}
                onToggle={() => store.toggleGroupCollapsed(group.id)}
                onBeginRename={() => {
                  setRenamingId(group.id);
                  setRenameValue(group.name);
                }}
                onCommitRename={() => commitRename(group.id)}
                onCancelRename={() => setRenamingId(null)}
                onDelete={() => store.deleteGroup(group.id)}
                onDragOver={(event) => {
                  event.preventDefault();
                  if (dropGroupId !== group.id) setDropGroupId(group.id);
                  if (dropKey) setDropKey(null);
                }}
                onDrop={(event) => dropOnGroup(event, group.id)}
              />
              {!group.collapsed && section.projects.map(renderProjectRow)}
            </div>
          );
        })}

        {/* fork:zc-11 — 拖拽中的已分组项目需要一个「回到未分组」的落点；
            没有它，用户只能先拖出组再拖回来。
            fork:v5-landing —— 落区用画板 D-02d 的 `.d-drop`（虚线 / 强调底 / 居中在
            system.css），行内只留「挤成侧栏一行」这一档几何。
            fork:v5-wave-b —— 窄屏换成 PWA 库里的同义件 `.m-placeholder`（虚线落区）；
            拖放 handler 与状态与桌面一字不差。 */}
        {draggingGrouped && (
          <div
            data-fork-ungroup-drop=""
            onDragOver={(event) => {
              event.preventDefault();
              if (!ungroupDropActive) setUngroupDropActive(true);
            }}
            onDragLeave={() => setUngroupDropActive(false)}
            onDrop={dropOnUngrouped}
            className={isPhone ? "m-placeholder" : `d-drop${ungroupDropActive ? " over" : ""}`}
            style={isPhone ? undefined : { minHeight: ROW_HEIGHT, padding: "var(--nx-sp-2)", flexDirection: "row", gap: "var(--nx-sp-1)" }}
          >
            <i data-ico="inbox" data-size="14"></i>
            <span className={isPhone ? "m-t-sm" : "d-t-sm"}>{t("sidebar.ungroupHint")}</span>
          </div>
        )}

      </div>
    </ProjectDragContext.Provider>
  );
}


/** 分组头：折叠开关 + 名字（可改名）+ 数量 + 悬停操作（改名/删除），并作为拖拽落点。 */
function GroupHeader({
  group,
  count,
  dropActive,
  renaming,
  renameValue,
  registerFlipNode,
  onRenameValue,
  onToggle,
  onBeginRename,
  onCommitRename,
  onCancelRename,
  onDelete,
  onDragOver,
  onDrop,
}: {
  group: SessionGroup;
  count: number;
  dropActive: boolean;
  renaming: boolean;
  renameValue: string;
  registerFlipNode: (key: string) => (node: HTMLElement | null) => void;
  onRenameValue: (value: string) => void;
  onToggle: () => void;
  onBeginRename: () => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  onDelete: () => void;
  onDragOver: (event: React.DragEvent) => void;
  onDrop: (event: React.DragEvent) => void;
}) {
  const { t } = useI18n();
  const [hovered, setHovered] = useState(false);
  // fork:v5-wave-b —— 窄屏形态判据（≤640，与 pwa/system.css 的 @import 媒体条件同断点）。
  const isPhone = useIsMobile();

  // fork:v5-landing —— 分组头照画板 D-02d 帧 B：`.d-group-title` 给行规格，
  // 折叠箭头用直接子 `<i data-ico>`（随折叠态换 chevron），色点是数据驱动的
  // `fork-group-dot--*`（颜色不能内联，见汇报），改名 / 删除是 `.d-iconbtn`。
  if (renaming) {
    // fork:v5-wave-b —— 窄屏改名态 = `.m-group-title` + `.m-input`（同一形状的换皮，
    // 改名 / 提交 / 取消 / 失焦提交四个 handler 不变）。
    if (isPhone) {
      return (
        <div
          ref={registerFlipNode(`group:${group.id}`)}
          data-fork-group-header={group.id}
          onDragOver={onDragOver}
          onDrop={onDrop}
          className="m-group-title"
        >
          <input
            autoFocus
            className="m-input m-grow"
            value={renameValue}
            onChange={(event) => onRenameValue(event.target.value)}
            onBlur={onCommitRename}
            onKeyDown={(event) => {
              if (event.key === "Enter") onCommitRename();
              if (event.key === "Escape") onCancelRename();
            }}
            aria-label={t("sidebar.renameGroup")}
          />
        </div>
      );
    }
    return (
      <div
        ref={registerFlipNode(`group:${group.id}`)}
        data-fork-group-header={group.id}
        onDragOver={onDragOver}
        onDrop={onDrop}
        className="d-group-title"
      >
        <input
          autoFocus
          className="d-input d-grow"
          value={renameValue}
          onChange={(event) => onRenameValue(event.target.value)}
          onBlur={onCommitRename}
          onKeyDown={(event) => {
            if (event.key === "Enter") onCommitRename();
            if (event.key === "Escape") onCancelRename();
          }}
          aria-label={t("sidebar.renameGroup")}
        />
      </div>
    );
  }

  // fork:v5-wave-b —— 窄屏分支照画板 **M-04 帧 A/B** 的分组标题抄 DOM：
  // `.m-group-title` > `.m-row-t`（chevron + 组名 + 数量）+ 行内动作（`.m-row-m` +
  // `.m-iconbtn`）。折叠 / 改名 / 删除 / 拖放 / FLIP 全部原样接回。
  if (isPhone) {
    return (
      <div
        ref={registerFlipNode(`group:${group.id}`)}
        data-fork-group-header={group.id}
        onDragOver={onDragOver}
        onDrop={onDrop}
        className="m-group-title"
      >
        <span
          role="button"
          tabIndex={0}
          onClick={onToggle}
          onKeyDown={(event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            onToggle();
          }}
          aria-expanded={!group.collapsed}
          title={t(group.collapsed ? "session.expandGroup" : "session.collapseGroup")}
          className="m-row-t"
          style={{ cursor: "pointer" }}
        >
          <i data-ico={group.collapsed ? "chevron-right" : "chevron-down"} data-size="12"></i>
          {/* fork:task-groups —— 组色点（数据驱动的 `fork-group-dot--*`），折叠时仍画。 */}
          <span className={`fork-group-dot fork-group-dot--${group.color}`} aria-hidden="true" />
          {group.name}
          <span className="m-row-m">{count}</span>
        </span>
        <span className="m-row-m">
          <button type="button" className="m-iconbtn" onClick={onBeginRename} title={t("sidebar.renameGroup")} aria-label={t("sidebar.renameGroup")}>
            <i data-ico="pencil" data-size="12"></i>
          </button>
          <button type="button" className="m-iconbtn" onClick={onDelete} title={t("sidebar.deleteGroup")} aria-label={t("sidebar.deleteGroup")}>
            <i data-ico="trash-2" data-size="12"></i>
          </button>
        </span>
      </div>
    );
  }

  return (
    <div
      ref={registerFlipNode(`group:${group.id}`)}
      data-fork-group-header={group.id}
      data-active={dropActive ? "true" : undefined}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={`d-group-title${dropActive ? " is-on" : ""}`}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!group.collapsed}
        title={t(group.collapsed ? "session.expandGroup" : "session.collapseGroup")}
        className="d-row d-grow"
      >
        <i data-ico={group.collapsed ? "chevron-right" : "chevron-down"} data-size="12"></i>
        {/* fork:task-groups —— 组色点。折叠状态下名字藏起来了，色点是唯一的身份线索，
            所以它一直画。尺寸跟行内节奏一致，不另立几何。 */}
        <span className={`fork-group-dot fork-group-dot--${group.color}`} aria-hidden="true" />
        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {group.name}
        </span>
      </button>
      <span className="d-t-xs" style={{ flexShrink: 0, minWidth: "var(--icon-sm)", textAlign: "right" }}>{count}</span>
      {/* 行内动作：复用系统里现成的悬停动作组（与消息动作同一件）——
          v5 库里没有单独的「行内动作」类（消息动作件 d-msg-acts 就是它）。 */}
      <span className={`d-msg-acts${hovered || dropActive ? " is-on" : ""}`}>
        <button type="button" className="d-iconbtn" onClick={onBeginRename} title={t("sidebar.renameGroup")} aria-label={t("sidebar.renameGroup")}>
          <i data-ico="pencil" data-size="12"></i>
        </button>
        <button type="button" className="d-iconbtn" onClick={onDelete} title={t("sidebar.deleteGroup")} aria-label={t("sidebar.deleteGroup")}>
          <i data-ico="trash-2" data-size="12"></i>
        </button>
      </span>
    </div>
  );
}

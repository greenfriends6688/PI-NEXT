"use client";

import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import type { BranchPreview, SessionEntry, SessionTreeNode } from "@/lib/types";
import { useI18n } from "@/hooks/useI18n";

interface Props {
  tree: SessionTreeNode[];
  activeLeafId: string | null;
  onLeafChange: (leafId: string | null) => void;
  /** When true, renders as a compact inline button for embedding in a top bar */
  inline?: boolean;
  /** When inline, use this ref's bounding rect to size/position the dropdown */
  containerRef?: React.RefObject<HTMLElement | null>;
  /** Controlled open state for inline mode */
  open?: boolean;
  /** Called when the button is clicked in inline mode */
  onToggle?: () => void;
  /** Whether a session is currently active (used to show appropriate empty reason) */
  hasSession?: boolean;
  /** When inline, render icon-only (no text label) to save horizontal space */
  compact?: boolean;
  /** Keep the inline dropdown mounted while another control supplies its trigger */
  hideInlineButton?: boolean;
}

// Find the visible entry IDs on the path from root to activeLeafId.
// Iterative DFS: a linear session degrades into a chain whose depth equals the
// entry count, so a recursive search overflows the call stack. Walk with an
// explicit stack instead (paths accumulate depth, not the call stack).
export function buildActivePath(nodes: SessionTreeNode[], targetId: string | null): Set<string> {
  if (!targetId) return new Set();
  const target = targetId;
  const stack: { node: SessionTreeNode; path: string[] }[] = nodes.map((n) => ({ node: n, path: [n.entry.id] }));
  while (stack.length > 0) {
    const { node, path } = stack.pop()!;
    if (node.entry.id === target || node.compressedEntryIds?.includes(target)) {
      return new Set(path);
    }
    for (const child of node.children) {
      stack.push({ node: child, path: [...path, child.entry.id] });
    }
  }
  return new Set();
}

// fork:upstream-0.9.2-pi087-transcript — 转写 system 消息装的是 prompt，不是一个回合，不能给分支命名。
function isMessageEntry(entry: SessionEntry): boolean {
  return entry.type === "message" && "message" in entry && entry.message.role !== "system";
}

// Compress a visible linear chain into the first branching/leaf node.
// Server-side compressed IDs also count as skipped nodes.
// branchPreview is the bounded preview of the first message on the source
// chain. labelEntry keeps unprojected/test shapes working as a fallback.
export function compressChain(node: SessionTreeNode): {
  node: SessionTreeNode;
  skipped: number;
  branchPreview?: BranchPreview;
  labelEntry: SessionEntry;
} {
  let current = node;
  let branchPreview = current.branchPreview;
  let labelEntry: SessionEntry | null = isMessageEntry(current.entry) ? current.entry : null;
  let skipped = current.compressedEntryIds?.length ?? 0;
  while (current.children.length === 1) {
    current = current.children[0];
    branchPreview ??= current.branchPreview;
    if (!labelEntry && isMessageEntry(current.entry)) labelEntry = current.entry;
    skipped += 1 + (current.compressedEntryIds?.length ?? 0);
  }
  return { node: current, skipped, branchPreview, labelEntry: labelEntry ?? current.entry };
}

// Top-level rows of the panel: with multiple roots (a branch was started from
// the very first message) the roots themselves are the branches; otherwise the
// children of the first branching node.
export function selectTopLevelBranches(tree: SessionTreeNode[]): SessionTreeNode[] {
  if (tree.length > 1) return tree;
  if (tree.length === 0) return [];
  const first = compressChain(tree[0]).node;
  return first.children.length > 1 ? first.children : [];
}

function getLabel(entry: SessionEntry): string {
  if (entry.type === "message" && "message" in entry) {
    const msg = entry.message as { role: string; content: unknown };
    const content = msg.content;
    let text = "";
    if (typeof content === "string") {
      text = content;
    } else if (Array.isArray(content)) {
      text = content
        .filter((b): b is { type: "text"; text: string } => b.type === "text")
        .map((b) => b.text)
        .join(" ");
    }
    if (text.length > 40) text = text.slice(0, 40) + "…";
    if (text) return text;
    if (msg.role === "assistant") return "[assistant]";
  }
  return entry.type;
}

// Does the tree have any branching at all? Iterative: a linear chain has no
// branching but recursing over it would overflow the stack, so walk with a stack.
export function hasSessionBranches(nodes: SessionTreeNode[]): boolean {
  // Sessions branched from the very first message have multiple root nodes.
  if (nodes.length > 1) return true;
  const stack: SessionTreeNode[] = [...nodes];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.children.length > 1) return true;
    for (const child of node.children) stack.push(child);
  }
  return false;
}

interface TreeNodeProps {
  node: SessionTreeNode;
  activePathIds: Set<string>;
  depth: number;
  isLast: boolean;
  parentLines: boolean[]; // whether ancestor at each depth has more siblings after
  onSelect: (id: string) => void;
}

/** 缩进一格 16px；树线固定在这一格的左 7px 处。 */
const BRANCH_GUIDE_WIDTH = 16;
/** fix:branch-popover —— 浮层宽度取画板 22 的 `.pw-pop`（320），不再跟随触发点。 */
const BRANCH_MENU_WIDTH = 320;

function TreeNodeView({ node, activePathIds, depth, isLast, parentLines, onSelect }: TreeNodeProps) {
  const { node: rep, skipped, branchPreview, labelEntry } = compressChain(node);
  const isActive = activePathIds.has(rep.entry.id);
  const isOnPath = activePathIds.has(node.entry.id) || activePathIds.has(rep.entry.id);
  const label = branchPreview?.text ?? getLabel(labelEntry);
  const role = branchPreview
    ? branchPreview.role ?? null
    : isMessageEntry(labelEntry)
      ? (labelEntry as { message: { role: string } }).message.role
      : null;

  return (
    <div>
      {/* fork:design-system —— 行本体是画板的 `.pw-row` 语义（26px / radius-4 /
          hover 6% / 选中 accent 淡底）。原来这一行是**不可聚焦的 div**、没有 hover
          底、颜色走的是旧 token（`--border` / `--bg-hover`），点起来既没反馈也够
          不到键盘。这里换成 button，视觉与 hover / 选中态全部来自 fork-ui.css 的
          `.pw-branch-row`（值仍然只有一个来源：board.css 的 `.pw-row` / `.pw-prow`）。 */}
      <button
        type="button"
        onClick={() => onSelect(rep.entry.id)}
        aria-current={isActive ? "true" : undefined}
        title={label}
        className={`pw-branch-row${isActive ? " is-on" : ""}`}
      >
        {/* Indent guide lines */}
        {parentLines.map((hasLine, i) => (
          <span key={i} className="pw-branch-guide" style={{ width: BRANCH_GUIDE_WIDTH }} data-line={hasLine ? "" : undefined} />
        ))}

        {/* Branch connector */}
        <span
          className="pw-branch-guide"
          style={{ width: BRANCH_GUIDE_WIDTH }}
          data-line=""
          data-elbow={isLast ? "last" : "mid"}
        />

        {/* Node dot */}
        <span className="pw-branch-dot" data-state={isActive ? "on" : isOnPath ? "path" : "off"} />

        {/* Role badge */}
        {role && (
          <span className="pw-branch-role" data-role={role}>
            {role === "user" ? "U" : "A"}
          </span>
        )}

        {/* Skipped indicator */}
        {skipped > 0 && <span className="pw-branch-skip">+{skipped}</span>}

        {/* Label */}
        <span className="pw-branch-label">{label}</span>
      </button>

      {/* Children */}
      {rep.children.map((child, idx) => (
        <TreeNodeView
          key={child.entry.id}
          node={child}
          activePathIds={activePathIds}
          depth={depth + 1}
          isLast={idx === rep.children.length - 1}
          parentLines={[...parentLines, !isLast]}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

export function BranchNavigator({ tree, activeLeafId, onLeafChange, inline, containerRef, open: openProp, onToggle, hasSession, compact, hideInlineButton }: Props) {
  const { t } = useI18n();
  const [openInternal, setOpenInternal] = useState(false);
  const open = openProp !== undefined ? openProp : openInternal;
  const btnRef = useRef<HTMLButtonElement>(null);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null);

  // fix:branch-popover —— 浮层定位：宽度取画板 22 的 320（**不再**取触发点宽度，
  // 芯片只有 ~90px 宽，跟随之浮窗被压成一条缝还溢出横向滚动条）；上缘贴触发点下沿
  // +6，右缘越界时把左缘收回来；高度按剩余视口给，长树自滚。
  useEffect(() => {
    if (!open || !inline) return;
    const anchor = containerRef?.current ?? btnRef.current;
    if (!anchor) return;
    const update = () => {
      const rect = anchor.getBoundingClientRect();
      const width = Math.min(BRANCH_MENU_WIDTH, window.innerWidth - 16);
      const top = rect.bottom + 6;
      setDropdownPos({
        top,
        left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
        width,
        maxHeight: Math.max(200, window.innerHeight - top - 16),
      });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(anchor);
    window.addEventListener("resize", update);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [open, inline, containerRef]);

  const activePathIds = useMemo(
    () => buildActivePath(tree, activeLeafId),
    [tree, activeLeafId]
  );

  const handleSelect = useCallback((id: string) => {
    onLeafChange(id);
  }, [onLeafChange]);

  const noBranchReason = !hasSession
    ? t("i18n.noActiveSession")
    : !hasSessionBranches(tree)
      ? t("i18n.noBranches")
      : null;

  const topLevel = selectTopLevelBranches(tree);
  const hasContent = !noBranchReason && topLevel.length > 0;

  // fork:design-components —— 会话分支 ≠ Git 分支：图标换皮肤 lucide 的 git-fork
  //（分叉形态），与顶栏左侧 git-branch 的「main」芯片在视觉上区分开。
  const branchIcon = (
    <span
      className="pw-ico"
      style={{ color: hasContent ? "var(--accent)" : "var(--text-dim)", display: "inline-flex", flexShrink: 0 }}
    >
      <i data-ico="git-fork" data-size="14"></i>
    </span>
  );

  // fork:design-components —— 手绘 chevron 换皮肤 lucide（图标纪律：手绘 SVG 清零）。
  const chevron = (
    <span
      className="pw-ico"
      style={{
        marginLeft: "var(--space-tight)",
        color: "var(--text-dim)",
        transform: open ? "rotate(180deg)" : "none",
        transition: "transform 0.15s",
      }}
    >
      <i data-ico="chevron-down" data-size="10"></i>
    </span>
  );


  if (inline) {
    return (
      <div style={{ display: "flex", alignItems: "center" }}>
        {/* fork:design-system —— 触发点是画板 02 帧 B 的 `.pw-chipbtn`（24px /
            radius-4 / muted，hover 抬色）；激活档挂 `is-on`。原来是自己写的一套
            28px 高、`--bg-selected` 底的盒子，与同一行其它图标按钮不是同一个高度，
            看起来「间距不齐」。 */}
        <button
          ref={btnRef}
          onClick={() => onToggle ? onToggle() : setOpenInternal((v) => !v)}
          className={`${compact ? "pw-iconbtn" : "pw-chipbtn"}${open ? " is-on" : ""}`}
          style={{ display: hideInlineButton ? "none" : undefined }}
          title={t("i18n.branches")}
          aria-label={t("i18n.branches")}
          aria-expanded={open}
          aria-pressed={open}
        >
          {branchIcon}
          {!compact && <span>{t("i18n.branches")}</span>}
          {!compact && chevron}
        </button>
        {open && dropdownPos && (
          // fix:branch-popover —— 浮窗 = 画板 22 的 `.pw-pop`（320 宽 / 圆角 6 /
          // 唯一一种阴影 / 1px 描边）。面板自己成列：标题行固定，树体自滚。
          <div
            className="anim-popover-down"
            style={{
              position: "fixed",
              top: dropdownPos.top,
              left: dropdownPos.left,
              width: dropdownPos.width,
              maxHeight: dropdownPos.maxHeight,
              zIndex: 500,
              display: "flex",
            }}
          >
            <div className="pw-pop" style={{ display: "flex", flexDirection: "column", width: "100%", maxHeight: "100%", padding: "var(--s1)" }}>
              <div className="pw-pop-title">{t("i18n.branches")}</div>
              {hasContent ? (
                <div style={{ minHeight: 0, overflowY: "auto", overscrollBehavior: "contain", padding: "0 var(--s1) var(--s1)" }}>
                  {topLevel.map((child, idx) => (
                    <TreeNodeView
                      key={child.entry.id}
                      node={child}
                      activePathIds={activePathIds}
                      depth={0}
                      isLast={idx === topLevel.length - 1}
                      parentLines={[]}
                      onSelect={handleSelect}
                    />
                  ))}
                </div>
              ) : (
                <div className="pw-prow"><span className="pw-desc">{noBranchReason}</span></div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ borderBottom: "1px solid var(--n-border-subtle)", background: "var(--surface-canvas)", flexShrink: 0, position: "relative" }}>
      {/* Header toggle */}
      <button
        onClick={() => setOpenInternal((v) => !v)}
        className="pw-chipbtn"
        style={{ width: "100%", justifyContent: "flex-start", color: "var(--n-muted)" }}
      >
        {branchIcon}
        <span>{t("i18n.branches")}</span>
        {chevron}
      </button>

      {/* Tree panel - overlay */}
      {open && (
        <div style={{
          position: "absolute",
          top: "100%",
          left: 0,
          right: 0,
          background: "var(--surface-canvas)",
          borderBottom: "1px solid var(--n-border-subtle)",
          boxShadow: "var(--shadow-popover)",
          zIndex: 100,
        }}>
          {hasContent ? (
            <div style={{ padding: "0 var(--s1) var(--s1)", maxHeight: 260, overflowY: "auto" }}>
              {topLevel.map((child, idx) => (
                <TreeNodeView
                  key={child.entry.id}
                  node={child}
                  activePathIds={activePathIds}
                  depth={0}
                  isLast={idx === topLevel.length - 1}
                  parentLines={[]}
                  onSelect={handleSelect}
                />
              ))}
            </div>
          ) : (
            <div className="pw-prow"><span className="pw-desc">{noBranchReason ?? t("i18n.noBranches")}</span></div>
          )}
        </div>
      )}
    </div>
  );
}

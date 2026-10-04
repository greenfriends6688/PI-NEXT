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
  onSelect: (id: string) => void;
}

/** 缩进一格 18px（画板 D-02b 帧 C 的树用 `.d-trow.l1` 那套缩进，不用导线）。 */
const BRANCH_INDENT = 18;
/** fix:branch-popover —— 浮层宽度取画板 D-02b 帧 C 的 `.d-pop-float`（320），不再跟随触发点。 */
const BRANCH_MENU_WIDTH = 320;

/* fork:v5-landing —— 行原子 = 画板 D-02b 帧 C 的 `.d-trow`：图标按角色给
   （用户 message-circle / 助手 sparkles / 续接 corner-down-right），标签 `d-grow`，
   角色徽章与「+N」压平徽章都是 `d-badge mute`。缩进用内联 padding-left（几何值）。
   旧的导线 / 节点圆点 / 自绘 `pw-branch-*` 家族随换皮退场。 */
function TreeNodeView({ node, activePathIds, depth, onSelect }: TreeNodeProps) {
  const { node: rep, skipped, branchPreview, labelEntry } = compressChain(node);
  const isActive = activePathIds.has(rep.entry.id);
  const label = branchPreview?.text ?? getLabel(labelEntry);
  const role = branchPreview
    ? branchPreview.role ?? null
    : isMessageEntry(labelEntry)
      ? (labelEntry as { message: { role: string } }).message.role
      : null;
  const roleIcon = role === "user" ? "message-circle" : role === "assistant" ? "sparkles" : "corner-down-right";

  return (
    <div>
      <button
        type="button"
        onClick={() => onSelect(rep.entry.id)}
        aria-current={isActive ? "true" : undefined}
        title={label}
        className={`d-trow${isActive ? " is-on" : ""}`}
        style={{ paddingLeft: 8 + depth * BRANCH_INDENT }}
      >
        <i data-ico={roleIcon} data-size="13" aria-hidden="true"></i>
        <span className="d-grow">{label}</span>
        {role && <span className="d-badge mute">{role === "user" ? "U" : "A"}</span>}
        {skipped > 0 && <span className="d-badge mute">+{skipped}</span>}
      </button>

      {rep.children.map((child) => (
        <TreeNodeView
          key={child.entry.id}
          node={child}
          activePathIds={activePathIds}
          depth={depth + 1}
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

  // fix:branch-popover —— 浮层定位：宽度取画板 D-02b 帧 C 的 320（**不再**取触发点宽度，
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
    <i
      data-ico="git-fork"
      data-size="14"
      aria-hidden="true"
      style={{ color: hasContent ? "var(--nx-accent)" : "var(--nx-text-3)", flexShrink: 0 }}
    ></i>
  );

  // fork:design-components —— 手绘 chevron 换皮肤 lucide（图标纪律：手绘 SVG 清零）。
  const chevron = (
    <i
      data-ico="chevron-down"
      data-size="10"
      aria-hidden="true"
      style={{
        color: "var(--nx-text-3)",
        transform: open ? "rotate(180deg)" : "none",
        transition: "transform 0.15s",
      }}
    ></i>
  );

  if (inline) {
    return (
      <div className="d-row">
        {/* fork:design-system —— 触发点是画板 02 帧 B 的 `.d-chipbtn`（24px /
            radius-4 / muted，hover 抬色）；激活档挂 `is-on`。compact 时退成 `.d-iconbtn`。 */}
        <button
          ref={btnRef}
          onClick={() => onToggle ? onToggle() : setOpenInternal((v) => !v)}
          className={`${compact ? "d-iconbtn" : "d-chipbtn"}${open ? " is-on" : ""}`}
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
          // fix:branch-popover —— 浮窗 = 画板 D-02b 帧 C 的 `.d-pop-float`
          //（320 宽 / 圆角 / 唯一一种阴影 / 1px 描边）。面板自己成列：标题行固定，树体自滚。
          <div
            className="anim-popover-down d-pop-float"
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
            <div className="d-col" style={{ display: "flex", flexDirection: "column", width: "100%", maxHeight: "100%", gap: 0 }}>
              <div className="d-pop-title">{t("i18n.branches")}</div>
              {hasContent ? (
                <div className="d-scroll" style={{ minHeight: 0, overscrollBehavior: "contain", padding: "0 var(--nx-sp-1) var(--nx-sp-1)" }}>
                  {topLevel.map((child) => (
                    <TreeNodeView
                      key={child.entry.id}
                      node={child}
                      activePathIds={activePathIds}
                      depth={0}
                      onSelect={handleSelect}
                    />
                  ))}
                </div>
              ) : (
                <div className="d-menu-row" style={{ cursor: "default" }}><span className="d-t-faint">{noBranchReason}</span></div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="d-col" style={{ flexShrink: 0, position: "relative", gap: 0 }}>
      {/* Header toggle */}
      <button
        onClick={() => setOpenInternal((v) => !v)}
        className="d-chipbtn"
        style={{ width: "100%", justifyContent: "flex-start" }}
      >
        {branchIcon}
        <span>{t("i18n.branches")}</span>
        {chevron}
      </button>

      {/* Tree panel - overlay */}
      {open && (
        <div
          className="d-pop is-open"
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            zIndex: 100,
          }}
        >
          {hasContent ? (
            <div className="d-scroll" style={{ padding: "0 var(--nx-sp-1) var(--nx-sp-1)", maxHeight: 260 }}>
              {topLevel.map((child) => (
                <TreeNodeView
                  key={child.entry.id}
                  node={child}
                  activePathIds={activePathIds}
                  depth={0}
                  onSelect={handleSelect}
                />
              ))}
            </div>
          ) : (
            <div className="d-menu-row" style={{ cursor: "default" }}><span className="d-t-faint">{noBranchReason ?? t("i18n.noBranches")}</span></div>
          )}
        </div>
      )}
    </div>
  );
}

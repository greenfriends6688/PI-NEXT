"use client";

import { useRef, type ReactNode } from "react";
import { useContextMenu, type ContextMenuEntry } from "../ContextMenu";
import { getFileName } from "@/lib/file-paths";
import { useI18n } from "@/hooks/useI18n";

/*
 * fork:ui-projectchip — "this chat runs in <workspace>" selector on the new-session
 * page (MusePi `WelcomeComposer.tsx:1202-1300` parity).
 *
 * Same capability as the sidebar's NewTaskPicker, moved next to the composer so the
 * target is visible — and changeable — while the first message is being written. The
 * sidebar entry is a 26px chevron beside 新建任务 that users only find once they already
 * know it exists.
 *
 * The dropdown is the shared ContextMenu (the one floating-layer entry point in this
 * app): it already provides keyboard navigation, Escape, outside-click dismissal,
 * viewport clamping, separators and the checked row, so nothing is hand-rolled here.
 *
 * Removal stays in the sidebar project context menu — this selector only switches and
 * creates targets, exactly like the reference.
 */

export interface NewSessionProject {
  key: string;
  root: string;
  name: string;
}

export interface NewSessionTargets {
  /** Known projects, most recent first. The chat workspace is already excluded. */
  projects: NewSessionProject[];
  /** Chat workspace directory used for "not in a project". */
  chatPath: string | null;
  /** Target cwd of the pending draft session. */
  activeCwd: string | null;
  /** Inline failure text (folder validation / blank-project creation). */
  error?: string | null;
  /** Re-read the chat workspace before the menu opens: the sidebar can change it. */
  onRefresh?: () => void;
  onPickProject: (project: NewSessionProject) => void;
  onPickChat: () => void;
  onOpenFolder: () => void;
  /** fork:ui-ctxbar —— 上方上下文条的分支芯片点开工作区（worktree）列表后选中另一个。 */
  onPickWorkspace: (path: string, projectRoot: string | null) => void;
}

type Translate = (key: string, params?: Record<string, string | number>) => string;

/** Which row gets the check mark. Compared the way the sidebar does it — for display. */
export function resolveActiveTarget(
  targets: Pick<NewSessionTargets, "projects" | "chatPath" | "activeCwd">,
): { activeProject: NewSessionProject | null; activeChat: boolean } {
  const cwd = targets.activeCwd ?? null;
  if (!cwd) return { activeProject: null, activeChat: false };
  const activeProject = targets.projects.find((project) => project.root === cwd) ?? null;
  return {
    activeProject,
    activeChat: !activeProject && Boolean(targets.chatPath) && targets.chatPath === cwd,
  };
}

/* fork:design-components 判据⑦ —— 这四个字以前是手绘 SVG（folder / folder-open /
   message-square / chevron-down 的近似形），违反「图标一律 lucide，经 `<i data-ico>`
   由 PwIcons 水合，禁手绘 SVG」。现在返回的就是那个 `<i>`：`.pw-ico` 壳由宿主给
   （ContextMenu 的行已经包了 `.pw-ico`；芯片本身那两处自带壳）。 */
function BoardIcon({ name, size = 14 }: { name: string; size?: number }): ReactNode {
  return <i data-ico={name} data-size={size} aria-hidden="true"></i>;
}

function FolderIcon(): ReactNode {
  return <BoardIcon name="folder" />;
}

function OpenFolderIcon(): ReactNode {
  return <BoardIcon name="folder-open" />;
}

function ChatIcon(): ReactNode {
  return <BoardIcon name="message-square" />;
}

function ChevronIcon(): ReactNode {
  return <BoardIcon name="chevron-down" size={12} />;
}

/**
 * Menu rows: the current target (checked, label only) → the other projects → separator
 * → open folder / new blank project / not in a project. The active row is not repeated
 * as an action, so switching away and back never shows the same label twice.
 */
export function buildTargetItems(
  targets: NewSessionTargets,
  active: { activeProject: NewSessionProject | null; activeChat: boolean },
  t: Translate,
): ContextMenuEntry[] {
  // fork:ui-projectchip-fix — 列表**不再把当前项抽到顶上**：抽走之后点过的那一行会消失，
  // 用户看不到「我选了哪个」（原来的 checked 行还不是可点的动作）。现在所有项目都留在原位，
  // 当前项打勾并禁用，点其它行就切过去。
  const items: ContextMenuEntry[] = [];

  if (!active.activeProject && active.activeChat) {
    items.push({
      label: t("sidebar.newTaskNoProject"),
      title: targets.chatPath ?? undefined,
      checked: true,
    });
  } else if (!active.activeProject && targets.activeCwd) {
    items.push({ label: getFileName(targets.activeCwd), title: targets.activeCwd, checked: true });
  }

  for (const project of targets.projects) {
    const isActive = active.activeProject?.key === project.key;
    items.push({
      label: project.name,
      title: project.root,
      icon: <FolderIcon />,
      ...(isActive ? { checked: true, disabled: true } : {}),
      onSelect: () => targets.onPickProject(project),
    });
  }

  items.push({ type: "separator" });
  // 「打开文件夹」= 系统默认的文件夹选择器（见 lib/pick-directory.ts）。
  items.push({ label: t("home.openFolder"), icon: <OpenFolderIcon />, onSelect: () => targets.onOpenFolder() });
  if (!active.activeChat) {
    items.push({
      label: t("sidebar.newTaskNoProject"),
      icon: <ChatIcon />,
      disabled: !targets.chatPath,
      title: targets.chatPath ?? undefined,
      onSelect: () => targets.onPickChat(),
    });
  }
  return items;
}

export function ProjectChip({ targets }: { targets: NewSessionTargets }): ReactNode {
  const { t } = useI18n();
  const { openMenu } = useContextMenu();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const active = resolveActiveTarget(targets);
  const label = active.activeProject?.name
    ?? (active.activeChat ? t("sidebar.newTaskNoProject") : targets.activeCwd ? getFileName(targets.activeCwd) : t("sidebar.newTaskNoProject"));

  const open = (): void => {
    targets.onRefresh?.();
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    // Anchor below the chip; ContextMenu clamps to the viewport, so a chip sitting
    // just above the composer opens upward instead of running off the bottom edge.
    openMenu(rect.left, rect.bottom + 6, buildTargetItems(targets, active, t));
  };

  return (
    // fork:design-components —— 新会话的工作区选择 = 画板 20 的 .pw-chip：
    // 它是输入框**内部**的一枚芯片（画板 20「附件与引用」的 .pw-chips 行），
    // 不再是输入框上方另起的一条横条。
    // fork:no-chip-accent（用户 2026-10-01）—— 原来是 `pw-chip accent`：accent 描边 +
    // accent 淡底 + accent 文字（画板 20 里那是「有引用上下文」的高亮态）。工作区芯片
    // 常驻，一眼看着像默认态被点亮 —— 现在用中性 `.pw-chip`，高亮仍归引用芯片。
    <button
      ref={buttonRef}
      type="button"
      onClick={open}
      title={targets.activeCwd ?? undefined}
      aria-label={t("home.workspaceTarget")}
      aria-haspopup="menu"
      className="pw-chip"
      style={{ maxWidth: "min(100%, 260px)", cursor: "pointer" }}
    >
      {/* fork:design-components 判据⑦ —— 图标壳用画板的 `.pw-ico`（line-height 归零 +
          与文字垂直居中，check-align 的口径），不再自写 display:flex / opacity 包壳。 */}
      <span className="pw-ico">
        {active.activeChat ? <ChatIcon /> : <FolderIcon />}
      </span>
      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {label}
      </span>
      <span className="pw-ico"><ChevronIcon /></span>
    </button>
  );
}

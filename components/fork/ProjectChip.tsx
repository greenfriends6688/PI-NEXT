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
 *
 * fork:v5-wave-b —— **有意不加 m-* 分支**：这一枚是输入框上方的「当前工作区」芯片，
 * 对应画板 D-04；PWA 库里最接近的 `.m-chipbtn` 是**能力芯片**（模型 / 思考 / 权限，
 * 见 M-01 帧 A 输入卡那行），语义不同 —— 同一块屏上摆两种芯片会被读成「两个同类入口」。
 * 所以窄屏仍走 `.d-chipbtn`，登记为缺件（设计侧若定「工作区芯片在手机上怎么摆」再补）。
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
   （ContextMenu 的行已经包了壳；v5 芯片按 D-04 把 `<i>` 直接放在 .d-chipbtn 里）。 */
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
      // fork:v5-frame-audit-2026-10-05 —— 当前项行尾那枚「当前」（画板 D-02c 帧 C：
      // `<span class="d-t-xs d-t-faint">当前 · 不可点</span>`）。行本身已经是禁用态。
      hint: t("agentSwitcher.current"),
    });
  } else if (!active.activeProject && targets.activeCwd) {
    items.push({
      label: getFileName(targets.activeCwd),
      title: targets.activeCwd,
      checked: true,
      hint: t("agentSwitcher.current"),
    });
  }

  for (const project of targets.projects) {
    const isActive = active.activeProject?.key === project.key;
    items.push({
      label: project.name,
      title: project.root,
      icon: <FolderIcon />,
      ...(isActive ? { checked: true, disabled: true, hint: t("agentSwitcher.current") } : {}),
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
    openMenu(rect.left, rect.bottom + 6, buildTargetItems(targets, active, t), {
      // fork:v5-frame-audit-2026-10-05 —— 画板 D-02 帧 D「新建任务 · 选在哪里开」与
      // D-02c 帧 C「新建任务选择器」顶部都有一枚分组标题 `.d-pop-title`。
      // 文案用已有 key 拼（“新建任务” + “· 选在哪里开”），不新增 i18n。
      title: `${t("sidebar.newTask")} · ${t("home.workspaceTarget")}`,
      // fork:v5-frame-audit-2026-10-05 —— 搜索头（画板 D-02c 帧 C「新建任务选择器」）：
      // 长菜单顶上那一格 `.d-searchfield`，输入即按项目名过滤行。
      search: {
        placeholder: t("sidebar.filterProjects"),
        match: (label, q) => label.toLowerCase().includes(q),
      },
    });
  };

  return (
    // fork:v5-landing —— 新会话的工作区选择 = 画板 D-04 的 .d-chipbtn：
    // folder 图标 + .d-ctx-name 标签 + chevron-down，芯片常驻中性态。
    <button
      ref={buttonRef}
      type="button"
      onClick={open}
      title={targets.activeCwd ?? undefined}
      aria-label={t("home.workspaceTarget")}
      aria-haspopup="menu"
      className="d-chipbtn"
    >
      {active.activeChat ? <ChatIcon /> : <FolderIcon />}
      <span className="d-ctx-name">{label}</span>
      <ChevronIcon />
    </button>
  );
}

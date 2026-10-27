import type { ReactNode, SVGProps } from "react";

export type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Icon({ size = 16, children, ...props }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

export function IconSearch(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.4-3.4" />
    </Icon>
  );
}

export function IconPlus(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 5v14M5 12h14" />
    </Icon>
  );
}

export function IconPin(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m9 3 6 0-1 7 3 3v2H7v-2l3-3-1-7Z" />
      <path d="M12 15v6" />
    </Icon>
  );
}

export function IconChevronDown(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m6 9 6 6 6-6" />
    </Icon>
  );
}

export function IconChevronRight(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m9 6 6 6-6 6" />
    </Icon>
  );
}

export function IconArrowLeft(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M19 12H5M11 6l-6 6 6 6" />
    </Icon>
  );
}

export function IconChevronUp(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m6 15 6-6 6 6" />
    </Icon>
  );
}

export function IconFolder(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2h8a1.5 1.5 0 0 1 1.5 1.5v8A1.5 1.5 0 0 1 18.5 19h-14A1.5 1.5 0 0 1 3 17.5Z" />
    </Icon>
  );
}

export function IconChat(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M21 12a8.4 8.4 0 0 1-12.2 7.5L4 21l1.6-4.6A8.4 8.4 0 1 1 21 12Z" />
    </Icon>
  );
}

export function IconPanelLeft(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <path d="M9 4v16" />
    </Icon>
  );
}

export function IconFiles(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <path d="M15 4v16" />
    </Icon>
  );
}

export function IconBranch(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="6" cy="6" r="2" />
      <circle cx="6" cy="18" r="2" />
      <circle cx="18" cy="8" r="2" />
      <path d="M6 8v8M18 10v2a4 4 0 0 1-4 4H8" />
    </Icon>
  );
}

export function IconTerminal(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m4 17 6-5-6-5M12 19h8" />
    </Icon>
  );
}

export function IconMore(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="5" cy="12" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1.1" fill="currentColor" stroke="none" />
    </Icon>
  );
}

export function IconPaperclip(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M20 11.5 12 19.5a5 5 0 0 1-7-7l8-8a3.4 3.4 0 0 1 4.8 4.8l-8 8a1.8 1.8 0 0 1-2.6-2.5l7.3-7.3" />
    </Icon>
  );
}

export function IconAt(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="4" />
      <path d="M16 12v1.5a2.5 2.5 0 0 0 5 0V12a9 9 0 1 0-3.5 7.1" />
    </Icon>
  );
}

export function IconArrowUp(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 19V5M5.5 11.5 12 5l6.5 6.5" />
    </Icon>
  );
}

export function IconArrowRight(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </Icon>
  );
}

export function IconSparkle(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 3.5 13.7 9 19 10.7 13.7 12.4 12 18l-1.7-5.6L5 10.7 10.3 9Z" />
      <path d="M19 16.5 19.7 18.6 21.7 19.3 19.7 20 19 22 18.3 20 16.3 19.3 18.3 18.6Z" />
    </Icon>
  );
}

export function IconCheck(props: IconProps) {
  return (
    <Icon {...props} strokeWidth={2.1}>
      <path d="m5 12 4.2 4.2L19 6.4" />
    </Icon>
  );
}

export function IconClock(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </Icon>
  );
}

export function IconSettings(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
      <circle cx="15" cy="7" r="2" />
      <circle cx="9" cy="17" r="2" />
    </Icon>
  );
}

export function IconSun(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4" />
    </Icon>
  );
}

export function IconMoon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />
    </Icon>
  );
}

export function IconClose(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m6 6 12 12M18 6 6 18" />
    </Icon>
  );
}

export function IconFile(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6 3.5h7l4.5 4.5v12.5H6Z" />
      <path d="M13 3.5V8h4.5" />
    </Icon>
  );
}

export function IconList(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M9 6h11M9 12h11M9 18h11" />
      <circle cx="4.5" cy="6" r="1" fill="currentColor" stroke="none" />
      <circle cx="4.5" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="4.5" cy="18" r="1" fill="currentColor" stroke="none" />
    </Icon>
  );
}

export function IconBolt(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M13 2 4.5 13H11l-1 9L19.5 10H13Z" />
    </Icon>
  );
}

export function IconExpand(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M14 4h6v6M20 4l-7 7M10 20H4v-6M4 20l7-7" />
    </Icon>
  );
}

export function IconImage(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3" y="4.5" width="18" height="15" rx="3" />
      <circle cx="8.5" cy="9.5" r="1.5" />
      <path d="m4 17 5-4.5 4 3.5 3-2.5 4 3.5" />
    </Icon>
  );
}

export function IconBrain(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M9.5 4.5A3 3 0 0 0 6.5 7.5a3 3 0 0 0-1.5 5.3 3 3 0 0 0 2.4 4.4 3 3 0 0 0 5.1-.7V6.8a2.3 2.3 0 0 0-3-2.3Z" />
      <path d="M14.5 4.5a3 3 0 0 1 3 3 3 3 0 0 1 1.5 5.3 3 3 0 0 1-2.4 4.4 3 3 0 0 1-5.1-.7" />
    </Icon>
  );
}

export function IconChevrons(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m8 9 4-4 4 4M8 15l4 4 4-4" />
    </Icon>
  );
}

export function IconPencil(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m4 20 4.5-1 10-10a2.1 2.1 0 0 0-3-3l-10 10Z" />
      <path d="m13.5 7.5 3 3" />
    </Icon>
  );
}

export function IconArchive(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3" y="4" width="18" height="4" rx="1.5" />
      <path d="M5 8v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8M10 12h4" />
    </Icon>
  );
}

export function IconTrash(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12" />
      <path d="M10 11v5M14 11v5" />
    </Icon>
  );
}

/** Two branches from one stem: a row's "Fork" (IconBranch is a worktree's branch). */
export function IconFork(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="6" cy="5" r="2.2" />
      <circle cx="18" cy="5" r="2.2" />
      <circle cx="12" cy="19" r="2.2" />
      <path d="M6 7.2v1.8a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3V7.2M12 12v4.6" />
    </Icon>
  );
}

/** An arrow leaving a box: "Open in new tab" (a tab, not a copy). */
export function IconOpenInNewTab(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M14 4h6v6M20 4l-9 9" />
      <path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" />
    </Icon>
  );
}

export function IconPinOff(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m9 3 4.5 0-1 7 3 3v2h-4.5" />
      <path d="M12 15v6" />
      <path d="m3 3 18 18" />
      <path d="M6.5 15H7v-2l1.2-1.2" />
    </Icon>
  );
}

/** Filled dot: "mark as unread". */
export function IconDot(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="5" fill="currentColor" stroke="none" />
    </Icon>
  );
}

/** Hollow dot: "mark as read". */
export function IconDotOutline(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="5" />
    </Icon>
  );
}

/** Git changes: a commit on a line (the files panel's Changes tab). */
export function IconChanges(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M3 12h6M15 12h6" />
    </Icon>
  );
}

/** Archive box with an up arrow: "Unarchive" in the archive view. */
export function IconRestore(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 8h16v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8Z" />
      <path d="M3 4h18v4H3zM12 16v-5M9.5 13.5 12 11l2.5 2.5" />
    </Icon>
  );
}

export function IconUpload(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 16V4M8 8l4-4 4 4" />
      <path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
    </Icon>
  );
}

export function IconRefresh(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M20 12a8 8 0 1 1-2.6-5.9" />
      <path d="M20 4v4h-4" />
    </Icon>
  );
}

/** Ignored files: an eye, off when hidden. */
export function IconEye(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6S2 12 2 12Z" />
      <circle cx="12" cy="12" r="2.6" />
    </Icon>
  );
}

/** A subagent's transcript tab. */
export function IconMessage(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M20 15a2 2 0 0 1-2 2H8l-4 3V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2Z" />
      <path d="M8 9h8M8 12.5h5" />
    </Icon>
  );
}

/** New folder: the files panel's create action. */
export function IconFolderPlus(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
      <path d="M12 11v5M9.5 13.5h5" />
    </Icon>
  );
}

/** A running session's spinner ring; animate it with CSS. */
export function IconSpinner(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 3a9 9 0 1 0 9 9" />
    </Icon>
  );
}

/** Three lines: the top bar's "show sidebar" state. */
export function IconMenu(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 6h18M3 12h18M3 18h18" />
    </Icon>
  );
}

/** A panel with its right column picked out: "show file panel". */
export function IconPanelRight(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M15 3v18" />
    </Icon>
  );
}

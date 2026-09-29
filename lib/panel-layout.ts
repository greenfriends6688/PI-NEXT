export const MOBILE_MAX_WIDTH = 640;
export const SPLIT_PANEL_MIN_WIDTH = 960;

// fork:design-system PR-06 — 侧栏尺寸照设计 §2.2 / tokens.css §11：
// 默认 280px、可拖 220–480。旧值 300 / 232–360 是 Zeno 血统
// （`SHELL_SIDEBAR` 的 300px + 232–360 拖动带）。
export const SIDEBAR_DEFAULT_WIDTH = 280;
export const SIDEBAR_MIN_WIDTH = 220;
export const SIDEBAR_MAX_WIDTH = 480;

/**
 * fork:panel-default-width — the secondary workspace opens with the file tree **and** a
 * document side by side, which needs `EXPLORER_COLUMN_MIN_PANEL_WIDTH` (760px, see
 * AppShell). 384px opened it in a state where the tree took the whole panel and the
 * document was pushed out, so every first visit started with a manual drag.
 *
 * `getResponsiveRightPanelWidth` still clamps this to whatever the viewport allows, so a
 * narrow window does not get an over-wide panel — it gets the largest width that fits.
 */
export const RIGHT_PANEL_FALLBACK_WIDTH = 760;
export const RIGHT_PANEL_MIN_WIDTH = 300;
export const RIGHT_PANEL_MAX_WIDTH = 1200;

const COMPACT_CHAT_MIN_WIDTH = 320;
const DESKTOP_CHAT_MIN_WIDTH = 420;

export function clampPanelWidth(width: number, minWidth: number, maxWidth: number): number {
  const finiteWidth = Number.isFinite(width) ? width : minWidth;
  const effectiveMax = Math.max(minWidth, maxWidth);
  return Math.round(Math.max(minWidth, Math.min(effectiveMax, finiteWidth)));
}

// Codex shows the editor and the file tree side by side inside one pane. The
// pane only splits when it is wide enough to hold both; narrower panes keep the
// single-surface behavior, where the tree yields to the active viewer.
export const PANEL_EXPLORER_WIDTH = 248;
export const PANEL_SPLIT_MIN_WIDTH = 560;

export function getSplitPanelWidth(viewportWidth: number): number {
  return clampPanelWidth(Math.round(viewportWidth * 0.5), PANEL_SPLIT_MIN_WIDTH, 760);
}

/**
 * Comfortable width for the file tree **beside** a document.
 *
 * `AppShell`'s container query (app/fork-ui.css) only gives the tree column from 560px,
 * and between 560 and 759 it falls back to a 200px tree. 760 is where the pair actually
 * looks like a workspace — and it is the same number `EXPLORER_COLUMN_MIN_PANEL_WIDTH`
 * widens to when a document opens.
 */
const TREE_COLUMN_COMFORT_WIDTH = 760;

/**
 * fork:panel-tree-only — 面板打开时默认**只有文件树**（文档要用户点开才会把面板加宽），
 * 所以默认宽度是「一棵树 + 一点留白」，而不是「树 + 文档并排」所需的 760。
 * 打开文档时 `AppShell.handleOpenFile` 会一次性把面板加宽到 760 + 60。
 */
const TREE_ONLY_PANEL_WIDTH = 420;

export function getDefaultRightPanelWidth(viewportWidth: number): number {
  // fork:panel-default-width — 原默认 760 是「树 + 文档并排」的舒适宽度，
  // 但首次打开面板时里面只有树，于是半个窗口被一棵树占着，右边一大片空白。
  // 现在默认给树的宽度，文档打开时再按需加宽；用户自己拖过的宽度照旧优先（见 useResizablePanel）。
  const affordable = viewportWidth - DESKTOP_CHAT_MIN_WIDTH - SIDEBAR_DEFAULT_WIDTH;
  return clampPanelWidth(
    Math.min(TREE_ONLY_PANEL_WIDTH, affordable),
    380,
    TREE_COLUMN_COMFORT_WIDTH,
  );
}

export function getSidebarMaxWidth(options: {
  viewportWidth: number;
  rightPanelOpen: boolean;
  rightPanelWidth: number;
}): number {
  const { viewportWidth, rightPanelOpen, rightPanelWidth } = options;
  if (viewportWidth <= MOBILE_MAX_WIDTH) return SIDEBAR_MAX_WIDTH;

  const compact = viewportWidth < SPLIT_PANEL_MIN_WIDTH;
  const chatWidth = compact ? COMPACT_CHAT_MIN_WIDTH : DESKTOP_CHAT_MIN_WIDTH;
  const visibleRightPanelWidth = !compact && rightPanelOpen ? rightPanelWidth : 0;
  return Math.min(SIDEBAR_MAX_WIDTH, viewportWidth - chatWidth - visibleRightPanelWidth);
}

export function getRightPanelMaxWidth(options: {
  viewportWidth: number;
  sidebarOpen: boolean;
  sidebarWidth: number;
}): number {
  const { viewportWidth, sidebarOpen, sidebarWidth } = options;
  if (viewportWidth < SPLIT_PANEL_MIN_WIDTH) return RIGHT_PANEL_MAX_WIDTH;

  const visibleSidebarWidth = sidebarOpen ? sidebarWidth : 0;
  return Math.min(
    RIGHT_PANEL_MAX_WIDTH,
    viewportWidth - DESKTOP_CHAT_MIN_WIDTH - visibleSidebarWidth,
  );
}

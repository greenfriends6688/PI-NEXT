/**
 * fork:memory-panel — what this fork knows about the pi-memory package.
 *
 * The memory feature is NOT implemented here: `npm:pi-memory` (installed through
 * the plugins API, listed in the official pi package directory) owns it, writes
 * markdown under `<agentDir>/memory/`, and registers its own tools. This module only
 * names the facts the settings page needs, so the string `pi-memory` and the
 * directory name exist in exactly one place.
 */

export const PI_MEMORY_PACKAGE_SOURCE = "npm:pi-memory";
export const MEMORY_DIR_NAME = "memory";
export const PI_MEMORY_DAILY_DIR = "daily";

/**
 * The files pi-memory keeps, in the order the panel lists them. Kept here (not in the
 * route) so the panel can name them and the route can whitelist them from one list —
 * they come from the package source: `MEMORY.md` = durable facts, `SCRATCHPAD.md` =
 * things to come back to, `daily/<date>.md` = the running log it appends to.
 */
export const PI_MEMORY_FILES = ["MEMORY.md", "SCRATCHPAD.md"] as const;

/** Writable by the panel (daily logs are matched by pattern in the route). */
export const PI_MEMORY_WRITABLE: readonly string[] = ["MEMORY.md", "SCRATCHPAD.md"];

/** Starter content, so "create the file" leaves something meaningful behind. */
export const PI_MEMORY_TEMPLATES: Record<string, string> = {
  "MEMORY.md": "# Memory\n\nDurable facts, decisions and preferences. One line per entry, newest at the top.\n",
  "SCRATCHPAD.md": "# Scratchpad\n\nThings to come back to.\n",
};

/** Tools pi-memory registers; used to show "installed but not loaded yet" states. */
export const PI_MEMORY_TOOLS = [
  "memory_write",
  "memory_read",
  "memory_forget",
  "memory_restore",
  "scratchpad",
  "memory_search",
  "memory_status",
] as const;

/**
 * fix:memory-layout（2026-09-30）—— 每个工具一句话说明的 i18n key。
 *
 * 画板 44 的工具列表是 `.pw-litem`：图标 + 名字（`.pw-lname`）+ **一句说明**（`.pw-lsub`）。
 * 之前面板只画名字，把「memory_write / memory_read 存长期事实…」整段挤成列表下面的一行
 * `.pw-hint` —— 行高太矮、说明贴着列表（用户实测「间距特别近」「显示不合理」）。
 * 说明拆进每一行，段落删除。
 */
export const PI_MEMORY_TOOL_HINT_KEYS: Record<(typeof PI_MEMORY_TOOLS)[number], string> = {
  memory_write: "memory.tool.write",
  memory_read: "memory.tool.read",
  memory_forget: "memory.tool.forget",
  memory_restore: "memory.tool.restore",
  scratchpad: "memory.tool.scratchpad",
  memory_search: "memory.tool.search",
  memory_status: "memory.tool.status",
};

/** Search needs the external `qmd` binary; everything else works without it. */
export const PI_MEMORY_SEARCH_HINT_URL = "https://github.com/tobi/qmd";

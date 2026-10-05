export const SETTINGS_SECTION_VALUES = [
  "general",
  "models",
  "skills",
  "agents",
  "plugins",
  // fork:mcp-section — a global section added by this fork.
  "mcp",
  // fork:proma-43-automation — 定时任务（全局，与项目无关）。位置沿用 1ed2708a
  // 删掉的那个 cron 分节：mcp 之后、usage 之前。
  "automation",
  // fork:zc-04 — local usage stats is a global page too.
  "usage",
  // fork:ui-archive-history — 归档历史（Zeno 设置 → 数据 → 归档）。
  "archived",
  // fork:import-ui — 从其它 agent 导入（会话 / 模型 / 技能 / MCP）。
  "import",
  // fork:phone-push — 手机配对 + IM 推送，**合成一栏**（用户 2026-10-03 裁定）。
  "phonePush",
] as const;

export type SettingsSection = (typeof SETTINGS_SECTION_VALUES)[number];
export type SettingsDetailSection = Exclude<SettingsSection, "general">;

const STORAGE_KEY = "pi-web:settings-navigation";
const PROJECT_SECTIONS = new Set<SettingsSection>(["skills", "agents", "plugins"]);

/**
 * 分节清单（单一真值）。
 *
 * 原来这张表内联在 `components/SettingsPanel.tsx` 里，fork:command-palette 要
 * 「面板里能搜到每一个设置分节」就得复制一份 —— 而复制的那份会在有人加分节时
 * 悄悄过期（两处真相源正是 AGENTS.md 反复警告的那类债）。抽到这里之后，
 * 设置侧栏与命令面板读同一份。
 *
 * `labelKey` 存**键**而不是译好的字符串：这张表是模块常量，不能在求值时调
 * `t()`（拿不到 locale），由使用方各自翻译。
 *
 * fork:v5-landing D-07（2026-10-04）—— 每一项的 `labelKey` 现在还负责**左导航那一枚
 * 短标签**，所以键要选成「导航说法」而不是「页头说法」：
 *   · `mcp` 用 `settings.navMcp`（导航写「MCP」，D-15 的页头才写「MCP 服务器」）；
 *   · `general` / `archived` 导航与页头同词（D-07 / D-21：`设置 · 通用`、`设置 · 归档`），
 *     直接用页头那个键。
 * `components/SettingsPanel.boardnav.test.mjs` 把这张表 + `SECTION_ICON_BY_ID` + 分组表
 * 逐项对着画板 D-07 的 `.d-set-nav` 原文验一遍（文案 / 图标名 / 顺序 / 段名）。
 */
export const SETTINGS_SECTIONS: ReadonlyArray<{
  id: SettingsSection;
  labelKey: string;
  requiresProject: boolean;
}> = [
  { id: "general", labelKey: "settings.general", requiresProject: false },
  { id: "models", labelKey: "common.models", requiresProject: false },
  { id: "skills", labelKey: "common.skills", requiresProject: true },
  { id: "agents", labelKey: "common.agents", requiresProject: true },
  { id: "plugins", labelKey: "common.plugins", requiresProject: true },
  // fork:mcp-section — a global section added by this fork.
  // fork:v5-landing D-07 —— 导航标签是「MCP」（`settings.navMcp`），页头才是「MCP 服务器」。
  { id: "mcp", labelKey: "settings.navMcp", requiresProject: false },
  // fork:proma-43-automation — 定时任务（全局，与项目无关）。面板把 cwd 只当**新建任务的
  // 初值**，每条任务自己的 cwd 在编辑器里填，所以没有项目时传空串也能用。
  { id: "automation", labelKey: "automation.title", requiresProject: false },
  // fork:zc-04 — local usage stats is a global page too.
  { id: "usage", labelKey: "usage.title", requiresProject: false },
  // fork:ui-archive-history — 归档历史（Zeno 设置 → 数据 → 归档）。
  { id: "archived", labelKey: "settings.archivedTitle", requiresProject: false },
  // fork:import-ui — 从其它 agent 导入（会话 / 模型 / 技能 / MCP）。
  { id: "import", labelKey: "import.title", requiresProject: false },
  // fork:phone-push — 手机配对 + IM 推送，**合成一栏**（用户 2026-10-03 裁定）。
  { id: "phonePush", labelKey: "phonePush.title", requiresProject: false },
];

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface SettingsNavigationState {
  section?: string;
  selections?: Record<string, string>;
}

function getBrowserStorage(): StorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function isSettingsSection(value: unknown): value is SettingsSection {
  return typeof value === "string"
    && SETTINGS_SECTION_VALUES.includes(value as SettingsSection);
}

function readState(storage: StorageLike): SettingsNavigationState {
  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const state = parsed as SettingsNavigationState;
    return {
      section: typeof state.section === "string" ? state.section : undefined,
      selections: state.selections !== null
        && typeof state.selections === "object"
        && !Array.isArray(state.selections)
        ? state.selections
        : undefined,
    };
  } catch {
    return {};
  }
}

function selectionKey(section: SettingsDetailSection, cwd?: string | null): string | null {
  if (section === "models") return section;
  return cwd ? JSON.stringify([section, cwd]) : null;
}

export function getLastSettingsSection(
  cwd: string | null,
  storage: StorageLike | null = getBrowserStorage(),
): SettingsSection {
  if (!storage) return "general";
  try {
    const section = readState(storage).section;
    if (!isSettingsSection(section)) return "general";
    return PROJECT_SECTIONS.has(section) && !cwd ? "general" : section;
  } catch {
    return "general";
  }
}

export function setLastSettingsSection(
  section: SettingsSection,
  storage: StorageLike | null = getBrowserStorage(),
): void {
  if (!storage) return;
  try {
    const state = readState(storage);
    state.section = section;
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Browser storage is best-effort.
  }
}

export function getLastSettingsSelection(
  section: SettingsDetailSection,
  cwd?: string | null,
  storage: StorageLike | null = getBrowserStorage(),
): string | null {
  if (!storage) return null;
  const key = selectionKey(section, cwd);
  if (!key) return null;
  try {
    const value = readState(storage).selections?.[key];
    return typeof value === "string" && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

export function setLastSettingsSelection(
  section: SettingsDetailSection,
  value: string,
  cwd?: string | null,
  storage: StorageLike | null = getBrowserStorage(),
): void {
  if (!storage || !value) return;
  const key = selectionKey(section, cwd);
  if (!key) return;
  try {
    const state = readState(storage);
    state.selections = { ...state.selections, [key]: value };
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Browser storage is best-effort.
  }
}

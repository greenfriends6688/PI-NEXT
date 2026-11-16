export interface ToolEntry {
  name: string;
  description: string;
  active: boolean;
  /** Active, but left out of requests: the model calls it only from codemode scripts. */
  declarationHidden?: boolean;
  parameters?: Record<string, unknown>;
  promptGuidelines?: string[];
}

/** Presets that pin an explicit tool list onto the session. */
export const CONCRETE_TOOL_PRESET_VALUES = ["none", "read-only", "default", "full"] as const;
export type ConcreteToolPreset = typeof CONCRETE_TOOL_PRESET_VALUES[number];

/**
 * "configured" is not a tool list: it means "send no override", so pi resolves the
 * loadout from settings.json defaultTools exactly like the `pi` CLI does. Sessions
 * left on it stay unpinned and keep following the setting as it changes.
 */
export const CONFIGURED_TOOL_PRESET = "configured";
export const TOOL_PRESET_VALUES = ["configured", "none", "read-only", "default", "full"] as const;
export type ToolPreset = typeof TOOL_PRESET_VALUES[number];

export const PRESET_NONE: string[] = [];
export const PRESET_READ_ONLY: string[] = ["read", "grep", "find", "ls"];
export const PRESET_DEFAULT: string[] = ["read", "bash", "edit", "write"];
export const PRESET_FULL: string[] = ["bash", "read", "edit", "write", "grep", "find", "ls"];

const BUILTIN_TOOL_NAMES = new Set([...PRESET_FULL, "powershell"]);

export function isToolPreset(value: unknown): value is ToolPreset {
  return typeof value === "string" && (TOOL_PRESET_VALUES as readonly string[]).includes(value);
}

export function isConcreteToolPreset(value: unknown): value is ConcreteToolPreset {
  return typeof value === "string" && (CONCRETE_TOOL_PRESET_VALUES as readonly string[]).includes(value);
}

export function getPresetFromTools(tools: ToolEntry[]): ConcreteToolPreset {
  const activeTools = tools.filter((t) => t.active);
  return getPresetFromToolNames(activeTools.map((tool) => tool.name));
}

export function getPresetFromToolNames(toolNames: readonly string[]): ConcreteToolPreset {
  if (toolNames.length === 0) return "none";

  const active = toolNames
    .map((name) => name === "powershell" ? "bash" : name)
    .filter((name) => BUILTIN_TOOL_NAMES.has(name))
    .sort()
    .join(",");

  if (active === [...PRESET_READ_ONLY].sort().join(",")) return "read-only";
  if (active === [...PRESET_DEFAULT].sort().join(",")) return "default";
  if (active === [...PRESET_FULL].sort().join(",")) return "full";
  return "default";
}

/** Undefined means "no explicit selection": let pi resolve settings.json defaultTools. */
export function getToolNamesForPreset(preset: ToolPreset): string[] | undefined {
  if (preset === CONFIGURED_TOOL_PRESET) return undefined;
  if (preset === "none") return [...PRESET_NONE];
  if (preset === "read-only") return [...PRESET_READ_ONLY];
  if (preset === "full") return [...PRESET_FULL];
  return [...PRESET_DEFAULT];
}

/**
 * The five choices the UI offers, in menu order. `chat-only` is the same tool
 * list as `none`; its name is what people pick, so the labels are kept apart
 * from the internal values.
 */
export const TOOL_PRESET_CHOICES = ["configured", "chat-only", "read-only", "default", "full"] as const;
export type ToolPresetChoice = typeof TOOL_PRESET_CHOICES[number];

export const TOOL_PRESET_CHOICE_VALUES: Record<ToolPresetChoice, ToolPreset> = {
  configured: CONFIGURED_TOOL_PRESET,
  "chat-only": "none",
  "read-only": "read-only",
  default: "default",
  full: "full",
};

export const TOOL_PRESET_CHOICE_LABEL_KEYS: Record<ToolPresetChoice, string> = {
  configured: "chat.presetConfigured",
  "chat-only": "chat.chatOnly",
  "read-only": "chat.presetReadOnly",
  default: "chat.presetDefault",
  full: "chat.presetFull",
};

/** The tool names a choice pins, or null when settings.json decides. */
export function toolPresetChoiceTools(choice: ToolPresetChoice): string[] | null {
  const names = getToolNamesForPreset(TOOL_PRESET_CHOICE_VALUES[choice]);
  return names === undefined ? null : names;
}

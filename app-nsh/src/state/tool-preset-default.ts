// The tool preset a new session starts with (General's "tool preset"): the
// choice pi-next keeps as `defaultTools` in settings.json, here a device-local
// preference handed to `POST /api/agent/new` as `toolNames` when the session
// is created. `configured` (the default) passes no list and lets pi resolve
// settings.json, as before.
import { pref, setPref } from "./prefs";
import { TOOL_PRESET_CHOICE_LABEL_KEYS, type ToolPresetChoice } from "../lib/tool-presets";

/** pi-web's key for the general tool preset (`settings.toolPreset`). */
export const TOOL_PRESET_PREF = "pi-default-tool-preset";

/** The stored choice, or `configured` when it is missing / unknown. */
export function defaultToolPreset(): ToolPresetChoice {
  const value = pref<string>(TOOL_PRESET_PREF, "configured");
  return Object.prototype.hasOwnProperty.call(TOOL_PRESET_CHOICE_LABEL_KEYS, value)
    ? (value as ToolPresetChoice)
    : "configured";
}

export function setDefaultToolPreset(choice: ToolPresetChoice): void {
  setPref(TOOL_PRESET_PREF, choice);
}

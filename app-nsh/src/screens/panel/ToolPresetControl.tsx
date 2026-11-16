// The tool preset picker the system and tools tabs share.
//
// The choices are pi-next's (`lib/tool-presets.ts`): follow the config, chat
// only, read-only, built-in, all. A choice pins pi's `tools` allow-list with
// `set_tools`; "Follow config" sends no list, which lets pi resolve
// `settings.json`'s `defaultTools` again. The current choice is the session's
// own pin (`GET /api/sessions/[id]` `toolNames`) read against its resolved
// tools (`get_tools`).
import { resource, signal, Text, View } from "nsh";
import type { SelectItem } from "nsh/base";
import { agentState, sendCommand } from "../../api/agent";
import { readSession } from "../../api/sessions";
import {
  getPresetFromTools,
  TOOL_PRESET_CHOICES,
  TOOL_PRESET_CHOICE_LABEL_KEYS,
  toolPresetChoiceTools,
  type ToolEntry,
  type ToolPresetChoice,
} from "../../lib/tool-presets";
import { errorText } from "../../ui/errors";
import { t } from "../../ui/i18n";
import { colors, Spinner } from "../../ui/kit";
import { SettingsError, SettingsSelect } from "../settings/parts";

interface ToolSelection {
  /** Undefined means no pin: the configured defaults decide. */
  toolNames: string[] | undefined;
  tools: ToolEntry[];
  /** `get_tools` failed (an old wrapper, or a session that could not start). */
  failure: string | null;
}

/** `revision` lets a tab ask for the tool list again after a preset change. */
export const toolSelectionRevision = signal(0);

export function bumpToolSelection(): void {
  toolSelectionRevision.update((revision) => revision + 1);
}

/** The session's pinned tool names and resolved tool list. */
export function useToolSelection(sessionId: () => string | null) {
  return resource(
    () => {
      const id = sessionId();
      return id ? { id, revision: toolSelectionRevision() } : null;
    },
    async (asked, info): Promise<ToolSelection> => {
      const view = await readSession(asked.id, { summaryTree: true, signal: info.signal });
      let tools: ToolEntry[] = [];
      let failure: string | null = null;
      // `get_state` is where pi-next reads the active tools; this server also
      // answers `get_tools` separately, which is what starts an idle wrapper.
      const state = await agentState(asked.id, { systemPrompt: false, signal: info.signal }).catch(() => null);
      const inline = state?.running && Array.isArray(state.state?.tools) ? state.state.tools : null;
      if (inline) {
        tools = inline.map((tool) => ({ ...tool, description: tool.description ?? "", active: tool.active !== false }));
      } else {
        try {
          tools = await sendCommand<ToolEntry[]>(asked.id, { type: "get_tools" }, { signal: info.signal });
        } catch (error) {
          failure = errorText(error);
        }
      }
      return { toolNames: view.toolNames, tools, failure };
    },
  );
}

/** The five choices, translated where the picker shows them (a language switch follows). */
function presetItems(): SelectItem[] {
  return TOOL_PRESET_CHOICES.map((choice) => ({
    value: choice,
    title: t(TOOL_PRESET_CHOICE_LABEL_KEYS[choice]),
  }));
}

/** A label and the preset select, with the save's error under it. */
export function ToolPresetControl(props: {
  sessionId: () => string | null;
  /** Called after a successful `set_tools`, so the tab can refresh its list. */
  onChanged?: () => void;
}) {
  const selection = useToolSelection(props.sessionId);
  const saving = signal(false);
  const failure = signal<string | null>(null);

  const current = (): ToolPresetChoice => {
    const loaded = selection();
    if (!loaded || loaded.toolNames === undefined) return "configured";
    const resolved = getPresetFromTools(loaded.tools);
    // `none` is the picker's "Chat only": the same empty allow-list, under
    // the name people choose (`TOOL_PRESET_CHOICE_VALUES`).
    return resolved === "none" ? "chat-only" : resolved;
  };

  const choose = async (value: string | null): Promise<void> => {
    if (!value || saving()) return;
    const choice = value as ToolPresetChoice;
    const toolNames = toolPresetChoiceTools(choice);
    const sessionId = props.sessionId();
    if (!sessionId) return;
    saving.set(true);
    failure.set(null);
    try {
      await sendCommand(sessionId, {
        type: "set_tools",
        ...(toolNames === null ? {} : { toolNames }),
      });
      bumpToolSelection();
      props.onChanged?.();
    } catch (error) {
      failure.set(errorText(error));
    } finally {
      saving.set(false);
    }
  };

  return (
    <View style={{ gap: 2 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Text style={{ flex: 1, fontSize: 11, letterSpacing: 0.44, color: colors.faint }}>{t("panel.toolPreset")}</Text>
        <If when={saving()}>
          <Spinner size={12} tint={colors.accent} />
        </If>
      </View>
      <SettingsSelect
        items={presetItems()}
        value={current()}
        onChange={(value) => void choose(value)}
        label={t("panel.toolPreset")}
        title={t(TOOL_PRESET_CHOICE_LABEL_KEYS[current()])}
        disabled={!props.sessionId() || saving() || selection.state() === "pending"}
        minWidth={220}
      />
      <If when={selection()?.failure}>
        {(message) => <SettingsError>{message()}</SettingsError>}
      </If>
      <If when={failure()}>
        {(message) => <SettingsError>{message()}</SettingsError>}
      </If>
    </View>
  );
}

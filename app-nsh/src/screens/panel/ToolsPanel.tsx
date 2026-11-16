// The tools tab: the session's preset over the tools pi resolved, and every
// tool's definition (`get_tools`, with `state.tools` as a fallback).
//
// pi-next's `components/ToolDefinitionsPanel.tsx` lists the declared tools in
// a narrow rail and their description / parameters beside it. The dock is
// 420 wide, so this keeps one column: the preset picker, then a row per tool
// that opens the same description, parameter count and prompt guidelines.
import { computed, signal, Text, View } from "nsh";
import { Scroll } from "nsh";
import type { ToolEntry } from "../../lib/tool-presets";
import { t } from "../../ui/i18n";
import { Badge, colors, Icon, mono, Press } from "../../ui/kit";
import { selectedSessionId } from "../../state/session";
import { SettingsError, SettingsLoading, SettingsNote } from "../settings/parts";
import { ToolPresetControl, useToolSelection } from "./ToolPresetControl";

/** The fields of a JSON-Schema `properties` object, as pi-next counts them. */
function parameterCount(tool: ToolEntry): number {
  const properties = tool.parameters?.properties;
  return properties && typeof properties === "object" ? Object.keys(properties).length : 0;
}

function ToolRow(props: {
  tool: () => ToolEntry;
  expanded: () => boolean;
  onToggle: () => void;
}) {
  const description = () => props.tool().description ?? "";
  const active = () => props.tool().active !== false;
  return (
    <View style={{ borderTopWidth: 1, borderTopColor: colors.line }}>
      <Press
        onPress={props.onToggle}
        accessibilityLabel={props.tool().name}
        accessibilityState={{ selected: props.expanded() }}
        style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 9 }}
        hoverStyle={{ backgroundColor: colors.raised }}
      >
        <Icon name="sliders" size={12} tint={active() ? colors.accent : colors.faint} />
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Text style={{ fontFamily: mono, fontSize: 12, fontWeight: "500", color: colors.text, numberOfLines: 1 }}>
              {props.tool().name}
            </Text>
            <If when={props.tool().declarationHidden === true}>
              <Badge label={t("tools.declarationHidden")} />
            </If>
          </View>
          <If when={description()}>
            <Text style={{ fontSize: 11, lineHeight: 16, color: colors.muted, numberOfLines: props.expanded() ? undefined : 2 }}>
              {description()}
            </Text>
          </If>
        </View>
        <Badge label={t("tools.parameterCount", { count: parameterCount(props.tool()) })} />
        <Icon name="chevron-down" size={12} tint={colors.faint} />
      </Press>
      <If when={props.expanded()}>
        <View style={{ paddingHorizontal: 12, paddingBottom: 10, gap: 4, backgroundColor: colors.inset }}>
          <If when={description()}>
            <SettingsNote>{description()}</SettingsNote>
          </If>
          <If when={(props.tool().promptGuidelines ?? []).length > 0}>
            <View style={{ gap: 2 }}>
              <Text style={{ fontSize: 10.5, fontWeight: "500", color: colors.faint }}>{t("tools.guidelines")}</Text>
              <Each of={props.tool().promptGuidelines ?? []} key="index">
                {(guideline) => (
                  <Text style={{ fontSize: 11, lineHeight: 16, color: colors.muted }}>
                    {`• ${guideline()}`}
                  </Text>
                )}
              </Each>
            </View>
          </If>
        </View>
      </If>
    </View>
  );
}

export function ToolsPanel() {
  const selection = useToolSelection(() => selectedSessionId());
  const open = signal<Record<string, boolean>>({});

  const tools = computed(() => selection()?.tools ?? []);
  const activeCount = computed(() => tools().filter((tool) => tool.active !== false).length);

  const toggle = (name: string) => {
    open.update((all) => ({ ...all, [name]: all[name] !== true }));
  };

  return (
    <If when={selectedSessionId()} else={<SettingsNote>{t("files.noWorkingDirectory")}</SettingsNote>}>
      <View style={{ flex: 1, minHeight: 0 }}>
        <View
          style={{
            flexShrink: 0,
            gap: 8,
            paddingHorizontal: 12,
            paddingVertical: 8,
            borderBottomWidth: 1,
            borderBottomColor: colors.line,
          }}
        >
          <ToolPresetControl sessionId={() => selectedSessionId()} />
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text style={{ flex: 1, fontSize: 11.5, fontWeight: "500", color: colors.text }}>{t("tools.title")}</Text>
            <Badge label={t("tools.activeCount", { count: activeCount() })} />
          </View>
        </View>

        <If when={selection.error()}>
          <View style={{ paddingHorizontal: 12, paddingVertical: 8 }}>
            <SettingsError>{t("tools.load")}</SettingsError>
          </View>
        </If>
        <If when={selection()?.failure}>
          {(message) => (
            <View style={{ paddingHorizontal: 12, paddingVertical: 8 }}>
              <SettingsError>{message()}</SettingsError>
            </View>
          )}
        </If>

        <Scroll style={{ flex: 1, minHeight: 0 }}>
          <If
            when={tools().length > 0}
            else={
              <View style={{ padding: 12 }}>
                <If when={selection.state() === "pending"} else={<SettingsNote>{t("tools.noTools")}</SettingsNote>}>
                  <SettingsLoading label={t("tools.loading")} />
                </If>
              </View>
            }
          >
            <Each of={tools()} key={(tool) => tool.name}>
              {(tool) => (
                <ToolRow
                  tool={tool}
                  expanded={() => open()[tool().name] === true}
                  onToggle={() => toggle(tool().name)}
                />
              )}
            </Each>
          </If>
        </Scroll>
      </View>
    </If>
  );
}

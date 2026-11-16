// The system tab: the prompt the model is sent, plus the session's tool
// preset (`GET /api/agent/[id]` `state.systemPrompt`, `set_tools`).
//
// pi-next shows this as a floating panel from its top bar
// (`components/SystemPromptPanel.tsx`); here it is a dock tab beside the chat.
// The prompt is read from the live wrapper, so a session that has no wrapper is
// asked to start one only when a tab / run opens it — the empty line says so
// rather than inventing a prompt.
import { computed, resource, signal, Text, View } from "nsh";
import { Scroll } from "nsh";
import { agentState } from "../../api/agent";
import { errorText } from "../../ui/errors";
import { mono } from "../../ui/fonts";
import { t } from "../../ui/i18n";
import { Button, colors, Spinner } from "../../ui/kit";
import { selectedSessionId } from "../../state/session";
import { SettingsError, SettingsLoading, SettingsNote } from "../settings/parts";
import { ToolPresetControl } from "./ToolPresetControl";

export function SystemPanel() {
  const revision = signal(0);
  const source = computed(() => {
    const id = selectedSessionId();
    return id ? { id, revision: revision() } : null;
  });
  const state = resource(source, async (asked, info) =>
    agentState(asked.id, { signal: info.signal }),
  );
  const prompt = computed(() => {
    const loaded = state();
    return loaded?.running ? loaded.state?.systemPrompt ?? null : null;
  });

  return (
    <If when={selectedSessionId()} else={<SettingsNote>{t("files.noWorkingDirectory")}</SettingsNote>}>
      <View style={{ flex: 1, minHeight: 0 }}>
        <View
          style={{
            flexShrink: 0,
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            paddingHorizontal: 12,
            paddingVertical: 8,
            borderBottomWidth: 1,
            borderBottomColor: colors.line,
          }}
        >
          <Text style={{ flex: 1, fontSize: 11.5, fontWeight: "500", color: colors.text }}>
            {t("system.prompt")}
          </Text>
          <If when={state.state() === "pending" || state.state() === "refreshing"}>
            <Spinner size={12} tint={colors.accent} />
          </If>
          <Button
            label={t("i18n.refresh")}
            variant="ghost"
            size="small"
            onPress={() => {
              revision.update((value) => value + 1);
            }}
          />
        </View>

        <View style={{ flexShrink: 0, paddingHorizontal: 12, paddingVertical: 8, gap: 4, borderBottomWidth: 1, borderBottomColor: colors.line }}>
          <ToolPresetControl sessionId={() => selectedSessionId()} />
          {/* `state.tools`, when the wrapper sends it: the names the model may
              call now. This server's `get_state` leaves them to `get_tools`,
              so the tools tab lists them either way. */}
          <If when={(state()?.state?.tools ?? []).length > 0}>
            <Text style={{ fontSize: 10.5, lineHeight: 15, color: colors.faint }}>
              {`${t("tools.label")}: ${(state()?.state?.tools ?? [])
                .filter((tool) => tool.active !== false)
                .map((tool) => tool.name)
                .join(", ")}`}
            </Text>
          </If>
        </View>

        <If when={state.error()}>
          <View style={{ paddingHorizontal: 12, paddingVertical: 8 }}>
            <SettingsError>{errorText(state.error())}</SettingsError>
          </View>
        </If>

        <Scroll style={{ flex: 1, minHeight: 0 }} contentStyle={{ padding: 12 }}>
          <If
            when={prompt() !== null}
            else={
              <View style={{ paddingVertical: 8 }}>
                <If when={state.state() === "pending"} else={<Text style={{ fontSize: 12, fontStyle: "italic", color: colors.muted }}>{t("system.load")}</Text>}>
                  <SettingsLoading label={t("system.loading")} />
                </If>
              </View>
            }
          >
            <If when={prompt() !== ""} else={<Text style={{ fontSize: 12, fontStyle: "italic", color: colors.muted }}>{t("system.empty")}</Text>}>
              <Text
                style={{
                  fontFamily: mono,
                  fontSize: 12,
                  lineHeight: 19,
                  color: colors.muted,
                  userSelect: "text",
                }}
              >
                {prompt() ?? ""}
              </Text>
            </If>
          </If>
        </Scroll>
      </View>
    </If>
  );
}

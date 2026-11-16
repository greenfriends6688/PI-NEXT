// The connection card: the app's own server is not answering yet.
//
// The app ships both halves — the pi server (the Node process that owns the
// agent, sessions, tools, MCP and files) and the Node runtime that runs it — and
// starts the server itself on launch (`state/server-process.ts`). This card is
// what shows while that start is in flight, and what a launch that failed leaves
// behind: the reason, the last lines of the server's own output, and Retry.
import { platform } from "nsh";
import { Text, View } from "nsh";
import { Button, colors, IconTile, sectionSurface } from "../ui/kit";
import { sansStyle } from "../ui/fonts";
import { t } from "../ui/i18n";
import { checkServer, serverState } from "../state/connection";
import {
  ensureServer,
  serverFailure,
  serverLog,
  serverPhase,
} from "../state/server-process";

export function Connection() {
  const state = () => serverState();
  const phase = () => serverPhase();
  return (
    <View
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        backgroundColor: colors.background,
        ...sansStyle,
      }}
    >
      <View style={{ ...sectionSurface({ padded: true }), width: "100%", maxWidth: 460, alignItems: "center", gap: 12, padding: 24 }}>
        <IconTile name="chat" tint={colors.accent} size={44} />
        <Text style={{ fontSize: 18, fontWeight: "600", color: colors.text }}>
          {state() === "checking" ? t("connection.checking") : t("connection.title")}
        </Text>
        <Text style={{ fontSize: 13, lineHeight: 19, color: colors.muted, textAlign: "center" }}>
          {t("connection.text")}
        </Text>
        <Text style={{ fontSize: 11.5, lineHeight: 17, color: colors.faint, textAlign: "center" }}>
          {t("connection.explain")}
        </Text>
        <If when={serverFailure()}>
          <Text style={{ fontSize: 11.5, color: colors.danger, textAlign: "center" }}>{serverFailure() ?? ""}</Text>
        </If>
        <If when={serverLog().length > 0}>
          <View style={{ width: "100%", gap: 2, paddingTop: 2 }}>
            <Each of={serverLog().slice(-4)} key="index">
              {(line) => (
                <Text style={{ fontSize: 10, fontFamily: "monospace", color: colors.faint, numberOfLines: 1 }}>
                  {line()}
                </Text>
              )}
            </Each>
          </View>
        </If>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingTop: 4 }}>
          <Button
            label={t("connection.retry")}
            icon="undo"
            variant="secondary"
            size="small"
            busy={phase() === "starting"}
            onPress={() => void ensureServer()}
          />
          <If when={phase() !== "starting"}>
            <Button
              label={t("connection.check")}
              variant="primary"
              size="small"
              onPress={() => void checkServer()}
            />
          </If>
        </View>
        <Text style={{ fontSize: 10.5, lineHeight: 15, color: colors.faint, textAlign: "center" }}>
          {t("connection.hint")}
        </Text>
      </View>
    </View>
  );
}

// The welcome page a fresh composer opens on, as pi-next's web app draws it:
// the brand, one line about what Pi does, the three steps, and then — at the
// bottom, where the chat's composer sits — the project/worktree row, the real
// composer (same model / strength chip, attachments and send button as a
// session's), and the keyboard hint. Sending the first message creates the
// session in the chosen folder (`Composer`'s fresh path).
//
// The large empty middle is deliberate: the page is a starting point, not a
// form. The steps are the web's `welcome.step*` texts.
import { Scroll, Text, View } from "nsh";
import { colors, Icon } from "../../ui/kit";
import { activeCwd, pendingCwd } from "../../state/session";
import { chatContentWidth } from "../../lib/chat-width";
import { t } from "../../ui/i18n";
import { Composer } from "../chat/Composer";
import { NewSessionBar } from "./NewSessionBar";

const STEPS: { titleKey: string; descKey: string }[] = [
  { titleKey: "welcome.step1Title", descKey: "welcome.step1Desc" },
  { titleKey: "welcome.step2Title", descKey: "welcome.step2Desc" },
  { titleKey: "welcome.step3Title", descKey: "welcome.step3Desc" },
];

export function FreshSession() {
  const ready = () => activeCwd() !== null && pendingCwd() === null;
  return (
    <View style={{ flex: 1, minHeight: 0, backgroundColor: "transparent" }}>
      <Scroll
        style={{ flex: 1, minHeight: 0 }}
        contentStyle={{ flexGrow: 1, alignItems: "center", justifyContent: "center", padding: 24 }}
      >
        <View style={{ width: "100%", maxWidth: 560, alignItems: "center", gap: 14 }}>
          <Text style={{ fontSize: 34, fontWeight: "700", letterSpacing: -0.6, color: colors.text }}>PI NEXT</Text>
          <Text style={{ fontSize: 13.5, lineHeight: 20, color: colors.muted, textAlign: "center" }}>
            {t("welcome.lede")}
          </Text>
          <View style={{ width: "100%", maxWidth: 420, gap: 12, paddingTop: 18 }}>
            <Each of={STEPS} key={(step) => step.titleKey}>
              {(step, index) => (
                <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
                  <View
                    style={{
                      width: 18,
                      height: 18,
                      flexShrink: 0,
                      marginTop: 1,
                      borderRadius: 9,
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: colors.field,
                      borderWidth: 1,
                      borderColor: colors.fieldBorder,
                    }}
                  >
                    <Text style={{ fontSize: 10.5, fontWeight: "600", color: colors.faint }}>{String(index() + 1)}</Text>
                  </View>
                  <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
                    <Text style={{ fontSize: 12.5, fontWeight: "600", color: colors.text }}>{t(step().titleKey)}</Text>
                    <Text style={{ fontSize: 11.5, lineHeight: 16, color: colors.muted }}>{t(step().descKey)}</Text>
                  </View>
                </View>
              )}
            </Each>
          </View>
        </View>
      </Scroll>

      <NewSessionBar />
      <Composer
        fresh
        welcome
        cwd={activeCwd()}
        placeholder={t("welcome.placeholder")}
        disabled={!ready()}
      />
      <View style={{ flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 6, paddingBottom: 10 }}>
        <Icon name="chat" size={11} tint={colors.faint} />
        <Text style={{ fontSize: 10.5, color: colors.faint, textAlign: "center" }}>
          {!activeCwd()
            ? t("workspace.pickFolderToStart")
            : pendingCwd() !== null
              ? t("workspace.checkingTrust")
              : t("composer.keysHint")}
        </Text>
      </View>
    </View>
  );
}

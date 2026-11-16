// The settings panel's shell: a section list and the chosen section.
//
// Models is one page: the enabled-model switches, the full catalog and the
// models.json provider editor, OAuth sign-in and API keys live together, so
// there is no separate Advanced or Providers entry to keep in step: adding a
// provider's credential and adding its models are one page, as in pi-next.
//
// The desktop layout and its numbers are pi-next's
// (`重构/pi-next-0.0.4-source-2026-11-14/app/settings.css`): a 220-point
// sidebar on the panel fill with a hairline edge, 20 × 12 header padding, a
// 16-point title, section tabs 38 high with 12-point words and a 3 × 20 accent
// bar on the chosen one, and a content column 640 wide with 20 points of
// padding. The visible chrome is the gallery kit (`../../ui/kit`): `Dialog`'s
// backdrop (`backdrop`), `Tab` + `Tabs` for the section list, `RoundButton` for
// Close, `Badge` for a key and the shared `SettingsCard` / `SettingsRow` from
// `./parts`.
//
// A phone shows one level at a time, as pi-next's `SettingsPanel.tsx` does:
// the sections fill the panel, picking one replaces them with that section,
// and the header's Back returns to the list. The desktop keeps both panes.
// `platform.idiom` is the phone test (`nsh-main/crates/nsh-js/src/env.rs:874-899`,
// `nsh-main/docs/dev/js-modules.md` "The environment").
//
// The open state lives in `state/session.ts` (`settingsOpen` / `closeSettings`),
// which whoever mounts this panel toggles; the chosen section is local, so the
// panel opens where it was left while it stays mounted.
//
// Each section is built only while it is the chosen tab (`If` builds a branch
// when its value turns truthy and drops it when it goes, `tsx.md` "If, Each,
// List"): a section's `resource` therefore loads on the visit, not at launch.
//
// Escape is `Dialog`'s own (`closeOnEscape`): the newest layer takes it first
// and Settings closes when it is on top, pi-next's `lib/stacked-dialog.ts`
// layering without a document listener (the native side is
// `nsh-main/crates/nsh-core/src/ops.rs:2021-2024`,
// `nsh-main/crates/nsh-js/src/navigation.rs:1601-1616`). Cmd/Ctrl+Enter closes
// the panel the way every section already saves: each control writes as it
// changes, so there is no draft to commit. The binding lives with this
// component (`nsh-main/crates/nsh-js/src/keymap.rs:1-12`, `:145-206`), so the
// composer gets the key back when Settings closes.

import { effect, keymap, platform, Scroll, signal, Text, untracked, View, windowSize } from "nsh";
import { Dialog, Tab, Tabs } from "nsh/base";
import { BackHandler } from "nsh/mobile";
import {
  Badge,
  Icon,
  IconTile,
  listRow,
  RoundButton,
  backdrop,
  colors,
  focusRing,
  radius,
  sectionSurface,
  terminal,
  type IconName,
} from "../../ui/kit";
import { t } from "../../ui/i18n";
import { closeSettings, settingsOpen, settingsTarget } from "../../state/session";
import { Agents } from "./Agents";
import { attachedMode, serverBacked } from "../../api/mode";
import { Devices } from "./Devices";
import { General } from "./General";
import { Mcp } from "./Mcp";
import { Models } from "./Models";
import { Plugins } from "./Plugins";
import { Skills } from "./Skills";
import {
  SETTINGS_COLUMN,
  SETTINGS_SECTION_GAP,
  SETTINGS_SIDEBAR,
  SETTINGS_TAB,
  SettingsCard,
  SettingsNote,
  SettingsRow,
  settingsPage,
} from "./parts";

/** The panel's sections, in the order the list shows them. */
type SettingsSection =
  | "general"
  | "models"
  | "mcp"
  | "skills"
  | "plugins"
  | "agents"
  | "devices"
  | "shortcuts";

/** One row of the section list: its name's key, its glyph. */
type SectionRow = { id: SettingsSection; labelKey: string; icon: IconName };

/** pi-next's phone groups its sections; the connection pair sits together. */
const PREFERENCE_SECTIONS: SectionRow[] = [
  { id: "general", labelKey: "settings.general", icon: "sliders" },
  { id: "models", labelKey: "common.models", icon: "layers" },
  { id: "agents", labelKey: "common.agents", icon: "person" },
  { id: "skills", labelKey: "common.skills", icon: "bulb" },
  { id: "plugins", labelKey: "common.plugins", icon: "components" },
  { id: "mcp", labelKey: "settings.mcp", icon: "code" },
];

const CONNECTION_SECTIONS: SectionRow[] = [
  { id: "devices", labelKey: "settings.navDevices", icon: "share" },
  { id: "shortcuts", labelKey: "settings.shortcuts", icon: "terminal" },
];

const SECTIONS: SectionRow[] = [...PREFERENCE_SECTIONS, ...CONNECTION_SECTIONS];

/** An attached window has no server to expose: Phone & Bots has nothing to
 * configure there, so the row is dropped (`attachedMode`, `src/api/link.ts`). */
function connectionSections(): SectionRow[] {
  // No server at all (attached to the machine's pi, no bundled one): there is
  // nothing for Phone & Bots to expose.
  const serverless = attachedMode() && !serverBacked();
  return serverless ? CONNECTION_SECTIONS.filter((row) => row.id !== "devices") : CONNECTION_SECTIONS;
}

function visibleSections(): SectionRow[] {
  return [...PREFERENCE_SECTIONS, ...connectionSections()];
}

/** The pages that are a list + detail inside the section (pi-next's five config pages). */
const SPLIT_SECTIONS = new Set<SettingsSection>(["models", "agents", "skills", "plugins", "mcp"]);

/** The desktop list's groups: preferences, then the device/connection pair. */
function desktopGroups(): { labelKey: string; sections: SectionRow[] }[] {
  return [
    { labelKey: "settings.navPreferences", sections: PREFERENCE_SECTIONS },
    { labelKey: "settings.navDevices", sections: connectionSections() },
  ];
}

function phoneGroups(): { labelKey: string; sections: SectionRow[] }[] {
  return [
    { labelKey: "settings.navPreferences", sections: PREFERENCE_SECTIONS },
    { labelKey: "settings.navDevices", sections: connectionSections() },
  ];
}

const PHONE_GROUPS: { labelKey: string; sections: SectionRow[] }[] = [
  { labelKey: "settings.navPreferences", sections: PREFERENCE_SECTIONS },
  { labelKey: "settings.navDevices", sections: CONNECTION_SECTIONS },
];

/** The chosen section's name for a phone's header. */
function sectionLabel(section: SettingsSection): string {
  const entry = SECTIONS.find((row) => row.id === section);
  return t(entry?.labelKey ?? "settings.title");
}

/** pi-web's fixed shortcut table (`components/SettingsPanel.tsx:82-88`), shown
 * read-only. TODO(nsh): read the table back from `keymap` instead of copying
 * it; only `mod+k`, `mod+enter` and `mod+r` are bound by this app so far. */
const SHORTCUTS: { labelKey: string; keys: string[] }[] = [
  { labelKey: "settings.shortcuts.commandPalette", keys: ["Ctrl", "/", "Cmd", "K"] },
  { labelKey: "settings.shortcuts.newSession", keys: ["Ctrl", "Alt", "N"] },
  { labelKey: "settings.shortcuts.stopRun", keys: ["Esc"] },
  { labelKey: "settings.shortcuts.sendMessage", keys: ["Enter"] },
  { labelKey: "settings.shortcuts.newLine", keys: ["Shift", "Enter"] },
];

/** The chosen section's content, written once for both layouts. */
function SettingsSectionContent(props: { section: () => SettingsSection }) {
  return (
    <View style={settingsPage}>
      <If when={props.section() === "general"}>
        <General />
      </If>
      <If when={props.section() === "models"}>
        <Models />
      </If>
      <If when={props.section() === "mcp"}>
        <Mcp />
      </If>
      <If when={props.section() === "skills"}>
        <Skills />
      </If>
      <If when={props.section() === "plugins"}>
        <Plugins />
      </If>
      <If when={props.section() === "agents"}>
        <Agents />
      </If>
      <If when={props.section() === "devices"}>
        <Devices />
      </If>
      <If when={props.section() === "shortcuts"}>
        <SettingsCard title={t("settings.keyboardShortcuts")}>
          <Each of={SHORTCUTS} key={(shortcut) => shortcut.labelKey}>
            {(shortcut, index) => (
              <SettingsRow first={index() === 0} label={t(shortcut().labelKey)}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                  <Each of={shortcut().keys} key={(key) => key}>
                    {(key) => <Badge label={key()} outline />}
                  </Each>
                </View>
              </SettingsRow>
            )}
          </Each>
          <SettingsNote>{t("settings.shortcutsReadOnly")}</SettingsNote>
        </SettingsCard>
      </If>
    </View>
  );
}

/** A phone's header: 36-point Back and Close with a centered title
 * (`app/v5/settings.css` `.settings-dialog-header`, 44 high). */
const phoneHeader = {
  flexDirection: "row" as const,
  alignItems: "center" as const,
  gap: 4,
  height: 52,
  paddingHorizontal: 10,
  borderBottomWidth: 1,
  get borderBottomColor() {
    return colors.line;
  },
  get backgroundColor() {
    return colors.background;
  },
};

function PhoneHeader(props: {
  title: string;
  back?: { label: string; onPress: () => void };
  onClose: () => void;
}) {
  return (
    <View style={phoneHeader}>
      <View style={{ width: 36 }}>
        <If when={props.back}>
          <RoundButton
            icon="back"
            label={props.back?.label ?? t("settings.back")}
            variant="secondary"
            size={36}
            onPress={() => props.back?.onPress()}
          />
        </If>
      </View>
      <Text
        style={{
          flex: 1,
          minWidth: 0,
          textAlign: "center",
          fontSize: 14.5,
          fontWeight: "600",
          color: colors.text,
          numberOfLines: 1,
        }}
      >
        {props.title}
      </Text>
      <View style={{ width: 36, alignItems: "flex-end" }}>
        <RoundButton
          icon="close"
          label={t("settings.closeSettings")}
          variant="secondary"
          size={36}
          onPress={props.onClose}
        />
      </View>
    </View>
  );
}

/** The phone's first level: the sections, filling the panel. */
function PhoneHome(props: {
  selected: () => SettingsSection;
  onPick: (section: SettingsSection) => void;
  onClose: () => void;
}) {
  return (
    <View style={{ flex: 1, minHeight: 0 }}>
      <PhoneHeader title={t("settings.title")} onClose={props.onClose} />
      <Scroll style={{ flex: 1 }} contentStyle={{ width: "100%" }}>
        <View
          style={{
            width: "100%",
            maxWidth: SETTINGS_COLUMN,
            alignSelf: "center",
            padding: 16,
            paddingBottom: 32,
            gap: SETTINGS_SECTION_GAP,
          }}
        >
          <Each of={phoneGroups()} key={(group) => group.labelKey}>
            {(group) => (
              <View style={{ gap: 6 }}>
                <Text
                  style={{
                    paddingHorizontal: 4,
                    fontSize: 11,
                    fontWeight: "600",
                    letterSpacing: 1.2,
                    color: colors.faint,
                  }}
                >
                  {t(group().labelKey)}
                </Text>
                <View style={{ ...sectionSurface(), overflow: "hidden" }}>
                  <Tabs
                    accessibilityLabel={`${t(group().labelKey)} · ${t("settings.sectionsLabel")}`}
                    style={{ flexDirection: "column" }}
                  >
                    <Each of={group().sections} key={(entry) => entry.id}>
                      {(entry, index) => {
                        const row = listRow({ first: index() === 0 });
                        const selected = () => props.selected() === entry().id;
                        return (
                          <Tab
                            selected={selected()}
                            onPress={() => props.onPick(entry().id)}
                            {...row}
                            style={{
                              ...row.style,
                              width: "100%",
                              marginHorizontal: 0,
                              borderRadius: 0,
                              paddingHorizontal: 12,
                              paddingStart: 12,
                              paddingEnd: 12,
                              paddingVertical: 0,
                              borderTopWidth: index() === 0 ? 0 : 1,
                              borderTopColor: colors.line,
                            }}
                          >
                            <IconTile
                              name={entry().icon}
                              size={28}
                              tint={selected() ? colors.accent : colors.muted}
                            />
                            <Text
                              style={{
                                flex: 1,
                                minWidth: 0,
                                fontSize: 15,
                                fontWeight: selected() ? "600" : "400",
                                color: colors.text,
                                numberOfLines: 1,
                              }}
                            >
                              {t(entry().labelKey)}
                            </Text>
                            <Icon name="chevron" size={14} tint={colors.faint} />
                          </Tab>
                        );
                      }}
                    </Each>
                  </Tabs>
                </View>
              </View>
            )}
          </Each>
        </View>
      </Scroll>
    </View>
  );
}

/** The phone's second level: just the chosen section, under Back. */
function PhoneSection(props: {
  section: () => SettingsSection;
  onBack: () => void;
  onClose: () => void;
}) {
  return (
    <View style={{ flex: 1, minHeight: 0 }}>
      <PhoneHeader
        title={sectionLabel(props.section())}
        back={{ label: t("settings.backTo", { name: t("settings.title") }), onPress: props.onBack }}
        onClose={props.onClose}
      />
      <Scroll style={{ flex: 1 }} contentStyle={{ width: "100%" }}>
        <View
          style={{
            width: "100%",
            maxWidth: SETTINGS_COLUMN,
            alignSelf: "center",
            padding: 16,
            paddingBottom: 32,
          }}
        >
          <SettingsSectionContent section={props.section} />
        </View>
      </Scroll>
    </View>
  );
}

/** The dialog's card: 900 × 620 at most, 16 points off the window's edges
 * (`settings.css`: the modal surface is the window minus 8 on each side). */
const panel = {
  get width() {
    return Math.min(1180, windowSize().width - 16);
  },
  get height() {
    return Math.min(720, windowSize().height - 16);
  },
  margin: "auto" as const,
  get borderRadius() {
    return radius.card;
  },
  borderCurve: "continuous" as const,
  borderWidth: 1,
  get borderColor() {
    return colors.border;
  },
  get backgroundColor() {
    return colors.background;
  },
  overflow: "hidden" as const,
};

/** The section list's column: the panel fill, a hairline at its right edge. */
const sidebar = {
  width: SETTINGS_SIDEBAR,
  flexShrink: 0,
  get backgroundColor() {
    return colors.sidebar;
  },
  borderRightWidth: 1,
  get borderRightColor() {
    return colors.border;
  },
  paddingTop: 20,
  paddingBottom: 20,
  paddingHorizontal: 12,
  gap: 18,
};

/** A tab's look: 38 high, 11-point insets, 8-point corners (`.settings-section-tab`). */
const tab = {
  width: "100%" as const,
  flexDirection: "row" as const,
  alignItems: "center" as const,
  gap: 5,
  height: SETTINGS_TAB,
  paddingHorizontal: 11,
  borderRadius: 8,
  borderCurve: "continuous" as const,
};

/** The chosen tab's bar at the list's edge (3 × 20, 9 points in). */
const tabBar = {
  position: "absolute" as const,
  left: 0,
  top: 9,
  width: 3,
  height: 20,
  borderTopRightRadius: 3,
  borderBottomRightRadius: 3,
};

export function SettingsDialog(props: { initialSection?: SettingsSection }) {
  const section = signal<SettingsSection>(props.initialSection ?? "general");
  // A phone opens on the sections; a section passed in (a deep link) opens it.
  const phoneAtHome = signal(props.initialSection === undefined);

  // A `/skills` or `/mcp` command names the section Settings should show. The
  // target is consumed once as the dialog opens, then cleared so the next
  // sidebar visit starts on the section the reader left behind.
  effect(() => {
    if (!settingsOpen()) return;
    const target = settingsTarget();
    if (target === null) return;
    untracked(() => {
      section.set(target as SettingsSection);
      phoneAtHome.set(false);
      settingsTarget.set(null);
    });
  });

  // Cmd/Ctrl+Enter: the current section needs no draft commit (each control
  // saves as it changes), so it closes the panel. Bound while this component
  // lives, not globally (`nsh-main/crates/nsh-js/src/keymap.rs:1-12`).
  keymap.bind("mod+enter", () => {
    if (settingsOpen()) closeSettings();
  });

  // Android's back button: from a section it returns to the list, and from
  // the list it closes Settings. The listener is removed with this component
  // (`nsh-main/crates/nsh-js/src/platform_modules.rs:112-170`). A Dialog is a
  // modal and Android gives the newest modal the button first
  // (`nsh-main/crates/nsh-core/src/element/back.rs:1-10`), so while Settings
  // is the top layer its own `closeOnEscape` still takes the press.
  if (platform.idiom === "phone" && platform.os === "android") {
    BackHandler.on("press", () => {
      if (!phoneAtHome()) {
        phoneAtHome.set(true);
        return true;
      }
      closeSettings();
      return true;
    });
  }

  return (
    <Dialog
      open={settingsOpen()}
      onOpenChange={(event) => {
        if (!event.open) closeSettings();
      }}
      accessibilityLabel={t("settings.title")}
      closeOnEscape={true}
      backdropStyle={backdrop()}
      style={panel}
    >
      <If when={platform.idiom === "phone"}>
        <If
          when={phoneAtHome()}
          else={
            <PhoneSection
              section={section}
              onBack={() => phoneAtHome.set(true)}
              onClose={closeSettings}
            />
          }
        >
          <PhoneHome
            selected={section}
            onPick={(next) => {
              section.set(next);
              phoneAtHome.set(false);
            }}
            onClose={closeSettings}
          />
        </If>
      </If>

      <If when={platform.idiom !== "phone"}>
        <View style={{ flex: 1, flexDirection: "row", minHeight: 0 }}>
          <View style={sidebar}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Text style={{ flex: 1, fontSize: 16, fontWeight: "600", color: colors.text }}>{t("settings.title")}</Text>
              <RoundButton
                icon="close"
                label={t("settings.closeSettings")}
                variant="secondary"
                size={26}
                onPress={closeSettings}
              />
            </View>

            <Scroll style={{ flex: 1 }} contentStyle={{ width: "100%", padding: 2 }}>
              <Each of={desktopGroups()} key={(group) => group.labelKey}>
                {(group) => (
                  <View style={{ gap: 2, marginBottom: 10 }}>
                    <Text
                      style={{
                        height: 22,
                        paddingHorizontal: 8,
                        fontSize: 10.5,
                        fontWeight: "600",
                        letterSpacing: 1.1,
                        color: colors.faint,
                      }}
                    >
                      {t(group().labelKey)}
                    </Text>
                    <Tabs
                      accessibilityLabel={`${t(group().labelKey)} · ${t("settings.sectionsLabel")}`}
                      style={{ flexDirection: "column", gap: 2 }}
                    >
                      <Each of={group().sections} key={(entry) => entry.id}>
                        {(entry) => (
                          <Tab
                            selected={section() === entry().id}
                            onPress={() => section.set(entry().id)}
                            style={tab}
                            hoverStyle={{ backgroundColor: colors.raised }}
                            focusVisibleStyle={focusRing()}
                          >
                            <If when={section() === entry().id}>
                              <View style={{ ...tabBar, backgroundColor: colors.accent }} />
                            </If>
                            <If when={!terminal}>
                              <Icon
                                name={entry().icon}
                                size={13}
                                tint={section() === entry().id ? colors.text : colors.muted}
                              />
                            </If>
                            <Text
                              style={{
                                fontSize: 12,
                                fontWeight: section() === entry().id ? "600" : "400",
                                color: section() === entry().id ? colors.text : colors.muted,
                              }}
                            >
                              {t(entry().labelKey)}
                            </Text>
                          </Tab>
                        )}
                      </Each>
                    </Tabs>
                  </View>
                )}
              </Each>
            </Scroll>
          </View>

          <If
            when={SPLIT_SECTIONS.has(section())}
            else={
              <View style={{ flex: 1, minWidth: 0, padding: 20 }}>
                <Scroll style={{ flex: 1 }} contentStyle={{ width: "100%" }}>
                  <View testID="settings-page" style={{ width: "100%", maxWidth: SETTINGS_COLUMN, alignSelf: "center" }}>
                    <SettingsSectionContent section={section} />
                  </View>
                </Scroll>
              </View>
            }
          >
            <View style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
              <SettingsSectionContent section={section} />
            </View>
          </If>
        </View>
      </If>
    </Dialog>
  );
}

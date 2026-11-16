// The dock's tab strip, as pi-next's `components/TabBar.tsx`: one 44-point
// chrome row, a "+" menu for the dock's own views, the tabs in a sideways
// scroller, and the close button that hides the panel.
//
// A tab is 28 high, 7-point corners, a 5-point gap and an 11.5-point label
// (`app/v5/panel.css` §页签工具栏). The selected one is a card with a hairline
// and the hairline drop, not a pill in a track; the close "×" is a separate
// press, so a press on it never also selects the tab. Subagent tabs carry the
// run's status dot (`GET /api/subagents/[id]`), side chats the chat glyph.
//
// The body runs once (`tsx.md`): tabs and the active index are signals read in
// the `<Each>` / `<If>` bindings, and every label is `t()`'d where it shows.
import type { ViewStyle } from "nsh";
import { Scroll, signal, Text, View } from "nsh";
import { Button as BaseButton, Menu, MenuItem } from "nsh/base";
import {
  alpha,
  colors,
  Icon,
  iconButtonGlyph,
  iconButtonLook,
  isDark,
  menuItemGlyph,
  menuItemLabel,
  menuItemLook,
  menuPopup,
  Press,
  tabsLook,
  Tip,
  type IconName,
} from "../../ui/kit";
import { t } from "../../ui/i18n";
import {
  active,
  closePanel,
  closePanelTab,
  openPanelTab,
  panelFullscreen,
  panelTabKey,
  tabs,
  togglePanelFullscreen,
  type PanelSimpleKind,
  type PanelTab,
  setActive,
} from "./state";
import { openUrl } from "nsh";
import { api, withToken } from "../../api/client";
import { selectedSessionId } from "../../state/session";
import { AgentStatusDot } from "./subagent-status";
import { CHROME_BUTTON, CHROME_HEIGHT } from "../shell/state";

/** The dock's own views in the "+" menu, in pi-next's order. */
const MENU_TABS: { kind: PanelSimpleKind; labelKey: string; icon: IconName }[] = [
  { kind: "files", labelKey: "files.paneTitle", icon: "folder-open" },
  { kind: "changes", labelKey: "changes.title", icon: "diff" },
  { kind: "terminal", labelKey: "terminal.title", icon: "terminal" },
  { kind: "branches", labelKey: "i18n.branches", icon: "merge" },
  { kind: "system", labelKey: "system.prompt", icon: "system" },
  { kind: "tools", labelKey: "tools.title", icon: "sliders" },
  { kind: "session", labelKey: "session.title", icon: "chart" },
  { kind: "debug", labelKey: "debug.title", icon: "chart" },
];

/** A tab's glyph: the same marks pi-next's `TabBar` draws. */
function tabIcon(tab: PanelTab): IconName {
  switch (tab.kind) {
    case "files":
      return "folder-open";
    case "changes":
      return "diff";
    case "terminal":
      return "terminal";
    case "branches":
      return "merge";
    case "system":
      return "system";
    case "tools":
      return "sliders";
    case "session":
      return "chart";
    case "debug":
      return "system";
    case "agent":
      return "merge";
    case "side":
      return "chat";
  }
}

/** A tab's label: fixed words for the views, the run's / chat's name for sessions. */
function tabTitle(tab: PanelTab): string {
  switch (tab.kind) {
    case "files":
      return t("files.paneTitle");
    case "changes":
      return t("changes.title");
    case "terminal":
      return t("terminal.title");
    case "branches":
      return t("i18n.branches");
    case "system":
      return t("system.prompt");
    case "tools":
      return t("tools.title");
    case "session":
      return t("session.title");
    case "debug":
      return t("debug.title");
    case "agent":
      return (tab.name ?? "").trim() || t("agentSwitcher.subagent");
    case "side":
      return (tab.name ?? "").trim() || t("sideChat.title");
  }
}

/** A tab's frame: 28 high, 7-point corners, a hairline only when selected. */
const tabFrame = (): ViewStyle => ({
  flexShrink: 0,
  maxWidth: 180,
  height: 28,
  flexDirection: "row",
  alignItems: "center",
  gap: 3,
  paddingLeft: 7,
  paddingRight: 3,
  borderWidth: 1,
  borderColor: "transparent",
  borderRadius: 7,
  borderCurve: "continuous",
  backgroundColor: "transparent",
});
const tabFrameSelected = (): ViewStyle => ({
  borderColor: colors.border,
  backgroundColor: colors.surface,
  boxShadow: `0 1px 2px rgba(0, 0, 0, ${isDark() ? 0.24 : 0.04})`,
});

/** The press on a tab's glyph and name. */
const tabPressStyle = (): ViewStyle => ({
  flexDirection: "row",
  alignItems: "center",
  gap: 5,
  flexShrink: 1,
  minWidth: 0,
  paddingVertical: 2,
});

/** A 26-point chrome icon button (the "+" and the panel's close). */
function PanelIconButton(props: {
  icon: IconName;
  label: string;
  onPress?: () => void;
  testID?: string;
}) {
  const look = iconButtonLook();
  return (
    <BaseButton
      onPress={props.onPress}
      testID={props.testID}
      accessibilityLabel={props.label}
      tooltip={<Tip label={props.label} />}
      {...look}
      style={{ ...look.style, width: CHROME_BUTTON, height: CHROME_BUTTON, borderRadius: CHROME_BUTTON / 2 }}
    >
      <Icon name={props.icon} {...iconButtonGlyph()} />
    </BaseButton>
  );
}

/** A row that runs an action (the export) rather than opening a tab. */
function ActionMenuRow(props: { label: string; icon: IconName; disabled?: boolean; onSelect: () => void }) {
  const look = menuItemLook();
  return (
    <MenuItem
      onSelect={props.onSelect}
      disabled={props.disabled}
      style={look.style}
      hoverStyle={look.hoverStyle}
      focusStyle={look.focusStyle}
      activeStyle={look.activeStyle}
      disabledStyle={look.disabledStyle}
      accessibilityLabel={props.label}
    >
      <Icon name={props.icon} {...menuItemGlyph()} />
      <Text style={menuItemLabel()}>{props.label}</Text>
    </MenuItem>
  );
}

function MenuRow(props: { tab: (typeof MENU_TABS)[number] }) {
  const look = menuItemLook();
  return (
    <MenuItem
      onSelect={() => openPanelTab({ kind: props.tab.kind } as PanelTab)}
      style={look.style}
      hoverStyle={look.hoverStyle}
      focusStyle={look.focusStyle}
      activeStyle={look.activeStyle}
      disabledStyle={look.disabledStyle}
      accessibilityLabel={t(props.tab.labelKey)}
    >
      <Icon name={props.tab.icon} {...menuItemGlyph()} />
      <Text style={menuItemLabel()}>{t(props.tab.labelKey)}</Text>
    </MenuItem>
  );
}

/**
 * The "+" menu: files, review, terminal, branches, system prompt, tools and
 * session info. The same menu sits in the dock's header and in the chat's
 * top bar, so the dock can be opened from a closed panel too.
 */
export function PanelMenuButton(props: { label: string; icon?: IconName; testID?: string }) {
  const popup = menuPopup();
  return (
    <Menu
      trigger={
        <PanelIconButton
          icon={props.icon ?? "tabs"}
          label={props.label}
          testID={props.testID}
        />
      }
      popupStyle={popup.popupStyle}
      popupStartingStyle={popup.popupStartingStyle}
      backdropStyle={popup.backdropStyle}
    >
      {MENU_TABS.map((tab) => <MenuRow tab={tab} />)}
      {/* The web app's "Full history": the session's exported page, in the
          browser. It is not a tab because it leaves the app. */}
      <ActionMenuRow
        label={t("history.full")}
        icon="document"
        disabled={selectedSessionId() === null}
        onSelect={() => {
          const id = selectedSessionId();
          if (!id) return;
          void openUrl(withToken(
            api.base(),
            `/api/sessions/${encodeURIComponent(id)}/export?inline=1`,
            api.token(),
          )).catch(() => undefined);
        }}
      />
    </Menu>
  );
}

/** One tab: its glyph, name, optional status dot, and the close "×". */
function PanelTabView(props: { tab: () => PanelTab; index: () => number }) {
  const selected = () => active() === props.index();
  const title = () => tabTitle(props.tab());
  const key = () => panelTabKey(props.tab());
  return (
    <View style={[tabFrame(), selected() ? tabFrameSelected() : null]}>
      <Press
        role="tab"
        onPress={() => setActive(props.index())}
        accessibilityLabel={title()}
        accessibilityState={{ selected: selected() }}
        style={tabPressStyle()}
        hoverStyle={selected() ? undefined : tabsLook().tab({ selected: false }).hoverStyle}
      >
        <Icon name={tabIcon(props.tab())} size={12} tint={selected() ? colors.text : colors.muted} />
        <Text
          style={{
            flexShrink: 1,
            minWidth: 0,
            fontSize: 11.5,
            fontWeight: selected() ? "500" : "400",
            color: selected() ? colors.text : colors.muted,
            numberOfLines: 1,
          }}
        >
          {title()}
        </Text>
        <If when={props.tab().kind === "agent"}>
          <AgentStatusDot sessionId={(props.tab() as Extract<PanelTab, { kind: "agent" }>).sessionId} />
        </If>
      </Press>
      <Press
        onPress={() => closePanelTab(key())}
        accessibilityLabel={`${t("i18n.close")} ${title()}`}
        style={{
          width: 16,
          height: 16,
          flexShrink: 0,
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 4,
          opacity: selected() ? 0.8 : 0.4,
        }}
        hoverStyle={{ backgroundColor: alpha(colors.text, 0.08), opacity: 1 }}
      >
        <Icon name="close" size={10} tint={selected() ? colors.text : colors.muted} />
      </Press>
    </View>
  );
}

/**
 * The dock's header. Its close button carries the shell's old "Close file
 * panel" label: it hides the dock, and the tabs stay for the next open.
 */
export function PanelTabs() {
  return (
    <View
      style={{
        height: CHROME_HEIGHT,
        flexShrink: 0,
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingHorizontal: 8,
        borderBottomWidth: 1,
        borderBottomColor: colors.line,
        backgroundColor: colors.surface,
      }}
    >
      <PanelMenuButton label={t("panel.add")} testID="panel-add" />
      <Scroll
        horizontal
        scrollbar={false}
        style={{ flex: 1, minWidth: 0, height: CHROME_HEIGHT }}
        contentStyle={{ flexDirection: "row", alignItems: "center", gap: 2, paddingHorizontal: 2 }}
      >
        <Each of={tabs()} key={(tab) => panelTabKey(tab)}>
          {(tab, index) => <PanelTabView tab={tab} index={index} />}
        </Each>
      </Scroll>
      <PanelIconButton
        icon={panelFullscreen() ? "collapse" : "expand"}
        label={panelFullscreen() ? t("panel.restore") : t("panel.fullscreen")}
        testID="panel-fullscreen"
        onPress={togglePanelFullscreen}
      />
      <PanelIconButton
        icon="close"
        label={t("commandPalette.closeFilePanel")}
        testID="panel-close"
        onPress={closePanel}
      />
    </View>
  );
}

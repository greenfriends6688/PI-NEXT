// Shared chrome for the eight settings sections: the card and row shells,
// the switch, the picker, the loading / error / note lines, and the detail
// dialog a section opens over Settings for one entry.
//
// Everything visual comes from the gallery kit (`../../ui/kit`): `Card` for a
// section (its title 13 pt semibold, its surface `sectionSurface`), the
// demos' `plainRow` for a row (a hairline above all but the first), `Badge`,
// `Status`, `Spinner` and `Button` for the marks, and the look modules the demo
// exports — `switchLook` for a switch, `Picker` + `listboxProps` + `OptionRow`
// + `ListboxHeader` for a select, `insetSurface` for a nested group. No
// Tailwind of our own.
//
// The numbers are pi-next's (`重构/pi-next-0.0.4-source-2026-11-14/app/settings.css`):
// a 640-point content column (`.settings-rows`), 18 points between sections
// (`.set-section`) and 16 points inside a card (`.crow`); a row title of 13
// (`.crow__title`) over an 11-point detail (`.crow__detail`) — the kit's own
// `RowLabel` is 14 / 12, so a row draws its words here to keep pi-next's
// sizes, while the row itself is still the demos' `plainRow`.

import type { JSX, TextStyle, ViewStyle } from "nsh";
import { platform, Scroll, signal, Text, View, windowSize } from "nsh";
import { Dialog, Select, Switch, type SelectItem } from "nsh/base";
import {
  alpha,
  Badge,
  Button,
  Card,
  backdrop,
  colors,
  dialogCard,
  dialogText,
  dialogTitle,
  Icon,
  insetSurface,
  ListboxEmpty,
  ListboxHeader,
  listboxProps,
  OptionRow,
  Picker,
  plainRow,
  Spinner,
  switchLook,
  terminal,
} from "../../ui/kit";
import { mono } from "../../ui/fonts";
import { t } from "../../ui/i18n";

/** The content column of a section (`.settings-rows`: 640, centered). */
export const SETTINGS_COLUMN = 640;
/** The section list at the left (`.settings-dialog-surface`: 220). */
export const SETTINGS_SIDEBAR = 220;
/** Between two sections (`.set-section` margin-top: 18). */
export const SETTINGS_SECTION_GAP = 18;
/** Inside a card, before a row's words (`.crow` padding: 11 16). */
export const SETTINGS_ROW_PAD = 16;
/** A row's title (`.crow__title`: 13). */
export const SETTINGS_LABEL = 13;
/** A row's detail and a note (`.crow__detail`: 11, line-height 1.5). */
export const SETTINGS_DETAIL = 11;
/** A section's trailing tab: 38 high, 12-point words (`settings-section-tab`). */
export const SETTINGS_TAB = 38;
/** The widest a picker's trigger grows in a row (a model name fits). */
const PICKER_WIDTH = 260;

/** The page a section draws: one 100% column, its cards 18 apart. */
export const settingsPage: ViewStyle = {
  width: "100%",
  gap: SETTINGS_SECTION_GAP,
};

/**
 * A section's detail view: a card dialog over Settings (`dialogCard`,
 * `backdrop`), with the entry's name and description, a scrolling body and a
 * pinned footer. It stacks over the Settings dialog as the newest native
 * layer, so Escape and the backdrop close this card first. A section mounts
 * it only while it has a detail to show, and the accessors keep the contents
 * following their signals (`nsh` components run once).
 */
export function SettingsDetailDialog(props: {
  open: () => boolean;
  onClose: () => void;
  /** The name the dialog opens with for screen readers. */
  label: () => string;
  title: () => string;
  subtitle?: () => string;
  /** Buttons under the body (the detail's own actions). */
  footer?: JSX.Element;
  testID?: string;
  width?: number;
  children: JSX.Element;
}) {
  return (
    <Dialog
      open={props.open()}
      animation="fade"
      testID={props.testID}
      accessibilityLabel={props.label()}
      closeOnEscape={true}
      closeOnBackdropPress={true}
      onOpenChange={(event) => {
        if (!event.open) props.onClose();
      }}
      backdropStyle={backdrop()}
      style={{ ...dialogCard(props.width ?? 620), maxHeight: Math.min(720, windowSize().height - 48) }}
    >
      <View style={{ gap: 2 }}>
        <Text style={dialogTitle()}>{props.title()}</Text>
        <If when={(props.subtitle?.() ?? "") !== ""}>
          <Text style={dialogText()}>{props.subtitle?.() ?? ""}</Text>
        </If>
      </View>
      <Scroll
        style={{ maxHeight: Math.max(220, Math.min(560, windowSize().height - 200)) }}
        contentStyle={{ gap: 12 }}
      >
        {props.children}
      </Scroll>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 8 }}>
        {props.footer}
        <Button
          label={t("i18n.close")}
          variant="secondary"
          size="small"
          onPress={props.onClose}
        />
      </View>
    </Dialog>
  );
}

/** A section: the kit's `Card` (title over a flat surface), its rows inset
 * 16 points as `.crow`s are. */
export function SettingsCard(props: {
  title: string;
  subtitle?: JSX.Element;
  right?: JSX.Element;
  children: JSX.Element;
}) {
  return (
    <Card title={props.title} subtitle={props.subtitle} right={props.right} flush>
      <View style={{ paddingHorizontal: terminal ? 0 : SETTINGS_ROW_PAD }}>{props.children}</View>
    </Card>
  );
}

/**
 * One setting: its title (and tags) over a quieter detail, the controls at
 * the trailing edge. The row is the demo's `plainRow` — a hairline above all
 * but the first — with pi-next's `.crow` numbers (11 points above and below,
 * 16 between the words and the control); the words take 13 / 11.
 */
export function SettingsRow(props: {
  first?: boolean;
  /** A stable handle for the test suite (`id:<testID>`). */
  testID?: string;
  label: string;
  detail?: string;
  /** Badges after the title (a scope, a version). */
  tags?: JSX.Element;
  /** More lines under the detail (a status, an error, a test result). */
  note?: JSX.Element;
  /** The title is a group's (a provider's, a package's): 600 weight. */
  strong?: boolean;
  children?: JSX.Element;
}) {
  return (
    <View testID={props.testID} style={{ ...plainRow({ first: props.first }), paddingVertical: 11, gap: 16 }}>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <Text style={{ fontSize: SETTINGS_LABEL, fontWeight: props.strong ? "600" : "400", color: colors.text }}>
            {props.label}
          </Text>
          {props.tags}
        </View>
        <If when={props.detail}>
          <Text style={{ fontSize: SETTINGS_DETAIL, lineHeight: 16, color: colors.muted }}>{props.detail}</Text>
        </If>
        {props.note}
      </View>
      <If when={props.children}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>{props.children}</View>
      </If>
    </View>
  );
}

/** A group of rows inside a section's card (a provider, a package, a
 * server): the kit's sunk `insetSurface`, so a card is never a card. */
export function SettingsGroup(props: { children: JSX.Element }) {
  return (
    <View style={{ ...insetSurface(), marginVertical: terminal ? 0 : 8, padding: terminal ? 0 : 8, gap: 2 }}>
      {props.children}
    </View>
  );
}

/** A switch on a setting: the kit's `Toggle` look (`switchLook`) on
 * `nsh/base`'s `Switch`, with the `disabled` a saving or read-only row
 * needs (the kit's `Toggle` itself takes none). */
export function SettingsSwitch(props: {
  value: boolean;
  onChange: (value: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  const look = switchLook(() => props.value);
  return (
    <Switch
      checked={props.value}
      disabled={props.disabled}
      onChange={({ checked }) => props.onChange(checked)}
      accessibilityLabel={props.label}
      style={{ margin: -8, padding: 8 }}
      trackClass={look.trackClass}
      trackStyle={look.trackStyle}
      thumbStyle={look.thumbStyle}
    />
  );
}

/**
 * A select on a setting: `nsh/base`'s `Select` with the gallery's listbox
 * look (a `Picker` trigger, popup or sheet, `OptionRow` rows with a check).
 * The open state is this control's own, so the chevron follows it.
 */
export function SettingsSelect(props: {
  items: SelectItem[];
  value: string | null;
  onChange: (value: string | null) => void;
  label: string;
  /** The trigger's words (the chosen item's title, or a prompt). */
  title: string;
  placeholder?: boolean;
  disabled?: boolean;
  /** The popup's least width with a pointer. */
  minWidth?: number;
}) {
  const open = signal(false);
  const look = listboxProps({ minWidth: props.minWidth ?? 240 });
  return (
    <Select
      items={props.items}
      value={props.value}
      onChange={({ value }) => props.onChange(value)}
      open={open()}
      onOpenChange={({ open: next }) => open.set(next)}
      disabled={props.disabled}
      accessibilityLabel={props.label}
      {...look}
      empty={<ListboxEmpty label={t("settings.nothingToChoose")} />}
      renderItem={(item) => <OptionRow item={item} />}
      renderGroup={(group) => <ListboxHeader group={group} />}
      trigger={
        <Picker
          title={props.title}
          placeholder={props.placeholder}
          open={open()}
          disabled={props.disabled}
          style={{ width: PICKER_WIDTH }}
        />
      }
    />
  );
}

/** A quiet line inside a card (a count, a path, a footnote). */
export function SettingsNote(props: { tone?: "muted" | "danger" | "warn"; children: JSX.Element }) {
  const color = () => (props.tone === "danger" ? colors.danger : props.tone === "warn" ? colors.warn : colors.muted);
  return (
    <Text style={{ fontSize: SETTINGS_DETAIL, lineHeight: 16, color: color(), paddingVertical: terminal ? 0 : 2 }}>
      {props.children}
    </Text>
  );
}

/** A failed read or write, in the danger tone. */
export function SettingsError(props: { children: JSX.Element }) {
  return <SettingsNote tone="danger">{props.children}</SettingsNote>;
}

/** Work going on: the kit's `Spinner` and a quiet word. */
export function SettingsLoading(props: { label: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: terminal ? 0 : 6 }}>
      <Spinner size={12} tint={colors.accent} />
      <Text style={{ fontSize: SETTINGS_DETAIL, color: colors.muted }}>{props.label}</Text>
    </View>
  );
}

/** A count at a section's title (`Card`'s `right`). */
export function SettingsCount(props: { label: string }) {
  return <Badge label={props.label} />;
}

/** A code word (a URL, a token): 12 points, monospaced; read where the
 * style is applied, so it follows the appearance. The family is the app's
 * CJK-safe monospaced list (`ui/fonts.ts`), not the bare `monospace` the
 * system draws Chinese in with its own fallback. */
export function settingsCode(): TextStyle {
  return {
    fontSize: 12,
    color: colors.text,
    fontFamily: mono,
    fontVariant: ["tabular-nums"],
  };
}


// ---------------------------------------------------------------------------
// A list-detail settings page (Models, Agents, Skills, Plugins, MCP)
//
// pi-next draws these five as the same two panes inside Settings: a 220-point
// list at the left (the section list stays left of it), and the selected
// entry's detail at the right, with the page's own footer under both. The
// middle list scrolls alone; the detail scrolls alone; neither scrolls the
// section list beside them.
// ---------------------------------------------------------------------------

/** The middle list's width, as pi-next's `.config-sidebar` (220) plus its padding. */
export const CONFIG_LIST_WIDTH = 250;
/** A row's height (`.config-sidebar-item`: 32). */
export const CONFIG_ROW = 32;

/** A page's title and one-line subtitle above its two panes. */
export function ConfigPage(props: { title: string; subtitle?: string; children: JSX.Element }) {
  return (
    <View style={{ flex: 1, minHeight: 0 }}>
      <View
        style={{
          flexShrink: 0,
          gap: 2,
          paddingHorizontal: 18,
          paddingTop: 14,
          paddingBottom: 10,
          borderBottomWidth: 1,
          borderBottomColor: colors.line,
        }}
      >
        <Text style={{ fontSize: 15, fontWeight: "600", color: colors.text }}>{props.title}</Text>
        <If when={props.subtitle}>
          <Text style={{ fontSize: 11.5, lineHeight: 16, color: colors.muted }}>{props.subtitle ?? ""}</Text>
        </If>
      </View>
      {/* A definite body height: the two panes and their scrolls take the rest
          of the page, not the height of their first rows. */}
      <View style={{ flex: 1, minHeight: 0 }}>{props.children}</View>
    </View>
  );
}

/**
 * The two panes and the footer. A phone cannot show 250 + a detail side by
 * side, so it stacks them (the section's own scroll carries both).
 */
export function ConfigSplit(props: {
  list: JSX.Element;
  /** Pinned under the list (the list's add action). */
  listFooter?: JSX.Element;
  detail: JSX.Element;
  /** Pinned under both panes (a Save bar). */
  footer?: JSX.Element;
  listWidth?: number;
  testID?: string;
}) {
  if (platform.idiom === "phone") {
    return (
      <View testID={props.testID} style={{ minHeight: 0 }}>
        <View style={{ paddingHorizontal: 8, paddingVertical: 6 }}>{props.list}</View>
        {props.listFooter}
        <View style={{ padding: 16 }}>{props.detail}</View>
        {props.footer}
      </View>
    );
  }
  return (
    <View
      testID={props.testID}
      // ponytail: the settings dialog's content does not hand a percentage
      // height down to this pane (the branch is laid out by content), so the
      // two panes get the panel's height minus the page header and top band.
      // If the header grows, raise the 170 or make the dialog's content a
      // definite-height flex column.
      style={{ height: Math.max(320, Math.min(720, windowSize().height - 16) - 170), minHeight: 0 }}
    >
      <View style={{ flex: 1, minHeight: 0, flexDirection: "row" }}>
        <View
          style={{
            width: props.listWidth ?? CONFIG_LIST_WIDTH,
            flexShrink: 0,
            minHeight: 0,
            borderRightWidth: 1,
            borderRightColor: colors.line,
            backgroundColor: alpha(colors.text, 0.015),
          }}
        >
          <Scroll style={{ flex: 1, minHeight: 0 }} contentStyle={{ paddingVertical: 8, paddingHorizontal: 8 }}>
            {props.list}
          </Scroll>
          {props.listFooter}
        </View>
        <View style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
          <Scroll style={{ flex: 1, minHeight: 0 }} contentStyle={{ padding: 20, paddingBottom: 30 }}>
            {props.detail}
          </Scroll>
        </View>
      </View>
      {props.footer}
    </View>
  );
}

/** One row of the middle list: 32 points, 8-point corners, accent-tinted when open. */
export function ConfigSidebarItem(props: {
  active?: boolean;
  onPress: () => void;
  testID?: string;
  accessibilityLabel?: string;
  /** A model under its provider: one indent, quieter text. */
  indented?: boolean;
  muted?: boolean;
  children: JSX.Element;
}) {
  return (
    <View
      onPress={props.onPress}
      testID={props.testID}
      role="button"
      accessibilityLabel={props.accessibilityLabel}
      accessibilityState={{ selected: props.active === true }}
      style={{
        height: CONFIG_ROW,
        flexShrink: 0,
        flexDirection: "row",
        alignItems: "center",
        gap: 7,
        paddingHorizontal: 8,
        paddingLeft: props.indented ? 22 : 8,
        borderRadius: 8,
        backgroundColor: props.active ? alpha(colors.accent, 0.1) : "transparent",
        opacity: props.muted ? 0.6 : 1,
      }}
      hoverStyle={{ backgroundColor: props.active ? alpha(colors.accent, 0.14) : alpha(colors.text, 0.05) }}
    >
      {props.children}
    </View>
  );
}

/** A group caption in the middle list ("订阅服务", "API KEY", "项目"). */
export function ConfigSidebarLabel(props: { text: string; aside?: string }) {
  return (
    <View style={{ height: 24, paddingHorizontal: 8, flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6 }}>
      <Text style={{ flex: 1, fontSize: 10.5, fontWeight: "600", letterSpacing: 1.1, color: colors.faint }}>
        {props.text}
      </Text>
      <If when={props.aside}>
        <Text style={{ fontSize: 10.5, color: colors.faint }}>{props.aside ?? ""}</Text>
      </If>
    </View>
  );
}

/** The middle list's pinned action ("添加 Provider", "安装技能"). */
export function ConfigListAction(props: { label: string; onPress: () => void; testID?: string; disabled?: boolean }) {
  return (
    <View style={{ flexShrink: 0, padding: 8, borderTopWidth: 1, borderTopColor: colors.line }}>
      <View
        onPress={props.onPress}
        testID={props.testID}
        role="button"
        accessibilityLabel={props.label}
        style={{
          height: CONFIG_ROW,
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
          paddingHorizontal: 8,
          borderRadius: 8,
          opacity: props.disabled ? 0.5 : 1,
        }}
        hoverStyle={props.disabled ? undefined : { backgroundColor: alpha(colors.text, 0.05) }}
      >
        <Icon name="plus" size={13} tint={colors.muted} />
        <Text style={{ fontSize: 12, color: colors.muted }}>{props.label}</Text>
      </View>
    </View>
  );
}

/** A row in the middle list: the name and, optionally, a trailing note. */
export function ConfigRowText(props: { title: string; detail?: string; muted?: boolean; active?: boolean }) {
  return (
    <View style={{ flex: 1, minWidth: 0 }}>
      <Text
        style={{
          fontSize: 12.5,
          fontWeight: props.active ? "600" : "400",
          color: props.muted ? colors.muted : colors.text,
          numberOfLines: 1,
        }}
      >
        {props.title}
      </Text>
      <If when={props.detail}>
        <Text style={{ fontSize: 10.5, color: colors.faint, numberOfLines: 1 }}>{props.detail ?? ""}</Text>
      </If>
    </View>
  );
}

/** A detail's heading (the selected entry, 14.5 points). */
export function ConfigDetailTitle(props: { title: string; subtitle?: string; children?: JSX.Element }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10, minHeight: 28 }}>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text style={{ fontSize: 14.5, fontWeight: "600", color: colors.text }}>{props.title}</Text>
        <If when={props.subtitle}>
          <Text style={{ fontSize: 11.5, lineHeight: 16, color: colors.muted }}>{props.subtitle ?? ""}</Text>
        </If>
      </View>
      {props.children}
    </View>
  );
}

/** A section caption inside a detail (11 points, uppercase tracking). */
export function ConfigSectionTitle(props: { text: string; aside?: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      <Text style={{ flex: 1, fontSize: 11, fontWeight: "600", letterSpacing: 1.1, color: colors.muted }}>
        {props.text}
      </Text>
      <If when={props.aside}>
        <Text style={{ fontSize: 10.5, color: colors.faint }}>{props.aside ?? ""}</Text>
      </If>
    </View>
  );
}

/** A label over a control in a detail. */
export function ConfigField(props: { label: string; children: JSX.Element; gap?: number }) {
  return (
    <View style={{ gap: props.gap ?? 6 }}>
      <Text style={{ fontSize: 11, fontWeight: "500", color: colors.muted }}>{props.label}</Text>
      {props.children}
    </View>
  );
}

/** A quiet paragraph of a detail. */
export function ConfigText(props: { text: string; tone?: "muted" | "danger" | "warn" }) {
  const color = () => (props.tone === "danger" ? colors.danger : props.tone === "warn" ? colors.warn : colors.muted);
  return <Text style={{ fontSize: 12, lineHeight: 17, color: color() }}>{props.text}</Text>;
}

/** An empty detail pane. */
export function ConfigEmpty(props: { text: string }) {
  return (
    <View style={{ paddingVertical: 40, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ fontSize: 12.5, color: colors.faint, textAlign: "center" }}>{props.text}</Text>
    </View>
  );
}

/** The bar under both panes: a status line and the page's actions. */
export function ConfigFooter(props: { status?: string; children?: JSX.Element }) {
  return (
    <View
      style={{
        flexShrink: 0,
        minHeight: 50,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderTopWidth: 1,
        borderTopColor: colors.line,
      }}
    >
      <Text style={{ flex: 1, minWidth: 0, fontSize: 11.5, color: colors.muted, numberOfLines: 2 }}>
        {props.status ?? ""}
      </Text>
      {props.children}
    </View>
  );
}

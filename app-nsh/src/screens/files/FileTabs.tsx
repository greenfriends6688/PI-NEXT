// The file tabs above the files pane's content: the tree, then one tab per open
// file, each with its name and a close button, the active one lit like the
// pane's tabs (pi-next's `.ftab` in `components/TabBar.tsx`).
//
// The tree tab is pi-next's `files` pane tab: while any file is open this strip
// gives the way back to it, so a file tab is never a one-way door. The strip
// appears once one file is open and disappears again when the last one closes;
// with no files the tree already fills the pane. The store is `./tabs.ts`; the
// dock mounts the strip above the tree or viewer (`FilesPane` is that content
// without a strip), and the dock's own tab bar can replace it without touching
// the file state.
import { Scroll, Text, View, type ViewStyle } from "nsh";
import { Button as BaseButton } from "nsh/base";
import { alpha, colors, focusRing, Icon, isDark, Press, Tip } from "../../ui/kit";
import { t } from "../../ui/i18n";
import { activeFileTab, closeFileTab, fileTabName, openFileTab, openFileTabs, showFilesTab } from "./tabs";

/** The strip's row: 34 points, the tabs inside it at the pane tabs' 28. */
const STRIP_HEIGHT = 34;
const TAB_HEIGHT = 28;

/**
 * A tab's frame: the selected one is a card on the surface, a hairline edge
 * and the same 7-point corners as the pane's tabs; the others stay clear until
 * the pointer is on them.
 */
function frameStyle(selected: boolean): ViewStyle {
  return {
    height: TAB_HEIGHT,
    flexShrink: 0,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: selected ? colors.border : "transparent",
    borderRadius: 7,
    backgroundColor: selected ? colors.surface : undefined,
    boxShadow: selected ? `0 1px 2px rgba(0, 0, 0, ${isDark() ? 0.24 : 0.04})` : undefined,
  };
}

/** The tree's tab: the first tab while any file is open, selected when no file is. */
function FilesTreeTab() {
  const selected = () => activeFileTab() === null;
  return (
    <View style={frameStyle(selected())}>
      <BaseButton
        role="tab"
        selected={selected()}
        accessibilityLabel={t("files.treeTab")}
        tooltip={<Tip label={t("files.treeTab")} />}
        onPress={showFilesTab}
        style={{
          height: TAB_HEIGHT,
          flexDirection: "row",
          alignItems: "center",
          gap: 5,
          paddingHorizontal: 8,
        }}
        hoverStyle={selected() ? undefined : { backgroundColor: alpha(colors.text, 0.05) }}
        focusVisibleStyle={focusRing()}
      >
        <Icon name="folder-open" size={12} tint={selected() ? colors.text : colors.faint} />
        <Text
          style={{
            fontSize: 11.5,
            fontWeight: selected() ? "500" : "400",
            color: selected() ? colors.text : colors.muted,
            numberOfLines: 1,
          }}
        >
          {t("files.treeTab")}
        </Text>
      </BaseButton>
    </View>
  );
}

/** One file's tab: its name (screen readers hear the whole path), then its close button. */
function FileTabRow(props: { path: string }) {
  const selected = () => activeFileTab() === props.path;
  const name = () => fileTabName(props.path);
  return (
    <View style={frameStyle(selected())}>
      <BaseButton
        role="tab"
        selected={selected()}
        accessibilityLabel={props.path}
        tooltip={<Tip label={props.path} />}
        onPress={() => openFileTab(props.path)}
        style={{
          height: TAB_HEIGHT,
          flexDirection: "row",
          alignItems: "center",
          gap: 5,
          paddingStart: 8,
          paddingEnd: 2,
        }}
        hoverStyle={selected() ? undefined : { backgroundColor: alpha(colors.text, 0.05) }}
        focusVisibleStyle={focusRing()}
      >
        <Icon name="file" size={12} tint={selected() ? colors.text : colors.faint} />
        <Text
          style={{
            maxWidth: 160,
            fontSize: 11.5,
            fontWeight: selected() ? "500" : "400",
            color: selected() ? colors.text : colors.muted,
            numberOfLines: 1,
          }}
        >
          {name()}
        </Text>
      </BaseButton>
      <Press
        onPress={() => closeFileTab(props.path)}
        accessibilityLabel={t("files.closeTab", { name: name() })}
        hitSlop={4}
        style={{
          width: 18,
          height: 18,
          marginEnd: 4,
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 4,
        }}
        hoverStyle={{ backgroundColor: alpha(colors.text, 0.08) }}
      >
        <Icon name="close" size={10} tint={selected() ? colors.muted : colors.faint} />
      </Press>
    </View>
  );
}

/**
 * The tree's tab, then the open files left to right in the order they were
 * opened. The strip scrolls sideways (a narrow pane keeps every tab
 * reachable); the close button is on every file tab, as pi-next's `.ftab__x`
 * is.
 */
export function FileTabs() {
  return (
    <View
      style={{
        height: STRIP_HEIGHT,
        flexShrink: 0,
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 8,
      }}
    >
      <Scroll
        horizontal
        scrollbar={false}
        accessibilityLabel={t("files.openTabs")}
        style={{ flex: 1, minWidth: 0 }}
        contentStyle={{ flexDirection: "row", alignItems: "center", gap: 2 }}
      >
        <FilesTreeTab />
        <Each of={openFileTabs()} key={(tab) => tab.path}>
          {(tab) => <FileTabRow path={tab().path} />}
        </Each>
      </Scroll>
    </View>
  );
}

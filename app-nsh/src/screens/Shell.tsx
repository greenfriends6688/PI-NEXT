// The app's shell: the session list on the left, the chat in the middle, the
// optional right dock and the settings dialog.
//
// The frame is pi-next's `app/v5/shell.css`: three floating panes 8 points
// from the window's edges and 8 apart, 16-point corners on a hairline, each
// with a 44-point chrome row. On a phone the sidebar is pi-next's drawer over
// the chat (the shell's one column, with a scrim); below 1024 the right pane is
// its floating panel over a scrim (560 wide), and from 1024 up it is the third
// column beside the chat, as the left sidebar is. Each pane's edge in the
// 8-point gap is a 12-point drag handle (pi-next's `useResizablePanel`): the
// sidebar's and the right pane's column widths live in `prefs.layout`
// (`./shell/state.ts`).
//
// Every screen reads the shared signals of `state/session.ts`; the shell only
// decides what is on screen. Panes and rows are the gallery kit's
// (`ui/kit`): `sectionSurface` for the panes, `iconButtonLook` for the chrome
// buttons, and its colors, radii and densities. The right dock's own tabs are
// `screens/panel` (`PanelDock` / `PanelTabs`). A component body runs once
// (`tsx.md`), so all of the switching below goes through `<If>` / `<Each>` on
// signal reads.
import { cleanup, effect, platform, safeArea, signal, Text, View, windowSize, type GestureResponderEvent, type KeyEvent, type MouseEvent as NshMouseEvent, type ViewRef, type ViewStyle } from "nsh";
import { Button as BaseButton } from "nsh/base";
import { currentWindow, isAvailable as desktopAvailable } from "nsh/desktop";
import { Composer } from "./chat/Composer";
import { ChatView } from "./chat/ChatView";
import { StatsBar } from "./chat/StatsBar";
import { showFilesTab } from "./files/tabs";
import { CommandPalette } from "./overlays/CommandPalette";
import { ExtensionDialog } from "./overlays/ExtensionDialog";
import { extensionTitle } from "./overlays/state";
import { Toasts } from "./overlays/Toasts";
import { FreshSession } from "./new-session/FreshSession";
import { CwdPicker } from "./new-session/CwdPicker";
import { TrustDialog } from "./new-session/TrustDialog";
import { SettingsDialog } from "./settings/SettingsDialog";
import { SessionsPanel } from "./sidebar/SessionsPanel";
import {
  alpha,
  colors,
  focusRing,
  Icon,
  iconButtonGlyph,
  iconButtonLook,
  sectionSurface,
  Tip,
  type IconName,
} from "../ui/kit";
import {
  activeCwd,
  rightPane,
  selectedSessionId,
  settingsOpen,
  showRightPane,
  type RightPane,
} from "../state/session";
import { sansStyle } from "../ui/fonts";
import { t } from "../ui/i18n";
import { PanelDock } from "./panel/PanelDock";
import { PanelMenuButton } from "./panel/PanelTabs";
import { panelFullscreen, panelOpen, togglePanel } from "./panel/state";
import { paneAlpha, windowIsTranslucent } from "../lib/background-opacity";
import { watchCompletion } from "../state/completion";
import {
  chooseSession,
  CHROME_BUTTON,
  CHROME_BUTTON_TOUCH,
  CHROME_HEIGHT,
  MOBILE_MAX_WIDTH,
  PANE_RADIUS,
  RIGHT_PANEL_MAX_WIDTH,
  RIGHT_PANEL_MIN_WIDTH,
  SHELL_GAP,
  SHELL_INSET,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  SPLIT_PANEL_MIN_WIDTH,
  clampPanelWidth,
  closeSidebar,
  getDefaultRightPanelWidth,
  getDrawerWidth,
  getOverlayRightPanelWidth,
  getRightPanelMaxWidth,
  getSidebarMaxWidth,
  getSidebarWidth,
  livePanelWidth,
  rememberPanelWidth,
  sessionTitle,
  showPanelWidth,
  sidebarOpen,
  storedPanelWidth,
  toggleSidebar,
  type PanelId,
} from "./shell/state";

/** A phone: one column, the sidebar a drawer (`home-chat.tsx`'s phone form). */
const phone = () => platform.idiom === "phone";
/** Phones and narrow windows take the drawer; pi-next's breakpoint is 767. */
const drawerMode = () => phone() || windowSize().width <= MOBILE_MAX_WIDTH;
/**
 * The right pane floats over the chat only below 1024 (pi-next's 768–1023
 * window, `globals.css`), where the row cannot hold the sidebar, the chat and
 * the pane together. From 1024 up it is the third column, like the sidebar.
 */
const overlayPane = () => windowSize().width < SPLIT_PANEL_MIN_WIDTH;
/** A chrome button: 28 with a pointer, pi-next's `.m-top` 36 on a phone. */
const chromeSide = () => (drawerMode() ? CHROME_BUTTON_TOUCH : 28);

/** The safe area, at least the shell's 8-point inset on every side. */
const insetTop = () => Math.max(SHELL_INSET, safeArea().top);
const insetRight = () => Math.max(SHELL_INSET, safeArea().right);
const insetBottom = () => Math.max(SHELL_INSET, safeArea().bottom);
const insetLeft = () => Math.max(SHELL_INSET, safeArea().left);

/**
 * What a split row spends outside its panes: the two 8-point insets, three
 * 8-point gaps, less the 16 points the two 12-point edge handles pull back
 * with their -10 margins. The chat gets what is left, so the pane limits below
 * take this off the window's width before they spend it on the panes.
 */
const SPLIT_ROW_CHROME = 2 * SHELL_INSET + 3 * SHELL_GAP - 16;

/** The width a pane keeps in `prefs.layout` (or the design's default), before
 * the window's clamp: what a drag starts from and End reaches. */
const preferredSidebarWidth = () =>
  livePanelWidth("sidebar") ?? storedPanelWidth("sidebar") ?? getSidebarWidth(windowSize().width);

/** The right pane's width in `prefs.layout`, or
 * `getDefaultRightPanelWidth`: min(420, width − 280), 360–420. */
const preferredRightPanelWidth = () =>
  livePanelWidth("rightPanel") ?? storedPanelWidth("rightPanel") ?? getDefaultRightPanelWidth(windowSize().width);

/** The right pane's width as the sidebar's ceiling sees it: its own limit
 * measured against the sidebar's *preferred* width, less the split row's own
 * chrome. Neither getter reads the other's computed width, so the pair cannot
 * recurse (pi-next's width refs break the same circle). */
const rightPaneWidthBesideSidebar = () =>
  clampPanelWidth(
    preferredRightPanelWidth(),
    RIGHT_PANEL_MIN_WIDTH,
    getRightPanelMaxWidth({
      viewportWidth: windowSize().width,
      sidebarOpen: sidebarOpen() && !drawerMode(),
      sidebarWidth: preferredSidebarWidth(),
    }) - (overlayPane() ? 0 : SPLIT_ROW_CHROME),
  );

/** The window's ceiling for the sidebar (`getSidebarMaxWidth`): 440, less the
 * chat's floor and the right pane while it shares the row. The split row's
 * chrome comes off too: both panes and the chrome together must leave the chat
 * its 420. */
const sidebarWidthLimit = () => {
  const rightShown = panelOpen() && !overlayPane();
  const limit = getSidebarMaxWidth({
    viewportWidth: windowSize().width,
    rightPanelOpen: rightShown,
    rightPanelWidth: rightPaneWidthBesideSidebar(),
  });
  return rightShown ? limit - SPLIT_ROW_CHROME : limit;
};

/** The window's ceiling for the right pane (`getRightPanelMaxWidth`): 1200,
 * less the chat's 420, the sidebar as it is shown and the split row's own
 * chrome. */
const rightPaneWidthLimit = () =>
  getRightPanelMaxWidth({
    viewportWidth: windowSize().width,
    sidebarOpen: sidebarOpen() && !drawerMode(),
    sidebarWidth: sidebarWidth(),
  }) - (overlayPane() ? 0 : SPLIT_ROW_CHROME);

/** pi-next's sidebar column: 268 (240 from 1024 to 1359), 210–440 when dragged. */
const sidebarWidth = () =>
  clampPanelWidth(preferredSidebarWidth(), SIDEBAR_MIN_WIDTH, sidebarWidthLimit());

/** The right pane's column: 420 by default, 320–1200 when dragged. */
const rightPaneWidth = () =>
  clampPanelWidth(preferredRightPanelWidth(), RIGHT_PANEL_MIN_WIDTH, rightPaneWidthLimit());

/** The floating right pane under 1024: min(560, 100vw − 48), or null on a
 * phone where the pane spans the shell. */
const overlayPaneWidth = () => getOverlayRightPanelWidth(windowSize().width);
/** The phone drawer's width, `min(320, 86vw)`. */
const drawerWidth = () => getDrawerWidth(windowSize().width);

/** `--pin-pane-shadow`: the hairline drop under a pane and its deep, soft float
 * (near-black in both appearances, as the design's shadow is). */
const paneShadow = () => "0 1px 2px rgba(0, 0, 0, 0.04), 0 24px 48px -44px rgba(0, 0, 0, 0.3)";

/** A pane: the kit's card surface, at the shell's 16-point corners and its shadow. */
function paneStyle(extra: ViewStyle): ViewStyle {
  return {
    ...sectionSurface(),
    borderRadius: PANE_RADIUS,
    borderCurve: "continuous",
    overflow: "hidden",
    // A getter, so the General setting's opacity repaints the panes where they
    // are (`lib/background-opacity.ts`); a plain value would keep the one the
    // body read at mount.
    get backgroundColor(): string {
      const a = paneAlpha();
      return a >= 1 ? colors.surface : alpha(colors.surface, a);
    },
    boxShadow: paneShadow(),
    ...extra,
  };
}

/** The chat's quick dock buttons, in pi-next's order: files, review, terminal. */
const PANE_TABS: { pane: Exclude<RightPane, null>; labelKey: string; icon: IconName }[] = [
  { pane: "files", labelKey: "files.paneTitle", icon: "folder-open" },
  { pane: "changes", labelKey: "changes.title", icon: "diff" },
  { pane: "terminal", labelKey: "terminal.title", icon: "terminal" },
];

/** The last part of a path (a folder's name in the top bar's pill). */
function leafName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

/**
 * A chrome icon button (`iconButtonLook`'s ghost look, 28 across with a pointer,
 * 36 on a phone, round): the sidebar and panel toggles, new session, settings.
 * `on` keeps it lit while what it opens is open, and the tooltip names it for a
 * pointer.
 */
function ChromeButton(props: {
  icon: IconName;
  label: string;
  on?: () => boolean;
  onPress: () => void;
  side?: number;
  /** A stable handle for the test suite, whatever the language says. */
  testID?: string;
}) {
  const look = iconButtonLook({ on: props.on });
  const side = () => props.side ?? chromeSide();
  return (
    <BaseButton
      onPress={props.onPress}
      testID={props.testID}
      accessibilityLabel={props.label}
      selected={props.on ? props.on() : undefined}
      tooltip={<Tip label={props.label} />}
      {...look}
      style={{ ...look.style, width: side(), height: side(), borderRadius: side() / 2 }}
    >
      <Icon name={props.icon} {...iconButtonGlyph({ on: props.on })} />
    </BaseButton>
  );
}

/** The open session's folder, as pi-next's branch pill: 28 high, a field's
 * fill and hairline, a folder and the leaf's name at 11. */
// TODO(nsh): read the session's Git branch (`git status`) for the pill's
// label, as pi-next's `ccap--text` does; the folder's leaf is the fallback it
// uses for a session with no branch.
function PathPill(props: { path: string }) {
  return (
    <View
      style={{
        height: 28,
        flexShrink: 1,
        flexDirection: "row",
        alignItems: "center",
        gap: 5,
        paddingHorizontal: 8,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: colors.fieldBorder,
        backgroundColor: colors.field,
      }}
    >
      <Icon name="folder" size={12} tint={colors.faint} />
      <Text style={{ maxWidth: 132, fontSize: 11, fontWeight: "500", color: colors.muted, numberOfLines: 1 }}>
        {leafName(props.path)}
      </Text>
    </View>
  );
}

/** The pointer's drag handle: 12 points wide, lying in the shell's 8-point
 * gap (12 with −10 at each side cancels both gaps, so the panes stay 8 apart:
 * `shell.css` §分隔条). `cursor: col-resize` is the divider `styles.md` lays
 * out specially; a 1-point hairline shows under the pointer and while the
 * drag runs. */
const RESIZE_HANDLE = 12;
const RESIZE_MARGIN = 10;
/** A press that moves less than this is a tap (or the double click that
 * resets), not a drag: it neither resizes nor saves (`useResizablePanel`
 * applies every move; the threshold is this app's, so a tap stays a tap). */
const RESIZE_THRESHOLD = 2;

/**
 * A pane's edge as pi-next's `useResizablePanel`: pointer drag, arrow keys
 * and a double click. NSH 0.5.1's pan props report only the start and the end
 * (`onPanStart` / `onPanEnd`), so the moves come through the touch responder
 * — a desktop mouse drag is a touch too (`elements.md` "onMouseEnter"); no
 * HTML drag events.
 *
 * A drag shows its width through `showPanelWidth` and writes the user's
 * choice on release (`rememberPanelWidth`), so a window too narrow for it
 * only clamps what is shown. Keys commit at once: 12 points, 32 with Shift,
 * Home the min, End the max, Return (or a double click) the default.
 */
function PanelResizer(props: {
  /** The preference the drag writes (`prefs.layout`). */
  panel: PanelId;
  label: string;
  /** The pane at the left of the handle grows right (the sidebar), the one
   * at its right grows left (the right pane). */
  grows: "left" | "right";
  min: number;
  /** The panel's own limit, before the window's (`SIDEBAR_MAX_WIDTH` / `RIGHT_PANEL_MAX_WIDTH`). */
  max: number;
  /** What the pane shows now. */
  width: () => number;
  /** The user's width before the window's clamp. */
  preferred: () => number;
  /** The window's ceiling for the pane now. */
  limit: () => number;
  /** The design's default width at this window's size (Return resets to it). */
  resetWidth: () => number;
}) {
  const dragging = signal(false);
  const hovered = signal(false);
  let handle: ViewRef | undefined;
  let startX = 0;
  let startWidth = 0;
  let rawWidth = 0;
  let moved = false;
  let isDragging = false;

  // A pane hidden mid-drag (the window crossed a breakpoint, the panel closed)
  // drops the live width: reopening shows the last committed one.
  cleanup(() => {
    if (isDragging) showPanelWidth(props.panel, null);
  });

  /** Shows `raw`, kept in the panel's own limits and the window's. */
  const show = (raw: number): void => {
    rawWidth = clampPanelWidth(raw, props.min, props.max);
    showPanelWidth(props.panel, clampPanelWidth(rawWidth, props.min, props.limit()));
  };

  const finish = (): void => {
    if (!isDragging) return;
    isDragging = false;
    dragging.set(false);
    if (!moved) return;
    moved = false;
    // A drag that only ran into the window's ceiling leaves the shown width
    // where it was: keep the user's larger choice. The width written is the
    // raw one, so a short window's clamp never lowers it (`useResizablePanel`'s
    // `persistClamp: false`).
    if (props.width() !== startWidth) rememberPanelWidth(props.panel, rawWidth);
    showPanelWidth(props.panel, null);
  };

  const start = (event: GestureResponderEvent): void => {
    if (event.touches.length > 1) return;
    // A press gives it the keyboard focus, so the arrow keys resize without
    // Tab first (`useResizablePanel`'s `target.focus()`).
    handle?.focus();
    startX = event.pageX;
    startWidth = props.width();
    rawWidth = startWidth;
    moved = false;
    isDragging = true;
    dragging.set(true);
  };

  /** The pointer at `x` (root-view points): moves the pane's edge from where
   * the press started, once it has moved past the tap threshold. */
  const dragTo = (x: number): void => {
    if (!isDragging) return;
    const delta = (x - startX) * (props.grows === "right" ? 1 : -1);
    if (!moved && Math.abs(delta) < RESIZE_THRESHOLD) return;
    moved = true;
    show(startWidth + delta);
  };

  const move = (event: GestureResponderEvent): void => {
    dragTo(event.pageX);
  };

  /** The desktops and the web report a mouse drag's moves here too
   * (`docs/dev/elements.md`); the touch events already do on the others. A
   * move with no button down means the release happened outside the view. */
  const mouseMove = (event: NshMouseEvent): void => {
    if (event.pressedButton !== null) dragTo(event.pagePosition.x);
    else if (isDragging) finish();
  };

  /** A key or a reset: the choice goes to `prefs` now. */
  const commit = (raw: number): void => {
    rememberPanelWidth(props.panel, clampPanelWidth(raw, props.min, props.max));
    showPanelWidth(props.panel, null);
  };

  const reset = (): void => commit(props.resetWidth());

  const keyDown = (event: KeyEvent): void => {
    const step = event.modifiers.shift ? 32 : 12;
    const growKey = props.grows === "right" ? "ArrowRight" : "ArrowLeft";
    const shrinkKey = props.grows === "right" ? "ArrowLeft" : "ArrowRight";
    if (event.key === growKey) {
      // Growing never lowers the user's size below what a short window shows.
      commit(Math.max(props.width(), props.preferred()) + step);
    } else if (event.key === shrinkKey) {
      commit(props.width() - step);
    } else if (event.key === "Home") {
      commit(props.min);
    } else if (event.key === "End") {
      commit(Math.max(props.width(), props.preferred(), props.limit()));
    } else if (event.key === "Enter") {
      reset();
    }
  };

  return (
    <View
      ref={(node) => {
        handle = node;
      }}
      focusable
      accessibilityLabel={props.label}
      accessibilityHint={t("layout.resizeHint")}
      tooltip={<Tip label={props.label} />}
      onMouseEnter={() => hovered.set(true)}
      onMouseLeave={() => hovered.set(false)}
      onMouseMove={mouseMove}
      onTouchStart={start}
      onTouchMove={move}
      onTouchEnd={finish}
      onTouchCancel={finish}
      onMouseUp={finish}
      // The web runtime v0.5 does not route a view's raw key events (its
      // protocol has no `onKeyDown`): the handle keeps its pointer and
      // double-click resizing there, and the arrow keys on the desktops.
      {...(platform.os === "web" ? {} : { onKeyDown: keyDown })}
      onPress={(event) => {
        if (event.clickCount === 2) reset();
      }}
      focusVisibleStyle={focusRing()}
      style={{
        width: RESIZE_HANDLE,
        flexShrink: 0,
        marginHorizontal: -RESIZE_MARGIN,
        alignItems: "center",
        justifyContent: "center",
        cursor: "col-resize",
      }}
    >
      <View
        style={{
          width: 1,
          flexGrow: 1,
          backgroundColor: hovered() || dragging() ? colors.faint : "transparent",
        }}
      />
    </View>
  );
}

/** The chat pane's 44-point top bar: what it shows and the session actions. */
function TopBar() {
  const title = () => {
    if (selectedSessionId() === null) return "Pi";
    return sessionTitle() ?? t("sidebar.untitledSession");
  };
  const toggleSessions = () => {
    if (!sidebarOpen() && drawerMode() && panelOpen()) showRightPane(null);
    toggleSidebar();
  };
  const togglePane = (pane: Exclude<RightPane, null>) => {
    if (rightPane() === pane) {
      showRightPane(null);
    } else if (pane === "files") {
      // "Open files" starts on the tree, with the folder's open file tabs kept.
      showFilesTab();
    } else {
      showRightPane(pane);
    }
    if (drawerMode()) closeSidebar();
  };
  return (
    <View
      style={{
        height: CHROME_HEIGHT,
        flexShrink: 0,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingHorizontal: 10,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
      }}
    >
      <ChromeButton
        icon="sidebar"
        label={t("sidebar.tabSessions")}
        on={() => sidebarOpen()}
        onPress={toggleSessions}
        side={drawerMode() ? CHROME_BUTTON_TOUCH : CHROME_BUTTON}
      />
      {/* pi-next keeps the branch pill for wide top bars only: under 1280 the
          title keeps the row (`shell.css`). */}
      <If when={!drawerMode() && windowSize().width >= 1280 && activeCwd() !== null}>
        <PathPill path={activeCwd()!} />
      </If>
      <Text style={{ flex: 1, minWidth: 0, fontSize: 14.5, fontWeight: "600", color: colors.text, numberOfLines: 1 }}>
        {title()}
      </Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <If when={drawerMode()}>
          <ChromeButton
            icon="folder-open"
            label={panelOpen() ? t("commandPalette.closeFilePanel") : t("commandPalette.openFilePanel")}
            on={() => panelOpen()}
            onPress={togglePanel}
          />
        </If>
        <If when={!drawerMode()}>
          <Each of={PANE_TABS} key={(tab) => tab.pane}>
            {(tab) => (
              <ChromeButton
                icon={tab().icon}
                label={t(tab().labelKey)}
                testID={`pane:${tab().pane}`}
                on={() => rightPane() === tab().pane}
                onPress={() => togglePane(tab().pane)}
              />
            )}
          </Each>
          <PanelMenuButton label={t("panel.add")} testID="panel-more" />
        </If>
      </View>
    </View>
  );
}

/** The middle pane: the top bar, then the chat and its composer. */
function MainPane() {
  return (
    <View style={paneStyle({ flex: 1, minWidth: 0 })}>
      <TopBar />
      <View style={{ flex: 1, minHeight: 0 }}>
        <If
          when={selectedSessionId()}
          else={
            <FreshSession />
          }
        >
          <View style={{ flex: 1, minHeight: 0 }}>
            <View style={{ flex: 1, minHeight: 0 }}>
              <ChatView />
            </View>
            <Composer />
            {/* The session's spend sits under the composer, as pi-next draws
                its stats strip: a quiet line, not a header band. */}
            <StatsBar />
          </View>
        </If>
      </View>
    </View>
  );
}

/** `nsh.json`'s `"window.title"`: what the window says without an extension title. */
const WINDOW_TITLE = "Pi";

export function Shell() {
  // The desktop window's title. `setTitle` is the extension API's only title
  // source (pi-next wrote `document.title` there); with none it is the app's
  // own title. `currentWindow()` must be read while rendering — outside a
  // component it throws — and the window API works on the desktops only.
  const appWindow = desktopAvailable ? currentWindow() : null;
  effect(() => {
    const title = extensionTitle();
    appWindow?.set({ title: title ?? WINDOW_TITLE });
  });

  // General › background opacity: below 100 the window itself has to be
  // see-through for the desktop to show (`lib/background-opacity.ts`). macOS
  // and Windows make the NSWindow non-opaque with a clear background, so the
  // desktop reaches the root and the panes' own alphas. The `window` backdrop
  // stays off: its frosted material sits behind the root and would cover the
  // desktop, leaving only the panes translucent over it. Linux keeps a solid
  // window, where only the panes lighten.
  effect(() => {
    const translucent = windowIsTranslucent() && (platform.os === "macos" || platform.os === "windows");
    appWindow?.set({ transparent: translucent, backdrop: "none" });
  });

  // The finished turn's chime and notification, and the notification press
  // that reopens its session (`state/completion.ts`).
  cleanup(watchCompletion(chooseSession));

  return (
    // The shell's texts take the app's font (Chinese first), which every
    // pane, dialog and popup inside it inherits.
    <View
      style={{
        flex: 1,
        // The desk behind the panes: solid at 100%, and the desktop showing
        // through this layer below that (the window is made transparent then,
        // with no backdrop material in front of the desktop).
        get backgroundColor(): string {
          const a = paneAlpha();
          return a >= 1 ? colors.background : alpha(colors.background, a);
        },
        ...sansStyle,
      }}
    >
      <View
        style={{
          flex: 1,
          minHeight: 0,
          flexDirection: "row",
          gap: SHELL_GAP,
          paddingTop: insetTop(),
          paddingRight: insetRight(),
          paddingBottom: insetBottom(),
          paddingLeft: insetLeft(),
        }}
      >
        <If when={sidebarOpen() && !drawerMode()}>
          <>
            <View style={paneStyle({ width: sidebarWidth(), flexShrink: 0 })}>
              <SessionsPanel />
            </View>
            <PanelResizer
              panel="sidebar"
              label={t("layout.resizeSidebar")}
              grows="right"
              min={SIDEBAR_MIN_WIDTH}
              max={SIDEBAR_MAX_WIDTH}
              width={sidebarWidth}
              preferred={preferredSidebarWidth}
              limit={sidebarWidthLimit}
              resetWidth={() => getSidebarWidth(windowSize().width)}
            />
          </>
        </If>

        <MainPane />

        <If when={panelOpen() && !overlayPane() && !panelFullscreen()}>
          <>
            {/* The right pane grows left: its handle sits at its left edge
                (pi-next hides it in the floating panel's sizes above). */}
            <PanelResizer
              panel="rightPanel"
              label={t("layout.resizeFilePanel")}
              grows="left"
              min={RIGHT_PANEL_MIN_WIDTH}
              max={RIGHT_PANEL_MAX_WIDTH}
              width={rightPaneWidth}
              preferred={preferredRightPanelWidth}
              limit={rightPaneWidthLimit}
              resetWidth={() => getDefaultRightPanelWidth(windowSize().width)}
            />
            <View testID="right-pane" style={paneStyle({ width: rightPaneWidth(), flexShrink: 0 })}>
              <PanelDock />
            </View>
          </>
        </If>
      </View>

      {/* The phone's sidebar: pi-next's floating drawer over a scrim. The
          panel stays mounted while the drawer is closed (`display: none`), so
          its session read and its auto-open of the newest session run from
          launch, as they do on the desktop. */}
      <If when={drawerMode()}>
        <View
          style={paneStyle({
            position: "absolute",
            top: insetTop(),
            left: insetLeft(),
            bottom: insetBottom(),
            width: drawerWidth(),
            zIndex: 11,
            display: sidebarOpen() ? "flex" : "none",
          })}
        >
          <SessionsPanel />
        </View>
        <If when={sidebarOpen()}>
          <View
            onPress={closeSidebar}
            role="button"
            accessibilityLabel={t("i18n.close")}
            style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: alpha(colors.text, 0.24), zIndex: 10 }}
          />
        </If>
      </If>

      {/* The right pane under 1024: pi-next's floating panel (560 wide, the
          whole pane on a phone). From 1024 up it is the column above. */}
      <If when={panelOpen() && overlayPane() && !panelFullscreen()}>
        <View
          testID="panel-scrim"
          onPress={() => showRightPane(null)}
          role="button"
          accessibilityLabel={t("i18n.close")}
          style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: alpha(colors.text, 0.24), zIndex: 10 }}
        />
        <View
          testID="right-pane"
          style={paneStyle({
            position: "absolute",
            top: insetTop(),
            right: insetRight(),
            bottom: insetBottom(),
            left: overlayPaneWidth() === null ? insetLeft() : undefined,
            width: overlayPaneWidth() ?? undefined,
            zIndex: 11,
          })}
        >
          <PanelDock />
        </View>
      </If>

      {/* The dock filling the window: pi-next's full-width panel, over the
          sidebar and the chat, under Settings. */}
      <If when={panelOpen() && panelFullscreen()}>
        <View
          style={paneStyle({
            position: "absolute",
            top: insetTop(),
            right: insetRight(),
            bottom: insetBottom(),
            left: insetLeft(),
            zIndex: 12,
          })}
        >
          <PanelDock />
        </View>
      </If>

      <If when={settingsOpen()}>
        <SettingsDialog />
      </If>

      {/* The fresh session's folder and trust steps. Both read their own
          open/pending signals; the shell only keeps them mounted. */}
      <CwdPicker />
      <TrustDialog />

      {/* Mounted once and always: the palette holds its own `mod+k` binding. */}
      <CommandPalette />
      <ExtensionDialog />
      <Toasts />
    </View>
  );
}

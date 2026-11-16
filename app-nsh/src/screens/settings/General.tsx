// Settings › General: language, appearance, chat font size, and the shell's
// tool preferences.
//
// Appearance is the app's color scheme (`setColorScheme`, `nsh`'s
// `env.rs`; `docs/dev/js-modules.md` "The environment"), kept in `prefs` under
// the same key pi-web used (`pi-theme`, `light` | `dark` | `auto`). The font
// size is the chat content's (`pi-chat-content-font-size`, 12–24 pt, default
// 14), read by the chat pane from the same preference. Both are device-local
// (`state/prefs.ts`); `/api/ui-preferences` could carry them to another device
// but the merge policy is undecided — TODO(nsh): wire it once decided.
//
// The two switches are the server's: `GET /api/tools/settings` and
// `PUT /api/tools/settings` (`app/api/tools/settings/route.ts:40-47`,
// 57-130), the PowerShell tool (Windows only) and Code mode ("always" vs
// "automatic"). A save replaces the resource's value with the route's answer,
// so the switch shows what the settings file now says.
//
// The look is the gallery kit (`../../ui/kit`, through `./parts`): a `Card`
// per section, the kit's `Row` per setting, `SettingsSelect` (a `Picker`
// trigger and the listbox look) for the theme, `Slider` + `sliderLook` for the
// font size, `SettingsSwitch` (the kit's `switchLook`) for the tools.
//
// The card at the bottom is the machine's `pi` CLI itself (`../../pi/install`),
// as pi-gpui draws it: the version pi reports, its path, and pi's own updater
// (`pi update`) behind one button. Nothing bundles pi; the app only uses it.
//
// Two more rows read their own routes: pi's `showCacheMissNotices`
// (`GET`/`PUT /api/cache-miss-notices`, `app/api/cache-miss-notices/route.ts:25-67`)
// and the app's version / update check (`GET /api/app-update`). The update row
// compares the running build with the newest stable release in PI NEXT's GitHub
// Releases and opens that release through `openUrl`; nothing is installed from
// here.
//
// The About card is this app, PI NEXT — not the `pi` CLI card above it and not
// pi-web's npm package. Its one network read is the public GitHub Releases API
// (`src/local/misc-routes.ts`), and its release button opens the tag GitHub
// returned.

import { effect, openUrl, resource, setColorScheme, signal, Text, View } from "nsh";
import { Slider } from "nsh/base";
import {
  Button,
  sliderFill,
  sliderLook,
  sliderValueClass,
  sliderValueStyle,
} from "../../ui/kit";
import {
  loadToolSettings,
  saveToolSetting,
  type ToolSettingsResponse,
} from "../../api/config";
import { errorText } from "../../ui/errors";
import {
  loadAppUpdate,
  loadCacheMissNotices,
  saveCacheMissNotices,
} from "../../api/misc";
import {
  checkPi,
  compareVersions,
  parseVersion,
  versionText as piVersion,
} from "../../pi/install";
import { latestPiVersion, updatePi } from "../../pi/updates";
import { pref, setPref } from "../../state/prefs";
import {
  CHAT_WIDTH_DEFAULT,
  CHAT_WIDTH_MAX,
  CHAT_WIDTH_MIN,
  CHAT_WIDTH_PREF,
  CHAT_WIDTH_STEP,
  chatContentWidth,
} from "../../lib/chat-width";
import { enterSendMode, setEnterSendMode } from "../../state/composer";
import { defaultToolPreset, setDefaultToolPreset } from "../../state/tool-preset-default";
import {
  BACKGROUND_OPACITY_DEFAULT,
  BACKGROUND_OPACITY_MAX,
  BACKGROUND_OPACITY_MIN,
  BACKGROUND_OPACITY_PREF,
  BACKGROUND_OPACITY_STEP,
  backgroundOpacity,
} from "../../lib/background-opacity";
import {
  completionNotificationsEnabled,
  completionSoundEnabled,
  setCompletionNotificationsEnabled,
  setCompletionSoundEnabled,
} from "../../lib/completion-prefs";
import { TOOL_PRESET_CHOICE_LABEL_KEYS, type ToolPresetChoice } from "../../lib/tool-presets";
import { LOCALES, locale, setLocale, t } from "../../ui/i18n";
import { settingsOpen } from "../../state/session";
import {
  SettingsCard,
  SettingsError,
  SettingsLoading,
  SettingsNote,
  SettingsRow,
  SettingsSelect,
  SettingsSwitch,
  settingsPage,
} from "./parts";

/** pi-web's key for the appearance (`hooks/useTheme.ts:15`). */
const APPEARANCE_PREF = "pi-theme";
/** pi-web's key for the chat content's font size (`hooks/useChatAppearance.ts:12`). */
const CHAT_FONT_SIZE_PREF = "pi-chat-content-font-size";
const CHAT_FONT_SIZE_DEFAULT = 14;
const CHAT_FONT_SIZE_MIN = 12;
const CHAT_FONT_SIZE_MAX = 24;

/** `auto` is pi-web's name for "follow the system" (`lib/theme.ts`). */
type Appearance = "light" | "dark" | "auto";

const APPEARANCES: { value: Appearance; labelKey: string }[] = [
  { value: "light", labelKey: "settings.themeLight" },
  { value: "dark", labelKey: "settings.themeDark" },
  { value: "auto", labelKey: "settings.themeSystem" },
];

function appearanceItems(): { value: string; title: string }[] {
  return APPEARANCES.map((option) => ({ value: option.value, title: t(option.labelKey) }));
}

function appearanceLabel(value: Appearance): string {
  const option = APPEARANCES.find((entry) => entry.value === value);
  return t(option?.labelKey ?? "settings.themeSystem");
}

function clampFontSize(value: unknown): number {
  const size = Number(value);
  if (!Number.isFinite(size)) return CHAT_FONT_SIZE_DEFAULT;
  return Math.max(CHAT_FONT_SIZE_MIN, Math.min(CHAT_FONT_SIZE_MAX, Math.round(size)));
}

/** The stored appearance, read once per use (`prefs` is reactive). */
function appearance(): Appearance {
  const stored = pref<string>(APPEARANCE_PREF, "auto");
  return stored === "light" || stored === "dark" ? stored : "auto";
}

function fontSize(): number {
  return clampFontSize(pref<number>(CHAT_FONT_SIZE_PREF, CHAT_FONT_SIZE_DEFAULT));
}

export function General() {
  // The source is the dialog's state: opening it loads, closing it drops the
  // load (`resource` skips `null`, `tsx.md` "resource, and stale results").
  const tools = resource(
    () => (settingsOpen() ? "tools" : null),
    async (_source: string, info) => loadToolSettings({ signal: info.signal }),
  );
  const saving = signal<string | null>(null);
  const error = signal<string | null>(null);

  // The two routes of their own: both load while the panel is open and are
  // replaced by the value their PUT / refetch answers with.
  const cacheMiss = resource(
    () => (settingsOpen() ? "cache-miss-notices" : null),
    async (_source: string, info) => loadCacheMissNotices({ signal: info.signal }),
  );
  const appUpdate = resource(
    () => (settingsOpen() ? "app-update" : null),
    async (_source: string, info) => loadAppUpdate({ signal: info.signal }),
  );
  const cacheSaving = signal(false);
  const cacheError = signal<string | null>(null);
  const openingRelease = signal(false);
  const releaseError = signal<string | null>(null);

  // pi itself: found through the login shell, versioned, and updated by pi's
  // own command. Both reads wait for the panel, so opening Settings is what
  // starts them (`resource` skips `null`).
  const pi = resource(
    () => (settingsOpen() ? "pi" : null),
    async () => checkPi(),
  );
  const piLatest = resource(
    () => (settingsOpen() ? "pi-latest" : null),
    async () => latestPiVersion(),
  );
  const piUpdating = signal(false);
  const piLines = signal<string[]>([]);
  const piUpdateError = signal<string | null>(null);

  // The stored appearance applies while the panel is open. TODO(nsh): apply it
  // when the app starts, too (a shell-level effect; `prefs` loads async), and
  // offer `setTheme(theme)` for other theme files: the app ships only
  // `theme.json` (`nsh.json` "theme"), which this panel does not own.
  effect(() => {
    const choice = appearance();
    setColorScheme(choice === "auto" ? "system" : choice);
  });

  const chooseAppearance = (value: string | null): void => {
    const next: Appearance = value === "light" || value === "dark" ? value : "auto";
    setPref(APPEARANCE_PREF, next);
    setColorScheme(next === "auto" ? "system" : next);
  };

  const chooseFontSize = (value: number | [number, number]): void => {
    // A `Slider`'s value is one number or a range; this one has a single thumb.
    setPref(CHAT_FONT_SIZE_PREF, clampFontSize(Array.isArray(value) ? value[0] : value));
  };

  /** One `PUT`, one key: the route takes exactly one change per request. */
  const apply = async (
    key: string,
    change: Parameters<typeof saveToolSetting>[0],
  ): Promise<void> => {
    saving.set(key);
    error.set(null);
    try {
      const next: ToolSettingsResponse = await saveToolSetting(change);
      tools.mutate(next);
    } catch (cause) {
      error.set(errorText(cause));
      // Show the settings file's value again: the switch may have moved.
      tools.refetch();
    } finally {
      saving.set(null);
    }
  };

  const saveCacheMiss = async (enabled: boolean): Promise<void> => {
    cacheSaving.set(true);
    cacheError.set(null);
    try {
      cacheMiss.mutate(await saveCacheMissNotices(enabled));
    } catch (cause) {
      cacheError.set(errorText(cause));
      // The switch may have moved: show what the settings file still says.
      cacheMiss.refetch();
    } finally {
      cacheSaving.set(false);
    }
  };

  const openRelease = async (): Promise<void> => {
    const url = appUpdate()?.releaseUrl;
    if (!url || openingRelease()) return;
    openingRelease.set(true);
    releaseError.set(null);
    try {
      const result = await openUrl(url);
      if (!result.opened) {
        releaseError.set(t("settings.releaseOpenFailed"));
      }
    } catch (cause) {
      releaseError.set(errorText(cause));
    } finally {
      openingRelease.set(false);
    }
  };

  /** Runs pi's updater, keeping its last lines for the row. */
  const runPiUpdate = async (): Promise<void> => {
    const state = pi();
    if (state === undefined || state.kind !== "ready" || piUpdating()) return;
    piUpdating.set(true);
    piUpdateError.set(null);
    piLines.set([]);
    try {
      const result = await updatePi(state.executable, (line) => {
        piLines.set([...piLines(), line].slice(-6));
      });
      if (!result.ok) piUpdateError.set(t("settings.piUpdateFailed"));
    } catch (cause) {
      piUpdateError.set(errorText(cause));
    } finally {
      piUpdating.set(false);
      // pi's own files changed: read the version and the registry tag again.
      pi.refetch();
      piLatest.refetch();
    }
  };

  /** `pi 1.4.0`, or why there is no version to show. */
  const piVersionLine = (): string => {
    const state = pi();
    if (state === undefined) return pi.error() ? "" : t("settings.piReading");
    switch (state.kind) {
      case "platform":
        return t("settings.piPlatform");
      case "missing":
        return t("settings.piMissing");
      case "unreadable":
        return t("settings.piUnreadable", { details: state.details });
      case "too-old":
        return t("settings.piTooOld", { version: piVersion(state.version) });
      case "too-new":
        return t("settings.piTooNew", { version: piVersion(state.version) });
      case "ready":
        return `pi ${piVersion(state.version)}`;
    }
    return "";
  };

  /** The path pi was found at, or what to do when there is none. */
  const piDetailLine = (): string => {
    const state = pi();
    if (state === undefined) return "";
    switch (state.kind) {
      case "platform":
        return t("settings.piPlatformDetail");
      case "missing":
        return t("settings.piMissingDetail");
      case "unreadable":
        return "";
      default:
        return t("settings.piPath", { path: state.executable });
    }
  };

  /** The npm registry's answer, or the update's own state. */
  const piStatusLine = (): string => {
    if (piUpdating()) return t("settings.piUpdating");
    if (piUpdateError() !== null) return piUpdateError() ?? "";
    const state = pi();
    const latest = piLatest();
    if (latest === undefined) return t("settings.piCheckingVersion");
    if (latest === null) return t("settings.piUpdateCheckFailed");
    const current = state !== undefined && state.kind === "ready" ? state.version : null;
    const newest = parseVersion(latest);
    if (current !== null && newest !== null) {
      return compareVersions(newest, current) > 0
        ? t("settings.piUpdateAvailable", { version: latest })
        : t("settings.piUpToDate");
    }
    return t("settings.piLatest", { version: latest });
  };

  /** pi is newer than the version this app was tried with. */
  const piUntestedLine = (): string | null => {
    const state = pi();
    return state !== undefined && state.kind === "ready" && state.untested
      ? t("settings.piUntested")
      : null;
  };

  /** The updater's last line, while it runs and after it stops. */
  const piLogLine = (): string | null => {
    const lines = piLines();
    return lines.length === 0 ? null : lines[lines.length - 1];
  };

  const versionText = (): string => {
    const data = appUpdate();
    if (!data) return t("settings.readingVersion");
    return t("settings.versionSummary", {
      current: data.currentVersion,
      latest: data.latestVersion,
    });
  };

  const updateText = (): string => {
    if (appUpdate.error()) return t("settings.aboutUpdateCheckFailed");
    const data = appUpdate();
    if (!data) return t("settings.checkingForRelease");
    return data.updateAvailable
      ? t("settings.aboutUpdateAvailable", { version: data.latestVersion })
      : t("settings.aboutUpToDate");
  };

  const fontFraction = (): number => (fontSize() - CHAT_FONT_SIZE_MIN) / (CHAT_FONT_SIZE_MAX - CHAT_FONT_SIZE_MIN);
  const widthFraction = (): number =>
    (chatContentWidth() - CHAT_WIDTH_MIN) / (CHAT_WIDTH_MAX - CHAT_WIDTH_MIN);
  const thinkingExpanded = (): boolean => pref<boolean>("pi-thinking-expanded", false) === true;

  return (
    <View style={settingsPage}>
      <SettingsCard title={t("settings.appearance")} subtitle={t("settings.appliesToApp")}>
        <SettingsRow
          first
          label={t("common.language")}
          detail={t("settings.languageDescription")}
        >
          <SettingsSelect
            items={LOCALES.map((item) => ({ value: item.id, title: item.label }))}
            value={locale()}
            onChange={(value) => {
              if (value === "en" || value === "zh-CN" || value === "zh-TW") setLocale(value);
            }}
            label={t("common.language")}
            title={LOCALES.find((item) => item.id === locale())?.label ?? locale()}
          />
        </SettingsRow>

        <SettingsRow
          label={t("settings.themeSection")}
          detail={t("settings.appearanceDescription")}
        >
          <SettingsSelect
            items={appearanceItems()}
            value={appearance()}
            onChange={chooseAppearance}
            label={t("settings.themeSection")}
            title={appearanceLabel(appearance())}
          />
        </SettingsRow>

        <SettingsRow
          label={t("settings.chatContentFontSize")}
          detail={t("settings.chatFontSizeDetail", {
            min: CHAT_FONT_SIZE_MIN,
            max: CHAT_FONT_SIZE_MAX,
            default: CHAT_FONT_SIZE_DEFAULT,
          })}
        >
          <Slider
            value={fontSize()}
            min={CHAT_FONT_SIZE_MIN}
            max={CHAT_FONT_SIZE_MAX}
            step={1}
            onChange={({ value }) => chooseFontSize(value)}
            accessibilityLabel={t("settings.chatContentFontSize")}
            style={{ width: 160 }}
            rangeStyle={sliderFill(0, fontFraction())}
            {...sliderLook()}
          />
          <Text class={sliderValueClass} style={sliderValueStyle()}>{`${fontSize()} pt`}</Text>
          <Button
            label={t("common.reset")}
            variant="secondary"
            size="small"
            disabled={fontSize() === CHAT_FONT_SIZE_DEFAULT}
            onPress={() => chooseFontSize(CHAT_FONT_SIZE_DEFAULT)}
          />
        </SettingsRow>

        <SettingsRow
          testID="setting-chat-width"
          label={t("settings.chatContentWidth")}
          detail={t("settings.chatContentWidthDescription")}
        >
          <Slider
            value={chatContentWidth()}
            min={CHAT_WIDTH_MIN}
            max={CHAT_WIDTH_MAX}
            step={CHAT_WIDTH_STEP}
            onChange={({ value }) => setPref(CHAT_WIDTH_PREF, Math.round(typeof value === "number" ? value : value[0]))}
            accessibilityLabel={t("settings.chatContentWidth")}
            style={{ width: 160 }}
            rangeStyle={sliderFill(0, widthFraction())}
            {...sliderLook()}
          />
          <Text class={sliderValueClass} style={sliderValueStyle()}>{`${chatContentWidth()} pt`}</Text>
          <Button
            label={t("common.reset")}
            variant="secondary"
            size="small"
            disabled={chatContentWidth() === CHAT_WIDTH_DEFAULT}
            onPress={() => setPref(CHAT_WIDTH_PREF, CHAT_WIDTH_DEFAULT)}
          />
        </SettingsRow>

        <SettingsRow
          testID="setting-background-opacity"
          label={t("settings.backgroundOpacity")}
          detail={t("settings.backgroundOpacityDescription")}
        >
          <Slider
            value={backgroundOpacity()}
            min={BACKGROUND_OPACITY_MIN}
            max={BACKGROUND_OPACITY_MAX}
            step={BACKGROUND_OPACITY_STEP}
            onChange={({ value }) => setPref(
              BACKGROUND_OPACITY_PREF,
              Math.round(typeof value === "number" ? value : value[0]),
            )}
            accessibilityLabel={t("settings.backgroundOpacity")}
            style={{ width: 160 }}
            rangeStyle={sliderFill(
              0,
              (backgroundOpacity() - BACKGROUND_OPACITY_MIN) / (BACKGROUND_OPACITY_MAX - BACKGROUND_OPACITY_MIN),
            )}
            {...sliderLook()}
          />
          <Text class={sliderValueClass} style={sliderValueStyle()}>{`${backgroundOpacity()}%`}</Text>
          <Button
            label={t("common.reset")}
            variant="secondary"
            size="small"
            disabled={backgroundOpacity() === BACKGROUND_OPACITY_DEFAULT}
            onPress={() => setPref(BACKGROUND_OPACITY_PREF, BACKGROUND_OPACITY_DEFAULT)}
          />
        </SettingsRow>

        <SettingsRow
          testID="setting-enter-send"
          label={t("settings.enterSendMode")}
          detail={t("settings.enterSendModeDescription")}
        >
          <SettingsSelect
            items={[
              { value: "enter", title: t("settings.enterSendModeEnter") },
              { value: "ctrlEnter", title: t("settings.enterSendModeCtrlEnter") },
            ]}
            value={enterSendMode()}
            onChange={(value) => {
              if (value === "enter" || value === "ctrlEnter") setEnterSendMode(value);
            }}
            label={t("settings.enterSendMode")}
            title={enterSendMode() === "ctrlEnter" ? t("settings.enterSendModeCtrlEnter") : t("settings.enterSendModeEnter")}
          />
        </SettingsRow>
      </SettingsCard>

      <SettingsCard
        title={t("settings.tools")}
        subtitle={t("settings.toolsSubtitle")}
      >
        <If when={tools.error()}>
          <SettingsError>{errorText(tools.error())}</SettingsError>
        </If>
        <If when={tools.loading()}>
          <SettingsLoading label={t("settings.loadingToolSettings")} />
        </If>
        <If when={tools() !== undefined && tools()?.isWindows === false}>
          <SettingsNote>{t("settings.powerShellWindowsOnly")}</SettingsNote>
        </If>
        <If when={tools()?.isWindows === true}>
          <SettingsRow
            first
            label={t("settings.powerShell")}
            detail={t("settings.powerShellDetail")}
          >
            <SettingsSwitch
              value={tools()?.powerShellEnabled === true}
              disabled={saving() !== null}
              label={t("settings.usePowerShell")}
              onChange={(on) => void apply("powerShell", { enabled: on })}
            />
          </SettingsRow>
        </If>
        <SettingsRow
          first={tools()?.isWindows !== true}
          label={t("settings.codeMode")}
          detail={t("settings.codeModeDetail")}
        >
          <SettingsSwitch
            value={tools()?.codemode === "always"}
            disabled={saving() !== null || tools() === undefined}
            label={t("settings.codeModeAlways")}
            onChange={(on) => void apply("codemode", { codemode: on ? "always" : "automatic" })}
          />
        </SettingsRow>
        <SettingsRow
          testID="setting-tool-preset"
          label={t("settings.toolPreset")}
          detail={t("settings.toolPresetDescription")}
        >
          <SettingsSelect
            items={(Object.keys(TOOL_PRESET_CHOICE_LABEL_KEYS) as ToolPresetChoice[]).map((choice) => ({
              value: choice,
              title: t(TOOL_PRESET_CHOICE_LABEL_KEYS[choice]),
            }))}
            value={defaultToolPreset()}
            onChange={(value) => {
              if (value && Object.prototype.hasOwnProperty.call(TOOL_PRESET_CHOICE_LABEL_KEYS, value)) {
                setDefaultToolPreset(value as ToolPresetChoice);
              }
            }}
            label={t("settings.toolPreset")}
            title={t(TOOL_PRESET_CHOICE_LABEL_KEYS[defaultToolPreset()])}
          />
        </SettingsRow>
        <If when={error()}>
          <SettingsError>{errorText(error())}</SettingsError>
        </If>
      </SettingsCard>

      <SettingsCard
        title={t("settings.chatNotices")}
        subtitle={t("settings.chatNoticesSubtitle")}
      >
        <SettingsRow
          first
          testID="setting-completion-sound"
          label={t("settings.completionSound")}
          detail={t("settings.completionSoundDescription")}
        >
          <SettingsSwitch
            value={completionSoundEnabled()}
            label={t("settings.completionSound")}
            onChange={(on) => setCompletionSoundEnabled(on)}
          />
        </SettingsRow>
        <SettingsRow
          testID="setting-completion-notifications"
          label={t("settings.completionNotifications")}
          detail={t("settings.completionNotificationsDescription")}
        >
          <SettingsSwitch
            value={completionNotificationsEnabled()}
            label={t("settings.completionNotifications")}
            onChange={(on) => setCompletionNotificationsEnabled(on)}
          />
        </SettingsRow>
        <SettingsRow
          label={t("settings.cacheMissNotices")}
          detail={t("settings.cacheMissNoticesDetail")}
        >
          <SettingsSwitch
            value={cacheMiss()?.enabled === true}
            disabled={cacheMiss() === undefined || cacheSaving()}
            label={t("settings.cacheMissNotices")}
            onChange={(on) => void saveCacheMiss(on)}
          />
        </SettingsRow>
        <SettingsRow
          label={t("settings.thinkingExpandedDefault")}
          detail={t("settings.thinkingDisplayDescription")}
        >
          <SettingsSwitch
            value={thinkingExpanded()}
            label={t("settings.thinkingExpandedDefault")}
            onChange={(on) => setPref("pi-thinking-expanded", on)}
          />
        </SettingsRow>
        <If when={cacheMiss.loading() && cacheMiss() === undefined}>
          <SettingsLoading label={t("settings.loadingNoticeSetting")} />
        </If>
        <If when={cacheMiss.error()}>
          <SettingsError>{errorText(cacheMiss.error())}</SettingsError>
        </If>
        <If when={cacheError()}>
          <SettingsError>{cacheError() ?? ""}</SettingsError>
        </If>
      </SettingsCard>

      {/**
        pi on this machine. A web or mobile build has no login shell to look
        through; the card says so itself (`pi/install.ts`), which keeps the
        row honest instead of hiding a capability behind a build flag.
      */}
      <SettingsCard title={t("settings.piGroup")} subtitle={t("settings.piSubtitle")}>
          <SettingsRow
            first
            testID="setting-pi"
            label={t("settings.piVersion")}
            detail={piVersionLine()}
            note={
              <View style={{ gap: 2 }}>
                <If when={piDetailLine() !== ""}>
                  <SettingsNote>{piDetailLine()}</SettingsNote>
                </If>
                <SettingsNote>{piStatusLine()}</SettingsNote>
                <If when={piUntestedLine() !== null}>
                  <SettingsNote tone="warn">{piUntestedLine() ?? ""}</SettingsNote>
                </If>
                <If when={piLogLine() !== null}>
                  <SettingsNote>{piLogLine() ?? ""}</SettingsNote>
                </If>
              </View>
            }
          >
            <Button
              label={t("settings.piCheck")}
              icon="undo"
              variant="secondary"
              size="small"
              disabled={pi.loading() || piLatest.loading() || piUpdating()}
              onPress={() => {
                pi.refetch();
                piLatest.refetch();
              }}
            />
            <Button
              label={piUpdating() ? t("settings.piUpdating") : t("settings.piUpdate")}
              variant="secondary"
              size="small"
              busy={piUpdating()}
              disabled={pi() === undefined || pi()?.kind !== "ready" || piUpdating()}
              onPress={() => void runPiUpdate()}
            />
          </SettingsRow>
          <If when={pi.error()}>
            <SettingsError>{errorText(pi.error())}</SettingsError>
          </If>
        </SettingsCard>

      <SettingsCard
        title={t("settings.aboutGroup")}
        subtitle={t("settings.aboutSubtitle")}
      >
        <SettingsRow
          first
          label={t("settings.appVersion")}
          detail={versionText()}
          note={
            <View style={{ gap: 2 }}>
              <SettingsNote>{updateText()}</SettingsNote>
              <If when={appUpdate.error()}>
                <SettingsError>{errorText(appUpdate.error())}</SettingsError>
              </If>
              <If when={releaseError()}>
                <SettingsError>{releaseError() ?? ""}</SettingsError>
              </If>
            </View>
          }
        >
          <Button
            label={t("settings.checkAgain")}
            icon="undo"
            variant="secondary"
            size="small"
            disabled={appUpdate.loading()}
            onPress={() => appUpdate.refetch()}
          />
          <Button
            label={t("settings.openReleasePage")}
            icon="external"
            variant="secondary"
            size="small"
            busy={openingRelease()}
            disabled={!appUpdate()?.releaseUrl || openingRelease()}
            onPress={() => void openRelease()}
          />
        </SettingsRow>
      </SettingsCard>

      {/* TODO(nsh): the desktop shell's web access (the Electron main process's
          LAN switch) has no route in this app yet; it lives in Devices. */}
      <SettingsNote>{t("settings.generalFooter")}</SettingsNote>
    </View>
  );
}

"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "./v3/Icon";
import { useI18n } from "@/hooks/useI18n";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useTheme } from "@/hooks/useTheme";
import { THEME_OPTIONS } from "@/lib/theme";
import {
  CHAT_CONTENT_WIDTH_DEFAULT,
  CHAT_CONTENT_WIDTH_MAX,
  CHAT_CONTENT_WIDTH_MIN,
  CHAT_CONTENT_FONT_SIZE_DEFAULT,
  CHAT_CONTENT_FONT_SIZE_MAX,
  CHAT_CONTENT_FONT_SIZE_MIN,
  BACKGROUND_OPACITY_DEFAULT,
  BACKGROUND_OPACITY_MAX,
  BACKGROUND_OPACITY_MIN,
  useChatAppearance,
} from "@/hooks/useChatAppearance";
import { useEnterSendMode, setEnterSendMode } from "@/hooks/useEnterSendMode";
import { sendAgentCommand } from "@/lib/agent-client";
import type { ProjectTrustStatus, ToolSettingsResponse } from "@/lib/api-types";
import {
  setLastSettingsSection,
  settingsSectionRequiresProject,
  type SettingsSection,
} from "@/lib/settings-navigation";
import { focusModalPanel, listenForPanelEscape } from "@/lib/stacked-dialog";
import {
  isThinkingExpandedByDefault,
  setThinkingExpandedByDefault,
} from "@/lib/thinking-expansion-preference";
import { ModelsConfig } from "./ModelsConfig";
import { setupPushSubscription } from "@/lib/push-client";
import { getDesktopSettings, isDesktopShell, setDesktopWebAccess, type DesktopSettings } from "@/lib/desktop-shell";
import { SkillsConfig } from "./SkillsConfig";
import { AgentsConfig } from "./AgentsConfig";
import { PluginsConfig } from "./PluginsConfig";
import { McpConfig } from "./McpConfig";
import { ConfigSwitch } from "./SettingsUi";
import { FontSettings } from "./FontSettings";
import {
  TOOL_PRESET_CHOICES,
  TOOL_PRESET_CHOICE_LABEL_KEYS,
  TOOL_PRESET_CHOICE_VALUES,
  toolPresetChoiceTools,
  type ToolPresetChoice,
} from "@/lib/tool-presets";
import { getPreferredToolPreset, setPreferredToolPreset } from "@/lib/tool-preset-preference";
import { ensureNotificationPermission, useCompletionNotifications } from "@/lib/notification-preference";

interface Props {
  cwd: string | null;
  sessionId: string | null;
  initialSection: SettingsSection;
  onClose: () => void;
  onSessionReloaded: () => void;
  quoteSelectionEnabled: boolean;
  onQuoteSelectionChange: (enabled: boolean) => void;
  /** The page's trust status for `cwd`; Settings › MCP reloads when it changes, as after trusting. */
  projectTrust?: ProjectTrustStatus | null;
  /** Opens the page's trust dialog for `cwd`, above Settings; Settings › MCP's trust notice offers it. */
  onOpenTrustDialog?: () => void;
  /** Settings › MCP added a project server, which changed `cwd`'s trust (and may have trusted a fresh folder). */
  onProjectTrustChanged?: (cwd: string, status: ProjectTrustStatus) => void;
  /** The page's completion chime: the composer used to carry the switch, moved to General. */
  soundEnabled?: boolean;
  onSoundToggle?: () => void;
}

/* 画板的左导航图标是 `<svg class="ic"><use href="#i-…">`（`design/v3/boards/web-settings-mcp.html`），
   不是每个分区手写一份 `<path>`。手写的那套已经和画板对不上（结构 diff 里 6 条偏差全在图标上），
   所以这里回到 sprite：名字按画板 `.set-row` 的顺序一一对应。 */
const SECTION_ICON: Record<SettingsSection, string> = {
  general: "gear",
  models: "circle-dotted",
  skills: "sparkle",
  agents: "person-2",
  plugins: "puzzle",
  mcp: "puzzle",
};

export function SettingsSectionIcon({ section }: { section: SettingsSection; size?: number; strokeWidth?: number }) {
  return <Icon name={SECTION_ICON[section] ?? "gear"} />;
}

function GeneralSettings({ sessionId, onSessionReloaded, quoteSelectionEnabled, onQuoteSelectionChange, soundEnabled, onSoundToggle }: Pick<Props, "sessionId" | "onSessionReloaded" | "quoteSelectionEnabled" | "onQuoteSelectionChange" | "soundEnabled" | "onSoundToggle">) {
  const { locale, setLocale, supportedLocales, t } = useI18n();
  const { preference, setThemePreference } = useTheme();
  const {
    width: chatContentWidth, setWidth: setChatContentWidth,
    fontSize, setFontSize,
    backgroundOpacity, setBackgroundOpacity,
  } = useChatAppearance();
  const enterSendMode = useEnterSendMode();
  const { enabled: notificationsEnabled, setEnabled: setNotificationsEnabled } = useCompletionNotifications();
  const [shellSettings, setShellSettings] = useState<ToolSettingsResponse | null>(null);
  const [shellSaving, setShellSaving] = useState(false);
  const [shellError, setShellError] = useState<string | null>(null);
  const [thinkingExpanded, setThinkingExpanded] = useState(false);
  const [cacheMissNotices, setCacheMissNotices] = useState<boolean | null>(null);
  const [cacheMissNoticesSaving, setCacheMissNoticesSaving] = useState(false);
  const [cacheMissNoticesError, setCacheMissNoticesError] = useState<string | null>(null);
  const [pushRegistering, setPushRegistering] = useState(false);
  const [pushStatus, setPushStatus] = useState<{ kind: "ok" | "error"; message: string } | null>(null);
  // 桌面壳自己的设置：浏览器里没有这条，也不该有。
  const desktopShell = isDesktopShell();
  const [desktopSettings, setDesktopSettings] = useState<DesktopSettings | null>(null);
  const [desktopWebBusy, setDesktopWebBusy] = useState(false);
  const [desktopWebNote, setDesktopWebNote] = useState<string | null>(null);
  useEffect(() => {
    if (!desktopShell) return;
    let cancelled = false;
    void getDesktopSettings().then((settings) => {
      if (!cancelled) setDesktopSettings(settings);
    });
    return () => { cancelled = true; };
  }, [desktopShell]);
  // The composer no longer carries a tool switch: the default for new sessions
  // is chosen here, where the tools each preset pins can be listed.
  const [toolChoice, setToolChoice] = useState<ToolPresetChoice>("configured");
  useEffect(() => {
    const preset = getPreferredToolPreset();
    setToolChoice(TOOL_PRESET_CHOICES.find((choice) => TOOL_PRESET_CHOICE_VALUES[choice] === preset) ?? "configured");
  }, []);
  const chooseToolPreset = (choice: ToolPresetChoice) => {
    setPreferredToolPreset(TOOL_PRESET_CHOICE_VALUES[choice]);
    setToolChoice(choice);
  };
  const toolChoiceTools = toolPresetChoiceTools(toolChoice);

  useEffect(() => {
    setThinkingExpanded(isThinkingExpandedByDefault());
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/tools/settings")
      .then(async (response) => {
        const data = await response.json() as ToolSettingsResponse & { error?: string };
        if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
        if (!cancelled) setShellSettings(data);
      })
      .catch((cause) => {
        if (!cancelled) setShellError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/cache-miss-notices")
      .then(async (response) => {
        const data = await response.json() as { enabled?: boolean; error?: string };
        if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
        if (!cancelled) setCacheMissNotices(data.enabled === true);
      })
      .catch((cause) => {
        if (!cancelled) setCacheMissNoticesError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => { cancelled = true; };
  }, []);

  // pi's showCacheMissNotices (#1265); the open chat is read again to show or drop them.
  const toggleCacheMissNotices = async (enabled: boolean) => {
    setCacheMissNoticesSaving(true);
    setCacheMissNoticesError(null);
    try {
      const response = await fetch("/api/cache-miss-notices", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      const data = await response.json() as { enabled?: boolean; error?: string };
      if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
      setCacheMissNotices(data.enabled === true);
      if (sessionId) onSessionReloaded();
    } catch (cause) {
      setCacheMissNoticesError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setCacheMissNoticesSaving(false);
    }
  };

  const togglePowerShell = async (enabled: boolean) => {
    setShellSaving(true);
    setShellError(null);
    try {
      const response = await fetch("/api/tools/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      const data = await response.json() as ToolSettingsResponse & { error?: string };
      if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
      setShellSettings(data);
      if (sessionId) {
        await sendAgentCommand(sessionId, { type: "reload" });
        onSessionReloaded();
      }
    } catch (cause) {
      setShellError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setShellSaving(false);
    }
  };

  const toggleDesktopWebAccess = async (next: boolean) => {
    setDesktopWebBusy(true);
    setDesktopWebNote(null);
    const result = await setDesktopWebAccess(next);
    setDesktopWebBusy(false);
    if (!result) {
      setDesktopWebNote(t("settings.webAccessError"));
      return;
    }
    setDesktopSettings((previous) => previous ? { ...previous, webAccess: result.webAccess } : previous);
    setDesktopWebNote(t(result.requiresRestart ? "settings.webAccessRestart" : "settings.webAccessSaved"));
  };

  const registerPush = async () => {
    if (pushRegistering) return;
    setPushRegistering(true);
    setPushStatus(null);
    try {
      if (typeof window === "undefined" || !("Notification" in window)) {
        throw new Error("unsupported or not permitted");
      }
      const permission = Notification.permission === "default"
        ? await Notification.requestPermission()
        : Notification.permission;
      if (permission !== "granted") throw new Error("unsupported or not permitted");
      const ok = await setupPushSubscription(locale);
      if (!ok) throw new Error("unsupported or not permitted");
      setPushStatus({ kind: "ok", message: t("settings.pushRegistered") });
    } catch (cause) {
      setPushStatus({ kind: "error", message: `${t("settings.pushRegisterFailed")} ${cause instanceof Error ? cause.message : String(cause)}` });
    } finally {
      setPushRegistering(false);
    }
  };

  /* 通用页就是画板 design/v3/boards/web-settings-general.html 的那一屏：`.set-content__inner` >
     `.set-h1` + `.set-sub` + 若干 `.set-section`（标题 + `.card` > `.crow`/`.cdivider`）。
     控件一律用画板原语：开关 `.switch`、分段 `.seg`、数值 `.mono`、按钮 `.btn`、主题网格
     `.theme-grid` > `.theme-tile`。视觉值全部来自 app/v3/running.css，产品侧只留滚动语义。 */
  return (
    <div className="set-content__inner settings-general">
      <h1 className="set-h1">{t("settings.general")}</h1>
      <p className="set-sub">{t("settings.generalDescription")}</p>

      <section className="set-section">
        <h2 className="set-section__title">{t("settings.themeSection")}</h2>
        <div className="card">
          {/* `.theme-tile` 在画板里是 `<button>`；这里用 `<label>` 包住真的 radio，37 套调色板
              才能用方向键走、只占一个 Tab。色块自己带 `data-theme`，用该调色板的 --bg/--accent
              画成画板 tileSwatch 的斜渐变。 */}
          <div className="theme-grid" role="radiogroup" aria-label={t("settings.appearance")}>
            {THEME_OPTIONS.map((option) => {
              const selected = preference === option.id;
              return (
                <label
                  key={option.id}
                  title={t(option.label)}
                  className={`theme-tile${selected ? " is-on" : ""}`}
                >
                  <input
                    type="radio"
                    name="theme"
                    value={option.id}
                    checked={selected}
                    onChange={() => setThemePreference(option.id)}
                    className="sr-only"
                  />
                  {option.id === "auto" ? (
                    // 跟随系统不是一套调色板：色块左右两半各用浅色、深色的底色。
                    <span className="theme-tile__sw settings-theme-auto" aria-hidden="true">
                      <span data-theme="light" />
                      <span data-theme="dark" />
                    </span>
                  ) : (
                    <span className="theme-tile__sw" data-theme={option.id} aria-hidden="true" />
                  )}
                  <span className="theme-tile__name">{t(option.label)}</span>
                  {option.scheme && (
                    <span className="theme-tile__detail">
                      {t(option.scheme === "light" ? "settings.themeLight" : "settings.themeDark")}
                    </span>
                  )}
                </label>
              );
            })}
          </div>
          <div className="cdivider" />
          <div className="crow">
            <div className="crow__text">
              <div className="crow__title">
                <label htmlFor="settings-background-opacity">{t("settings.backgroundOpacity")}</label>
              </div>
              <div className="crow__desc">{t("settings.backgroundOpacityDescription")}</div>
            </div>
            <div className="crow__control">
              <span className="mono">{backgroundOpacity}%</span>
              <input
                id="settings-background-opacity"
                type="range"
                min={BACKGROUND_OPACITY_MIN}
                max={BACKGROUND_OPACITY_MAX}
                step={1}
                value={backgroundOpacity}
                onChange={(event) => setBackgroundOpacity(Number(event.target.value))}
              />
              <button
                type="button"
                className="btn"
                title={t("settings.resetBackgroundOpacity")}
                aria-label={t("settings.resetBackgroundOpacity")}
                disabled={backgroundOpacity === BACKGROUND_OPACITY_DEFAULT}
                onClick={() => setBackgroundOpacity(BACKGROUND_OPACITY_DEFAULT)}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8M3 3v5h5" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="set-section">
        <h2 className="set-section__title">{t("settings.typography")}</h2>
        <p id="settings-typography-description" className="set-sub">{t("settings.fontDescription")}</p>
        <div className="card">
          {/* FontSettings 自己就是画板里的一串 `.crow`（两行字体 + 行间 `.cdivider`），
              所以这里不再包一层行，否则会套出双份 11/16 内边距。 */}
          <FontSettings />
          <div className="cdivider" />
          <div className="crow">
            <div className="crow__text">
              <div className="crow__title">
                <label htmlFor="settings-chat-content-font-size">{t("settings.chatContentFontSize")}</label>
              </div>
            </div>
            <div className="crow__control">
              <span className="mono">{fontSize}px</span>
              <input
                id="settings-chat-content-font-size"
                type="range"
                min={CHAT_CONTENT_FONT_SIZE_MIN}
                max={CHAT_CONTENT_FONT_SIZE_MAX}
                step={1}
                value={fontSize}
                onChange={(event) => setFontSize(Number(event.target.value))}
              />
              <button
                type="button"
                className="btn"
                title={t("settings.resetChatContentFontSize")}
                aria-label={t("settings.resetChatContentFontSize")}
                disabled={fontSize === CHAT_CONTENT_FONT_SIZE_DEFAULT}
                onClick={() => setFontSize(CHAT_CONTENT_FONT_SIZE_DEFAULT)}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8M3 3v5h5" />
                </svg>
              </button>
            </div>
          </div>
          <div className="cdivider" />
          <div className="crow">
            <div className="crow__text">
              <div className="crow__title">
                <label htmlFor="settings-chat-content-width">{t("settings.chatContentWidth")}</label>
              </div>
            </div>
            <div className="crow__control">
              <span className="mono">{chatContentWidth}px</span>
              <input
                id="settings-chat-content-width"
                type="range"
                min={CHAT_CONTENT_WIDTH_MIN}
                max={CHAT_CONTENT_WIDTH_MAX}
                step={10}
                value={chatContentWidth}
                onChange={(event) => setChatContentWidth(Number(event.target.value))}
              />
              <button
                type="button"
                className="btn"
                title={t("settings.resetChatContentWidth")}
                aria-label={t("settings.resetChatContentWidth")}
                disabled={chatContentWidth === CHAT_CONTENT_WIDTH_DEFAULT}
                onClick={() => setChatContentWidth(CHAT_CONTENT_WIDTH_DEFAULT)}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8M3 3v5h5" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="set-section">
        <h2 className="set-section__title">{t("settings.tools")}</h2>
        <div className="card">
          <div className="crow">
            <div className="crow__text">
              <div className="crow__title">{t("settings.toolPreset")}</div>
              <div className="crow__detail">{t("settings.toolPresetDescription")}</div>
              <div className="crow__detail" id="settings-tool-preset-tools">
                {toolChoiceTools === null
                  ? t("settings.toolPresetConfiguredTools")
                  : toolChoiceTools.length === 0
                    ? t("settings.toolPresetNoTools")
                    : t("settings.toolPresetTools", { tools: toolChoiceTools.join(" · ") })}
              </div>
            </div>
            <div className="crow__control">
              <div className="seg" role="radiogroup" aria-label={t("settings.toolPreset")} aria-describedby="settings-tool-preset-tools">
                {TOOL_PRESET_CHOICES.map((choice) => (
                  <button
                    key={choice}
                    type="button"
                    role="radio"
                    aria-checked={toolChoice === choice}
                    className={toolChoice === choice ? "is-on" : undefined}
                    onClick={() => chooseToolPreset(choice)}
                  >
                    {t(TOOL_PRESET_CHOICE_LABEL_KEYS[choice])}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="set-section">
        <h2 className="set-section__title">{t("settings.chat")}</h2>
        <div className="card">
          <div className="crow">
            <div className="crow__text">
              <div className="crow__title">{t("settings.thinkingExpandedDefault")}</div>
            </div>
            <div className="crow__control">
              <ConfigSwitch
                checked={thinkingExpanded}
                label={t("settings.thinkingExpandedDefault")}
                onChange={(enabled) => {
                  setThinkingExpandedByDefault(enabled);
                  setThinkingExpanded(enabled);
                }}
              />
            </div>
          </div>
          <div className="cdivider" />
          <div className="crow">
            <div className="crow__text">
              <div className="crow__title">{t("settings.quoteSelection")}</div>
            </div>
            <div className="crow__control">
              <ConfigSwitch
                checked={quoteSelectionEnabled}
                label={t("settings.quoteSelection")}
                onChange={onQuoteSelectionChange}
              />
            </div>
          </div>
          <div className="cdivider" />
          <div className="crow">
            <div className="crow__text">
              <div className="crow__title">{t("settings.completionSound")}</div>
            </div>
            <div className="crow__control">
              <ConfigSwitch
                checked={Boolean(soundEnabled)}
                label={t("settings.completionSound")}
                onChange={() => onSoundToggle?.()}
              />
            </div>
          </div>
          <div className="cdivider" />
          <div className="crow">
            <div className="crow__text">
              <div className="crow__title">{t("settings.completionNotifications")}</div>
              <div className="crow__detail">{t("settings.completionNotificationsDescription")}</div>
            </div>
            <div className="crow__control">
              <ConfigSwitch
                checked={notificationsEnabled}
                label={t("settings.completionNotifications")}
                onChange={(next) => {
                  setNotificationsEnabled(next);
                  // 打开的那一刻就申请权限：等真跑完再弹框，用户正看着别处。
                  if (next) void ensureNotificationPermission();
                }}
              />
            </div>
          </div>
          <div className="cdivider" />
          <div className="crow">
            <div className="crow__text">
              <div className="crow__title">{t("settings.enterSendMode")}</div>
            </div>
            <div className="crow__control">
              <div className="seg" role="radiogroup" aria-label={t("settings.enterSendMode")}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={enterSendMode === "enter"}
                  className={enterSendMode === "enter" ? "is-on" : undefined}
                  onClick={() => setEnterSendMode("enter")}
                >
                  {t("settings.enterSendModeEnter")}
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={enterSendMode === "ctrlEnter"}
                  className={enterSendMode === "ctrlEnter" ? "is-on" : undefined}
                  onClick={() => setEnterSendMode("ctrlEnter")}
                >
                  {t("settings.enterSendModeCtrlEnter")}
                </button>
              </div>
            </div>
          </div>
          <div className="cdivider" />
          <div className="crow">
            <div className="crow__text">
              <div className="crow__title">{t("settings.cacheMissNotices")}</div>
              <div className="crow__detail" id="settings-cache-miss-notices-description">
                {t("settings.cacheMissNoticesDescription")}
              </div>
            </div>
            <div className="crow__control">
              <ConfigSwitch
                checked={cacheMissNotices === true}
                loading={(cacheMissNotices === null && !cacheMissNoticesError) || cacheMissNoticesSaving}
                label={t("settings.cacheMissNotices")}
                describedBy="settings-cache-miss-notices-description"
                onChange={(enabled) => void toggleCacheMissNotices(enabled)}
              />
            </div>
          </div>
        </div>
        {cacheMissNoticesError && <p role="alert" className="settings-general-error">{cacheMissNoticesError}</p>}
      </section>

      {shellSettings?.isWindows && (
        <section className="set-section">
          <h2 className="set-section__title">{t("settings.shellTool")}</h2>
          <div className="card">
            <div className="crow">
              <div className="crow__text">
                <div className="crow__title">{t("settings.usePowerShell")}</div>
                <div className="crow__detail">{t("settings.shellToolDescription")}</div>
              </div>
              <div className="crow__control">
                <ConfigSwitch
                  checked={shellSettings.powerShellEnabled}
                  loading={shellSaving}
                  label={t("settings.usePowerShell")}
                  onChange={(enabled) => void togglePowerShell(enabled)}
                />
              </div>
            </div>
          </div>
          {shellError && <p role="alert" className="settings-general-error">{shellError}</p>}
        </section>
      )}

      {desktopShell && desktopSettings && (
        <section className="set-section">
          <h2 className="set-section__title">{t("settings.desktop")}</h2>
          <div className="card">
            <div className="crow">
              <div className="crow__text">
                <div className="crow__title">{t("settings.webAccess")}</div>
                <div className="crow__detail">{t("settings.webAccessDescription", { port: desktopSettings.webAccessPort })}</div>
              </div>
              <div className="crow__control">
                <ConfigSwitch
                  checked={desktopSettings.webAccess}
                  disabled={desktopWebBusy}
                  loading={desktopWebBusy}
                  label={t("settings.webAccess")}
                  onChange={(next) => void toggleDesktopWebAccess(next)}
                />
              </div>
            </div>
          </div>
          {desktopWebNote && (
            <p role="status" className="settings-general-error" style={{ color: "var(--accent)" }}>{desktopWebNote}</p>
          )}
        </section>
      )}

      {!desktopShell && (
      <section className="set-section">
        <h2 className="set-section__title">{t("settings.pushPermission")}</h2>
        <div className="card">
          <div className="crow">
            <div className="crow__text">
              <div className="crow__detail">{t("settings.pushPermissionDescription")}</div>
            </div>
            <div className="crow__control">
              <button
                type="button"
                className="btn"
                disabled={pushRegistering}
                onClick={() => void registerPush()}
              >
                {pushRegistering ? t("settings.pushRegisterLoading") : t("settings.pushRegister")}
              </button>
            </div>
          </div>
        </div>
        {pushStatus && (
          <p
            role="status"
            className="settings-general-error"
            style={pushStatus.kind === "ok" ? { color: "var(--accent)" } : undefined}
          >
            {pushStatus.message}
          </p>
        )}
      </section>
      )}

      <section className="set-section">
        <h2 className="set-section__title">{t("common.language")}</h2>
        <div className="card">
          <div className="crow">
            <div className="crow__text">
              <div className="crow__detail">{t("settings.languageDescription")}</div>
            </div>
            <div className="crow__control">
              <div className="seg" role="radiogroup" aria-label={t("common.language")}>
                {supportedLocales.map((plugin) => (
                  <button
                    key={plugin.id}
                    type="button"
                    role="radio"
                    aria-checked={locale === plugin.id}
                    className={locale === plugin.id ? "is-on" : undefined}
                    onClick={() => setLocale(plugin.id as typeof locale)}
                  >
                    {plugin.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

export function SettingsPanel({
  cwd,
  sessionId,
  initialSection,
  onClose,
  onSessionReloaded,
  quoteSelectionEnabled,
  onQuoteSelectionChange,
  projectTrust,
  onOpenTrustDialog,
  onProjectTrustChanged,
  soundEnabled,
  onSoundToggle,
}: Props) {
  const { t } = useI18n();
  // 桌面用画板的 1060×760 玻璃弹窗；手机上设置是整页，保持原样。
  const isMobile = useIsMobile();
  const [section, setSection] = useState<SettingsSection>(initialSection);
  // 手机：画板 pwa-settings 是「分区列表 → 分区详情」两级。深入链接（例如 MCP 通知）
  // 直接开到那一页，其他情况先给列表。
  const [mobilePage, setMobilePage] = useState<SettingsSection | null>(initialSection === "general" ? null : initialSection);
  // 画板 web-settings 的 `.set-search`：按名字过滤左边的页列表。
  const [navQuery, setNavQuery] = useState("");
  const [mountedSections, setMountedSections] = useState<ReadonlySet<SettingsSection>>(
    () => new Set([section]),
  );
  // Which sections need a project is decided once, in lib/settings-navigation.ts.
  const sections: { id: SettingsSection; label: string; requiresProject: boolean }[] = ([
    { id: "general", label: t("settings.general") },
    { id: "models", label: t("common.models") },
    { id: "skills", label: t("common.skills") },
    { id: "agents", label: t("common.agents") },
    { id: "plugins", label: t("common.plugins") },
    { id: "mcp", label: t("settings.mcp") },
  ] as const).map((item) => ({ ...item, requiresProject: settingsSectionRequiresProject(item.id) }));
  const sectionRequiresProject = settingsSectionRequiresProject(section);

  useEffect(() => setLastSettingsSection(initialSection), [initialSection]);

  // Bubble phase, unless something nearer handled the key. The trust dialog,
  // which opens above Settings, takes Escape in the capture phase and stops it,
  // so one Escape closes that dialog and leaves Settings open.
  useEffect(() => listenForPanelEscape(document, onClose), [onClose]);

  // Focus moves into Settings as it opens and back to what had it once it closes. Left
  // on the chat composer (a bare /mcp opens Settings from there), Escape would reach the
  // composer first and stop a running agent, which also kept Settings open. A layout
  // effect, so the opener is read before a section focuses its own search box.
  const dialogRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => focusModalPanel(document, dialogRef.current, {
    restoreTextEntry: !window.matchMedia?.("(pointer: coarse)").matches,
  }), []);

  useEffect(() => {
    if (cwd || !sectionRequiresProject) return;
    setSection("general");
    setMountedSections((current) => new Set(current).add("general"));
    setLastSettingsSection("general");
  }, [cwd, sectionRequiresProject]);

  const activateSection = (nextSection: SettingsSection) => {
    setMountedSections((current) => new Set(current).add(nextSection));
    setSection(nextSection);
    setLastSettingsSection(nextSection);
  };

  // 画板 web-settings-* 每一页都有 h1 + sub；模型/技能/子代理/插件/MCP 这五个
  // list-detail 页自身没有头，在外壳上补一行（常规页自带）。
  const SECTION_PAGE_COPY: Partial<Record<SettingsSection, { title: string; sub: string }>> = {
    models: { title: t("common.models"), sub: t("settings.pageSubModels") },
    skills: { title: t("common.skills"), sub: t("settings.pageSubSkills") },
    agents: { title: t("common.agents"), sub: t("settings.pageSubAgents") },
    plugins: { title: t("common.plugins"), sub: t("settings.pageSubPlugins") },
    mcp: { title: t("settings.mcp"), sub: t("settings.pageSubMcp") },
  };
  const sectionHost = (id: SettingsSection, content: ReactNode) => mountedSections.has(id) ? (
    <div
      key={id}
      hidden={section !== id}
      className={`settings-section-host${SECTION_PAGE_COPY[id] ? " has-page-head" : ""}`}
    >
      {SECTION_PAGE_COPY[id] && (
        <header className="config-page-head">
          <div className="config-page-head__inner">
            <h1 className="set-h1">{SECTION_PAGE_COPY[id]!.title}</h1>
            <p className="set-sub">{SECTION_PAGE_COPY[id]!.sub}</p>
          </div>
        </header>
      )}
      {content}
    </div>
  ) : null;

  /* 六个分区的内容只写一遍：手机外壳和桌面外壳都渲染这一份。 */
  const sectionContent = (
    <>
          {sectionHost("general", <GeneralSettings sessionId={sessionId} onSessionReloaded={onSessionReloaded} quoteSelectionEnabled={quoteSelectionEnabled} onQuoteSelectionChange={onQuoteSelectionChange} soundEnabled={soundEnabled} onSoundToggle={onSoundToggle} />)}
          {sectionHost("models", <ModelsConfig embedded cwd={cwd} onClose={onClose} />)}
          {/* Visited sections stay mounted, so the ones whose answer depends on trust take the page's
              status and load again in place when trusting from Settings › MCP changes it. */}
          {cwd && sectionHost("skills", <SkillsConfig embedded key={cwd} cwd={cwd} trust={projectTrust} onClose={onClose} />)}
          {cwd && sectionHost("agents", <AgentsConfig embedded key={cwd} cwd={cwd} sessionId={sessionId} trust={projectTrust} onClose={onClose} onReloaded={onSessionReloaded} />)}
          {cwd && sectionHost("plugins", <PluginsConfig embedded key={cwd} cwd={cwd} sessionId={sessionId} trust={projectTrust} onClose={onClose} onReloaded={onSessionReloaded} />)}
          {/* No project needed: the global mcp.json is listed alone, and a project adds its group. */}
          {sectionHost("mcp", <McpConfig embedded key={cwd ?? ""} cwd={cwd} trust={projectTrust} onTrustProject={onOpenTrustDialog} onProjectTrustChanged={onProjectTrustChanged} onClose={onClose} />)}
    </>
  );

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={t("settings.title")}
      tabIndex={-1}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
      className={`settings-dialog-backdrop${isMobile ? "" : " modal-scrim"}`}
      // 画板的遮罩是半透明的；定位仍固定全屏（.modal-scrim 是 absolute）。
      style={isMobile ? undefined : { position: "fixed" }}
    >
      {/* 画板 design/v3/boards/web-settings-mcp.html：`.settings-modal > .set-nav-col + .set-content`。
          桌面用左侧竖导航；手机保留原生 select（拇指够得着，也不用横滚）。 */}
      <div className={`settings-dialog-surface${isMobile ? "" : " settings-modal"}`}>
        {isMobile ? (
          mobilePage === null ? (
            /* 画板 pwa-settings：整页 = 标题 + 关闭 + 分区列表（图标 · 名字 · chevron）。 */
            <div className="m-settings">
              <div className="settings-dialog-header">
                <strong className="settings-dialog-title">{t("settings.title")}</strong>
                <button type="button" onClick={onClose} title={t("i18n.close")} aria-label={t("i18n.close")} className="config-close-button settings-dialog-close">×</button>
              </div>
              <nav aria-label={t("settings.title")} className="m-settings-list">
                {sections.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="m-setrow"
                    disabled={item.requiresProject && !cwd}
                    onClick={() => {
                      activateSection(item.id);
                      setMobilePage(item.id);
                    }}
                  >
                    <SettingsSectionIcon section={item.id} />
                    <span className="m-setrow__text">{item.label}</span>
                    <Icon name="chevron-right" />
                  </button>
                ))}
              </nav>
            </div>
          ) : (
            <>
              <div className="settings-dialog-header">
                <button
                  type="button"
                  className="settings-dialog-back"
                  onClick={() => setMobilePage(null)}
                  title={t("settings.back")}
                  aria-label={t("settings.back")}
                >
                  <Icon name="chevron-left" />
                </button>
                <strong className="settings-dialog-title">
                  {sections.find((item) => item.id === mobilePage)?.label ?? t("settings.title")}
                </strong>
                <button type="button" onClick={onClose} title={t("i18n.close")} aria-label={t("i18n.close")} className="config-close-button settings-dialog-close">×</button>
              </div>
              <main className="settings-dialog-main">{sectionContent}</main>
            </>
          )
        ) : (
          <aside className="set-nav-col">
            <div className="set-modal-head">
              <span className="set-modal-title">{t("settings.title")}</span>
              <button type="button" onClick={onClose} title={t("i18n.close")} aria-label={t("i18n.close")} className="cbtn cbtn--sm">×</button>
            </div>
            <div className="set-search">
              <label className="field">
                <Icon name="search" />
                <input
                  value={navQuery}
                  onChange={(event) => setNavQuery(event.target.value)}
                  placeholder={t("settings.searchPlaceholder")}
                  aria-label={t("settings.searchPlaceholder")}
                />
              </label>
            </div>
            <nav aria-label={t("settings.title")} className="set-nav">
              {sections
                .filter((item) => !navQuery.trim() || item.label.toLocaleLowerCase().includes(navQuery.trim().toLocaleLowerCase()))
                .map((item) => {
                const selected = section === item.id;
                const disabled = item.requiresProject && !cwd;
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`set-row${selected ? " is-on" : ""}`}
                    disabled={disabled}
                    title={disabled ? t("settings.projectRequired") : item.label}
                    aria-current={selected ? "page" : undefined}
                    onClick={() => activateSection(item.id)}
                  >
                    <SettingsSectionIcon section={item.id} />
                    {item.label}
                  </button>
                );
              })}
              {navQuery.trim() && !sections.some((item) => item.label.toLocaleLowerCase().includes(navQuery.trim().toLocaleLowerCase())) && (
                <span className="set-row__empty">{t("settings.noMatch")}</span>
              )}
            </nav>
          </aside>
        )}

        {!isMobile && (
          <main className="settings-dialog-main set-content">
            {/* 画板的 640 内容列由各分区自己带（常规页的根就是 `.set-content__inner`）；
                模型/技能/MCP 这些 list-detail 面板要的是整幅 set-content，套进 640 列会被压扁裁掉。 */}
            {sectionContent}
          </main>
        )}
      </div>
    </div>
  );
}

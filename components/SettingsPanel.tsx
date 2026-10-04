"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useDialogA11y } from "@/hooks/useDialogA11y";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useI18n } from "@/hooks/useI18n";
import { useTheme } from "@/hooks/useTheme";
import { THEME_OPTIONS } from "@/lib/theme";
import {
  CHAT_CONTENT_WIDTH_DEFAULT,
  CHAT_CONTENT_WIDTH_MAX,
  CHAT_CONTENT_WIDTH_MIN,
  useChatAppearance,
} from "@/hooks/useChatAppearance";
import { sendAgentCommand } from "@/lib/agent-client";
import type { ShellToolSettingsResponse } from "@/lib/api-types";
import { setLastSettingsSection, SETTINGS_SECTIONS, type SettingsSection } from "@/lib/settings-navigation";
import { getDesktopBridge } from "@/lib/desktop-shell";
import {
  isThinkingExpandedByDefault,
  setThinkingExpandedByDefault,
} from "@/lib/thinking-expansion-preference";
import {
  clearTitleModel,
  getTitleAutoEnabled,
  getTitleModel,
  setTitleAutoEnabled,
  setTitleModel,
} from "@/lib/title-settings";
import { ModelsConfig } from "./ModelsConfig";
import { McpConfig } from "./fork/McpConfig";
// fork:proma-43-automation — 定时任务面板（embedded 形态，组件自带页框）。
import { AutomationPanel } from "./fork/AutomationPanel";
// fork:zc-03 — new sections rendered by this panel.
import { UsageStatsPanel } from "./fork/UsageStatsPanel";
// fork:phone-push — 手机配对 + IM 推送，合成一个分节（机器级，不依赖项目）。
import { PhoneAndPushPanel } from "./fork/PhoneAndPushPanel";
import { setupPushSubscription } from "@/lib/push-client";
import { SkillsConfig } from "./SkillsConfig";
/* fork:disabled-reasons —— 「为什么不能点」的文案。与 AgentsConfig
 * 共用同一份「一个模型都没有」口径（NO_MODEL_PROVIDERS_HINT），避免同一个原因在三个
 * 分节里说成三句话；`localCopy` 与文案表都定义在 AgentsConfig，理由见那里的注释。
 * 语言包在 lib/i18n/messages/**（这一轮不允许改 lib/），所以这几条走本地表而不是 t()。 */
import { AgentsConfig } from "./AgentsConfig";
import { NO_MODEL_PROVIDERS_HINT, localCopy, type LocalCopy } from "./settings-disabled-reasons";
import { PluginsConfig } from "./PluginsConfig";
// fork:send-key（G6）—— 「发送键」偏好行（自带 hook，故单文件）。
import { EnterSendModeSetting } from "./EnterSendModeSetting";
import {
  PwBlock,
  PwCtl,
  PwField,
  PwRadio,
  PwRange,
  PwSelectBox,
  PwSwitch,
  PwValue,
  SettingsPage,
} from "./SettingsUi";
import { WallpaperSettings } from "./WallpaperSettings";
// fork:upstream-0.9.3-retry-settings —— settings.retry 的三个控件（画板 40 帧 1 / 62 帧 C 末块）。
import { RetrySettingsBlock } from "./RetrySettingsBlock";
// fork:pr12-a5-context-budget —— settings.compaction / settings.branchSummary 的预算块。
import { ContextBudgetSettingsBlock } from "./ContextBudgetSettingsBlock";
// fork:proma-33-shortcut-guide —— 快捷键地图入口（一行 + 弹层，自带 open 状态，故单文件）。
import { ShortcutGuideEntry } from "./fork/ShortcutGuideEntry";
import { THEME_SKIN_DEFAULT_ID, currentSkinMode } from "@/lib/theme-skins";
import { ProjectArchivePanel } from "./ProjectArchivePanel";
import { ImportPanel } from "./ImportPanel";
import { useBorderDepth } from "@/hooks/useBorderDepth";
import { useUiDensity } from "@/hooks/useUiDensity";
// fork:v5-landing Wave B · M-05 —— 手机端设置的两层导航：hub 卡片表（分组、副行、
// 「需项目」徽章）。窄屏才渲染，桌面那条左导航一个字不动。
import {
  SETTINGS_HUB_GROUPS,
  settingsHubHeroCopy,
  settingsHubNeedsProjectCopy,
  settingsHubSectionHint,
} from "./pwa/settingsHub";
// fork:zn-15 — 外观页的四项（Zeno appearance）。
import { useRailTranslucent } from "@/hooks/useRailTranslucent";
import { useNotificationPrefs } from "@/hooks/useNotificationPrefs";
// fork:zn-19 — 主题皮肤（卡片条 + 编辑主题对话框）。
import { useThemeSkins } from "@/hooks/useThemeSkins";
import { ThemeSkinStrip } from "./ThemeSkinStrip";
import { ThemeSkinStudio } from "./ThemeSkinStudio";
import { createSkinDraft, readCurrentSkinBase, serializeSkinForExport, type ThemeSkin } from "@/lib/theme-skins";
import { useUiFont } from "@/hooks/useUiFont";
import { UI_FONT_SIZE_OPTIONS } from "@/lib/ui-font";
import { USER_TEXT_SIZE_OPTIONS } from "@/lib/typography";
// fork:zn-18 — 系统字体枚举（Local Font Access → canvas 探测）。
import { SYSTEM_FONT_ID, listInstalledUiFonts, type FontChoice } from "@/lib/font-discovery";
import { SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH } from "@/lib/panel-layout";
import type { UiDensity } from "@/lib/ui-density";
import {
  loadStepExpansion,
  setStepCategoryExpanded,
  type StepExpansion,
} from "@/lib/process-step-expansion";
import { BORDER_DEPTH_MAX, BORDER_DEPTH_MIN } from "@/lib/border-depth";

interface Props {
  cwd: string | null;
  sessionId: string | null;
  initialSection: SettingsSection;
  /** fork:proma-32-skill-usage —— 从本轮的 skill chip 进来时，要定位到的那一个 slug。 */
  focusSkillSlug?: string | null;
  onClose: () => void;
  onSessionReloaded: () => void;
  quoteSelectionEnabled: boolean;
  onQuoteSelectionChange: (enabled: boolean) => void;
  /** fork:ui-archive-history — open the session picked in the archive history. */
  onOpenSession?: (sessionId: string) => void;
  /** fork:zn-15 — 外观页的「侧边栏宽度」滑块要直接驱动轨宽，所以由 AppShell 注入
   *  （宽度由 `useResizablePanel` 拥有，重开一份 state 会两边打架）。 */
  sidebarWidth?: number;
  onSidebarWidthChange?: (px: number) => void;
  /** fork:zn-16 — 通知声音与 composer 的声音按钮是同一个开关，所以从 AppShell 注入
   *  （`useAudio` 持有 AudioContext，开第二份会让两个按钮各说各话）。 */
  soundEnabled?: boolean;
  onSoundToggle?: (enabled: boolean) => void;
}

/** fork:design-system SW-07 —— 设置左导航的分节图标（画板 40）。
 *
 *  一律走画板的图标集：`icons.js` 的 243 枚 lucide，经 `<i data-ico>` 水合。
 *  这里原先有 13 段手绘 SVG，其中 agents 那枚还靠 `transform: scale(1.25)` 补尺寸
 *  （自绘路径按 24×24 画，缩到 16px 时笔画偏细）——换成画板图标后补丁不再需要。
 *  名称与画板 40 的左导航逐项一致，顺序也一致。 */
const SECTION_ICON_BY_ID: Record<string, string> = {
  general: "sliders-horizontal",
  models: "cpu",
  skills: "box",
  agents: "bot",
  plugins: "blocks",
  mcp: "server",
  automation: "calendar-clock",
  usage: "chart-column",
  archived: "archive",
  import: "import",
  // fork:phone-push —— 原来这一节没有图标映射，左导航博回 `settings`（齿轮）：
  // 「手机与推送」挂齿轮既读不出意思，也和 V5 画板（smartphone）对不上。
  phonePush: "smartphone",
};

/** fork:design-system SW-07 — 画板 40「主题」三档的芯片图标（sun / moon / monitor）。
 *  原先这里是 `ThemeIcon` 手绘的三个 SVG（`components/ThemeIcon.tsx`），
 *  画板图标集里本来就有同名三枚，已退役。 */
const THEME_ICON_BY_ID: Record<string, string> = {
  light: "sun",
  dark: "moon",
  auto: "monitor",
};

/** fork:disabled-reasons —— 命名模型下拉加载失败（与「一台机器没配供应商」分开说）。 */
const TITLE_MODEL_LIST_FAILED: LocalCopy = {
  en: "Could not load the model list: {error}. The title model falls back to the session model until this succeeds.",
  "zh-CN": "模型列表加载失败：{error}。在那之前，命名模型会退回使用会话自身的模型。",
  "zh-TW": "模型清單載入失敗：{error}。在那之前，命名模型會退回使用工作階段自身的模型。",
};

/** fork:disabled-reasons —— 「发送测试通知」在桌面通知总开关关闭时恒 disabled。 */
const NOTIFY_TEST_NEEDS_MASTER: LocalCopy = {
  en: "Turn on Desktop notifications first — this button sends a real system notification through that switch.",
  "zh-CN": "先打开上面的「桌面通知」总开关——这枚按钮发的是走那个开关的真实系统通知。",
  "zh-TW": "先打開上面的「桌面通知」總開關——這顆按鈕送的是走那個開關的真實系統通知。",
};

/** fork:disabled-reasons —— 已经是默认值时「重置」没有可做的事。 */
const CHAT_WIDTH_ALREADY_DEFAULT: LocalCopy = {
  en: "Already at the default width — nothing to reset.",
  "zh-CN": "已经是默认宽度，没有可重置的改动。",
  "zh-TW": "已經是預設寬度，沒有可重設的改動。",
};

export function SettingsSectionIcon({ section, size = 16 }: { section: SettingsSection; size?: number; strokeWidth?: number }) {
  return <i data-ico={SECTION_ICON_BY_ID[section] ?? "settings"} data-size={size} aria-hidden="true" />;
}

/** fork:v5-landing Wave B · M-05 —— 窄屏分节二级页左上角那枚返回箭头的无障碍名。
 *  语言包里没有单独的「返回」键（`settings.backToWorkspace` 已被 2026-10-03 裁定删掉用法），
 *  复述按钮自己的名字比留一个 `aria-label=""` 好。与 `pwa/settingsHub.ts` 同一口径：
 *  这一轮不允许改 `lib/i18n/messages/**`。 */
const PHONE_BACK_LABEL: LocalCopy = {
  en: "Back to settings",
  "zh-CN": "返回设置",
  "zh-TW": "返回設定",
};

/**
 * D2-PR-22：会话自动命名设置（开关 + 命名模型）。
 * 单独成一个组件而不是直接展开进 GeneralSettings：聊天分区现有行的数量与
 * 开关结构由 UI 门禁测试固定（SettingsPanel.test.mjs 只统计该分区的行），
 * 这里复用同一套 settings-chat-* 样式类，但作为独立控件组渲染。
 */
function TitleSettingsControls({ cwd }: { cwd: string | null }) {
  const { locale, t } = useI18n();
  const [titleAuto, setTitleAuto] = useState(true);
  const [titleModel, setTitleModelState] = useState<{ provider: string; modelId: string } | null>(null);
  const [titleModelOptions, setTitleModelOptions] = useState<{ provider: string; modelId: string; label: string }[]>([]);
  /* fork:disabled-reasons —— 原来 `.catch` 与非 2xx 响应都被压成同一个空数组，
     于是一台没配供应商的机器上这个下拉恒为一项「使用会话模型」，页面上零提示。
     现在把「空」与「加载失败」分开，并各自给一句说明。 */
  const [titleModelList, setTitleModelList] = useState<
    { state: "loading" | "ready" | "empty" | "error"; error: string }
  >({ state: "loading", error: "" });

  // 读取命名开关/模型，并监听其他面板或窗口的 storage 广播。
  useEffect(() => {
    const syncTitleSettings = () => {
      setTitleAuto(getTitleAutoEnabled());
      setTitleModelState(getTitleModel());
    };
    syncTitleSettings();
    window.addEventListener("storage", syncTitleSettings);
    return () => window.removeEventListener("storage", syncTitleSettings);
  }, []);

  // 命名模型下拉的候选项复用现有 /api/models 拉取方式。
  useEffect(() => {
    const url = cwd ? `/api/models?cwd=${encodeURIComponent(cwd)}` : "/api/models";
    let cancelled = false;
    void fetch(url)
      .then(async (response) => {
        if (!response.ok) {
          const detail = await response.json().catch(() => null) as { error?: string } | null;
          throw new Error(detail?.error ?? `HTTP ${response.status}`);
        }
        return response.json() as Promise<{ modelList?: { id: string; name?: string; provider: string }[] }>;
      })
      .then((data) => {
        if (cancelled) return;
        const options = (data?.modelList ?? [])
          .filter((model) => model.id && model.provider)
          .map((model) => ({
            provider: model.provider,
            modelId: model.id,
            label: `${model.name || model.id} · ${model.provider}`,
          }))
          .sort((a, b) => a.label.localeCompare(b.label));
        setTitleModelOptions(options);
        setTitleModelList({ state: options.length === 0 ? "empty" : "ready", error: "" });
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setTitleModelOptions([]);
        setTitleModelList({
          state: "error",
          error: cause instanceof Error ? cause.message : String(cause),
        });
      });
    return () => { cancelled = true; };
  }, [cwd]);

  const setTitleAutoAndPersist = (enabled: boolean) => {
    setTitleAuto(enabled);
    setTitleAutoEnabled(enabled);
  };

  const setTitleModelAndPersist = (value: string) => {
    if (!value) {
      clearTitleModel();
      setTitleModelState(null);
      return;
    }
    const separator = value.indexOf(":");
    if (separator <= 0) return;
    const provider = value.slice(0, separator);
    const modelId = value.slice(separator + 1);
    setTitleModel(provider, modelId);
    setTitleModelState({ provider, modelId });
  };

  const titleModelValue = titleModel ? `${titleModel.provider}:${titleModel.modelId}` : "";

  return (
    <>
      {/* fork:design-system SW-07 — 画板 40 的「会话自动命名」+「命名用的模型」两行。 */}
      <PwField
        label={t("settings.titleAutoGenerate")}
        hint={t("settings.titleAutoGenerateDescription")}
        control={
          <PwSwitch
            checked={titleAuto}
            label={t("settings.titleAutoGenerate")}
            onChange={setTitleAutoAndPersist}
          />
        }
      />
      <PwField
        label={t("settings.titleModel")}
        hint={t("settings.titleModelDescription")}
        control={
          <PwSelectBox
            value={titleModelValue}
            ariaLabel={t("settings.titleModel")}
            options={[
              { value: "", label: t("settings.titleModelNone") },
              ...titleModelOptions.map((option) => ({
                value: `${option.provider}:${option.modelId}`,
                label: option.label,
              })),
            ]}
            onChange={setTitleModelAndPersist}
          />
        }
      />
      {/* fork:disabled-reasons —— 一句话讲清「为什么下拉里只有『使用会话模型』」。
          文案与 AgentsConfig 的空模型列表提示同源。 */}
      {titleModelList.state === "empty" && (
        <p className="d-t-xs d-t-faint">{localCopy(NO_MODEL_PROVIDERS_HINT, locale)}</p>
      )}
      {titleModelList.state === "error" && (
        <p className="d-t-xs d-t-faint">
          {localCopy(TITLE_MODEL_LIST_FAILED, locale, { error: titleModelList.error })}
        </p>
      )}
    </>
  );
}

function GeneralSettings({ cwd, sessionId, onSessionReloaded, quoteSelectionEnabled, onQuoteSelectionChange, sidebarWidth, onSidebarWidthChange, soundEnabled = true, onSoundToggle }: Pick<Props, "cwd" | "sessionId" | "onSessionReloaded" | "quoteSelectionEnabled" | "onQuoteSelectionChange" | "sidebarWidth" | "onSidebarWidthChange" | "soundEnabled" | "onSoundToggle">) {
  const { locale, setLocale, supportedLocales, t } = useI18n();
  const { preference, setThemePreference } = useTheme();
  const { borderDepth, setBorderDepth } = useBorderDepth();
  const { uiDensity, setUiDensity } = useUiDensity();
  // fork:zn-15 — Zeno 外观页的四项：侧边栏半透明 / 侧边栏宽度 / UI 字体 / UI 字号。
  const { railTranslucent, setRailTranslucent } = useRailTranslucent();
  // fork:zn-16 — Zeno 通知页的开关矩阵。
  const { notificationPrefs, setNotificationPref } = useNotificationPrefs();
  /* fork:zn-19 — 皮肤：列表 + 当前选中 + 正在编辑的草稿。
     编辑器状态放这里而不是放 Studio 里：Studio 是纯受控的，只负责「编」，保存/删除
     由设置页决定谁被改。
     `editing` 为 `{ skin, isNew }`，null 表示对话框关着。 */
  const { skins, activeId, setActive, upsertSkin, removeSkin } = useThemeSkins();
  // fork:zn-19-merge — 壁纸子区块要知道「现在是不是皮肤在接管」，以及编辑的是哪一套。
  const activeSkin = skins.find((item) => item.id === activeId) ?? null;
  const [editing, setEditing] = useState<{ skin: ThemeSkin; isNew: boolean } | null>(null);
  const { fontStack, fontSize: uiFontSize, setFontStack, setFontSize: setUiFontSize } = useUiFont();
  const [stepExpansion, setStepExpansion] = useState<StepExpansion>(loadStepExpansion);
  const { width: chatContentWidth, setWidth: setChatContentWidth, fontSize, setFontSize, extensionWidgetFontSize, setExtensionWidgetFontSize } = useChatAppearance();
  const [shellSettings, setShellSettings] = useState<ShellToolSettingsResponse | null>(null);
  const [shellSaving, setShellSaving] = useState(false);
  const [shellError, setShellError] = useState<string | null>(null);
  const [thinkingExpanded, setThinkingExpanded] = useState(false);
  const [pushRegistering, setPushRegistering] = useState(false);
  const [pushStatus, setPushStatus] = useState<{ kind: "ok" | "error"; message: string } | null>(null);

  /* fork:zn-15 — 「UI 字号」下拉的档位。逐 px 列会让 12–16 有五个选项，
     这是 Zeno 的粒度（它的字体设置也是逐 px）。 */
  const [notificationNote, setNotificationNote] = useState("");

  // fork:disabled-reasons — 「重置（聊天内容宽度）」的禁用判据抽出来，好让
  // `disabled` 与 `title` 共用同一个（两者不一致就会出现「不可点但写着功能名」）。
  const chatWidthAtDefault = chatContentWidth === CHAT_CONTENT_WIDTH_DEFAULT;

  /* fork:zn-16 — 两个动作按钮。
     「发送测试通知」发一条真的系统通知（走 `Notification`，桌面外壳则由
     `lib/browser-notifications.ts` 优先走原生通道）。 */
  const sendTestNotification = async (): Promise<void> => {
    setNotificationNote("");
    if (!("Notification" in window)) {
      setNotificationNote(t("settings.notifyOpenSystemUnavailable"));
      return;
    }
    let permission = Notification.permission;
    if (permission === "default") {
      permission = await Notification.requestPermission();
    }
    if (permission !== "granted") {
      setNotificationNote(t("settings.notifyOpenSystemUnavailable"));
      return;
    }
    new Notification(t("settings.notifyTestTitle"), {
      body: t("settings.notifyTestBody"),
      tag: "pi-notification-test",
    });
  };

  /* fork:zn-16 — 「打开系统通知设置」。
     桌面外壳里可以直接把系统面板拉起来（`openExternal` 认这两个 URI）；
     浏览器里没有这个页面 —— 说清楚去哪调，比给一个点了没反应的按钮好。 */
  const openSystemNotificationSettings = async (): Promise<void> => {
    setNotificationNote("");
    const bridge = getDesktopBridge();
    if (!bridge) {
      setNotificationNote(t("settings.notifyOpenSystemUnavailable"));
      return;
    }
    const target = bridge.platform === "win32"
      ? "ms-settings:notifications"
      : "x-apple.systempreferences:com.apple.preference.notifications";
    bridge.openExternal(target);
  };

  /* fork:zn-18 — 本机字体清单。枚举是异步的（Local Font Access 要 await），
     所以先只放「系统默认」，拿到清单再补 —— 下拉不会空窗。 */
  const [fontChoices, setFontChoices] = useState<FontChoice[]>([
    { id: SYSTEM_FONT_ID, stack: "", label: t("settings.uiFontSystem") },
  ]);
  const [fontsLoading, setFontsLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    void listInstalledUiFonts(t("settings.uiFontSystem"))
      .then((choices) => {
        if (!cancelled) setFontChoices(choices);
      })
      .finally(() => {
        if (!cancelled) setFontsLoading(false);
      });
    return () => { cancelled = true; };
  }, [t]);

  useEffect(() => {
    setThinkingExpanded(isThinkingExpandedByDefault());
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/tools/settings")
      .then(async (response) => {
        const data = await response.json() as ShellToolSettingsResponse & { error?: string };
        if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
        if (!cancelled) setShellSettings(data);
      })
      .catch((cause) => {
        if (!cancelled) setShellError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => { cancelled = true; };
  }, []);

  const togglePowerShell = async (enabled: boolean) => {
    setShellSaving(true);
    setShellError(null);
    try {
      const response = await fetch("/api/tools/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      const data = await response.json() as ShellToolSettingsResponse & { error?: string };
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

  return (
    <>
        {/* fork:settings-frame（画板 62 帧 C，用户拍板）—— 常规页 = 两栏块流，每栏 570，
            字段行「标签—控件」跨度从 1160 收到 570。块的排列：
              左 = 外观 → 主题皮肤 →（2026-10-03 用户裁定）默认外观壁纸 → 侧栏 → 界面字体
                    （62 帧 C 把「界面语言」排进这块；壁纸原在右栏，挪到皮肤下面——皮肤会接管
                    壁纸，紧挨着才看得见「谁在管」）
              右 = 聊天 → 通知 →（产品实有、画板 40 续帧的两块）Shell 工具（仅 Windows）
                    → 后台推送 */}
        <div className="d-set-inner">
          <div>
      {/* fork:design-system SW-07 —— 画板 40 第一块「外观」：主题是 `.pw-radio` 三档
          （图标 sun / moon / monitor 与画板同源），边框深度是 `.pw-ctl`（滑块 +
          等宽读数 + 重置钮，与画板「聊天内容宽度」那一行同一形态）。 */}
      <PwBlock icon="palette" title={t("settings.appearance")}>
        <PwField
          label={t("settings.theme")}
          hint={t("settings.appearanceDescription")}
          control={
            <PwRadio
              value={preference}
              ariaLabel={t("settings.theme")}
              options={THEME_OPTIONS.map((option) => ({
                value: option.id,
                label: t(option.label),
                icon: THEME_ICON_BY_ID[option.id],
              }))}
              onChange={setThemePreference}
            />
          }
        />
        <PwField
          label={t("settings.borderDepth")}
          hint={t("settings.borderDepthDescription")}
          htmlFor="settings-border-depth"
          control={
            <PwCtl>
              <PwRange
                id="settings-border-depth"
                value={borderDepth}
                displayValue={String(borderDepth)}
                min={BORDER_DEPTH_MIN}
                max={BORDER_DEPTH_MAX}
                ariaLabel={t("settings.borderDepth")}
                onChange={setBorderDepth}
              />
              <button
                type="button"
                className="d-btn sm"
                title={t("settings.borderDepthTheme")}
                onClick={() => setBorderDepth(50)}
              >
                {t("settings.reset")}
              </button>
            </PwCtl>
          }
        />
      </PwBlock>

      {/* fork:zn-19 / fork:design-system SW-07 —— 主题皮肤：卡片条 + 导入 / 导出 /
          打开皮肤工作室，DOM 是画板 40/47 的 `.pw-skin-strip` + `.pw-inline.pw-skin-actions`
          （长说明「皮肤会接管壁纸与强调色…」照画板排在动作行右端，见 ThemeSkinStrip）。
          fork:settings-frame 2026-10-01 —— 原先补在块底的那句「为什么导出/工作室不可点」
          膏药已撤：ThemeSkinStrip 的 fork:fix-disabled-title 把原因写在了两枚禁用钮的
          title 上（`settings.skinActionsNeedCustom`），同一句话不再出现两处。 */}
      <PwBlock icon="wand-sparkles" title={t("settings.skinLibrary")}>
        <ThemeSkinStrip
          skins={skins}
          activeId={activeId}
          onSelect={setActive}
          onCreate={() => {
            // 新皮肤的起点 = **当前实际渲染的基色**（读 computed 再转 hex），
            // 而不是一套写死的色，也不是空值：空值会让四个色板全白，用户第一步
            // 得先把当前配色手工填回去。已经有生效的皮肤时用它的值，避免从皮肤
            // 派生出来的 oklch 又被 canvas 往返一次。
            const active = skins.find((item) => item.id === activeId);
            // fork:zn-19-variant — 起点写进**当前模式的变体**（而不是共享色）：
            // 这样切到另一套模式时它是空的，会回落到该模式的调色板，开关立刻看得见效果。
            const mode = currentSkinMode();
            const base = active?.background && active?.panel && active?.accent && active?.text
              ? { background: active.background, panel: active.panel, accent: active.accent, text: active.text }
              : readCurrentSkinBase();
            setEditing({
              skin: createSkinDraft(`skin-${Date.now().toString(36)}`, t("settings.skinNewTitle"), mode, {
                [mode]: { ...base },
              }),
              isNew: true,
            });
          }}
          onEdit={(id) => {
            const skin = skins.find((item) => item.id === id);
            if (skin) setEditing({ skin, isNew: false });
          }}
          onImport={(skin) => {
            // 导入的皮肤换一个 id：否则同 id 会把别人的皮肤覆盖掉。
            upsertSkin({ ...skin, id: `skin-${Date.now().toString(36)}` });
          }}
          onExport={(skin) => {
            const blob = new Blob([serializeSkinForExport(skin)], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = `${skin.name || skin.id}.json`;
            link.click();
            URL.revokeObjectURL(url);
          }}
        />
      </PwBlock>

      {/* fork:zn-19-merge —— 壁纸（画板 62 帧 C 的「默认外观壁纸」块）：启用开关 +
          当前壁纸行（缩略图 + 选择/更换/移除）都在 WallpaperSettings 里；有皮肤生效时
          它自己收成一条「去编辑皮肤」的提示。
          2026-10-03 用户裁定 —— 从右栏挪到主题皮肤**正下方**：皮肤会接管壁纸，两块相邻
          才看得出「当前是谁在管背景」；跨栏分开放要来回扫视。落位不再随右栏块流。 */}
      <PwBlock icon="wallpaper" title={t("settings.wallpaperDefaultTitle")}>
        <WallpaperSettings
          skinActive={activeSkin ? activeSkin.id !== THEME_SKIN_DEFAULT_ID : false}
          {...(activeSkin && activeSkin.id !== THEME_SKIN_DEFAULT_ID
            ? { onEditSkin: () => setEditing({ skin: activeSkin, isNew: false }) }
            : {})}
        />
      </PwBlock>

      {/* fork:zn-15 —— 外观 → 侧边栏：半透明开关 + 宽度滑块（画板 62 帧 C 左栏第三块）。 */}
      <PwBlock icon="panel-left" title={t("settings.railBlock")}>
        <PwField
          label={t("settings.railTranslucentRow")}
          hint={t("settings.sidebarTranslucentHint")}
          control={
            <PwSwitch
              checked={railTranslucent}
              label={t("settings.sidebarTranslucent")}
              onChange={setRailTranslucent}
            />
          }
        />
        <PwField
          label={t("settings.railWidthRow")}
          htmlFor="settings-sidebar-width"
          control={
            sidebarWidth == null || onSidebarWidthChange == null ? (
              <PwValue>{t("settings.sidebarWidthHint")}</PwValue>
            ) : (
              <PwCtl>
                <PwRange
                  id="settings-sidebar-width"
                  value={sidebarWidth}
                  displayValue={`${sidebarWidth} px`}
                  min={SIDEBAR_MIN_WIDTH}
                  max={SIDEBAR_MAX_WIDTH}
                  step={4}
                  ariaLabel={t("settings.sidebarWidth")}
                  onChange={onSidebarWidthChange}
                />
              </PwCtl>
            )
          }
        />
      </PwBlock>

      {/* fork:zn-18 —— 界面字体（画板 62 帧 C 左栏末块：UI 字体 + UI 字号 + 界面语言）。
          画板 62 帧 C 把「界面语言」排进这块（原独立「语言」块按 62 收编，语言行不
          带说明小字——「选择整个界面使用的语言」是标签的同义复述）；画板还画了
          「代码字体 / 代码等宽中文字体」两行，本产品没有这两个设置，不凭空造控件。 */}
      <PwBlock icon="type" title={t("settings.typographyBlock")}>
        <PwField
          label={t("settings.uiFont")}
          hint={fontsLoading ? t("settings.uiFontLoading") : t("settings.uiFontHint")}
          control={
            <PwSelectBox
              // value 是**字体栈**：空栈即系统默认。栈里含逗号与引号，直接当 option
              // 的 value 没问题（它是普通字符串），比较也走全等。
              value={fontStack}
              ariaLabel={t("settings.uiFont")}
              disabled={fontsLoading && fontChoices.length <= 1}
              options={fontChoices.map((choice) => ({
                value: choice.stack,
                label: choice.label,
              }))}
              onChange={(next) => setFontStack(next)}
            />
          }
        />
        <PwField
          label={t("settings.uiFontSize")}
          hint={t("settings.uiFontSizeHint")}
          control={
            <PwSelectBox
              value={String(uiFontSize)}
              ariaLabel={t("settings.uiFontSize")}
              options={UI_FONT_SIZE_OPTIONS.map((size) => ({
                value: String(size),
                label: `${size} px`,
              }))}
              onChange={(next) => setUiFontSize(Number(next))}
            />
          }
        />
        <PwField
          label={t("common.language")}
          control={
            <PwRadio
              value={locale}
              ariaLabel={t("common.language")}
              options={supportedLocales.map((plugin) => ({
                value: plugin.id as typeof locale,
                label: plugin.label,
              }))}
              onChange={(next) => setLocale(next)}
            />
          }
        />
      </PwBlock>
          </div>

          <div>

      {/* fork:design-system SW-07 —— 聊天块：画板 40 画的九行逐行对上。
          过程步骤的三个芯片在画板里是单选（`.pw-radio`），产品的语义是三个**独立**
          开关，所以保留画板的 DOM 与状态类，只把 ARIA 换成 `aria-pressed`
          （芯片组，不是单选组）——形态照画板，语义照产品。 */}
      <PwBlock icon="message-square" title={t("settings.chat")}>
        <TitleSettingsControls cwd={cwd} />
        <PwField
          label={t("settings.thinkingExpandedDefault")}
          hint={t("settings.thinkingDisplayDescription")}
          control={
            <PwSwitch
              checked={thinkingExpanded}
              label={t("settings.thinkingExpandedDefault")}
              onChange={(enabled) => {
                setThinkingExpandedByDefault(enabled);
                setThinkingExpanded(enabled);
              }}
            />
          }
        />
        <PwField
          label={t("settings.density")}
          hint={t("settings.densityHint")}
          control={
            <PwRadio
              value={uiDensity}
              ariaLabel={t("settings.density")}
              options={[
                { value: "compact" as UiDensity, label: t("settings.densityCompact") },
                { value: "standard" as UiDensity, label: t("settings.densityStandard") },
                { value: "comfortable" as UiDensity, label: t("settings.densityComfortable") },
              ]}
              onChange={setUiDensity}
            />
          }
        />
        <PwField
          label={t("settings.stepExpand")}
          hint={t("settings.stepExpandHint")}
          control={
            <PwCtl>
              <div className="d-cats">
                {([
                  ["reasoning", "settings.stepExpandReasoning", "brain"],
                  ["command", "settings.stepExpandCommand", "square-terminal"],
                  ["tool", "settings.stepExpandTool", "wrench"],
                ] as const).map(([category, labelKey, icon]) => {
                  const on = stepExpansion[category];
                  return (
                    <button
                      key={category}
                      type="button"
                      aria-pressed={on}
                      className={`d-cat${on ? " is-on" : ""}`}
                      onClick={() => setStepExpansion(setStepCategoryExpanded(category, !on))}
                    >
                      <i data-ico={icon} data-size="12" aria-hidden="true" />
                      {t(labelKey)}
                    </button>
                  );
                })}
              </div>
            </PwCtl>
          }
        />
        <PwField
          label={t("settings.chatContentWidth")}
          htmlFor="settings-chat-content-width"
          control={
            <PwCtl>
              <PwRange
                id="settings-chat-content-width"
                value={chatContentWidth}
                displayValue={`${chatContentWidth} px`}
                min={CHAT_CONTENT_WIDTH_MIN}
                max={CHAT_CONTENT_WIDTH_MAX}
                step={10}
                ariaLabel={t("settings.chatContentWidth")}
                onChange={setChatContentWidth}
              />
              <button
                type="button"
                className="d-btn sm"
                /* fork:disabled-reasons —— title 原来写的是功能名（不可点时等于
                   什么都没说）。不可点时改成写清「为什么」：已经是默认值。 */
                title={chatWidthAtDefault ? localCopy(CHAT_WIDTH_ALREADY_DEFAULT, locale) : t("settings.resetChatContentWidth")}
                disabled={chatWidthAtDefault}
                onClick={() => setChatContentWidth(CHAT_CONTENT_WIDTH_DEFAULT)}
              >
                {t("settings.reset")}
              </button>
            </PwCtl>
          }
        />
        <PwField
          label={t("settings.chatContentFontSize")}
          htmlFor="settings-chat-content-font-size"
          control={
            /* fork:type-scale（2026-09-30）—— 原先是 12–24 的 `<input type=range>`：
               连续值意味着用户能停在 14 / 16 / 24 上，而这三个都不在规范的五档里（实测当时
               composer 的输入框就是 14px）。改成与「界面字号」同一个下拉，选项由规范推导
               （12 / 13 / 15 / 20）；选 13 就是默认值，所以不再另给「重置」钮。 */
            <PwSelectBox
              value={String(fontSize)}
              ariaLabel={t("settings.chatContentFontSize")}
              options={USER_TEXT_SIZE_OPTIONS.map((size) => ({
                value: String(size),
                label: `${size} px`,
              }))}
              onChange={(next) => setFontSize(Number(next))}
            />
          }
        />
        <PwField
          label={t("settings.extensionWidgetFontSize")}
          htmlFor="settings-extension-widget-font-size"
          control={
            <PwSelectBox
              value={String(extensionWidgetFontSize)}
              ariaLabel={t("settings.extensionWidgetFontSize")}
              options={USER_TEXT_SIZE_OPTIONS.map((size) => ({
                value: String(size),
                label: `${size} px`,
              }))}
              onChange={(next) => setExtensionWidgetFontSize(Number(next))}
            />
          }
        />
        <PwField
          label={t("settings.quoteSelection")}
          control={
            <PwSwitch
              checked={quoteSelectionEnabled}
              label={t("settings.quoteSelection")}
              onChange={onQuoteSelectionChange}
            />
          }
        />
        {/* fork:send-key（G6 · 上游 `5df8278` #1001）—— 「发送键」跟在同一个聊天块
            末尾：它是输入框的行为，与上面几行同属「聊天」。自成一个组件是因为它带
            hook（useEnterSendMode），设置页不该为了一行偏好多背一个订阅。
            行数断言见 SettingsPanel.test.mjs：这一行是子组件，不计入本块的 PwField。 */}
        <EnterSendModeSetting />
      </PwBlock>

      {/* fork:zn-16 —— 通知（画板 62 帧 C 右栏第二块）：总开关 + 四条开关行 + 空标签
          动作行。fork:settings-frame 2026-10-01 —— 「任务完成 / 任务失败 / 仅在窗口
          未聚焦」三行不再渲染说明小字：语言包里的 hint 是标题的同义复述（用户实测
          截图「标题与副标题疑似重复」），画板 40/62 的这几行本来就只有标签；
          `notifySoundHint` 保留（它说明与输入框声音按钮是同一个开关，不是复述）。 */}
      <PwBlock icon="bell" title={t("settings.notificationBlock")}>
        <PwField
          label={t("settings.notifyMaster")}
          hint={t("settings.notifyMasterHint")}
          control={
            <PwSwitch
              checked={notificationPrefs.enabled}
              label={t("settings.notifyMaster")}
              onChange={(next) => setNotificationPref("enabled", next)}
            />
          }
        />
        <PwField
          label={t("settings.notifyOnComplete")}
          control={
            <PwSwitch
              checked={notificationPrefs.onComplete}
              disabled={!notificationPrefs.enabled}
              label={t("settings.notifyOnComplete")}
              onChange={(next) => setNotificationPref("onComplete", next)}
            />
          }
        />
        <PwField
          label={t("settings.notifyOnError")}
          control={
            <PwSwitch
              checked={notificationPrefs.onError}
              disabled={!notificationPrefs.enabled}
              label={t("settings.notifyOnError")}
              onChange={(next) => setNotificationPref("onError", next)}
            />
          }
        />
        <PwField
          label={t("settings.notifyOnlyUnfocused")}
          control={
            <PwSwitch
              checked={notificationPrefs.onlyWhenUnfocused}
              disabled={!notificationPrefs.enabled}
              label={t("settings.notifyOnlyUnfocused")}
              onChange={(next) => setNotificationPref("onlyWhenUnfocused", next)}
            />
          }
        />
        <PwField
          label={t("settings.notifySound")}
          hint={t("settings.notifySoundHint")}
          control={
            <PwSwitch
              checked={soundEnabled}
              label={t("settings.notifySound")}
              onChange={(next) => onSoundToggle?.(next)}
            />
          }
        />
        {/* 画板这一行是空 `.pw-label` + 两个动作钮，照抄。 */}
        <PwField
          label=""
          control={
            <PwCtl>
              <button
                type="button"
                className="d-btn sm"
                disabled={!notificationPrefs.enabled}
                title={notificationPrefs.enabled ? undefined : localCopy(NOTIFY_TEST_NEEDS_MASTER, locale)}
                onClick={() => void sendTestNotification()}
              >
                {t("settings.notifyTest")}
              </button>
              <button
                type="button"
                className="d-btn sm"
                onClick={() => void openSystemNotificationSettings()}
              >
                {t("settings.notifyOpenSystem")}
              </button>
            </PwCtl>
          }
        />
        {notificationNote ? (
          <div role="status" className="d-banner info">
            <i data-ico="info" data-size="14" aria-hidden="true" />
            <span className="d-grow">{notificationNote}</span>
          </div>
        ) : null}
      </PwBlock>

      {shellSettings?.isWindows && (
        <PwBlock icon="terminal" title={t("settings.shellTool")}>
          <PwField
            label={t("settings.usePowerShell")}
            hint={t("settings.shellToolDescription")}
            control={
              <PwSwitch
                checked={shellSettings.powerShellEnabled}
                loading={shellSaving}
                label={t("settings.usePowerShell")}
                onChange={(enabled) => void togglePowerShell(enabled)}
              />
            }
          />
          {shellError ? (
            <div role="alert" className="d-banner err">
              <i data-ico="triangle-alert" data-size="14" aria-hidden="true" />
              <span className="d-grow">{shellError}</span>
            </div>
          ) : null}
        </PwBlock>
      )}

      <PwBlock icon="bell" title={t("settings.pushPermission")}>
        <PwField
          label={t("settings.pushRegister")}
          hint={t("settings.pushPermissionDescription")}
          control={
            <button
              type="button"
              className="d-btn sm"
              disabled={pushRegistering}
              onClick={() => void registerPush()}
            >
              {pushRegistering ? t("settings.pushRegisterLoading") : t("settings.pushRegister")}
            </button>
          }
        />
        {pushStatus ? (
          <div role="status" className={pushStatus.kind === "ok" ? "d-banner info" : "d-banner err"}>
            <i data-ico={pushStatus.kind === "ok" ? "info" : "triangle-alert"} data-size="14" aria-hidden="true" />
            <span className="d-grow">{pushStatus.message}</span>
          </div>
        ) : null}
      </PwBlock>
          {/* fork:upstream-0.9.3-retry-settings —— 重试策略块排在推送块之后（右栏末位），
          与画板 40 帧 1 / 62 帧 C 右栏的落位一致。控件：开关 + 两个 `.pw-numin` 窄数值框。 */}
      <RetrySettingsBlock cwd={cwd} />
          {/* fork:pr12-a5-context-budget —— 上下文压缩预算块：pi 的
          settings.compaction.{reserveTokens,keepRecentTokens,modelOverrides} 与
          settings.branchSummary.reserveTokens 一直只在 settings.json 里（逐字段 setter 结论见
          lib/context-budget-settings.ts 头），设置页先前一个控件都没有。控件全是既有的：
          开关 + 三个 `.pw-numin` 窄数值框 + 模型覆盖行（`.pw-field` + 两个 `.pw-numin` + `.pw-iconbtn`）。 */}
      <ContextBudgetSettingsBlock cwd={cwd} />
          {/* 2026-10-02 用户裁定 —— 「思考档 token 预算」与「项目知识」两块连功能一起删除：
              组件、设置页入口、它们自己的 API 路由与 lib/ 写入路径、对应 i18n 键
              全部清掉了（`lib/thinking-budget-settings*.ts`、`lib/knowledge-*.ts`、
              `app/api/thinking-budget-settings/`、`app/api/knowledge-maintenance/`）。
              `lib/thinking-request-core.ts` 里的思考档核心逻辑不动 —— 那是模型请求
              的一部分，与这个设置块无关。 */}
          {/* fork:proma-33-shortcut-guide —— 快捷键地图入口排在上下文预算块之后（右栏末位，
          与上面三块同属「画板 62 帧 C 右栏之外的产品续块」）。本仓的快捷键**设置表**
          已按用户裁定下线（见 SettingsPanel.test.mjs 的分节图标用例），所以地图
          不挂在设置分节里，而是这块只有一行的入口按钮 —— 它只读，不做录制。 */}
      <ShortcutGuideEntry />
          </div>
        </div>

      {/* fork:design-system —— 本产品没有登录：整个「退出登录」分节删除
          （设计裁定 2026-09-28，见 design/pi-web-design/50-dialogs.html 与 DIVERGENCE 第 18 条）。 */}
      {editing ? (
        <ThemeSkinStudio
          skin={editing.skin}
          isNew={editing.isNew}
          onCancel={() => setEditing(null)}
          onSave={(skin) => {
            upsertSkin(skin);
            setActive(skin.id);
            setEditing(null);
          }}
          onDelete={(id) => {
            removeSkin(id);
            setEditing(null);
          }}
        />
      ) : null}
    </>
  );
}
// fork:zc-15 — the section keyword table moved into `lib/settings-navigation.ts`
export function SettingsPanel({ cwd, sessionId, initialSection, focusSkillSlug, onClose, onSessionReloaded, quoteSelectionEnabled, onQuoteSelectionChange, onOpenSession, sidebarWidth, onSidebarWidthChange, soundEnabled, onSoundToggle }: Props) {
  const { locale, t } = useI18n();
  const [section, setSection] = useState<SettingsSection>(initialSection);
  const [mountedSections, setMountedSections] = useState<ReadonlySet<SettingsSection>>(
    () => new Set([section]),
  );
  // fork:zc-15 — the section keyword table moved into `lib/settings-navigation.ts`
  //（fork:command-palette 又把它抽成了带 labelKey 的单一真值 `SETTINGS_SECTIONS`，
  //  两边读同一份，加分节不会再漏掉面板里的搜索入口）。
  const sections = SETTINGS_SECTIONS.map((entry) => ({
    id: entry.id,
    label: t(entry.labelKey),
    requiresProject: entry.requiresProject,
  }));

  useEffect(() => setLastSettingsSection(initialSection), [initialSection]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    if (cwd || (section !== "skills" && section !== "agents" && section !== "plugins")) return;
    setSection("general");
    setMountedSections((current) => new Set(current).add("general"));
    setLastSettingsSection("general");
  }, [cwd, section]);

  const activateSection = (nextSection: SettingsSection) => {
    setMountedSections((current) => new Set(current).add(nextSection));
    setSection(nextSection);
    setLastSettingsSection(nextSection);
  };

  /* fork:v5-landing Wave B · M-05 —— 手机端设置是**两层**：hub（按「什么时候来改它」
   * 分组的卡片）→ 分节二级页。桌面上那一层就是左导航列，所以桌面不需要第二份状态；
   * 窄屏进入设置先落在 hub（对应 M-05 帧 A），点一行才进二级页（帧 B / C）。
   * 惰挂载 / 常驻 / `hidden` 切换这套机制两端完全一样，只多了一个「当前看 hub 还是
   * 看某一节」的指针。 */
  const isMobile = useIsMobile();
  const [phoneSection, setPhoneSection] = useState<SettingsSection | null>(null);

  const openPhoneSection = (nextSection: SettingsSection) => {
    setPhoneSection(nextSection);
    activateSection(nextSection);
  };

  const backToPhoneHub = () => setPhoneSection(null);

  /** 当前**可见**的分节：桌面永远是 `section`；手机在 hub 上时是 `null`。 */
  const activeSection: SettingsSection | null = isMobile ? phoneSection : section;

  const sectionHost = (id: SettingsSection, content: ReactNode) => mountedSections.has(id) ? (
    <div
      key={id}
      /* fork:settings-modal-layout —— 分节 id 也落在内容宿主上：弹窗形态下有些分节的
         内列布局要按可用宽度降档（常规页的两栏块流），CSS 得有稳定的钩子，
         不能按 `.d-grid2` 一把梭（用量页的统计卡两栏是好的）。 */
      data-section={id}
      hidden={activeSection !== id}
      /* fork:design-system SW-07 —— 桌面：分节内容栏就是画板 D-07 的 `.d-set-main`。
         fork:motion-2026-10-01 —— 分节是懒挂载 + 常驻（切走只加 hidden），所以给
         **当前分节**挂 `fork-turn-enter`：分节刚被激活时重放一次整块替换
         （200ms + 8px）。此前切换分节是 `getAnimations() === []` 的硬切。
         fork:v5-landing Wave B —— 窄屏（M-05）：宿主保持无 display 的块（`hidden`
         才有效），真正的设置流是里层那个 `.m-settings`（灰底白卡 + 108px 顶栏让位）。
         `[hidden]` 的 UA 规则是作者层 `display` 的下位，所以外层绝不能挂任何
         带 `display` 的类 —— 这是本行两套类名分开写的硬理由。 */
      className={`settings-section-host${section === id ? " fork-turn-enter" : ""}`}
    >
      {isMobile ? <div className="m-settings">{content}</div> : <div className="d-set-main">{content}</div>}
    </div>
  ) : null;

  // fork:dsn-dialog-a11y — 这个弹层原先声明了 role/aria-modal 与 Esc（见上方 effect），
  // 但没有焦点约束：Tab 会走到背后的侧栏与输入框，关闭后焦点也不回到触发按钮。
  // 这里补上共享 hook（移焦 / Tab 循环 / inert 背景 / 还原焦点）；
  // Esc 仍由上面的 effect 处理，hook 也接管一份，两者幂等。
  const { dialogRef, dialogProps } = useDialogA11y({ open: true, onClose });

  return (
    <div
      ref={dialogRef}
      {...dialogProps}
      aria-label={t("settings.title")}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
      className="settings-dialog-backdrop"
    >
      {/* fork:design-components —— 设置壳直接用画板的 .pw-modal + .pw-settings
          （弹层阴影 / 200px 左列 + 内容区 grid 来自 board.css）。
          fork:motion-2026-10-01 —— 补 `anim-dialog`（弹层 160ms + 4px）：
          此前设置面板是 `animationName:none` 的硬切，与同类弹窗
          （ChatWindow 的 .anim-dialog）不一致 —— 动效诊断实测「打开设置面板完全没动」。 */}
      {/* fork:settings-modal-2026-10-02（用户裁定）—— 设置壳从**整屏页面**改成**弹窗**：
          去掉 `pw-modal`，回到 `.settings-dialog-surface` 自己的 1080×84vh + 圆角 + 阴影
          （见 app/settings.css 里那条注释）。关闭入口从页头里搬出来常驻右上角 ——
          页头在宽屏是 `display:none`（画板 40/45 没有页头，返回入口在左导航底部），
          原来关闭钮就藏在它里面，弹窗化后那样会没有可见的关闭口。 */}
      <div className="settings-dialog-surface anim-dialog">
        {/* fork:v5-landing Wave B · M-05 —— 窄屏顶栏（帧 B / 帧 C 的 `.m-top`）：
            hub 上只有标题 + 关闭；进了分节二级页，左上角**永远**是返回箭头
            （手机横向空间不够摆导航树，一次返回直接回 hub，不做迷宫）。
            `.m-top` 是 `position:absolute`，定位祖先就是 `.settings-dialog-surface`
            （app/settings.css 给它写了 `position: relative`），内容流靠
            `.m-settings` 的 108px 顶部内缩让它出来。 */}
        {isMobile ? (
          <>
            <div className="m-fade" aria-hidden="true" />
            <div className="m-top">
              {phoneSection ? (
                <button
                  type="button"
                  className="m-top-btn"
                  onClick={backToPhoneHub}
                  title={localCopy(PHONE_BACK_LABEL, locale)}
                  aria-label={localCopy(PHONE_BACK_LABEL, locale)}
                >
                  <i data-ico="chevron-left" data-size="16" aria-hidden="true" />
                </button>
              ) : null}
              <span className="m-top-title m-grow">
                {phoneSection
                  ? (sections.find((item) => item.id === phoneSection)?.label ?? t("settings.title"))
                  : t("settings.title")}
              </span>
              <button
                type="button"
                className="m-top-btn"
                onClick={onClose}
                title={t("i18n.close")}
                aria-label={t("i18n.close")}
              >
                <i data-ico="x" data-size="16" aria-hidden="true" />
              </button>
            </div>
          </>
        ) : (
          <>
        <button type="button" onClick={onClose} title={t("i18n.close")} aria-label={t("i18n.close")} className="config-close-button settings-dialog-close d-iconbtn">
          <i data-ico="x" data-size="14" aria-hidden="true"></i>
        </button>
        <div className="settings-dialog-header d-modal-head">
          <strong className="settings-dialog-title">{t("settings.title")}</strong>
          {/* fork:v5-landing Wave B —— 窄屏不再用这个下拉（那是本轮之前唯一的窄屏分节
              入口）：M-05 的两层导航取代了它，但 `settings-mobile-section-picker` 类与
              `app/settings.css` / `app/pwa-settings.css` 里的规则按纪律保留，
              收尾波再清。 */}
          <select
            aria-label={t("settings.title")}
            value={section}
            onChange={(event) => activateSection(event.target.value as SettingsSection)}
            className="settings-mobile-section-picker"
          >
            {sections.map((item) => (
              <option key={item.id} value={item.id} disabled={item.requiresProject && !cwd}>
                {item.label}
              </option>
            ))}
          </select>

          <button type="button" onClick={onClose} title={t("i18n.close")} aria-label={t("i18n.close")} className="config-close-button settings-dialog-close-mobile d-iconbtn">
            <i data-ico="x" data-size="14" aria-hidden="true"></i>
          </button>
        </div>
          </>
        )}

        {/* fork:ui-08 — sections are a left column now (upstream 0.14.6 uses
            `grid-template-columns: 184px minmax(0,1fr)`); the phone keeps the
            select picker above and hides this column in CSS. */}
        <div className="settings-dialog-body d-set">
          {/* fork:design-system SW-07 — 画板 D-07 的左导航：`.d-set-nav` + `.d-set-navitem`
              （图标 + 文案），选中态是 `.is-on`。行在画板里是 div，产品是 button。
              fork:v5-landing Wave B —— 窄屏不摆这一列（M-05：「手机上没有空间摆导航树」，
              左导航在 `app/settings.css` 的 ≤640px 档里 `display:none`）。 */}
          {isMobile ? null : (
          <nav aria-label={t("settings.title")} className="settings-section-tabs d-set-nav">
            {sections.map((item) => {
              const selected = section === item.id;
              const disabled = item.requiresProject && !cwd;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`d-set-navitem${selected ? " is-on" : ""}`}
                  disabled={disabled}
                  /* fork:settings-frame（画板 62）—— 分节 id 落在 DOM 上。
                     没有它，脚本 / 测试只能按**本地化后的中文标签**找分节行
                     （`board-diff.mjs` 的 `settings:skills` 因此一直是空转的：
                     它按英文 label 找 `.d-set-navitem`，永远找不到 → 设置面板根本没打开
                     → 所有选择器都报「产品里没有」）。 */
                  data-section={item.id}
                  title={disabled ? t("settings.projectRequired") : item.label}
                  aria-current={selected ? "page" : undefined}
                  onClick={() => activateSection(item.id)}
                >
                  <SettingsSectionIcon section={item.id} size={14} />
                  {item.label}
                </button>
              );
            })}
            {/* 2026-10-03 用户裁定 —— 左导航底部的「返回工作区」撤掉（画板 62 帧 C 那一行
                与 `.pw-snav-close` 一同退出产品）：弹窗右上角的 `.settings-dialog-close`
                就是唯一的关闭口，窄屏页头那枚 X 仍在，所以手机也没少出口。
                fork:v5-landing Wave B —— 窄屏**不渲染这一列**（M-05：「手机上没有空间摆
                导航树」，那一层换成分组卡片 hub）。CSS 侧 `app/settings.css` 的
                `≤640px 隐藏 .settings-section-tabs.pw-snav` 那条已经跟着换皮失效
                （组件现在发 `d-set-nav`），所以窄屏的「不摆导航树」必须由这里保证，
                否则两栏会同时出现在手机上。CSS 那条的改指归产品样式收尾波。 */}
          </nav>
          )}

          <main className="settings-dialog-main">
            {/* fork:v5-landing Wave B · M-05 帧 A —— 手机 hub：按「什么时候来改它」
                分成四组卡片，只列那十一个分节；行尾的「需项目」徽章与左导航同一判据。
                外层宿主不带任何 `display`（`hidden` 要生效），设置流在里层 `.m-settings`。 */}
            {isMobile ? (
              <div className="settings-section-host" data-settings-hub hidden={phoneSection !== null}>
                <div className="m-settings">
                  <div className="m-hero">
                    <span className="m-t-title">{t("settings.title")}</span>
                    <span className="m-t-cap m-t-dim">{settingsHubHeroCopy(locale)}</span>
                  </div>
                  {SETTINGS_HUB_GROUPS.map((group) => (
                    <div className="m-cardgroup" key={group.id}>
                      {group.sections.map((id) => {
                        const item = sections.find((entry) => entry.id === id);
                        if (!item) return null;
                        const disabled = item.requiresProject && !cwd;
                        return (
                          <button
                            key={item.id}
                            type="button"
                            className="m-setrow"
                            disabled={disabled}
                            data-section={item.id}
                            title={disabled ? t("settings.projectRequired") : item.label}
                            onClick={() => openPhoneSection(item.id)}
                          >
                            <SettingsSectionIcon section={item.id} size={16} />
                            <span className="m-setrow-body">
                              <span className="m-setrow-t">{item.label}</span>
                              <span className="m-setrow-s">{settingsHubSectionHint(item.id, locale)}</span>
                            </span>
                            {disabled ? (
                              <span className="m-badge mute">{settingsHubNeedsProjectCopy(locale)}</span>
                            ) : null}
                            <i data-ico="chevron-right" data-size="15" aria-hidden="true" />
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            {sectionHost("general", <GeneralSettings cwd={cwd} sessionId={sessionId} onSessionReloaded={onSessionReloaded} quoteSelectionEnabled={quoteSelectionEnabled} onQuoteSelectionChange={onQuoteSelectionChange} sidebarWidth={sidebarWidth} onSidebarWidthChange={onSidebarWidthChange} soundEnabled={soundEnabled} onSoundToggle={onSoundToggle} />)}
            {sectionHost("models", <ModelsConfig embedded cwd={cwd} onClose={onClose} />)}
            {cwd && sectionHost("skills", <SkillsConfig embedded key={cwd} cwd={cwd} onClose={onClose} focusSlug={focusSkillSlug ?? null} />)}
            {cwd && sectionHost("agents", <AgentsConfig embedded key={cwd} cwd={cwd} sessionId={sessionId} onClose={onClose} onReloaded={onSessionReloaded} />)}
            {cwd && sectionHost("plugins", <PluginsConfig embedded key={cwd} cwd={cwd} sessionId={sessionId} onClose={onClose} onReloaded={onSessionReloaded} />)}
            {/* fork:mcp-section — global pages, no project needed. */}
            {sectionHost("mcp", <McpConfig cwd={cwd} sessionId={sessionId} onClose={onClose} onReloaded={onSessionReloaded} />)}
            {/* fork:proma-43-automation — 定时任务。全局页：cwd 只决定新建任务时的
                初值，每条任务自己的 cwd 在面板里填，所以没有项目也进得来。 */}
            {sectionHost("automation", <AutomationPanel cwd={cwd ?? ""} />)}
            {/* fork:zc-03 — usage stats. */}
            {sectionHost("usage", <UsageStatsPanel />)}
            {/* fork:ui-archive-history — 归档历史：恢复 / 彻底删除。 */}
            {sectionHost("archived", (
              // fork:project-archive — 项目归档与归档历史是同一件事的两个粒度（项目 / 会话），
              // 合成一页：骨架 B（列表 300 + 详情 760），ConfigSplitView 与整页空态都由
              // ProjectArchivePanel 自己出；会话归档的分组 / 详情卡也并进了同一个
              // ConfigSplitView（旧的两段式入口 ArchivedSessionsPanel 恒渲染 null，已删）。
              // fork:settings-frame（画板 62 帧 B）—— `fill` 与删掉 `div.settings-archive-page`
              // 必须同一提交：is-fixed 是 overflow:hidden，中间多一层 div 会把超高一列
              // 静默裁掉；删掉后 `.pw-scontent.is-fixed` 的直接子元素就只有
              // ProjectArchivePanel 的 ConfigSplitView（或整页空态 / 错误行）。
              <SettingsPage title={t("settings.archivedTitle")} sub={t("settings.archivePageDescription")} fill>
                <ProjectArchivePanel onOpenSession={onOpenSession} onSessionsChanged={onSessionReloaded} onCloseRequest={onClose} />
              </SettingsPage>
            ))}

            {/* fork:import-ui — 显式扫描 + 显式导入，绝不自动跑。
                fork:settings-frame —— 页面框（页头 + 滚动）由 ImportPanel 自己的三件套出。 */}
            {sectionHost("import", <ImportPanel />)}

            {/* fork:phone-push — 手机配对 + IM 推送。全局页，与项目无关。 */}
            {sectionHost("phonePush", <PhoneAndPushPanel />)}
          </main>
        </div>
      </div>
    </div>
  );
}

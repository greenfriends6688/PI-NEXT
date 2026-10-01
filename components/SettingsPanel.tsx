"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useDialogA11y } from "@/hooks/useDialogA11y";
import { useI18n } from "@/hooks/useI18n";
import { useTheme } from "@/hooks/useTheme";
import { THEME_OPTIONS } from "@/lib/theme";
import {
  CHAT_CONTENT_WIDTH_DEFAULT,
  CHAT_CONTENT_WIDTH_MAX,
  CHAT_CONTENT_WIDTH_MIN,
  CHAT_CONTENT_FONT_SIZE_DEFAULT,
  EXTENSION_WIDGET_FONT_SIZE_DEFAULT,
  useChatAppearance,
} from "@/hooks/useChatAppearance";
import { sendAgentCommand } from "@/lib/agent-client";
import type { ShellToolSettingsResponse } from "@/lib/api-types";
import { setLastSettingsSection, type SettingsSection } from "@/lib/settings-navigation";
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
import { CronConfig } from "./fork/CronConfig";
import { McpConfig } from "./fork/McpConfig";
import { PiMemoryConfig } from "./fork/PiMemoryConfig";
// fork:zc-03 / fork:zc-16 — new sections rendered by this panel.
import { PromptsConfig } from "./fork/PromptsConfig";
import { UsageStatsPanel } from "./fork/UsageStatsPanel";
import { setupPushSubscription } from "@/lib/push-client";
import { SkillsConfig } from "./SkillsConfig";
/* fork:disabled-reasons —— 「为什么不能点」的文案。与 AgentsConfig / fork/CronConfig
 * 共用同一份「一个模型都没有」口径（NO_MODEL_PROVIDERS_HINT），避免同一个原因在三个
 * 分节里说成三句话；`localCopy` 与文案表都定义在 AgentsConfig，理由见那里的注释。
 * 语言包在 lib/i18n/messages/**（这一轮不允许改 lib/），所以这几条走本地表而不是 t()。 */
import { AgentsConfig } from "./AgentsConfig";
import { NO_MODEL_PROVIDERS_HINT, localCopy, type LocalCopy } from "./settings-disabled-reasons";
import { PluginsConfig } from "./PluginsConfig";
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
import { THEME_SKIN_DEFAULT_ID, currentSkinMode } from "@/lib/theme-skins";
import { ArchivedSessionsPanel } from "./ArchivedSessionsPanel";
import { ProjectArchivePanel } from "./ProjectArchivePanel";
import { ImportPanel } from "./ImportPanel";
import { useBorderDepth } from "@/hooks/useBorderDepth";
import { useUiDensity } from "@/hooks/useUiDensity";
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
  onClose: () => void;
  onSessionReloaded: () => void;
  quoteSelectionEnabled: boolean;
  onQuoteSelectionChange: (enabled: boolean) => void;
  /** fork:cron — open the session a scheduled run created. */
  onOpenSession?: (sessionId: string) => void;
  /** fork:memory-panel — open a memory markdown file in the main viewer. */
  onOpenFile?: (filePath: string) => void;
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
  cron: "clock",
  memory: "brain",
  usage: "chart-column",
  prompts: "square-function",
  archived: "archive",
  import: "import",
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

/** fork:disabled-reasons —— 默认外观下「导出 / 打开皮肤工作室」恒 disabled 的原因。
 *  这两枚按钮在 ThemeSkinStrip.tsx（不在本轮可改的文件里），所以用一句可见的说明
 *  补在皮肤条下方，而不是给按钮加 title。 */
const SKIN_ACTIONS_NEED_CUSTOM_SKIN: LocalCopy = {
  en: "The default look is not a skin file, so Export and Open skin studio are disabled. Pick one of your own skins above, or create one first.",
  "zh-CN": "当前是「默认」外观，它不是一份皮肤文件，所以「导出」与「打开皮肤工作室」不可点。先在上面选一套自己的皮肤，或「新建主题」。",
  "zh-TW": "目前是「預設」外觀，它不是一份皮膚檔案，所以「匯出」與「開啟皮膚工作室」不可點。先在上面選一套自己的皮膚，或「新增主題」。",
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
          文案与 AgentsConfig / fork/CronConfig 的空模型列表提示同源。 */}
      {titleModelList.state === "empty" && (
        <p className="pw-hint">{localCopy(NO_MODEL_PROVIDERS_HINT, locale)}</p>
      )}
      {titleModelList.state === "error" && (
        <p className="pw-hint">
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
      <SettingsPage title={t("settings.general")} sub={t("settings.generalSub")}>
        {/* fork:settings-frame（画板 62）—— 常规页 = 两栏块流。
            10 个块原来排成一条 **1160px 宽**的单列（实测内容高 1862，要滚两屏），
            而且每行的「标签—控件」跨度也是 1160（「桌面通知」在最左、开关在最右）。
            现在按语义分两栏，每栏 570：
              左 = 外观与显示（外观 / 主题皮肤 / 壁纸 / 侧栏）
              右 = 交互与系统（通知 / 字体 / 语言 / 聊天 / Shell / 推送） */}
        <div className="pw-grid2">
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
                className="pw-btn sm"
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
          打开皮肤工作室（都在 ThemeSkinStrip 里，DOM 是画板 47 的 `.pw-skin-strip`）。 */}
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
        {/* fork:disabled-reasons —— 默认外观下 ThemeSkinStrip 的「导出 / 打开皮肤
            工作室」恒 disabled（没有可导出的皮肤文件）。那两枚按钮在
            ThemeSkinStrip.tsx，不在本轮可改的文件里，所以在这里用一句可见说明
            补上原因；按钮的 title 请在同一处补（见报告）。 */}
        {activeSkin === null && <p className="pw-hint">{localCopy(SKIN_ACTIONS_NEED_CUSTOM_SKIN, locale)}</p>}
      </PwBlock>

      {/* fork:zn-19-merge —— 壁纸与皮肤是同一件事的两个粒度：没有自定义皮肤时这里就是
          「默认外观」的壁纸；有皮肤时由皮肤接管（WallpaperSettings 自己判断并只留
          一条去编辑皮肤的提示）。画板 40 把壁纸单列一块，这里照画板。 */}
      <PwBlock icon="wallpaper" title={t("settings.wallpaperDefaultTitle")}>
        <WallpaperSettings
          skinActive={activeSkin ? activeSkin.id !== THEME_SKIN_DEFAULT_ID : false}
          {...(activeSkin && activeSkin.id !== THEME_SKIN_DEFAULT_ID
            ? { onEditSkin: () => setEditing({ skin: activeSkin, isNew: false }) }
            : {})}
        />
      </PwBlock>

      {/* fork:zn-15 —— 外观 → 侧边栏：半透明开关 + 宽度滑块（画板 40 的「侧栏」块）。 */}
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
          </div>

          <div>
      {/* fork:zn-16 —— 通知：五条开关行 + 行末两个动作钮（画板 40 的「通知」块）。 */}
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
          hint={t("settings.notifyOnCompleteHint")}
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
          hint={t("settings.notifyOnErrorHint")}
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
          hint={t("settings.notifyOnlyUnfocusedHint")}
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
                className="pw-btn outline sm"
                disabled={!notificationPrefs.enabled}
                title={notificationPrefs.enabled ? undefined : localCopy(NOTIFY_TEST_NEEDS_MASTER, locale)}
                onClick={() => void sendTestNotification()}
              >
                {t("settings.notifyTest")}
              </button>
              <button
                type="button"
                className="pw-btn sm"
                onClick={() => void openSystemNotificationSettings()}
              >
                {t("settings.notifyOpenSystem")}
              </button>
            </PwCtl>
          }
        />
        {notificationNote ? (
          <div role="status" className="pw-alert info">
            <span className="pw-ico"><i data-ico="info" data-size="14" aria-hidden="true" /></span>
            <span className="pw-grow">{notificationNote}</span>
          </div>
        ) : null}
      </PwBlock>

      {/* fork:zn-18 —— 界面字体（画板 40「界面字体」块：UI 字体 + UI 字号两行）。
          画板还画了「代码字体 / 代码等宽中文字体」两行，本产品没有这两个设置，
          不凭空造控件。 */}
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
      </PwBlock>

      {/* 语言：画板 40 用 `.pw-radio` 排三档，照抄。 */}
      <PwBlock icon="languages" title={t("common.language")}>
        <PwField
          label={t("common.language")}
          hint={t("settings.languageDescription")}
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
              <span className="pw-radio">
                {([
                  ["reasoning", "settings.stepExpandReasoning", "brain"],
                  ["command", "settings.stepExpandCommand", "terminal"],
                  ["tool", "settings.stepExpandTool", "wrench"],
                ] as const).map(([category, labelKey, icon]) => {
                  const on = stepExpansion[category];
                  return (
                    <button
                      key={category}
                      type="button"
                      aria-pressed={on}
                      className={on ? "is-on" : undefined}
                      onClick={() => setStepExpansion(setStepCategoryExpanded(category, !on))}
                    >
                      <span className="pw-ico"><i data-ico={icon} data-size="12" aria-hidden="true" /></span>
                      {t(labelKey)}
                    </button>
                  );
                })}
              </span>
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
                className="pw-btn sm"
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
            <div role="alert" className="pw-alert">
              <span className="pw-ico"><i data-ico="triangle-alert" data-size="14" aria-hidden="true" /></span>
              <span className="pw-grow">{shellError}</span>
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
              className="pw-btn outline sm"
              disabled={pushRegistering}
              onClick={() => void registerPush()}
            >
              {pushRegistering ? t("settings.pushRegisterLoading") : t("settings.pushRegister")}
            </button>
          }
        />
        {pushStatus ? (
          <div role="status" className={pushStatus.kind === "ok" ? "pw-alert info" : "pw-alert"}>
            <span className="pw-ico"><i data-ico={pushStatus.kind === "ok" ? "info" : "triangle-alert"} data-size="14" aria-hidden="true" /></span>
            <span className="pw-grow">{pushStatus.message}</span>
          </div>
        ) : null}
      </PwBlock>
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
      </SettingsPage>
    </>
  );
}
// fork:zc-15 — the section keyword table moved into `lib/settings-navigation.ts`
export function SettingsPanel({ cwd, sessionId, initialSection, onClose, onSessionReloaded, quoteSelectionEnabled, onQuoteSelectionChange, onOpenSession, onOpenFile, sidebarWidth, onSidebarWidthChange, soundEnabled, onSoundToggle }: Props) {
  const { t } = useI18n();
  const [section, setSection] = useState<SettingsSection>(initialSection);
  const [mountedSections, setMountedSections] = useState<ReadonlySet<SettingsSection>>(
    () => new Set([section]),
  );
  const sections: { id: SettingsSection; label: string; requiresProject: boolean }[] = [
    { id: "general", label: t("settings.general"), requiresProject: false },
    { id: "models", label: t("common.models"), requiresProject: false },
    { id: "skills", label: t("common.skills"), requiresProject: true },
    { id: "agents", label: t("common.agents"), requiresProject: true },
    { id: "plugins", label: t("common.plugins"), requiresProject: true },
    { id: "mcp", label: t("mcp.sectionTitle"), requiresProject: false },
    { id: "cron", label: t("cron.title"), requiresProject: false },
    { id: "memory", label: t("memory.title"), requiresProject: false },
    // fork:zc-03 / fork:zc-16 — global sections.
    { id: "usage", label: t("usage.title"), requiresProject: false },
    { id: "prompts", label: t("prompts.title"), requiresProject: false },
    // fork:ui-archive-history
    { id: "archived", label: t("settings.archivedTitle"), requiresProject: false },
    // fork:import-ui
    { id: "import", label: t("import.title"), requiresProject: false },
  ];

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

  const sectionHost = (id: SettingsSection, content: ReactNode) => mountedSections.has(id) ? (
    <div
      key={id}
      hidden={section !== id}
      /* fork:design-system SW-07 — 每个分节的内容栏就是画板 40 的 `.pw-sbody`
         （页边距 24/40/32、`> h2` / `> p.sub` 的页头规格全在 board.css）。
         fork:motion-2026-10-01 —— 分节是懒挂载 + 常驻（切走只加 hidden），所以给
         **当前分节**挂 `fork-turn-enter`：分节刚被激活时重放一次整块替换
         （200ms + 8px）。此前切换分节是 `getAnimations() === []` 的硬切。 */
      className={`settings-section-host pw-sbody${section === id ? " fork-turn-enter" : ""}`}
    >
      {content}
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
      <div className="settings-dialog-surface pw-modal anim-dialog">
        <div className="settings-dialog-header pw-modal-head">
          <strong className="settings-dialog-title">{t("settings.title")}</strong>
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

          <button type="button" onClick={onClose} title={t("i18n.close")} aria-label={t("i18n.close")} className="config-close-button settings-dialog-close pw-iconbtn">
            <span className="pw-ico"><i data-ico="x" data-size="14"></i></span>
          </button>
        </div>

        {/* fork:ui-08 — sections are a left column now (upstream 0.14.6 uses
            `grid-template-columns: 184px minmax(0,1fr)`); the phone keeps the
            select picker above and hides this column in CSS. */}
        <div className="settings-dialog-body pw-settings">
          {/* fork:design-system SW-07 — 画板 40 的左导航：`.pw-snav` + `.pw-row` 行
              （图标 + `.pw-name`），选中态是 `.is-on`。行在画板里是 div，产品是
              button，UA 归零在 fork-ui.css 的接线块（`button.pw-row`）。 */}
          <nav aria-label={t("settings.title")} className="settings-section-tabs pw-snav">
            {sections.map((item) => {
              const selected = section === item.id;
              const disabled = item.requiresProject && !cwd;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`pw-row${selected ? " is-on" : ""}`}
                  disabled={disabled}
                  /* fork:settings-frame（画板 62）—— 分节 id 落在 DOM 上。
                     没有它，脚本 / 测试只能按**本地化后的中文标签**找分节行
                     （`board-diff.mjs` 的 `settings:skills` 因此一直是空转的：
                     它按英文 label 找 `.pw-row`，永远找不到 → 设置面板根本没打开
                     → 所有 `.pw-*` 选择器都报「产品里没有」）。 */
                  data-section={item.id}
                  title={disabled ? t("settings.projectRequired") : item.label}
                  aria-current={selected ? "page" : undefined}
                  onClick={() => activateSection(item.id)}
                >
                  <span className="pw-ico"><SettingsSectionIcon section={item.id} /></span>
                  <span className="pw-name">{item.label}</span>
                </button>
              );
            })}
            {/* 画板 40 的左导航只有 13 个分节；返回入口用户定在导航底部（不是页头）——
                桌面把导航空隙推到底，手机导航整列隐藏，返回仍在页头（那里有分节下拉）。 */}
            <span className="pw-grow" aria-hidden="true" />
            <button
              type="button"
              className="pw-row pw-snav-close"
              title={t("settings.backToWorkspace")}
              onClick={onClose}
            >
              <span className="pw-ico"><i data-ico="arrow-left" data-size="14" aria-hidden="true" /></span>
              <span className="pw-name">{t("settings.backToWorkspace")}</span>
            </button>
          </nav>

          <main className="settings-dialog-main">
            {sectionHost("general", <GeneralSettings cwd={cwd} sessionId={sessionId} onSessionReloaded={onSessionReloaded} quoteSelectionEnabled={quoteSelectionEnabled} onQuoteSelectionChange={onQuoteSelectionChange} sidebarWidth={sidebarWidth} onSidebarWidthChange={onSidebarWidthChange} soundEnabled={soundEnabled} onSoundToggle={onSoundToggle} />)}
            {sectionHost("models", <ModelsConfig embedded cwd={cwd} onClose={onClose} />)}
            {cwd && sectionHost("skills", <SkillsConfig embedded key={cwd} cwd={cwd} onClose={onClose} />)}
            {cwd && sectionHost("agents", <AgentsConfig embedded key={cwd} cwd={cwd} sessionId={sessionId} onClose={onClose} onReloaded={onSessionReloaded} />)}
            {cwd && sectionHost("plugins", <PluginsConfig embedded key={cwd} cwd={cwd} sessionId={sessionId} onClose={onClose} onReloaded={onSessionReloaded} />)}
            {/* fork:cron / fork:memory / fork:mcp-section — global pages, no project needed. */}
            {sectionHost("mcp", <McpConfig cwd={cwd} sessionId={sessionId} onClose={onClose} onReloaded={onSessionReloaded} />)}
            {sectionHost("cron", <CronConfig cwd={cwd} onOpenSession={onOpenSession} />)}
            {sectionHost("memory", <PiMemoryConfig cwd={cwd} onOpenFile={onOpenFile} />)}
            {/* fork:zc-03 / fork:zc-16 — usage stats, prompt files. */}
            {sectionHost("usage", <UsageStatsPanel />)}
            {sectionHost("prompts", <PromptsConfig onOpenFile={onOpenFile} />)}
            {/* fork:ui-archive-history — 归档历史：恢复 / 彻底删除。 */}
            {sectionHost("archived", (
              // fork:project-archive — 项目归档与归档历史是同一件事的两个粒度（项目 / 会话），
              // 所以合成一页：上面是项目索引，下面是会话归档。原先是两个导航项，
              // 用户看着像两套互不相干的归档。
              // fork:settings-frame（画板 62）—— 页头原来是 `<div class="settings-general">`
              // 里的一枚旧类名 h2（`.settings-general-title`），够不到 board.css 的
              // `.pw-sbody > h2`，字号与常规 / 记忆页不一致。现在走三件套。
              <SettingsPage title={t("settings.archivedTitle")} sub={t("settings.archivePageDescription")}>
                <div className="settings-archive-page">
                  <ProjectArchivePanel onOpenSession={onOpenSession} onSessionsChanged={onSessionReloaded} />
                  <ArchivedSessionsPanel onOpenSession={onOpenSession} onSessionsChanged={onSessionReloaded} />
                </div>
              </SettingsPage>
            ))}

            {/* fork:import-ui — 显式扫描 + 显式导入，绝不自动跑。
                fork:settings-frame —— 页面框（页头 + 滚动）由 ImportPanel 自己的三件套出。 */}
            {sectionHost("import", <ImportPanel />)}
          </main>
        </div>
      </div>
    </div>
  );
}

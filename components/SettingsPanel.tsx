"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
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
  PwField,
  PwPaneCard,
  PwRadio,
  PwSelectBox,
  PwSwitch,
  PwValue,
  SettingsPage,
  stateBadge,
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
  settingsHubGroupLabel,
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

/** fork:design-system SW-07 —— 设置左导航的分节图标。
 *
 *  一律走画板的图标集：`icons.js` 的 243 枚 lucide，经 `<i data-ico>` 水合。
 *  这里原先有 13 段手绘 SVG，其中 agents 那枚还靠 `transform: scale(1.25)` 补尺寸
 *  （自绘路径按 24×24 画，缩到 16px 时笔画偏细）——换成画板图标后补丁不再需要。
 *
 * fork:v5-landing D-07（2026-10-04）—— 真值从 v1 画板 40 迁到 v5 的
 *  `design/v5/web/boards/D-07-settings-general.html`：11 枚图标的**名字与顺序**与那张板
 *  的 `.d-set-navitem > i[data-ico]` 逐条一致（十一张分节画板 D-07…D-21 左侧重复同一条
 *  导航，互为交叉验证），图标尺寸仍是板面的 `data-size="14"`。
 *  `components/SettingsPanel.boardnav.test.mjs` 直接拿画板原文验这张表。 */
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

/* fork:v5-landing-frame · D-07b 帧 C —— Shell 工具那一行的状态徽章（板面写的是
   「关 · 用 Bash」/「开 · 用 PowerShell」）。语言包里没有这个键（`lib/i18n/**`
   不在本轮文件范围），走本地表。 */
const SHELL_ROW_BADGE: LocalCopy = {
  en: "{state} · {shell}",
  "zh-CN": "{state} · {shell}",
  "zh-TW": "{state} · {shell}",
};

const SHELL_ROW_STATE = {
  on: { en: "On", "zh-CN": "开", "zh-TW": "開" },
  off: { en: "Off", "zh-CN": "关", "zh-TW": "關" },
} satisfies Record<string, LocalCopy>;

const SHELL_ROW_SHELL = {
  on: { en: "PowerShell", "zh-CN": "用 PowerShell", "zh-TW": "用 PowerShell" },
  off: { en: "Bash", "zh-CN": "用 Bash", "zh-TW": "用 Bash" },
} satisfies Record<string, LocalCopy>;

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

/* fork:v5-landing-frame · D-07b 帧 C —— 桌面通知总开关那一行是两档分段的两个档名，
   与动作行下面那条常驻说明。语言包里没有这两个键（`lib/i18n/messages/**` 不在本轮
   文件范围），走本地表（与 `settings-disabled-reasons` 同一口径）。 */
const NOTIFY_MASTER_ON: LocalCopy = {
  en: "Master · On",
  "zh-CN": "总开关 开",
  "zh-TW": "總開關 開",
};

const NOTIFY_MASTER_OFF: LocalCopy = {
  en: "Master · Off",
  "zh-CN": "总开关 关",
  "zh-TW": "總開關 關",
};

/* 通知块首句（板面原文，中段是 `<b>`）。 */
const NOTIFY_LEAD = {
  before: {
    en: "System notifications land on the lock screen and on your phone; ",
    "zh-CN": "系统通知会落到锁屏与手机；",
    "zh-TW": "系統通知會落到鎖屏與手機；",
  },
  bold: {
    en: "the notification sound",
    "zh-CN": "通知声音",
    "zh-TW": "通知聲音",
  },
  after: {
    en: " is a separate matter — it is the same switch as the sound button in the composer.",
    "zh-CN": "是另一回事，它与输入框的声音按钮是同一个开关。",
    "zh-TW": "是另一回事，它與輸入框的聲音按鈕是同一個開關。",
  },
} satisfies { before: LocalCopy; bold: LocalCopy; after: LocalCopy };

const NOTIFY_TEST_BANNER: LocalCopy = {
  en: "The test notification is a real one — the title is fixed as “Test notification” and the body says that seeing it means notifications are configured. A failure carries its reason verbatim; it never shows “sent successfully”.",
  "zh-CN": "测试通知发的就是真通知，标题固定「测试通知」，正文是「如果你看到这条，通知已经配置好了」—— 失败的那一条会原样带原因，不弹一句「发送成功」。",
  "zh-TW": "測試通知送的就是真通知，標題固定「測試通知」，內文是「如果你看到這條，通知已經設定好了」—— 失敗的那一條會原樣帶原因，不彈一句「傳送成功」。",
};

/* fork:v5-landing-frame · D-07b 帧 C「后台推送（iOS 主屏应用）」块的五段文案。
   板面把它们写在块首说明 / 状态徽章 / `.d-notice` / 块尾横幅里；产品此前只有那一行
   与一个条件渲染的横幅。语言包里没有这些键（`lib/i18n/**` 不在本轮文件范围），
   走本地表（与 `settings-disabled-reasons` 同一口径）。 */
const PUSH_LEAD = {
  before: {
    en: "After adding this site to the home screen (iPhone needs iOS 16.4+), you can get a system notification on the lock screen when a session finishes while the page is in the background. If notifications stop arriving, come back here to register again. ",
    "zh-CN": "将本站添加到主屏幕后（iPhone 需 iOS 16.4+），会话完成且页面不在前台时，可在锁屏收到系统通知。若通知不再送达，可回到这里重新注册。",
    "zh-TW": "將本站加入主螢幕後（iPhone 需 iOS 16.4+），對話完成且頁面不在前景時，可在鎖屏收到系統通知。若通知不再送達，可回到這裡重新註冊。",
  },
  bold: {
    en: "Registration must be triggered by a click",
    "zh-CN": "注册必须由点击触发",
    "zh-TW": "註冊必須由點擊觸發",
  },
  after: {
    en: ", so no permission prompt appears on its own.",
    "zh-CN": "，因此不会自动弹出授权。",
    "zh-TW": "，因此不會自動彈出授權。",
  },
} satisfies { before: LocalCopy; bold: LocalCopy; after: LocalCopy };

const PUSH_BADGE_NONE: LocalCopy = {
  en: "Not registered",
  "zh-CN": "未注册",
  "zh-TW": "未註冊",
};

const PUSH_BADGE_FAILED: LocalCopy = {
  en: "Last attempt failed",
  "zh-CN": "上次注册失败",
  "zh-TW": "上次註冊失敗",
};

const PUSH_BADGE_OK: LocalCopy = {
  en: "Registered",
  "zh-CN": "已注册",
  "zh-TW": "已註冊",
};

const PUSH_NOTICE_TITLE: LocalCopy = {
  en: "Current status",
  "zh-CN": "当前状态",
  "zh-TW": "目前狀態",
};

const PUSH_NOTICE_HINT: LocalCopy = {
  en: "Not registered yet. Registration must be triggered by a click, so it never pops the permission prompt by itself; a failure shows the original error (e.g. NotAllowedError) together with where to allow it first.",
  "zh-CN": "尚未注册。注册必须由点击触发，所以不会自己弹授权；失败时把原始错误（如 NotAllowedError）与「先去哪儿放行」一起给出来。",
  "zh-TW": "尚未註冊。註冊必須由點擊觸發，所以不會自己彈授權；失敗時把原始錯誤（如 NotAllowedError）與「先去哪裡放行」一起給出來。",
};

/* 「注册推送」那一行的说明：板面原文「这不是开关而是一次**动作**：…」。 */
const PUSH_ROW_HINT = {
  before: {
    en: "This is not a switch but a one-off ",
    "zh-CN": "这不是开关而是一次",
    "zh-TW": "這不是開關而是一次",
  },
  bold: {
    en: "action",
    "zh-CN": "动作",
    "zh-TW": "動作",
  },
  after: {
    en: ": success or failure has to read back in one sentence — no green light that only looks permanently on.",
    "zh-CN": "：成功与否要有一句可读的结果，不留一颗「看起来常亮」的绿灯。",
    "zh-TW": "：成功與否要有一句可讀的結果，不留一顆「看起來常亮」的綠燈。",
  },
} satisfies { before: LocalCopy; bold: LocalCopy; after: LocalCopy };

const PUSH_SCOPE_BANNER = {
  before: {
    en: "How this relates to the phone-push section: this block only decides whether this browser can be pushed at all; which device it reaches is the job of the ",
    "zh-CN": "与手机推送分节的关系：本块只管「这个浏览器能不能被推」，管「推到哪台设备」的是",
    "zh-TW": "與手機推送分節的關係：本塊只管「這個瀏覽器能不能被推」，管「推到哪台裝置」的是",
  },
  bold: {
    en: "phone-and-push",
    "zh-CN": "手机与推送",
    "zh-TW": "手機與推送",
  },
  after: {
    en: " section (scan the QR code / pair). Each says its own half; they are not merged.",
    "zh-CN": "分节（扫码 / 配对码）。两块各说各的一半，不合并。",
    "zh-TW": "分節（掃碼 / 配對碼）。兩塊各說各的一半，不合併。",
  },
} satisfies { before: LocalCopy; bold: LocalCopy; after: LocalCopy };

/** fork:disabled-reasons —— 已经是默认值时「重置」没有可做的事。 */
const CHAT_WIDTH_ALREADY_DEFAULT: LocalCopy = {
  en: "Already at the default width — nothing to reset.",
  "zh-CN": "已经是默认宽度，没有可重置的改动。",
  "zh-TW": "已經是預設寬度，沒有可重設的改動。",
};

/** fork:v5-landing-frame · D-07 / D-07b —— 弹窗脚左槽那句话。板面三帧写的是
 *  「Esc 关闭 · 改动即时保存，不需要「应用」」/「标「新会话生效」的项真的不假装即时」。
 *  产品这半分节的改动本来就即时落盘，所以那句话是**状态**而不是按钮 —— 语言包里没有
 *  这个键（`lib/i18n/messages/**` 不在本轮文件范围），走本地表（与
 *  `settings-disabled-reasons` 同一口径）。 */
const SETTINGS_FOOT_HINT: LocalCopy = {
  en: "Esc closes · changes in this section apply immediately — there is no Apply",
  "zh-CN": "Esc 关闭 · 这一分节的改动即时生效，没有「应用」",
  "zh-TW": "Esc 關閉 · 這個分節的改動即時生效，沒有「應用」",
};

/* fork:v5-landing-frame · D-07 帧 D 的「主题」三段说明。板面把它们写成 `data-demo-pane`
   的三段（不选中的带 `hidden`），产品按同一段落进 `PwPaneCard`。文案原样抄板面
   （本地表，`lib/i18n/messages/**` 不在本轮文件范围；键位待补后整体迁回 `t()`）。 */
const THEME_PANE_COPY = {
  light: {
    en: "Light mode is on; the conversation behind the dialog changes with it — the window is not reopened.",
    "zh-CN": "已切到浅色；背后的会话跟着一起变，不重开窗口。",
    "zh-TW": "已切到淺色；背後的對話跟著一起變，不重開視窗。",
  },
  dark: {
    en: "Dark mode is on; running tasks are not interrupted, only the variable board is swapped.",
    "zh-CN": "已切到深色；正在跑的任务不中断，只换变量板。",
    "zh-TW": "已切到深色；正在跑的任務不中斷，只換變數板。",
  },
  auto: {
    en: "Following the system: a change in the system appearance applies immediately. Changes land in ~/.pi/agent/settings.json.",
    "zh-CN": "跟随系统：系统外观变化时立即生效。改动落在 ~/.pi/agent/settings.json。",
    "zh-TW": "跟隨系統：系統外觀變化時立即生效。改動落在 ~/.pi/agent/settings.json。",
  },
} satisfies Record<string, LocalCopy>;

/* fork:v5-landing-frame · D-07b 帧 B —— 聊天块首那句说明（板面原文，缺键登记）。 */
const CHAT_LEAD: LocalCopy = {
  en: "This block only answers “how the conversation is presented and how you send”; retry and context budget are not here (those apply to the next session, so they live in their own blocks).",
  "zh-CN": "这一块只回答「对话怎么呈现、手怎么发出去」；重试与上下文预算不在这里（它们是新会话生效的那类）。",
  "zh-TW": "這一塊只回答「對話怎麼呈現、手怎麼發出去」；重試與上下文預算不在這裡（它們是新工作階段生效的那類）。",
};

const THEME_PANE_ICON = {
  light: "sun",
  dark: "moon",
  auto: "monitor",
} as const;

/* fork:v5-landing-frame · D-07b 帧 A「侧边栏」块第三件（`.d-banner`）与
   「宽度」那行的说明 —— 两者都是板面上写着、产品没有的。 */
const SIDEBAR_WIDTH_HINT: LocalCopy = {
  en: "Drag the slider to change the rail. This is the only setting you can see take effect right away — the rail is right there.",
  "zh-CN": "拖动滑块调整轨道宽度。这是唯一当场可见的设置：左边那一栏就在旁边变。",
  "zh-TW": "拖動滑桿調整軌道寬度。這是唯一當場可見的設定：左邊那一欄就在旁邊變。",
};

const SIDEBAR_WIDTH_BANNER: LocalCopy = {
  en: "The width only changes the rail, not the body column — a wider sidebar does not make the conversation wider; each has its own knob.",
  "zh-CN": "宽度只改轨道，不改正文列的排版宽度 —— 侧栏变宽不会让聊天内容跟着变宽，两者各自有各的旋钮。",
  "zh-TW": "寬度只改軌道，不改正文欄的排版寬度 —— 側欄變寬不會讓聊天內容跟著變寬，兩者各自有各自的旋鈕。",
};

/* D-07b 帧 A「界面语言」三段说明（`section > .d-banner`）。 */
const LANG_PANE_COPY = {
  "zh-CN": {
    en: "The interface language changes the panel's own copy (section names, row labels, buttons) — not what you type, and not the language of the model's replies.",
    "zh-CN": "界面语言改的是面板自身的文案（分节名、行标签、按钮），不改你在输入框里打的字，也不改模型回复的语言。",
    "zh-TW": "介面語言改的是面板自身的文案（分節名、列標籤、按鈕），不改你在輸入框裡打的字，也不改模型回覆的語言。",
  },
  "zh-TW": {
    en: "Traditional Chinese is loaded: another language pack for the same keys. Missing keys fall back to Simplified Chinese and are registered in DIVERGENCE.md rather than left blank.",
    "zh-CN": "繁體中文已加载：同一批键的另一份语言包。缺键回落简体中文并在 DIVERGENCE.md 登记，而不是留空。",
    "zh-TW": "繁體中文已載入：同一批鍵的另一份語言包。缺鍵回落簡體中文並在 DIVERGENCE.md 登記，而不是留空。",
  },
  en: {
    en: "English: the copy changes, but units and formats do not follow it — numbers still use tabular figures and dates still follow the local convention.",
    "zh-CN": "English：文案变，单位与格式不跟着变 —— 数字仍用等宽对齐，日期仍按本机习惯。",
    "zh-TW": "English：文案變，單位與格式不跟著變 —— 數字仍用等寬對齊，日期仍按本機習慣。",
  },
} satisfies Record<string, LocalCopy>;

/* D-07b 帧 B「界面密度」三段说明（同上口径）。 */
const DENSITY_PANE_COPY = {
  compact: {
    en: "Compact: more turns per screen; the cost is that tool-card heads and settings rows get cramped and long paths are eaten by the ellipsis.",
    "zh-CN": "紧凑：一屏能看到更多轮次，代价是工具卡头与设置行挤在一起，长路径容易被省略号吃掉。",
    "zh-TW": "緊湊：一屏能看到更多輪次，代價是工具卡頭與設定列擠在一起，長路徑容易被省略號吃掉。",
  },
  standard: {
    en: "Standard: 12px of breathing room per row — least tiring when reading a long thread back to back, and the default.",
    "zh-CN": "标准：一行 12px 上下留白，长会话连读时最省力，也是默认值。",
    "zh-TW": "標準：一行 12px 上下留白，長對話連讀時最省力，也是預設值。",
  },
  comfortable: {
    en: "Comfortable: room for touch screens and large type; mouse users often feel that very little fits on a screen.",
    "zh-CN": "宽松：给触摸屏与大字号留余地；鼠标用户常觉得「一屏没几行」。",
    "zh-TW": "寬鬆：給觸控螢幕與大字號留餘地；滑鼠使用者常覺得「一屏沒幾行」。",
  },
} satisfies Record<string, LocalCopy>;


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
      {/* fork:design-system SW-07 — 画板 40 的「会话自动命名」+「命名用的模型」两行。
          fork:v5-landing-frame · D-07b 帧 B —— 第一行原文是 `.d-grow-last > .d-badge.ok`
          （开）+ 行尾开关。 */}
      <PwField
        label={t("settings.titleAutoGenerate")}
        hint={t("settings.titleAutoGenerateDescription")}
        badge={stateBadge(locale, titleAuto)}
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
  /* fork:v5-landing 逐帧核对（M-05 帧 B/C）—— 手机档只加载 `design/v5/pwa/system.css`，
     `d-*` 的规则在 ≤640 档里**不存在**。这一节里原先写死的 `d-set-inner` / `d-btn sm` /
     `d-banner` / `d-grow` 在手机上全是死类名（几何与外观落回 UA / 继承），
     与画板 `.m-settings` › `.m-cardgroup` › `.m-setrow` 的那一段对不上。
     桌面那一支的类名与结构一个字不动，这里只把窄屏那一支换成 `m-*`。 */
  const isMobile = useIsMobile();
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
  /** 动作钮：桌面 `d-btn sm` / 手机 `m-btn sm`（库里两侧都是 44/36 两档，`sm` 同义）。 */
  const btnSm = isMobile ? "m-btn sm" : "d-btn sm";
  /** 行尾撑开：桌面 `d-grow` / 手机 `m-grow`。 */
  const grow = isMobile ? "m-grow" : "d-grow";

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
        <div className={isMobile ? undefined : "d-set-inner"}>
          <div>
      {/* fork:design-system SW-07 —— 画板 40 第一块「外观」：主题是 `.pw-radio` 三档
          （图标 sun / moon / monitor 与画板同源），边框深度是 `.pw-ctl`（滑块 +
          等宽读数 + 重置钮，与画板「聊天内容宽度」那一行同一形态）。 */}
      <PwBlock icon="palette" title={t("settings.appearance")}>
        <PwField
          label={t("settings.theme")}
          hint={t("settings.appearanceDescription")}
          /* fork:v5-m05-tier —— 窄屏这一格按 M-05 帧 B 的原文：`.m-hero`（主题 + 一句
             说明）在上、`.m-cardgroup` › `.m-pickbar` 三等分在下。此前把档位条塞进
             `div.m-setrow` 的右槽，实测 390×844 下条宽 146.9px / 三枚各 34.3px，
             「浅色」「跟随系统」全折行。桌面（D-07 帧 D 的 `.d-set-row` + `.d-seg`
             行尾）不受影响 —— `tier` 只改窄屏那一支。 */
          tier
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
        {/* fork:v5-landing-frame · D-07 帧 D —— 主题那一行下面还有**三段后果说明**
            （浅色 / 深色 / 跟随系统各一段，不选中的那段带 `hidden`）。产品此前只有分段
            选择器，那三段整段 MISSING —— 于是「我这档有什么代价」只能自己猜。
            DOM 原文见 `SettingsUi.PwPaneCard`；文案抄板面（本地表）。 */}
        {(["light", "dark", "auto"] as const).map((mode) => (
          <PwPaneCard
            key={mode}
            hidden={preference !== mode}
            icon={THEME_PANE_ICON[mode]}
          >
            {localCopy(THEME_PANE_COPY[mode], locale)}
          </PwPaneCard>
        ))}
        <PwField
          label={t("settings.borderDepth")}
          hint={t("settings.borderDepthDescription")}
          htmlFor="settings-border-depth"
          badge={{ text: String(borderDepth), tone: "mute" }}
          slider={{
            id: "settings-border-depth",
            value: borderDepth,
            min: BORDER_DEPTH_MIN,
            max: BORDER_DEPTH_MAX,
            ariaLabel: t("settings.borderDepth"),
            onChange: setBorderDepth,
          }}
          control={
            <button
              type="button"
              className={btnSm}
              title={t("settings.borderDepthTheme")}
              onClick={() => setBorderDepth(50)}
            >
              {t("settings.reset")}
            </button>
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

      {/* fork:zn-15 —— 外观 → 侧边栏：半透明开关 + 宽度滑块（画板 D-07b 帧 A）。 */}
      <PwBlock icon="panel-left" title={t("settings.railBlock")}>
        <PwField
          label={t("settings.railTranslucentRow")}
          hint={t("settings.sidebarTranslucentHint")}
          /* fork:v5-landing-frame · D-07b 帧 A —— 「半透明」那一行的原文是
             `.d-grow-last > .d-badge.mute`（当前值）+ 行尾的 `.d-switch`。
             此前开关被包在 `.d-grow-last` 里，行右侧看不到自己是什么状态。 */
          badge={stateBadge(locale, railTranslucent)}
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
          hint={localCopy(SIDEBAR_WIDTH_HINT, locale)}
          htmlFor="settings-sidebar-width"
          /* 画板同块第二行：值写成 `.d-badge.mute`（280 px），滑块是行的第三个子节点。 */
          badge={sidebarWidth == null ? undefined : { text: `${sidebarWidth} px`, tone: "mute" }}
          slider={sidebarWidth == null || onSidebarWidthChange == null ? undefined : {
            id: "settings-sidebar-width",
            value: sidebarWidth,
            min: SIDEBAR_MIN_WIDTH,
            max: SIDEBAR_MAX_WIDTH,
            step: 4,
            ariaLabel: t("settings.sidebarWidth"),
            onChange: onSidebarWidthChange,
          }}
          control={
            sidebarWidth == null || onSidebarWidthChange == null ? (
              <PwValue>{t("settings.sidebarWidthHint")}</PwValue>
            ) : null
          }
        />
        {/* fork:v5-landing-frame · D-07b 帧 A —— 侧边栏块最后那条 `.d-banner`。 */}
        <div className="d-banner">
          <i data-ico="info" data-size="14" aria-hidden="true" />
          <span className="d-grow">{localCopy(SIDEBAR_WIDTH_BANNER, locale)}</span>
        </div>
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
          /* fork:v5-m05-tier —— 同 `tier` 的板面判据：`.m-pickbar` 在 12 张 PWA 画板里
             从来不与标签并排（M-09 帧「触发时机」、M-06 帧「降级落点」都是标签在上、
             满宽档位条在下）。此前实测三枚语言各 61.8px、「简体中文」已折行。 */
          tier
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
        {/* fork:v5-landing-frame · D-07b 帧 A —— 「界面语言」那一行下面还有三段后果说明
            （简体中文 / 繁體中文 / English，各一段，不选中的那段带 `hidden`）。 */}
        {(["zh-CN", "zh-TW", "en"] as const).map((id) => (
          <PwPaneCard key={id} hidden={locale !== id} icon="info">
            {localCopy(LANG_PANE_COPY[id], locale)}
          </PwPaneCard>
        ))}
      </PwBlock>
          </div>

          <div>

      {/* fork:design-system SW-07 —— 聊天块：画板 40 画的九行逐行对上。
          过程步骤的三个芯片在画板里是单选（`.pw-radio`），产品的语义是三个**独立**
          开关，所以保留画板的 DOM 与状态类，只把 ARIA 换成 `aria-pressed`
          （芯片组，不是单选组）——形态照画板，语义照产品。 */}
      <PwBlock icon="message-square" title={t("settings.chat")}>
        {/* fork:v5-landing-frame · D-07b 帧 B —— 块首那句弱化说明（板面原文）：
            这一块只回答「对话怎么呈现、手怎么发出去」；重试与上下文预算不在这里
            （它们是新会话生效的那类，单独成块）。 */}
        <div className={isMobile ? "m-t-xs m-t-faint" : "d-t-xs d-t-faint"}>
          {localCopy(CHAT_LEAD, locale)}
        </div>
        <TitleSettingsControls cwd={cwd} />
        <PwField
          label={t("settings.thinkingExpandedDefault")}
          hint={t("settings.thinkingDisplayDescription")}
          badge={stateBadge(locale, thinkingExpanded)}
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
          /* fork:v5-m05-tier —— 同一判据（见上）。实测此前三枚只有各 17.8px，
             「紧凑 / 标准 / 宽松」三个字连一行都放不下。 */
          tier
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
        {/* fork:v5-landing-frame · D-07b 帧 B —— 「界面密度」那一行下面有三段后果说明
            （紧凑 / 标准 / 宽松，各一段，不选中的那段带 `hidden`）。 */}
        {(["compact", "standard", "comfortable"] as const).map((mode) => (
          <PwPaneCard key={mode} hidden={uiDensity !== mode} icon="info">
            {localCopy(DENSITY_PANE_COPY[mode], locale)}
          </PwPaneCard>
        ))}
        <PwField
          label={t("settings.stepExpand")}
          hint={t("settings.stepExpandHint")}
          /* fork:v5-landing-frame · D-07b 帧 B —— 「过程步骤默认展开」那三枚芯片在板面
             上是 `.d-grow-last` 的**直接**子节点（`.d-grow-last > .d-cats`），此前多包了
             一层 `.d-row`（PwCtl）。三枚芯片是三个独立开关，不是单选组 —— `aria-pressed`
             保留（板面的 `.d-cat` 形态一字不动）。 */
          control={
            <div className={isMobile ? "m-cats" : "d-cats"}>
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
                    className={isMobile ? `m-cat${on ? " is-on" : ""}` : `d-cat${on ? " is-on" : ""}`}
                    onClick={() => setStepExpansion(setStepCategoryExpanded(category, !on))}
                  >
                    <i data-ico={icon} data-size="12" aria-hidden="true" />
                    {t(labelKey)}
                  </button>
                );
              })}
            </div>
          }
        />
        <PwField
          label={t("settings.chatContentWidth")}
          htmlFor="settings-chat-content-width"
          /* fork:v5-landing-frame · D-07b 帧 B —— 「聊天内容宽度」那一行原文：
             `.d-grow-last > .d-badge.mute`（800 px）+ `.d-slider` + `.d-btn.sm.ghost`
             「重置」三个并列子节点。此前滑块与读数一起塞在 `.d-grow-last` 里。 */
          badge={{ text: `${chatContentWidth} px`, tone: "mute" }}
          slider={{
            id: "settings-chat-content-width",
            value: chatContentWidth,
            min: CHAT_CONTENT_WIDTH_MIN,
            max: CHAT_CONTENT_WIDTH_MAX,
            step: 10,
            ariaLabel: t("settings.chatContentWidth"),
            onChange: setChatContentWidth,
          }}
          control={
            <button
              type="button"
              className={isMobile ? "m-btn sm ghost" : "d-btn sm ghost"}
              /* fork:disabled-reasons —— title 原来写的是功能名（不可点时等于
                 什么都没说）。不可点时改成写清「为什么」：已经是默认值。 */
              title={chatWidthAtDefault ? localCopy(CHAT_WIDTH_ALREADY_DEFAULT, locale) : t("settings.resetChatContentWidth")}
              disabled={chatWidthAtDefault}
              onClick={() => setChatContentWidth(CHAT_CONTENT_WIDTH_DEFAULT)}
            >
              {t("settings.reset")}
            </button>
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
          /* D-07b 帧 B 同一行：值写成 `.d-badge.ok`（开）。 */
          badge={stateBadge(locale, quoteSelectionEnabled)}
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
        {/* fork:v5-landing-frame · D-07b 帧 C —— 块首那句弱化说明（板面原文，段中有一段
          `<b>`：「通知声音」是另一回事）。 */}
      <div className={isMobile ? "m-t-xs m-t-faint" : "d-t-xs d-t-faint"}>
        {localCopy(NOTIFY_LEAD.before, locale)}
        <b>{localCopy(NOTIFY_LEAD.bold, locale)}</b>
        {localCopy(NOTIFY_LEAD.after, locale)}
      </div>
      {/* fork:v5-landing-frame · D-07b 帧 C —— 「桌面通知」总开关在板面上是**两档分段**
            （`.d-seg`：「总开关 开」/「总开关 关」），不是一个 `d-switch`：这一行要能一眼
            看全两个状态，才接得住下面那四个子项的「关 → 禁用但保留值」。走的还是同一个
            `setNotificationPref("enabled", …)`，行为零变化。 */}
        <PwField
          label={t("settings.notifyMaster")}
          hint={t("settings.notifyMasterHint")}
          /* fork:v5-m05-tier —— 同上：两枚「总开关 开 / 关」此前各 69.1px，
             「总开关 关」折行。 */
          tier
          control={
            <PwRadio
              value={notificationPrefs.enabled ? "on" : "off"}
              ariaLabel={t("settings.notifyMaster")}
              options={[
                { value: "on", label: localCopy(NOTIFY_MASTER_ON, locale) },
                { value: "off", label: localCopy(NOTIFY_MASTER_OFF, locale) },
              ]}
              onChange={(next) => setNotificationPref("enabled", next === "on")}
            />
          }
        />
        {/* fork:v5-landing-frame —— 以下四行：值写成 `.d-badge`（开/关），被总开关暂停时
            徽章换 `.d-badge.mute`「已暂停」（板面帧 C 的 `nt-off` 那一段就是这么画的：
            值没变，只是暂时不生效），开关仍是行尾那个独立子节点。 */}
        <PwField
          label={t("settings.notifyOnComplete")}
          badge={stateBadge(locale, notificationPrefs.onComplete, !notificationPrefs.enabled)}
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
          badge={stateBadge(locale, notificationPrefs.onError, !notificationPrefs.enabled)}
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
          badge={stateBadge(locale, notificationPrefs.onlyWhenUnfocused, !notificationPrefs.enabled)}
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
          badge={stateBadge(locale, soundEnabled)}
          control={
            <PwSwitch
              checked={soundEnabled}
              label={t("settings.notifySound")}
              onChange={(next) => onSoundToggle?.(next)}
            />
          }
        />
        {/* 画板这一行是空 `.d-set-row-box` + `.d-grow-last` 里并排两枚动作钮（没有中间层）。 */}
        <PwField
          label=""
          control={
            <>
              <button
                type="button"
                className={btnSm}
                disabled={!notificationPrefs.enabled}
                title={notificationPrefs.enabled ? undefined : localCopy(NOTIFY_TEST_NEEDS_MASTER, locale)}
                onClick={() => void sendTestNotification()}
              >
                {t("settings.notifyTest")}
              </button>
              <button
                type="button"
                className={btnSm}
                onClick={() => void openSystemNotificationSettings()}
              >
                {t("settings.notifyOpenSystem")}
              </button>
            </>
          }
        />
        {/* fork:v5-landing-frame · D-07b 帧 C —— 动作行下面那条常驻说明（板面原文）。 */}
        <div className={isMobile ? "m-banner" : "d-banner"}>
          <i data-ico="info" data-size="14" aria-hidden="true" />
          <span className={grow}>{localCopy(NOTIFY_TEST_BANNER, locale)}</span>
        </div>
        {notificationNote ? (
          <div role="status" className={isMobile ? "m-banner" : "d-banner info"}>
            <i data-ico="info" data-size="14" aria-hidden="true" />
            <span className={grow}>{notificationNote}</span>
          </div>
        ) : null}
      </PwBlock>

      {shellSettings?.isWindows && (
        <PwBlock icon="terminal" title={t("settings.shellTool")}>
          {/* fork:v5-landing-frame · D-07b 帧 C —— 那一行原文：`.d-grow-last > .d-badge.mute`
              （「关 · 用 Bash」）+ 行尾开关。 */}
          <PwField
            label={t("settings.usePowerShell")}
            hint={t("settings.shellToolDescription")}
            badge={{
              text: localCopy(SHELL_ROW_BADGE, locale, {
                state: localCopy(SHELL_ROW_STATE[shellSettings.powerShellEnabled ? "on" : "off"], locale),
                shell: localCopy(SHELL_ROW_SHELL[shellSettings.powerShellEnabled ? "on" : "off"], locale),
              }),
              tone: "mute",
            }}
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
              <span className={grow}>{shellError}</span>
            </div>
          ) : null}
        </PwBlock>
      )}

      <PwBlock icon="bell" title={t("settings.pushPermission")}>
        {/* fork:v5-landing-frame · D-07b 帧 C —— 这一块是**一个动作 + 一条状态**：
            块首一句弱化说明，「注册推送」那行的状态写成 `.d-badge`（未注册 / 已注册 /
            上次失败），块尾一条 `.d-notice` 说清「现在是什么状态 / 失败时原始错误是什么」。
            产品此前只有一个按钮 + 条件渲染的横幅（成功后才出现），失败原因与「要去哪儿
            放行」都没有落点。 */}
        <div className={isMobile ? "m-t-xs m-t-faint" : "d-t-xs d-t-faint"}>
          {localCopy(PUSH_LEAD.before, locale)}
          <b>{localCopy(PUSH_LEAD.bold, locale)}</b>
          {localCopy(PUSH_LEAD.after, locale)}
        </div>
        <PwField
          label={t("settings.pushRegister")}
          /* fork:v5-landing-frame · D-07b 帧 C —— 板面那一行的说明是**另一句**
             （短，段中带 `<b>`）：它讲的是「这不是开关而是一次动作」。产品此前把块首那句
             长说明重复用在了行上，于是同一段话在板上下一行出现两次。 */
          hint={(
            <>
              {localCopy(PUSH_ROW_HINT.before, locale)}
              <b>{localCopy(PUSH_ROW_HINT.bold, locale)}</b>
              {localCopy(PUSH_ROW_HINT.after, locale)}
            </>
          )}
          badge={{
            text: pushStatus
              ? pushStatus.kind === "ok"
                ? localCopy(PUSH_BADGE_OK, locale)
                : localCopy(PUSH_BADGE_FAILED, locale)
              : localCopy(PUSH_BADGE_NONE, locale),
            tone: pushStatus ? (pushStatus.kind === "ok" ? "ok" : "bad") : "warn",
          }}
          control={
            <button
              type="button"
              className={btnSm}
              disabled={pushRegistering}
              onClick={() => void registerPush()}
            >
              {pushRegistering ? t("settings.pushRegisterLoading") : t("settings.pushRegister")}
            </button>
          }
        />
        <div role="status" className="d-notice">
          <span className="d-notice-ico">
            <i
              data-ico={pushStatus?.kind === "ok" ? "circle-check" : "triangle-alert"}
              data-size="13"
              aria-hidden="true"
            />
          </span>
          <span className="d-col d-grow">
            <span className="d-set-row-t">{localCopy(PUSH_NOTICE_TITLE, locale)}</span>
            <span className="d-set-row-s">
              {pushStatus ? pushStatus.message : localCopy(PUSH_NOTICE_HINT, locale)}
            </span>
          </span>
        </div>
        <div className={isMobile ? "m-banner" : "d-banner"}>
          <i data-ico="info" data-size="14" aria-hidden="true" />
          <span className={grow}>
            {localCopy(PUSH_SCOPE_BANNER.before, locale)}
            <b>{localCopy(PUSH_SCOPE_BANNER.bold, locale)}</b>
            {localCopy(PUSH_SCOPE_BANNER.after, locale)}
          </span>
        </div>
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

  /* fork:v5-landing Wave N1 · D-07 —— 左导航的四段分组标题 `.d-set-navsep`
     （基础 / 能力 / 运行 / 数据与连接）。分组表就是手机 hub 的那四张卡
     （`pwa/settingsHub.ts` 的 `SETTINGS_HUB_GROUPS`，那个文件的头注释写明「分组 id 与
     顺序抄 D-07 左导航的 `.d-set-navsep` 四段」），所以这里读同一份：两端天然同构，
     不会再长出「桌面有段名、手机没有」的第二套分类法。
     段名走该文件的本地文案表 —— 语言包里没有这四个键，而这一轮不允许改
     `lib/i18n/messages/**`（需要的 i18n key 已登记在报告里）。 */
  const navEntries = SETTINGS_HUB_GROUPS.flatMap((group) => [
    { kind: "sep" as const, key: `sep-${group.id}`, label: settingsHubGroupLabel(group.id, locale) },
    ...group.sections.flatMap((id) => {
      const entry = sections.find((item) => item.id === id);
      return entry ? [{ kind: "item" as const, key: entry.id, entry }] : [];
    }),
  ]);
  /* 不在四张卡里的分节（加过分节却忘了更新 hub 表时）接在末尾，不静默消失。
     SettingsPanel.test.mjs 已经钉住「hub 盖满十一个分节」，这里是第二道。 */
  const navOrphans = sections.filter(
    (item) => !SETTINGS_HUB_GROUPS.some((group) => group.sections.includes(item.id)),
  );

  /** 左导航的一行。抽成函数是因为分组之后同一段 JSX 要在两处各用一次。
   *  fork:settings-frame（画板 62）—— 分节 id 落在 DOM 上。
   *  没有它，脚本 / 测试只能按**本地化后的中文标签**找分节行（`board-diff.mjs` 的
   *  `settings:skills` 因此一直是空转的：它按英文 label 找 `.d-set-navitem`，
   *  永远找不到 → 设置面板根本没打开 → 所有选择器都报「产品里没有」）。 */
  const renderNavItem = (item: (typeof sections)[number]) => {
    const selected = section === item.id;
    const disabled = item.requiresProject && !cwd;
    return (
      <button
        key={item.id}
        type="button"
        className={`d-set-navitem${selected ? " is-on" : ""}`}
        disabled={disabled}
        data-section={item.id}
        title={disabled ? t("settings.projectRequired") : item.label}
        aria-current={selected ? "page" : undefined}
        onClick={() => activateSection(item.id)}
      >
        <SettingsSectionIcon section={item.id} size={14} />
        {item.label}
      </button>
    );
  };

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

  /* fork:v5-m05 —— M-05 帧 A 顶栏右上那枚「搜设置项」：开出来是板面原文的
     `.m-pop-float`（`.m-doc-label` 当输入框 + 每个命中一行 `.m-menu-row`，
     行尾徽章写它在 hub 里所属的那一组）。空查询时列出前几节 —— 板面那三行就是
     这个形状，不是「搜到的东西」，所以空查询也给内容，不给一张空浮层。
     命中表直接从 hub 用的同一份 `SETTINGS_HUB_GROUPS` 来，不另列一份。 */
  const [settingsFindOpen, setSettingsFindOpen] = useState(false);
  const [settingsFindQuery, setSettingsFindQuery] = useState("");
  const settingsFindResults = useMemo(() => {
    const query = settingsFindQuery.trim().toLowerCase();
    const hits: { id: SettingsSection; label: string; group: string; disabled: boolean }[] = [];
    for (const group of SETTINGS_HUB_GROUPS) {
      for (const id of group.sections) {
        const item = sections.find((entry) => entry.id === id);
        if (!item) continue;
        if (query && !`${item.label} ${settingsHubSectionHint(id, locale)}`.toLowerCase().includes(query)) continue;
        hits.push({ id, label: item.label, group: settingsHubGroupLabel(group.id, locale), disabled: item.requiresProject && !cwd });
        if (!query && hits.length >= 3) return hits;
      }
    }
    return hits;
  }, [cwd, locale, sections, settingsFindQuery]);

  const sectionHost = (id: SettingsSection, content: ReactNode) => mountedSections.has(id) ? (
    <div
      key={id}
      /* fork:settings-modal-layout —— 分节 id 也落在内容宿主上：弹窗形态下有些分节的
         内列布局要按可用宽度降档（常规页的两栏块流），CSS 得有稳定的钩子，
         不能按 `.d-grid2` 一把梭（用量页的统计卡两栏是好的）。 */
      data-section={id}
      hidden={activeSection !== id}
      /* fork:design-system SW-07 —— 桌面：分节内容栏就是画板 D-07 的 `.d-set-main`。
         fork:v5-landing-frame · D-07 / D-07b（2026-10-05 逐帧核对）——
         **`.d-set-main` 直接挂在 `.d-set` 里，宿主自己就是那一栏**（板面原文：
         `.d-set` = `.d-set-nav` + `.d-set-main`）。此前是
         `main.settings-dialog-main` › `div.settings-section-host` ›
         `div.d-set-main` 三层：多出来的两层一是「同一个视觉两个类名」，
         二是 `.d-set-main` 的内距（`sp-6 sp-8`）与滚动落在里层，外层只是个空壳。
         现在宿主 = `.d-set-main`，惰挂载 / `hidden` 切换 / `fork-turn-enter` 一律原样。
         fork:motion-2026-10-01 —— 分节是懒挂载 + 常驻（切走只加 hidden），所以给
         **当前分节**挂 `fork-turn-enter`：分节刚被激活时重放一次整块替换
         （200ms + 8px）。此前切换分节是 `getAnimations() === []` 的硬切。
         fork:v5-landing Wave B —— 窄屏（M-05）：宿主保持无 display 的块（`hidden`
         才有效），真正的设置流是里层那个 `.m-settings`（灰底白卡 + 108px 顶栏让位）。
         `[hidden]` 的 UA 规则是作者层 `display` 的下位，所以窄屏那一支绝不能挂
         任何带 `display` 的类（`.d-set-main` 就是其中之一）—— 这是本行两套类名
         分开写的硬理由。
         fork:pwa-settings-height-chain（2026-10-05）—— 「不发 display 类」的代价
         是宿主变成普通块，`.m-settings` 的 `flex: 1 1 auto; min-height: 0` 全部失效，
         高度退化成内容高（实测 8702px）→ 手机上竖向滑不动、其余九屏被弹窗裁掉。
         修法全在 CSS 侧（`app/pwa-settings.css` §5）：宿主用 `:not([hidden])` 变
         flex 列（`hidden` 的分节仍是 `display: none`），并把中途两层为**桌面**分栏
         写的 `height: 100%` 归零，让 `.m-settings` 成为这一列唯一的纵向滚动容器。
         因此这里不必动 DOM，这个 className 保持原样。 */
      className={`settings-section-host${isMobile ? "" : " d-set-main"}${section === id ? " fork-turn-enter" : ""}`}
    >
      {isMobile ? <div className="m-settings">{content}</div> : content}
    </div>
  ) : null;

  // fork:dsn-dialog-a11y — 这个弹层原先声明了 role/aria-modal 与 Esc（见上方 effect），
  // 但没有焦点约束：Tab 会走到背后的侧栏与输入框，关闭后焦点也不回到触发按钮。
  // 这里补上共享 hook（移焦 / Tab 循环 / inert 背景 / 还原焦点）；
  // Esc 仍由上面的 effect 处理，hook 也接管一份，两者幂等。
  const { dialogRef, dialogProps } = useDialogA11y({ open: true, onClose });

  /* fork:v5-landing-frame · M-05 逐帧核对 —— 内容列（手机 hub + 十一个分节宿主）
     在两种形态下**是同一份**，只有外面的壳不同：桌面是 `.d-modal-body` › `.d-set`，
     窄屏是合并写法 `settings-dialog-body.d-set`。抽成变量是为了不必在两处抄一遍
     十一行 `sectionHost(...)` —— 抄一遍就会有一边漏掉某一节。 */
  const sectionChildren = (<>
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
                        {/* fork:v5-landing 逐帧核对（M-05 帧 A）—— 「需项目」是**这一节自己的属性**
                            （技能 / 子代理 / 插件 都要项目），画板上三行都带，与有没有
                            项目无关；有没有项目只决定这一行**能不能点**（`disabled`）。
                            之前只在 disabled 时出徽章，于是打开项目后徽章就消失了，
                            与画板不一致。 */}
                        {item.requiresProject ? (
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
        {/* fork:ui-archive-history —— 归档：恢复 / 彻底删除。
            fork:v5-landing-frame · D-21（2026-10-06）—— 桌面整页按画板 D-21 帧 A 落地：
            横幅 + 「归档会话」分节（归档历史卡 / 已归档的项目卡）+ 「两种列不出来」
            分节，就是一根 `.d-set-inner`，**不再需要 `fill`**（画板帧 A 的归档页只有
            一列内容，没有列表列 + 详情列）。窄屏那支仍是列表 + `.m-sheet`。 */}
        {sectionHost("archived", (
          <SettingsPage title={t("settings.archivedTitle")} sub={t("settings.archivePageDescription")}>
            <ProjectArchivePanel onOpenSession={onOpenSession} onSessionsChanged={onSessionReloaded} onCloseRequest={onClose} />
          </SettingsPage>
        ))}

        {/* fork:import-ui — 显式扫描 + 显式导入，绝不自动跑。
            fork:settings-frame —— 页面框（页头 + 滚动）由 ImportPanel 自己的三件套出。 */}
        {sectionHost("import", <ImportPanel />)}

        {/* fork:phone-push — 手机配对 + IM 推送。全局页，与项目无关。 */}
        {sectionHost("phonePush", <PhoneAndPushPanel />)}
  </>);

  return (
    <div
      ref={dialogRef}
      {...dialogProps}
      aria-label={t("settings.title")}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
      className={isMobile ? "settings-dialog-backdrop" : "d-modal is-open settings-dialog-backdrop"}
    >
      {/* fork:v5-landing-frame · D-07 / D-07b（2026-10-05 逐帧核对）——
         弹窗宿主照画板原文：`d-modal is-open › d-modal-box wide › d-modal-head ›
         d-modal-body › d-set › d-modal-foot`。此前这一层挂的是产品自有的
         `settings-dialog-backdrop` / `settings-dialog-surface`（v1 时代那套
         `pw-modal` 的替身），于是画板的模态骨架一个类都没落地 —— 与
         ProjectTrustDialog / ThemeSkinStudio / DirectoryPicker / ImagePreview
         （都已经按 `.d-modal` 发类）不是同一个视觉来源（铁律二）。
         **只给桌面这一支**：窄屏（M-05）是另一个形态，`m-*` 那一支的壳归那边核，
         在那边改完之前这里一个字都不动。
         产品类按 0-2-0 双类保留：`.settings-dialog-backdrop` 仍被
         `app/fork-ui.css` 的材质层（`html[data-theme-skin="true"]`）与
         `app/settings.css` 的窄屏规则选中，删掉会让 Mac 拟物皮肤与手机档失锚。
         几何冲突按「后引入的 system.css 胜出」解决：遮罩色 / 圆角 / 阴影 / 限高
         走 v5 令牌，宽度由板面同款的内联 `width:72%` 给（D-07 帧 B / C / D 的
         `.d-modal-box` 上就是这个内联值；铁律四允许内联写宽度百分比）。 */}
      {/* fork:design-components —— 设置壳直接用画板的 .pw-modal + .pw-settings
          （弹层阴影 / 200px 左列 + 内容区 grid 来自 board.css）。
          fork:motion-2026-10-01 —— 补 `anim-dialog`（弹层 160ms + 4px）：
          此前设置面板是 `animationName:none` 的硬切，与同类弹窗
          （ChatWindow 的 .anim-dialog）不一致 —— 动效诊断实测「打开设置面板完全没动」。 */}
      {/* fork:settings-modal-2026-10-02（用户裁定）—— 设置壳从**整屏页面**改成**弹窗**：
          去掉 `pw-modal`，回到弹窗盒自己的尺寸 + 圆角 + 阴影（见 app/settings.css
          里那条注释）。关闭入口从页头里搬出来常驻右上角 —— 页头在宽屏是
          `display:none`（画板 40/45 没有页头），原来关闭钮就藏在它里面，弹窗化后
          那样会没有可见的关闭口。
          fork:v5-landing-frame —— 盒子本身按板面挂 `.d-modal-box.wide`，宽度用板面
          同一个内联值 `72%`（帧 B / C / D 三帧都写着 `style="width:72%"`）。 */}
      {/* fork:v5-landing-frame · D-15 / D-16 / D-17 / D-21 / D-25 —— 设置弹窗盒在板面上是
          `.d-modal-box.wide.d-anchor`（这五张板都是），因为**盒子里有绝对定位的子件**：
          右上角那枚关闭钮（`app/settings.css` 的 `.settings-dialog-close` 是
          `position:absolute`）与窄屏的 `.m-top`。产品此前靠 `settings.css` 给
          `.settings-dialog-surface` 写的那条 `position: relative` 撑，类名层面与板面
          对不上；现在按板面补 `.d-anchor`（同一个值、同一个来源 `system.css`）。
          内联的 `width:72%` 是铁律四允许的几何值，不动。 */}
      <div
        className={isMobile
          ? "settings-dialog-surface anim-dialog"
          : "d-modal-box wide d-anchor settings-dialog-surface anim-dialog"}
        style={isMobile ? undefined : { width: "72%" }}
      >
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
              ) : (
                /* fork:v5-m05 —— 帧 A 的 `.m-top` 是「标题 + 两枚动作钮」：标题靠左，
                   动作靠右。手机上这一层是盖在会话之上的，所以**出口按帧 B/C 的写法
                   放到左边**（那一帧的返回箭头就在左边），右边腾给帧 A 的动作 ——
                   两帧的位置纪律一致，不是两套排法。 */
                <button
                  type="button"
                  className="m-top-btn"
                  onClick={onClose}
                  title={t("i18n.close")}
                  aria-label={t("i18n.close")}
                >
                  <i data-ico="x" data-size="16" aria-hidden="true" />
                </button>
              )}
              <span className="m-top-title m-grow">
                {phoneSection
                  ? (sections.find((item) => item.id === phoneSection)?.label ?? t("settings.title"))
                  : t("settings.title")}
              </span>
              {phoneSection ? null : (
                /* 帧 A 右上第一枚 = 「搜设置项」（板面上开的是 `.m-pop-float`）。
                   第二枚板面写的是「重置本机」—— 那是个真会把本机配置抹掉的破坏性动作，
                   本仓没有对应实现，**不许照着板面凭空造一个**；差距登记在
                   design/v5/DIVERGENCE.md。 */
                <button
                  type="button"
                  className="m-top-btn"
                  onClick={() => setSettingsFindOpen((open) => !open)}
                  aria-expanded={settingsFindOpen}
                  title={t("pwa.settingsFind.label")}
                  aria-label={t("pwa.settingsFind.label")}
                >
                  <i data-ico="search" data-size="16" aria-hidden="true" />
                </button>
              )}
            </div>
            {/* 帧 A 板面原文：`.m-pop-float.is-open` › `.m-doc-label` 写「搜设置项」，
                下面每个命中一行 `.m-menu-row`（搜索图标 + 分节名 + 右侧分组路径徽章）。
                行结构、选中态、排序与画板逐字一致，只换真实分节数据。 */}
            {settingsFindOpen && !phoneSection ? (
              <div className="m-pop-float is-open fork-settings-find">
                <input
                  className="m-doc-label"
                  value={settingsFindQuery}
                  autoFocus
                  placeholder={t("pwa.settingsFind.label")}
                  aria-label={t("pwa.settingsFind.label")}
                  onChange={(event) => setSettingsFindQuery(event.target.value)}
                />
                {settingsFindResults.length === 0 ? (
                  <div className="m-empty">
                    <div className="m-empty-s">{t("pwa.settingsFind.none", { query: settingsFindQuery.trim() })}</div>
                  </div>
                ) : (
                  settingsFindResults.map((hit) => (
                    <button
                      className="m-menu-row"
                      type="button"
                      key={hit.id}
                      disabled={hit.disabled}
                      onClick={() => { setSettingsFindOpen(false); openPhoneSection(hit.id); }}
                    >
                      <SettingsSectionIcon section={hit.id} size={15} />
                      {hit.label}
                      <span className="m-grow" />
                      <span className="m-badge mute">{hit.group}</span>
                    </button>
                  ))
                )}
              </div>
            ) : null}
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
            select picker above and hides this column in CSS.
            fork:v5-landing-frame —— 桌面这一层拆成板面的两级：
            `.d-modal-body` › `.d-set`（`d-set-nav` + `d-set-main`）。
            `.d-modal-body` 自带 `overflow-y:auto` 与内距，而 `.d-set` 是
            `height:100%` 的两列容器，两列各自滚 —— 弹窗限高 + 内容区内部滚动
            （D-07b 的注：「弹窗限高、内容区内部滚动，所以长分节不会被视口裁掉」）。
            窄屏仍是原来的合并写法（`.settings-dialog-body.d-set`），那边不动。 */}
        {/* 桌面（板面原文，两级）：`.d-modal-body` › `.d-set`（`d-set-nav` + `d-set-main`）。
            窄屏（M-05）：仍是原来的合并写法 `settings-dialog-body.d-set` —— 那边是另一个
            形态，`.d-set` 若再套一层会成为 `.settings-dialog-body`（row flex）里一个
            宽度不占满的 flex 子项，把手机布局压窄。两条分支共用下面同一份 children。 */}
        {isMobile ? (
        <div className="settings-dialog-body d-set">
          {sectionChildren}
        </div>
        ) : (
          <div className="d-modal-body settings-dialog-body">
            <div className="d-set">
              {/* fork:design-system SW-07 — 画板 D-07 的左导航：`.d-set-nav` + `.d-set-navitem`
                  （图标 + 文案），选中态是 `.is-on`。行在画板里是 div，产品是 button。
                  fork:v5-landing Wave N1 · D-07 —— 四段分组标题（`.d-set-navsep`）：
                  段名在画板里就是左导航的一部分，手机那一层换成四张卡但**分组是同一张表**。 */}
              <nav aria-label={t("settings.title")} className="settings-section-tabs d-set-nav">
                {navEntries.map((entry) => entry.kind === "sep"
                  ? <div className="d-set-navsep" key={entry.key}>{entry.label}</div>
                  : renderNavItem(entry.entry))}
                {navOrphans.map(renderNavItem)}
              </nav>
              {sectionChildren}
            </div>
          </div>
        )}

        {/* fork:v5-landing-frame · D-07 帧 B / C / D 的弹窗脚 —— 板面三帧都有这一行
            （`.d-modal-foot`：左槽一句状态说明 + `.d-grow`，右槽 `.d-btn.ghost`
            「重置本节」与 `.d-btn.primary`「完成」）。
            2026-10-06 用户裁定去掉右槽的「完成」：这一分节的改动本来就是即时的，
            那枚钮与右上角的 X 走同一个 `onClose`，按它没有任何别的语义 —— 一个
            永远只是关窗的 primary 钮会把人骗成「不按就没保存」。左槽那句说明留着，
            它承担的就是解释这件事。
            「重置本节」仍然**不补**：它要把这一分节的键全部回滚，是破坏性动作，要动
            `lib/` 的写入路径与逐项确认，已登记在报告里等拍板（板面那一帧也把它写成
            「重置本节」，但产品侧需要先定「哪些键算这一节」）。
            文案走本地表（`lib/i18n/messages/**` 不在本轮文件范围内）。 */}
        {isMobile ? null : (
          <div className="d-modal-foot">
            <span className="d-t-xs d-t-faint d-grow">
              {localCopy(SETTINGS_FOOT_HINT, locale)}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

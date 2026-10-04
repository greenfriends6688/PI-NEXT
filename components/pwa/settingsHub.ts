// fork:v5-landing Wave B · M-05 —— 手机端设置 **hub**（设置首页）的数据。
//
// 画板 `design/v5/pwa/boards/M-05-settings.html` 帧 A 的口径：hub 按
// **「你什么时候来改它」**分组（基础 / 能力 / 运行 / 数据与连接），不是按功能树分组；
// 它只列 `lib/settings-navigation.ts` 里的那**十一个**分节 ——「外观与输入」
// 「权限与信任」是「通用」里的二级页，不是第 12、13 个分节。
//
// 分组 id 与顺序抄 D-07 左导航的 `.d-set-navsep` 四段（`.d-set-navitem` 顺序与之逐项
// 一致），两端因此天然同构：桌面左导航与手机 hub 是同一张表的两种排法。
//
// 文案走本地表而不是 `t()`：这一轮不允许改 `lib/i18n/messages/**`，而这三段
// （分组名 / 每行副行 / hero 一句）只在窄屏出现。与 `components/settings-disabled-reasons.ts`
// 同一口径（那里写了「为什么不能点」，这里写「这一节管什么」）。

import type { SettingsSection } from "@/lib/settings-navigation";

/** 四个分组 = 「什么时候来改它」，不是功能树（画板 M-05 帧 A 的四张卡）。 */
export const SETTINGS_HUB_GROUPS: ReadonlyArray<{
  id: string;
  sections: readonly SettingsSection[];
}> = [
  { id: "base", sections: ["general", "models"] },
  { id: "capability", sections: ["skills", "agents", "plugins", "mcp"] },
  { id: "runtime", sections: ["automation", "usage"] },
  { id: "data", sections: ["archived", "import", "phonePush"] },
];

type HubCopy = Record<"en" | "zh-CN" | "zh-TW", string>;

/** 四段分组名的文案（画板 D-07 左导航的 `.d-set-navsep`：基础 / 能力 / 运行 / 数据与连接）。
 *  手机 hub 那一层不画段名（画板 M-05 帧 A 的四张卡也没有标题，靠间距分组），
 *  但桌面左导航要画 —— 两端读的是**同一张表**，所以段名放这里而不是各写一份。
 *  语言包里没有这四个键，而这一轮不允许改 `lib/i18n/messages/**`，故走本地表
 *  （与本文件其余文案同一口径）。 */
const GROUP_LABELS: Record<string, HubCopy> = {
  base: {
    en: "Basics",
    "zh-CN": "基础",
    "zh-TW": "基礎",
  },
  capability: {
    en: "Capabilities",
    "zh-CN": "能力",
    "zh-TW": "能力",
  },
  runtime: {
    en: "Runtime",
    "zh-CN": "运行",
    "zh-TW": "執行",
  },
  data: {
    en: "Data and connections",
    "zh-CN": "数据与连接",
    "zh-TW": "資料與連線",
  },
};

function hubCopy(
  table: Record<string, HubCopy>,
  key: string,
  locale: string,
): string {
  const entry = table[key];
  if (!entry) return key;
  return entry[locale as keyof HubCopy] ?? entry.en;
}

/** 每个分节在 hub 行里的一句副行 —— 写「这一节管什么」，不写「查看用量」这种废话。 */
const SECTION_HINTS: Record<string, HubCopy> = {
  general: {
    en: "Theme · wallpaper · notifications · fonts · chat · compaction · background push",
    "zh-CN": "主题 · 壁纸 · 通知 · 字体 · 聊天 · 压缩 · 后台推送",
    "zh-TW": "主題 · 桌布 · 通知 · 字體 · 聊天 · 壓縮 · 後台推播",
  },
  models: {
    en: "Providers and auth · enabled models · thinking · cost tiers",
    "zh-CN": "供应商与认证 · 启用模型 · 思考钉 · 成本档",
    "zh-TW": "供應商與認證 · 啟用模型 · 思考釘 · 成本檔",
  },
  skills: {
    en: "Loaded · disable model calls · install from the store",
    "zh-CN": "已加载 · 禁用模型调用 · 市场安装",
    "zh-TW": "已載入 · 停用模型呼叫 · 市集安裝",
  },
  agents: {
    en: "Built-in switches · concurrency · profile and tool allowlists",
    "zh-CN": "内置开关 · 并发上限 · profile 与工具白名单",
    "zh-TW": "內建開關 · 併發上限 · profile 與工具白名單",
  },
  plugins: {
    en: "Global and project packages · updates · removal",
    "zh-CN": "全局 / 项目包 · 更新 · 移除",
    "zh-TW": "全域 / 專案包 · 更新 · 移除",
  },
  mcp: {
    en: "Servers · transports · OAuth · import from another agent",
    "zh-CN": "服务器 · 传输 · OAuth · 从其它 agent 导入",
    "zh-TW": "伺服器 · 傳輸 · OAuth · 從其它 agent 匯入",
  },
  automation: {
    en: "Task list · run history · schedule and notify rules",
    "zh-CN": "任务列表 · 运行历史 · 频率与通知策略",
    "zh-TW": "任務列表 · 執行歷史 · 頻率與通知策略",
  },
  usage: {
    en: "This month · cache hits · per-session stats",
    "zh-CN": "本月用量 · 缓存命中 · 会话统计",
    "zh-TW": "本月用量 · 快取命中 · 會話統計",
  },
  archived: {
    en: "Archived sessions · restore · delete",
    "zh-CN": "已归档会话 · 恢复 · 删除",
    "zh-TW": "已封存會話 · 還原 · 刪除",
  },
  import: {
    en: "Sessions / models / skills / MCP from another agent",
    "zh-CN": "从其它 agent 导入会话 / 模型 / 技能 / MCP",
    "zh-TW": "從其它 agent 匯入會話 / 模型 / 技能 / MCP",
  },
  phonePush: {
    en: "Pairing code · scan to connect · bot channels · push targets",
    "zh-CN": "配对码 · 扫码连接 · 机器人渠道 · 推送目标",
    "zh-TW": "配對碼 · 掃碼連線 · 機器人渠道 · 推播目標",
  },
};

/** 桌面左导航那一段的段名（D-07 的 `.d-set-navsep`）。 */
export function settingsHubGroupLabel(groupId: string, locale: string): string {
  return hubCopy(GROUP_LABELS, groupId, locale);
}

/** hub 顶部那一段说明（画板帧 A 的 `.m-hero` 第二行）。 */
const HUB_HERO: HubCopy = {
  en: "Same eleven sections as the desktop — only the left navigation becomes grouped cards.",
  "zh-CN": "与桌面完全同构：同一份十一个分节，这里只是把左导航换成分组卡片。",
  "zh-TW": "與桌面完全同構：同一份十一個分節，這裡只是把左導航換成分組卡片。",
};

export function settingsHubHeroCopy(locale: string): string {
  return hubCopy({ hero: HUB_HERO }, "hero", locale);
}

export function settingsHubSectionHint(section: SettingsSection, locale: string): string {
  return hubCopy(SECTION_HINTS, section, locale);
}

/** 「需项目」徽章 —— 与桌面左导航同一判据（`SETTINGS_SECTIONS.requiresProject`）。 */
export const HUB_NEEDS_PROJECT_COPY: HubCopy = {
  en: "Needs a project",
  "zh-CN": "需项目",
  "zh-TW": "需專案",
};

export function settingsHubNeedsProjectCopy(locale: string): string {
  return hubCopy({ needsProject: HUB_NEEDS_PROJECT_COPY }, "needsProject", locale);
}
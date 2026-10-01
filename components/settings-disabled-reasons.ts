// 设置页「为什么不能点」的统一口径（fork:disabled-reasons 2026-10-01）
//
// 诊断逐个点 12 个设置分节时发现的三类「点了没反应」：内置档进页整页只读却零说明、
// 一台没配供应商的机器上模型下拉恒为一项也不吭声、恒 disabled 的按钮没有 title。
//
// 这些句子暂时没有走 `t()`：语言包在 `lib/i18n/messages/**`，那一轮改动不允许碰 `lib/**`。
// 所以先集中定义一份「按 locale 取」的本地文案表，四个消费方（AgentsConfig /
// SettingsPanel / fork-CronConfig / ThemeSkinStrip）都从这里取，保证「一个模型都没有」这类
// 口径一字不差，而不是各写各的。
// **待办**：迁进 `lib/i18n/messages/*.ts` 的 `settings.*` 键位，之后消费方改回 `t()`，
// 本文件整体删除即可。
import type { Locale } from "@/lib/i18n/types";

/* fork:disabled-reasons —— 「为什么不能点」的统一口径。
 *
 * 诊断逐个点设置分节时发现的三类「点了没反应」：内置档进页整页只读却零说明、
 * 一台没配供应商的机器上模型下拉恒为一项也不吭声、恒 disabled 的按钮没有 title。
 *
 * 这些句子没有走 `t()`：语言包在 `lib/i18n/messages/**`，而这一轮改动不允许
 * 碰 `lib/**`。所以先在**本文件**集中定义一份「按 locale 取」的本地文案表，
 * 三个消费方（本文件 / SettingsPanel / fork/CronConfig）都从这里取，保证三处
 * 「一个模型都没有」的口径一字不差，而不是各写各的。
 * 待办（报告已列）：迁进 `lib/i18n/messages/*.ts` 的 `settings.*` 键位，
 * 之后这三个消费方改回 `t()` 即可，表本身可以整体删掉。 */
export type LocalCopy = Record<Locale, string> & Partial<Record<string, string>>;

/** 取当前语言的本地文案；语言表缺项回退英文（与 lib/i18n 的回退方向一致）。 */
export function localCopy(copy: LocalCopy, locale: Locale, params?: Record<string, string>): string {
  const text = copy[locale] ?? copy.en;
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (token, name: string) => params[name] ?? token);
}

/** 一台机器上一个模型供应商都没配时，所有「选模型」的地方共用的那一句话。 */
export const NO_MODEL_PROVIDERS_HINT: LocalCopy = {
  en: "No model provider is configured on this machine, so there is no model to choose from. Add a provider with a valid API key under Settings → Models first; the list here fills in as soon as it works.",
  "zh-CN": "这台机器还没有配置任何模型供应商，所以没有模型可选。先到「设置 → 模型」添加供应商并填好 API key，这里就会列出模型。",
  "zh-TW": "這台機器還沒有設定任何模型供應商，所以沒有模型可選。先到「設定 → 模型」新增供應商並填好 API key，這裡就會列出模型。",
};

/** 只读档（内置 / 工作区）的说明：为什么整页灰，以及唯一的出口是「创建副本」。 */
export const READONLY_PROFILE_HINT: LocalCopy = {
  en: "This {scope} sub-agent is read from another tool's files, which this app never writes, so every field below is read-only. To change it, use Duplicate at the top right — the copy is saved as your own sub-agent and is fully editable. To only turn it on or off, use the enable switch in the header.",
  "zh-CN": "这份{scope}子代理来自别的工具，本应用不写这份文件，所以下面所有字段都是只读的。想改它，请点右上角的「创建副本」——副本会存成你自己的子代理，随便改；只想开关它，用标题右侧的启用开关。",
  "zh-TW": "這份{scope}子代理來自別的工具，本應用不寫這份檔案，所以下面所有欄位都是唯讀的。想改它，請點右上角的「建立副本」——副本會存成你自己的子代理；只想開關它，用標題右側的啟用開關。",
};


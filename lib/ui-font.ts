/**
 * fork:zn-18 — 界面字体与界面字号（Zeno 设置 → 外观 →「UI 字体 / UI 字号」）。
 *
 * 两件事：
 *
 *   - **字号**写 `--ui-font-size`。默认 13 = 设计规范的正文字阶基准
 *     （DESIGN-SPEC §1.5「正文与控件 13」；画板 40 的「界面字号」一帧也是 13）。
 *     2026-09-30 换肤收尾：Zeno 时代默认 14，与画板对表时全站字号差一档，
 *     按规范收敛到 13。*（同日 fork:type-scale）* 可选值也从 12–16 的连续档
 *     收成**规范五档去掉 meta**（12 / 13 / 15 / 20）—— 14 与 16 不在规范里，
 *     存过它们的旧值会归并到最近的档（14 → 13、16 → 15）。
 *   - **字体**存的是**完整 CSS 字体栈**，不是枚举 id。原因见
 *     `lib/font-discovery.ts`：真实可选项是本机装了哪些字体，是运行时枚举出来的，
 *     枚举不出来的（Safari/Firefox、或用户拒绝授权）只能给「系统默认」。
 *     存栈而不是存族名，也让「换了机器、那个字体没了」自然回退到栈尾的系统字体。
 *
 * 空字符串 = 系统默认 = 不写内联变量，让 `app/globals.css` 的字体栈生效。
 *
 * 纯数据模块：服务端可 import，不碰 DOM。
 */

import { DESIGN_TEXT_PX, USER_TEXT_SIZE_OPTIONS, snapUserTextSize } from "@/lib/typography";

export const UI_FONT_STORAGE_KEY = "pi-ui-font";
export const UI_FONT_SIZE_STORAGE_KEY = "pi-ui-font-size";

export const UI_FONT_SIZE_DEFAULT = DESIGN_TEXT_PX.body;

/** 空栈即「系统默认」；`--font-ui-base` 会被移除而不是设成空格。 */
export function parseStoredUiFontStack(raw: string | null): string {
  if (!raw || raw === "system") return "";
  return raw.trim();
}

export function parseStoredUiFontSize(raw: string | null): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(parsed)) return UI_FONT_SIZE_DEFAULT;
  return snapUserTextSize(parsed);
}

/** 档位由规范推导（`USER_TEXT_SIZE_OPTIONS`），不是写死的一份拷贝。 */
export const UI_FONT_SIZE_OPTIONS: readonly number[] = USER_TEXT_SIZE_OPTIONS;

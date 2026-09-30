/**
 * lib/typography.ts
 *
 * 用途：把 app/globals.css 里定义的类型梯度（`--text-*`）映射为 TypeScript
 * 常量，供 React 内联 style 直接引用。48 个组件走这里，不写字面量。
 *
 * fork:design-system（2026-09-28）—— 梯度从八档收敛到设计系统的**五档**：
 *   11 元信息 / 12 次要 / 13 正文与控件基准 / 15 标题 / 20 空态大字
 * （`design/pi-web-design/assets/tokens.css` §9）。
 *
 * 八个旧名字**保留**（48 个组件在用 `TEXT.2xs` 这类访问，改名会牵动 500+ 处），
 * 但值向五档收拢，实际只剩五个不同字号：
 *
 *   | 旧名 | 旧值 | 新值 | 规范档 |
 *   |------|------|------|--------|
 *   | 2xs  | 10   | 11   | meta      |
 *   | xs   | 11   | 11   | meta      |
 *   | sm   | 12   | 12   | secondary |
 *   | md   | 14   | 13   | body      |
 *   | lg   | 15   | 15   | title     |
 *   | xl   | 16   | 15   | title     |
 *   | 2xl  | 18   | 20   | display   |
 *   | 3xl  | 24   | 20   | display   |
 *
 * `nearestTextStep()` 把梯度外的字号（9 / 13.5 / 17 …）归并到最近的规范档，
 * 所以上游新增的硬编码字号不会跑出梯度。
 *
 * **新代码用 `DESIGN_TEXT` 的规范名**，不要再用旧名。
 *
 * 注意：聊天正文字号不归本模块的梯子管 —— 它由用户可选，选项来自
 * `USER_TEXT_SIZE_OPTIONS`（规范五档去掉 meta，即 12 / 13 / 15 / 20），
 * 写在 CSS 变量 `--chat-content-font-size` 上。
 *
 * 纯数据模块：服务端与客户端都可 import，不依赖任何平台 API。
 */

/** 梯度档位名，与 CSS 变量 `--text-*` 后缀一一对应（旧名，保留兼容）。 */
export type TextStep = "2xs" | "xs" | "sm" | "md" | "lg" | "xl" | "2xl" | "3xl";

/** 设计系统的五个规范档位名，与 `--text-{name}` 一一对应。 */
export type DesignTextStep = "meta" | "secondary" | "body" | "title" | "display";

/** 各档位的数值（px），与 globals.css 中的定义保持一致。 */
export const TEXT_PX: Record<TextStep, number> = {
  "2xs": 11,
  xs: 11,
  sm: 12,
  md: 13,
  lg: 15,
  xl: 15,
  "2xl": 20,
  "3xl": 20,
};

/** 规范档位的数值（px）——设计系统的五档，**唯一事实来源**。 */
export const DESIGN_TEXT_PX: Record<DesignTextStep, number> = {
  meta: 11,
  secondary: 12,
  body: 13,
  title: 15,
  display: 20,
};

/** 档位顺序（从小到大），归并与遍历共用，改梯度只改这一处。 */
export const TEXT_STEPS: readonly TextStep[] = ["2xs", "xs", "sm", "md", "lg", "xl", "2xl", "3xl"];

/** 规范档位顺序（从小到大）。 */
export const DESIGN_TEXT_STEPS: readonly DesignTextStep[] = ["meta", "secondary", "body", "title", "display"];

/** 可直接用于 React style 的 CSS 变量引用，如 TEXT.md === "var(--text-md)"。 */
export const TEXT: Record<TextStep, string> = {
  "2xs": "var(--text-2xs)",
  xs: "var(--text-xs)",
  sm: "var(--text-sm)",
  md: "var(--text-md)",
  lg: "var(--text-lg)",
  xl: "var(--text-xl)",
  "2xl": "var(--text-2xl)",
  "3xl": "var(--text-3xl)",
};

/** 规范档位的 CSS 变量引用，如 DESIGN_TEXT.body === "var(--text-body)"。 */
export const DESIGN_TEXT: Record<DesignTextStep, string> = {
  meta: "var(--text-meta)",
  secondary: "var(--text-secondary)",
  body: "var(--text-body)",
  title: "var(--text-title)",
  display: "var(--text-display)",
};

/** 把档位名反查为数值，非法输入返回 undefined（调用方自行回退）。 */
export function textStepPx(step: string): number | undefined {
  return (TEXT_PX as Record<string, number>)[step];
}

/**
 * 把任意字号归并到最近的梯度档，返回可直接用于 style 的 var 字符串。
 * 距离相同（如 11.5 介于 11 与 12 之间）时收敛到较小档；
 * 非有限值（NaN/Infinity）回退到 md（正文字号），不抛异常。
 */
export function nearestTextStep(px: number): string {
  return TEXT[nearestTextStepName(px)];
}

/** nearestTextStep 的档位名版本，需要知道归并到哪一档时用。 */
export function nearestTextStepName(px: number): TextStep {
  if (!Number.isFinite(px)) return "md";
  // 钳位：低于最小档 / 高于最大档时直接取端点。
  // 不能靠「距离最小」—— 收敛成五档之后 lg/xl 都是 15、2xl/3xl 都是 20，
  // 24 距 2xl 与 3xl 都是 4，按距离会归到 2xl，就丢了「最大值钳到最大档」的语义。
  const first = TEXT_STEPS[0];
  const last = TEXT_STEPS[TEXT_STEPS.length - 1];
  if (px <= TEXT_PX[first]) return first;
  if (px >= TEXT_PX[last]) return last;
  let best: TextStep = first;
  let bestDistance = Math.abs(px - TEXT_PX[best]);
  for (let i = 1; i < TEXT_STEPS.length; i += 1) {
    const step = TEXT_STEPS[i];
    const distance = Math.abs(px - TEXT_PX[step]);
    // 严格小于才替换：并列时保留较小的档。
    if (distance < bestDistance) {
      best = step;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * 把任意字号归并到最近的**规范档**（五档），返回规范档名。
 * 与 `nearestTextStepName` 的区别：这一版只在五个规范值里选，
 * 不会归并到「lg 与 xl 都是 15」这种重复档上。
 */
export function nearestDesignTextStep(px: number): DesignTextStep {
  if (!Number.isFinite(px)) return "body";
  const first = DESIGN_TEXT_STEPS[0];
  const last = DESIGN_TEXT_STEPS[DESIGN_TEXT_STEPS.length - 1];
  if (px <= DESIGN_TEXT_PX[first]) return first;
  if (px >= DESIGN_TEXT_PX[last]) return last;
  let best: DesignTextStep = first;
  let bestDistance = Math.abs(px - DESIGN_TEXT_PX[best]);
  for (let i = 1; i < DESIGN_TEXT_STEPS.length; i += 1) {
    const step = DESIGN_TEXT_STEPS[i];
    const distance = Math.abs(px - DESIGN_TEXT_PX[step]);
    if (distance < bestDistance) {
      best = step;
      bestDistance = distance;
    }
  }
  return best;
}

/** 旧档位名 → 规范档位名。把老代码搬到 `DESIGN_TEXT` 时用。 */
export const TEXT_STEP_TO_DESIGN: Record<TextStep, DesignTextStep> = {
  "2xs": "meta",
  xs: "meta",
  sm: "secondary",
  md: "body",
  lg: "title",
  xl: "title",
  "2xl": "display",
  "3xl": "display",
};

/**
 * 用户在设置里能选的**字号档位**（界面字号 / 聊天字号 / 扩展组件字号）。
 *
 * 取规范五档去掉 `meta`(11)：11 是标签与时间戳用的元信息档，把它发给正文或界面文字
 * 只会得到一个没人想要的结果。**上限就是规范的 `display`(20) **——
 * 以前这三个设置是 `<input type=range>` 的连续值（界面 12–16 / 聊天与扩展组件 12–24），
 * 用户随手就能停在 14 · 16 · 24 上，而这三个值都不在规范的五档里（实测：
 * 当时 composer 的输入框就是 14px）。现在选项由规范推导，改规范只改这一处。
 */
export const USER_TEXT_SIZE_OPTIONS: readonly number[] = DESIGN_TEXT_STEPS
  .filter((step) => step !== "meta")
  .map((step) => DESIGN_TEXT_PX[step]);

/**
 * 把任意字号**归并到用户可选的档位**，返回 px。
 *
 * 与 `nearestDesignTextStep` 的区别：那个会归到 11（用户选不到），这个只在
 * `USER_TEXT_SIZE_OPTIONS` 里挑。用途是读回 localStorage 里的旧值：
 * 存过 14 的旧用户应该落在 13（规范的正文档），存过 24 的落在 20。
 */
export function snapUserTextSize(px: number): number {
  const options = USER_TEXT_SIZE_OPTIONS;
  if (!Number.isFinite(px)) return DESIGN_TEXT_PX.body;
  const first = options[0];
  const last = options[options.length - 1];
  if (px <= first) return first;
  if (px >= last) return last;
  let best = first;
  for (const option of options) {
    // 严格小于才替换：并列（如 14 距 13 与 15 各 1）时收敛到较小档，与
    // `nearestTextStepName` 同一口径。
    if (Math.abs(px - option) < Math.abs(px - best)) best = option;
  }
  return best;
}

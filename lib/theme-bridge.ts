/**
 * fork:fastvibe-stack (H4) —— FastVibe 主题 token → 本仓变量名的桥。
 *
 * ## 为什么需要这座桥（以及为什么不能直接把 token 写进 :root）
 *
 * H4 把 FastVibe 的 24 套主题体系搬了进来（`lib/themes-fastvibe.ts`），它运行时
 * 把 41 个 token 写到 `<html>` 的行内样式上，形如 `--background`、`--accent`、
 * `--border`。而产品里已经有 **421 个**在用的 CSS 变量名（`--bg`、`--text`、
 * `--accent`、`--border`…），两套命名**有交集但语义不同**。
 *
 * 最危险的一处（实测出来的，不是推测）：
 *
 *   FastVibe `--accent` = `seed.muted` = `#21262d`（github-dark）—— 那是一个
 *   **次要填充色**（hover / 选中 / chip 的底），见 `buildTokens()` 里
 *   `accent: seed.muted` 那一条。
 *   本仓   `--accent`   = **品牌强调色**（69 处 `var(--accent)`，按钮、链接、光环）。
 *
 * 所以如果原样把 FastVibe 的 token 灌进 `:root`，结果是整个界面的强调色变成一块
 * 深灰 —— 界面不报错、单测不报错，只是「看起来不对」。这座桥就是那道防护：
 * **FastVibe 的名字只在这一个文件里出现**，出口全部是本仓的语义名。
 *
 * ## 怎么用
 *
 * ```
 * import { fastvibeTokenVars } from "@/lib/theme-bridge";
 * const style = fastvibeTokenVars(theme);  // Record<string,string>，键带 `--`
 * for (const [k, v] of Object.entries(style)) root.style.setProperty(k, v);
 * ```
 *
 * 只输出本仓真的在用的名字（外加 `--background` 这一族原样保留），否则会往
 * `<html>` 上挂一堆没人读的行内样式 —— 那是「看不见的漂移」。
 */

import type { ThemeDefinition } from "./themes-fastvibe";

/** 一处映射：本仓变量名 ← FastVibe token 名。null 表示由调用处按需派生。 */
type Binding = readonly [local: string, fastvibe: string];

/**
 * 颜色槽位的映射表。
 *
 * 顺序即优先级：同名只写一次（`Object.fromEntries` 后者覆盖前者，所以这里
 * 按「先粗后细」排，后面的更具体）。每一条都注明两边为什么是同一个语义。
 */
const COLOR_BINDINGS: readonly Binding[] = [
  // ── 面：三级表面 ─────────────────────────────────────────────
  // FastVibe: background=bg, card=surface, popover=surface, sidebar=sidebar??surface
  // 本仓:     --bg 是画布, --bg-panel 是面板, --bg-elev 是弹层
  ["--bg", "background"],
  ["--bg-panel", "card"],
  ["--bg-elev", "popover"],
  ["--bg-subtle", "muted"],
  ["--bg-hover", "muted"],
  ["--bg-selected", "sidebar-accent"],
  ["--bg-composer", "card"],
  ["--tool-bg", "muted"],

  // ── 文字：三级 ───────────────────────────────────────────────
  // FastVibe: foreground=fg, muted-foreground=mutedFg（只有两级）
  // 本仓:     --text / --text-muted / --text-dim（三级）—— dim 是 muted 与它的
  //           派生，见下面 DERIVED。
  ["--text", "foreground"],
  ["--text-muted", "muted-foreground"],

  // ── 边框 ────────────────────────────────────────────────────
  ["--border", "border"],
  ["--border-strong", "input"],

  // ── 强调色（这里是最容易搞反的一处，见文件头注）────────────────
  // 本仓 `--accent` 是**品牌色**，对应 FastVibe 的 `primary`（= seed.accent），
  // 不是它的 `accent`（= seed.muted，一个填充色）。
  ["--accent", "primary"],
  ["--accent-hover", "primary"],
  ["--accent-text", "primary"],
  ["--accent-contrast", "primary-foreground"],
  ["--accent-soft", "secondary"],
  ["--focus-ring", "ring"],

  // ── 主操作（本仓的 primary-* 是「实心按钮底色」，即品牌色）──────
  ["--primary-bg", "primary"],
  ["--primary-fg", "primary-foreground"],

  // ── 状态色：两边一一对应 ──────────────────────────────────────
  ["--success", "success"],
  ["--warning", "warning"],
  ["--info", "info"],

  // ── 代码面 ──────────────────────────────────────────────────
  ["--code-bg", "code-bg"],

  // ── 侧栏（本仓的变量名与 FastVibe 的 sidebar 一族对齐）──────────
  ["--sidebar", "sidebar"],
  ["--sidebar-border", "sidebar-border"],

  // ── FastVibe 原名原样保留 ────────────────────────────────────
  // 给 `components/ui/` 那 35 个 shadcn 件用：它们写的是 Tailwind 的
  // `bg-background` / `text-muted-foreground` 这类工具类，解析到 `--color-*`
  // （`@theme inline` 桥），最终还是要读 `--background` / `--muted-foreground`
  // 这几个名字。保留它们 = 新组件与旧组件读同一份值。
  ["--background", "background"],
  ["--foreground", "foreground"],
  ["--card", "card"],
  ["--card-foreground", "card-foreground"],
  ["--popover", "popover"],
  ["--popover-foreground", "popover-foreground"],
  ["--primary", "primary"],
  ["--primary-foreground", "primary-foreground"],
  ["--secondary", "secondary"],
  ["--secondary-foreground", "secondary-foreground"],
  ["--muted", "muted"],
  ["--muted-foreground", "muted-foreground"],
  ["--accent-foreground", "accent-foreground"],
  ["--destructive", "destructive"],
  ["--destructive-foreground", "destructive-foreground"],
  ["--border-fv", "border"], // 见下：本仓 --border 已被占用，FastVibe 的另存一个名
  ["--input", "input"],
  ["--ring", "ring"],
  ["--sidebar-foreground", "sidebar-foreground"],
  ["--sidebar-primary", "sidebar-primary"],
  ["--sidebar-primary-foreground", "sidebar-primary-foreground"],
  ["--sidebar-accent", "sidebar-accent"],
  ["--sidebar-accent-foreground", "sidebar-accent-foreground"],
  ["--sidebar-ring", "sidebar-ring"],
  ["--chart-1", "chart-1"],
  ["--chart-2", "chart-2"],
  ["--chart-3", "chart-3"],
  ["--chart-4", "chart-4"],
  ["--chart-5", "chart-5"],
  ["--code-inline-bg", "code-inline-bg"],
  ["--code-keyword", "code-keyword"],
  ["--code-string", "code-string"],
  ["--code-comment", "code-comment"],
  ["--code-number", "code-number"],
] as const;

/**
 * 派生槽位：本仓有、FastVibe 没有对应 token 的。
 *
 * 全部用 `color-mix` 从已有的值算出来，而不是写死 —— 写死的话 24 套主题
 * 每加一套都要补一行，而这类槽位的语义（「比 muted 再暗一档」）本来就是相对的。
 */
function derivedVars(tokens: Record<string, string>): Record<string, string> {
  const fg = tokens.foreground;
  const muted = tokens["muted-foreground"];
  const bg = tokens.background;
  const border = tokens.border;
  const accent = tokens.primary;
  return {
    // 第三级文字：FastVibe 只有两级，本仓的 dim 取二者的中间偏后
    "--text-dim": `color-mix(in srgb, ${muted} 78%, ${fg})`,
    // 更粗的分隔线
    "--border-deep": `color-mix(in srgb, ${border} 72%, ${fg})`,
    // 更淡的分隔线（叠在画布上）
    "--border-faint": `color-mix(in srgb, ${fg} 10%, ${bg})`,
    // 强调色的低透明版本（本仓历史上吃过「同一个 alpha 在三种底上显三种灰」的亏，
    // 所以这里用 color-mix 而不是 rgba()）
    "--accent-border": `color-mix(in srgb, ${accent} 45%, transparent)`,
    "--accent-on": tokens["primary-foreground"],
    // 状态色的软底
    "--danger": tokens.destructive,
    "--danger-contrast": tokens["destructive-foreground"],
    "--danger-soft": `color-mix(in srgb, ${tokens.destructive} 12%, ${bg})`,
    "--success-contrast": tokens["primary-foreground"],
    "--success-soft": `color-mix(in srgb, ${tokens.success} 12%, ${bg})`,
    "--warning-soft": `color-mix(in srgb, ${tokens.warning} 13%, ${bg})`,
    // diff 底
    "--diff-added": `color-mix(in srgb, ${tokens.success} 16%, transparent)`,
    "--diff-removed": `color-mix(in srgb, ${tokens.destructive} 16%, transparent)`,
    // 叠色容器（本仓的按钮三态）
    "--overlay-hover": `color-mix(in srgb, ${fg} 7%, transparent)`,
    "--overlay-active": `color-mix(in srgb, ${fg} 11%, transparent)`,
    "--overlay-selected": `color-mix(in srgb, ${fg} 10%, transparent)`,
    // 规范名（设计系统的叫法，与新组件对齐）
    "--surface-canvas": bg,
    "--surface-panel": tokens.card,
    "--surface-popover": tokens.popover,
    "--n-surface": tokens.muted,
    "--n-border-subtle": `color-mix(in srgb, ${fg} 10%, ${bg})`,
    "--n-border": border,
    "--n-placeholder": `color-mix(in srgb, ${muted} 78%, ${fg})`,
    "--n-muted": muted,
    "--n-text": fg,
    "--n-strong": `color-mix(in srgb, ${fg} 88%, ${bg})`,
    "--error": tokens.destructive,
    "--error-soft": `color-mix(in srgb, ${tokens.destructive} 12%, ${bg})`,
    "--info-soft": `color-mix(in srgb, ${tokens.info} 12%, ${bg})`,
    "--scrim": `color-mix(in srgb, ${bg} 55%, transparent)`,
    // 用户气泡 / 助手气泡：FastVibe 的转录里用户行是 secondary 底
    "--user-bg": tokens.secondary,
    "--assistant-bg": "transparent",
    "--composer-border": `color-mix(in srgb, ${fg} 14%, transparent)`,
    "--composer-protrusion": `color-mix(in srgb, ${fg} 5%, ${bg})`,
  };
}

/**
 * 一套主题 → 本仓变量名的一整套行内值。
 *
 * 返回值直接喂给 `style.setProperty` 循环。键含前导 `--`。
 */
export function fastvibeTokenVars(theme: ThemeDefinition): Record<string, string> {
  const tokens = theme.tokens as Record<string, string>;
  const out: Record<string, string> = {};
  for (const [local, source] of COLOR_BINDINGS) {
    const value = tokens[source];
    // token 缺失时跳过而不是写空串：写空串会把变量「定义成空」，CSS 里就是
    // 未定义行为（回落到继承或透明），而跳过只是保持上一个主题的值。
    if (typeof value === "string" && value.length > 0) out[local] = value;
  }
  return { ...out, ...derivedVars(tokens) };
}

/** 供测试与调试：这张桥覆盖了哪些本仓变量名。 */
export function bridgedVariableNames(): string[] {
  return COLOR_BINDINGS.map(([local]) => local).sort();
}

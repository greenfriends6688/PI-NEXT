/**
 * fork:mac-skeuo — 「Mac拟物风格」内置皮肤。
 *
 * ## 为什么是一套皮肤而不是第三/第四个主题
 *
 * `lib/theme.ts` 的 `THEME_OPTIONS` 只有 light / dark / auto 三项，那条轴是**明暗**，
 * 不是**风格**。这一套要的是同一根轴上的两个端点：浅色端照 Aqua（Mac OS X
 * 10.1–10.5，2000–2007），夜间端照 SkeuoCord（Discord 的拟物重做，深色高光）。
 * 所以它天生就是 `ThemeSkin` 的 `light` / `dark` 两套 `SkinColorVariant`，
 * `useTheme` 一个字都不用改。
 *
 * ## 四个基色之外的东西在哪
 *
 * 皮肤只能存 4 个基色 + 11 个旋钮 + 一段 `customCss`。**拟物的材质不塞进
 * `customCss`**：那份是给用户写的，上限 20000 字符（`parseThemeSkin` 的 slice），
 * 把产品样式塞进去等于让产品样式依赖一个「用户可编辑」的口子。
 * 材质层在 `app/fork-mac-skeuo.css`，靠 `html[data-theme-skin-id="builtin-mac-skeuo"]`
 * 生效，并用 `[data-theme-skin-mode]` 分明暗两支 —— 那两个属性是
 * `useThemeSkins.writeSkin()` 已在写的，**这里没有新增任何 DOM 契约**，
 * 唯一的新增是 `data-theme-skin-id`（见 `hooks/useThemeSkins.ts`）。
 *
 * ## 取值出处
 *
 * - 浅色端：`igorfelipeduca/aqua` 的 `registry/aqua/ui/{window,button,select,input,
 *   switch,tabs,chat-bubble}.tsx` 与 `@aqua/theme` registry（palette + 6 个 gel 派生）。
 *   gel 那 6 个 `color-mix(in oklab, …)` 是逐字抄的，它是 aqua 全部按钮质感的来源。
 * - 夜间端：`Marda33/SkeuoCord` 的 `updates/SkeuoCordBase.css` 签名式单元格
 *   （底边渐变 + `border: 1px solid rgb(92,92,92)` + `0 0 3px 3px` 硬光晕环）
 *   与 `.theme.css` 的 `--cell_top` / `--header_*` / `--sidebar_*` 变量。
 */

import { createSkinDraft, type ThemeSkin } from "./theme-skins";

/** 材质层 CSS 的门禁属性值，两边必须一致。 */
export const MAC_SKEUO_SKIN_ID = "builtin-mac-skeuo";
export const MAC_SKEUO_SKIN_LABEL_KEY = "settings.skinBuiltinMacSkeuo";

/**
 * 浅色端取 aqua `@aqua/theme` 的 palette：
 * `background #eef0f3` / `card #f7f8fa` / `primary #2f7de0` / `muted-foreground #7a8089`。
 * `panel` 在 aqua 里对应 window chrome（`#d9dbde→#c3c6ca`）而不是 `card`，
 * 侧栏是 chrome 面，取深一档才和白色的消息区拉开层次。
 *
 * 夜间端取 SkeuoCord 的 `--mainbg_dark_*` 与 `--cell_dark_bottom`
 * （`hsl(210,3.4%,11.4%)` ≈ `#1a1c20`），强调色用它的 Discord 蓝一族取亮档，
 * 因为深底上 `#2f7de0` 的对比度不够（4.0:1），抬到 `#4a8fe0` 才过 AA。
 */
export const MAC_SKEUO_SKIN: ThemeSkin = createSkinDraft(MAC_SKEUO_SKIN_ID, "Mac拟物", "light", {
  /**
   * 共享基色：填浅色端那一套。
   *
   * **不要为了「变体优先」而留空**：`ThemeSkinStrip.skinCardPaint()` 画的卡片预览
   * 读的是 `skin.panel` / `skin.background` 这两个**共享**字段（不读变体），
   * 留空 = 卡片条里那张卡是**全空白**（用户实测「别就是一个空白的」）。
   * 运行时不受影响：`resolveSkinColors()` 是 `variant.x || skin.x`，两个变体都非空，
   * 共享值永远轮不到；而且共享值本来就是变体留空时的兜底。
   */
  background: "#eef0f3",
  panel: "#d9dce0",
  accent: "#2f7de0",
  text: "#33383f",
  light: {
    background: "#eef0f3",
    panel: "#d9dce0",
    accent: "#2f7de0",
    text: "#33383f",
  },
  dark: {
    background: "#0c0d0e",
    panel: "#1a1c20",
    accent: "#4a8fe0",
    text: "#dcdcdf",
  },
  // 拟物面板是**实板**，不是玻璃：三个不透明度都拉到接近不透明，
  // 否则没有壁纸时 `color-mix(…, 35%, transparent)` 会让面板透出页面底色，
  // 浮凸的投影就断了（投影要落在「板」上才读得出厚度）。
  sidebarOpacity: 96,
  pageOpacity: 96,
  cardOpacity: 95,
  readingMask: 96,
  blur: 0,
  // Aqua 一侧的控件圆角（`window` 是 10px、`input` 是 8px、`select` 是 6px，
  // 取 6 作为基准）。夜间端要压到 3px —— 那是 SkeuoCord 的招牌，靠 CSS 层
  // 用 `!important` 改写 `--radius-base`（内联的 `--radius-base` 优先级高于
  // 普通样式表声明，只有 `!important` 打得过，见 `app/fork-mac-skeuo.css`）。
  radius: 6,
  // 拟物靠硬边吃饭：边框比默认 30 略重。
  borderAlpha: 42,
  wallpaper: null,
  wallpaperDim: 0,
  // 材质全在 CSS 文件里，不占用户自定义 CSS 的额度。
  customCss: "",
});

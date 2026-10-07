"use client";

import { useI18n } from "@/hooks/useI18n";

/*
 * fork:v5-landing —— 新会话空态首屏照 v5 画板 **D-01 帧 A** 抄 DOM：
 * 结构 = .d-empty（品牌行 + .d-empty-s）+ 起步卡网格。
 * 空态标题 `.d-empty-t.d-t-display`（「在 … 里做点什么？」）2026-10-07 按用户要求去掉，
 * 连同它读的 cwd basename —— 顶部只剩品牌行与一句提示。
 * 样式全部来自 design/v5/web/system.css（d-* 唯一出处），图标走 <i data-ico>（icons.js hydrate）。
 * 四张起步卡 = STARTERS（scan-search / git-compare / square-check / book-open），
 * 点卡只把完整指令填进输入框、不发送。
 *
 * fork:v5-landing-frame · D-01 帧 D（选好工作区后的「建议任务」那一段）—— 起步卡从
 * `.d-grid2` › `.d-store-card` 换成板面原文 **`.d-cardgrid` › `button.d-setcard`**：
 *   · `.d-store-card` 是插件商店的件（封面 + 标题 + 描述 + 页脚），不是起步卡；
 *   · 起步卡在板面上是 `.d-setcard`（图标 + `.d-set-row-t` 标题 + `.d-set-row-s` 一句说明，
 *     行尾一枚 `zap`），网格容器是 `.d-cardgrid`（`auto-fill` + 220 下限，窄栏自己塌成一列，
 *     所以不再需要 `gridTemplateColumns: isMobile ? "1fr"` 那条内联覆盖）。
 * 行为零变化：仍然是 `onInsertPrompt(t(prompt))`，仍然不发送。
 *
 * fork:v5-wave-b —— **这一件有意不加 m-* 分支**：`design/v5/pwa/boards/` 里
 * 没有「新会话首屏」这张 PWA 画板（M-01 只管会话页与抽屉），库里的 `.m-empty` /
 * `.m-onboard` 是另一档形态（安装引导 / 系统态）。PWA 库无对应件时不自造，
 * 所以窄屏仍走这套 d-* DOM（≥641 才生效的类，窄屏上是继承旧样式）—— 登记为缺件，
 * 等设计侧补板后再换。
 */

const STARTERS = [
  { key: "chat.homeExplore", desc: "chat.homeExploreDesc", prompt: "chat.homeExplorePrompt", icon: "scan-search" },
  { key: "chat.homeReview", desc: "chat.homeReviewDesc", prompt: "chat.homeReviewPrompt", icon: "git-compare" },
  { key: "chat.homeTest", desc: "chat.homeTestDesc", prompt: "chat.homeTestPrompt", icon: "square-check" },
  { key: "chat.homeExplain", desc: "chat.homeExplainDesc", prompt: "chat.homeExplainPrompt", icon: "book-open" },
] as const;

export function NewSessionHome({
  onInsertPrompt,
}: {
  /** 调用方仍传着（**「在 … 里做点什么？」标题已去掉**，这里不再读它）：
   *  留着这个字段是为了不改 `ChatWindow` 的调用点，也不再从 props 里解构。 */
  cwd: string | null | undefined;
  /** 仍由调用方（`ChatWindow`）传入，但**网格不再靠它判形**：`.d-cardgrid` 是
   *  `auto-fill` + 220px 下限，窄栏（手机 / 开了右栏的桌面）自己塌成一列 ——
   *  与画板 D-01 帧 D 的容器一致，也就不用再写 `gridTemplateColumns: 1fr` 那条内联。 */
  isMobile: boolean;
  onInsertPrompt: (text: string) => void;
}) {
  const { t } = useI18n();
  const hint = t("chat.homeHint");

  return (
    // fork:v5-frame-audit-2026-10-05 —— 首屏那一段照画板 D-01 帧 A 抄成
    // `<div class="d-chat"><div class="d-chat-inner">…d-empty + 起步卡网格…</div></div>`：
    // 滚动容器是 `.d-chat`（库里的那一件），内层是 `.d-chat-inner`。
    // 此前根节点是一枚 `div.d-col.d-grow` + 内联 `overflowY:auto` / `padding`，
    // 板面上并不存在这层（滚动、内边距、列宽三件事都由 d-* 给）。
    <div className="d-chat" style={{ paddingLeft: 0, paddingRight: 0 }}>
      <div className="d-chat-inner">
        <div className="d-empty" style={{ padding: "var(--nx-sp-8) 0 var(--nx-sp-6)" }}>
          {/* fork:brand-lockup-center（用户 2026-10-05）—— 原来这里是 `.d-empty-ico`
              （44×44 的方盒里塞 60% 的品牌图 = 一块小矩形 logo）。用户要的是「左上角
              那个 logo + 品牌」原样搬过来，所以改成侧栏品牌行同名的两件
              （`.d-logo` + `.d-wordmark`）横排，尺寸由 fork-ui.css 的
              `.fork-brand-lockup` 放大一档。 */}
          <div
            className="fork-brand-lockup fork-row-enter"
            style={{ animationDelay: "0ms" }}
          >
            {/* fork:brand-mark-2026-10-04 —— 主品牌图形（public/pi-next-logo.png），
                不是 pi 的 π 字形。 */}
            <div className="d-logo" aria-hidden="true">
              {/* eslint-disable-next-line @next/next/no-img-element -- 静态品牌资产，不走 next/image 优化器 */}
              <img src="/pi-next-logo.png" alt="" draggable={false} />
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element -- 静态品牌资产，不走 next/image 优化器 */}
            <img className="d-wordmark" src="/pi-next-wordmark.png" alt="PI NEXT" draggable={false} />
          </div>
          <div
            className="d-empty-s fork-row-enter"
            style={{ animationDelay: "calc(var(--motion-stagger) * 2)" }}
          >
            {hint}
          </div>
        </div>
        <div
          className="d-cardgrid fork-home-grid fork-row-enter"
          style={{
            animationDelay: "calc(var(--motion-stagger) * 2)",
          }}
        >
          {STARTERS.map(({ key, desc, prompt, icon }) => (
            <button
              key={key}
              type="button"
              className="d-setcard"
              onClick={() => onInsertPrompt(t(prompt))}
            >
              <div className="d-col d-grow">
                <span className="d-set-row-t">
                  <i data-ico={icon} data-size="14" aria-hidden="true"></i> {t(key)}
                </span>
                <span className="d-set-row-s">{t(desc)}</span>
              </div>
              <i data-ico="zap" data-size="14" aria-hidden="true"></i>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

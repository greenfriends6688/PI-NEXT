"use client";

import { useI18n } from "@/hooks/useI18n";

/*
 * fork:v5-landing —— 新会话空态首屏照 v5 画板 **D-01 帧 A** 抄 DOM：
 * 结构 = .d-empty（.d-empty-ico + .d-empty-t.d-t-display + .d-empty-s）
 *        + .d-grid2 > .d-store-card（.d-store-cover + .d-store-card-t + .d-t-xs + .d-store-foot）。
 * 样式全部来自 design/v5/web/system.css（d-* 唯一出处），图标走 <i data-ico>（icons.js hydrate）。
 * 四张起步卡 = STARTERS（scan-search / git-compare / square-check / book-open），
 * 点卡只把完整指令填进输入框、不发送。
 *
 * fork:v5-wave-b —— **这一件有意不加 m-* 分支**：`design/v5/pwa/boards/` 里
 * 没有「新会话首屏」这张 PWA 画板（M-01 只管会话页与抽屉），库里的 `.m-empty` /
 * `.m-onboard` 是另一档形态（安装引导 / 系统态）。PWA 库无对应件时不自造，
 * 所以窄屏仍走这套 d-* DOM（≥641 才生效的类，窄屏上是继承旧样式）—— 登记为缺件，
 * 等设计侧补板后再换。
 */

function cwdBasename(cwd: string | null | undefined): string | null {
  if (!cwd) return null;
  const name = cwd.replace(/[\\/]+$/, "").split(/[\\/]/).pop();
  return name || cwd;
}

const STARTERS = [
  { key: "chat.homeExplore", desc: "chat.homeExploreDesc", prompt: "chat.homeExplorePrompt", icon: "scan-search" },
  { key: "chat.homeReview", desc: "chat.homeReviewDesc", prompt: "chat.homeReviewPrompt", icon: "git-compare" },
  { key: "chat.homeTest", desc: "chat.homeTestDesc", prompt: "chat.homeTestPrompt", icon: "square-check" },
  { key: "chat.homeExplain", desc: "chat.homeExplainDesc", prompt: "chat.homeExplainPrompt", icon: "book-open" },
] as const;

export function NewSessionHome({
  cwd,
  isMobile,
  onInsertPrompt,
}: {
  cwd: string | null | undefined;
  isMobile: boolean;
  onInsertPrompt: (text: string) => void;
}) {
  const { t } = useI18n();
  const label = cwdBasename(cwd);
  const hint = t("chat.homeHint");

  return (
    // fork:v5-frame-audit-2026-10-05 —— 首屏那一段照画板 D-01 帧 A 抄成
    // `<div class="d-chat"><div class="d-chat-inner">…d-empty + d-grid2…</div></div>`：
    // 滚动容器是 `.d-chat`（库里的那一件），内层是 `.d-chat-inner`。
    // 此前根节点是一枚 `div.d-col.d-grow` + 内联 `overflowY:auto` / `padding`，
    // 板面上并不存在这层（滚动、内边距、列宽三件事都由 d-* 给）。
    <div className="d-chat" style={{ paddingLeft: 0, paddingRight: 0 }}>
      <div className="d-chat-inner">
        <div className="d-empty" style={{ padding: "var(--nx-sp-8) 0 var(--nx-sp-6)" }}>
          <div
            className="d-empty-ico fork-row-enter"
            aria-hidden="true"
            style={{ animationDelay: "0ms" }}
          >
            {/* fork:brand-mark-2026-10-04 —— 主品牌图形（public/pi-next-logo.png），
                不是 pi 的 π 字形；盒子是画板 D-01 的 `.d-empty-ico`。 */}
            {/* eslint-disable-next-line @next/next/no-img-element -- 静态品牌资产，不走 next/image 优化器 */}
            <img src="/pi-next-logo.png" alt="" draggable={false} />
          </div>
          <div
            className="d-empty-t d-t-display fork-row-enter"
            style={{ animationDelay: "calc(var(--motion-stagger) * 1)" }}
          >
            {label ? t("chat.homeTitle", { cwd: label }) : t("chat.homeTitleGeneric")}
          </div>
          <div
            className="d-empty-s fork-row-enter"
            style={{ animationDelay: "calc(var(--motion-stagger) * 2)" }}
          >
            {hint}
          </div>
        </div>
        <div
          className="d-grid2 fork-row-enter"
          style={{
            // 画板 60：移动端单列堆叠（同构约定：放不下就折成一列）。
            gridTemplateColumns: isMobile ? "1fr" : undefined,
            animationDelay: "calc(var(--motion-stagger) * 2)",
          }}
        >
          {STARTERS.map(({ key, desc, prompt, icon }) => (
            <button
              key={key}
              type="button"
              className="d-store-card"
              onClick={() => onInsertPrompt(t(prompt))}
            >
              <div className="d-store-cover"><i data-ico={icon} data-size="20"></i></div>
              <div className="d-store-card-t">{t(key)}</div>
              <div className="d-t-xs d-t-faint">{t(desc)}</div>
              <div className="d-store-foot"><i data-ico="zap" data-size="12"></i>{t("chat.homeOneClick")}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

"use client";

import { useI18n } from "@/hooks/useI18n";

/*
 * fork:design-components —— 新会话空态首屏**直接使用画板 01 的组件**：
 * 结构 = design/pi-web-design/01-workbench.html 的 .pw-empty 段
 *   （.pw-empty-inner > .mark + h2 + p + .pw-starters > .pw-starter），
 * 样式全部来自 assets/board.css，图标走 <i data-ico>（icons.js hydrate）。
 * 本文件不写一行视觉样式（入场错开除外——那是画板 05 的动效 token）。
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
  // 提示行里 @ 与 / 用画板的 .pw-kbd 标出（01 画板原文如此）。
  const hint = t("chat.homeHint");
  const [hintBeforeAt, hintAfterAt = ""] = hint.split("@");
  const [hintMid, hintAfterSlash = ""] = hintAfterAt.split("/");

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden">
      <div className="pw-empty" style={{ padding: "32px 16px", overflowY: "auto" }}>
        <div className="pw-empty-inner">
          <span
            className="mark fork-row-enter"
            aria-hidden="true"
            style={{ animationDelay: "0ms" }}
          >
            <i data-ico="pi" data-size="20"></i>
          </span>
          <h2
            className="fork-row-enter"
            style={{ animationDelay: "calc(var(--motion-stagger) * 1)" }}
          >
            {label ? t("chat.homeTitle", { cwd: label }) : t("chat.homeTitleGeneric")}
          </h2>
          <p
            className="fork-row-enter"
            style={{ animationDelay: "calc(var(--motion-stagger) * 2)" }}
          >
            {hintAfterAt ? (
              <>
                {hintBeforeAt}
                <span className="pw-kbd">@</span>
                {hintMid}
                <span className="pw-kbd">/</span>
                {hintAfterSlash}
              </>
            ) : (
              hint
            )}
          </p>
          <div
            className="pw-starters fork-row-enter"
            style={{
              // 画板 60：移动端单列堆叠（同构约定：放不下就折成一列）。
              gridTemplateColumns: isMobile ? "1fr" : undefined,
              // 成组错开封顶 3 项：起始卡整体跟随提示行，不再逐张延后。
              animationDelay: "calc(var(--motion-stagger) * 2)",
            }}
          >
            {STARTERS.map(({ key, desc, prompt, icon }) => (
              <button
                key={key}
                type="button"
                className="pw-starter"
                style={{ cursor: "pointer", font: "inherit" }}
                onClick={() => onInsertPrompt(t(prompt))}
              >
                <b>
                  <span className="pw-ico"><i data-ico={icon} data-size="14"></i></span>
                  {t(key)}
                </b>
                <span>{t(desc)}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

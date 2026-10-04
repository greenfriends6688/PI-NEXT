import { useState } from "react";
type Translate = (key: string, params?: Record<string, string | number>) => string;

interface Props {
  loading: boolean;
  prompt: string | null;
  translate: Translate;
}

/**
 * fork:design-system SW-14 —— 系统提示词面板 = 画板 22：
 * pw-pop 壳 › pw-inline 头（book-marked + 标题 + token 估算徽章 + grow + 复制钮）
 * › pw-code-body 只读正文 › pw-card-foot 脚注（来源 · 只读）。
 * 内嵌样式块已退役；停靠宽度仍由 AppShell 的容器约束，这里只保留滚动语义。
 *
 * fork:v5-landing —— 外观照 `design/v5/web/boards/D-02b-topbar-popovers.html`
 * 帧 A ① 原样落地：浮窗壳 `.d-pop-float` 由 AppShell 的定位容器承担，
 * 本组件只排内容 —— 头 `d-row`（`book-marked` + `d-t-b.d-t-sm` + `d-badge.mute`
 * + `d-btn.sm.ghost`）› `d-sep` › `d-code` / `d-code-body` › `d-pop-foot`。
 */
export function SystemPromptPanel({ loading, prompt, translate }: Props) {
  const [copied, setCopied] = useState(false);

  const tokenEstimate = prompt ? Math.max(1, Math.round(prompt.length / 4)) : 0;

  const handleCopy = () => {
    if (!prompt) return;
    void navigator.clipboard.writeText(prompt).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    }).catch(() => {
      // 剪辑板被拒（如无授权）：按钮恢复原样即可，不打断面板。
    });
  };

  return (
    <section
      className="system-prompt-panel d-col"
      aria-label={translate("system.prompt")}
      style={{ height: "min(600px, 75dvh)", minHeight: 220, gap: 0 }}
    >
      <div className="d-row" style={{ padding: "var(--nx-sp-2) var(--nx-sp-3)", flexShrink: 0 }}>
        <i data-ico="book-marked" data-size="14" aria-hidden="true"></i>
        <span className="d-t-b d-t-sm">{translate("system.prompt")}</span>
        {prompt ? (
          <span className="d-badge mute" title={translate("system.prompt")}>
            ≈ {tokenEstimate.toLocaleString()} tok
          </span>
        ) : null}
        <span className="d-grow" />
        {prompt ? (
          <button type="button" className="d-btn sm ghost" onClick={handleCopy}>
            <i data-ico={copied ? "check" : "copy"} data-size="13" aria-hidden="true"></i>
            {copied ? translate("i18n.copied") : translate("i18n.copy")}
          </button>
        ) : null}
      </div>

      <div className="d-sep" />

      <div className="system-prompt-scroll d-scroll" style={{ minHeight: 0, flex: 1, padding: "var(--nx-sp-2)" }}>
        {prompt ? (
          // 画板这里是 pre 的代码体（`## Environment` 一类标题走 tok-c 弱化）。
          // 系统提示词是散文，所以覆盖成 pre-wrap + anywhere —— 这是产品状态覆盖，
          // 只改换行语义，不动画板的字体/内边距/颜色。
          <div className="d-code">
            <div
              className="d-code-body"
              style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", overflowX: "hidden" }}
            >
              {prompt.split("\n").map((line, index) => (
                line.startsWith("#")
                  ? <span key={index} className="tok-c">{`${line}\n`}</span>
                  : `${line}\n`
              ))}
            </div>
          </div>
        ) : (
          <div className="d-pop-foot">
            {prompt === ""
              ? translate("system.empty")
              : loading
                ? translate("system.loading")
                : translate("system.load")}
          </div>
        )}
      </div>

      <div className="d-pop-foot" style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: "var(--nx-sp-2)" }}>
        <i data-ico="info" data-size="13" aria-hidden="true"></i>
        <span>{translate("system.sourceNote")}</span>
      </div>
    </section>
  );
}

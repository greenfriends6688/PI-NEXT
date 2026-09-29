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
      className="pw-pop system-prompt-panel"
      aria-label={translate("system.prompt")}
      style={{ display: "flex", flexDirection: "column", height: "min(600px, 75dvh)", minHeight: 220 }}
    >
      <div
        className="pw-inline"
        style={{ padding: "var(--s2)", borderBottom: "1px solid var(--n-border-subtle)", flexShrink: 0 }}
      >
        <span className="pw-ico"><i data-ico="book-marked" data-size="14"></i></span>
        <b style={{ fontWeight: 500, fontSize: "var(--text-secondary)" }}>{translate("system.prompt")}</b>
        {prompt ? (
          <span className="pw-badge count" title={translate("system.prompt")}>
            ≈ {tokenEstimate.toLocaleString()} tok
          </span>
        ) : null}
        <span className="grow" />
        {prompt ? (
          <button type="button" className="pw-btn sm" onClick={handleCopy}>
            <span className="pw-ico"><i data-ico={copied ? "check" : "copy"} data-size="13"></i></span>
            {copied ? translate("i18n.copied") : translate("i18n.copy")}
          </button>
        ) : null}
      </div>

      <div className="system-prompt-scroll" style={{ minHeight: 0, flex: 1, overflow: "auto" }}>
        {prompt ? (
          // 画板这里是 pre 的代码体（`## Environment` 一类标题走 pw-tok-com 弱化）。
          // 系统提示词是散文，所以覆盖成 pre-wrap + anywhere —— 这是产品状态覆盖，
          // 只改换行语义，不动画板的字体/内边距/颜色。
          <div
            className="pw-code-body"
            style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", overflowX: "hidden", color: "var(--n-muted)", fontSize: "var(--text-meta)", lineHeight: 1.75 }}
          >
            {prompt.split("\n").map((line, index) => (
              line.startsWith("#")
                ? <span key={index} className="pw-tok-com">{`${line}\n`}</span>
                : `${line}\n`
            ))}
          </div>
        ) : (
          <div className="pw-prow">
            <span className="pw-desc">
              {prompt === ""
                ? translate("system.empty")
                : loading
                  ? translate("system.loading")
                  : translate("system.load")}
            </span>
          </div>
        )}
      </div>

      <div className="pw-card-foot" style={{ flexShrink: 0 }}>
        <span className="pw-ico pw-dim"><i data-ico="info" data-size="13"></i></span>
        <span>{translate("system.sourceNote")}</span>
      </div>
    </section>
  );
}

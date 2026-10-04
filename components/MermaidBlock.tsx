"use client";

import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { LazyCodeHighlighter, useHighlighterReady } from "./useLazyHighlighter";
import { useTheme } from "@/hooks/useTheme";
import { useI18n } from "@/hooks/useI18n";
import { copyText } from "@/lib/clipboard";
import { HIGHLIGHT_SKIPPED_I18N_KEY, highlightBudgetMs, shouldHighlightCode } from "@/lib/code-highlight-schedule";
// fork:v5-wave-b —— PWA 形态：代码块 / Mermaid 卡换成画板 M-02 的 `.m-code` 系。
import { usePwaSkin } from "@/components/pwa/skin";

interface MermaidBlockProps {
  code: string;
  isStreaming?: boolean;
  defaultPreview?: boolean;
}

const ZOOM_STEP = 0.25;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3;

export function downloadMermaidSvg(svg: SVGSVGElement): void {
  // Mermaid's HTML serialization can leave void tags such as <br> unclosed.
  const xml = new XMLSerializer().serializeToString(svg);
  const url = URL.createObjectURL(new Blob([xml], { type: "image/svg+xml;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "mermaid-diagram.svg";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

type RenderState =
  | { key: string; status: "loading" }
  | { key: string; status: "error" }
  | { key: string; status: "ready"; svg: string };

export function MermaidBlock({ code, isStreaming, defaultPreview = false }: MermaidBlockProps) {
  const { isDark } = useTheme();
  const { t } = useI18n();
  // fork:v5-wave-b —— 窄屏（画板 M-02 帧 C）错误块、画布占位与卡片壳都换成 m-* 对应件。
  // 放在任何提前 return 之前（下面 `!previewVisible` 会先返回 CodeBlock）。
  const isPwa = usePwaSkin();
  const [showPreview, setShowPreview] = useState(defaultPreview);
  const [renderState, setRenderState] = useState<RenderState | null>(null);
  const [zoomOpen, setZoomOpen] = useState(false);
  const previewRef = useRef<HTMLButtonElement>(null);
  const currentKey = `${isDark ? "dark" : "light"}\n${code}`;
  const previewVisible = showPreview && !isStreaming;

  useEffect(() => {
    if (!previewVisible) return;

    let cancelled = false;
    setRenderState({ key: currentKey, status: "loading" });

    const render = async () => {
      const { default: mermaid } = await import("mermaid");
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        suppressErrorRendering: true,
        theme: isDark ? "dark" : "default",
      });

      const parsed = await mermaid.parse(code, { suppressErrors: true });
      if (!parsed) throw new Error("Invalid Mermaid diagram");

      const id =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? `mermaid-${crypto.randomUUID()}`
          : `mermaid-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const result = await mermaid.render(id, code);
      if (!cancelled) {
        setRenderState({ key: currentKey, status: "ready", svg: result.svg });
      }
    };

    render().catch(() => {
      if (!cancelled) setRenderState({ key: currentKey, status: "error" });
    });

    return () => {
      cancelled = true;
    };
  }, [code, currentKey, isDark, previewVisible]);

  // fork:design-components —— 画板 10:224-232 的 Mermaid 头：语言标签 + `.grow` 撑开 +
  // `.pw-btn.sm` 的「源码 / 下载 SVG」。画板用 span，产品是可聚焦的 button，类名照抄。
  const previewButton = useMemo(() => (
    <button
      type="button"
      onClick={() => setShowPreview((v) => !v)}
      disabled={isStreaming}
      title={isStreaming ? t("i18n.previewAfterStreaming") : (previewVisible ? t("i18n.showMermaidSource") : t("i18n.previewMermaid"))}
      className="d-btn sm"
    >
      <i data-ico="code" data-size="13"></i>
      {previewVisible ? t("i18n.source") : t("i18n.preview")}
    </button>
  ), [isStreaming, previewVisible, t]);

  if (!previewVisible) {
    return <CodeBlock code={code} lang="mermaid" headerAction={previewButton} isStreaming={isStreaming} />;
  }

  const body = renderState?.key === currentKey && renderState.status === "error" ? (
      <>
        {isPwa ? (
          <>
            <div className="m-code-scroll"><div className="m-code-body"><span className="m-err">{t("i18n.invalidMermaid")}</span></div></div>
            <div className="m-banner warn" style={{ margin: "var(--nx-sp-2) var(--nx-sp-3)" }}>
              <i data-ico="triangle-alert" data-size="14"></i>
              <span className="m-grow">{t("i18n.invalidMermaid")}</span>
            </div>
          </>
        ) : (
          <>
            <div className="d-code-body"><span className="d-term-warn">{t("i18n.invalidMermaid")}</span></div>
            <div className="d-banner warn" style={{ margin: "var(--nx-sp-2) var(--nx-sp-3)" }}>
              <i data-ico="triangle-alert" data-size="14"></i>
              <span className="d-grow">{t("i18n.invalidMermaid")}</span>
            </div>
          </>
        )}
      </>
    ) : renderState?.key !== currentKey || renderState.status !== "ready" ? (
      <div className={isPwa ? "m-placeholder" : "d-placeholder"} style={{ border: 0, borderRadius: 0 /* 非主题值：画板 D-03b 的 Mermaid 画布常量 */, minHeight: 220 /* 非主题值 */ }} aria-label={t("i18n.renderingMermaid")} />
    ) : (
      <>
        {!zoomOpen && (
          <button
            ref={previewRef}
            type="button"
            className={isPwa ? "m-placeholder" : "d-placeholder"}
            style={{ border: 0, borderRadius: 0 /* 非主题值：同上 */, minHeight: 220 /* 非主题值 */, width: "100%", cursor: "pointer" }}
            title={t("i18n.openMermaidViewer")}
            aria-label={t("i18n.openMermaidViewer")}
            onClick={() => setZoomOpen(true)}
            dangerouslySetInnerHTML={{ __html: renderState.svg }}
          />
        )}
        {zoomOpen && <MermaidZoomDialog svg={renderState.svg} onClose={() => setZoomOpen(false)} />}
      </>
    );

  // fork:design-components —— 图形态的 Mermaid 卡片外壳与代码块同一套（画板 10:222-238）：
  // `.pw-code` > `.pw-code-head`（git-fork 图标 + `mermaid` 标签 + grow + `.pw-btn.sm`）。
  return (
    // fork:v5-wave-b —— 窄屏：画板 M-02 的 `.m-code` + `.m-code-head`（同义：图标 +
    // 语言 + grow + 动作钮）。
    <div className={isPwa ? "m-code" : "d-code"}>
      <div className={isPwa ? "m-code-head" : "d-code-head"}>
        <i data-ico="git-fork" data-size="13"></i>
        <span>mermaid</span>
        <span className={isPwa ? "m-grow" : "d-grow"}></span>
        {renderState?.key === currentKey && renderState.status === "ready" && (
          <button
            type="button"
            className="d-btn sm"
            title={`${t("i18n.downloadFile")} (SVG)`}
            aria-label={`${t("i18n.downloadFile")} (SVG)`}
            onClick={() => {
              const svg = previewRef.current?.querySelector("svg");
              if (svg) downloadMermaidSvg(svg);
            }}
          >
            <i data-ico="download" data-size="13"></i>
            SVG
          </button>
        )}
        {previewButton}
      </div>
      {body}
    </div>
  );
}

function MermaidZoomDialog({ svg, onClose }: { svg: string; onClose: () => void }) {
  const { t } = useI18n();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.showModal();

    return () => {
      document.body.style.overflow = previousOverflow;
      if (dialog.open) dialog.close();
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className="mermaid-zoom-dialog"
      aria-label={t("i18n.mermaidViewer")}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        onClose();
      }}
    >
      {/* fork:v5-landing —— 画板 D-03b 帧 E 的全屏缩放查看器：`.d-modal-box wide`
          三段 = `.d-modal-head`（git-fork 图标 + 标题 + d-grow + 缩放器（minus/数值/plus）
          + 适配宽度 + 关闭）/ `.d-modal-body` 可滚动画布 / `.d-modal-foot` 脚注。
          Esc / 点遮罩 / × 三种关法，与图片灯箱一致。 */}
      <div
        className="d-modal-box wide"
        style={{ display: "flex", flexDirection: "column", maxHeight: "100%" }}
      >
        <div className="d-modal-head">
          <div className="d-row">
            <i data-ico="git-fork" data-size="15"></i>
            <span className="d-grow d-t-b">{t("i18n.mermaidDiagram")}</span>
            <div className="d-row" style={{ gap: 0 }}>
            <button
              type="button"
              className="d-iconbtn"
              onClick={() => setZoom((value) => Math.max(ZOOM_MIN, value - ZOOM_STEP))}
              disabled={zoom <= ZOOM_MIN}
              title={t("i18n.zoomOut")}
              aria-label={t("i18n.zoomOut")}
            >
              <i data-ico="minus" data-size="13"></i>
            </button>
            <span
              className="d-mono d-t-sm"
              style={{ minWidth: 52 /* 非主题值：画板 D-03b 的缩放百分比定宽 */, textAlign: "center", fontVariantNumeric: "tabular-nums" }}
            >
              {Math.round(zoom * 100)}%
            </span>
            <button
              type="button"
              className="d-iconbtn"
              onClick={() => setZoom((value) => Math.min(ZOOM_MAX, value + ZOOM_STEP))}
              disabled={zoom >= ZOOM_MAX}
              title={t("i18n.zoomIn")}
              aria-label={t("i18n.zoomIn")}
            >
              <i data-ico="plus" data-size="13"></i>
            </button>
            </div>
            <button
              type="button"
              className="d-iconbtn"
              onClick={() => setZoom(1)}
              title={t("i18n.fitToWidth")}
              aria-label={t("i18n.fitToWidth")}
            >
              <i data-ico="maximize-2" data-size="14"></i>
            </button>
            <button
              type="button"
              className="d-iconbtn"
              onClick={onClose}
              title={t("i18n.close")}
              aria-label={t("i18n.close")}
            >
              <i data-ico="x" data-size="14"></i>
            </button>
          </div>
        </div>
        <div
          className="mermaid-zoom-viewport d-modal-body"
          onClick={(event) => {
            if (event.target === event.currentTarget) onClose();
          }}
        >
          <div
            className="mermaid-zoom-canvas"
            style={{ width: `${zoom * 100}%` }}
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        </div>
        <div className="d-modal-foot" style={{ alignItems: "center" }}>
          <i data-ico="info" data-size="13"></i>
          <span className="d-t-xs d-t-faint d-grow" style={{ textAlign: "left" }}>{t("i18n.mermaidZoomHint")}</span>
        </div>
      </div>
    </dialog>
  );
}

interface CodeBlockProps {
  code: string;
  lang: string;
  headerAction?: ReactNode;
  isStreaming?: boolean;
}

/**
 * Syntax-highlighted code block with copy button.
 * Used as the "source" view for mermaid blocks and for all non-mermaid code fences.
 *
 * Memoized: parent markdown re-renders (e.g. streaming updates elsewhere in
 * the message list) must not re-run Prism tokenization on unchanged code.
 * While the owning message is still streaming, the block renders as plain
 * monospace text — highlighting a growing block re-tokenizes all of it on
 * every chunk, which is the single most expensive part of streamed rendering.
 */
// fork:v5-landing —— 流式期间（以及超大块被跳过时）的纯文本态。
// 画板 D-03b 帧 C 的 `.d-code-body` 已经给了等宽字号/行高/内边距/横滚/底色，
// 所以这里不再写任何内联视觉值；提示行是一行 `.d-t-xs.d-t-faint`（带图标）。
function PlainCode({ code, note }: { code: string; note?: string }) {
  // fork:v5-wave-b —— 窄屏抄 M-02 帧 A：提示行 + `.m-code-scroll > .m-code-body`
  // （长行横滚，不折行）。桌面仍是 D-03b 的 `.d-code-body`。
  const isPwa = usePwaSkin();
  if (isPwa) {
    return (
      <>
        {note && (
          <div className="m-t-xs m-t-faint" role="note" style={{ padding: "var(--nx-sp-2) var(--nx-sp-3) 0" }}>
            <i data-ico="info" data-size="13"></i> {note}
          </div>
        )}
        <div className="m-code-scroll">
          <div className="m-code-body">{code}</div>
        </div>
      </>
    );
  }
  return (
    <>
      {note && (
        <div className="d-t-xs d-t-faint" role="note" style={{ padding: "var(--nx-sp-2) var(--nx-sp-3) 0" }}>
          <i data-ico="info" data-size="13"></i> {note}
        </div>
      )}
      <div className="d-code-body">{code}</div>
    </>
  );
}

/**
 * fork:fix-highlight-chunk — 把「流式结束那一帧一次性全量 tokenize」改成错峰执行。
 *
 * 原来的行为：流式期间渲染纯文本，`isStreaming` 转 false 的那一帧对整块跑 Prism。
 * 一条回答多个大代码块时，它们会在同一帧排队，观感就是「停下来顿一下」。
 *
 * 现在：便宜块（≤ `IMMEDIATE_HIGHLIGHT_CHARS`）仍然立即上色；更大的块按
 * `highlightBudgetMs()` 的预算用 `requestIdleCallback` 推到空闲帧，多个块因此自然分散。
 * 超过 `MAX_HIGHLIGHT_CHARS` / `MAX_HIGHLIGHT_LINES` 的块永不上色，只给一行提示。
 */
function useDeferredHighlight(code: string, enabled: boolean): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!enabled) {
      setReady(false);
      return;
    }
    const budget = highlightBudgetMs(code);
    if (budget === 0) {
      setReady(true);
      return;
    }
    let cancelled = false;
    const idleWindow = window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    if (typeof idleWindow.requestIdleCallback === "function") {
      const handle = idleWindow.requestIdleCallback(() => { if (!cancelled) setReady(true); }, { timeout: budget + 200 });
      return () => {
        cancelled = true;
        idleWindow.cancelIdleCallback?.(handle);
      };
    }
    const timer = setTimeout(() => { if (!cancelled) setReady(true); }, budget);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [code, enabled]);
  return ready;
}

type CopyState = "idle" | "copied" | "failed";

export const CodeBlock = memo(function CodeBlock({ code, lang, headerAction, isStreaming }: CodeBlockProps) {
  const { t } = useI18n();
  const isPwa = usePwaSkin();
  const highlighterReady = useHighlighterReady();
  // fork:fix-clipboard — 三态而不是 `copied: boolean`：复制**可能失败**，而失败必须看得见。
  // 之前 `copyText(code).then(...)` 没有 `.catch`，writeText 被拒时既不报错也不提示，
  // 按钮纹丝不动，控制台挂一条 Uncaught (in promise)。
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const copied = copyState === "copied";
  const failed = copyState === "failed";
  // fork:fix-highlight-chunk — 超大块直接跳过高亮，并在下方给出原因提示。
  const highlightable = shouldHighlightCode(code);
  const deferredReady = useDeferredHighlight(code, !isStreaming && highlighterReady && highlightable);
  const showHighlight = !isStreaming && highlighterReady && highlightable && deferredReady;
  const skippedNote = !isStreaming && code.trim() !== "" && !highlightable ? t(HIGHLIGHT_SKIPPED_I18N_KEY) : undefined;

  const copy = () => {
    // `copyText` 现在永远 resolve 成一个明确结果（成功 / 失败），不抛 rejection。
    void copyText(code).then((result) => {
      const next: CopyState = result.ok ? "copied" : "failed";
      setCopyState(next);
      // 只复位自己刚写下的那一档：连续点两次时旧定时器不能把新状态抹掉。
      window.setTimeout(() => setCopyState((current) => (current === next ? "idle" : current)), result.ok ? 1500 : 2600);
    });
  };

  // fork:v5-landing —— 代码块卡片 = 画板 D-03b 帧 C 那一段：
  // `.d-code` > `.d-code-head`（file-code 图标 + 语言 + `.d-grow` + `.d-btn.sm` 复制钮）
  // > `.d-code-body`（由 PlainCode 或 AsyncCodeHighlighter 提供）。
  return (
    // fork:v5-wave-b —— 窄屏抄 M-02 帧 A 的代码块：`.m-code` > `.m-code-head`
    // （file-code 图标 + 语言 + grow + 动作钮）> `.m-code-scroll > .m-code-body`。
    // 头行**永远可见**，输出横滚 —— 画板 M-02 的第三条硬纪律。
    <div className={isPwa ? "m-code" : "d-code"}>
      <div className={isPwa ? "m-code-head" : "d-code-head"}>
        <i data-ico="file-code" data-size="13"></i>
        <span>{lang || "text"}</span>
        <span className={isPwa ? "m-grow" : "d-grow"}></span>
        {headerAction}
        {/* fork:fix-clipboard — 失败态用画板既有的 `.d-btn.sm.danger` + `.d-badge.bad`，
            没有另造提示系统。按钮保持「复制/已复制」文案不变（画板 D-03b 的形态），
            失败信息由旁边那枚 role=status 徽标承担，键盘/读屏用户也能听到。 */}
        <button
          type="button"
          onClick={copy}
          className={failed ? "d-btn sm danger" : "d-btn sm"}
          title={failed ? t("chat.todosCopyFailed") : undefined}
        >
          <i data-ico={copied ? "check" : "copy"} data-size="13"></i>
          {copied ? t("i18n.copied") : t("i18n.copy")}
        </button>
        {failed && <span role="status" className="d-badge bad">{t("chat.todosCopyFailed")}</span>}
      </div>
      {showHighlight ? (
        <LazyCodeHighlighter language={lang || "text"} showLineNumbers>
          {code}
        </LazyCodeHighlighter>
      ) : (
        <PlainCode code={code} note={skippedNote} />
      )}
    </div>
  );
});

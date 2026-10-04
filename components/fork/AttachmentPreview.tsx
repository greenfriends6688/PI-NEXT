"use client";

/**
 * fork:zc-08 — 附件 chip 的通用预览弹窗（图片 / PDF / DOCX / 音频 / 视频 / 文本）。
 *
 * WHY：composer 里插入的非图片附件此前只是输入框文本里的 `@文件名`，看不到内容；
 * 图片虽然能点开，也没有统一的多类型预览。这个组件把「附件」当作一等对象：
 * 触发按钮自己包在 chip 里，点开后按 `attachmentPreviewKind()` 选渲染分支：
 *
 * - image  → 直接复用既有的 `ImagePreview` 灯箱（不重复实现缩放/焦点/关闭逻辑）；
 * - pdf    → 浏览器内置阅读器的 iframe（与 FileViewer 的 DocumentViewer 同一条
 *            `?type=read` 路径，服务端按扩展名给出 `application/pdf`）；
 * - docx   → 服务端 mammoth 转好的 `?type=preview` HTML iframe（与 FileViewer 相同的
 *            sandbox 与尺寸约定）；
 * - audio / video → 原生 `<audio controls>` / `<video controls>`，服务端支持 Range；
 * - text   → 拉 `?type=read`（服务端返回 JSON chunk）后只渲染前
 *            `TEXT_PREVIEW_MAX_LINES` 行，超出的部分显式标注，避免大文件把弹窗拖死；
 * - none   → 明确的「该类型暂不支持预览」文案，不渲染乱码。
 *
 * 焦点与关闭行为与 `ImagePreview` 对齐：原生 `<dialog showModal>`、打开时锁 body
 * 滚动、焦点进入关闭按钮、关闭后回到触发按钮、Esc / 点击遮罩关闭。
 */

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { ImagePreview } from "@/components/ImagePreview";
import {
  TEXT_PREVIEW_MAX_LINES,
  firstPreviewLines,
  type AttachmentPreviewKind,
} from "@/lib/composer-attachments";
// fork:v5-wave-b —— PWA 形态：弹窗换成画板 M-11 的 `.m-modal-box` / `.m-modal-head`
// / `.m-modal-body` / `.m-modal-foot`，文本预览换成 M-06 的 `.m-code` 系。
import { usePwaSkin } from "@/components/pwa/skin";

export interface AttachmentPreviewProps {
  /** 展示名（文件名，不含目录）。 */
  name: string;
  kind: AttachmentPreviewKind;
  /** 原始内容 URL（`/api/files/...?type=read`）。 */
  src: string;
  /** DOCX 等服务端渲染的预览 URL（`?type=preview`）；缺省回退 `src`。 */
  previewSrc?: string;
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

type TextState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; lines: string[]; truncated: boolean }
  | { status: "error" };

export function AttachmentPreview({
  name,
  kind,
  src,
  previewSrc,
  children,
  className,
  style,
}: AttachmentPreviewProps) {
  const { t } = useI18n();
  const isPwa = usePwaSkin();
  const previewLabel = t("chat.previewAttachment");
  const [open, setOpen] = useState(false);
  const [text, setText] = useState<TextState>({ status: "idle" });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open || kind !== "text") return;
    let active = true;
    setText({ status: "loading" });
    fetch(src)
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        const contentType = response.headers.get("content-type") ?? "";
        if (contentType.includes("application/json")) {
          // 文本走的是服务端 chunk API（JSON），不是裸文本。
          const body = await response.json() as { content?: unknown };
          return typeof body.content === "string" ? body.content : "";
        }
        return response.text();
      })
      .then((content) => {
        if (!active) return;
        setText({ status: "ready", ...firstPreviewLines(content) });
      })
      .catch(() => {
        if (active) setText({ status: "error" });
      });
    return () => {
      active = false;
    };
  }, [kind, open, src]);

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const trigger = triggerRef.current;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.showModal();
    closeButtonRef.current?.focus({ preventScroll: true });

    return () => {
      document.body.style.overflow = previousOverflow;
      if (dialog.open) dialog.close();
      if (trigger?.isConnected) {
        trigger.focus({ preventScroll: true });
      }
    };
  }, [open]);

  const closePreview = () => {
    if (dialogRef.current?.open) dialogRef.current.close();
    setOpen(false);
  };

  // 图片直接复用既有灯箱：它已经处理了缩放、焦点与移动端安全区。
  if (kind === "image") {
    return (
      <ImagePreview src={src} alt={name} className={className} style={style}>
        {children}
      </ImagePreview>
    );
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={className}
        style={{
          display: "block",
          padding: 0,
          border: "none",
          background: "none",
          color: "inherit",
          cursor: "pointer",
          ...style,
        }}
        onClick={() => setOpen(true)}
        aria-label={`${previewLabel}: ${name}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={previewLabel}
      >
        {children}
      </button>
      {open && (
        <dialog
          ref={dialogRef}
          className="image-preview-dialog"
          aria-label={previewLabel}
          onCancel={(event) => {
            event.preventDefault();
            event.stopPropagation();
            closePreview();
          }}
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            event.stopPropagation();
            closePreview();
          }}
          onClick={(event) => {
            if (event.target === event.currentTarget) closePreview();
          }}
        >
          {/* fork:v5-landing —— 弹窗由画板 D-03b 帧 E 的对话框基元拼成：
              `.d-modal-box` + `.d-modal-head/-body/-foot`，关闭钮是画板头部的
              `.d-iconbtn`。`<dialog>` 的壳（.image-preview-dialog）留着 ——
              它是原生 dialog 的全屏定位与遮罩，焦点陷阱 / Esc / 遮罩点击都靠它。
              fork:v5-wave-b —— 窄屏换成 M-11 的 `.m-modal-box` 四件套（同构）。 */}
          {/* fork:v5-wave-b —— 窄屏抄画板 M-11 的 `.m-modal-box` 四件套
              （头 = 文件图标 + grow 标题 + `.m-iconbtn` 关闭；脚 = 说明 + `.m-grow`
              + `.m-btn sm`）。与桌面分支**并排写出**：两个形态的对话框结构不同，
              只换类名就是「只加类不换 DOM」。原生 `<dialog>` 壳与全部关闭行为共用。 */}
          {isPwa ? (
            <div
              className="m-modal-box"
              style={{
                display: "flex",
                flexDirection: "column",
                width: kind === "pdf" || kind === "docx" ? 1000 : 760,
                maxWidth: "100%",
                maxHeight: "100%",
              }}
            >
              <div className="m-modal-head" style={{ display: "flex", alignItems: "center", gap: "var(--nx-sp-2)" }}>
                <i data-ico="file" data-size="14"></i>
                <span
                  className="m-grow m-t-b"
                  title={name}
                  style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                >
                  {name}
                </span>
                <button
                  ref={closeButtonRef}
                  type="button"
                  className="m-iconbtn"
                  onClick={closePreview}
                  aria-label={t("chat.close")}
                  title={t("chat.close")}
                >
                  <i data-ico="x" data-size="14"></i>
                </button>
              </div>
              <div className="m-modal-body" style={{ overflow: "auto", flex: "1 1 auto" }}>
                {renderPreviewBody(kind, { name, src, previewSrc, text, t, isPwa })}
              </div>
              <div className="m-modal-foot">
                <span className="m-t-faint">{t("chat.previewAttachment")}</span>
                <span className="m-grow" />
                <button type="button" className="m-btn sm" onClick={closePreview}>
                  {t("chat.close")}
                </button>
              </div>
            </div>
          ) : (
          <div
            className="d-modal-box"
            style={{
              display: "flex",
              flexDirection: "column",
              width: kind === "pdf" || kind === "docx" ? 1000 : 760,
              maxWidth: "100%",
              maxHeight: "100%",
            }}
          >
            <div className="d-modal-head" style={{ display: "flex", alignItems: "center", gap: "var(--nx-sp-2)" }}>
              <i data-ico="file" data-size="14"></i>
              <span
                className="d-grow d-t-b"
                title={name}
                style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
              >
                {name}
              </span>
              <button
                ref={closeButtonRef}
                type="button"
                className="d-iconbtn"
                onClick={closePreview}
                aria-label={t("chat.close")}
                title={t("chat.close")}
              >
                <i data-ico="x" data-size="14"></i>
              </button>
            </div>
            <div className="d-modal-body" style={{ overflow: "auto", flex: "1 1 auto" }}>
              {renderPreviewBody(kind, { name, src, previewSrc, text, t, isPwa })}
            </div>
            <div className="d-modal-foot">
              <span className="d-t-faint">{t("chat.previewAttachment")}</span>
              <span className="d-grow" />
              <button type="button" className="d-btn sm" onClick={closePreview}>
                {t("chat.close")}
              </button>
            </div>
          </div>
          )}
        </dialog>
      )}
    </>
  );
}

function renderPreviewBody(
  kind: AttachmentPreviewKind,
  context: {
    name: string;
    src: string;
    previewSrc?: string;
    text: TextState;
    t: (key: string, params?: Record<string, string | number>) => string;
    /** fork:v5-wave-b —— 窄屏走画板 M-06 的 `.m-code` / `.m-banner`。 */
    isPwa: boolean;
  },
): React.ReactNode {
  const { name, src, previewSrc, text, t, isPwa } = context;
  switch (kind) {
    case "pdf":
      // 浏览器内置 PDF 阅读器需要同源文档本身（不能加 sandbox），与 FileViewer 一致。
      return (
        <iframe
          src={src}
          title={name}
          style={{ width: "100%", height: "min(78dvh, 720px)", border: "none", background: "var(--bg)" }}
        />
      );
    case "docx":
      return (
        <iframe
          src={previewSrc ?? src}
          sandbox="allow-same-origin"
          title={name}
          style={{ width: "100%", height: "min(78dvh, 720px)", border: "none", background: "var(--n-surface)" }}
        />
      );
    case "audio":
      return (
        <audio
          controls
          preload="metadata"
          src={src}
          style={{ width: "min(520px, 92vw)", margin: "28px 20px" }}
        />
      );
    case "video":
      return (
        <video
          controls
          preload="metadata"
          src={src}
          style={{ display: "block", maxWidth: "100%", maxHeight: "calc(100dvh - 140px)", background: "var(--n-strong)" }}
        />
      );
    case "text": {
      if (text.status === "loading" || text.status === "idle") {
        if (isPwa) {
          return (
            <div className="m-banner">
              <i data-ico="loader-circle" data-size="14"></i>
              <span className="m-grow">{t("chat.previewLoading")}</span>
            </div>
          );
        }
        return (
          <div className="d-banner">
            <i data-ico="loader-circle" data-size="14"></i>
            <span className="d-grow">{t("chat.previewLoading")}</span>
          </div>
        );
      }
      if (text.status === "error") {
        if (isPwa) {
          return (
            <div className="m-banner err">
              <i data-ico="triangle-alert" data-size="14"></i>
              <span className="m-grow">{t("chat.previewTextFailed")}</span>
            </div>
          );
        }
        return (
          <div className="d-banner err">
            <i data-ico="triangle-alert" data-size="14"></i>
            <span className="d-grow">{t("chat.previewTextFailed")}</span>
          </div>
        );
      }
      // fork:v5-wave-b —— 窄屏抄 M-06 的 `.m-code`：正文横滚（`.m-code-scroll`
      // > `.m-code-body`），截断提示在下面一行。
      if (isPwa) {
        return (
          <div className="m-code" style={{ width: "100%" }}>
            <div className="m-code-scroll">
              <div className="m-code-body">{text.lines.join("\n")}</div>
            </div>
            {text.truncated && (
              <div className="m-t-xs m-t-faint" style={{ padding: "var(--nx-sp-2) var(--nx-sp-3)" }}>
                {t("chat.previewTextTruncated", { count: TEXT_PREVIEW_MAX_LINES })}
              </div>
            )}
          </div>
        );
      }
      return (
        <div className="d-code" style={{ width: "100%" }}>
          <div className="d-code-body">{text.lines.join("\n")}</div>
          {text.truncated && (
            <div className="d-t-xs d-t-faint" style={{ padding: "var(--nx-sp-2) var(--nx-sp-3)" }}>
              {t("chat.previewTextTruncated", { count: TEXT_PREVIEW_MAX_LINES })}
            </div>
          )}
        </div>
      );
    }
    default:
      if (isPwa) {
        return (
          <div className="m-banner">
            <i data-ico="circle-help" data-size="14"></i>
            <span className="m-grow">{t("chat.previewUnsupported")}</span>
          </div>
        );
      }
      return (
        <div className="d-banner info">
          <i data-ico="circle-help" data-size="14"></i>
          <span className="d-grow">{t("chat.previewUnsupported")}</span>
        </div>
      );
  }
}

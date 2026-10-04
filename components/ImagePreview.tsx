"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useIsMobile } from "@/hooks/useIsMobile";

interface ImagePreviewProps {
  src: string;
  alt?: string;
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

export function ImagePreview({ src, alt = "", children, className, style }: ImagePreviewProps) {
  const { t } = useI18n();
  // 灯箱在窄屏换 PWA 形态的模态壳（`.m-modal-box` / `.m-modal-head` / `.m-modal-body`
  // / `.m-modal-foot`）；原生 `<dialog>` 的全屏定位、`::backdrop`、焦点陷阱、Esc、
  // 点遮罩关闭全部不动 —— 那一层是 `.image-preview-dialog`，两档都在。
  const isMobile = useIsMobile();
  const previewLabel = t("chat.previewImage");
  const triggerLabel = alt.trim() ? `${previewLabel}: ${alt}` : previewLabel;
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

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
          cursor: "zoom-in",
          ...style,
        }}
        onClick={() => setOpen(true)}
        aria-label={triggerLabel}
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
          aria-label={t("chat.previewImage")}
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
          {/* fork:v5-landing —— 与 D-26b 帧 D「附件预览灯箱」同一套模态壳：
              `.d-modal-box` + `.d-modal-head/-body/-foot`，关闭钮是 `.d-iconbtn`。
              外层 `<dialog>` 保留 `.image-preview-dialog` —— 原生 dialog 的全屏定位、
              ::backdrop、焦点陷阱 / Esc / 点遮罩关闭全靠它；图片本体在 `.d-modal-body`
              里 contain 不裁切。 */}
          <div
            className={isMobile ? "m-modal-box" : "d-modal-box"}
            style={{ width: "100%", maxWidth: "100%", height: "100%", maxHeight: "100%" }}
          >
            <div className={isMobile ? "m-modal-head" : "d-modal-head"} style={{ display: "flex", alignItems: "center", gap: "var(--nx-sp-2)" }}>
              <i data-ico="image" data-size="16"></i>
              <span
                className={isMobile ? "m-grow m-mono m-t-xs" : "d-grow d-mono d-t-sm"}
                title={alt}
                style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 400 }}
              >
                {alt.trim() || previewLabel}
              </span>
              <button
                ref={closeButtonRef}
                type="button"
                className={isMobile ? "m-iconbtn m-touch-44" : "d-iconbtn"}
                onClick={closePreview}
                aria-label={t("chat.close")}
                title={t("chat.close")}
              >
                <i data-ico="x" data-size="16"></i>
              </button>
            </div>
            <div className={isMobile ? "m-modal-body" : "d-modal-body"} style={{ flex: 1, minHeight: 0, display: "grid", placeItems: "center", padding: 0 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={src}
                alt={alt}
                style={{ display: "block", maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
              />
            </div>
            <div className={isMobile ? "m-modal-foot" : "d-modal-foot"} style={{ justifyContent: "flex-start", alignItems: "center", gap: "var(--nx-sp-2)" }}>
              <i data-ico="info" data-size="13"></i>
              <span>{t("chat.previewImage")}</span>
            </div>
          </div>
        </dialog>
      )}
    </>
  );
}

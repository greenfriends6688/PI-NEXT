"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";

interface ImagePreviewProps {
  src: string;
  alt?: string;
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

export function ImagePreview({ src, alt = "", children, className, style }: ImagePreviewProps) {
  const { t } = useI18n();
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
          {/* fork:design-components —— 与 components/fork/AttachmentPreview.tsx 的灯箱
              同一套壳：`.pw-modal` + `.pw-modal-head/-body/-foot`，关闭钮是
              `.pw-iconbtn`（画板 50 附件预览灯箱的头部写法）。外层 `<dialog>` 保留
              `.image-preview-dialog` —— 原生 dialog 的全屏定位、::backdrop、焦点陷阱
              / Esc / 点遮罩关闭全靠它；图片本体在 .pw-modal-body 里 contain 不裁切。 */}
          <div
            className="pw-modal"
            style={{ display: "flex", flexDirection: "column", width: "100%", maxWidth: "100%", height: "100%", maxHeight: "100%" }}
          >
            <div className="pw-modal-head">
              <span className="pw-ico"><i data-ico="image" data-size="16"></i></span>
              <span
                className="pw-grow"
                title={alt}
                style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
              >
                {alt.trim() || previewLabel}
              </span>
              <button
                ref={closeButtonRef}
                type="button"
                className="pw-iconbtn"
                onClick={closePreview}
                aria-label={t("chat.close")}
                title={t("chat.close")}
              >
                <span className="pw-ico"><i data-ico="x" data-size="16"></i></span>
              </button>
            </div>
            <div className="pw-modal-body" style={{ flex: 1, minHeight: 0, display: "grid", placeItems: "center", padding: 0 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="image-preview-image" src={src} alt={alt} />
            </div>
            <div className="pw-modal-foot">
              <span className="pw-ico pw-dim"><i data-ico="info" data-size="13"></i></span>
              <span className="pw-dim">{t("chat.previewImage")}</span>
            </div>
          </div>
        </dialog>
      )}
    </>
  );
}

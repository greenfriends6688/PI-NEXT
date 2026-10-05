"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { getFileName } from "@/lib/file-paths";
import type { WrittenFile } from "@/lib/turn-written-files";
import { getFileIcon } from "./FileIcons";
// fork:v5-wave-b —— PWA 形态：chips 行换成画板 M-03/M-08/M-10 的 `.m-tray` +
// `.m-tray-chip`（PWA 库里唯一的芯片原语；`m-chips` / `m-chipbtn` 定义了但没有
// 画板在用，不新造也不拿死类当视觉来源 —— 登记在汇报里）。
import { usePwaSkin } from "@/components/pwa/skin";

/**
 * Lists the files a turn actually wrote, as buttons that open each one in the
 * preview pane. Entries come from the turn's successful `write`/`edit` tool
 * calls — the reply text is never scanned for paths.
 *
 * fork:v5-landing —— 画板 D-03e 帧 B，逐节点抄：
 *   `.d-row`（pencil-line · 「这一轮写了 N 个文件」· `d-grow` · `d-btn.sm.ghost`「全部」）
 *   › `.d-chips` 里一枚枚 `.d-cite`（文件图标 + 文件名）
 *   › `d-pop`（`d-pop-title` + 每行一个 `d-menu-row`（等宽相对路径 + eye）+ `d-sep` + `d-pop-foot`）
 * 之前只有裸 chips 一行：数量与「全部」清单都没有，「这一轮动了哪些文件」得一枚枚点。
 * 画板里的「新增」徽章产品数据模型没有（`WrittenFile` 只有路径），按结构照实现不上。
 */
export function TurnWrittenFiles({ files, onOpenFile }: {
  files: WrittenFile[];
  onOpenFile?: (filePath: string) => void;
}) {
  const { t } = useI18n();
  const isPwa = usePwaSkin();
  const [listOpen, setListOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // 点外面 / Esc 收起清单。`.d-pop` 是 `display:none` 的浮层宿主，按钮态另挂 `is-open`。
  useEffect(() => {
    if (!listOpen) return;
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setListOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setListOpen(false);
    };
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [listOpen]);

  if (files.length === 0) return null;

  const open = (filePath: string) => {
    setListOpen(false);
    onOpenFile?.(filePath);
  };

  return (
    /* 竖排外壳：抬头行 → chips 行。定位上下文给清单浮层（`position:relative`，
       纯几何，允许内联）。 */
    <div ref={rootRef} style={{ position: "relative", display: "flex", flexDirection: "column", gap: "var(--nx-sp-2)", minWidth: 0 }}>
      {!isPwa && (
        <div className="d-row">
          <i data-ico="pencil-line" data-size="14" aria-hidden="true"></i>
          <span className="d-t-sm d-grow">{t("chat.filesWrittenCount", { count: files.length })}</span>
          <button
            type="button"
            className="d-btn sm ghost"
            aria-expanded={listOpen}
            onClick={() => setListOpen((v) => !v)}
          >
            <i data-ico="list" data-size="13" aria-hidden="true"></i>
            {t("chat.filesWrittenAll")}
          </button>
        </div>
      )}
      <div className={isPwa ? "m-tray" : "d-chips"} aria-label={t("chat.filesWritten")}>
        {files.map(({ filePath }) => {
          const name = getFileName(filePath);
          return (
            <button
              key={filePath}
              type="button"
              className={isPwa ? "m-tray-chip" : "d-cite"}
              title={filePath}
              aria-label={t("chat.openWrittenFile", { name })}
              onClick={() => onOpenFile?.(filePath)}
            >
              {getFileIcon(name, 12)}
              <span>{name}</span>
            </button>
          );
        })}
      </div>
      {!isPwa && (
        <div
          className={`d-pop${listOpen ? " is-open" : ""}`}
          role="group"
          aria-label={t("chat.filesWrittenAll")}
          // 定位与宽度是板面 D-03e 帧 B 那一行浮层的**原值**（非主题值），照抄。
          style={{ position: "absolute", left: "var(--nx-sp-4)", top: "100%", minWidth: 320, zIndex: 20 }}
        >
          <div className="d-pop-title">{t("chat.filesWrittenList")}</div>
          {files.map(({ filePath }) => (
            <button key={filePath} type="button" className="d-menu-row" onClick={() => open(filePath)}>
              {getFileIcon(getFileName(filePath), 14)}
              <span className="d-mono d-grow d-t-xs" style={{ textAlign: "left" }}>{filePath}</span>
              <i data-ico="eye" data-size="13" aria-hidden="true"></i>
            </button>
          ))}
          <div className="d-sep"></div>
          <div className="d-pop-foot">{t("chat.filesWrittenListHint")}</div>
        </div>
      )}
    </div>
  );
}
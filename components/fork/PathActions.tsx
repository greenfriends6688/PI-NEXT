"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";
import { copyText } from "@/lib/clipboard";
// fork:v5-wave-b —— 窄屏换成画板 M-02 的 `.m-iconbtn` / `.m-btn sm` 与 `.m-badge bad`
// （整段并排写在组件里，见 return 处）。
import { usePwaSkin } from "@/components/pwa/skin";

/*
 * fork:ui-20 — the path actions, in one place.
 *
 * Before: "copy path" was re-implemented per surface and "reveal / open with the
 * default app" did not exist at all, even though the file tree and the viewer both
 * show files the user often want to reach in Finder/Explorer (MusePi's file pane
 * exposes exactly these, FilePane.tsx:892-943).
 *
 * fork:fix-clipboard —— 复制也会失败，而且失败必须看得见。`copyText` 现在永远
 * resolve 成 {ok}，所以 copy 走同一套失败态（两个 OS 动作共用一个 state）。
 * 之前是无条件 setCopied(true)：两条路都被拒时按钮纹丝不动，用户以为复制过了。
 *
 * fork:v5-landing D-03e 帧 C —— 路径动作现在是**一枚 `⋯` 触发 + 一张 `d-pop` 清单**：
 *   `.d-row.d-mono.d-t-xs`（路径 + `d-grow` + `.d-iconbtn[ellipsis]`）
 *   › `.d-pop`（`.d-pop-title` 路径 · `复制路径` · `d-sep` · `在文件管理器中显示`
 *     · `用默认应用打开` · 失败徽标）
 * 之前是三枚**永远展开**的图标钮，且桌面端还挂着 v1 的 `.pw-iconbtn.sm` /
 * `.pw-btn.sm` / `.pw-inline` / `.pw-badge`——同一行里两套芯片原语，而画板
 * （D-53 路径动作、M-02）给的是「一行一枚 ⋯，其余收进浮层」。
 *
 * 板面还画了「复制相对路径」与「插入为引用（@）」两行：前者要相对路径（本组件
 * 只拿到绝对路径，调用点才有），后者要把引用写进 composer（要新事件）。两者都没
 * 有画板之外的实现依据，因此**不画假行**——加它们时要连数据/事件一起加。
 */

type ActionState = "idle" | "busy" | "failed";

export function PathActions({
  path,
}: {
  /** Absolute path. The server checks it against the same allow-list as /api/files. */
  path: string;
}): ReactNode {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const [state, setState] = useState<ActionState>("idle");
  const [open, setOpen] = useState(false);
  const busy = state === "busy";
  const failed = state === "failed";
  const rootRef = useRef<HTMLSpanElement>(null);
  const isPwa = usePwaSkin();

  // 点外面 / Esc 收起。`.d-pop` 是 `display:none` 的浮层宿主，开态另挂 `is-open`。
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // 三个动作共用一份失败态：2.6s 后自动收回；只复位自己刚写下的那一档。
  const markFailed = () => {
    setState("failed");
    window.setTimeout(() => setState((current) => (current === "failed" ? "idle" : current)), 2600);
  };

  const run = async (action: "reveal" | "open") => {
    setOpen(false);
    setState("busy");
    try {
      const res = await fetch("/api/files/reveal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path, action }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setState("idle");
    } catch {
      markFailed();
    }
  };

  const copy = () => {
    setOpen(false);
    // `copyText` 永不 reject：失败是一个明确的结果，不是异常。
    void copyText(path).then((result) => {
      if (!result.ok) {
        markFailed();
        return;
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    });
  };

  const rowClass = isPwa ? "m-menu-row" : "d-menu-row";

  return (
    <span ref={rootRef} style={{ position: "relative", display: "inline-flex", alignItems: "center", minWidth: 0 }}>
      {isPwa ? (
        /* fork:v5-wave-b —— 手机上不收进浮层：三枚图标钮常驻（触控目标 44px，
           画板 M-02 的路径动作就是直排），失败走 `.m-badge bad`。 */
        <>
          <button type="button" onClick={copy} title={failed ? t("files.pathActionFailed") : t("files.copyPath")} aria-label={t("files.copyPath")} className="m-iconbtn">
            <i data-ico={copied ? "check" : "copy"} data-size="13"></i>
          </button>
          <button type="button" disabled={busy} onClick={() => void run("reveal")} title={failed ? t("files.pathActionFailed") : t("files.revealPath")} aria-label={t("files.revealPath")} className="m-iconbtn">
            <i data-ico="folder-open" data-size="13"></i>
          </button>
          <button type="button" disabled={busy} onClick={() => void run("open")} title={failed ? t("files.pathActionFailed") : t("files.openPath")} aria-label={t("files.openPath")} className="m-iconbtn">
            <i data-ico="external-link" data-size="13"></i>
          </button>
          {failed && <span className="m-badge bad">{t("files.pathActionFailed")}</span>}
        </>
      ) : (
        <>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            title={t("files.pathActions")}
            aria-label={t("files.pathActions")}
            aria-expanded={open}
            className={failed ? "d-iconbtn danger" : "d-iconbtn"}
          >
            <i data-ico="ellipsis" data-size="14"></i>
          </button>
          <div className={`d-pop${open ? " is-open" : ""}`} role="group" style={{ left: 0, top: "100%", minWidth: 260 }}>
            <div className="d-pop-title">{path}</div>
            <button type="button" className={rowClass} onClick={copy}>
              <i data-ico={copied ? "check" : "copy"} data-size="14" aria-hidden="true"></i>
              <span className="d-grow">{copied ? t("i18n.copied") : t("files.copyPath")}</span>
            </button>
            <div className="d-sep"></div>
            <button type="button" className={rowClass} disabled={busy} onClick={() => void run("reveal")}>
              <i data-ico="folder-open" data-size="14" aria-hidden="true"></i>
              <span className="d-grow">{t("files.revealPath")}</span>
            </button>
            <button type="button" className={rowClass} disabled={busy} onClick={() => void run("open")}>
              <i data-ico="external-link" data-size="14" aria-hidden="true"></i>
              <span className="d-grow">{t("files.openPath")}</span>
            </button>
            {failed && <span className="d-badge bad">{t("files.pathActionFailed")}</span>}
          </div>
        </>
      )}
    </span>
  );
}
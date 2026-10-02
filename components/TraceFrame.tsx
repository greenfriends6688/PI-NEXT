"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";

/**
 * fork:trace-frame —— 右栏「调用轨迹」= **完整历史那一页**，只是换了个位置。
 *
 * 用户 2026-10-02 裁定：内容与样式都用 pi 自己导出的会话页（它已经有侧栏树、
 * 搜索、五档过滤 Default/No-tools/User/Labeled/All、可拖宽、可展开工具输出），
 * 不再另做一套面板。两处工作因此只剩三件：
 * 1. 让 `?inline=1` 的导出页**允许同源 iframe**（`app/api/sessions/[id]/export/route.ts`
 *    的 CSP / X-Frame-Options 对 inline 放宽，下载仍 DENY）；
 * 2. 把它装进右栏那个单例 trace tab；
 * 3. 一枚全屏钮 —— 窄右栏看长轨迹不够用，全屏时用 `position: fixed` 铺满窗口，
 *    退出后回到 tab 里。
 *
 * 刷新：`nonce` 变一次就重载 iframe（新回合落盘后不会自己更新，与其它 iframe 一致）。
 * 全屏时按 Esc 退出，并把焦点还给触发钮。
 */
export function TraceFrame({
  sessionId,
  title,
  active = true,
}: {
  sessionId: string;
  /** tab 标题（会话名）；页头那一行只是说明它是什么，内容在 iframe 里。 */
  title?: string | null;
  /** tab 是否在前台：切回来时重载一次。 */
  active?: boolean;
}) {
  const { t } = useI18n();
  const [nonce, setNonce] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);

  const src = useMemo(() => {
    if (!sessionId) return undefined;
    return `/api/sessions/${encodeURIComponent(sessionId)}/export?inline=1${nonce ? `&v=${nonce}` : ""}`;
  }, [nonce, sessionId]);

  const wasActiveRef = useRef(active);
  useEffect(() => {
    // 切回这个 tab 时重载一次；首次挂载不重载（否则白跑一遍导出）。
    if (active && !wasActiveRef.current) setNonce((value) => value + 1);
    wasActiveRef.current = active;
  }, [active]);

  useEffect(() => {
    if (!fullscreen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFullscreen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [fullscreen]);

  const reload = useCallback(() => setNonce((value) => value + 1), []);

  if (!src) return null;

  const frame = (
    <iframe
      key={src}
      src={src}
      title={title?.trim() || t("trace.title")}
      style={{ width: "100%", height: "100%", border: 0, display: "block", background: "var(--bg)" }}
    />
  );

  return (
    <div className="pw-panel" style={{ height: "100%", minWidth: 0 }}>
      <div className="pw-panel-head">
        <span className="pw-ico" style={{ color: "var(--accent-text)" }}>
          <i data-ico="history" data-size="14" aria-hidden="true"></i>
        </span>
        <b>{t("trace.title")}</b>
        <span className="grow" />
        <button
          type="button"
          className="pw-iconbtn sm"
          onClick={reload}
          title={t("trace.refresh")}
          aria-label={t("trace.refresh")}
        >
          <span className="pw-ico"><i data-ico="refresh-cw" data-size="13" aria-hidden="true"></i></span>
        </button>
        <button
          type="button"
          className="pw-iconbtn sm"
          onClick={() => setFullscreen(true)}
          title={t("trace.fullscreen")}
          aria-label={t("trace.fullscreen")}
        >
          <span className="pw-ico"><i data-ico="maximize-2" data-size="13" aria-hidden="true"></i></span>
        </button>
      </div>
      {/* fork:design-components —— 面板头 + 面板体（画板 54 探索视图那一帧）；
          嵌入的是 pi 自己导出的完整历史页，所以正文里没有本仓的类。 */}
      <div className="pw-panel-body" style={{ minHeight: 0, padding: 0, overflow: "hidden" }}>
        {frame}
      </div>

      {fullscreen ? (
        /* 全屏：fixed 铺满窗口，页头压一条自己的细条（退出钮 + 刷新）。 */
        <div
          role="dialog"
          aria-label={t("trace.fullscreen")}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1000,
            display: "flex",
            flexDirection: "column",
            background: "var(--bg)",
          }}
        >
          <div className="pw-panel-head" style={{ flexShrink: 0 }}>
            <span className="pw-ico" style={{ color: "var(--accent-text)" }}>
              <i data-ico="history" data-size="14" aria-hidden="true"></i>
            </span>
            <b>{title?.trim() || t("trace.title")}</b>
            <span className="grow" />
            <button
              type="button"
              className="pw-iconbtn sm"
              onClick={reload}
              title={t("trace.refresh")}
              aria-label={t("trace.refresh")}
            >
              <span className="pw-ico"><i data-ico="refresh-cw" data-size="13" aria-hidden="true"></i></span>
            </button>
            <button
              type="button"
              className="pw-iconbtn sm"
              onClick={() => setFullscreen(false)}
              title={t("trace.exitFullscreen")}
              aria-label={t("trace.exitFullscreen")}
              autoFocus
            >
              <span className="pw-ico"><i data-ico="minimize-2" data-size="13" aria-hidden="true"></i></span>
            </button>
          </div>
          <div style={{ flex: 1, minHeight: 0 }}>{frame}</div>
        </div>
      ) : null}
    </div>
  );
}

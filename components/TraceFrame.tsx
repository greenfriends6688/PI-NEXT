"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
// fork:v5-wave-b —— PWA 形态：右栏面板换成画板 M-12 的 `.m-viewer` +
// `.m-viewer-bar` + `.m-viewer-scroll`（同义：一条页头 + 一块滚动体）。
import { usePwaSkin } from "@/components/pwa/skin";

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
 *
 * fork:v5-landing —— DOM 换成画板 D-03e 帧 D 的右栏面板：`.d-panel` / `.d-panel-head`
 * （图标 + `.d-t-b` 标题 + `.d-grow` + `.d-iconbtn`）/ `.d-panel-body`。图标一律 `<i data-ico>`。
 * fork:v5-wave-b —— 窄屏换成 M-12 的 `.m-viewer`（整层浮起）/ `.m-viewer-bar`
 * （图标 + 标题 + grow + 图标钮）/ `.m-viewer-scroll`（滚动体）。
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
  const isPwa = usePwaSkin();
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
      style={{ width: "100%", height: "100%", border: 0, display: "block", background: "var(--nx-canvas)" }}
    />
  );

  /* fork:v5-m12-bug（2026-10-06 逐帧）—— PWA 形态的根**不再是** `.m-viewer`。     `.m-viewer` 是 `position:absolute; inset:0`（库里的整层浮起），而本组件在
     产品里**只有一个渲染点**（AppShell 的 `renderTabContent`），也就是它永远是
     M-12 帧 B 那个 `.m-panel-scroll` 里的一块正文。之前它挂 `.m-viewer is-open`，
     于是 `inset:0` 让它脱离自己的 pane 铺满整个视口（实测 390×844，y=0，
     z=100）—— 把 M-12 那一层的「六项横滚切换条」整条盖掉，点进「轨迹」就再也
     切不回别的块，帧 B 的「这一层唯一的入口」当场失效。
     所以 PWA 根改成一块普通的弹性列（`fork-trace-pane`），它自己那枚页头
     （刷新 / 全屏，fork:trace-frame 登记过的那两枚）留着，但用 `fork-trace-bar`
     去掉 `.m-viewer-bar` 的 50px 状态栏让位 —— 那一格是给整层顶栏的，
     在 pane 里再留一次就是白扔一屏。 */
  /* fork:trace-pane-width（2026-10-06，用户反馈「右边有部分区域是空白」）——
     根**不能**挂 `.d-panel`：那是画板 D-05 的**右栏**壳，库里有 `width: 320px;
     flex: 0 0 auto`（`design/v5/web/system.css:21`）。本组件渲染在
     `.file-panel-main` 里（一个 flex 列），显式宽度压过 stretch，实测 iframe
     只有 319px 而 pane 有 539px —— 右边那 220px 空白就是它。
     桌面与窄屏共用 `.fork-trace-pane`（flex: 1 1 auto + min-width: 0，本来
     就是为「pane 内的一列」写的，见 `app/design/v5-forms.css`）。
     页头 / 正文仍用 `.d-panel-head` / `.d-panel-body`，外观不变。 */
  return (
    <div className="fork-trace-pane" style={{ height: "100%", minWidth: 0 }}>
      <div className={isPwa ? "fork-trace-bar" : "d-panel-head"}>
        <i data-ico="list-tree" data-size="14" aria-hidden="true"></i>
        <span className={isPwa ? "m-t-b" : "d-t-b"}>{t("trace.title")}</span>
        <span className={isPwa ? "m-grow" : "d-grow"} />
        <button
          type="button"
          className={isPwa ? "m-iconbtn" : "d-iconbtn"}
          onClick={reload}
          title={t("trace.refresh")}
          aria-label={t("trace.refresh")}
        >
          <i data-ico="refresh-cw" data-size="13" aria-hidden="true"></i>
        </button>
        <button
          type="button"
          className={isPwa ? "m-iconbtn" : "d-iconbtn"}
          onClick={() => setFullscreen(true)}
          title={t("trace.fullscreen")}
          aria-label={t("trace.fullscreen")}
        >
          <i data-ico="maximize-2" data-size="13" aria-hidden="true"></i>
        </button>
      </div>
      {/* fork:v5-landing —— 面板体（画板 D-03e 右栏）；嵌入的是 pi 自己导出的完整历史页，
          所以正文里没有本仓的类。fork:v5-wave-b —— 窄屏是 M-12 的 `.m-viewer-scroll`。 */}
      <div className={isPwa ? "m-viewer-scroll" : "d-panel-body"} style={{ minHeight: 0, padding: 0, overflow: "hidden" }}>
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
            background: "var(--nx-canvas)",
          }}
        >
          <div className={isPwa ? "m-viewer-bar" : "d-panel-head"} style={{ flexShrink: 0 }}>
            <i data-ico="list-tree" data-size="14" aria-hidden="true"></i>
            <span className={isPwa ? "m-t-b" : "d-t-b"}>{title?.trim() || t("trace.title")}</span>
            <span className={isPwa ? "m-grow" : "d-grow"} />
            <button
              type="button"
              className={isPwa ? "m-iconbtn" : "d-iconbtn"}
              onClick={reload}
              title={t("trace.refresh")}
              aria-label={t("trace.refresh")}
            >
              <i data-ico="refresh-cw" data-size="13" aria-hidden="true"></i>
            </button>
            <button
              type="button"
              className={isPwa ? "m-iconbtn" : "d-iconbtn"}
              onClick={() => setFullscreen(false)}
              title={t("trace.exitFullscreen")}
              aria-label={t("trace.exitFullscreen")}
              autoFocus
            >
              <i data-ico="minimize-2" data-size="13" aria-hidden="true"></i>
            </button>
          </div>
          <div style={{ flex: 1, minHeight: 0 }}>{frame}</div>
        </div>
      ) : null}
    </div>
  );
}

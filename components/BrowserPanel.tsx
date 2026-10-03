"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { normalizeBrowserUrl, type BrowserTab } from "./browser-tab-state";
import { PortalDropdown } from "./PortalDropdown";

interface Props {
  tab: BrowserTab;
  /** Keep the tab's url in AppShell state so sessionStorage survives a refresh. */
  onChangeUrl: (tabId: string, url: string) => void;
}

/**
 * An in-app browser for local services (dev servers, docs servers, localhost
 * tools). It is an iframe, so sites that send `X-Frame-Options: DENY` or a
 * `frame-ancestors` CSP simply stay blank — the toolbar offers "open in a new
 * window" for those, and the hint below the address bar says so.
 */
export function BrowserPanel({ tab, onChangeUrl }: Props) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(tab.url);
  const [history, setHistory] = useState<string[]>(() => (tab.url ? [tab.url] : []));
  const [historyIndex, setHistoryIndex] = useState(() => (tab.url ? 0 : -1));
  const [reloadKey, setReloadKey] = useState(0);
  // fork:ui-30 — viewport preset. `null` keeps the iframe filling the panel; a
  // number pins it to a device width and centres it, which is the only way to
  // check a responsive layout without a second device.
  const [viewport, setViewport] = useState<number | null>(null);
  // fork:design-system SW-06 — 视口预设按画板 31 是一枚 `.pw-chipbtn`，点开是
  // `.pw-pop` 列表（不是原生 <select>）。
  const [viewportOpen, setViewportOpen] = useState(false);
  const viewportAnchorRef = useRef<HTMLButtonElement | null>(null);
  const viewportPanelRef = useRef<HTMLDivElement | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  // A tab restored from sessionStorage carries a url the component never saw.
  useEffect(() => {
    setDraft(tab.url);
    setHistory(tab.url ? [tab.url] : []);
    setHistoryIndex(tab.url ? 0 : -1);
  }, [tab.id, tab.url]);

  const currentUrl = history[historyIndex] ?? "";

  const navigate = (input: string, { replace = false } = {}) => {
    const url = normalizeBrowserUrl(input);
    if (!url) return;
    setDraft(url);
    onChangeUrl(tab.id, url);
    if (replace || historyIndex < 0) {
      setHistory((entries) => [...entries.slice(0, historyIndex + 1), url]);
      setHistoryIndex((index) => (historyIndex < 0 ? 0 : index + 1));
      return;
    }
    // Same url: just reload.
    if (url === currentUrl) {
      setReloadKey((key) => key + 1);
      return;
    }
    setHistory((entries) => [...entries.slice(0, historyIndex + 1), url]);
    setHistoryIndex(historyIndex + 1);
  };

  const go = (delta: number) => {
    const next = historyIndex + delta;
    if (next < 0 || next >= history.length) return;
    setHistoryIndex(next);
    const url = history[next];
    setDraft(url);
    onChangeUrl(tab.id, url);
  };

  // fork:design-system SW-06 —— 视口预设清单：图标与顺序照画板 31 帧 B。
  const VIEWPORT_PRESETS = [
    { value: null, icon: "maximize-2", label: t("browser.viewportFill") },
    { value: 390, icon: "smartphone", label: t("browser.viewportPhone") },
    { value: 768, icon: "tablet", label: t("browser.viewportTablet") },
    { value: 1024, icon: "monitor", label: t("browser.viewportLaptop") },
    { value: 1280, icon: "monitor", label: t("browser.viewportDesktop") },
  ] as const;

  return (
    <div className="pw-browser">
      {/* fork:design-system SW-06 —— 头行 = pw-viewer-head（画板 31：地址栏 + 视口预设）。 */}
      <div className="pw-browser-bar">
        <button
          type="button"
          className="pw-iconbtn sm"
          title={t("browser.back")}
          aria-label={t("browser.back")}
          disabled={historyIndex <= 0}
          onClick={() => go(-1)}
        >
          <span className="pw-ico"><i data-ico="arrow-left" data-size="14"></i></span>
        </button>
        <button
          type="button"
          className="pw-iconbtn sm"
          title={t("browser.forward")}
          aria-label={t("browser.forward")}
          disabled={historyIndex >= history.length - 1}
          onClick={() => go(1)}
        >
          <span className="pw-ico"><i data-ico="arrow-right" data-size="14"></i></span>
        </button>
        <button
          type="button"
          className="pw-iconbtn sm"
          title={t("browser.reload")}
          aria-label={t("browser.reload")}
          disabled={!currentUrl}
          onClick={() => setReloadKey((key) => key + 1)}
        >
          <span className="pw-ico"><i data-ico="rotate-cw" data-size="14"></i></span>
        </button>
        {/* fork:design-system SW-06 —— 地址栏 = 画板 31 的 .pw-url（等宽、面板底、细边框）。
           .pw-url 在画板里是 span，这里是真实 input：只补上边框/底色归零之外的行为样式。 */}
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
            event.preventDefault();
            navigate(draft);
          }}
          placeholder={t("browser.addressPlaceholder")}
          aria-label={t("browser.address")}
          spellCheck={false}
          autoComplete="off"
          className="pw-url"
          /* fork:board-diff-2026-10-01 —— 地址栏的等宽字体/字号由 board.css 的
             `.pw-url`（font-family var(--font-mono) / font-size var(--text-meta)）承担，
             这里只留布局所需的 min-width。原来的 `font: "inherit"` 把等宽 11px 顶成了
             UI 无衬线 13px —— `31-terminal-browser-git` 的 spec 把它报成了漂移。 */
          style={{ minWidth: 0 }}
        />
        <a
          href={currentUrl || undefined}
          target="_blank"
          rel="noopener noreferrer"
          title={t("browser.openExternal")}
          aria-label={t("browser.openExternal")}
          className="pw-iconbtn sm"
          aria-disabled={!currentUrl}
          style={{ opacity: currentUrl ? 1 : 0.45, pointerEvents: currentUrl ? "auto" : "none" }}
        >
          <span className="pw-ico"><i data-ico="external-link" data-size="14"></i></span>
        </a>
        {/* fork:ui-30 + fork:design-system SW-06 —— 视口预设：画板 31 是一枚
            `.pw-chipbtn`，点开是 `.pw-pop` 列表；portal 到 body 免得被右栏裁掉。 */}
        <button
          ref={viewportAnchorRef}
          type="button"
          className="pw-chipbtn"
          aria-haspopup="menu"
          aria-expanded={viewportOpen}
          title={t("browser.viewport")}
          aria-label={t("browser.viewport")}
          onClick={() => setViewportOpen((open) => !open)}
        >
          <span className="pw-ico"><i data-ico={viewport === null ? "maximize-2" : "smartphone"} data-size="13"></i></span>
          <span>{viewport === null ? t("browser.viewportFill") : `${viewport}`}</span>
          <span className="pw-ico"><i data-ico="chevron-down" data-size="11"></i></span>
        </button>
      </div>

      <PortalDropdown
        open={viewportOpen}
        anchorRef={viewportAnchorRef}
        panelRef={viewportPanelRef}
        className="pw-pop"
        width={200}
        align="right"
      >
        {VIEWPORT_PRESETS.map((preset) => (
          <button
            key={preset.value ?? "fill"}
            type="button"
            className={`pw-prow${viewport === preset.value ? " is-on" : ""}`}
            onClick={() => {
              setViewport(preset.value);
              setViewportOpen(false);
            }}
          >
            <span className="pw-ico"><i data-ico={preset.icon} data-size="14"></i></span>
            <span className="grow">{preset.label}</span>
            {viewport === preset.value && <span className="pw-ico"><i data-ico="check" data-size="14"></i></span>}
          </button>
        ))}
      </PortalDropdown>

      {currentUrl ? (
        <div className="pw-browser-body">
        <iframe
          ref={iframeRef}
          key={`${currentUrl}#${reloadKey}`}
          src={currentUrl}
          title={tab.url}
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads allow-modals"
          referrerPolicy="no-referrer"
          style={{
            flex: viewport === null ? 1 : "0 0 auto",
            minHeight: 0,
            width: viewport === null ? "100%" : viewport,
            maxWidth: "100%",
            border: "none",
            background: "var(--bg)",
            ...(viewport === null ? {} : { boxShadow: "var(--shadow-sm)", borderLeft: "1px solid var(--border)", borderRight: "1px solid var(--border)" }),
          }}
        />
        </div>
      ) : (
        /* 画板 31 帧 B 的空态：`.pw-empty-inner` + 记号 + 两句说明 */
        <div className="pw-browser-body">
          <div className="pw-empty-inner">
            <span className="mark"><span className="pw-ico"><i data-ico="globe" data-size="16"></i></span></span>
            <p>{t("browser.emptyTitle")}</p>
            <p className="pw-dim">{t("browser.emptyHint")}</p>
          </div>
        </div>
      )}
    </div>
  );
}

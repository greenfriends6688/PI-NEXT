"use client";

import { useEffect, useRef, useState } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useI18n } from "@/hooks/useI18n";
import { createTerminalWriter, terminalRequest } from "@/lib/terminal-client";
import type { TerminalEvent } from "@/lib/terminal-manager";
import type { TerminalTab } from "./terminal-tab-state";
import { TEXT_PX } from "@/lib/typography";
import { useIsMobile } from "@/hooks/useIsMobile";
import { getFileName } from "@/lib/file-paths";
import { TerminalKeybarMobile } from "./pwa/TerminalKeybarMobile";

interface Props {
  tab: TerminalTab;
  active: boolean;
  onRestart: () => void;
  onClosed: () => void;
  onCloseError: () => void;
}

/**
 * 终端恒定是**传统深色**（用户裁定 2026-10-01：「终端的样式还是给我用传统的黑色的吧，
 * 不要这样有白色背景」）。
 *
 * 底 / 字 / 光标 / 选区读 globals.css 里那组「terminal island」定值
 * （`--terminal-surface` / `--terminal-text` / …，`:root` 里**每个主题都一样**），
 * 16 色 ANSI 交给 xterm 自己的传统调色板。
 *
 * 原来这里读的是**应用主题槽位**（`--bg` / `--ansi-*`）：浅色主题下 xterm 就把画布刷成
 * 白色、正文刷成深灰（实测 `--bg`=#fbfbfc / `--ansi-white`=#33333d），而四周的终端头
 * 仍是 island 的深色 —— 于是中间一块白，截图里「不伦不类」。
 *
 * xterm 不接受 `var(--x)`（它自己往 canvas 上画），所以读 `getComputedStyle`；
 * **逐项回退**——某一项读不到时用 xterm 默认，不因为一个 token 缺失就把终端刷成黑白。
 */
const ISLAND_TOKENS = {
  background: "--terminal-surface",
  foreground: "--terminal-text",
  cursor: "--terminal-text",
  brightBlack: "--terminal-text-dim",
  brightWhite: "--terminal-text",
  selectionBackground: "--terminal-selection",
} as const;

function readTerminalTheme(element: HTMLElement): Record<string, string> {
  const styles = getComputedStyle(element);
  const theme: Record<string, string> = {};
  for (const [key, token] of Object.entries(ISLAND_TOKENS)) {
    const value = styles.getPropertyValue(token).trim();
    if (value) theme[key] = value;
  }
  return theme;
}

export function TerminalPanel({ tab, active, onRestart, onClosed, onCloseError }: Props) {
  const { t } = useI18n();
  // M-06 帧 C —— 手机档多一条常驻键排；桌面分支（下面那个 return）一个字都没动。
  const isMobile = useIsMobile();
  const { id, cwd, restored } = tab;
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const startRef = useRef<Promise<void>>(Promise.resolve());
  const writerRef = useRef<ReturnType<typeof createTerminalWriter> | null>(null);
  const callbacksRef = useRef({ onClosed, onCloseError });
  callbacksRef.current = { onClosed, onCloseError };
  const [status, setStatus] = useState<"connecting" | "ready" | "exited" | "error">("connecting");
  const [error, setError] = useState<string | null>(null);
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [reconnectKey, setReconnectKey] = useState(0);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let disposed = false;
    let events: EventSource | null = null;
    let offset: number | undefined;
    let connected = false;
    let exited = false;
    let inputFailed = false;
    setStatus("connecting");
    setError(null);
    setExitCode(null);

    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily: getComputedStyle(container).getPropertyValue("--font-mono").trim() || "monospace",
      // xterm 的 fontSize 必须是数字（它自己测量 canvas），所以用数值 token 而不是 CSS 变量：
      // 仍由梯度驱动，改梯度会跟着变。
      fontSize: TEXT_PX.md,
      lineHeight: 1.25,
      scrollback: 8000,
      screenReaderMode: true,
      disableStdin: true,
      // fork:design-system —— xterm 的 theme 只吃**具体色值**（它自己画 canvas，
      // 不解析 CSS 变量），所以这里必须读计算值。颜色全部来自设计系统的
      // `--ansi-*` / `--n-*` / 语义槽位，深浅主题切换时随 token 走，不再写死一套
      // 自造的十六色。读不到时（SSR / 未挂载）回退到终端自身的默认值。
      theme: readTerminalTheme(container),
    });
    terminalRef.current = terminal;
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(container);
    terminal.attachCustomKeyEventHandler((event) => {
      if (event.type !== "keydown") return true;
      const key = event.key.toLowerCase();
      if ((event.ctrlKey || event.metaKey) && key === "v") return false;
      if ((event.ctrlKey || event.metaKey) && key === "c" && terminal.hasSelection()) return false;
      return true;
    });

    const writer = createTerminalWriter(id, (reason) => {
      if (disposed) return;
      inputFailed = true;
      terminal.options.disableStdin = true;
      setError(reason.message);
      setStatus("error");
    });
    writerRef.current = writer;
    const onData = terminal.onData((data) => {
      if (connected && !exited && !inputFailed) writer.write(data);
    });
    const fitAndResize = () => {
      if (!container.offsetWidth || !container.offsetHeight) return;
      fit.fit();
    };
    const onResize = terminal.onResize(({ cols, rows }) => {
      if (connected && !exited && !inputFailed) writer.resize(cols, rows);
    });
    const resizeObserver = new ResizeObserver(fitAndResize);
    resizeObserver.observe(container);

    const connect = () => {
      if (disposed || exited || !navigator.onLine) return;
      events?.close();
      events = new EventSource(`/api/terminal/${encodeURIComponent(id)}/events${offset === undefined ? "" : `?after=${offset}`}`);
      events.onmessage = (message) => {
        const event = JSON.parse(message.data) as TerminalEvent;
        if (event.type === "output") {
          if (event.reset) terminal.reset();
          else if (offset !== undefined && event.offset <= offset) return;
          terminal.write(event.data);
          offset = event.offset;
        } else {
          exited = true;
          connected = false;
          terminal.options.disableStdin = true;
          events?.close();
          setExitCode(event.type === "exit" ? event.exitCode : null);
          setStatus("exited");
        }
      };
      events.onopen = () => {
        connected = true;
        if (inputFailed) return;
        terminal.options.disableStdin = false;
        setStatus("ready");
        fitAndResize();
        writer.resize(terminal.cols, terminal.rows);
        if (container.offsetWidth && container.offsetHeight) terminal.focus();
      };
      events.onerror = () => {
        if (disposed || exited) return;
        connected = false;
        terminal.options.disableStdin = true;
        setStatus(events?.readyState === EventSource.CLOSED ? "error" : "connecting");
      };
    };

    startRef.current = (async () => {
      fitAndResize();
      if (restored || reconnectKey > 0) {
        // Restoring a tab must never silently launch a replacement shell.
        await terminalRequest(`/api/terminal/${encodeURIComponent(id)}`);
      } else {
        await terminalRequest("/api/terminal", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, cwd, cols: terminal.cols, rows: terminal.rows }),
        });
      }
      connect();
    })().catch((reason: Error) => {
      if (disposed) return;
      setError(reason.message);
      setStatus("error");
    });

    const pageHide = () => {
      connected = false;
      terminal.options.disableStdin = true;
      events?.close();
      if (!exited && !inputFailed) setStatus("connecting");
    };
    const pageShow = (event: PageTransitionEvent) => { if (event.persisted) connect(); };
    window.addEventListener("pagehide", pageHide);
    window.addEventListener("pageshow", pageShow);
    window.addEventListener("offline", pageHide);
    window.addEventListener("online", connect);
    return () => {
      disposed = true;
      events?.close();
      void writer.stop();
      resizeObserver.disconnect();
      onData.dispose();
      onResize.dispose();
      window.removeEventListener("pagehide", pageHide);
      window.removeEventListener("pageshow", pageShow);
      window.removeEventListener("offline", pageHide);
      window.removeEventListener("online", connect);
      terminal.dispose();
      terminalRef.current = null;
    };
  }, [id, cwd, restored, reconnectKey]);

  useEffect(() => {
    if (active) terminalRef.current?.focus();
  }, [active]);

  useEffect(() => {
    if (!tab.closing) return;
    let cancelled = false;
    if (terminalRef.current) terminalRef.current.options.disableStdin = true;
    void (async () => {
      await startRef.current;
      await writerRef.current?.stop();
      await terminalRequest(`/api/terminal/${encodeURIComponent(id)}`, { method: "DELETE", keepalive: true });
      if (!cancelled) callbacksRef.current.onClosed();
    })().catch((reason: Error) => {
      if (cancelled) return;
      setError(reason.message);
      setStatus("error");
      callbacksRef.current.onCloseError();
    });
    return () => { cancelled = true; };
  }, [id, tab.closing]);

  /* fork:v5-skin D-05 帧 B —— 终端面板头照画板 .d-panel-head（square-terminal +
     .d-viewer-path + 右端 .d-iconbtn），状态点用 .d-dot 的语气档；终端主体仍是
     xterm.js 渲染，xterm 的暗色岛槽位不变。 */
  const statusDot = status === "ready" ? "ok" : status === "connecting" ? "run" : status === "exited" ? "warn" : "bad";
  const statusLabel = t(`terminal.${status}`);

  /* M-06 帧 C —— 手机档是**另一个形态**，不是缩小版：顶栏（返回 / 标题 / 清屏 /
     更多）+ 常驻底部键排。xterm 自己仍然是输出区（它往 canvas 上画，`.m-term-mobile`
     那套等宽文本行是给人读静态输出的，手机上这里没有静态输出来排），所以：
       · 输出区 = 桌面同一块 `.terminal-xterm`（暗色岛是用户裁定，两档不变）；
       · 键排 = 新增的 `TerminalKeybarMobile`，写进去的序列走同一条
         `onData → writer.write(data)`，PTY / 尺寸 / 重连 / 关闭逻辑未动。
     画板帧 C 顶栏的「清屏」「更多」在本产品没有对应动作（那是新行为，不在换皮
     范围内），所以顶栏右侧放的是**已有的**重连 / 重启两枚，报给父会话。 */
  if (isMobile) {
    return (
      <section
        className="terminal-panel"
        aria-label={t("terminal.title")}
        style={{ display: "flex", flexDirection: "column", position: "relative", flex: "1 1 auto", minHeight: 0 }}
      >
        <div className="m-fade" aria-hidden="true" />
        <div className="m-top">
          <span className={`m-dot ${statusDot}`} title={statusLabel} aria-label={statusLabel} />
          <span className="m-top-title m-grow" title={cwd}>
            {t("terminal.title")} · {getFileName(cwd)}
          </span>
          {status === "error" && (
            <button
              type="button"
              className="m-top-btn"
              onClick={() => setReconnectKey((key) => key + 1)}
              disabled={Boolean(tab.closing)}
              title={t("terminal.reconnect")}
              aria-label={t("terminal.reconnect")}
            >
              <i data-ico="link" data-size="16" aria-hidden="true"></i>
            </button>
          )}
          <button
            type="button"
            className="m-top-btn"
            onClick={onRestart}
            disabled={Boolean(tab.closing)}
            title={t("terminal.restart")}
            aria-label={t("terminal.restart")}
          >
            <i data-ico="rotate-cw" data-size="16" aria-hidden="true"></i>
          </button>
        </div>

        {(error || status === "exited") && (
          <div style={{ padding: "0 12px 8px" }}>
            {error && (
              <div role="alert" className="m-banner err">
                <i data-ico="circle-alert" data-size="14" aria-hidden="true"></i>
                <span className="m-grow">{error}</span>
              </div>
            )}
            {status === "exited" && (
              <div role="status" className="m-banner">
                <i data-ico="info" data-size="14" aria-hidden="true"></i>
                <span className="m-grow">
                  {exitCode === null ? t("terminal.exited") : t("terminal.exitCode", { code: exitCode })}
                </span>
              </div>
            )}
          </div>
        )}

        <div className="terminal-xterm" style={{ flex: "1 1 auto", minHeight: 0 }}>
          <div ref={containerRef} className="terminal-xterm-host" />
        </div>

        <TerminalKeybarMobile onSequence={(sequence) => terminalRef.current?.paste(sequence)} />
      </section>
    );
  }

  return (
    <section className="terminal-panel d-col" style={{ gap: 0, display: "flex", flexDirection: "column" }} aria-label={t("terminal.title")}>
      <div className="d-panel-head">
        <span className={`d-dot ${statusDot}`} title={t(`terminal.${status}`)} aria-label={t(`terminal.${status}`)} />
        <i data-ico="square-terminal" data-size="14" aria-hidden="true"></i>
        <span className="d-grow d-viewer-path" title={cwd}>{cwd}</span>
        {status === "error" && (
          <button type="button" className="d-iconbtn" onClick={() => setReconnectKey((key) => key + 1)} disabled={Boolean(tab.closing)} title={t("terminal.reconnect")} aria-label={t("terminal.reconnect")}>
            <i data-ico="link" data-size="14" aria-hidden="true"></i>
          </button>
        )}
        <button type="button" className="d-iconbtn" onClick={onRestart} disabled={Boolean(tab.closing)} title={t("terminal.restart")} aria-label={t("terminal.restart")}>
          <i data-ico="rotate-cw" data-size="14" aria-hidden="true"></i>
        </button>
      </div>
      <div className="d-col" style={{ gap: 0, flex: "0 0 auto" }}>
        {error && (
          <div className="d-banner err" role="alert">
            <i data-ico="circle-alert" data-size="14" aria-hidden="true"></i>
            <span className="d-grow">{error}</span>
          </div>
        )}
        {status === "exited" && (
          <div className="d-banner info" role="status">
            <i data-ico="info" data-size="14" aria-hidden="true"></i>
            <span className="d-grow">{exitCode === null ? t("terminal.exited") : t("terminal.exitCode", { code: exitCode })}</span>
          </div>
        )}
      </div>
      <div className="terminal-xterm" style={{ flex: "1 1 auto", minHeight: 0 }}><div ref={containerRef} className="terminal-xterm-host" /></div>
    </section>
  );
}

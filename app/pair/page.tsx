"use client";

import { useEffect, useState } from "react";
import { useIsMobile } from "@/hooks/useIsMobile";

/**
 * fork:lan-access 2 —— 手机上的兑码页（`/pair`）。
 *
 * 这是整个配对里**唯一**需要新增的页面：桌面端给 6 位码，手机打开局域网地址 + 输码，
 * 服务端把 cookie 种好，然后跳回 `/`。抄 MusePi 的形状，但砍掉他们的 relay 与 TLS：
 * 他们要额外开一个无鉴权的 8301 端口专门解析这个码，这里同源 HTTP 一条 POST 就完事。
 *
 * 页面本身不经过 `proxy.ts` 的 LAN 闸门（matcher 只覆盖 `/` 与 `/api/**`），所以
 * 未配对时也能打开 —— 它只能换码，换不到就还是 401。
 *
 * fork:v5-landing Wave B · M-10 · 兑码表单的窄屏形态 = 画板 M-05 帧 B 那一行
 * （`.m-cardgroup` › 提示 + `.m-input` 大字等宽码 + `.m-pickbar` 的「连接」）。
 * 兑码请求、错误处理与跳转一字未改；桌面仍走 `.d-card`，因为
 * `design/v5/pwa/system.css` 只在 ≤640px 生效。
 */
export default function PairPage() {
  const mobile = useIsMobile();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // 桌面端可以直接给一个带码的链接（`/pair#123456`），省掉手机键盘。
    const fromHash = window.location.hash.replace(/^#/, "").trim();
    if (/^\d{6}$/.test(fromHash)) setCode(fromHash);
  }, []);

  async function redeem(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/lan/pair/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.trim() }),
      });
      const payload = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) {
        setError(payload.error ?? `HTTP ${response.status}`);
        return;
      }
      window.location.replace("/");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  if (mobile) {
    return (
      <main
        style={{
          minHeight: "100dvh",
          padding: "var(--nx-sp-4)",
          background: "var(--nx-canvas)",
          color: "var(--nx-text)",
        }}
      >
        <form onSubmit={redeem}>
          <div className="m-cardgroup">
            <div className="m-setrow">
              <span className="m-setrow-body">
                <span className="m-setrow-t">PI NEXT</span>
                <span className="m-setrow-s">电脑上「⋯ → 手机配对」显示的 6 位码。</span>
              </span>
            </div>
            <div className="m-doc-body">
              <input
                className="m-input"
                style={{ width: "100%", fontFamily: "var(--nx-font-mono)", letterSpacing: "0.3em" }}
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="000000"
                aria-label="配对码"
              />
            </div>
            {error && (
              <div className="m-setrow">
                <i data-ico="triangle-alert" data-size="16" aria-hidden="true" />
                <span className="m-setrow-body">
                  <span className="m-setrow-t m-err" role="alert">{error}</span>
                </span>
              </div>
            )}
            <div className="m-pickbar">
              <button type="submit" className="m-picktag is-on" disabled={busy || code.length !== 6}>
                {busy ? "…" : "连接"}
              </button>
            </div>
          </div>
        </form>
      </main>
    );
  }

  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "var(--nx-sp-4)",
        background: "var(--nx-canvas)",
        color: "var(--nx-text)",
      }}
    >
      {/* v5 · D-20/B：兑码表单 = `.d-card` + `.d-card-head` + `.d-card-body`。
          非主题宽度：手机表单惯例 360。 */}
      <form className="d-card" onSubmit={redeem} style={{ width: 360, maxWidth: "100%" }}>
        <div className="d-card-head">
          <i data-ico="smartphone" data-size="16" aria-hidden="true" />
          <span>PI NEXT</span>
          <span className="d-grow" />
        </div>
        <div className="d-card-body d-col" style={{ padding: "var(--nx-sp-4)", gap: "var(--nx-sp-3)" }}>
          <p style={{ margin: 0, fontSize: "var(--nx-fs-sm)", color: "var(--nx-text-2)" }}>
            电脑上「⋯ → 手机配对」显示的 6 位码。
          </p>
          <input
            className="d-input"
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="000000"
            aria-label="配对码"
            style={{
              fontFamily: "var(--nx-font-mono)",
              fontSize: "var(--nx-fs-title)",
              letterSpacing: "0.3em",
              textAlign: "center",
            }}
          />
          {error && (
            <p role="alert" style={{ margin: 0, color: "var(--nx-danger)", fontSize: "var(--nx-fs-xs)" }}>
              {error}
            </p>
          )}
        </div>
        <div
          className="d-row"
          style={{ padding: "var(--nx-sp-3) var(--nx-sp-4)", justifyContent: "flex-end" }}
        >
          <button type="submit" className="d-btn primary" disabled={busy || code.length !== 6}>
            {busy ? "…" : "连接"}
          </button>
        </div>
      </form>
    </main>
  );
}

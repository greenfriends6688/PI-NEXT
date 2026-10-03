"use client";

import { useEffect, useState } from "react";

/**
 * fork:lan-access 2 —— 手机上的兑码页（`/pair`）。
 *
 * 这是整个配对里**唯一**需要新增的页面：桌面端给 6 位码，手机打开局域网地址 + 输码，
 * 服务端把 cookie 种好，然后跳回 `/`。抄 MusePi 的形状，但砍掉他们的 relay 与 TLS：
 * 他们要额外开一个无鉴权的 8301 端口专门解析这个码，这里同源 HTTP 一条 POST 就完事。
 *
 * 页面本身不经过 `proxy.ts` 的 LAN 闸门（matcher 只覆盖 `/` 与 `/api/**`），所以
 * 未配对时也能打开 —— 它只能换码，换不到就还是 401。
 */
export default function PairPage() {
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

  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "var(--s4)",
        background: "var(--bg)",
        color: "var(--text)",
      }}
    >
      {/* 非主题值：兑码页是手机上的一张小表单，宽度取 iOS 表单惯例的 360，
          画板的 .pw-* 类里没有对应原子（ProjectTrustDialog 的 440 是登记在基线里的弹窗）。 */}
      <form className="pw-card" onSubmit={redeem} style={{ width: 360, maxWidth: "100%" }}>
        <div className="pw-card-head">
          <span className="pw-ico"><i data-ico="smartphone" data-size="16" aria-hidden="true"></i></span>
          <span className="pw-tool">PI NEXT</span>
          <span className="grow" />
        </div>
        <div className="pw-card-body" style={{ padding: "var(--s4)", display: "grid", gap: "var(--s3)" }}>
          <p style={{ margin: 0, fontSize: "var(--text-secondary)" }}>
            电脑上「⋯ → 手机配对」显示的 6 位码。
          </p>
          <input
            className="pw-input"
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="000000"
            aria-label="配对码"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "var(--text-title)",
              letterSpacing: "0.3em",
              textAlign: "center",
            }}
          />
          {error && (
            <p role="alert" style={{ margin: 0, color: "var(--error)", fontSize: "var(--text-meta)" }}>
              {error}
            </p>
          )}
        </div>
        <div className="pw-card-foot" style={{ padding: "var(--s3) var(--s4)" }}>
          <span className="grow" />
          <button type="submit" className="pw-btn primary" disabled={busy || code.length !== 6}>
            {busy ? "…" : "连接"}
          </button>
        </div>
      </form>
    </main>
  );
}

"use client";

import { useEffect, useState } from "react";

/**
 * 手机上的兑码页（`/pair`）。
 *
 * 桌面端在「设置 › 手机」给出 6 位码（也画成二维码，扫码就直接带上 `#码`），手机在这个
 * 页面输码/带码进来，服务端把令牌种成 cookie，然后跳回 `/`。
 *
 * 本页不在 proxy 的令牌闸门里（`/api/lan/pair/redeem` 是唯一的免令牌写入路径），所以
 * 未配对时也能打开 —— 它只能换码，换不到就还是 401。
 */
export default function PairPage() {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // 扫码进来是 `/pair#123456`，省掉手机键盘。
    const fromHash = window.location.hash.replace(/^#/, "").trim();
    if (/^\d{6}$/.test(fromHash)) setCode(fromHash);
  }, []);

  async function redeem(event: React.FormEvent) {
    event.preventDefault();
    if (busy || code.length !== 6) return;
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
        display: "grid",
        placeItems: "center",
        padding: 16,
        background: "var(--bg)",
        color: "var(--text)",
      }}
    >
      <form onSubmit={redeem} style={{ width: "100%", maxWidth: 380, display: "grid", gap: 14 }}>
        <div style={{ display: "grid", gap: 6 }}>
          <strong style={{ fontSize: 18 }}>连接 PI NEXT</strong>
          <span style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.5 }}>
            在电脑上打开「设置 › 手机」，把那里的 6 位配对码填进来（或直接扫那张二维码）。
          </span>
        </div>
        <input
          value={code}
          onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="000000"
          aria-label="配对码"
          style={{
            width: "100%",
            padding: "14px 12px",
            borderRadius: 10,
            border: "1px solid var(--border)",
            background: "var(--bg-panel)",
            color: "var(--text)",
            fontFamily: "var(--font-mono)",
            fontSize: 26,
            letterSpacing: "0.35em",
            textAlign: "center",
          }}
        />
        {error && (
          <p role="alert" style={{ margin: 0, color: "var(--danger, #c0392b)", fontSize: 13 }}>{error}</p>
        )}
        <button
          type="submit"
          disabled={busy || code.length !== 6}
          style={{
            padding: "12px 14px",
            borderRadius: 10,
            border: 0,
            background: "var(--accent)",
            color: "var(--accent-contrast, #fff)",
            fontSize: 15,
            fontWeight: 600,
            opacity: busy || code.length !== 6 ? 0.5 : 1,
          }}
        >
          {busy ? "连接中…" : "连接"}
        </button>
      </form>
    </main>
  );
}

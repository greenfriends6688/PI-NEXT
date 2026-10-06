"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useI18n } from "@/hooks/useI18n";

/**
 * fork:mobile-shell —— 「出门访问（自建中继）」设置卡（桌面分节）。
 *
 * 配置面走 `/api/relay`（GET 读状态 / PUT 写配置并启停拨号端）；拨号端状态轮询
 * 2 秒一次。排版复用 v5 已有原子（`.d-input` / `.d-btn` / `.d-t-xs`），零新类。
 * 部署中继的步骤在 relay/README.md。
 */

interface RelayInfo {
  configured: boolean;
  url: string | null;
  serverId: string | null;
  hasToken: boolean;
  phoneAddress: string | null;
  dialer: {
    status: "off" | "connecting" | "connected" | "offline";
    lastError: string | null;
  };
}

export function RelayBody() {
  const { t } = useI18n();
  const [info, setInfo] = useState<RelayInfo | null>(null);
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const timerRef = useRef<number | undefined>(undefined);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/relay", { cache: "no-store" });
      if (!response.ok) return;
      const data = (await response.json()) as RelayInfo;
      setInfo(data);
      setUrl((current) => current || data.url || "");
    } catch {
      // 状态轮询尽力而为。
    }
  }, []);

  useEffect(() => {
    void refresh();
    timerRef.current = window.setInterval(() => void refresh(), 2000);
    return () => window.clearInterval(timerRef.current);
  }, [refresh]);

  const save = useCallback(async (enabled: boolean) => {
    setBusy(true);
    try {
      const response = await fetch("/api/relay", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          url: url.trim() || undefined,
          token: token.trim() || undefined,
          enabled,
        }),
      });
      if (response.ok) {
        const data = (await response.json()) as RelayInfo;
        setInfo(data);
        setSaved(true);
        window.setTimeout(() => setSaved(false), 2000);
      }
    } finally {
      setBusy(false);
    }
  }, [token, url]);

  const statusText = !info?.configured
    ? t("phonePush.relayOff")
    : info.dialer.status === "connected"
      ? t("phonePush.relayConnected")
      : info.dialer.status === "connecting"
        ? t("phonePush.relayConnecting")
        : info.dialer.status === "offline"
          ? t("phonePush.relayOffline")
          : t("phonePush.relayOff");
  const statusTone = info?.dialer.status === "connected" ? "#16a34a" : "#8a8a86";

  return (
    <section className="d-chart" style={{ display: "grid", gridTemplateRows: "auto 1fr auto" }}>
      <div className="d-chart-head">
        <i data-ico="globe" data-size="15" aria-hidden="true" />
        {t("phonePush.relayTitle")}
      </div>
      <div className="d-card-body d-col" style={{ gap: "var(--nx-sp-3)" }}>
        <p className="d-t-xs d-t-faint" style={{ margin: 0 }}>{t("phonePush.relayHint")}</p>
        <label className="d-col" style={{ gap: "var(--nx-sp-1)" }}>
          <span className="d-t-xs d-t-faint">{t("phonePush.relayUrl")}</span>
          <input
            className="d-input d-mono"
            value={url}
            placeholder="https://your-relay.deno.dev"
            spellCheck={false}
            autoCapitalize="off"
            onChange={(event) => setUrl(event.target.value)}
          />
        </label>
        <label className="d-col" style={{ gap: "var(--nx-sp-1)" }}>
          <span className="d-t-xs d-t-faint">
            {t("phonePush.relayToken")}
            {info?.hasToken ? ` · ${t("phonePush.relayTokenStored")}` : ""}
          </span>
          <input
            className="d-input d-mono"
            value={token}
            type="password"
            placeholder="RELAY_TOKEN"
            autoComplete="off"
            onChange={(event) => setToken(event.target.value)}
          />
        </label>
        <div className="d-t-xs" style={{ color: statusTone }}>
          {t("phonePush.relayStatus")}：{statusText}
          {info?.dialer.lastError ? ` · ${info.dialer.lastError}` : ""}
        </div>
        {info?.phoneAddress ? (
          <div className="d-t-xs d-mono" style={{ margin: 0, overflowWrap: "anywhere" }}>
            {t("phonePush.relayPhoneAddress")}：{info.phoneAddress}
          </div>
        ) : null}
      </div>
      <div className="d-card-body" style={{ paddingTop: 0, display: "flex", gap: "var(--nx-sp-2)" }}>
        <button
          type="button"
          className="d-btn"
          disabled={busy || !url.trim()}
          onClick={() => void save(true)}
        >
          <i data-ico="plug" data-size="13" aria-hidden="true" />
          {t("phonePush.relayEnable")}
          {saved ? ` · ${t("phonePush.relaySaved")}` : ""}
        </button>
        {info?.configured ? (
          <button
            type="button"
            className="d-btn ghost"
            disabled={busy}
            onClick={() => void save(false)}
          >
            {t("phonePush.relayDisable")}
          </button>
        ) : null}
      </div>
    </section>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { QrCanvas } from "./QrCanvas";
import { useI18n } from "@/hooks/useI18n";

/**
 * fork:mobile-shell —— 「5G 控制」设置卡：在网页上启停出门隧道、看地址、扫码配对。
 *
 * 状态轮询 `GET /api/tunnel`（2.5s）；启停走 `POST {action}`（配对过的设备皆可操作，
 * 从手机经隧道也能控制）。排版复用 v5 已有原子（`.d-chart` / `.d-input` / `.d-btn` /
 * `QrCanvas`），零新类。
 */

interface TunnelInfo {
  tunnel: {
    enabled: boolean;
    running: boolean;
    url: string | null;
    phoneAddress: string | null;
    lastError: string | null;
    cloudflaredMissing: boolean;
  };
}

export function TunnelBody() {
  const { t } = useI18n();
  const [info, setInfo] = useState<TunnelInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | undefined>(undefined);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/tunnel", { cache: "no-store" });
      if (response.ok) setInfo((await response.json()) as TunnelInfo);
    } catch {
      // 轮询尽力而为。
    }
  }, []);

  useEffect(() => {
    void refresh();
    timerRef.current = window.setInterval(() => void refresh(), 2500);
    return () => window.clearInterval(timerRef.current);
  }, [refresh]);

  const act = useCallback(async (action: "start" | "stop") => {
    setBusy(true);
    try {
      await fetch("/api/tunnel", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  const copyAddress = useCallback(async () => {
    const address = info?.tunnel.phoneAddress;
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // 剪贴板不可用时用户可手动选中。
    }
  }, [info]);

  const tunnel = info?.tunnel;
  const running = tunnel?.running === true;
  const statusText = !tunnel?.enabled
    ? t("tunnel.off")
    : running
      ? t("tunnel.on")
      : tunnel.cloudflaredMissing
        ? tunnel.lastError ?? t("tunnel.off")
        : `${t("tunnel.starting")}${tunnel.lastError ? ` · ${tunnel.lastError}` : ""}`;

  return (
    <section className="d-chart" style={{ display: "grid", gridTemplateRows: "auto auto 1fr auto" }}>
      <div className="d-chart-head">
        <i data-ico="globe" data-size="15" aria-hidden="true" />
        {t("tunnel.cardTitle")}
      </div>
      <div className="d-card-body d-col" style={{ gap: "var(--nx-sp-3)" }}>
        <p className="d-t-xs d-t-faint" style={{ margin: 0 }}>{t("tunnel.hint")}</p>
        <div className="d-t-xs" style={{ color: running ? "#16a34a" : "#8a8a86" }}>
          {t("tunnel.status")}：{statusText}
        </div>
        {running && tunnel?.phoneAddress ? (
          <>
            <div className="d-t-xs d-mono" style={{ margin: 0, overflowWrap: "anywhere" }}>
              {t("tunnel.addr")}：{tunnel.phoneAddress}
            </div>
            <div className="d-card" style={{ padding: "var(--nx-sp-3)", justifySelf: "start" }}>
              <QrCanvas content={`${tunnel.phoneAddress}`} label={t("tunnel.qrLabel")} scale={6} />
            </div>
          </>
        ) : null}
      </div>
      <div className="d-card-body" style={{ paddingTop: 0, display: "flex", gap: "var(--nx-sp-2)" }}>
        {running ? (
          <>
            <button type="button" className="d-btn" onClick={() => void copyAddress()}>
              <i data-ico="copy" data-size="13" aria-hidden="true" />
              {copied ? t("lanPair.copied") : t("lanPair.copyLink")}
            </button>
            <button
              type="button"
              className="d-btn ghost"
              disabled={busy}
              onClick={() => void act("stop")}
            >
              {t("tunnel.stop")}
            </button>
          </>
        ) : (
          <button
            type="button"
            className="d-btn"
            disabled={busy || tunnel?.cloudflaredMissing === true}
            onClick={() => void act("start")}
          >
            <i data-ico="globe" data-size="13" aria-hidden="true" />
            {t("tunnel.start")}
          </button>
        )}
      </div>
    </section>
  );
}

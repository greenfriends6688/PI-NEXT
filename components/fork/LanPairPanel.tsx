"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useI18n } from "@/hooks/useI18n";
import { copyText } from "@/lib/clipboard";
import { QrCanvas } from "./QrCanvas";

/**
 * fork:phone-push —— 左栏「手机扫码连接」。
 *
 * 形态裁定 2026-10-03（对照 ZCode 的「移动端远程控制」弹窗，推翻早先只抄 MusePi
 * `CollabDialog` 的那版）：状态卡（状态名 + 「已就绪」徽标 + 停止钮，分隔线下面是
 * 「无法扫码」的兜底动作）压在大二维码上方；二维码进虚线框、放大一档。
 *
 * 与参考项目**关键差别只有一个**，而它正是用户 2026-10-03 骂的那句「默认给我暂停，
 * 还让我自己启动」：MusePi 的配对是进程内起一个 relay，点一下就有二维码；本仓上一版把
 * 令牌挂在 `PI_WEB_LAN_TOKEN` env 上，于是默认只能报一句英文、还得自己去敲命令行。
 * 现在令牌由 `lib/lan-access.ts` 现生成存盘，启动器下次自动绑网卡 —— 打开这一栏就有码。
 *
 * **剩下那个「重启一次」是架构决定的，不是偷懒**：绑哪张网卡是 `next start` 启动时定的，
 * 进程内没法改。所以这里明确告诉他「正在开启局域网」，而不是假装已经好了。
 */

interface PairInfo {
  code: string;
  readOnly: boolean;
  expiresInSeconds: number;
  lanUrls: string[];
  boundLan?: boolean;
  needsRebind?: boolean;
}

interface AccessState {
  enabled: boolean;
  boundLan: boolean;
  needsRebind: boolean;
  lanUrls: string[];
}

export function LanPairBody() {
  const { t } = useI18n();
  const [access, setAccess] = useState<AccessState | null>(null);
  const [pair, setPair] = useState<PairInfo | null>(null);
  const [readOnly, setReadOnly] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const copiedTimer = useRef<number | null>(null);

  const loadAccess = useCallback(async () => {
    try {
      const response = await fetch("/api/lan/access");
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setAccess(await response.json() as AccessState);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  const mint = useCallback(async () => {
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/lan/pair/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ readOnly }),
      });
      const payload = await response.json() as PairInfo & { error?: string };
      if (!response.ok || !payload.code) {
        setPair(null);
        setError(payload.error ?? `HTTP ${response.status}`);
        return;
      }
      setPair(payload);
    } catch (cause) {
      setPair(null);
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [readOnly]);

  useEffect(() => { void loadAccess(); }, [loadAccess]);
  // 开着就有码：这是「打开就有二维码」的落点（MusePi 点「启动」才有，我们默认就在跑）。
  useEffect(() => { void mint(); }, [mint]);

  // 到期自动换，省得手机端对着一个死码。
  useEffect(() => {
    if (!pair) return;
    const timer = setTimeout(() => void mint(), (pair.expiresInSeconds + 1) * 1000);
    return () => clearTimeout(timer);
  }, [pair, mint]);

  useEffect(() => () => {
    if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current);
  }, []);

  const copyLink = useCallback((text: string) => {
    void copyText(text);
    setCopied(true);
    if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current);
    copiedTimer.current = window.setTimeout(() => setCopied(false), 1600);
  }, []);

  const toggle = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const enabled = !(access?.enabled ?? false);
      const response = await fetch("/api/lan/access", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      const payload = await response.json() as AccessState & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
      setAccess(payload);
      setNotice(enabled ? t("phonePush.autoRestart") : t("phonePush.stopHint"));
      if (!enabled) setPair(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, [access, t]);

  const urls = pair?.lanUrls ?? access?.lanUrls ?? [];
  const firstUrl = urls[0];
  const pairLink = firstUrl && pair ? `${firstUrl}/pair#${pair.code}` : null;

  // 三态：开着等扫（已就绪）、换网卡重启中、关着。徽标色沿用画板 .pw-dot 的语义档。
  const running = access !== null && access.enabled !== false;
  const state = !running
    ? { label: t("phonePush.off"), badge: t("phonePush.badgeOff"), dot: "" }
    : access.needsRebind
      ? { label: t("phonePush.restarting"), badge: t("phonePush.badgeRestart"), dot: " await" }
      : { label: t("phonePush.waiting"), badge: t("phonePush.badgeReady"), dot: " await" };

  return (
    <div style={{ display: "grid", gap: "var(--s3)", alignContent: "start" }}>
      <div className="pw-plan">
        <div className="pw-plan-head" style={{ flexWrap: "wrap" }}>
          <span>{state.label}</span>
          <span className="pw-chip">
            <span aria-hidden="true" className={`pw-dot${state.dot}`} />
            {state.badge}
          </span>
          <span className="grow" />
          <button
            type="button"
            className={running ? "pw-btn outline" : "pw-btn primary"}
            disabled={busy}
            onClick={() => void toggle()}
          >
            <span className="pw-ico"><i data-ico={running ? "unplug" : "play"} data-size="13" aria-hidden="true" /></span>
            {running ? t("phonePush.stop") : t("phonePush.start")}
          </button>
        </div>
        <p className="sub" style={{ margin: 0 }}>{t("phonePush.scanCardHint")}</p>

        {notice && (
          <div className="pw-alert info" role="status" style={{ margin: 0 }}>
            <span className="pw-ico"><i data-ico="info" data-size="14" aria-hidden="true" /></span>
            <span>{notice}</span>
          </div>
        )}
        {error && (
          <div className="pw-alert" role="alert" style={{ margin: 0 }}>
            <span className="pw-ico"><i data-ico="circle-x" data-size="14" aria-hidden="true" /></span>
            <span>{error}</span>
          </div>
        )}

        <div className="pw-sep" />
        <p className="sub" style={{ margin: 0 }}>{t("phonePush.cannotScan")}</p>
        <div className="pw-row" style={{ gap: "var(--s2)", cursor: "default", flexWrap: "wrap" }}>
          <button type="button" className="pw-btn outline" onClick={() => void mint()} disabled={!pair}>
            <span className="pw-ico"><i data-ico="refresh-cw" data-size="13" aria-hidden="true" /></span>
            {t("phonePush.refreshQr")}
          </button>
          <button
            type="button"
            className="pw-btn outline"
            disabled={!pairLink}
            onClick={() => { if (pairLink) copyLink(pairLink); }}
          >
            <span className="pw-ico"><i data-ico={copied ? "circle-check" : "copy"} data-size="13" aria-hidden="true" /></span>
            {copied ? t("lanPair.copied") : t("lanPair.copyLink")}
          </button>
        </div>
      </div>

      {pairLink && (
        <div
          style={{
            display: "grid",
            justifyItems: "center",
            padding: "var(--s4)",
            border: "1px dashed var(--n-border-subtle)",
            borderRadius: "var(--radius-6)",
          }}
        >
          <QrCanvas content={pairLink} label={t("lanPair.qrLabel")} scale={8} />
        </div>
      )}

      <div className="pw-row" style={{ gap: "var(--s2)", cursor: "default" }}>
        <input
          id="lan-pair-readonly"
          type="checkbox"
          checked={readOnly}
          onChange={(event) => setReadOnly(event.target.checked)}
        />
        <label htmlFor="lan-pair-readonly" className="pw-name" style={{ cursor: "pointer" }}>
          {t("lanPair.readOnly")}
        </label>
      </div>

      {pair && (
        <p className="sub" style={{ margin: 0 }}>
          {t("lanPair.codeLabel")}:{" "}
          <span className="pw-mono" style={{ letterSpacing: "0.2em" }}>{pair.code}</span>
          {" · "}
          {t("lanPair.hint", { seconds: pair.expiresInSeconds })}
        </p>
      )}

      {urls.length > 1 && (
        <p className="sub" style={{ margin: 0 }}>{urls.join("  ·  ")}</p>
      )}
    </div>
  );
}

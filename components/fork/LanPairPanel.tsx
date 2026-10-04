"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useIsMobile } from "@/hooks/useIsMobile";
import { useI18n } from "@/hooks/useI18n";
import { PwaBanner, PwaSetRow, PwaSwitchRow } from "@/components/pwa/PwaPage";
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
  const mobile = useIsMobile();
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

  // 三态：开着等扫（已就绪）、换网卡重启中、关着。徽标色沿用画板 `.d-dot` 的语义档。
  const running = access !== null && access.enabled !== false;
  const state = !running
    ? { label: t("phonePush.off"), badge: t("phonePush.badgeOff"), dot: "" }
    : access.needsRebind
      ? { label: t("phonePush.restarting"), badge: t("phonePush.badgeRestart"), dot: " await" }
      : { label: t("phonePush.waiting"), badge: t("phonePush.badgeReady"), dot: " await" };
  // fork:v5-landing Wave B：`.d-dot` 的档位在 PWA 库里叫法不同（`.m-dot` 的
  // ok / warn / bad / run），所以窄屏这一份单独映射，不复用桌面的修饰类名。
  const mobileDot = !running ? "" : access.needsRebind ? " warn" : " run";

  // fork:v5-landing Wave B · M-10 · 窄屏形态 ——
  // 令牌与配对码一个都不改（同一个 `/api/lan/access` 与 `/api/lan/pair/generate`），
  // 二维码仍是 `QrCanvas` 的 vendor 画法（一字未改），只换外面那层容器：
  // 状态行 `.m-setrow` + 徽章，扫码失败兼底 `.m-setrow`，二维码进 `.m-placeholder`。
  if (mobile) {
    return (
      <>
        <div className="m-cardgroup">
          <PwaSetRow
            icon="smartphone"
            label={state.label}
            sub={t("phonePush.scanCardHint")}
            trailing={
              <span className="m-badge">
                <span className={`m-dot${mobileDot}`} aria-hidden="true" />
                {state.badge}
              </span>
            }
          />
          <button
            type="button"
            className="m-setrow"
            onClick={() => void toggle()}
            disabled={busy}
          >
            <span className="m-setrow-body">
              <span className="m-setrow-t">{running ? t("phonePush.stop") : t("phonePush.start")}</span>
              <span className="m-setrow-s">{t("phonePush.autoRestart")}</span>
            </span>
            <i data-ico={running ? "unplug" : "play"} data-size="16" aria-hidden="true" />
          </button>

          {notice && <PwaBanner icon="info" role="status">{notice}</PwaBanner>}
          {error && <PwaBanner icon="circle-x" tone="err" role="alert">{error}</PwaBanner>}
          {access && !access.enabled && (
            <PwaBanner icon="shield-alert" tone="warn">{t("phonePush.noToken")}</PwaBanner>
          )}

          <PwaSetRow
            label={t("phonePush.cannotScan")}
            trailing={
              <>
                <button type="button" className="m-btn sm" onClick={() => void mint()} disabled={!pair}>
                  <i data-ico="refresh-cw" data-size="13" aria-hidden="true" />
                  {t("phonePush.refreshQr")}
                </button>
                <button
                  type="button"
                  className="m-btn sm"
                  disabled={!pairLink}
                  onClick={() => { if (pairLink) copyLink(pairLink); }}
                >
                  <i data-ico={copied ? "circle-check" : "copy"} data-size="13" aria-hidden="true" />
                  {copied ? t("lanPair.copied") : t("lanPair.copyLink")}
                </button>
              </>
            }
          />

          <PwaSwitchRow
            icon="lock"
            label={t("lanPair.readOnly")}
            checked={readOnly}
            switchLabel={t("lanPair.readOnly")}
            onChange={setReadOnly}
          />

          {pair && (
            <PwaSetRow
              icon="key-round"
              label={t("lanPair.codeLabel")}
              sub={`${pair.code} · ${t("lanPair.hint", { seconds: pair.expiresInSeconds })}`}
            />
          )}
          {urls.length > 1 && (
            <PwaSetRow label={t("phonePush.lanTitle")} sub={urls.join("  ·  ")} />
          )}
        </div>

        {pairLink && (
          <div className="m-placeholder" style={{ marginTop: "var(--nx-sp-2)" }}>
            <QrCanvas content={pairLink} label={t("lanPair.qrLabel")} scale={8} />
          </div>
        )}
      </>
    );
  }

  return (
    <div className="d-col" style={{ gap: "var(--nx-sp-3)", alignContent: "start" }}>
      {/* v5 · D-20 帧 A：扫码状态做成设置段 + 行，按钮一律 `.d-btn`。 */}
      <div className="d-set-sec">
        <div className="d-set-row" style={{ flexWrap: "wrap" }}>
          <div className="d-set-row-box">
            <div className="d-row">
              <span className="d-set-row-t">{state.label}</span>
              <span className="d-badge">
                <span aria-hidden="true" className={`d-dot${state.dot}`} />
                {state.badge}
              </span>
            </div>
            <div className="d-set-row-s">{t("phonePush.scanCardHint")}</div>
          </div>
          <span className="d-grow-last">
            <button
              type="button"
              className={running ? "d-btn" : "d-btn primary"}
              disabled={busy}
              onClick={() => void toggle()}
            >
              <i data-ico={running ? "unplug" : "play"} data-size="13" aria-hidden="true" />
              {running ? t("phonePush.stop") : t("phonePush.start")}
            </button>
          </span>
        </div>

        {notice && (
          <div className="d-banner info" role="status">
            <i data-ico="info" data-size="14" aria-hidden="true" />
            <span>{notice}</span>
          </div>
        )}
        {error && (
          <div className="d-banner err" role="alert">
            <i data-ico="circle-x" data-size="14" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        <div className="d-set-row">
          <div className="d-set-row-box">
            <div className="d-set-row-t">{t("phonePush.cannotScan")}</div>
          </div>
          <span className="d-grow-last d-row" style={{ gap: "var(--nx-sp-2)", flexWrap: "wrap" }}>
            <button type="button" className="d-btn" onClick={() => void mint()} disabled={!pair}>
              <i data-ico="refresh-cw" data-size="13" aria-hidden="true" />
              {t("phonePush.refreshQr")}
            </button>
            <button
              type="button"
              className="d-btn"
              disabled={!pairLink}
              onClick={() => { if (pairLink) copyLink(pairLink); }}
            >
              <i data-ico={copied ? "circle-check" : "copy"} data-size="13" aria-hidden="true" />
              {copied ? t("lanPair.copied") : t("lanPair.copyLink")}
            </button>
          </span>
        </div>
      </div>

      {pairLink && (
        <div className="d-placeholder" style={{ display: "grid", justifyContent: "center", padding: "var(--nx-sp-4)" }}>
          <QrCanvas content={pairLink} label={t("lanPair.qrLabel")} scale={8} />
        </div>
      )}

      <div className="d-row" style={{ gap: "var(--nx-sp-2)" }}>
        <input
          id="lan-pair-readonly"
          type="checkbox"
          checked={readOnly}
          onChange={(event) => setReadOnly(event.target.checked)}
        />
        <label htmlFor="lan-pair-readonly" className="d-t-sm" style={{ cursor: "pointer" }}>
          {t("lanPair.readOnly")}
        </label>
      </div>

      {pair && (
        <p className="d-t-xs d-t-faint" style={{ margin: 0 }}>
          {t("lanPair.codeLabel")}:{" "}
          <span className="d-mono" style={{ letterSpacing: "0.2em" }}>{pair.code}</span>
          {" · "}
          {t("lanPair.hint", { seconds: pair.expiresInSeconds })}
        </p>
      )}

      {urls.length > 1 && (
        <p className="d-t-xs d-t-faint" style={{ margin: 0 }}>{urls.join("  ·  ")}</p>
      )}
    </div>
  );
}

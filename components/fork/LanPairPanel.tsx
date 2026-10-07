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
            /* fork:v5-landing · M-09 帧 D 的 `.m-card` ——
               画板自己区分得很清楚：`.m-cardgroup` 是「一叠行、用分隔线分开」，
               `.m-card`（头 + 体）是「一块要解释的东西」。配对码正是后者 ——
               它不是一列设置项，而是一段要照着输的东西，所以单独占一张卡。
               头：图标 + 名称 + grow + 到期徽章；体：逐位键帽 + 一句说明。 */
            <div className="m-card">
              <div className="m-card-head">
                <i data-ico="key-round" data-size="15" aria-hidden="true" />
                {t("lanPair.codeLabel")}
                <span className="m-grow" aria-hidden="true" />
                <span className="m-badge warn">
                  <i data-ico="clock" data-size="12" aria-hidden="true" />
                  {t("lanPair.hint", { seconds: pair.expiresInSeconds })}
                </span>
              </div>
              <div className="m-card-body">
                <span className="m-setrow-body">
                  <span className="m-setrow-t m-hist-row">
                    {pair.code.split("").map((digit, index) => (
                      <span className="m-kbd" key={`${pair.code}-${index}`}>{digit}</span>
                    ))}
                  </span>
                  <span className="m-setrow-s">{t("lanPair.sub")}</span>
                </span>
              </div>
            </div>
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
        {/* fork:stop-btn-clipped（2026-10-06 用户实拍）—— 这里原来内联了
            `flexWrap: "wrap"`：一旦说明长到把 `.d-set-row-box` 撑满，右边那一格
            （`.d-grow-last` 里的「停止」钮，`flex: 0 0 auto` 不许缩）就被挤到第二行，
            而 `.d-setcard` 有 `overflow: hidden` → 按钮下半截被裁掉。
            库里的 `.d-set-row` 本来就不换行（`flex` 行，`.d-grow-last` 有 `margin-left:auto`
            占位），所以这一格不需要也不该换行。 */}
        <div className="d-set-row">
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

      {/* fork:v5-landing · D-20 帧 A「配对码」——
          画板把这一段写成独立的一节，而不是正文里的一行小字，理由写在它自己的
          注记里：**键帽形态是「照着输」的暗示**。所以 6 位逐位渲染成 `.d-kbd`，
          尺寸那三个值是画板给的行内几何（高度 / 内边距 / 字号，一律走 `var()`），
          类名与嵌套照抄。副行用已有的 `lanPair.sub` / `lanPair.hint`，
          不新造文案（缺的第二行已在报告里登记为待补 key）。
          令牌与配对码的口径一个字没动：同一个 `/api/lan/pair/generate`、同一份 code。 */}
      {pair && (
        <div className="d-set-sec">
          <div className="d-set-sec-t">{t("lanPair.codeLabel")}</div>
          <div className="d-card">
            <div className="d-card-body d-col" style={{ gap: "var(--nx-sp-3)" }}>
              {/* fork:lan-pair-hint-line（2026-10-07 用户实拍「这个放这里可以吗」）——
                  那句说明原来与 6 枚键帽同排、被夹在 `.d-grow` 垫片与行尾之间：
                  `.d-col` 没有 flex-shrink 控制，空间被垫片吃干后就只剩
                  min-content 宽，中文于是**一字一行竖着排**（截图里那一竖行）。
                  改成键帽行下面独占一行（同一段文案、同一个类，只换位置）。 */}
              <div className="d-row" style={{ gap: "var(--nx-sp-2)" }}>
                {pair.code.split("").map((digit, index) => (
                  <span
                    key={`${pair.code}-${index}`}
                    className="d-kbd"
                    style={{ height: "var(--nx-ctl-lg)", padding: "0 var(--nx-sp-3)", fontSize: "var(--nx-fs-lg)" }}
                  >
                    {digit}
                  </span>
                ))}
              </div>
              <span className="d-t-xs d-t-faint">{t("lanPair.sub")}</span>
              <div className="d-row">
                <span className="d-badge warn">
                  <i data-ico="clock" data-size="12" aria-hidden="true" />
                  {t("lanPair.hint", { seconds: pair.expiresInSeconds })}
                </span>
                <span className="d-grow" aria-hidden="true" />
                <button
                  type="button"
                  className="d-btn sm"
                  onClick={() => void mint()}
                  disabled={busy}
                >
                  <i data-ico="rotate-cw" data-size="13" aria-hidden="true" />
                  {t("lanPair.refresh")}
                </button>
              </div>
            </div>
          </div>
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

      {/* fork:v5-landing · D-20 帧 B「旁边必须写清的三件事」之一 ——
          地址是一个「可以直接抄走」的盒子，不是正文里的一串灰字。
          `.d-urlbox` 内是 `<i data-ico>` + 一段 `.d-mono`（超长省略由 CSS 负责），
          与画板的 `globe` 那一行同构。地址本身没变：仍是 `access.lanUrls` / `pair.lanUrls`。
          **原来那句 `urls.join("  ·  ")` 的段落已删**（铁律五：DOM 挪了而旧写法还在
          = 同一个地址在屏幕上出现两次）。窄屏那一行仍在（形态不同，不是同一段）。 */}
      {urls.length > 0 && (
        <div className="d-col" style={{ gap: "var(--nx-sp-1)" }}>
          <span className="d-t-xs d-t-faint">{t("phonePush.lanTitle")}</span>
          {urls.map((url) => (
            <div key={url} className="d-urlbox">
              <i data-ico="globe" data-size="12" aria-hidden="true" />
              <span>{url}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { QrCanvas } from "./QrCanvas";
import { setDesktopLanAccess } from "@/lib/desktop-shell";

/**
 * 设置 › 手机：局域网访问的开关、可以打开的地址、6 位配对码与二维码。
 *
 * 这一栏是「手机能连上」的全部界面。打开它 = 生成令牌并开启（`GET /api/lan/access`
 * 第一次访问就建一个），之后同一局域网里的手机打开列出的任一地址 + 配对即可。
 * 桌面壳切换时会让主进程重启子服务来改绑网卡；`needsRebind` 为真时在这里如实说明。
 */

interface LanAccessState {
  enabled: boolean;
  boundLan: boolean;
  needsRebind: boolean;
  lanUrls: string[];
  tokenHint: string | null;
}

interface PairState {
  code: string;
  readOnly: boolean;
  expiresInSeconds: number;
  lanUrls: string[];
}

export function LanAccessPanel() {
  const [state, setState] = useState<LanAccessState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pair, setPair] = useState<PairState | null>(null);
  const [pairError, setPairError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/lan/access", { cache: "no-store" });
      const data = await response.json() as LanAccessState & { error?: string };
      if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
      setState(data);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const setEnabled = async (enabled: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/lan/access", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      const data = await response.json() as LanAccessState & { error?: string };
      if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
      // 桌面壳里光写配置文件不够：内部服务绑在回环上，手机连不到。这里让主进程
      // 重新绑到局域网并重启子服务（浏览器里没有这个桥，返回 null 就只靠重启生效）。
      await setDesktopLanAccess(enabled);
      await load();
      if (!enabled) setPair(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const mintPair = async (readOnly: boolean) => {
    setPairError(null);
    try {
      const response = await fetch("/api/lan/pair/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ readOnly }),
      });
      const data = await response.json() as PairState & { error?: string };
      if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
      setPair(data);
    } catch (cause) {
      setPairError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  // 二维码内容直接用第一条可达地址：扫码后手机打开该地址的 /pair 并带上门牌号。
  const pairUrl = pair && pair.lanUrls[0] ? `${pair.lanUrls[0]}/pair#${pair.code}` : null;

  return (
    <section className="set-section">
      <h2 className="set-section__title">手机与局域网</h2>
      <div className="card">
        <div className="crow">
          <div className="crow__text">
            <div className="crow__title">允许同一局域网访问</div>
            <div className="crow__detail">
              打开后，同一个 Wi-Fi 下的手机、平板可以用列出的地址打开这个界面。没有登录，
              所以只有拿到配对码的设备能用。
            </div>
          </div>
          <div className="crow__control">
            <button
              type="button"
              role="switch"
              aria-checked={state?.enabled === true}
              aria-busy={busy || undefined}
              aria-label="允许同一局域网访问"
              disabled={busy || state === null}
              className={`config-switch${busy ? " is-loading" : ""}`}
              onClick={() => void setEnabled(state?.enabled !== true)}
            >
              <span className={`switch${state?.enabled ? " is-on" : ""}`} aria-hidden="true"><i /></span>
            </button>
          </div>
        </div>

        {state?.enabled && (
          <>
            <div className="cdivider" />
            <div className="crow">
              <div className="crow__text">
                <div className="crow__title">这个地址在手机上打开</div>
                {state.lanUrls.length > 0 ? (
                  <ul style={{ margin: "4px 0 0", padding: 0, listStyle: "none", display: "grid", gap: 2 }}>
                    {state.lanUrls.map((url) => (
                      <li key={url}>
                        <code style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>{url}</code>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="crow__detail">这台机器现在没有局域网地址（没连 Wi-Fi 或只有回环）。</div>
                )}
              </div>
            </div>

            <div className="cdivider" />
            <div className="crow">
              <div className="crow__text">
                <div className="crow__title">配对一台手机</div>
                <div className="crow__detail">
                  生成一个 6 位码，10 分钟内有效，用一次就作废。手机打开上面的地址，
                  填进配对码即可；扫右边的二维码也行。
                </div>
                {state.needsRebind && (
                  <div className="crow__detail" role="status">
                    已开启，但要重启一次 Pi Web 才会绑到网卡上（桌面端会自己重启）。
                  </div>
                )}
                {pairError && <div className="crow__detail" role="alert">{pairError}</div>}
              </div>
              <div className="crow__control" style={{ display: "grid", gap: 8, justifyItems: "end" }}>
                <div style={{ display: "flex", gap: 6 }}>
                  <button type="button" className="btn" onClick={() => void mintPair(false)}>生成配对码</button>
                  <button type="button" className="btn" onClick={() => void mintPair(true)}>只读码</button>
                </div>
                {pair && (
                  <div style={{ display: "grid", gap: 6, justifyItems: "center" }}>
                    <code style={{ fontFamily: "var(--font-mono)", fontSize: 22, letterSpacing: "0.3em" }}>{pair.code}</code>
                    {pairUrl && <QrCanvas content={pairUrl} label="配对二维码" scale={4} />}
                    <span style={{ fontSize: 11, color: "var(--text-dim)" }}>
                      {pair.readOnly ? "只读：只能看，不能发消息" : "完整权限"} · {Math.round(pair.expiresInSeconds / 60)} 分钟有效
                    </span>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
      {error && <p role="alert" className="settings-general-error">{error}</p>}
    </section>
  );
}

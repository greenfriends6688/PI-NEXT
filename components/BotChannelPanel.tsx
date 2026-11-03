"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { QrCanvas } from "./QrCanvas";

/**
 * 设置 › Bot：把聊天应用接到这台机器上（微信 / 飞书 / Lark / 企业微信）。
 *
 * 一条消息进来 → 交给一个会话跑 → 答复发回聊天。微信与飞书跑的是**这台机器上的**长轮询 /
 * 长连接，不需要公网地址；企业微信只支持回调 URL，所以它那一栏如实说明要一个公网 HTTPS
 * 地址（隧道），并把该填的地址直接写出来。
 *
 * 凭证（bot_token / app_secret / 企业微信 Secret）只显示首尾 4 位，存在
 * `~/.pi/agent/bot-channel.json`（0600）。
 */

type ChannelId = "wechat" | "feishu" | "lark" | "dingtalk" | "wecom";

interface ChannelStatus {
  id: ChannelId;
  label: string;
  lanFriendly: boolean;
  requires: string[];
  note: string;
  configured: boolean;
  hasAppId: boolean;
  hasAgentId: boolean;
  hasCallback: boolean;
  allowCount: number;
  sessionId: string;
  ready: boolean;
  missing: string[];
  running: boolean;
  tokenHint: string | null;
}

const inputStyle: CSSProperties = {
  width: "100%",
  minWidth: 0,
  height: 34,
  padding: "0 9px",
  border: "1px solid var(--border)",
  borderRadius: 5,
  background: "var(--bg)",
  color: "var(--text)",
  fontSize: 12,
  outline: "none",
};

/** 微信与飞书 / Lark 扫码接入；钉钉与企业微信填应用凭证。 */
function scannerFields(id: ChannelId): boolean {
  return id === "wechat" || id === "feishu" || id === "lark";
}

export function BotChannelPanel() {
  const [channels, setChannels] = useState<ChannelStatus[]>([]);
  const [active, setActive] = useState<ChannelId>("wechat");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ kind: "ok" | "error"; message: string } | null>(null);
  const [sessionId, setSessionId] = useState("");
  const [allowFrom, setAllowFrom] = useState("");
  const [secret, setSecret] = useState("");
  const [appId, setAppId] = useState("");
  const [agentId, setAgentId] = useState("");
  const [callbackToken, setCallbackToken] = useState("");
  const [callbackAesKey, setCallbackAesKey] = useState("");
  // 扫码注册：二维码内容 + 轮询状态。
  const [scan, setScan] = useState<{ qrContent: string; status: string } | null>(null);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/bot-channel", { cache: "no-store" });
      const data = await response.json() as { channels?: ChannelStatus[]; error?: string };
      if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
      const list = data.channels ?? [];
      setChannels(list);
      const current = list.find((channel) => channel.id === active);
      if (current) setSessionId(current.sessionId);
    } catch (cause) {
      setNote({ kind: "error", message: cause instanceof Error ? cause.message : String(cause) });
    }
  }, [active]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => () => { if (pollTimer.current) clearTimeout(pollTimer.current); }, []);

  const current = channels.find((channel) => channel.id === active) ?? null;

  const send = async (body: Record<string, unknown>) => {
    setBusy(true);
    setNote(null);
    try {
      const response = await fetch("/api/bot-channel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json() as { channels?: ChannelStatus[]; error?: string };
      if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
      if (data.channels) setChannels(data.channels);
      return data;
    } catch (cause) {
      setNote({ kind: "error", message: cause instanceof Error ? cause.message : String(cause) });
      return null;
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    const patch: Record<string, unknown> = { action: "save", channel: active, sessionId };
    // 留空 = 不改（凭证不回显，空着就是「保持原样」）。
    if (secret.trim()) patch.token = secret.trim();
    if (appId.trim()) patch.appId = appId.trim();
    if (agentId.trim()) patch.agentId = agentId.trim();
    if (callbackToken.trim()) patch.callbackToken = callbackToken.trim();
    if (callbackAesKey.trim()) patch.callbackAesKey = callbackAesKey.trim();
    patch.allowFrom = allowFrom.split(/[\s,]+/).map((item) => item.trim()).filter(Boolean);
    const result = await send(patch);
    if (result) {
      setNote({ kind: "ok", message: "已保存" });
      setSecret("");
      setCallbackToken("");
      setCallbackAesKey("");
    }
  };

  const beginScan = async () => {
    setScan(null);
    setNote(null);
    const response = await fetch("/api/bot-channel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "register-begin", channel: active }),
    });
    const data = await response.json().catch(() => ({})) as { qrContent?: string; intervalSeconds?: number; error?: string };
    if (!response.ok || !data.qrContent) {
      setNote({ kind: "error", message: data.error ?? `HTTP ${response.status}` });
      return;
    }
    setScan({ qrContent: data.qrContent, status: "等待扫码" });
    pollScan(data.intervalSeconds ?? 3);
  };

  const pollScan = (seconds: number) => {
    if (pollTimer.current) clearTimeout(pollTimer.current);
    pollTimer.current = setTimeout(async () => {
      const response = await fetch("/api/bot-channel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "register-poll", channel: active }),
      });
      const data = await response.json().catch(() => ({})) as {
        status?: string; intervalSeconds?: number; error?: string; appName?: string | null; channels?: ChannelStatus[];
      };
      if (data.channels) setChannels(data.channels);
      if (!response.ok || data.error) {
        setScan(null);
        setNote({ kind: "error", message: data.error ?? `HTTP ${response.status}` });
        return;
      }
      if (data.status === "success") {
        setScan(null);
        setNote({ kind: "ok", message: data.appName ? `已接入：${data.appName}` : "已接入，可以点启动了" });
        return;
      }
      if (data.status === "expired") {
        setScan(null);
        setNote({ kind: "error", message: "二维码过期了，重新扫一次" });
        return;
      }
      setScan((previous) => previous ? { ...previous, status: data.status === "scanned" ? "已扫码，手机上确认一下" : "等待扫码" } : previous);
      pollScan(data.intervalSeconds ?? seconds);
    }, seconds * 1000);
  };

  const cancelScan = async () => {
    if (pollTimer.current) clearTimeout(pollTimer.current);
    setScan(null);
    await send({ action: "register-cancel", channel: active });
  };

  const toggleRunning = async () => {
    if (!current) return;
    await send({ action: current.running ? "stop" : "start", channel: active });
  };

  return (
    <section className="set-section">
      <h2 className="set-section__title">Bot（聊天应用）</h2>
      <div className="card">
        <div className="crow">
          <div className="crow__text">
            <div className="crow__title">在微信 / 飞书里和这个 agent 对话</div>
            <div className="crow__detail">
              机器人跑在这台机器上：一条消息进来就交给一个会话跑，跑完把答复发回聊天。
              微信与飞书扫一下就接上，不需要公网地址；企业微信只支持回调，需要一个公网 HTTPS 隧道。
            </div>
          </div>
          <div className="crow__control">
            <div className="seg" role="radiogroup" aria-label="聊天渠道">
              {channels.map((channel) => (
                <button
                  key={channel.id}
                  type="button"
                  role="radio"
                  aria-checked={channel.id === active}
                  className={channel.id === active ? "is-on" : undefined}
                  onClick={() => { setActive(channel.id); setScan(null); setNote(null); }}
                >
                  {channel.label}{channel.running ? " ●" : ""}
                </button>
              ))}
            </div>
          </div>
        </div>

        {current && (
          <>
            <div className="cdivider" />
            <div className="crow">
              <div className="crow__text">
                <div className="crow__title">{current.label}</div>
                <div className="crow__detail">{current.note}</div>
                {current.tokenHint && <div className="crow__detail">已保存的凭证：{current.tokenHint}</div>}
                {current.missing.length > 0 && <div className="crow__detail">还缺：{current.missing.join("、")}</div>}
                {!current.lanFriendly && (
                  <div className="crow__detail">
                    回调地址（填到企微管理后台）：<code>{typeof window === "undefined" ? "" : `${window.location.origin}/api/bot-channel/wecom`}</code>
                    <br />
                    本机地址手机访问不到时，把隧道域名填在这里对应位置即可。
                  </div>
                )}
              </div>
              <div className="crow__control">
                <button type="button" className="btn" disabled={busy || !current.ready} onClick={() => void toggleRunning()}>
                  {current.running ? "停止" : "启动"}
                </button>
              </div>
            </div>

            {current.id === "dingtalk" && !current.hasAppId && (
              <>
                <div className="cdivider" />
                <div className="crow">
                  <div className="crow__text">
                    <div className="crow__title">Client ID / Client Secret</div>
                    <div className="crow__detail">
                      钉钉开放平台 › 应用开发 › 机器人 › 消息接收选「Stream 模式」，那里给出的两个值。
                      Client ID 填下面这一格，Client Secret 填「凭证」那一格。
                    </div>
                  </div>
                  <div className="crow__control">
                    <input value={appId} onChange={(event) => setAppId(event.target.value)} placeholder="dingxxxxxxx" aria-label="Client ID" style={inputStyle} />
                  </div>
                </div>
              </>
            )}

            {scannerFields(current.id) ? (
              <>
                <div className="cdivider" />
                <div className="crow">
                  <div className="crow__text">
                    <div className="crow__title">扫码接入</div>
                    <div className="crow__detail">
                      {current.id === "wechat"
                        ? "用微信扫这张码，授权后这台机器就能收发了。"
                        : "用飞书 / Lark 扫这张码，会自动建一个应用并授权。"}
                    </div>
                  </div>
                  <div className="crow__control" style={{ display: "grid", gap: 8, justifyItems: "center" }}>
                    {!scan ? (
                      <button type="button" className="btn" onClick={() => void beginScan()}>扫码</button>
                    ) : (
                      <>
                        <QrCanvas content={scan.qrContent} label={`${current.label} 接入二维码`} scale={4} />
                        <span style={{ fontSize: 11, color: "var(--text-dim)" }}>{scan.status}</span>
                        <button type="button" className="btn" onClick={() => void cancelScan()}>取消</button>
                      </>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="cdivider" />
                <div className="crow">
                  <div className="crow__text">
                    <div className="crow__title">CorpID</div>
                    <div className="crow__detail">企微管理后台 › 我的企业 › 企业 ID。</div>
                  </div>
                  <div className="crow__control"><input value={appId} onChange={(event) => setAppId(event.target.value)} placeholder="ww…" aria-label="CorpID" style={inputStyle} /></div>
                </div>
                <div className="cdivider" />
                <div className="crow">
                  <div className="crow__text">
                    <div className="crow__title">AgentId</div>
                    <div className="crow__detail">自建应用的 AgentId（数字）。</div>
                  </div>
                  <div className="crow__control"><input value={agentId} onChange={(event) => setAgentId(event.target.value)} placeholder="1000002" aria-label="AgentId" style={inputStyle} /></div>
                </div>
                <div className="cdivider" />
                <div className="crow">
                  <div className="crow__text">
                    <div className="crow__title">回调 Token / EncodingAESKey</div>
                    <div className="crow__detail">接收消息那一栏随机生成的两个值：前者验签，后者解密。</div>
                  </div>
                  <div className="crow__control" style={{ display: "grid", gap: 6 }}>
                    <input value={callbackToken} onChange={(event) => setCallbackToken(event.target.value)} placeholder="回调 Token" aria-label="回调 Token" style={inputStyle} />
                    <input value={callbackAesKey} onChange={(event) => setCallbackAesKey(event.target.value)} placeholder="EncodingAESKey" aria-label="EncodingAESKey" style={inputStyle} />
                  </div>
                </div>
              </>
            )}

            <div className="cdivider" />
            <div className="crow">
              <div className="crow__text">
                <div className="crow__title">
                  {current.id === "wecom" ? "应用 Secret" : current.id === "dingtalk" ? "Client Secret" : "凭证"}
                </div>
                <div className="crow__detail">留空表示不改。</div>
              </div>
              <div className="crow__control">
                <input
                  type="password"
                  value={secret}
                  onChange={(event) => setSecret(event.target.value)}
                  placeholder={current.id === "wecom" ? "应用 Secret" : current.id === "dingtalk" ? "Client Secret" : "已保存，留空不改"}
                  aria-label="凭证"
                  style={inputStyle}
                />
              </div>
            </div>

            <div className="cdivider" />
            <div className="crow">
              <div className="crow__text">
                <div className="crow__title">允许的发送者</div>
                <div className="crow__detail">
                  填 open_id / UserID，逗号分隔。<strong>留空 = 第一个发消息的人自动绑定</strong>，之后别人发来的一律忽略。
                </div>
              </div>
              <div className="crow__control">
                <input value={allowFrom} onChange={(event) => setAllowFrom(event.target.value)} placeholder="留空自动绑定" aria-label="允许的发送者" style={inputStyle} />
              </div>
            </div>

            <div className="cdivider" />
            <div className="crow">
              <div className="crow__text">
                <div className="crow__title">交给哪个会话</div>
                <div className="crow__detail">
                  留空 = 每次在今天的临时目录（~/pi-cwd/日期）里新开一个会话，绝不会插进你正在用的对话。
                </div>
              </div>
              <div className="crow__control">
                <input value={sessionId} onChange={(event) => setSessionId(event.target.value)} placeholder="留空：临时会话" aria-label="会话 id" style={inputStyle} />
              </div>
            </div>

            <div className="cdivider" />
            <div className="crow">
              <div className="crow__text">
                <div className="crow__detail">保存后点上面的「启动」。企微在后台保存回调时，需要这台机器已经在跑。</div>
              </div>
              <div className="crow__control">
                <button type="button" className="btn" disabled={busy} onClick={() => void save()}>保存</button>
              </div>
            </div>
          </>
        )}
      </div>
      {note && (
        <p
          role={note.kind === "error" ? "alert" : "status"}
          className="settings-general-error"
          style={note.kind === "ok" ? { color: "var(--accent)" } : undefined}
        >
          {note.message}
        </p>
      )}
    </section>
  );
}

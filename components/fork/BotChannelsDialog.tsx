"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useI18n } from "@/hooks/useI18n";
import { useDialogA11y } from "@/hooks/useDialogA11y";
import { CHANNELS, type ChatChannelId } from "@/lib/chat-channel-shared";
import { ConfigButton } from "../SettingsUi";
import { ImBridgeBody } from "./ImBridgePanel";
import { ChannelIcon } from "./ChannelIcon";
import { QrCanvas } from "./QrCanvas";

/**
 * fork:phone-push —— **机器人管理**二级弹窗（形态裁定 2026-10-03 第二轮，对照 ZCode
 * 的 `BotsDialog`：左列表 + 右详情；入口是右栏的「机器人管理」钮与各渠道卡的
 * 「去 Bot Channels 配置」链接）。
 *
 * 管理面从设置分节整体搬进来：设置分节的右栏只留干净的入口卡（对照 ZCode 的
 * `WebRemoteControlDialog`），所有配置动作——扫码接入、凭证、投递、启停、推送目标——
 * 都在这层弹窗里。左侧列表是全部六个渠道 + 一条「推送到聊天应用」；右侧详情按渠道
 * 渲染：扫码（微信 iLink / 飞书 device-flow）+ 凭证表单 + 投递设置。
 *
 * 弹窗壳走 `.pw-modal` + `.fork-bot-dialog*`（fork-ui.css，覆盖层值与插件页的导入
 * 弹层同构）；焦点/Esc/背景 inert 由共享的 `useDialogA11y` 管。
 */

interface ChannelView {
  id: ChatChannelId;
  label: string;
  icon: string;
  lanFriendly: boolean;
  requires: string[];
  note: string;
  configured: boolean;
  hasChatId: boolean;
  hasAppId: boolean;
  sessionId: string;
  allowCount: number;
  ready: boolean;
  missing: string[];
  running: boolean;
}

/** 能扫码的渠道 —— 与服务端 lib/chat-channel-register.ts 的清单一致。 */
const SCANNABLE: readonly ChatChannelId[] = ["wechat", "feishu", "lark"];

export type BotDialogSelection = ChatChannelId | "push";

type ScanStatus = "waiting" | "scanned" | "expired" | "error";

interface ScanState {
  id: ChatChannelId;
  qr: string;
  status: ScanStatus;
  error?: string;
}

export function BotChannelsDialog({
  open,
  initialSelection,
  onClose,
}: {
  open: boolean;
  /** 打开时预选的渠道（入口卡带来的）；null = 选第一个。 */
  initialSelection: BotDialogSelection | null;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const { dialogRef, dialogProps } = useDialogA11y({ open, onClose });
  const [channels, setChannels] = useState<ChannelView[]>([]);
  const [selected, setSelected] = useState<BotDialogSelection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [draft, setDraft] = useState({ token: "", appId: "", chatId: "", sessionId: "", allowFrom: "" });
  const [scan, setScan] = useState<ScanState | null>(null);
  const scanTimer = useRef<number | null>(null);
  const pollScanRef = useRef<(channelId: ChatChannelId) => Promise<void>>(async () => {});
  const mounted = useRef(true);

  // **必须在 setup 里显式置回 true**：React StrictMode 是「挂载→清理→再挂载」，只靠
  // 初始值的话，一次清理就会把 ref 永久毒成 false —— 之后 begin/poll 的每一处
  // `!mounted.current` 静默闸门都会把成功路径整个吞掉（二维码不画、轮询不起）。
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (scanTimer.current !== null) window.clearTimeout(scanTimer.current);
    };
  }, []);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/bot-channel");
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json() as { channels: ChannelView[] };
      if (!mounted.current) return;
      setChannels(payload.channels);
    } catch (cause) {
      if (!mounted.current) return;
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  // 每次打开都重取一遍（渠道可能在别处被改过），并按入口卡带来的目标预选。
  useEffect(() => {
    if (!open) return;
    void load();
    setSelected(initialSelection ?? "wechat");
    setError(null);
    setStatus(null);
    setScan(null);
    setDraft({ token: "", appId: "", chatId: "", sessionId: "", allowFrom: "" });
    // initialSelection 只在「从哪张卡点进来」这件事上起作用，不进依赖：
    // 弹窗开着时父层重渲染不该把选中的渠道拽回去。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, load]);

  const selectedChannel = selected && selected !== "push" ? channels.find((channel) => channel.id === selected) ?? null : null;

  const act = useCallback(async (channel: ChannelView, action: "start" | "stop" | "configure", extra: Record<string, unknown> = {}) => {
    setBusy(channel.id);
    setError(null);
    setStatus(null);
    try {
      const response = await fetch("/api/bot-channel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: channel.id, action, ...extra }),
      });
      const payload = await response.json() as { error?: string; running?: boolean };
      if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
      setStatus(action === "start"
        ? t("botChannel.started", { label: channel.label })
        : action === "stop"
          ? t("botChannel.stopped", { label: channel.label })
          : t("botChannel.saved"));
      await load();
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (mounted.current) setBusy(null);
    }
  }, [load, t]);

  /** 打开某渠道的详情时，把已存的会话/白名单规格填进草稿（token/appId 是凭证，不回显）。 */
  const select = useCallback((id: BotDialogSelection | null) => {
    if (scanTimer.current !== null) {
      window.clearTimeout(scanTimer.current);
      scanTimer.current = null;
    }
    setScan(null);
    setStatus(null);
    setError(null);
    setSelected(id);
    const channel = id && id !== "push" ? channels.find((entry) => entry.id === id) : null;
    setDraft({
      token: "",
      appId: "",
      chatId: "",
      sessionId: channel?.sessionId ?? "",
      allowFrom: String(channel?.allowCount || ""),
    });
  }, [channels]);

  const beginScan = useCallback(async (channel: ChannelView) => {
    if (scanTimer.current !== null) {
      window.clearTimeout(scanTimer.current);
      scanTimer.current = null;
    }
    setError(null);
    setStatus(null);
    setScan({ id: channel.id, qr: "", status: "waiting" });
    try {
      const response = await fetch("/api/bot-channel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: channel.id, action: "register-begin" }),
      });
      const payload = await response.json() as {
        ok?: boolean; qrContent?: string; intervalSeconds?: number; error?: string;
      };
      if (!mounted.current) return;
      if (!response.ok || payload.ok !== true || !payload.qrContent) {
        setScan(null);
        setError(payload.error ?? `HTTP ${response.status}`);
        return;
      }
      setScan({ id: channel.id, qr: payload.qrContent, status: "waiting" });
      scanTimer.current = window.setTimeout(
        () => void pollScanRef.current(channel.id),
        Math.max(1, payload.intervalSeconds ?? 3) * 1000,
      );
    } catch (cause) {
      if (!mounted.current) return;
      setScan(null);
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  const pollScan = useCallback(async (channelId: ChatChannelId) => {
    try {
      const response = await fetch("/api/bot-channel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: channelId, action: "register-poll" }),
      });
      const payload = await response.json() as {
        ok?: boolean; status?: string; intervalSeconds?: number; error?: string;
      };
      if (!mounted.current) return;
      if (!response.ok || payload.ok === false) {
        setScan((current) => current && current.id === channelId
          ? { ...current, status: "error", error: payload.error ?? `HTTP ${response.status}` }
          : current);
        return;
      }
      if (payload.status === "success") {
        if (scanTimer.current !== null) {
          window.clearTimeout(scanTimer.current);
          scanTimer.current = null;
        }
        setScan(null);
        setStatus(t("botChannel.scanSuccess", { label: CHANNELS.find((channel) => channel.id === channelId)?.label ?? channelId }));
        await load();
        return;
      }
      if (payload.status === "expired") {
        setScan((current) => current && current.id === channelId ? { ...current, status: "expired" } : current);
        return;
      }
      setScan((current) => current && current.id === channelId
        ? { ...current, status: payload.status === "scanned" ? "scanned" : "waiting" }
        : current);
      scanTimer.current = window.setTimeout(
        () => void pollScanRef.current(channelId),
        Math.max(1, payload.intervalSeconds ?? 3) * 1000,
      );
    } catch (error) {
      if (!mounted.current) return;
      setScan((current) => current && current.id === channelId
        ? { ...current, status: "error", error: error instanceof Error ? error.message : String(error) }
        : current);
    }
  }, [load, t]);
  pollScanRef.current = pollScan;

  if (!open) return null;

  const statusLine = (channel: ChannelView) => channel.running
    ? t("botChannel.running")
    : channel.ready
      ? t("botChannel.ready")
      : t("botChannel.needsSetup", { count: channel.missing.length });

  return (
    <div
      ref={dialogRef}
      {...dialogProps}
      aria-label={t("botChannel.dialogTitle")}
      className="fork-bot-dialog-scrim"
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div className="fork-bot-dialog pw-modal">
        <div className="pw-modal-head">
          <span className="pw-ico"><i data-ico="bot" data-size="16" aria-hidden="true" /></span>
          {t("botChannel.dialogTitle")}
          <span className="grow" />
          <button
            type="button"
            className="pw-iconbtn"
            aria-label={t("i18n.close")}
            title={t("i18n.close")}
            onClick={onClose}
          >
            <span className="pw-ico"><i data-ico="x" data-size="14" aria-hidden="true" /></span>
          </button>
        </div>
        <div className="fork-bot-dialog-body">
          <div className="fork-bot-dialog-list">
            <div className="pw-list">
              {channels.map((channel) => (
                <button
                  key={channel.id}
                  type="button"
                  className={`pw-litem${selected === channel.id ? " is-on" : ""}`}
                  style={{ cursor: "pointer", textAlign: "left" }}
                  onClick={() => select(channel.id)}
                >
                  <ChannelIcon id={channel.id} icon={channel.icon} size={20} />
                  <span className="pw-lname grow" style={{ display: "grid", gap: "var(--space-tight)" }}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--s1)" }}>
                      {channel.label}
                      {channel.id === "feishu" && <span className="pw-chip">{t("botChannel.regionCN")}</span>}
                      {channel.id === "lark" && <span className="pw-chip">{t("botChannel.regionGlobal")}</span>}
                    </span>
                  </span>
                  <span
                    aria-hidden="true"
                    className={`pw-dot${channel.running ? " unread" : channel.ready ? " await" : ""}`}
                  />
                </button>
              ))}
            </div>
            <div className="pw-sep" />
            <button
              type="button"
              className={`pw-litem${selected === "push" ? " is-on" : ""}`}
              style={{ cursor: "pointer", textAlign: "left" }}
              onClick={() => select("push")}
            >
              <span className="pw-ico"><i data-ico="send" data-size="15" aria-hidden="true" /></span>
              <span className="pw-lname grow">{t("phonePush.imTitle")}</span>
            </button>
          </div>

          <div className="fork-bot-dialog-detail">
            {error && (
              <div className="pw-alert" role="alert" style={{ margin: 0 }}>
                <span className="pw-ico"><i data-ico="circle-x" data-size="14" aria-hidden="true" /></span>
                <span>{error}</span>
              </div>
            )}
            {status && !error && (
              <div className="pw-alert info" role="status" style={{ margin: 0 }}>
                <span className="pw-ico"><i data-ico="circle-check" data-size="14" aria-hidden="true" /></span>
                <span>{status}</span>
              </div>
            )}

            {selected === "push" && <ImBridgeBody />}

            {selectedChannel && (
              <>
                <div className="pw-plan-head" style={{ padding: 0 }}>
                  <ChannelIcon id={selectedChannel.id} icon={selectedChannel.icon} size={24} />
                  <span>{selectedChannel.label}</span>
                  <span className="pw-count">{statusLine(selectedChannel)}</span>
                  <span className="grow" />
                  <ConfigButton
                    size="small"
                    disabled={busy !== null || (!selectedChannel.running && !selectedChannel.ready)}
                    onClick={() => void act(selectedChannel, selectedChannel.running ? "stop" : "start")}
                  >
                    <span className="pw-ico"><i data-ico={selectedChannel.running ? "square" : "play"} data-size="13" aria-hidden="true" /></span>
                    {selectedChannel.running ? t("botChannel.stop") : t("botChannel.start")}
                  </ConfigButton>
                </div>
                <p className="sub" style={{ margin: 0 }}>{t(`botChannel.desc.${selectedChannel.id}`)}</p>

                {SCANNABLE.includes(selectedChannel.id) && (
                  <div className="pw-plan" style={{ gap: "var(--s2)" }}>
                    <div className="pw-plan-head" style={{ padding: 0 }}>
                      {t("botChannel.scanConnect")}
                      <span className="grow" />
                      <ConfigButton size="small" onClick={() => void beginScan(selectedChannel)}>
                        <span className="pw-ico"><i data-ico="smartphone" data-size="13" aria-hidden="true" /></span>
                        {scan?.id === selectedChannel.id ? t("botChannel.scanAgain") : t("botChannel.scanConnect")}
                      </ConfigButton>
                    </div>
                    {scan?.id === selectedChannel.id && scan.qr && (
                      <div style={{ display: "grid", justifyItems: "center", padding: "var(--s3)", border: "1px dashed var(--n-border-subtle)", borderRadius: "var(--radius-6)" }}>
                        <QrCanvas content={scan.qr} label={t("botChannel.scanQrLabel")} />
                      </div>
                    )}
                    {scan?.id === selectedChannel.id && (
                      <p className="sub" style={{ margin: 0 }}>
                        {scan.status === "scanned"
                          ? t("botChannel.scanScanned")
                          : scan.status === "expired"
                            ? t("botChannel.scanExpired")
                            : scan.status === "error"
                              ? t("botChannel.scanFailed", { message: scan.error ?? "" })
                              : t("botChannel.scanWaiting")}
                      </p>
                    )}
                  </div>
                )}

                <div className="pw-plan" style={{ gap: "var(--s2)" }}>
                  <div className="pw-plan-head" style={{ padding: 0 }}>{t("botChannel.sectionCredentials")}</div>
                  <div className="pw-field">
                    <span className="pw-label">
                      {t("botChannel.token")}
                      <small>{selectedChannel.requires.join(" · ")}</small>
                    </span>
                    <span className="pw-ctl">
                      <input
                        className="pw-input pw-mono"
                        type="password"
                        autoComplete="off"
                        value={draft.token}
                        placeholder={selectedChannel.configured ? "••••（已保存）" : "…"}
                        onChange={(event) => setDraft((current) => ({ ...current, token: event.target.value }))}
                      />
                    </span>
                  </div>
                  {(selectedChannel.id === "feishu" || selectedChannel.id === "lark") && (
                    <div className="pw-field">
                      <span className="pw-label">{t("botChannel.appId")}</span>
                      <span className="pw-ctl">
                        <input
                          className="pw-input pw-mono"
                          value={draft.appId}
                          placeholder={selectedChannel.hasAppId ? "cli_••••（已保存）" : "cli_…"}
                          onChange={(event) => setDraft((current) => ({ ...current, appId: event.target.value }))}
                        />
                      </span>
                    </div>
                  )}
                  {selectedChannel.id === "telegram" && (
                    <div className="pw-field">
                      <span className="pw-label">{t("botChannel.chatId")}</span>
                      <span className="pw-ctl">
                        <input
                          className="pw-input pw-mono"
                          value={draft.chatId}
                          placeholder={selectedChannel.hasChatId ? "••••（已保存）" : "-100…"}
                          onChange={(event) => setDraft((current) => ({ ...current, chatId: event.target.value }))}
                        />
                      </span>
                    </div>
                  )}
                </div>

                <div className="pw-plan" style={{ gap: "var(--s2)" }}>
                  <div className="pw-plan-head" style={{ padding: 0 }}>{t("botChannel.sectionDelivery")}</div>
                  <div className="pw-field">
                    <span className="pw-label">
                      {t("botChannel.allowFrom")}
                      <small>{t("botChannel.allowFromHint")}</small>
                    </span>
                    <span className="pw-ctl">
                      <input
                        className="pw-input pw-mono"
                        value={draft.allowFrom}
                        placeholder="-100123, myname"
                        onChange={(event) => setDraft((current) => ({ ...current, allowFrom: event.target.value }))}
                      />
                    </span>
                  </div>
                  <div className="pw-field">
                    <span className="pw-label">
                      {t("botChannel.sessionId")}
                      <small>{t("botChannel.sessionHint")}</small>
                    </span>
                    <span className="pw-ctl">
                      <input
                        className="pw-input pw-mono"
                        value={draft.sessionId}
                        placeholder="01a0fcaf-…"
                        onChange={(event) => setDraft((current) => ({ ...current, sessionId: event.target.value }))}
                      />
                    </span>
                  </div>
                  <div className="pw-row" style={{ gap: "var(--s2)", cursor: "default" }}>
                    <span className="grow" />
                    <ConfigButton
                      size="small"
                      disabled={busy !== null}
                      onClick={() => {
                        void act(selectedChannel, "configure", {
                          ...(draft.token ? { token: draft.token } : {}),
                          ...(draft.appId ? { appId: draft.appId } : {}),
                          ...(draft.chatId ? { chatId: draft.chatId } : {}),
                          sessionId: draft.sessionId,
                          allowFrom: draft.allowFrom.split(",").map((item) => item.trim()).filter(Boolean),
                        });
                      }}
                    >
                      <span className="pw-ico"><i data-ico="check" data-size="13" aria-hidden="true" /></span>
                      {t("botChannel.save")}
                    </ConfigButton>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

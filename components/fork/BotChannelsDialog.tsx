"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useIsMobile } from "@/hooks/useIsMobile";
import { useI18n } from "@/hooks/useI18n";
import { useDialogA11y } from "@/hooks/useDialogA11y";
import { PwaBanner, PwaSetRow } from "@/components/pwa/PwaPage";
import { PwaSheet } from "@/components/pwa/PwaSheet";
import { CHANNELS, type ChatChannelId } from "@/lib/chat-channel-shared";
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
 * 弹窗壳走 `.d-modal-box` + `.fork-bot-dialog*`（fork-ui.css）；焦点/Esc/背景 inert 由
 * 共享的 `useDialogA11y` 管。窄屏走 `.m-sheet`（见函数体内注释）。
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
  const mobile = useIsMobile();
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

  // fork:v5-landing Wave B · M-10 · 窄屏：桌面那个「左列表 + 右详情」二级弹窗在手机上
  // 变成一张底部面板（列表在上、详情在下，面板体自己滚）。扫码轮询、白名单、启停、
  // 投递设置与凭证掩码全部是同一份 state 与同一条 API 线。
  if (mobile) {
    return (
      <PwaSheet
        open
        title={t("botChannel.dialogTitle")}
        label={t("botChannel.dialogTitle")}
        onClose={onClose}
      >
        {error && <PwaBanner icon="circle-x" tone="err" role="alert">{error}</PwaBanner>}
        {status && !error && <PwaBanner icon="circle-check" role="status">{status}</PwaBanner>}

        <div className="m-list">
          {channels.map((channel) => (
            <button
              key={channel.id}
              type="button"
              className={`m-row${selected === channel.id ? " is-on" : ""}`}
              onClick={() => select(channel.id)}
            >
              <span className="m-row-body m-row-m">
                <ChannelIcon id={channel.id} icon={channel.icon} size={20} />
                <span className="m-row-t">{channel.label}</span>
                {channel.id === "feishu" && <span className="m-badge mute">{t("botChannel.regionCN")}</span>}
                {channel.id === "lark" && <span className="m-badge mute">{t("botChannel.regionGlobal")}</span>}
                <span className={`m-dot${channel.running ? " run" : channel.ready ? " ok" : ""}`} aria-hidden="true" />
              </span>
            </button>
          ))}
          <button
            type="button"
            className={`m-row${selected === "push" ? " is-on" : ""}`}
            onClick={() => select("push")}
          >
            <span className="m-row-body m-row-m">
              <i data-ico="send" data-size="15" aria-hidden="true" />
              <span className="m-row-t">{t("phonePush.imTitle")}</span>
            </span>
          </button>
        </div>

        {selected === "push" && <ImBridgeBody />}

        {selectedChannel && (
          <>
            <div className="m-cardgroup">
              <PwaSetRow
                label={selectedChannel.label}
                sub={statusLine(selectedChannel)}
                trailing={
                  <button
                    type="button"
                    className="m-btn sm"
                    disabled={busy !== null || (!selectedChannel.running && !selectedChannel.ready)}
                    onClick={() => void act(selectedChannel, selectedChannel.running ? "stop" : "start")}
                  >
                    <i data-ico={selectedChannel.running ? "square" : "play"} data-size="13" aria-hidden="true" />
                    {selectedChannel.running ? t("botChannel.stop") : t("botChannel.start")}
                  </button>
                }
              />
              <PwaSetRow label={t("botChannel.dialogTitle")} sub={t(`botChannel.desc.${selectedChannel.id}`)} />
            </div>

            {SCANNABLE.includes(selectedChannel.id) && (
              <div className="m-cardgroup">
                <PwaSetRow
                  icon="smartphone"
                  label={t("botChannel.scanConnect")}
                  trailing={
                    <button type="button" className="m-btn sm" onClick={() => void beginScan(selectedChannel)}>
                      {scan?.id === selectedChannel.id ? t("botChannel.scanAgain") : t("botChannel.scanConnect")}
                    </button>
                  }
                />
                {scan?.id === selectedChannel.id && scan.qr && (
                  <div className="m-placeholder">
                    <QrCanvas content={scan.qr} label={t("botChannel.scanQrLabel")} />
                  </div>
                )}
                {scan?.id === selectedChannel.id && (
                  <PwaSetRow
                    icon={scan.status === "error" || scan.status === "expired" ? "triangle-alert" : "scan-search"}
                    label={scan.status === "scanned"
                      ? t("botChannel.scanScanned")
                      : scan.status === "expired"
                        ? t("botChannel.scanExpired")
                        : scan.status === "error"
                          ? t("botChannel.scanFailed", { message: scan.error ?? "" })
                          : t("botChannel.scanWaiting")}
                  />
                )}
              </div>
            )}

            <div className="m-cardgroup">
              <div className="m-group-title">{t("botChannel.sectionCredentials")}</div>
              <PwaSetRow label={t("botChannel.token")} sub={selectedChannel.requires.join(" · ")} />
              <div className="m-doc-body">
                <input
                  className="m-input m-mono"
                  style={{ width: "100%" }}
                  type="password"
                  autoComplete="off"
                  value={draft.token}
                  placeholder={selectedChannel.configured ? "••••（已保存）" : "…"}
                  onChange={(event) => setDraft((current) => ({ ...current, token: event.target.value }))}
                />
              </div>
              {(selectedChannel.id === "feishu" || selectedChannel.id === "lark") && (
                <>
                  <PwaSetRow label={t("botChannel.appId")} />
                  <div className="m-doc-body">
                    <input
                      className="m-input m-mono"
                      style={{ width: "100%" }}
                      value={draft.appId}
                      placeholder={selectedChannel.hasAppId ? "cli_••••（已保存）" : "cli_…"}
                      onChange={(event) => setDraft((current) => ({ ...current, appId: event.target.value }))}
                    />
                  </div>
                </>
              )}
              {selectedChannel.id === "telegram" && (
                <>
                  <PwaSetRow label={t("botChannel.chatId")} />
                  <div className="m-doc-body">
                    <input
                      className="m-input m-mono"
                      style={{ width: "100%" }}
                      value={draft.chatId}
                      placeholder={selectedChannel.hasChatId ? "••••（已保存）" : "-100…"}
                      onChange={(event) => setDraft((current) => ({ ...current, chatId: event.target.value }))}
                    />
                  </div>
                </>
              )}
            </div>

            <div className="m-cardgroup">
              <div className="m-group-title">{t("botChannel.sectionDelivery")}</div>
              <PwaSetRow label={t("botChannel.allowFrom")} sub={t("botChannel.allowFromHint")} />
              <div className="m-doc-body">
                <input
                  className="m-input m-mono"
                  style={{ width: "100%" }}
                  value={draft.allowFrom}
                  placeholder="-100123, myname"
                  onChange={(event) => setDraft((current) => ({ ...current, allowFrom: event.target.value }))}
                />
              </div>
              <PwaSetRow label={t("botChannel.sessionId")} sub={t("botChannel.sessionHint")} />
              <div className="m-doc-body">
                <input
                  className="m-input m-mono"
                  style={{ width: "100%" }}
                  value={draft.sessionId}
                  placeholder="01a0fcaf-…"
                  onChange={(event) => setDraft((current) => ({ ...current, sessionId: event.target.value }))}
                />
              </div>
              <div className="m-pickbar">
                <button
                  type="button"
                  className="m-picktag is-on"
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
                  <i data-ico="check" data-size="13" aria-hidden="true" />
                  {t("botChannel.save")}
                </button>
              </div>
            </div>
          </>
        )}
      </PwaSheet>
    );
  }

  return (
    <div
      ref={dialogRef}
      {...dialogProps}
      aria-label={t("botChannel.dialogTitle")}
      className="fork-bot-dialog-scrim"
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div className="fork-bot-dialog d-modal-box">
        <div className="d-modal-head d-row">
          <i data-ico="bot" data-size="16" aria-hidden="true" />
          {t("botChannel.dialogTitle")}
          <span className="d-grow" />
          <button
            type="button"
            className="d-iconbtn"
            aria-label={t("i18n.close")}
            title={t("i18n.close")}
            onClick={onClose}
          >
            <i data-ico="x" data-size="14" aria-hidden="true" />
          </button>
        </div>
        <div className="fork-bot-dialog-body">
          <div className="fork-bot-dialog-list">
            <div className="d-col">
              {channels.map((channel) => (
                <button
                  key={channel.id}
                  type="button"
                  className={`d-set-navitem${selected === channel.id ? " is-on" : ""}`}
                  onClick={() => select(channel.id)}
                >
                  <ChannelIcon id={channel.id} icon={channel.icon} size={20} />
                  <span className="d-grow">
                    {channel.label}
                    {channel.id === "feishu" && <span className="d-badge mute">{t("botChannel.regionCN")}</span>}
                    {channel.id === "lark" && <span className="d-badge mute">{t("botChannel.regionGlobal")}</span>}
                  </span>
                  <span
                    aria-hidden="true"
                    className={`d-dot${channel.running ? " run" : channel.ready ? " ok" : ""}`}
                  />
                </button>
              ))}
            </div>
            <div className="d-sep" />
            <button
              type="button"
              className={`d-set-navitem${selected === "push" ? " is-on" : ""}`}
              onClick={() => select("push")}
            >
              <i data-ico="send" data-size="15" aria-hidden="true" />
              <span className="d-grow">{t("phonePush.imTitle")}</span>
            </button>
          </div>

          <div className="fork-bot-dialog-detail">
            {error && (
              <div className="d-banner err" role="alert">
                <i data-ico="circle-x" data-size="14" aria-hidden="true" />
                <span>{error}</span>
              </div>
            )}
            {status && !error && (
              <div className="d-banner info" role="status">
                <i data-ico="circle-check" data-size="14" aria-hidden="true" />
                <span>{status}</span>
              </div>
            )}

            {selected === "push" && <ImBridgeBody />}

            {selectedChannel && (
              <>
                <div className="d-row">
                  <ChannelIcon id={selectedChannel.id} icon={selectedChannel.icon} size={24} />
                  <span className="d-t-title">{selectedChannel.label}</span>
                  <span className="d-badge mute">{statusLine(selectedChannel)}</span>
                  <span className="d-grow" />
                  <button
                    type="button"
                    className="d-btn sm"
                    disabled={busy !== null || (!selectedChannel.running && !selectedChannel.ready)}
                    onClick={() => void act(selectedChannel, selectedChannel.running ? "stop" : "start")}
                  >
                    <i data-ico={selectedChannel.running ? "square" : "play"} data-size="13" aria-hidden="true" />
                    {selectedChannel.running ? t("botChannel.stop") : t("botChannel.start")}
                  </button>
                </div>
                <p className="d-t-xs d-t-faint" style={{ margin: 0 }}>{t(`botChannel.desc.${selectedChannel.id}`)}</p>

                {SCANNABLE.includes(selectedChannel.id) && (
                  <div className="d-card">
                    <div className="d-card-body d-col" style={{ gap: "var(--nx-sp-2)" }}>
                    <div className="d-row">
                      <span className="d-set-row-t">{t("botChannel.scanConnect")}</span>
                      <span className="d-grow" />
                      <button type="button" className="d-btn sm" onClick={() => void beginScan(selectedChannel)}>
                        <i data-ico="smartphone" data-size="13" aria-hidden="true" />
                        {scan?.id === selectedChannel.id ? t("botChannel.scanAgain") : t("botChannel.scanConnect")}
                      </button>
                    </div>
                    {scan?.id === selectedChannel.id && scan.qr && (
                      <div className="d-placeholder" style={{ display: "grid", justifyContent: "center", padding: "var(--nx-sp-3)" }}>
                        <QrCanvas content={scan.qr} label={t("botChannel.scanQrLabel")} />
                      </div>
                    )}
                    {scan?.id === selectedChannel.id && (
                      <p className="d-t-xs d-t-faint" style={{ margin: 0 }}>
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
                  </div>
                )}

                <div className="d-card">
                  <div className="d-card-body d-col" style={{ gap: "var(--nx-sp-2)" }}>
                  <div className="d-set-row-t">{t("botChannel.sectionCredentials")}</div>
                  <div className="d-field">
                    <span className="d-field-t">{t("botChannel.token")}</span>
                    <input
                      className="d-input d-mono"
                      type="password"
                      autoComplete="off"
                      value={draft.token}
                      placeholder={selectedChannel.configured ? "••••（已保存）" : "…"}
                      onChange={(event) => setDraft((current) => ({ ...current, token: event.target.value }))}
                    />
                    <span className="d-t-xs d-t-faint">{selectedChannel.requires.join(" · ")}</span>
                  </div>
                  {(selectedChannel.id === "feishu" || selectedChannel.id === "lark") && (
                    <div className="d-field">
                      <span className="d-field-t">{t("botChannel.appId")}</span>
                      <input
                        className="d-input d-mono"
                        value={draft.appId}
                        placeholder={selectedChannel.hasAppId ? "cli_••••（已保存）" : "cli_…"}
                        onChange={(event) => setDraft((current) => ({ ...current, appId: event.target.value }))}
                      />
                    </div>
                  )}
                  {selectedChannel.id === "telegram" && (
                    <div className="d-field">
                      <span className="d-field-t">{t("botChannel.chatId")}</span>
                      <input
                        className="d-input d-mono"
                        value={draft.chatId}
                        placeholder={selectedChannel.hasChatId ? "••••（已保存）" : "-100…"}
                        onChange={(event) => setDraft((current) => ({ ...current, chatId: event.target.value }))}
                      />
                    </div>
                  )}
                  </div>
                </div>

                <div className="d-card">
                  <div className="d-card-body d-col" style={{ gap: "var(--nx-sp-2)" }}>
                  <div className="d-set-row-t">{t("botChannel.sectionDelivery")}</div>
                  <div className="d-field">
                    <span className="d-field-t">{t("botChannel.allowFrom")}</span>
                    <input
                      className="d-input d-mono"
                      value={draft.allowFrom}
                      placeholder="-100123, myname"
                      onChange={(event) => setDraft((current) => ({ ...current, allowFrom: event.target.value }))}
                    />
                    <span className="d-t-xs d-t-faint">{t("botChannel.allowFromHint")}</span>
                  </div>
                  <div className="d-field">
                    <span className="d-field-t">{t("botChannel.sessionId")}</span>
                    <input
                      className="d-input d-mono"
                      value={draft.sessionId}
                      placeholder="01a0fcaf-…"
                      onChange={(event) => setDraft((current) => ({ ...current, sessionId: event.target.value }))}
                    />
                    <span className="d-t-xs d-t-faint">{t("botChannel.sessionHint")}</span>
                  </div>
                  <div className="d-row" style={{ justifyContent: "flex-end" }}>
                    <button
                      type="button"
                      className="d-btn sm"
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
                      <i data-ico="check" data-size="13" aria-hidden="true" />
                      {t("botChannel.save")}
                    </button>
                  </div>
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

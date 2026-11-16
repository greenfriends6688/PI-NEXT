// Settings › Devices: whether a phone on the same network can open this Pi,
// the pairing code (with its QR image), and the chat-app bot channels.
//
// `GET /api/lan/access` (`app/api/lan/access/route.ts:26-40`) answers with the
// state and the URLs a phone can use: `enabled`, `boundLan`, `needsRebind`
// (a token exists but the server has not rebound since), `lanUrls` and a
// `tokenHint` — never the token itself. The first read generates a token and
// turns access on, which is what opening this section means
// (`ensureLanAccessConfig()` at 27-28; the route's own comment, 17-24). The
// switch writes `PUT /api/lan/access` with `{ enabled }`
// (`app/api/lan/access/route.ts:42-76`); that answer leaves `lanUrls` empty, so
// the list is read again from `GET`.
//
// Pairing is `POST /api/lan/pair/generate` with `{ readOnly }`
// (`app/api/lan/pair/generate/route.ts:14-56`): a six-digit code, ten minutes,
// once only, plus the same LAN URLs. The code counts down here (`effect` +
// `setInterval`, cleared by `cleanup`), and the QR is the first address with
// `/pair#<code>` appended (`components/LanAccessPanel.tsx:91`), drawn from the
// matrix `src/lib/qr-image.ts` makes (`QrImage.modules`, quiet zone included).
//
// `GET /api/bot-channel` (`app/api/bot-channel/route.ts:52-54`) lists the five
// channels with their readiness and a credential hint, never credentials
// (`lib/bot-channel.ts:232-255`). `POST` saves one channel's fields
// (`mergeEntry`, 60-78; the save at 143-149), starts or stops its runtime
// (151-162), or runs a scan registration for WeChat / Feishu / Lark:
// `register-begin` then `register-poll` every `intervalSeconds`
// (`lib/bot-channel-register.ts`). WeCom is the only channel without an
// outbound connection, so its row spells out the public HTTPS callback URL.
//
// The look is the gallery kit (`../../ui/kit`, through `./parts`): a `Card` per
// section, the kit's `Row` per value, `Segmented` for the channel, the kit's
// `Button` / `Status` / `Input` (with `inputLook`), and a sunk `SettingsGroup`
// for a pairing code or a channel's fields. The QR is `nsh`'s `Canvas`
// (`docs/dev/canvas.md`): `fillRect` for the white quiet zone and `fill` of a
// `Path2D` for the dark modules.

import { Canvas, cleanup, computed, effect, Path2D, resource, signal, Text, View } from "nsh";
import { Input } from "nsh/base";
import { Button, Segmented, Status, inputLook } from "../../ui/kit";
import { qrImage } from "../../lib/qr-image";
import {
  beginBotChannelRegistration,
  cancelBotChannelRegistration,
  controlBotChannel,
  generateLanPair,
  loadBotChannels,
  loadLanAccess,
  pollBotChannelRegistration,
  saveBotChannel,
  setLanAccessEnabled,
  type BotChannelId,
  type BotChannelSave,
  type LanPair,
  type ScannableBotChannelId,
} from "../../api/config";
import { errorText } from "../../ui/errors";
import { api } from "../../api/client";
import { settingsOpen } from "../../state/session";
import { t } from "../../ui/i18n";
import {
  SETTINGS_DETAIL,
  SettingsCard,
  SettingsError,
  SettingsGroup,
  SettingsLoading,
  SettingsNote,
  SettingsRow,
  SettingsSwitch,
  settingsCode,
  settingsPage,
} from "./parts";

/** The width of a bot field at the trailing edge of its row. */
const INPUT_WIDTH = 240;

/** The five channels' names for this panel (the server's labels are Chinese). */
const BOT_LABELS: Record<BotChannelId, string> = {
  wechat: "WeChat",
  feishu: "Feishu",
  lark: "Lark",
  dingtalk: "DingTalk",
  wecom: "WeCom",
};

/** What each channel needs and how it receives messages. */
const BOT_DETAIL_KEYS: Record<BotChannelId, string> = {
  wechat: "settings.devices.botWechatDetail",
  feishu: "settings.devices.botFeishuDetail",
  lark: "settings.devices.botLarkDetail",
  dingtalk: "settings.devices.botDingtalkDetail",
  wecom: "settings.devices.botWecomDetail",
};

/** A pairing code with the local deadline the countdown reads. */
interface PairCode extends LanPair {
  /** `Date.now()` when the code stops working. */
  expiresAt: number;
}

interface BotNote {
  kind: "ok" | "error";
  text: string;
}

interface ScanState {
  /** The string the phone's camera reads (`qrContent`). */
  content: string;
  status: string;
}

function botLabel(id: BotChannelId): string {
  return BOT_LABELS[id];
}

function isScannable(id: BotChannelId): id is ScannableBotChannelId {
  return id === "wechat" || id === "feishu" || id === "lark";
}

function appIdLabel(id: BotChannelId): string {
  if (id === "wecom") return "CorpID";
  if (id === "dingtalk") return "Client ID";
  return "App ID";
}

function appIdDetail(id: BotChannelId): string {
  if (id === "wecom") return t("settings.devices.appIdDetailWecom");
  if (id === "dingtalk") return t("settings.devices.appIdDetailDingtalk");
  return t("settings.devices.appIdDetail");
}

function secretLabel(id: BotChannelId): string {
  if (id === "wecom") return "App Secret";
  if (id === "dingtalk") return "Client Secret";
  if (id === "wechat") return "Bot token";
  return "App Secret";
}

function parseAllowFrom(value: string): string[] {
  return value.split(/[\s,]+/).map((item) => item.trim()).filter(Boolean);
}

/** `m:ss`, the pairing code's remaining life. */
function clock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/**
 * The QR image on a `nsh` `Canvas`: white first (the quiet zone is already
 * part of `qrImage`'s matrix), then one `Path2D` of every dark module run.
 * Pure black on pure white is deliberate (a themed, low-contrast code is
 * harder for a phone camera to read; `components/QrCanvas.tsx:17-34`).
 */
function PairQr(props: { content: () => string; label: string; scale?: number }) {
  const image = computed(() => {
    const text = props.content();
    if (!text) return null;
    try {
      return qrImage(text, { scale: props.scale ?? 4 });
    } catch {
      // A URL too long for a QR version: draw nothing rather than throw.
      return null;
    }
  });

  return (
    <Canvas
      accessibilityLabel={props.label}
      style={{
        width: image()?.pixels ?? 0,
        height: image()?.pixels ?? 0,
        backgroundColor: "#ffffff",
        borderRadius: 8,
      }}
      draw={(cx) => {
        const bitmap = image();
        if (!bitmap) return;
        const cell = bitmap.pixels / bitmap.size;
        cx.fillStyle = "#ffffff";
        cx.fillRect(0, 0, bitmap.pixels, bitmap.pixels);
        let path = "";
        for (let y = 0; y < bitmap.size; y++) {
          let x = 0;
          while (x < bitmap.size) {
            if (!bitmap.modules[y * bitmap.size + x]) {
              x += 1;
              continue;
            }
            const start = x;
            while (x < bitmap.size && bitmap.modules[y * bitmap.size + x]) x += 1;
            const run = x - start;
            path += `M${start * cell} ${y * cell}h${run * cell}v${cell}h${-run * cell}z`;
          }
        }
        if (path) {
          cx.fillStyle = "#000000";
          cx.fill(new Path2D(path));
        }
      }}
    />
  );
}

export function Devices() {
  // The source is the dialog's state: opening it loads, closing it drops the
  // load (`resource` skips `null`, `tsx.md` "resource, and stale results").
  const access = resource(
    () => (settingsOpen() ? "lan" : null),
    async (_source: string, info) => loadLanAccess({ signal: info.signal }),
  );
  const bots = resource(
    () => (settingsOpen() ? "bots" : null),
    async (_source: string, info) => (await loadBotChannels({ signal: info.signal })).channels,
  );

  const savingAccess = signal(false);
  const accessError = signal<string | null>(null);

  const pair = signal<PairCode | null>(null);
  const pairLeft = signal(0);
  const minting = signal(false);
  const pairError = signal<string | null>(null);

  const activeBot = signal<BotChannelId>("wechat");
  const botBusy = signal<string | null>(null);
  const botNote = signal<BotNote | null>(null);
  const scan = signal<ScanState | null>(null);

  // The draft fields. A credential field left empty means "keep the saved
  // one": the route merges only what the request carries (`mergeEntry`).
  const secret = signal("");
  const appId = signal("");
  const agentId = signal("");
  const callbackToken = signal("");
  const callbackAesKey = signal("");
  const allowFrom = signal("");
  const allowFromDirty = signal(false);
  const sessionId = signal("");

  const field = inputLook({ style: { width: INPUT_WIDTH } });

  // A scan poll lives across renders, so its timeout is this component's own.
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;
  cleanup(() => {
    disposed = true;
    if (pollTimer !== null) clearTimeout(pollTimer);
  });

  // Before that, a scan poll is useful and two are not.
  const stopPoll = (): void => {
    if (pollTimer !== null) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
  };

  // The pairing code's clock. The effect follows `pair`, not `pairLeft`, so a
  // tick only writes the countdown and never restarts the interval.
  effect(() => {
    const current = pair();
    if (!current) {
      pairLeft.set(0);
      return;
    }
    let timer: ReturnType<typeof setInterval> | null = null;
    const tick = (): void => {
      const left = Math.max(0, Math.ceil((current.expiresAt - Date.now()) / 1000));
      pairLeft.set(left);
      if (left === 0 && timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };
    timer = setInterval(tick, 1000);
    tick();
    cleanup(() => {
      if (timer !== null) clearInterval(timer);
    });
  });

  // A channel's saved session is its starting value; after that the field is
  // the user's, so a list refresh (a start or stop) does not overwrite it.
  let sessionLoadedFor: BotChannelId | null = null;
  effect(() => {
    const id = activeBot();
    const current = (bots() ?? []).find((channel) => channel.id === id);
    if (!current || sessionLoadedFor === id) return;
    sessionLoadedFor = id;
    sessionId.set(current.sessionId);
  });

  const toggleAccess = async (on: boolean): Promise<void> => {
    savingAccess.set(true);
    accessError.set(null);
    try {
      const answer = await setLanAccessEnabled(on);
      access.mutate(answer);
      if (!on) {
        pair.set(null);
        pairError.set(null);
      }
      // `PUT` answers no URLs (68-75); `GET` knows them.
      access.refetch();
    } catch (cause) {
      accessError.set(errorText(cause));
      access.refetch();
    } finally {
      savingAccess.set(false);
    }
  };

  const mint = async (readOnly: boolean): Promise<void> => {
    minting.set(true);
    pairError.set(null);
    try {
      const answer = await generateLanPair(readOnly);
      const seconds = Math.max(0, answer.expiresInSeconds);
      pair.set({ ...answer, expiresAt: Date.now() + seconds * 1000 });
      pairLeft.set(seconds);
    } catch (cause) {
      pair.set(null);
      pairError.set(errorText(cause));
    } finally {
      minting.set(false);
    }
  };

  const pairUrl = (): string | null => {
    const current = pair();
    const base = current?.lanUrls[0];
    return current && base ? `${base}/pair#${current.code}` : null;
  };

  const channelOptions = () =>
    (bots() ?? []).map((channel) => ({ value: channel.id, label: botLabel(channel.id) }));

  const chooseChannel = (id: BotChannelId): void => {
    stopPoll();
    scan.set(null);
    botNote.set(null);
    secret.set("");
    appId.set("");
    agentId.set("");
    callbackToken.set("");
    callbackAesKey.set("");
    allowFrom.set("");
    allowFromDirty.set(false);
    sessionId.set("");
    // Let the effect load the new channel's saved session. Set last: it runs
    // the effect even if effects are flushed synchronously with this write.
    sessionLoadedFor = null;
    activeBot.set(id);
  };

  const runBot = async (channel: BotChannelId, action: "start" | "stop"): Promise<void> => {
    const key = `${action}:${channel}`;
    botBusy.set(key);
    botNote.set(null);
    try {
      const answer = await controlBotChannel(channel, action);
      bots.mutate(answer.channels);
      botNote.set({
        kind: "ok",
        text: t(action === "start" ? "settings.devices.botStarted" : "settings.devices.botStopped", {
          name: botLabel(channel),
        }),
      });
    } catch (cause) {
      botNote.set({ kind: "error", text: errorText(cause) });
      bots.refetch();
    } finally {
      botBusy.set(null);
    }
  };

  const save = async (): Promise<void> => {
    const channel = activeBot();
    const change: BotChannelSave = { sessionId: sessionId().trim() };
    // Empty credentials keep what the server has (`mergeEntry`: absent =
    // unchanged); a typed one replaces it.
    if (secret().trim()) change.token = secret().trim();
    if (appId().trim()) change.appId = appId().trim();
    if (agentId().trim()) change.agentId = agentId().trim();
    if (callbackToken().trim()) change.callbackToken = callbackToken().trim();
    if (callbackAesKey().trim()) change.callbackAesKey = callbackAesKey().trim();
    // The server does not return the list, only its size, so an untouched
    // blank field must not clear it. Clear makes the empty list explicit.
    if (allowFromDirty()) change.allowFrom = parseAllowFrom(allowFrom());

    const key = `save:${channel}`;
    botBusy.set(key);
    botNote.set(null);
    try {
      const answer = await saveBotChannel(channel, change);
      bots.mutate(answer.channels);
      secret.set("");
      appId.set("");
      agentId.set("");
      callbackToken.set("");
      callbackAesKey.set("");
      allowFrom.set("");
      allowFromDirty.set(false);
      botNote.set({ kind: "ok", text: t("settings.devices.botSaved") });
    } catch (cause) {
      botNote.set({ kind: "error", text: errorText(cause) });
      bots.refetch();
    } finally {
      botBusy.set(null);
    }
  };

  const pollScan = (channel: ScannableBotChannelId, seconds: number): void => {
    stopPoll();
    pollTimer = setTimeout(async () => {
      pollTimer = null;
      if (disposed || activeBot() !== channel) return;
      try {
        const answer = await pollBotChannelRegistration(channel);
        if (disposed || activeBot() !== channel) return;
        if (answer.channels) {
          bots.mutate(answer.channels);
        } else {
          bots.refetch();
        }
        if (answer.status === "success") {
          scan.set(null);
          botNote.set({
            kind: "ok",
            text: answer.appName
              ? t("settings.devices.botConnectedApp", { app: answer.appName })
              : t("settings.devices.botConnected"),
          });
          return;
        }
        if (answer.status === "expired") {
          scan.set(null);
          botNote.set({ kind: "error", text: t("settings.devices.qrExpired") });
          return;
        }
        const shown = scan();
        scan.set({
          content: shown?.content ?? "",
          status: answer.status === "scanned"
            ? t("settings.devices.scanned")
            : t("settings.devices.waitingScan"),
        });
        pollScan(channel, answer.intervalSeconds ?? seconds);
      } catch (cause) {
        if (disposed) return;
        scan.set(null);
        botNote.set({ kind: "error", text: errorText(cause) });
      }
    }, Math.max(1, seconds) * 1000);
  };

  const beginScan = async (): Promise<void> => {
    const channel = activeBot();
    if (!isScannable(channel)) return;
    stopPoll();
    scan.set(null);
    botNote.set(null);
    const key = `scan:${channel}`;
    botBusy.set(key);
    try {
      const answer = await beginBotChannelRegistration(channel);
      if (disposed || activeBot() !== channel) return;
      if (!answer.qrContent) {
        botNote.set({ kind: "error", text: t("settings.devices.noQr") });
        return;
      }
      scan.set({ content: answer.qrContent, status: t("settings.devices.waitingScan") });
      pollScan(channel, answer.intervalSeconds ?? 3);
    } catch (cause) {
      if (!disposed) botNote.set({ kind: "error", text: errorText(cause) });
    } finally {
      botBusy.set(null);
    }
  };

  const cancelScan = async (): Promise<void> => {
    stopPoll();
    scan.set(null);
    const channel = activeBot();
    if (!isScannable(channel)) return;
    try {
      const answer = await cancelBotChannelRegistration(channel);
      bots.mutate(answer.channels);
    } catch (cause) {
      botNote.set({ kind: "error", text: errorText(cause) });
    }
  };

  const noAddresses = (): boolean => access() !== undefined && (access()?.lanUrls.length ?? 0) === 0;
  const callbackUrl = (): string => `${api.base()}/api/bot-channel/wecom`;

  return (
    <View style={settingsPage}>
      <SettingsCard
        title={t("settings.devices.phoneAccess")}
        subtitle={t("settings.devices.phoneAccessSubtitle")}
      >
        <If when={access.error()}>
          <SettingsError>{errorText(access.error())}</SettingsError>
        </If>
        <If when={access.loading()}>
          <SettingsLoading label={t("settings.devices.readingAccess")} />
        </If>

        <SettingsRow
          first
          label={t("settings.devices.allowLan")}
          detail={t("settings.devices.allowLanDetail")}
        >
          <SettingsSwitch
            value={access()?.enabled === true}
            disabled={savingAccess() || access() === undefined}
            label={t("settings.devices.allowLan")}
            onChange={(on) => void toggleAccess(on)}
          />
        </SettingsRow>

        <SettingsRow
          label={t("settings.devices.boundInterface")}
          detail={t("settings.devices.boundInterfaceDetail")}
        >
          <Text style={{ fontSize: SETTINGS_DETAIL }}>
            {t(access()?.boundLan === true ? "common.yes" : "common.no")}
          </Text>
        </SettingsRow>

        <If when={access()?.needsRebind === true}>
          <SettingsError>{t("settings.devices.needsRebind")}</SettingsError>
        </If>

        <If when={access()?.tokenHint !== null && access()?.tokenHint !== undefined}>
          <SettingsRow
            label={t("settings.devices.token")}
            detail={t("settings.devices.tokenDetail")}
          >
            <Text style={settingsCode()}>{access()?.tokenHint}</Text>
          </SettingsRow>
        </If>

        <If when={(access()?.lanUrls.length ?? 0) > 0}>
          <SettingsGroup>
            <SettingsNote>{t("settings.devices.addresses")}</SettingsNote>
            <Each of={access()?.lanUrls ?? []} key={(url) => url}>
              {(url) => (
                <View style={{ paddingVertical: 4 }}>
                  <Text style={settingsCode()}>{url()}</Text>
                </View>
              )}
            </Each>
          </SettingsGroup>
        </If>

        <If when={noAddresses()}>
          <SettingsNote>
            {t(access()?.enabled === true
              ? "settings.devices.noAddressEnabled"
              : "settings.devices.noAddressDisabled")}
          </SettingsNote>
        </If>

        <If when={accessError()}>
          <SettingsError>{errorText(accessError())}</SettingsError>
        </If>
      </SettingsCard>

      <SettingsCard
        title={t("settings.devices.pairPhone")}
        subtitle={t("settings.devices.pairPhoneSubtitle")}
      >
        <If when={access()?.enabled !== true}>
          <SettingsNote>{t("settings.devices.pairNeedsLan")}</SettingsNote>
        </If>

        <SettingsRow
          first
          label={t("settings.devices.pairingCode")}
          detail={t("settings.devices.pairingCodeDetail")}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <Button
              label={t("settings.devices.generateCode")}
              variant="primary"
              size="small"
              busy={minting()}
              disabled={minting() || access()?.enabled !== true}
              onPress={() => void mint(false)}
            />
            <Button
              label={t("settings.devices.readOnlyCode")}
              variant="secondary"
              size="small"
              disabled={minting() || access()?.enabled !== true}
              onPress={() => void mint(true)}
            />
          </View>
        </SettingsRow>

        <If when={pairError()}>
          <SettingsError>{errorText(pairError())}</SettingsError>
        </If>

        <If when={pair() !== null}>
          <SettingsGroup>
            <If
              when={pairLeft() > 0}
              else={<SettingsNote tone="warn">{t("settings.devices.codeExpired")}</SettingsNote>}
            >
              <View style={{ alignItems: "center", gap: 8, paddingVertical: 6 }}>
                <Text style={{ ...settingsCode(), fontSize: 22, letterSpacing: 6 }}>{pair()?.code}</Text>
                <If
                  when={pairUrl() !== null}
                  else={<SettingsNote>{t("settings.devices.noLanAddressQr")}</SettingsNote>}
                >
                  <PairQr content={() => pairUrl() ?? ""} label={t("settings.devices.pairingQr")} />
                </If>
                <SettingsNote>
                  {`${t(pair()?.readOnly === true
                    ? "settings.devices.readOnlyAccess"
                    : "settings.devices.fullAccess")} · ${t("settings.devices.expiresIn", { time: clock(pairLeft()) })}`}
                </SettingsNote>
              </View>
            </If>
          </SettingsGroup>
        </If>
      </SettingsCard>

      <SettingsCard
        title={t("settings.devices.botChannels")}
        subtitle={t("settings.devices.botChannelsSubtitle")}
        right={
          <Button
            label={t("i18n.refresh")}
            variant="ghost"
            size="small"
            disabled={bots.loading()}
            onPress={() => bots.refetch()}
          />
        }
      >
        <If when={bots.error()}>
          <SettingsError>{errorText(bots.error())}</SettingsError>
        </If>
        <If when={bots.loading() && bots() === undefined}>
          <SettingsLoading label={t("settings.devices.readingBots")} />
        </If>

        <If when={(bots()?.length ?? 0) > 0}>
          <SettingsRow
            first
            label={t("settings.devices.channel")}
            detail={t("settings.devices.channelDetail")}
          >
            <Segmented
              options={channelOptions()}
              value={activeBot()}
              onChange={chooseChannel}
              size="small"
            />
          </SettingsRow>

          <Each
            of={(bots() ?? []).filter((channel) => channel.id === activeBot())}
            key={(channel) => channel.id}
          >
            {(bot) => (
              <SettingsGroup>
                <SettingsRow
                  first
                  label={botLabel(bot().id)}
                  detail={t(BOT_DETAIL_KEYS[bot().id])}
                  note={
                    <View style={{ gap: 2 }}>
                      <If when={bot().tokenHint !== null}>
                        <SettingsNote>
                          {t("settings.devices.savedCredential", { hint: bot().tokenHint ?? "" })}
                        </SettingsNote>
                      </If>
                      <If when={bot().hasAppId}>
                        <SettingsNote>
                          {t("settings.devices.appIdSaved", { label: appIdLabel(bot().id) })}
                        </SettingsNote>
                      </If>
                      <If when={bot().hasAgentId}>
                        <SettingsNote>{t("settings.devices.agentIdSaved")}</SettingsNote>
                      </If>
                      <If when={bot().hasCallback}>
                        <SettingsNote>{t("settings.devices.callbackSaved")}</SettingsNote>
                      </If>
                      <If when={bot().allowCount > 0}>
                        <SettingsNote>
                          {t("settings.devices.allowedSendersSaved", { count: bot().allowCount })}
                        </SettingsNote>
                      </If>
                      <If when={bot().missing.length > 0}>
                        <SettingsNote tone="warn">
                          {t("settings.devices.stillNeeded", { fields: bot().missing.join(", ") })}
                        </SettingsNote>
                      </If>
                    </View>
                  }
                >
                  <Status
                    label={t(bot().running
                      ? "common.running"
                      : bot().ready
                        ? "common.ready"
                        : "common.notReady")}
                    tone={bot().running ? "up" : bot().ready ? "warn" : "neutral"}
                  />
                  <Button
                    label={t(bot().running ? "common.stop" : "common.start")}
                    variant={bot().running ? "secondary" : "primary"}
                    size="small"
                    busy={botBusy() === `${bot().running ? "stop" : "start"}:${bot().id}`}
                    disabled={botBusy() !== null || (!bot().running && !bot().ready)}
                    onPress={() => void runBot(bot().id, bot().running ? "stop" : "start")}
                  />
                </SettingsRow>

                <If when={!bot().lanFriendly}>
                  <SettingsRow
                    label={t("settings.devices.callbackUrl")}
                    detail={t("settings.devices.callbackUrlDetail")}
                  >
                    <Text style={settingsCode()}>{callbackUrl()}</Text>
                  </SettingsRow>
                </If>

                <If when={isScannable(bot().id)}>
                  <SettingsRow
                    label={t("settings.devices.scanToConnect")}
                    detail={t(bot().id === "wechat"
                      ? "settings.devices.scanWechatDetail"
                      : "settings.devices.scanFeishuDetail")}
                  >
                    <If
                      when={scan() !== null}
                      else={
                        <Button
                          label={t("settings.devices.showQr")}
                          variant="secondary"
                          size="small"
                          busy={botBusy() === `scan:${bot().id}`}
                          disabled={botBusy() !== null}
                          onPress={() => void beginScan()}
                        />
                      }
                    >
                      <View style={{ alignItems: "center", gap: 6 }}>
                        <PairQr
                          content={() => scan()?.content ?? ""}
                          label={t("settings.devices.connectionQr", { label: botLabel(bot().id) })}
                        />
                        <SettingsNote>{scan()?.status ?? ""}</SettingsNote>
                        <Button
                          label={t("i18n.cancel")}
                          variant="secondary"
                          size="small"
                          onPress={() => void cancelScan()}
                        />
                      </View>
                    </If>
                  </SettingsRow>
                </If>

                <If when={bot().id !== "wechat"}>
                  <SettingsRow label={appIdLabel(bot().id)} detail={appIdDetail(bot().id)}>
                    <Input
                      class={field.class}
                      style={field.style}
                      value={appId()}
                      onChange={({ value }) => appId.set(value)}
                      placeholder={bot().hasAppId
                        ? t("settings.devices.savedPlaceholder")
                        : appIdLabel(bot().id)}
                      accessibilityLabel={appIdLabel(bot().id)}
                    />
                  </SettingsRow>
                </If>

                <If when={bot().id === "wecom"}>
                  <SettingsRow
                    label="AgentId"
                    detail={t("settings.devices.agentIdDetail")}
                  >
                    <Input
                      class={field.class}
                      style={field.style}
                      value={agentId()}
                      onChange={({ value }) => agentId.set(value)}
                      placeholder={bot().hasAgentId
                        ? t("settings.devices.savedPlaceholder")
                        : "1000002"}
                      accessibilityLabel="AgentId"
                    />
                  </SettingsRow>

                  <SettingsRow
                    label={t("settings.devices.callbackFields")}
                    detail={t("settings.devices.callbackFieldsDetail")}
                  >
                    <View style={{ gap: 6 }}>
                      <Input
                        class={field.class}
                        style={field.style}
                        value={callbackToken()}
                        onChange={({ value }) => callbackToken.set(value)}
                        masked
                        placeholder={bot().hasCallback
                          ? t("settings.devices.savedPlaceholder")
                          : "Callback Token"}
                        accessibilityLabel="Callback Token"
                      />
                      <Input
                        class={field.class}
                        style={field.style}
                        value={callbackAesKey()}
                        onChange={({ value }) => callbackAesKey.set(value)}
                        masked
                        placeholder={bot().hasCallback
                          ? t("settings.devices.savedPlaceholder")
                          : "EncodingAESKey"}
                        accessibilityLabel="EncodingAESKey"
                      />
                    </View>
                  </SettingsRow>
                </If>

                <SettingsRow
                  label={secretLabel(bot().id)}
                  detail={t("settings.devices.secretDetail")}
                >
                  <Input
                    class={field.class}
                    style={field.style}
                    value={secret()}
                    onChange={({ value }) => secret.set(value)}
                    masked
                    placeholder={bot().tokenHint !== null
                      ? t("settings.devices.savedPlaceholder")
                      : secretLabel(bot().id)}
                    accessibilityLabel={secretLabel(bot().id)}
                  />
                </SettingsRow>

                <SettingsRow
                  label={t("settings.devices.allowedSenders")}
                  detail={t("settings.devices.allowedSendersDetail")}
                >
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <Input
                      class={field.class}
                      style={field.style}
                      value={allowFrom()}
                      onChange={({ value }) => {
                        allowFrom.set(value);
                        allowFromDirty.set(true);
                      }}
                      placeholder={
                        bot().allowCount > 0
                          ? t("settings.devices.savedCountPlaceholder", { count: bot().allowCount })
                          : t("settings.devices.emptyBindFirst")
                      }
                      accessibilityLabel={t("settings.devices.allowedSenders")}
                    />
                    <Button
                      label={t("common.clear")}
                      variant="ghost"
                      size="small"
                      disabled={botBusy() !== null || (!allowFromDirty() && bot().allowCount === 0)}
                      onPress={() => {
                        allowFrom.set("");
                        allowFromDirty.set(true);
                      }}
                    />
                  </View>
                </SettingsRow>

                <SettingsRow
                  label={t("settings.devices.session")}
                  detail={t("settings.devices.sessionDetail")}
                >
                  <Input
                    class={field.class}
                    style={field.style}
                    value={sessionId()}
                    onChange={({ value }) => sessionId.set(value)}
                    placeholder={t("settings.devices.emptySession")}
                    accessibilityLabel={t("settings.devices.sessionId")}
                  />
                </SettingsRow>

                <SettingsRow
                  label={t("i18n.save")}
                  detail={t("settings.devices.saveDetail")}
                >
                  <Button
                    label={t("i18n.save")}
                    variant="primary"
                    size="small"
                    busy={botBusy() === `save:${bot().id}`}
                    disabled={botBusy() !== null}
                    onPress={() => void save()}
                  />
                </SettingsRow>
              </SettingsGroup>
            )}
          </Each>
        </If>

        <If when={botNote()?.kind === "error"}>
          <SettingsError>{botNote()?.text ?? ""}</SettingsError>
        </If>
        <If when={botNote()?.kind === "ok"}>
          <SettingsNote>{botNote()?.text ?? ""}</SettingsNote>
        </If>
      </SettingsCard>
    </View>
  );
}

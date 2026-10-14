import { useCallback, useEffect, useState, type JSX } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import { Loading03Icon, PlayIcon, SquareIcon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  CHANNELS,
  type ChatChannelConfig,
  type ChatChannelEntry,
  type ChatChannelId,
} from "@shared/chat-channel";
import { QrCode } from "@/components/ui/qr-code";
import { SettingsGroup, SettingsRow } from "./settings-group";

/** 能扫码注册的三档：微信 iLink、飞书、Lark。 */
const SCANNABLE = new Set(["wechat", "feishu", "lark"]);

/**
 * 设置 → 机器人渠道 (fork:bot-channel).
 *
 * Inbound: the channel drives a conversation here, rather than the other way round. That
 * direction is why two rules in the runtime are not negotiable, and why this page says them
 * out loud instead of hiding them:
 *
 *  - a message never lands in whatever conversation is **open** (it goes to a conversation
 *    with no project, the scratch workspace), and
 *  - it is never injected into a turn that is already running.
 *
 * `enabled` means "should this be running", not "is it configured": start writes true, stop
 * writes false, and the next launch brings back exactly the ones that are true. A long poll
 * lives inside this process, so without that flag a restart would silently drop it while the
 * page still claimed it was set up.
 *
 * The token is a credential: it goes out as stored and comes back as stored, and this page
 * never sees whether it is the right length or shape.
 */
export function BotChannelSettings(): JSX.Element {
  const { t } = useTranslation("settings");
  const [config, setConfig] = useState<ChatChannelConfig | null>(null);
  const [draft, setDraft] = useState<ChatChannelConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [running, setRunning] = useState<Record<string, boolean>>({});
  /** 在途扫码：二维码内容 + 已扫到哪一步。 */
  const [scan, setScan] = useState<{ id: string; qr: string; status: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await window.pinext.botChannel.get();
      setConfig(next);
      setDraft(next);
    } catch (cause) {
      toast.error(t("botChannel.loadFailed", { error: cause instanceof Error ? cause.message : String(cause) }));
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const entryOf = (source: ChatChannelConfig, id: ChatChannelId): ChatChannelEntry =>
    source.channels[id] ?? { allowFrom: [], enabled: false };

  const patch = (id: ChatChannelId, next: Partial<ChatChannelEntry>): void => {
    setDraft((value) => {
      if (!value) return value;
      return { ...value, channels: { ...value.channels, [id]: { ...entryOf(value, id), ...next } } };
    });
  };

  const save = async (): Promise<void> => {
    if (!draft) return;
    setSaving(true);
    try {
      const next = await window.pinext.botChannel.set(draft.channels as Record<string, unknown>);
      setConfig(next);
      setDraft(next);
      toast.success(t("botChannel.saved"));
    } catch (cause) {
      toast.error(t("botChannel.saveFailed", { error: cause instanceof Error ? cause.message : String(cause) }));
    } finally {
      setSaving(false);
    }
  };

  /**
   * 扫码绑定：开始 → 每 intervalSeconds 轮询一次 → 成功即刷新。
   *
   * 轮询由前台驱动，不是服务端推：注册会话是有寿命的（二维码会过期），前台看得见用户
   * 什么时候把卡片关了，也就知道什么时候该停 —— 服务端只管那次注册本身在不在。
   */
  const startScan = async (id: ChatChannelId): Promise<void> => {
    setBusy(id);
    try {
      const begun = await window.pinext.botChannel.registerBegin(id);
      if (!begun.ok) {
        toast.error(t("botChannel.scanFailed", { error: begun.error }));
        return;
      }
      setScan({ id, qr: begun.qrContent, status: "pending" });
      const intervalMs = Math.max(2, begun.intervalSeconds) * 1000;
      const deadline = Date.now() + begun.expiresInSeconds * 1000;
      const tick = async (): Promise<void> => {
        const result = (await window.pinext.botChannel.registerPoll(id)) as
          | { ok: false; error: string }
          | { ok: true; status: "pending" | "scanned" | "expired" | "success" };
        if (!result.ok) {
          setScan(null);
          toast.error(t("botChannel.scanFailed", { error: result.error }));
          return;
        }
        if (result.status === "success") {
          setScan(null);
          await load();
          toast.success(t("botChannel.scanDone"));
          return;
        }
        if (result.status === "expired" || Date.now() > deadline) {
          setScan(null);
          toast.error(t("botChannel.scanExpired"));
          return;
        }
        setScan((value) => (value ? { ...value, status: result.status } : value));
        setTimeout(() => void tick(), intervalMs);
      };
      setTimeout(() => void tick(), intervalMs);
    } catch (cause) {
      toast.error(t("botChannel.scanFailed", { error: cause instanceof Error ? cause.message : String(cause) }));
    } finally {
      setBusy(null);
    }
  };

  const toggle = async (id: ChatChannelId, on: boolean): Promise<void> => {
    setBusy(id);
    try {
      if (on) {
        // Save first: starting a channel from an unsaved form would run the old credentials.
        await save();
        const result = await window.pinext.botChannel.start(id);
        if (!result.ok) {
          toast.error(t("botChannel.startFailed", { error: result.error ?? "" }));
          return;
        }
        setRunning((value) => ({ ...value, [id]: true }));
      } else {
        await window.pinext.botChannel.stop(id);
        setRunning((value) => ({ ...value, [id]: false }));
        // `stop` also persists `enabled: false`; re-read so the switch agrees with the file.
        await load();
      }
    } catch (cause) {
      toast.error(t("botChannel.startFailed", { error: cause instanceof Error ? cause.message : String(cause) }));
    } finally {
      setBusy(null);
    }
  };

  if (!draft) return <div className="px-1 py-6 text-sm text-muted-foreground">{t("botChannel.loading")}</div>;

  const dirty = JSON.stringify(draft) !== JSON.stringify(config);

  return (
    <div className="space-y-6">
      {CHANNELS.map((spec) => {
        const entry = entryOf(draft, spec.id);
        const missing = [
          ...(entry.token ? [] : [spec.requires[0] ?? "token"]),
          ...(spec.id === "telegram" && !entry.chatId ? ["chat id"] : []),
        ];
        const isRunning = running[spec.id] === true;
        return (
          <SettingsGroup key={spec.id} title={spec.label}>
            <SettingsRow
              title={t("botChannel.enable")}
              // The note is the channel's own honest status: which ones actually work here,
              // and what the ones that do not would need.
              description={spec.note}
              control={
                <div className="flex items-center gap-2">
                  {isRunning ? (
                    <span className="text-xs text-muted-foreground">{t("botChannel.running")}</span>
                  ) : null}
                  <Switch
                    checked={isRunning}
                    disabled={busy === spec.id}
                    onCheckedChange={(checked) => void toggle(spec.id, checked)}
                  />
                </div>
              }
            />
            <SettingsRow
              title={t("botChannel.token")}
              description={t("botChannel.tokenHint")}
              control={
                <Input
                  className="w-72"
                  type="password"
                  value={entry.token ?? ""}
                  placeholder={spec.requires[0] ?? "token"}
                  onChange={(event) => patch(spec.id, { token: event.target.value })}
                />
              }
            />
            {spec.id === "telegram" ? (
              <SettingsRow
                title="chat id"
                description={t("botChannel.chatIdHint")}
                control={
                  <Input
                    className="w-72"
                    value={entry.chatId ?? ""}
                    onChange={(event) => patch(spec.id, { chatId: event.target.value })}
                  />
                }
              />
            ) : null}
            <SettingsRow
              title={t("botChannel.session")}
              description={t("botChannel.sessionHint")}
              control={
                <Input
                  className="w-72"
                  value={entry.sessionId ?? ""}
                  placeholder={t("botChannel.sessionPlaceholder")}
                  onChange={(event) => patch(spec.id, { sessionId: event.target.value })}
                />
              }
            />
            <SettingsRow
              title={t("botChannel.allowFrom")}
              // Fail closed: an empty list lets nobody through. For the QR channels the first
              // person to write is bound automatically — which is why the list starts empty
              // rather than with a guess.
              description={t("botChannel.allowFromHint")}
              control={
                <Input
                  className="w-72"
                  value={entry.allowFrom.join(", ")}
                  placeholder={t("botChannel.allowFromPlaceholder")}
                  onChange={(event) =>
                    patch(spec.id, {
                      allowFrom: event.target.value.split(",").map((item) => item.trim()).filter((item) => item.length > 0),
                    })
                  }
                />
              }
            />
            {SCANNABLE.has(spec.id) ? (
              <SettingsRow
                title={t("botChannel.scan")}
                description={t("botChannel.scanHint")}
                control={
                  scan?.id === spec.id ? (
                    <div className="flex flex-col items-center gap-2">
                      <QrCode value={scan.qr} className="size-40 rounded-lg bg-white p-2" />
                      <span className="text-xs text-muted-foreground">
                        {scan.status === "scanned" ? t("botChannel.scanScanned") : t("botChannel.scanPending")}
                      </span>
                      <Button
                        size="xs"
                        variant="outline"
                        onClick={() => {
                          void window.pinext.botChannel.registerCancel(spec.id);
                          setScan(null);
                        }}
                      >
                        {t("botChannel.scanCancel")}
                      </Button>
                    </div>
                  ) : (
                    <Button size="sm" variant="outline" disabled={busy === spec.id} onClick={() => void startScan(spec.id)}>
                      {busy === spec.id ? <HugeiconsIcon strokeWidth={2} icon={Loading03Icon} className="size-3.5 animate-spin" /> : null}
                      {t("botChannel.scan")}
                    </Button>
                  )
                }
              />
            ) : null}
            {missing.length > 0 ? (
              <SettingsRow
                title={t("botChannel.notReady")}
                description={t("botChannel.missing", { list: missing.join(" · ") })}
                control={<span className="text-xs text-muted-foreground">{isRunning ? "" : t("botChannel.stopped")}</span>}
              />
            ) : null}
          </SettingsGroup>
        );
      })}

      <div className="flex justify-end">
        <Button size="sm" disabled={saving || !dirty} onClick={() => void save()}>
          {saving ? <HugeiconsIcon strokeWidth={2} icon={Loading03Icon} className="size-3.5 animate-spin" /> : null}
          {t("botChannel.save")}
        </Button>
      </div>

      <SettingsGroup title={t("botChannel.behaviourTitle")}>
        <SettingsRow title={t("botChannel.behaviourWhere")} description={t("botChannel.behaviourWhereHint")} control={null} />
        <SettingsRow title={t("botChannel.behaviourBusy")} description={t("botChannel.behaviourBusyHint")} control={null} />
        <SettingsRow
          title={t("botChannel.toolTitle")}
          description={t("botChannel.toolHint")}
          control={
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <HugeiconsIcon strokeWidth={2} icon={PlayIcon} className="size-3.5" />
              <HugeiconsIcon strokeWidth={2} icon={SquareIcon} className="size-3.5" />
              bot-channel:start / stop
            </span>
          }
        />
      </SettingsGroup>
    </div>
  );
}

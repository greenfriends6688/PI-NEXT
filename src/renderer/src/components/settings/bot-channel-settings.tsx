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
import { SettingsGroup, SettingsRow } from "./settings-group";

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

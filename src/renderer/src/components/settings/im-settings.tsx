import { useCallback, useEffect, useState, type JSX } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import { Delete02Icon, Loading03Icon, PlusSignIcon, SentIcon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  detectImProvider,
  IM_PROVIDER_IDS,
  needsImChatId,
  needsImSecret,
  type ImProvider,
  type ImTarget,
  type ImTargetView,
} from "@shared/im-bridge";
import { SettingsGroup, SettingsRow } from "./settings-group";

/**
 * 设置 → IM 推送 (fork:im-bridge).
 *
 * Five platforms that are all "POST one JSON": Feishu, WeCom, DingTalk, Slack, Telegram, plus
 * a custom webhook. The two signatures are mirrors of each other and are **not** merged —
 * Feishu keys on `timestamp\\nsecret` in the body, DingTalk on `secret` in the query with a
 * `ms\\nsecret` message — and getting that backwards fails quietly.
 *
 * The webhook URL is the credential, so the list shows the host and never the URL itself;
 * changing one means typing a new one.
 */
export function ImBridgeSettings(): JSX.Element {
  const { t } = useTranslation("settings");
  const [targets, setTargets] = useState<ImTargetView[]>([]);
  const [drafts, setDrafts] = useState<ImTarget[]>([]);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await window.pinext.im.get();
      setTargets(next);
      // A view has no URL, so an edit is expressed by typing a fresh target rather than by
      // round-tripping a secret the renderer never held.
      setDrafts([]);
    } catch (cause) {
      toast.error(t("im.loadFailed", { error: cause instanceof Error ? cause.message : String(cause) }));
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const addDraft = (): void => {
    setDrafts((value) => [
      ...value,
      { id: `t${Date.now().toString(36)}`, label: "", provider: "feishu", url: "", enabled: true },
    ]);
  };

  const patchDraft = (id: string, patch: Partial<ImTarget>): void => {
    setDrafts((value) => value.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  };

  const save = async (): Promise<void> => {
    setSaving(true);
    try {
      // Only the well-formed drafts join the table; half-typed rows are not persisted.
      const ready = drafts.filter((item) => item.url.trim().length > 0 && item.label.trim().length > 0);
      // Existing rows keep their stored URL by being sent back without one — the engine
      // treats a missing URL as "keep what is stored".
      const keep = targets.map((view) => ({
        id: view.id,
        label: view.label,
        provider: view.provider,
        url: "",
        enabled: view.enabled,
      })) as ImTarget[];
      const next = await window.pinext.im.set([...keep, ...ready]);
      setTargets(next);
      setDrafts([]);
      toast.success(t("im.saved"));
    } catch (cause) {
      toast.error(t("im.saveFailed", { error: cause instanceof Error ? cause.message : String(cause) }));
    } finally {
      setSaving(false);
    }
  };

  const test = async (id: string): Promise<void> => {
    setTesting(id);
    try {
      const outcome = await window.pinext.im.test(id);
      if (outcome.ok) toast.success(t("im.testOk", { label: outcome.label }));
      else toast.error(t("im.testFailed", { detail: outcome.detail }));
    } catch (cause) {
      toast.error(t("im.testFailed", { detail: cause instanceof Error ? cause.message : String(cause) }));
    } finally {
      setTesting(null);
    }
  };

  const toggle = (id: string, enabled: boolean): void => {
    setTargets((value) => value.map((item) => (item.id === id ? { ...item, enabled } : item)));
    setDrafts((value) => [
      ...value.filter((item) => !targets.some((view) => view.id === item.id)),
      ...targets
        .filter((view) => view.id === id)
        .map((view) => ({ ...view, url: "", enabled }) as unknown as ImTarget),
    ]);
  };

  return (
    <div className="space-y-6">
      <SettingsGroup title={t("im.targetsTitle")}>
        {targets.length === 0 && drafts.length === 0 ? (
          <SettingsRow title={t("im.empty")} description={t("im.emptyHint")} control={null} />
        ) : null}
        {targets.map((target) => (
          <SettingsRow
            key={target.id}
            title={target.label}
            description={`${target.provider} · ${target.host}`}
            control={
              <div className="flex items-center gap-2">
                <Switch checked={target.enabled} onCheckedChange={(checked) => toggle(target.id, checked)} />
                <Button size="xs" variant="outline" disabled={testing === target.id} onClick={() => void test(target.id)}>
                  {testing === target.id ? (
                    <HugeiconsIcon strokeWidth={2} icon={Loading03Icon} className="size-3.5 animate-spin" />
                  ) : (
                    t("im.test")
                  )}
                </Button>
              </div>
            }
          />
        ))}
        {drafts.map((draft) => (
          <div key={draft.id} className="space-y-2 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Input
                className="w-40"
                placeholder={t("im.label")}
                value={draft.label}
                onChange={(event) => patchDraft(draft.id, { label: event.target.value })}
              />
              <Select
                value={draft.provider}
                onValueChange={(value) => patchDraft(draft.id, { provider: (value ?? draft.provider) as ImProvider })}
              >
                <SelectTrigger size="sm" className="w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {IM_PROVIDER_IDS.map((id) => (
                    <SelectItem key={id} value={id}>
                      {id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label={t("im.remove")}
                onClick={() => setDrafts((value) => value.filter((item) => item.id !== draft.id))}
              >
                <HugeiconsIcon strokeWidth={2} icon={Delete02Icon} />
              </Button>
            </div>
            <Input
              placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/…"
              value={draft.url}
              // The provider is guessed from the URL, because that is what actually decides
              // the request shape — the dropdown is only there to correct a guess.
              onChange={(event) => patchDraft(draft.id, { url: event.target.value, provider: detectImProvider(event.target.value) })}
            />
            {needsImSecret(draft.provider) ? (
              <Input
                type="password"
                placeholder={t("im.secret")}
                value={draft.secret ?? ""}
                onChange={(event) => patchDraft(draft.id, { secret: event.target.value })}
              />
            ) : null}
            {needsImChatId(draft.provider) ? (
              <Input
                placeholder="chat_id"
                value={draft.chatId ?? ""}
                onChange={(event) => patchDraft(draft.id, { chatId: event.target.value })}
              />
            ) : null}
          </div>
        ))}
      </SettingsGroup>

      <div className="flex items-center justify-between">
        <Button size="sm" variant="outline" onClick={addDraft}>
          <HugeiconsIcon strokeWidth={2} icon={PlusSignIcon} className="size-3.5" />
          {t("im.add")}
        </Button>
        <Button size="sm" disabled={saving} onClick={() => void save()}>
          {saving ? <HugeiconsIcon strokeWidth={2} icon={Loading03Icon} className="size-3.5 animate-spin" /> : null}
          {t("im.save")}
        </Button>
      </div>

      <SettingsGroup title={t("im.toolTitle")}>
        <SettingsRow
          title={t("im.tool")}
          description={t("im.toolHint")}
          control={
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <HugeiconsIcon strokeWidth={2} icon={SentIcon} className="size-3.5" />
              im_send
            </span>
          }
        />
      </SettingsGroup>
    </div>
  );
}

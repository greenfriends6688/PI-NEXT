import { useCallback, useEffect, useState, type JSX } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  WEB_SEARCH_DEFAULT_TIMEOUT_SECONDS,
  WEB_SEARCH_PROVIDER_IDS,
  WEB_SEARCH_TOKEN_MASK,
  type WebSearchProviderId,
  type WebSearchSettings,
} from "@shared/websearch";
import { SettingsGroup, SettingsRow } from "./settings-group";

/**
 * 设置 → 联网搜索 (fork:websearch).
 *
 * **Off by default.** It is the one feature here whose whole job is to go out to the
 * network, and the same rule the memory switch follows applies: something that acts while
 * nobody is watching starts off, and the person turns it on.
 *
 * The provider list is the shared vocabulary, not a copy — the tool reads the same one, so
 * a provider can never appear in the dropdown and be unknown to the search itself.
 *
 * `searxngToken` is masked on the way out and merged on the way in, the same rule as the
 * image and IM keys: sending the mask back keeps what is stored, and only an explicitly
 * emptied field clears it.
 */
export function WebSearchSettings(): JSX.Element {
  const { t } = useTranslation("settings");
  const [settings, setSettings] = useState<WebSearchSettings | null>(null);
  const [draft, setDraft] = useState<WebSearchSettings | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const next = await window.pinext.websearch.get();
      setSettings(next);
      setDraft(next);
    } catch (cause) {
      toast.error(t("websearch.loadFailed", { error: cause instanceof Error ? cause.message : String(cause) }));
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const change = (patch: Partial<WebSearchSettings>): void => {
    setDraft((value) => (value ? { ...value, ...patch } : value));
  };

  const save = async (): Promise<void> => {
    if (!draft) return;
    setSaving(true);
    try {
      const next = await window.pinext.websearch.set(draft);
      setSettings(next);
      setDraft(next);
      toast.success(t("websearch.saved"));
    } catch (cause) {
      toast.error(t("websearch.saveFailed", { error: cause instanceof Error ? cause.message : String(cause) }));
    } finally {
      setSaving(false);
    }
  };

  if (!draft || !settings) return <div className="px-1 py-6 text-sm text-muted-foreground">{t("websearch.loading")}</div>;

  const dirty = JSON.stringify(draft) !== JSON.stringify(settings);
  const searxng = draft.provider === "searxng";

  return (
    <div className="space-y-6">
      <SettingsGroup title={t("websearch.title")}>
        <SettingsRow
          title={t("websearch.enabled")}
          description={t("websearch.enabledHint")}
          control={<Switch checked={draft.enabled} onCheckedChange={(checked) => change({ enabled: checked })} />}
        />
        <SettingsRow
          title={t("websearch.provider")}
          description={t("websearch.providerHint")}
          control={
            <Select
              value={draft.provider}
              onValueChange={(value) => change({ provider: (value ?? draft.provider) as WebSearchProviderId })}
            >
              <SelectTrigger size="sm" className="w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {WEB_SEARCH_PROVIDER_IDS.map((id) => (
                  <SelectItem key={id} value={id}>
                    {t(`websearch.providers.${id}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
        />
        <SettingsRow
          title={t("websearch.fallback")}
          description={t("websearch.fallbackHint")}
          control={<Switch checked={draft.fallbackToPublic} onCheckedChange={(checked) => change({ fallbackToPublic: checked })} />}
        />
        <SettingsRow
          title={t("websearch.timeout")}
          description={t("websearch.timeoutHint")}
          control={
            <Input
              className="w-24"
              type="number"
              min={5}
              max={120}
              value={String(draft.timeoutSeconds || WEB_SEARCH_DEFAULT_TIMEOUT_SECONDS)}
              onChange={(event) => change({ timeoutSeconds: Number(event.target.value) || WEB_SEARCH_DEFAULT_TIMEOUT_SECONDS })}
            />
          }
        />
      </SettingsGroup>

      <SettingsGroup title={t("websearch.searxngTitle")}>
        <SettingsRow
          title={t("websearch.endpoint")}
          description={t("websearch.endpointHint")}
          control={
            <Input
              className="w-72"
              value={draft.searxngEndpoint}
              placeholder="http://127.0.0.1:8080"
              onChange={(event) => change({ searxngEndpoint: event.target.value })}
            />
          }
        />
        <SettingsRow
          title={t("websearch.token")}
          description={draft.searxngToken === WEB_SEARCH_TOKEN_MASK ? t("websearch.tokenStored") : t("websearch.tokenHint")}
          control={
            <Input
              className="w-72"
              type="password"
              value={draft.searxngToken}
              onChange={(event) => change({ searxngToken: event.target.value })}
            />
          }
        />
        <SettingsRow
          title={t("websearch.language")}
          description={t("websearch.languageHint")}
          control={
            <Input
              className="w-32"
              value={draft.searxngLanguage}
              placeholder="zh-CN"
              onChange={(event) => change({ searxngLanguage: event.target.value })}
            />
          }
        />
        <SettingsRow
          title={t("websearch.allowPrivate")}
          // A self-hosted SearXNG on 127.0.0.1 is the normal case, and it is also the one
          // request that could be pointed at a private network — so it is opt-in.
          description={t("websearch.allowPrivateHint")}
          control={
            <Switch
              checked={draft.allowPrivateEndpoint}
              disabled={!searxng}
              onCheckedChange={(checked) => change({ allowPrivateEndpoint: checked })}
            />
          }
        />
      </SettingsGroup>

      <div className="flex justify-end">
        <Button size="sm" disabled={saving || !dirty} onClick={() => void save()}>
          {saving ? t("websearch.saving") : t("websearch.save")}
        </Button>
      </div>
    </div>
  );
}

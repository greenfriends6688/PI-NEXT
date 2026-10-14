import { useCallback, useEffect, useState, type JSX } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import { Loading03Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  IMAGEGEN_AGNES_2_0_SIZES,
  IMAGEGEN_AGNES_2_1_SIZES,
  IMAGEGEN_DEFAULT_SIZE,
  imageGenPresetMeta,
  isMaskedImageGenKey,
  type ImageGenConfig,
  type ImageGenPreset,
  type ImageGenTestResult,
} from "@shared/imagegen";
import { SettingsGroup, SettingsRow } from "./settings-group";

/**
 * 设置 → 生图模型 (fork:imagegen).
 *
 * A profile of its own, deliberately **not** part of the chat model list: it has its own
 * endpoint, key, model and size per preset, and it never enters `enabledModels`. The chat
 * model and the image model are different vendors with different accounts.
 *
 * Two rules carried over from PI NEXT, both load-bearing:
 *
 * 1. **The key is only ever seen as a mask.** The page reads `••••••••`, and sending that
 *    value straight back means "keep the stored key" — an explicitly emptied field is the
 *    only way to clear it. There is no state in which the plaintext reaches the renderer.
 * 2. **「测试」really generates an image.** "Looks configured" is a different claim from
 *    "works", and the status it records is what anything else is allowed to rely on — a
 *    profile that has never passed is not treated as usable.
 */
export function ImageGenSettings(): JSX.Element {
  const { t } = useTranslation("settings");
  const [config, setConfig] = useState<ImageGenConfig | null>(null);
  const [preset, setPreset] = useState<ImageGenPreset | null>(null);
  const [draft, setDraft] = useState({ baseUrl: "", apiKey: "", model: "", size: IMAGEGEN_DEFAULT_SIZE, concurrency: 1 });
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [tested, setTested] = useState<ImageGenTestResult | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [listing, setListing] = useState(false);

  const load = useCallback(async () => {
    try {
      const next = await window.pinext.imagegen.get();
      setConfig(next);
      setPreset(next.active);
      const profile = next.providers[next.active];
      setDraft({
        baseUrl: profile?.baseUrl ?? "",
        apiKey: profile?.apiKey ?? "",
        model: profile?.model ?? "",
        size: profile?.size || IMAGEGEN_DEFAULT_SIZE,
        concurrency: profile?.concurrency ?? 1,
      });
    } catch (cause) {
      toast.error(t("imagegen.loadFailed", { error: cause instanceof Error ? cause.message : String(cause) }));
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Switching presets shows that preset's stored values, not a blank form. */
  const selectPreset = (next: ImageGenPreset): void => {
    setPreset(next);
    setTested(null);
    const profile = config?.providers[next];
    setDraft({
      baseUrl: profile?.baseUrl ?? imageGenPresetMeta(next).baseUrl ?? "",
      apiKey: profile?.apiKey ?? "",
      model: profile?.model ?? "",
      size: profile?.size || IMAGEGEN_DEFAULT_SIZE,
      concurrency: profile?.concurrency ?? 1,
    });
  };

  const save = async (): Promise<void> => {
    if (!preset) return;
    setSaving(true);
    try {
      const next = await window.pinext.imagegen.set({
        active: preset,
        providers: {
          [preset]: {
            baseUrl: draft.baseUrl,
            apiKey: draft.apiKey,
            model: draft.model,
            size: draft.size,
            concurrency: draft.concurrency,
          },
        },
      });
      setConfig(next);
      toast.success(t("imagegen.saved"));
    } catch (cause) {
      toast.error(t("imagegen.saveFailed", { error: cause instanceof Error ? cause.message : String(cause) }));
    } finally {
      setSaving(false);
    }
  };

  /**
   * Ask the provider what it actually serves.
   *
   * The preset table ships a default model name per vendor, and vendors rename things — so
   * this reads the list rather than trusting the name in the table.
   */
  const listModels = async (): Promise<void> => {
    if (!preset) return;
    setListing(true);
    try {
      const found = await window.pinext.imagegen.models(preset);
      setModels(found);
      if (found.length === 0) toast.info(t("imagegen.modelsEmpty"));
    } catch (cause) {
      toast.error(t("imagegen.modelsFailed", { error: cause instanceof Error ? cause.message : String(cause) }));
    } finally {
      setListing(false);
    }
  };

  const test = async (): Promise<void> => {
    if (!preset) return;
    setTesting(true);
    setTested(null);
    try {
      setTested(await window.pinext.imagegen.test(preset));
    } catch (cause) {
      toast.error(t("imagegen.testFailed", { error: cause instanceof Error ? cause.message : String(cause) }));
    } finally {
      setTesting(false);
    }
  };

  if (!config || !preset) return <div className="px-1 py-6 text-sm text-muted-foreground">{t("imagegen.loading")}</div>;

  const meta = imageGenPresetMeta(preset);
  const status = config.providers[preset]?.status;
  const sizes = meta.dialect === "agnes" && draft.model.includes("2.1") ? IMAGEGEN_AGNES_2_1_SIZES : IMAGEGEN_AGNES_2_0_SIZES;
  const keyStored = isMaskedImageGenKey(draft.apiKey);

  return (
    <div className="space-y-6">
      <SettingsGroup title={t("imagegen.providerTitle")}>
        <SettingsRow
          title={t("imagegen.preset")}
          description={t("imagegen.presetHint", { dialect: meta.dialect })}
          control={
            <Select items={undefined} value={preset} onValueChange={(value) => selectPreset(value as ImageGenPreset)}>
              <SelectTrigger size="sm" className="w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(config.providers) as ImageGenPreset[]).map((id) => (
                  <SelectItem key={id} value={id}>
                    {imageGenPresetMeta(id).label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
        />
        <SettingsRow
          title={t("imagegen.baseUrl")}
          description={t("imagegen.baseUrlHint")}
          control={
            <Input
              className="w-72"
              value={draft.baseUrl}
              placeholder={meta.baseUrl}
              onChange={(event) => setDraft((value) => ({ ...value, baseUrl: event.target.value }))}
            />
          }
        />
        <SettingsRow
          title={t("imagegen.apiKey")}
          // What the mask means is the whole interaction: sending it back keeps the key.
          description={keyStored ? t("imagegen.apiKeyStored") : t("imagegen.apiKeyHint")}
          control={
            <Input
              className="w-72"
              type="password"
              value={draft.apiKey}
              placeholder="sk-…"
              onChange={(event) => setDraft((value) => ({ ...value, apiKey: event.target.value }))}
            />
          }
        />
        <SettingsRow
          title={t("imagegen.model")}
          description={models.length > 0 ? t("imagegen.modelPicked", { count: models.length }) : t("imagegen.modelHint")}
          control={
            <div className="flex items-center gap-2">
              <Input
                className="w-64"
                value={draft.model}
                placeholder={meta.model}
                onChange={(event) => setDraft((value) => ({ ...value, model: event.target.value }))}
              />
              {models.length > 0 ? (
                // A real list, not a `<datalist>`: the native suggestion box is drawn by the
                // OS, cannot be styled, ignores the modal's stacking (it painted over the row
                // below), and shows one line at a time. This is the same list, ours.
                <Popover>
                  <PopoverTrigger
                    render={<Button size="sm" variant="outline">{t("imagegen.pickModels", { count: models.length })}</Button>}
                  />
                  <PopoverContent align="end" className="max-h-80 w-72 overflow-y-auto p-1">
                    {models.map((model) => (
                      <button
                        key={model}
                        type="button"
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-muted"
                        onClick={() => setDraft((value) => ({ ...value, model }))}
                      >
                        <span className="min-w-0 flex-1 truncate font-mono text-xs">{model}</span>
                        {model === draft.model ? <HugeiconsIcon strokeWidth={2} icon={Tick02Icon} className="size-3.5 shrink-0 text-primary" /> : null}
                      </button>
                    ))}
                  </PopoverContent>
                </Popover>
              ) : null}
              <Button size="sm" variant="outline" disabled={listing} onClick={() => void listModels()}>
                {listing ? <HugeiconsIcon strokeWidth={2} icon={Loading03Icon} className="size-3.5 animate-spin" /> : null}
                {t("imagegen.listModels")}
              </Button>
            </div>
          }
        />
        <SettingsRow
          title={t("imagegen.size")}
          description={t("imagegen.sizeHint")}
          control={
            <Select value={draft.size} onValueChange={(value) => setDraft((prev) => ({ ...prev, size: value ?? prev.size }))}>
              <SelectTrigger size="sm" className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[...new Set<string>([draft.size, ...sizes])].filter((size) => size.length > 0).map((size) => (
                  <SelectItem key={size} value={size}>
                    {size}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
        />
        <SettingsRow
          title={t("imagegen.concurrency")}
          description={t("imagegen.concurrencyHint")}
          control={
            <Input
              className="w-24"
              type="number"
              min={1}
              max={4}
              value={String(draft.concurrency)}
              onChange={(event) => setDraft((value) => ({ ...value, concurrency: Number(event.target.value) || 1 }))}
            />
          }
        />
      </SettingsGroup>

      <SettingsGroup title={t("imagegen.actionsTitle")}>
        <SettingsRow
          title={t("imagegen.status")}
          description={t("imagegen.statusHint")}
          control={
            <span className="text-sm text-muted-foreground">
              {status?.state === "available"
                ? t("imagegen.statusAvailable")
                : status?.state === "unavailable"
                  ? t("imagegen.statusUnavailable", { error: status.lastError ?? "" })
                  : t("imagegen.statusUntested")}
            </span>
          }
        />
        <SettingsRow
          title={t("imagegen.test")}
          description={t("imagegen.testHint")}
          control={
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" disabled={saving} onClick={() => void save()}>
                {saving ? t("imagegen.saving") : t("imagegen.save")}
              </Button>
              <Button size="sm" disabled={testing} onClick={() => void test()}>
                {testing ? (
                  <HugeiconsIcon strokeWidth={2} icon={Loading03Icon} className="size-3.5 animate-spin" />
                ) : (
                  t("imagegen.testRun")
                )}
              </Button>
            </div>
          }
        />
      </SettingsGroup>

      {tested?.image ? (
        <SettingsGroup title={t("imagegen.resultTitle")}>
          <div className="p-3">
            <img src={tested.image} alt="" className="max-h-64 rounded-lg border border-border" />
            <p className="mt-2 text-xs text-muted-foreground">{tested.path}</p>
          </div>
        </SettingsGroup>
      ) : null}
    </div>
  );
}

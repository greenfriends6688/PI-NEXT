// Settings › Models: the default a new session starts with, above the
// provider / model tree and its editor.
//
// The page keeps pi-next's shape (`重构/pi-next-0.0.4-source-2026-11-14/
// components/ModelsConfig.tsx`): a full-height list-detail body, not a stack
// of settings cards. Only the default model stays outside that body, as one
// slim band, because pi's default is a separate write from models.json.
//
// Three reads feed that band:
// - `GET /api/models/enabled?cwd=` is the `enabledModels` view
//   (`app/api/models/enabled/route.ts:93-101`; `EnabledModelsView`,
//   `lib/enabled-models.ts:106-123`). Its `models` are the providers with a
//   usable credential.
// - `GET /api/models?cwd=` is pi's resolved selector catalog
//   (`app/api/models/route.ts:107-160`). Without `scope=all` it is narrowed by
//   `enabledModels` through `resolveVisibleModels` (`lib/model-scope.ts:75-125`),
//   which is why the picker follows that setting.
// - `GET /api/models?cwd=&scope=all` is the full catalog (`route.ts:117`).
//   It ignores `enabledModels`, so a turned-off model is shown disabled in
//   the picker instead of disappearing: `PUT /api/models/default` refuses a
//   model outside the enabled scope (`app/api/models/default/route.ts:48-116`,
//   96-103).
//
// The default is saved with `PUT /api/models/default`; a project that sets
// its own default answers 409 `project-scope` (`85-95`). Everything below the
// band lives in `./ModelsConfig`: the OAuth / API-key providers, custom
// providers, their model rows, the models.json draft and its Save.
//
// The look is the gallery kit through `./parts`: `ConfigPage` for the title,
// `SettingsSelect` for the default, and `ConfigSplit` inside `ModelsConfig`
// for the two panes and the footer. No Tailwind of our own.

import { resource, signal, Text, View } from "nsh";
import {
  loadEnabledModels,
  saveDefaultModel,
  type EnabledModelView,
} from "../../api/config";
import { loadModels, modelKey, type ModelInfo } from "../../api/models";
import { req } from "../../api/client";
import { errorText } from "../../ui/errors";
import { colors } from "../../ui/kit";
import { activeCwd, settingsOpen } from "../../state/session";
import { t } from "../../ui/i18n";
import { ModelsConfig } from "./ModelsConfig";
import {
  ConfigPage,
  SettingsError,
  SettingsLoading,
  SettingsSelect,
} from "./parts";

/** `provider:modelId`, the key of the default select (ids do not hold the first `:`). */
function refKey(model: { provider: string; id?: string; modelId?: string }): string {
  return modelKey(model.provider, model.id ?? model.modelId ?? "");
}

/** Back from a select value: `provider:modelId`, split at the first `:`. */
function parseRef(key: string): { provider: string; modelId: string } | null {
  const at = key.indexOf(":");
  if (at <= 0 || at === key.length - 1) return null;
  return { provider: key.slice(0, at), modelId: key.slice(at + 1) };
}

export function Models() {
  /** `""` still loads (only null skips): the route then uses the server's own folder. */
  const source = () => (settingsOpen() ? (activeCwd() ?? "") : null);

  const enabled = resource(source, async (folder: string, info) =>
    loadEnabledModels(folder === "" ? null : folder, { signal: info.signal }));
  /** The scoped list: a default must be in `enabledModels` for the route to accept it. */
  const catalog = resource(source, async (folder: string, info) =>
    loadModels(folder === "" ? null : folder, { signal: info.signal }));
  /** The full list, ignoring `enabledModels`; the picker shows every model it knows. */
  const all = resource(source, async (folder: string, info) =>
    loadModels(folder === "" ? null : folder, { signal: info.signal, scopeAll: true }));

  const saving = signal<string | null>(null);
  const error = signal<string | null>(null);

  /** The folder the routes write to; `null` lets the route use its own. */
  const directory = (): string | null => {
    const folder = source();
    return folder === null || folder === "" ? null : folder;
  };

  /** provider.id + model.id → its switch row (the enabled route's ref is `/`, not `:`). */
  const enabledModels = (): Map<string, EnabledModelView> => {
    const map = new Map<string, EnabledModelView>();
    for (const provider of enabled()?.providers ?? []) {
      for (const model of provider.models) map.set(modelKey(provider.id, model.id), model);
    }
    return map;
  };

  const defaultKey = (): string | null => {
    const current = catalog()?.defaultModel;
    return current ? refKey(current) : null;
  };

  const chooseDefault = async (key: string | null): Promise<void> => {
    const model = key ? parseRef(key) : null;
    if (!model) return;
    saving.set("default");
    error.set(null);
    try {
      await saveDefaultModel(directory(), model);
      catalog.refetch();
      all.refetch();
    } catch (cause) {
      error.set(errorText(cause));
    } finally {
      saving.set(null);
    }
  };

  /** The thinking levels the selected model offers (`GET /api/models`). */
  const thinkingLevels = (): string[] => {
    const current = catalog()?.defaultModel;
    if (!current) return [];
    return catalog()?.thinkingLevels[refKey(current)] ?? [];
  };

  /**
   * `PUT /api/models/default` also takes `{ thinkingLevel }` (`parseEdit()`,
   * route 26-38). `saveDefaultModel` in `api/config.ts` names only the model,
   * so this one uses the same route for the level.
   */
  const chooseThinking = async (level: string | null): Promise<void> => {
    if (!level) return;
    saving.set("thinking");
    error.set(null);
    try {
      await req("/api/models/default", {
        method: "PUT",
        body: JSON.stringify({ cwd: directory() ?? undefined, thinkingLevel: level }),
      });
      catalog.refetch();
      all.refetch();
    } catch (cause) {
      error.set(errorText(cause));
    } finally {
      saving.set(null);
    }
  };

  /**
   * Every model, not just the enabled ones: the route refuses a default out of
   * `enabledModels`, so a turned-off row is shown disabled instead of hidden.
   */
  const defaultItems = (): { value: string; title: string; disabled?: boolean }[] => {
    const list: ModelInfo[] = all()?.modelList ?? catalog()?.modelList ?? [];
    const map = enabledModels();
    return list.map((model) => {
      const known = map.get(modelKey(model.provider, model.id));
      return {
        value: refKey(model),
        title: `${model.name || model.id} — ${model.provider}`,
        ...(enabled() !== undefined && known?.enabled !== true ? { disabled: true } : {}),
      };
    });
  };

  const defaultTitle = (): string => {
    const current = catalog()?.defaultModel;
    if (!current) return t(catalog() ? "settings.noDefaultModel" : "settings.loadingModels");
    const found = (all()?.modelList ?? catalog()?.modelList ?? []).find(
      (model) => model.provider === current.provider && model.id === current.modelId,
    );
    return found?.name ?? current.modelId;
  };

  return (
    <ConfigPage title={t("common.models")} subtitle={t("settings.pageSubModels")}>
      {/* One row, not a card: the default belongs to settings.json while the
          body below writes models.json, and the two must not look like one
          draft. "New sessions use" stays the row's detail wording. */}
      <View
        style={{
          flexShrink: 0,
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
          paddingHorizontal: 18,
          paddingVertical: 10,
          borderBottomWidth: 1,
          borderBottomColor: colors.line,
        }}
      >
        <View style={{ minWidth: 0, gap: 1 }}>
          <Text style={{ fontSize: 12.5, fontWeight: "600", color: colors.text }}>
            {t("settings.defaultModel")}
          </Text>
          <Text style={{ fontSize: 10.5, color: colors.muted }}>
            {t("settings.newSessionsUse")}
          </Text>
        </View>
        <View style={{ flex: 1, minWidth: 0 }} />
        <SettingsSelect
          items={defaultItems()}
          value={defaultKey()}
          onChange={(key) => void chooseDefault(key)}
          disabled={saving() !== null || catalog() === undefined}
          label={t("settings.defaultModel")}
          title={defaultTitle()}
          minWidth={340}
        />
        <If when={thinkingLevels().length > 0}>
          <SettingsSelect
            items={thinkingLevels().map((level) => ({ value: level, title: level }))}
            value={catalog()?.defaultThinkingLevel ?? null}
            onChange={(level) => void chooseThinking(level)}
            disabled={saving() !== null || catalog() === undefined}
            label={t("chat.defaultThinking")}
            title={catalog()?.defaultThinkingLevel ?? t("i18n.default")}
            minWidth={160}
          />
        </If>
        <If when={saving() === "default" || saving() === "thinking"}>
          <SettingsLoading label={t("i18n.saving")} />
        </If>
      </View>

      <If when={catalog.error() || all.error() || enabled.error()}>
        <View style={{ flexShrink: 0, paddingHorizontal: 18, paddingTop: 6, gap: 2 }}>
          <If when={catalog.error()}>
            <SettingsError>{errorText(catalog.error())}</SettingsError>
          </If>
          <If when={all.error()}>
            <SettingsError>{errorText(all.error())}</SettingsError>
          </If>
          <If when={enabled.error()}>
            <SettingsError>{errorText(enabled.error())}</SettingsError>
          </If>
        </View>
      </If>
      <If when={error()}>
        <View style={{ flexShrink: 0, paddingHorizontal: 18, paddingTop: 6 }}>
          <SettingsError>{errorText(error())}</SettingsError>
        </View>
      </If>

      <ModelsConfig />
    </ConfigPage>
  );
}

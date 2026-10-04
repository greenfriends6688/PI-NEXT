// fork:enabled-models — upstream-port marker
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { EnabledModelsView } from "@/lib/enabled-models";
import {
  enabledModelsBulkActions,
  enabledModelsProviderToggle,
  filterEnabledModels,
  findProviderView,
  isLastEnabledModel,
} from "./enabled-models-helpers";
/** v5 D-10 的一枚小件：封装画板的 `.d-switch`（`on` 状态类 + aria 语义不变）。 */
function EnabledSwitch({ checked, disabled = false, loading = false, label, onChange }: {
  checked: boolean; disabled?: boolean; loading?: boolean; label: string; onChange: (checked: boolean) => void;
}) {
  const inactive = disabled || loading;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-busy={loading || undefined}
      aria-label={label}
      title={label}
      disabled={inactive}
      className={`d-switch${checked ? " on" : ""}`}
      onClick={() => onChange(!checked)}
    />
  );
}

/**
 * Model switches backed by pi's `enabledModels` setting.
 *
 * Every switch writes through `/api/models/enabled` right away, like the login
 * controls in the same panel and unlike the models.json editor around them,
 * which buffers until Save. Requests are serialized: each one is a
 * read-modify-write of one settings key, so overlapping edits from the same
 * panel could otherwise lose one of them.
 */

/** Shape of `POST /api/models/refresh`, mirroring `CatalogRefreshResult`. */
interface CatalogRefreshResponse {
  completed?: boolean;
  changed?: boolean;
  reason?: "offline" | "runtime";
  error?: string;
}

interface Failure {
  /** Translation key for a known refusal. */
  messageKey?: string;
  /** Raw server text for everything else. */
  message?: string;
}

export interface EnabledModelsController {
  view: EnabledModelsView | null;
  loading: boolean;
  /** Control currently waiting on the server, or null when idle. */
  pending: string | null;
  failure: Failure | null;
  setModels: (key: string, refs: string[], enabled: boolean) => void;
  setProvider: (providerId: string, enabled: boolean) => void;
  clearScope: () => void;
  pruneStale: () => void;
  /** Re-read after models.json changed under the panel. */
  refresh: () => void;
  /** Re-verify the stored patterns after models.json was saved. */
  resync: (
    renames: { from: string; to: string }[],
    modelRenames: { from: string; to: string }[],
  ) => void;
}

type MutationBody =
  | { op: "models"; refs: string[]; enabled: boolean }
  | { op: "provider"; provider: string; enabled: boolean }
  | { op: "clear" }
  | { op: "prune" }
  | {
      op: "resync";
      renames: { from: string; to: string }[];
      modelRenames: { from: string; to: string }[];
      fullyEnabled: string[];
    };

const FAILURE_KEYS: Record<string, string> = {
  "last-model": "models.enabledLastModel",
  "project-scope": "models.enabledProjectScope",
};

export function useEnabledModels(cwd?: string | null): EnabledModelsController {
  const [view, setView] = useState<EnabledModelsView | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<string | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const pendingRef = useRef<string | null>(null);
  const queuedRef = useRef<{ key: string; body: MutationBody } | null>(null);
  const mutateRef = useRef<((key: string, body: MutationBody) => void) | null>(null);

  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    const query = cwd ? `?cwd=${encodeURIComponent(cwd)}` : "";
    fetch(`/api/models/enabled${query}`, { signal: controller.signal })
      .then(async (res) => {
        const data = await res.json() as EnabledModelsView & { error?: string };
        if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
        setView(data);
        setFailure(null);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setFailure({ message: error instanceof Error ? error.message : String(error) });
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [cwd, reloadKey]);

  const mutate = useCallback((key: string, body: MutationBody) => {
    // A save can land while a switch is still in flight; queue it rather than
    // dropping it, or the panel keeps describing the previous models.json.
    if (pendingRef.current) {
      queuedRef.current = { key, body };
      return;
    }
    pendingRef.current = key;
    setPending(key);
    setFailure(null);
    void (async () => {
      try {
        const res = await fetch("/api/models/enabled", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...body, ...(cwd ? { cwd } : {}) }),
        });
        const data = await res.json() as EnabledModelsView & { error?: string; reason?: string };
        if (!res.ok || data.error) {
          const messageKey = data.reason ? FAILURE_KEYS[data.reason] : undefined;
          setFailure(messageKey ? { messageKey } : { message: data.error ?? `HTTP ${res.status}` });
          return;
        }
        setView(data);
      } catch (error) {
        setFailure({ message: error instanceof Error ? error.message : String(error) });
      } finally {
        pendingRef.current = null;
        setPending(null);
        const queued = queuedRef.current;
        queuedRef.current = null;
        if (queued) mutateRef.current?.(queued.key, queued.body);
      }
    })();
  }, [cwd]);

  mutateRef.current = mutate;

  const setModels = useCallback((key: string, refs: string[], enabled: boolean) => {
    mutate(key, { op: "models", refs, enabled });
  }, [mutate]);

  const setProvider = useCallback((providerId: string, enabled: boolean) => {
    mutate(`provider:${providerId}`, { op: "provider", provider: providerId, enabled });
  }, [mutate]);

  const clearScope = useCallback(() => mutate("clear", { op: "clear" }), [mutate]);
  const pruneStale = useCallback(() => mutate("prune", { op: "prune" }), [mutate]);
  const refresh = useCallback(() => setReloadKey((key) => key + 1), []);
  // Resync writes and returns the fresh view, so it doubles as the reload
  // models.json needs after a save. The providers that are fully enabled right
  // now are the intent to preserve across whatever the save changed.
  const resync = useCallback((
    renames: { from: string; to: string }[],
    modelRenames: { from: string; to: string }[],
  ) => {
    const fullyEnabled = (view?.providers ?? [])
      .filter((provider) => provider.models.length > 0 && provider.enabledCount === provider.models.length)
      .map((provider) => provider.id);
    mutate("resync", { op: "resync", renames, modelRenames, fullyEnabled });
  }, [mutate, view]);

  return {
    view,
    loading,
    pending,
    failure,
    setModels,
    setProvider,
    clearScope,
    pruneStale,
    refresh,
    resync,
  };
}

/** Panel-wide note shown while `enabledModels` narrows the selector. */
export function EnabledModelsBanner({ controller }: { controller: EnabledModelsController }) {
  const { t } = useI18n();
  const { view, pending } = controller;
  if (!view) return null;
  const scoped = !view.allEnabled;
  const stale = view.stalePatterns.length;
  if (!scoped && stale === 0) return null;

  return (
    <div className="d-banner warn">
      {/* v5 D-10 状态行：设置文件路径 + enabledModels 计数都摆在台面上，长路径优先截断。 */}
      <code className="d-mono" title={view.settingsPath}>
        {view.settingsPath}
      </code>
      <code className="d-mono">
        {`· enabledModels ${view.enabledTotal}/${view.availableTotal}`}
        {stale > 0 && ` · ${t("models.enabledStale", { count: stale })}`}
      </code>
      <span className="d-grow" aria-hidden="true" />
      {view.editable && stale > 0 && (
        <button
          type="button"
          className="d-btn sm"
          onClick={controller.pruneStale}
          disabled={pending !== null}
          title={t("models.enabledPruneHint")}
        >
          {t("models.enabledPrune")}
        </button>
      )}
      {view.editable && scoped && (
        <button
          type="button"
          className="d-btn sm ghost"
          onClick={controller.clearScope}
          disabled={pending !== null}
          title={t("models.enabledClearHint")}
        >
          {t("models.enabledClear")}
        </button>
      )}
    </div>
  );
}

/**
 * The single switch a models.json provider gets, for its detail header next to
 * the provider's own buttons.
 *
 * Such a provider has no rows of its own — the panel edits its models directly
 * — so this switch is the whole control, and it is checked only while every one
 * of those models is enabled. Why it cannot move is a tooltip, not a paragraph.
 */
export function EnabledModelsProviderSwitch({
  providerId,
  controller,
}: {
  providerId: string;
  controller: EnabledModelsController;
}) {
  const { t } = useI18n();
  const { view, loading, pending, failure } = controller;
  const provider = findProviderView(view, providerId);
  const message = failure ? (failure.messageKey ? t(failure.messageKey) : failure.message) : null;

  if (loading && !view) return null;
  // Missing from the runtime: edits not saved yet, no models, or a key that
  // does not work — never a sign-in, so do not send the user looking for one.
  if (!provider) {
    return (
      <EnabledSwitch
        checked={false}
        disabled
        label={t("models.enabledCustomEmpty")}
        onChange={() => {}}
      />
    );
  }

  const toggle = enabledModelsProviderToggle(view, provider);
  return (
    <>
      {message && <span className="d-err">{message}</span>}
      <EnabledSwitch
        checked={toggle.checked}
        loading={pending === `provider:${provider.id}`}
        disabled={pending !== null || toggle.blocked}
        label={toggle.reason
          ? t(FAILURE_KEYS[toggle.reason])
          : t("models.enabledProviderToggle", { provider: provider.name })}
        onChange={(checked) => controller.setProvider(provider.id, checked)}
      />
    </>
  );
}

/** Per-model switches for a provider that owns its own model list. */
/**
 * State for the "refresh catalog" button.
 *
 * pi's built-in model lists are frozen at the SDK version pi-web pins, so a
 * model a provider shipped after that release only appears once the pi.dev
 * catalog overlay has been fetched — see `lib/model-catalog-refresh.ts` (#914).
 * The button is the whole feature: nothing refreshes catalogs on its own.
 */
function useCatalogRefresh(providerId: string, onChanged: () => void) {
  const [refreshing, setRefreshing] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  // A note describes the provider it was produced for, never the next one.
  useEffect(() => setNote(null), [providerId]);

  const refresh = useCallback(() => {
    setRefreshing(true);
    setNote(null);
    void (async () => {
      try {
        const res = await fetch("/api/models/refresh", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ provider: providerId }),
        });
        const data = await res.json() as CatalogRefreshResponse;
        if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
        if (data.reason === "offline") setNote("models.catalogOffline");
        // Prefer "updated" over "unreachable" when the live merge landed even
        // though one catalog half failed — the list the user asked for moved.
        else if (data.changed) setNote("models.catalogUpdated");
        else if (!data.completed) setNote("models.catalogUnreachable");
        else setNote("models.catalogUnchanged");
        // Reload even when nothing moved for this provider: the pass may have
        // updated another one, and a stale panel is worse than a second read.
        if (data.changed) onChanged();
      } catch {
        setNote("models.catalogUnreachable");
      } finally {
        setRefreshing(false);
      }
    })();
  }, [providerId, onChanged]);

  return { refreshing, note, refresh };
}

export function EnabledModelsSection({
  providerId,
  controller,
}: {
  providerId: string;
  controller: EnabledModelsController;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const { view, loading, pending, failure } = controller;
  const provider = findProviderView(view, providerId);
  const catalog = useCatalogRefresh(providerId, controller.refresh);

  useEffect(() => setQuery(""), [providerId]);

  if (loading && !view) {
    return <div className="d-t-xs d-t-faint">{t("agents.modelsLoading")}</div>;
  }
  if (!provider) {
    return failure?.message
      ? <div className="d-err">{failure.message}</div>
      : <div className="d-t-xs d-t-faint">{t("models.enabledUnavailable")}</div>;
  }

  const shown = filterEnabledModels(provider.models, query);
  const bulk = enabledModelsBulkActions(view, shown);
  const filtered = shown.length !== provider.models.length;
  const busy = pending !== null;
  const bulkKey = `provider:${provider.id}`;
  // A provider-wide action is resolved server-side so models the browser has
  // not seen yet follow it too; a filtered action names its rows explicitly.
  const runBulk = (enabled: boolean, refs: string[]) => {
    if (filtered) controller.setModels(bulkKey, refs, enabled);
    else controller.setProvider(provider.id, enabled);
  };

  /* fork:v5-landing —— 换成画板 D-10 的「可用模型」DOM：`d-set-sec` 分节 +
     `d-card > d-table` 数据表 + `d-switch` 行内开关；thinking 钉不再自绘徽章，
     直接进表列（画板 D-10 帧 A 的「thinking 钉」列）。绑定与状态机一概不动。 */
  return (
    <div className="d-set-sec">
      <div className="d-row">
        <div className="d-set-sec-t">{t("models.enabledSection")}</div>
        <span className="d-badge mute">
          {t("models.enabledCount", { enabled: provider.enabledCount, total: provider.models.length })}
        </span>
        <span className="d-grow" aria-hidden="true" />
        <button
          type="button"
          className="d-btn sm"
          disabled={busy || !bulk.canEnable}
          onClick={() => runBulk(true, bulk.enableRefs)}
        >
          {filtered ? t("models.enableShown") : t("models.enableAll")}
        </button>
        <button
          type="button"
          className="d-btn sm"
          disabled={busy || !bulk.canDisable}
          title={!bulk.canDisable && bulk.disableRefs.length > 0 ? t("models.enabledLastModel") : undefined}
          onClick={() => runBulk(false, bulk.disableRefs)}
        >
          {filtered ? t("models.disableShown") : t("models.disableAll")}
        </button>
        <button
          type="button"
          className="d-btn sm ghost"
          disabled={busy || catalog.refreshing}
          title={t("models.refreshCatalogHint")}
          onClick={catalog.refresh}
        >
          {catalog.refreshing ? t("models.refreshingCatalog") : t("models.refreshCatalog")}
        </button>
      </div>

      {catalog.note && <div className="d-banner">{t(catalog.note)}</div>}

      {!view?.editable && <div className="d-banner warn">{t("models.enabledProjectScope")}</div>}
      {failure && (
        <div className="d-banner err">
          {failure.messageKey ? t(failure.messageKey) : failure.message}
        </div>
      )}

      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={t("models.enabledFilterPlaceholder", { count: provider.models.length })}
        aria-label={t("models.enabledFilter")}
        className="d-input d-mono"
        style={{ maxWidth: 260 }}
      />

      <div className="d-card">
        <table className="d-table">
          <thead>
            <tr>
              <th>{t("models.availableModels")}</th>
              <th>{t("models.thinkingLevelMap")}</th>
              <th aria-hidden="true"></th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 ? (
              <tr><td colSpan={3}><span className="d-t-xs d-t-faint">{t("models.enabledNoMatches")}</span></td></tr>
            ) : shown.map((model) => {
              const lastOne = isLastEnabledModel(view, model);
              return (
                <tr key={model.ref}>
                  <td>
                    <div className="d-col">
                      <span className="d-t-b">{model.name}</span>
                      <span className="d-mono d-t-xs d-t-faint">{model.id}</span>
                    </div>
                  </td>
                  <td>
                    {model.thinkingPin
                      ? <span className="d-mono d-t-xs" title={t("models.enabledPinHint")}>{model.thinkingPin}</span>
                      : <span className="d-t-xs d-t-faint">—</span>}
                  </td>
                  <td>
                    <EnabledSwitch
                      checked={model.enabled}
                      loading={pending === model.ref}
                      disabled={busy || !view?.editable || lastOne}
                      label={lastOne
                        ? t("models.enabledLastModel")
                        : t("models.enabledToggle", { model: model.name })}
                      onChange={(checked) => controller.setModels(model.ref, [model.ref], checked)}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

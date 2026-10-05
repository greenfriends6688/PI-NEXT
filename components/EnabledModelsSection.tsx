// fork:enabled-models — upstream-port marker
"use client";

/* fork:models-picker + 形态收敛（2026-10-06）——
   模型页改成参考项目（pi-web-main）那一版之后，这一文件只剩三件事：
   **数据**（`useEnabledModels`：读 `/api/models/enabled`，串行化每一次写）、
   **供应商查找的纯 helper**、**目录刷新按钮的状态机**。
   逐模型开关现在长在供应商页的模型行上（与参考项目一致），供应商页没有第二份
   「可用模型」表：同一个开关出现在两个地方才是真正会让人改错的那份重复。 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { EnabledModelsView } from "@/lib/enabled-models";

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
  /** Picker's "just these": write the whole list in one call (first-time setup). */
  replaceModels: (refs: string[]) => void;
  clearScope: () => void;
  pruneStale: () => void;
  /** Re-read after models.json changed under the panel. */
  refresh: () => void;
}

type MutationBody =
  | { op: "models"; refs: string[]; enabled: boolean }
  | { op: "replace"; refs: string[] }
  | { op: "clear" }
  | { op: "prune" };

const FAILURE_KEYS: Record<string, string> = {
  "last-model": "models.enabledLastModel",
  "project-scope": "models.enabledProjectScope",
};

/**
 * Model switches backed by pi's `enabledModels` setting.
 *
 * Every switch writes through `/api/models/enabled` right away, like the login
 * controls in the same panel and unlike the models.json editor around them,
 * which buffers until Save. Requests are serialized: each one is a
 * read-modify-write of one settings key, so overlapping edits from the same
 * panel could otherwise lose one of them.
 */
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

  const replaceModels = useCallback((refs: string[]) => {
    mutate("replace", { op: "replace", refs });
  }, [mutate]);

  const clearScope = useCallback(() => mutate("clear", { op: "clear" }), [mutate]);
  const pruneStale = useCallback(() => mutate("prune", { op: "prune" }), [mutate]);
  const refresh = useCallback(() => setReloadKey((key) => key + 1), []);

  return {
    view,
    loading,
    pending,
    failure,
    setModels,
    replaceModels,
    clearScope,
    pruneStale,
    refresh,
  };
}

/**
 * pi's built-in model lists are frozen at the SDK version pi-web pins, so a
 * model a provider shipped after that release only appears once the catalog
 * overlay has been fetched — see `lib/model-catalog-refresh.ts` (#914). The
 * button is the whole feature: nothing refreshes catalogs on its own.
 */
export function useCatalogRefresh(providerId: string, onChanged: () => void) {
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

// fork:deferred-providers（上游 a13626794 / #1071，2026-10-08）——
// pi-web 每次列模型都新建一个 ModelRuntime，而**从不启动会话**。有些扩展只在进程里
// 第一个 runtime 注册自己的 provider，之后的 runtime 把注册推迟到 `session_start`
// （pi-claude-bridge 就是：子代理共用父会话的 registry，不能在父会话上覆盖 stream 函数）。
// 于是第一次列举之后，这些 provider 从模型选择器里消失，也无法用它们的模型开会话。
//
// 这里把每个 runtime 见过的模型按 provider 记在 globalThis 上；后续 runtime 若
// **完全没注册**该 provider，就把记下的模型补回去。已经注册但用不了的（登出 / 没 key）
// 不补——只补「还没发生的那次注册」。
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { invalidateModelsCache } from "./models-cache";

type RuntimeModel = Awaited<ReturnType<ModelRuntime["getAvailable"]>>[number];

declare global {
  var __piWebProviderModelCatalog: Map<string, RuntimeModel[]> | undefined;
}

function catalog(): Map<string, RuntimeModel[]> {
  globalThis.__piWebProviderModelCatalog ??= new Map();
  return globalThis.__piWebProviderModelCatalog;
}

/** Record what a runtime offers, so later runtimes can show a provider they have not registered yet. */
export async function rememberProviderModels(runtime: ModelRuntime): Promise<void> {
  const byProvider = new Map<string, RuntimeModel[]>();
  for (const model of await runtime.getAvailable()) {
    byProvider.set(model.provider, [...(byProvider.get(model.provider) ?? []), model]);
  }
  const added = [...byProvider.keys()].some((provider) => !catalog().has(provider));
  for (const [provider, models] of byProvider) catalog().set(provider, models);
  // A listing cached before this provider was known would hide it for the cache lifetime.
  if (added) invalidateModelsCache();
}

/**
 * Remembered models of providers this runtime does not know at all. A provider the runtime
 * registered but cannot use (signed out, no key) is never added back: only a registration that
 * has not happened yet in this runtime is filled in.
 */
export function deferredProviderModels(runtime: ModelRuntime): RuntimeModel[] {
  const registered = new Set(runtime.getModels().map((model) => model.provider));
  return [...catalog()].flatMap(([provider, models]) => (registered.has(provider) ? [] : models));
}

/** The runtime as a model listing should see it: its own available models plus deferred ones. */
export function withDeferredProviderModels(runtime: ModelRuntime): ModelRuntime {
  return new Proxy(runtime, {
    get(target, property, receiver) {
      if (property === "getAvailable") {
        return async (...args: Parameters<ModelRuntime["getAvailable"]>) => {
          const [providerId] = args;
          const deferred = deferredProviderModels(target).filter((model) => !providerId || model.provider === providerId);
          return [...await target.getAvailable(...args), ...deferred];
        };
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

/** A remembered model whose provider this runtime has not registered yet. */
export function findDeferredModel(runtime: ModelRuntime, provider: string, modelId: string): RuntimeModel | undefined {
  return deferredProviderModels(runtime).find((model) => model.provider === provider && model.id === modelId);
}

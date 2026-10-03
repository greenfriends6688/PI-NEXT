// fork:proma-43-automation —— 装配真实依赖后的调度器单例。
/**
 * `automation-scheduler.ts` 里的调度器是「纯的」：时钟、存储、agent 运行口、翻译都靠注入。
 * 这个文件把那四个依赖接到真实实现上，并保证全进程只有一个调度器。
 *
 * ## 启动钩子（instrumentation-node.ts —— 主仓有人在改，本 PR 不动它）
 *
 * 在 instrumentation-node.ts 已有的 `register()` **异步体内**加一行：
 *
 * ```ts
 * const { startAutomationScheduler } = await import("@/lib/automation-runtime");
 * startAutomationScheduler();
 * ```
 *
 * 三条要求：
 *   · 放在 `register()` 里（Next 在那里 await 完才放行第一个请求），别放在模块顶层；
 *   · 内部已 try/catch —— 定时任务起不来不该把整个应用带崩（没有定时任务 Pi Web 完全能用），
 *     但会把原因打进日志，避免用户只看到「任务一直没跑」却毫无线索；
 *   · `NEXT_RUNTIME !== "nodejs"` 时直接 return（本文件里有这道闸，调用方不必重复判断）。
 *
 * 关闭钩子（`process.on("exit")` / Electron 的 `before-quit`）由接线方决定，
 * `stopAutomationScheduler()` 已经备好。
 */
import { translateMessage } from "@/lib/i18n/format";
import { enLocale } from "@/lib/i18n/messages/en";
import { zhCNLocale } from "@/lib/i18n/messages/zh-CN";
import { zhTWLocale } from "@/lib/i18n/messages/zh-TW";
import type { Automation } from "./automation-types";
import { createRpcAutomationRunner } from "./automation-runner";
import {
  createAutomationScheduler,
  getAutomationScheduler,
  registerAutomationScheduler,
  type AutomationRunPort,
  type AutomationTranslate,
} from "./automation-scheduler";
import {
  AutomationStoreReadError,
  getAutomation,
  listAutomations,
  saveAutomation,
} from "./automation-store";

/** 注入给 agent 的说明句用**任务自己**的语言：面板里切了语言，agent 读到的也是同一种。 */
const translate: AutomationTranslate = (automation, key, params) =>
  translateMessage(
    automation.locale ?? "en",
    key,
    { en: enLocale.messages, "zh-CN": zhCNLocale.messages, "zh-TW": zhTWLocale.messages },
    params,
  );

let runner: AutomationRunPort | null = null;
function getRunner(): AutomationRunPort {
  runner ??= createRpcAutomationRunner();
  return runner;
}

/** 起调度器（幂等）。返回是否真的起来了。 */
export function startAutomationScheduler(): boolean {
  if (process.env.NEXT_RUNTIME !== undefined && process.env.NEXT_RUNTIME !== "nodejs") return false;
  if (getAutomationScheduler()?.isStarted()) return true;

  try {
    // 先探一次存储：坏文件要在起定时器之前报出来，否则 tick 里每 30s 抛一次。
    listAutomations();
  } catch (error) {
    console.error(
      "[automation] store unreadable, scheduler not started:",
      error instanceof AutomationStoreReadError ? error.message : error,
    );
    return false;
  }

  const scheduler = createAutomationScheduler({
    now: () => Date.now(),
    store: {
      list: () => listAutomations(),
      get: (id: string) => getAutomation(id),
      save: (automation: Automation) => saveAutomation(automation),
    },
    runner: getRunner(),
    translate,
    log: (message) => console.log(message),
    /* 30s 的 tick 不许吊住进程：`instrumentation-node.ts` 里那个 30s tick 是
       全进程唯一一个长驻定时器（Next 的关闭路径靠 `process.exit()`，Electron 与
       lan-supervisor 的重启则靠事件循环排空），不 unref 的话它就是「进程退不掉」
       的头号嫌疑。运行期的 2h 超时 timer 调度器自己已经 unref 了。 */
    timer: {
      setInterval: (callback, ms) => {
        const handle = setInterval(callback, ms);
        handle.unref?.();
        return handle;
      },
      clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
    },
  });
  scheduler.start();
  registerAutomationScheduler(scheduler);
  return true;
}

export function stopAutomationScheduler(): void {
  getAutomationScheduler()?.stop();
  registerAutomationScheduler(null);
}

/** 面板读到的运行态。 */
export function getAutomationSchedulerStatus(): {
  started: boolean;
  activeRunIds: string[];
} {
  const scheduler = getAutomationScheduler();
  return {
    started: scheduler?.isStarted() ?? false,
    activeRunIds: scheduler?.activeRunIds() ?? [],
  };
}

/** 手动「立即运行一次」。调度器没起时先把它拉起来。 */
export async function runAutomationNow(id: string): Promise<void> {
  if (!getAutomationScheduler()?.isStarted()) startAutomationScheduler();
  const scheduler = getAutomationScheduler();
  if (!scheduler) throw new Error("automation scheduler is not available");
  await scheduler.runNow(id);
}
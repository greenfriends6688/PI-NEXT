/**
 * fork:proma-44-planning —— 提醒调度的**驱动器**（短 tick，判定在 planning-reminders.ts）。
 *
 * 与 PR-43 的自动化调度器**刻意不共用**：那边跑的是「定时开一条 agent 会话」，
 * 有队列 / 失败退避 / 无人值守权限 / 防雪崩顺延。这里是「到点弹一条应用内提醒」，
 * 一次性的、没有长任务、失败也不该退避（提醒不是任务，重试三次只会让人关掉它）。
 * 两边唯一的共同点是「短 tick 而不是长 `setInterval`」—— 系统休眠回来长定时器
 * 会漂到不可预期的时刻。
 *
 * 30 秒一 tick：提醒的最小可感知精度是分钟级，30 秒足够，空闲时几乎不耗电。
 * timer `unref()`，别让它把 Next 进程钉住。
 *
 * **读与写回都是注入的**（`collect` / `markNotified`），所以这个文件不含 `fs`：
 * 读盘那半在 `app/api/planning/scheduler-server.ts`（服务端），调度器本体因此可以
 * 被任何一边 import 而不会把 `node:fs` 拖进客户端依赖图 ——
 * `lib/client-graph-purity.test.mjs` 会拦那种事。
 *
 * 谁启动它：`app/api/planning/reminders` 路由（模块级单例）。所以提醒 tick 的
 * 生命周期 = 「有人正在看工作区」的时长，关掉工作区就停 —— 不引 Web Push /
 * 通知权限那一整套，见 docs/patches/0004-planning.md。
 */

import type { DisplayReminder } from "./planning-reminders";

export const PLANNING_REMINDER_TICK_MS = 30_000;

export interface ReminderSchedulerDeps {
  now?: () => number;
  setIntervalFn?: (handler: () => void, ms: number) => { unref?: () => void };
  clearIntervalFn?: (handle: { unref?: () => void }) => void;
  /** 取到要通知的那一批（生产读盘，见 scheduler-server.ts）。 */
  collect: (now: number) => Promise<DisplayReminder[]>;
  /** 记下「已通知」，避免下一 tick 重复弹。 */
  markNotified: (ids: string[], now: number) => Promise<void>;
  /** 通知出口。生产不传（通知由前端轮询拉走），测试传它来断言「响过哪几条」。 */
  onFire?: (items: DisplayReminder[]) => void;
}

export interface ReminderSchedulerHandle {
  /** 立刻跑一轮（不等待 tick），测试与首屏都用它。 */
  tick: () => Promise<void>;
  stop: () => void;
}

let running: ReminderSchedulerHandle | null = null;

/**
 * 启动提醒 tick。重复调用返回同一个 handle —— 模块级单例，避免 Next 热重载
 * 造出第二个 tick 循环（两轮会让同一条提醒被记两次通知）。
 */
export function startPlanningReminderScheduler(deps: ReminderSchedulerDeps): ReminderSchedulerHandle {
  if (running) return running;

  const now = deps.now ?? (() => Date.now());
  const setIntervalFn = deps.setIntervalFn
    ?? ((handler: () => void, ms: number) => setInterval(handler, ms));
  const clearIntervalFn = deps.clearIntervalFn
    ?? ((handle: { unref?: () => void }) => clearInterval(handle as unknown as NodeJS.Timeout));
  const onFire = deps.onFire;

  const tick = async () => {
    const at = now();
    let items: DisplayReminder[];
    try {
      items = await deps.collect(at);
    } catch (error) {
      console.warn("[planning] 提醒 tick 读取失败：", error);
      return;
    }
    if (items.length === 0) return;
    try {
      await deps.markNotified(items.map((item) => item.reminder.id), at);
    } catch (error) {
      // 记不住「响过了」就别弹：否则下一轮会再弹一次，用户关不掉。
      console.warn("[planning] 提醒 tick 写回失败：", error);
      return;
    }
    onFire?.(items);
  };

  const handle = setIntervalFn(() => { void tick(); }, PLANNING_REMINDER_TICK_MS);
  handle.unref?.();
  running = {
    tick,
    // stop 顺手把单例位清掉：否则 stop 之后再 start 会拿回一个已经没有定时器的
    // handle（tick 能用，但间隔器已经没了），看起来像「提醒不响了」。
    stop: () => { clearIntervalFn(handle); running = null; },
  };
  return running;
}

export function stopPlanningReminderScheduler(): void {
  running?.stop();
  running = null;
}

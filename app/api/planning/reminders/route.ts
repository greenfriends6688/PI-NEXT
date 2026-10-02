import { NextRequest, NextResponse } from "next/server";
import { isApiRequestAllowed } from "@/lib/request-security";
import { readPlanningState } from "@/lib/planning-store";
import { displayReminders } from "@/lib/planning-reminders";
import { ensurePlanningReminderScheduler } from "../scheduler-server";

export const dynamic = "force-dynamic";

/**
 * fork:proma-44-planning —— 提醒条的数据接口（只读）。
 *
 *   GET /api/planning/reminders?horizon=<ms>  -> { reminders, now }
 *
 * 提醒条在工作区开着时 poll 这个接口，`horizon` 默认 24 小时：提醒条要**预告**，
 * 不预告的话用户早上打开工作区根本不知道下午有事（Proma 的
 * `ActivePlanningReminder` 是同一口径）。
 *
 * 真正的「到点触发」在服务端 tick（`lib/planning-reminder-scheduler.ts`），它只
 * 负责把 `lastNotifiedAt` 记上；通知的落地由这里的前端轮询完成 —— 不引入 Web
 * Push / 通知权限那一整套。**关着工作区就收不到提醒**，这是刻意的取舍。
 *
 * 「响过没有」由 `lastNotifiedAt` 表达，所以同一个 30 秒 tick 里 `due` 为 true
 * 但 `notified` 也为 true 的那些，是「已经响过、用户还没确认」的，不该再弹一次。
 */

const DEFAULT_HORIZON_MS = 24 * 60 * 60_000;
const MAX_HORIZON_MS = 7 * 24 * 60 * 60_000;

export async function GET(request: NextRequest) {
  if (!isApiRequestAllowed(request)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  // 顺带把服务端的提醒 tick 起起来：工作区开着时这个路由每 30 秒被拉一次，
  // 于是 tick 的生命周期恰好等于「有人正在看工作区」。授权过了才起 —— 不然一个
  // 跨站请求就能在别人的机器上挂一个定时器。
  ensurePlanningReminderScheduler();
  const raw = Number(new URL(request.url).searchParams.get("horizon"));
  const horizon = Number.isFinite(raw) && raw > 0 ? Math.min(raw, MAX_HORIZON_MS) : DEFAULT_HORIZON_MS;
  try {
    const now = Date.now();
    return NextResponse.json(
      { reminders: displayReminders(readPlanningState(), now, horizon), now },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

/**
 * fork:mobile-shell —— 通知在场裁决（抄 Paseo `agent-attention-policy.ts` 的语义，不抄代码）。
 *
 * 现在 `notifySessionComplete()` 把 Web Push 无差别推给**所有**订阅设备：你在电脑前
 * 盯着它跑，手机也响；反过来你在手机上看，电脑也响。这个纯函数把「该不该推」变成
 * 三态裁决，判据是**用户最近有没有交互**（不是「标签页活着」——桌面 Chrome 常驻
 * 在线不能让手机永远哑掉，那只是把噪音换了个方向）：
 *
 * - 任一客户端最近 `thresholdMs` 内有交互、且正聚焦**这个**会话 → 它就在看结果，谁都不推；
 * - 任一客户端最近有交互（哪怕在看别的会话/别的应用）→ 有人在场，未读点 + 完成音
 *   已经是在场提醒，不再推推送；
 * - 全部客户端交互都已陈旧（电脑睡了/人走了/手机锁屏挂起）→ 推。
 *
 * 前台路径（SSE → 完成音/未读标记）不受影响——那些本来就是在场信号。
 */

export const PRESENCE_THRESHOLD_MS = 180_000;

/** 与 `lib/presence-store.ts` 的条目同形；type-only 引用，本模块保持零依赖。 */
export interface PresenceClient {
  clientId: string;
  appVisible: boolean;
  focusedSessionId: string | null;
  /** 用户最近一次交互（点击/按键/滚轮/回到前台）的时间；null = 从未交互过。 */
  lastActivityAtMs: number | null;
}

export type NotificationPlanReason = "focused" | "present" | "no-presence";

export interface NotificationPlan {
  shouldPush: boolean;
  reason: NotificationPlanReason;
  presentClientIds: string[];
}

export function computeNotificationPlan({
  clients,
  sessionId,
  nowMs,
  thresholdMs = PRESENCE_THRESHOLD_MS,
}: {
  clients: PresenceClient[];
  sessionId: string;
  nowMs: number;
  thresholdMs?: number;
}): NotificationPlan {
  const present: PresenceClient[] = [];
  for (const client of clients) {
    // 心跳可能报来未来时间（设备时钟漂移）：按「刚刚交互」算，别让它变成负年龄被误判。
    if (client.lastActivityAtMs === null) continue;
    const age = nowMs - Math.min(client.lastActivityAtMs, nowMs);
    if (age <= thresholdMs) present.push(client);
  }

  if (
    sessionId != null
    && present.some((c) => c.appVisible && c.focusedSessionId === sessionId)
  ) {
    return {
      shouldPush: false,
      reason: "focused",
      presentClientIds: present.map((c) => c.clientId),
    };
  }
  if (present.length > 0) {
    return {
      shouldPush: false,
      reason: "present",
      presentClientIds: present.map((c) => c.clientId),
    };
  }
  return { shouldPush: true, reason: "no-presence", presentClientIds: [] };
}

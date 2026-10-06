/**
 * fork:mobile-shell —— 壳内运行时桥：本地通知 / 角标 / 通知点击深链 / 系统返回键。
 *
 * WebView 里拿不到 Web Push subscription（方案 D5），通知走 `@capacitor/local-notifications`
 * 原生本地通知（**无云推送**：App 进程活着才响；进程被杀场景走 IM 桥）。
 * 全部经 `nativePluginCall` 低层通道调用壳里的插件，主仓不打包任何 @capacitor 依赖。
 */

import { isMobileShell, nativeCallback, nativePluginCall, popNativeBackStack } from "./mobile-shell";
import { setMobileNotifyProvider } from "./browser-notifications";

// 本文件被加载（AppShell 的壳运行时 effect 动态 import）即登记壳内通知层——
// browser-notifications 保持零导入，这里反向注册（见该文件的 mobileNotifyProvider 注释）。
setMobileNotifyProvider((payload) => notifyMobileNative(payload));

const NOTIFICATION_ID_MAX = 2_147_483_647;

interface NotificationPayload {
  title: string;
  body: string;
  tag?: string;
  url: string;
}

/** 从 sessionUrl（`/?session=<id>`）取会话 id，供通知点击深链。 */
export function sessionIdFromUrl(url: string): string | null {
  try {
    return new URL(url, "http://localhost").searchParams.get("session");
  } catch {
    return null;
  }
}

/** 纯函数：schedule 的请求体（测试锁形状）。 */
export function scheduleNotificationArgs(payload: NotificationPayload): {
  notifications: Array<Record<string, unknown>>;
} {
  return {
    notifications: [
      {
        id: Date.now() % NOTIFICATION_ID_MAX,
        title: payload.title,
        body: payload.body,
        extra: {
          sessionId: sessionIdFromUrl(payload.url),
        },
      },
    ],
  };
}

let permissionRequest: Promise<boolean> | null = null;

function requestNotificationPermission(): Promise<boolean> {
  permissionRequest ??= nativePluginCall<{ display?: string }>(
    "LocalNotifications",
    "requestPermissions",
  ).then((result) => {
    const display = result?.display;
    return display == null || display === "granted" || display === "prompt";
  });
  return permissionRequest;
}

/**
 * 发一条本地通知 + 角标 +1。失败（无壳/权限拒绝/插件缺失）resolve false，
 * 调用方（browser-notifications 的三层链）自然回落到下一层。
 */
export async function notifyMobileNative(payload: NotificationPayload): Promise<boolean> {
  if (!isMobileShell()) return false;
  if (!(await requestNotificationPermission())) return false;
  const args = scheduleNotificationArgs(payload);
  const result = await nativePluginCall("LocalNotifications", "schedule", args);
  if (result == null) return false;
  await nativePluginCall("Badge", "increase");
  return true;
}

/**
 * 壳运行时初始化（AppShell 挂载时调一次，非壳 no-op）：
 * - 通知点击 → 深链回会话（`/?session=<id>`，AppShell 的导航本来就认它）；
 * - 回前台 → 清角标；
 * - Android 系统返回键 → 返回栈（面板先关）→ WebView 历史 → 退到后台。
 */
export function initMobileShellRuntime(): void {
  if (!isMobileShell() || typeof document === "undefined") return;

  nativeCallback(
    "LocalNotifications",
    "localNotificationActionPerformed",
    (data: unknown) => {
      const extra = (data as { notification?: { extra?: { sessionId?: string } } } | undefined)
        ?.notification?.extra;
      if (!extra?.sessionId) return;
      // 同源站内导航，next lint 的路由规则不适用。
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign(`/?session=${encodeURIComponent(extra.sessionId)}`);
    },
  );

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      void nativePluginCall("Badge", "clear");
    }
  });

  nativeCallback("App", "backButton", (data: unknown) => {
    const payload = data as { canGoBack?: boolean } | undefined;
    if (popNativeBackStack()) return;
    if (payload?.canGoBack) {
      window.history.back();
      return;
    }
    void nativePluginCall("App", "exitApp");
  });
}

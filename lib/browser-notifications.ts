import type { BlockingExtensionUiRequest, ExtensionUiRequest } from "./types";

interface WindowNotificationLike {
  onclick: Notification["onclick"];
  close: () => void;
}

interface ServiceWorkerRegistrationLike {
  showNotification: (title: string, options?: NotificationOptions) => Promise<void>;
}

export interface BrowserNotificationEnvironment {
  createWindowNotification: (title: string, options?: NotificationOptions) => WindowNotificationLike;
  getServiceWorkerRegistration: (() => Promise<ServiceWorkerRegistrationLike | undefined>) | null;
  /**
   * fork:desktop-shell — the Electron bridge, when present. Native notifications are
   * the only delivery that shows up while the window is hidden *and* carries the app's
   * own name/icon, so they are tried first when available.
   */
  nativeNotify?: (payload: { title: string; body: string; tag?: string; url: string }) => Promise<boolean>;
}

export interface BrowserNotificationOptions {
  title: string;
  body: string;
  sessionUrl: string;
  onClick: () => void;
  tag?: string;
}

export type NotificationDelivery = "native" | "service-worker" | "window" | null;

type DocumentAttentionState = Pick<Document, "visibilityState" | "hasFocus">;

export function shouldShowBrowserNotification(
  attentionState: DocumentAttentionState = document,
): boolean {
  return attentionState.visibilityState !== "visible" || !attentionState.hasFocus();
}

export function isBlockingExtensionUiRequest(
  request: ExtensionUiRequest,
): request is BlockingExtensionUiRequest {
  switch (request.method) {
    case "select":
    case "confirm":
    case "input":
    case "editor":
      return true;
    case "custom":
      return request.closed !== true;
    default:
      return false;
  }
}

export function claimExtensionAttentionNotification(
  request: ExtensionUiRequest,
  notifiedRequestIds: Set<string>,
): request is BlockingExtensionUiRequest {
  if (!isBlockingExtensionUiRequest(request) || notifiedRequestIds.has(request.id)) return false;
  notifiedRequestIds.add(request.id);
  return true;
}

/**
 * fork:mobile-shell — 壳内原生通知的 provider（`lib/mobile-notify.ts` 导入时登记）。
 * 本文件必须保持**零相对导入**（上面的 `node --test` 解析器注释）：所以壳的接入是
 * 注册式而不是 import 式。provider 自己负责 isMobileShell 判定与失败回落。
 */
type MobileNotifyProvider = (payload: { title: string; body: string; tag?: string; url: string }) => Promise<boolean>;
let mobileNotifyProvider: MobileNotifyProvider | null = null;

export function setMobileNotifyProvider(provider: MobileNotifyProvider): void {
  mobileNotifyProvider = provider;
}

function getBrowserEnvironment(): BrowserNotificationEnvironment {
  // Read the bridge straight off `window` (structurally typed): importing
  // lib/desktop-shell here would add a runtime module dependency that the plain
  // `node --test` resolver cannot follow, and this file is otherwise dependency-free.
  const bridge = typeof window !== "undefined"
    ? (window as { piWebDesktop?: { notify: (payload: { title: string; body: string; tag?: string; url: string }) => Promise<boolean> } }).piWebDesktop
    : undefined;
  if (bridge) {
    return {
      nativeNotify: (payload) => bridge.notify(payload),
      createWindowNotification: (title, options) => new Notification(title, options),
      getServiceWorkerRegistration: "serviceWorker" in navigator
        ? () => navigator.serviceWorker.getRegistration()
        : null,
    };
  }
  // fork:mobile-shell — 壳里 WebView 没有 Web Push subscription，本地通知是唯一原生层；
  // 点击深链由 initMobileShellRuntime 注册的 action 监听处理（onClick 同样不走）。
  const provider = mobileNotifyProvider;
  if (provider) {
    return {
      nativeNotify: (payload) => provider(payload),
      createWindowNotification: (title, options) => new Notification(title, options),
      getServiceWorkerRegistration: "serviceWorker" in navigator
        ? () => navigator.serviceWorker.getRegistration()
        : null,
    };
  }
  return {
    createWindowNotification: (title, options) => new Notification(title, options),
    getServiceWorkerRegistration: "serviceWorker" in navigator
      ? () => navigator.serviceWorker.getRegistration()
      : null,
  };
}

/**
 * fork:desktop-shell — prefer the native bridge when the app runs in Electron.
 *
 * The renderer's Web Notification API technically works in Electron too, but the
 * native path is what makes the notification appear under the app's own name/icon and
 * survive the window being hidden or unfocused — which is the only time this function
 * is called at all.
 */
export async function showBrowserNotification(
  options: BrowserNotificationOptions,
  environment: BrowserNotificationEnvironment = getBrowserEnvironment(),
): Promise<NotificationDelivery> {
  const notificationOptions: NotificationOptions = {
    body: options.body,
    ...(options.tag ? { tag: options.tag, renotify: true } : {}),
  };

  if (environment.nativeNotify) {
    try {
      const shown = await environment.nativeNotify({
        title: options.title,
        body: options.body,
        ...(options.tag ? { tag: options.tag } : {}),
        url: options.sessionUrl,
      });
      // The click is handled by the main process (it focuses the window and sends the
      // url back), so `options.onClick` is not called on this path.
      if (shown) return "native";
    } catch {
      // Fall through to the web deliveries.
    }
  }

  if (environment.getServiceWorkerRegistration) {
    try {
      const registration = await environment.getServiceWorkerRegistration();
      if (registration) {
        await registration.showNotification(options.title, {
          ...notificationOptions,
          data: { url: options.sessionUrl },
        });
        return "service-worker";
      }
    } catch {
      // Fall back to a page notification where the constructor is supported.
    }
  }

  try {
    const notification = environment.createWindowNotification(options.title, notificationOptions);
    notification.onclick = () => {
      notification.close();
      options.onClick();
    };
    return "window";
  } catch {
    // Most mobile browsers expose Notification but require service-worker delivery.
    return null;
  }
}

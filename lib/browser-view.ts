"use client";

/**
 * fork:proma-42-browser · **Web / Electron 的唯一分叉点**。
 *
 * 浏览器面板在两种宿主里长得不一样：
 *   · Web（本仓主战场）—— 只有一个 `<iframe>`。跨站页面发 `X-Frame-Options: DENY`
 *     或 `frame-ancestors` CSP 就空白，这是 Web 端的固有限制，改不了也不该为此把 Web 弄坏。
 *   · Electron —— 真正的浏览器视图（`WebContentsView`），由 `electron/browser-host.js` 管，
 *     profile 按会话隔离持久化在本机，CDP 可达，所以 agent 的 10 个原子工具才能驱动它。
 *
 * 因此本模块是**适配层**：对上层（`components/BrowserPanel.tsx`）只暴露
 * `surface` + 一组「尽力而为」的能力探测，绝不把 Electron 的 API 形状漏出去。
 * 组件里再也出现不了 `window.piWebDesktop?.` 这种分叉判断。
 *
 * 三条纪律：
 *   1. 判定必须是**同步、纯**的（首屏就要决定渲染 iframe 还是占位），所以不查网络；
 *   2. 宿主不在时一律退化成 `iframe`，绝不出现「Web 端白屏」这种回归；
 *   3. 所有宿主调用都包一层 `callHost`，失败返回 `{ ok: false, reason }` 而不是抛 ——
 *      渲染一个面板的失败不该变成一个未捕获异常。
 */

import { isDesktopShell } from "./desktop-shell";

/** 面板当前所处的宿主。 */
export type BrowserSurface = "iframe" | "managed";

export interface BrowserHostBridge {
  version: number;
  /** 桌面端注入；Web 端是 undefined。 */
  browser?: {
    /** 面板可见性变化时告诉主进程「这个 session 在前台 / 在后台」。 */
    setPresentation?: (sessionId: string, visible: boolean) => void | Promise<void>;
    /** 把面板容器的屏幕坐标交给主进程，让 WebContentsView 精确贴上去。 */
    layout?: (sessionId: string, bounds: { x: number; y: number; width: number; height: number }) => void | Promise<void>;
    /** 当前地址栏 / 标签状态（宿主侧的真页面状态）。 */
    getState?: (sessionId: string) => Promise<unknown>;
  };
}

function hostBridge(): BrowserHostBridge | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { piWebDesktop?: BrowserHostBridge }).piWebDesktop ?? null;
}

/**
 * 当前宿主。`managed` 需要两件事同时成立：在桌面壳里，**并且**主进程真的注册了
 * browser 控制面（接线在集成时加，见 electron/browser-host.js 头部注释）。
 * 少任何一条都退化成 iframe —— 这是「别为了桌面壳把 Web 弄坏」的最后一道保险。
 */
export function detectBrowserSurface(): BrowserSurface {
  if (!isDesktopShell()) return "iframe";
  const bridge = hostBridge();
  return bridge?.browser ? "managed" : "iframe";
}

/** `true` 表示 agent 的 10 个原子工具在这个宿主里可用。 */
export function supportsManagedBrowser(): boolean {
  return detectBrowserSurface() === "managed";
}

/**
 * 桌面端用来切浏览器 profile 的会话标识。
 *
 * 优先用聊天会话 id（这样同一段对话里的多个浏览器标签共享 cookie —— 与真实浏览器的
 * 「同一个用户」一致）；拿不到就退回面板自己的 tab id，保证至少各面板互不串味。
 * **绝不**把用户目录、会话文件路径之类的敏感值拼进来：它会进 profile 分区的哈希输入。
 */
export function detectBrowserHostSessionId(sessionId: string | undefined, fallbackTabId?: string): string {
  const candidate = typeof sessionId === "string" ? sessionId.trim() : "";
  if (candidate) return `session:${candidate}`;
  return `panel:${fallbackTabId ?? "default"}`;
}

export type HostCallResult =
  | { ok: true; value: unknown }
  | { ok: false; reason: string };

/**
 * 把某个控制面方法收成一个统一签名的函数。
 *
 * 桥上的三个方法签名不同（`setPresentation(sessionId, visible)` / `layout(sessionId, box)`
 * / `getState(sessionId)`），而调用方只想用「方法名 + 参数数组」这一个形状。
 * 这里在**边界处**收敛一次：内部仍然按各自签名声明，外部只能传数组。
 */
function bridgeMethod(
  method: "setPresentation" | "layout" | "getState",
): ((...args: unknown[]) => unknown) | null {
  const fn = hostBridge()?.browser?.[method];
  return typeof fn === "function" ? fn as (...args: unknown[]) => unknown : null;
}

/**
 * 统一出口：能力缺失、被拒绝、抛错，一律变成 `{ ok: false, reason }`。
 * 组件据此渲染降级提示，而不是让异常冒到 React 树外面。
 */
export async function callBrowserHostBridge(
  method: "setPresentation" | "layout" | "getState",
  args: readonly unknown[],
): Promise<HostCallResult> {
  const fn = bridgeMethod(method);
  if (!fn) return { ok: false, reason: "当前宿主没有注册浏览器控制面。" };
  try {
    return { ok: true, value: await fn(...args) };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

/** 同步版本（layout / presentation 不需要返回值，抛错也不该打断渲染）。 */
export function notifyBrowserHostBridge(
  method: "setPresentation" | "layout",
  args: readonly unknown[],
): void {
  const fn = bridgeMethod(method);
  if (!fn) return;
  try {
    void fn(...args);
  } catch {
    /* 布局通知失败只影响贴图位置，不影响页面本身。 */
  }
}

/** 给 UI 的一句话：为什么这里是 iframe，以及 agent 工具为什么用不了。 */
export function browserSurfaceHint(surface: BrowserSurface, t: (key: string) => string): string {
  return surface === "managed" ? t("browser.managedActive") : t("browser.iframeFallbackHint");
}
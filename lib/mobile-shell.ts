/**
 * fork:mobile-shell —— 手机壳（Capacitor）探测与桥接。
 *
 * 形态裁定（docs/mobile-shell-plan-2026-10-05.md D1/D2）：壳是 Capacitor 的
 * `server.url` 远程加载，WebView 里的页面就是本 Web 应用本身。本模块是 Web 侧
 * 唯一的壳感知点：探测「我在不在壳里」、归一两边原生桥的形状、给壳专属行为
 * （SW 守卫、安全区覆盖、返回栈）一个家。
 *
 * 桌面浏览器 / PWA / Electron 上所有函数都是无害空转；只有壳里才激活。
 * 判据**不依赖打包**：Capacitor 原生层会向它加载的每个页面注入 `window.Capacitor`，
 * 包括 server.url 指到的远程源 —— 所以远端页面能直接探测，不需要单独的壳构建。
 */

/** Capacitor 注入的全局（nativePromise/nativeCallback 是免打包调原生插件的低层通道）。 */
interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  nativePromise?: (plugin: string, method: string, args?: unknown) => Promise<unknown>;
  /** 注册持久事件监听（如 LocalNotifications 的点击、App 的返回键）。 */
  nativeCallback?: (plugin: string, method: string, callback: (data: unknown) => void) => void;
}

function capacitorGlobal(): CapacitorGlobal | null {
  if (typeof window === "undefined") return null;
  const capacitor = (window as { Capacitor?: CapacitorGlobal }).Capacitor;
  return capacitor ?? null;
}

/**
 * 我在不在手机壳里。主判据是 Capacitor 桥（Android/iOS 都注入）；
 * UA 的 `; wv)` 只是 Android WebView 的兜底（防桥注入时序的窗口期），
 * 桌面浏览器与 Electron 的 UA 永远不含它。
 */
export function isMobileShell(): boolean {
  const capacitor = capacitorGlobal();
  if (capacitor?.isNativePlatform?.()) return true;
  if (typeof navigator === "undefined") return false;
  return /\); wv\)/.test(navigator.userAgent ?? "");
}

/**
 * 调一个原生插件（不经 npm 包，走注入桥的低层通道）。
 * 不在壳里、插件缺失、调用失败 → 一律 resolve null，调用方按「无此能力」降级。
 */
export async function nativePluginCall<T>(
  plugin: string,
  method: string,
  args?: unknown,
): Promise<T | null> {
  const capacitor = capacitorGlobal();
  if (!capacitor?.nativePromise) return null;
  try {
    return ((await capacitor.nativePromise(plugin, method, args)) as T) ?? null;
  } catch {
    return null;
  }
}

/** 注册原生插件事件监听（持久）；无桥时静默忽略。 */
export function nativeCallback(
  plugin: string,
  method: string,
  callback: (data: unknown) => void,
): void {
  capacitorGlobal()?.nativeCallback?.(plugin, method, callback);
}

// ---- 安全区 ----------------------------------------------------------------

export interface ShellInsets {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
}

/**
 * 把壳测到的真实 insets 写进 `--safe-*`（globals.css :root 的定义是唯一真值，
 * 桌面上值恒为 env() 本身；安卓 WebView 里 env() 失效，只有这里能给出真数）。
 * 数值单位 px（ insets 插件负责把原生像素换算成 CSS px）。
 */
export function applyShellInsets(insets: ShellInsets): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (insets.top != null) root.style.setProperty("--safe-top", `${insets.top}px`);
  if (insets.right != null) root.style.setProperty("--safe-right", `${insets.right}px`);
  if (insets.bottom != null) root.style.setProperty("--safe-bottom", `${insets.bottom}px`);
  if (insets.left != null) root.style.setProperty("--safe-left", `${insets.left}px`);
}

/**
 * 壳启动时的安全区初始化：问原生 `Insets.getSystemBars`（批次 5 落在安卓壳里；
 * iOS 的 env() 本来就生效，问不到就什么都不覆盖）。桌面/PWA 上 no-op。
 */
export async function initShellInsets(): Promise<void> {
  if (!isMobileShell()) return;
  const bars = await nativePluginCall<{ top?: number; bottom?: number }>("Insets", "getSystemBars");
  if (bars) applyShellInsets({ top: bars.top, bottom: bars.bottom });
}

// ---- 返回栈 ----------------------------------------------------------------

/**
 * Android 系统返回键的注册表（fork:mobile-shell）。
 *
 * 本仓 `popstate` 处理为零、面板自绘关闭按钮——系统返回键按下时不知道该关哪个。
 * 约定：弹层/面板打开时 `pushBackHandler` 注册一个处理器，关闭时调用返回的注销函数；
 * 批次 7 的 `App.addListener("backButton")` 逐个问栈顶，处理器返回 true = 已消费
 * （关掉了自己），全部不消费 = 没有面板可关（退到后台）。
 */
export type ShellBackHandler = () => boolean;

const backStack: ShellBackHandler[] = [];

export function pushBackHandler(handler: ShellBackHandler): () => void {
  backStack.push(handler);
  return () => {
    const index = backStack.lastIndexOf(handler);
    if (index >= 0) backStack.splice(index, 1);
  };
}

/** 问一圈返回栈：有面板消费了这次返回键返回 true。 */
export function popNativeBackStack(): boolean {
  for (let index = backStack.length - 1; index >= 0; index -= 1) {
    if (backStack[index]()) return true;
  }
  return false;
}

/**
 * 界面偏好的客户端那一半：让设置项跟着账号走，而不是只留在当前浏览器。
 *
 * 设置里有二十来项，各自散在 `hooks/useTheme`、`useChatAppearance`、`useFontPreferences`、
 * `lib/thinking-expansion-preference` … 里直接调 `localStorage`。给每一项都写一遍拉取/推送，
 * 等于二十份会漂移的重复逻辑；而它们要的语义本来就一样——同步读、异步写。
 *
 * 所以这里只替换**存储介质**：把 `Storage.prototype.setItem/removeItem` 对
 * `window.localStorage` 的这一份包一层，写入时顺手把「设置项」攒起来推给
 * `PUT /api/ui-preferences`。既有设置代码一行不改，自动获得「换设备也记得」。
 *
 * 为什么不是逐项改：这项改动会横跨二十个文件，而它们的行为其实不需要变。补丁只在浏览器里
 * 生效（`installUiPreferenceSync` 由 components/UiPreferencesSync.tsx 调用），Node 里跑
 * 的测试与 SSR 完全碰不到它。sessionStorage 与测试自造的 storage 对象走原路。
 */

const PENDING_FLUSH_MS = 350;
const SYNC_MARKER_KEY = "pi-ui-prefs-synced";

/**
 * 哪些键算「设置」（换设备也该一样），哪些算「这台设备的状态」。
 *
 * `pi-web:` 前缀的是每台机器本来就该不一样的东西（草稿、未读标记、标签页记忆、每个项目
 * 的展开状态、侧栏尺寸……），同步过去只会让两台设备互相覆盖，所以留在本机。
 */
export const PREFERENCE_KEYS = [
  "pi-locale",                   // 界面语言（hooks/useI18n）
  "pi-theme",                    // 主题（hooks/useTheme）
  "pi-chat-content-width",       // 聊天内容宽度（hooks/useChatAppearance）
  "pi-chat-content-font-size",   // 聊天/终端字号
  "pi-background-opacity",       // 窗口透明度
  "pi-ui-font-family",           // 字体（hooks/useFontPreferences）
  "pi-mono-font-family",
  "pi-ui-font-weight",
  "pi-mono-font-weight",
  "pi-enter-send-mode",          // 回车发送（hooks/useEnterSendMode）
  "pi-thinking-expanded",        // 思考默认展开（lib/thinking-expansion-preference）
  "pi-tool-preset",              // 新会话默认工具集（lib/tool-preset-preference）
  "pi-sound-enabled",            // 完成提示音（hooks/useAudio）
  "pi-quote-selection-enabled",  // 选中即引用（components/AppShell）
  "pi-completion-notifications", // 完成通知（lib/notification-preference）
] as const;

const PREFERENCE_KEY_SET: ReadonlySet<string> = new Set(PREFERENCE_KEYS);

export function isPreferenceKey(key: string): boolean {
  return PREFERENCE_KEY_SET.has(key);
}

interface RemoteEntry { value?: unknown; updatedAt?: unknown }

/** 待推送的键值；同一个键被连续拖拽（滑块）时只发最后一次。 */
const pending = new Map<string, string>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let syncing: Promise<void> | null = null;
let patched = false;

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

async function flush(): Promise<void> {
  flushTimer = null;
  if (!isBrowser() || pending.size === 0) return;
  const body: Record<string, string> = {};
  for (const [key, value] of pending) body[key] = value;
  pending.clear();
  try {
    await fetch("/api/ui-preferences", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    // 离线就丢掉这一批：下一次改设置会再写一次，用户不会因此看到报错。
  }
}

function queueWrite(key: string, value: string): void {
  if (!isPreferenceKey(key)) return;
  pending.set(key, value);
  if (flushTimer !== null) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => void flush(), PENDING_FLUSH_MS);
}

/**
 * 包一层 localStorage 的写入。放在 `Storage.prototype` 上、只认 `window.localStorage`
 * 这一个是刻意的：各 store 手里的引用可能是早先取到的，实例属性拦不住它们，原型方法可以。
 */
function patchWriteThrough(): void {
  if (patched || !isBrowser()) return;
  patched = true;
  const local = window.localStorage;
  const proto = Object.getPrototypeOf(local) as Storage;
  const originalSetItem = proto.setItem;
  const originalRemoveItem = proto.removeItem;

  proto.setItem = function patchedSetItem(this: Storage, key: string, value: string) {
    originalSetItem.call(this, key, value);
    if (this === local) queueWrite(key, value);
  };
  proto.removeItem = function patchedRemoveItem(this: Storage, key: string) {
    originalRemoveItem.call(this, key);
    // 删除用空串表达：服务端是「最后写入者胜」，各 store 都把空串当未设置。
    if (this === local) queueWrite(key, "");
  };
}

/** 服务器文件的指纹：键 + 值 + 时间戳，用来判断这次打开是否需要刷新一次。 */
function fingerprint(preferences: Record<string, RemoteEntry>): string {
  return Object.entries(preferences)
    .map(([key, entry]) => `${key}=${String(entry?.value)}@${String(entry?.updatedAt)}`)
    .sort()
    .join("\n");
}

/**
 * 把服务器上的设置补进 localStorage，必要时刷新一次让各 store 的快照跟上。
 *
 * 刷新的原因：那些 store 在**首次渲染时**就把 localStorage 读成模块级快照并缓存，
 * 只写 localStorage 它们不会重新读。用 sessionStorage 记「这次会话同步过哪个版本」，
 * 一次会话最多刷一次，不会打转；本机自己在写的时候标记早已更新，不会触发。
 */
export async function syncFromServer(): Promise<void> {
  if (!isBrowser()) return;
  if (syncing) return syncing;
  syncing = (async () => {
    try {
      const response = await fetch("/api/ui-preferences", { cache: "no-store" });
      if (!response.ok) return;
      const data = await response.json() as { preferences?: Record<string, RemoteEntry> };
      const preferences = data.preferences ?? {};
      const next = fingerprint(preferences);
      let marker: string | null = null;
      try {
        marker = window.sessionStorage.getItem(SYNC_MARKER_KEY);
      } catch {
        // 没有 sessionStorage：按内容判断即可，最坏是多重载一次。
      }
      if (marker === next) return;
      let changed = false;
      for (const [key, entry] of Object.entries(preferences)) {
        if (!isPreferenceKey(key) || typeof entry?.value !== "string") continue;
        try {
          if (window.localStorage.getItem(key) === entry.value) continue;
          // 直接走原型，躲开下面那层「写回服务器」的包装：这是服务器来的值，不该再推回去。
          Object.getPrototypeOf(window.localStorage).setItem.call(window.localStorage, key, entry.value);
          changed = true;
        } catch {
          // 隐私模式/配额：本机存不下就只影响这次显示。
        }
      }
      try {
        window.sessionStorage.setItem(SYNC_MARKER_KEY, next);
      } catch {
        // ignore
      }
      if (changed) window.location.reload();
    } catch {
      // 服务器不可达：继续用本机的值，设置页照常能用。
    } finally {
      syncing = null;
    }
  })();
  return syncing;
}

/** 页面启动时调一次：先接上写回服务器，再把服务器上的设置补下来。 */
export function installUiPreferenceSync(): void {
  if (!isBrowser()) return;
  patchWriteThrough();
  void syncFromServer();
}

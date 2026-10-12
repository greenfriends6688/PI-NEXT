/**
 * fork:upstream-0.12-chat-parity —— 小地图锁定开关的「每浏览器」选择：锁上后悬停小地图
 * 不再打开回合预览（#1128）。ChatWindow 每切一次会话就重挂，所以这个选择放在这里而不是
 * 组件 state 里。best-effort localStorage：隐私模式或配额报错就退回未锁定。
 */

const STORAGE_KEY = "pi-web:minimap-preview-locked";

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function getBrowserStorage(): StorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadMinimapPreviewLocked(storage: StorageLike | null = getBrowserStorage()): boolean {
  if (!storage) return false;
  try {
    return storage.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function saveMinimapPreviewLocked(
  locked: boolean,
  storage: StorageLike | null = getBrowserStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, String(locked));
  } catch {
    // Persistence is best-effort.
  }
}

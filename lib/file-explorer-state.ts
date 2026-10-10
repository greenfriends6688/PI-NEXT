const EXPLORER_OPEN_STORAGE_KEY = "pi-web:file-explorer:open";
// fork:explorer-column-toggle —— 右侧文件树**整列**的显隐（与树内部折叠是两件事）。
const EXPLORER_COLUMN_HIDDEN_STORAGE_KEY = "pi-web:file-explorer:column-hidden";

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

export function loadExplorerOpen(storage: StorageLike | null = getBrowserStorage()): boolean {
  if (!storage) return true;
  try {
    return storage.getItem(EXPLORER_OPEN_STORAGE_KEY) !== "false";
  } catch {
    return true;
  }
}

export function saveExplorerOpen(
  open: boolean,
  storage: StorageLike | null = getBrowserStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(EXPLORER_OPEN_STORAGE_KEY, String(open));
  } catch {
    // Persistence is best-effort; privacy mode and storage quotas must not break the explorer.
  }
}

/** 右侧文件树整列是否被用户手动隐藏（默认不隐藏，即按原有自动规则显示）。 */
export function loadExplorerColumnHidden(storage: StorageLike | null = getBrowserStorage()): boolean {
  if (!storage) return false;
  try {
    return storage.getItem(EXPLORER_COLUMN_HIDDEN_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function saveExplorerColumnHidden(
  hidden: boolean,
  storage: StorageLike | null = getBrowserStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(EXPLORER_COLUMN_HIDDEN_STORAGE_KEY, String(hidden));
  } catch {
    // Best-effort, same as saveExplorerOpen.
  }
}

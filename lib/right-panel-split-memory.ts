import {
  clampSplitRatio,
  createRightPanelWidthMemory,
  SPLIT_RATIO_DEFAULT,
  type RightPanelWidthMemory,
} from "@/lib/right-panel-split";

/**
 * fork:pr40-split —— 分屏的两样跨会话记忆：**比例**与**两套宽度**。
 *
 * 与 `lib/right-tabs-memory.ts` 同一套约定（一个 JSON map + 逐字段校验 + 存储可注入），
 * 读进来的东西一律不信：手改的 / 旧版本写的 / 写了一半的 JSON 都不能进面板。
 *
 * 只存比例和宽度，**不存 tab id** —— tab id 在刷新后可能已经不存在（终端/浏览器有自己的
 * 恢复路径，动态 tab 与 Proma 一样不持久化）。窄栏退回单列时靠内存里的 split 态保留内容。
 */

/** 分屏比例：`Record<会话槽, 比例>`。宽工作区打开时不落盘。 */
const RATIO_STORAGE_KEY = "pi-web:right-panel-split-ratio-by-session";

/** 两套宽度：`Record<会话槽, { ordinaryWidth, wideWidth, hasOpenedWideWorkspace }>`。 */
const WIDTH_STORAGE_KEY = "pi-web:right-panel-widths-by-session";

/** 新会话草稿（还没有 id）用的槽，和 `lib/tab-session.ts` 的约定一致。 */
export const DRAFT_SESSION_SLOT = "new-draft";

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

function readMap(storage: StorageLike, key: string): Record<string, unknown> {
  const raw = storage.getItem(key);
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function writeMap(storage: StorageLike, key: string, map: Record<string, unknown>): void {
  try {
    storage.setItem(key, JSON.stringify(map));
  } catch {
    // 隐私模式 / 配额不足：记忆降级为「本次运行有效」，不影响使用。
  }
}

function positiveNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

export function loadSplitRatio(
  sessionSlot: string,
  storage: StorageLike | null = getBrowserStorage(),
): number {
  if (!storage || !sessionSlot) return SPLIT_RATIO_DEFAULT;
  return clampSplitRatio(Number(readMap(storage, RATIO_STORAGE_KEY)[sessionSlot]));
}

export function saveSplitRatio(
  sessionSlot: string,
  ratio: number,
  storage: StorageLike | null = getBrowserStorage(),
): void {
  if (!storage || !sessionSlot) return;
  const map = readMap(storage, RATIO_STORAGE_KEY);
  map[sessionSlot] = clampSplitRatio(ratio);
  writeMap(storage, RATIO_STORAGE_KEY, map);
}

/**
 * 读该会话的宽度记忆。任何一档缺失 / 非法就退回 `seed`（通常来自
 * `useResizablePanel` 的 `pi-right-panel-width`），绝不返回半个对象。
 */
export function loadRightPanelWidthMemory(
  sessionSlot: string,
  seed: { ordinaryWidth: number },
  storage: StorageLike | null = getBrowserStorage(),
): RightPanelWidthMemory {
  const fallback = createRightPanelWidthMemory({ ordinaryWidth: seed.ordinaryWidth });
  if (!storage || !sessionSlot) return fallback;
  const raw = readMap(storage, WIDTH_STORAGE_KEY)[sessionSlot];
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return fallback;
  const record = raw as Record<string, unknown>;
  const ordinaryWidth = positiveNumber(record.ordinaryWidth);
  const wideWidth = positiveNumber(record.wideWidth);
  if (ordinaryWidth === null && wideWidth === null) return fallback;
  return {
    ordinaryWidth: ordinaryWidth ?? fallback.ordinaryWidth,
    wideWidth: wideWidth ?? ordinaryWidth ?? fallback.ordinaryWidth,
    hasOpenedWideWorkspace: record.hasOpenedWideWorkspace === true,
  };
}

export function saveRightPanelWidthMemory(
  sessionSlot: string,
  memory: RightPanelWidthMemory,
  storage: StorageLike | null = getBrowserStorage(),
): void {
  if (!storage || !sessionSlot) return;
  const map = readMap(storage, WIDTH_STORAGE_KEY);
  map[sessionSlot] = memory;
  writeMap(storage, WIDTH_STORAGE_KEY, map);
}
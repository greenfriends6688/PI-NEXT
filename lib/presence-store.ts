/**
 * fork:mobile-shell —— 客户端在场注册表（服务端）。
 *
 * 每个打开的客户端（桌面浏览器标签页 / PWA / Electron / 手机壳）每 10 秒向
 * `/api/presence/heartbeat` 报一拍：{clientId, appVisible, focusedSessionId,
 * lastActivityAtMs}。`notifySessionComplete()` 发 Web Push 前读这里做裁决
 * （`lib/notification-plan.ts`），人还在某台设备前就不推推送。
 *
 * - `globalThis` + `Symbol.for` 单例：Next 热重载会重跑模块，普通 module-level
 *   Map 会静默分叉（与 `lib/rpc-manager.ts` 的 registry 同一个坑）。
 * - 只进内存、不落盘：在场是瞬时状态，进程重启 = 全员离场，语义本来如此。
 * - GC 按 lastSeenAtMs 清 1 小时没心跳的条目，防 map 被一次性标签页撑大。
 */

export interface PresenceEntry {
  clientId: string;
  appVisible: boolean;
  focusedSessionId: string | null;
  /** 用户最近一次交互时间；null = 从未交互（刚开的后台标签页）。 */
  lastActivityAtMs: number | null;
  /** 最后一拍到达时间，只用于 GC。 */
  lastSeenAtMs: number;
}

const STORE_KEY = Symbol.for("pi-web.presenceStore");
const GC_TTL_MS = 60 * 60 * 1000;

type PresenceStore = Map<string, PresenceEntry>;

function presenceStore(): PresenceStore {
  const registry = globalThis as unknown as Record<symbol, PresenceStore | undefined>;
  let store = registry[STORE_KEY];
  if (!store) {
    store = new Map();
    registry[STORE_KEY] = store;
  }
  return store;
}

export function recordPresenceHeartbeat(
  clientId: string,
  report: {
    appVisible: boolean;
    focusedSessionId: string | null;
    lastActivityAtMs: number | null;
  },
  nowMs: number = Date.now(),
): void {
  const store = presenceStore();
  // GC 顺手做：map 只该装着「最近还活着的设备」。
  for (const [id, entry] of store) {
    if (nowMs - entry.lastSeenAtMs > GC_TTL_MS) store.delete(id);
  }
  store.set(clientId, {
    clientId,
    appVisible: report.appVisible,
    focusedSessionId: report.focusedSessionId,
    lastActivityAtMs: report.lastActivityAtMs,
    lastSeenAtMs: nowMs,
  });
}

/** 全部已登记客户端（含已陈旧的——陈旧判定是裁决函数的职责）。 */
export function listPresenceClients(): PresenceEntry[] {
  return [...presenceStore().values()];
}

/** 测试隔离用：globalThis 跨 import 常驻，jiti 重读模块也不会清掉它。 */
export function clearPresenceStore(): void {
  presenceStore().clear();
}

/**
 * fork:mobile-shell —— 手机镜像同步引擎（电脑 → 手机，单向）。
 *
 * **跨源裁定**：壳的本地页（capacitor://localhost / https://localhost）fetch 服务器
 * 是跨站，SameSite cookie 不带、无 CORS —— 所以**所有服务器抓取都在这里做**（PWA
 * 跑在远端源，同源带 cookie），抓到的数据经 Capacitor Filesystem 插件写进 App 本机
 * 存储（`Directory.Data`）；本地源的 `mobile/webDir/mirror.html` 只经桥读文件，不碰网络。
 *
 * 数据两类：
 * - `.jsonl`（数据权威）：`/api/sync/session/[id]/entries` 字节游标增量，append 落盘；
 * - export HTML（阅读成品）：`/api/sessions/[id]/export?inline=1` 自包含单文件，
 *   离线用 blob iframe 打开。会话 jsonl 一变 HTML 即过期（htmlVersion 置空），
 *   自动同步只重拉最近 `HTML_EAGER_COUNT` 个，其余留给「要读的时候再拉」。
 *
 * Filesystem 插件调用走 `nativePluginCall`（Capacitor 桥的低层通道），主仓**不需要**
 * 打包任何 @capacitor 依赖 —— 插件的原生实现住在壳里。
 */

import { isMobileShell, nativePluginCall } from "./mobile-shell";

const DATA_DIR = "DATA"; // Capacitor Directory.Data 的线上值
const UTF8 = "utf8";
const INDEX_PATH = "mirror/index.json";
const SESSIONS_DIR = "mirror/sessions";
const HTML_DIR = "mirror/html";
const ENTRIES_CHUNK_BYTES = 1024 * 1024;
const ENTRIES_MAX_ROUNDS = 400;
/** 自动同步时，除增量 jsonl 外还顺手重拉 HTML 的「最近改动」会话数。 */
export const HTML_EAGER_COUNT = 20;
export const AUTO_SYNC_INTERVAL_MS = 5 * 60_000;

export interface MirrorIndexEntry {
  id: string;
  name: string | null;
  cwd: string;
  projectRoot: string;
  /** 版本对：与 manifest 的不等 = 有新内容。 */
  mtimeMs: number;
  sizeBytes: number;
  /** jsonl 已拉到的字节游标。 */
  cursor: number;
  /** 已缓存 HTML 对应的 mtimeMs；null = 还没缓存（或 jsonl 更新后失效）。 */
  htmlVersion: number | null;
  lastSyncAt: number;
}

export interface MirrorIndex {
  version: 1;
  updatedAt: number;
  sessions: Record<string, MirrorIndexEntry>;
}

export interface SyncManifestSession {
  id: string;
  name: string | null;
  cwd: string;
  projectRoot: string;
  mtimeMs: number;
  sizeBytes: number;
}

export interface MirrorDiff {
  /** 新会话，或版本对变了（要拉增量 jsonl）。 */
  toUpdate: SyncManifestSession[];
  /** HTML 过期/缺失（其中最近改动的前 N 个会被自动重拉）。 */
  htmlStale: SyncManifestSession[];
  /** 本地有、远端没有（电脑上删了）——同步时清掉。 */
  removed: string[];
}

/** 纯函数：本地镜像 vs 远端清单。 */
export function diffMirror(
  index: MirrorIndex,
  manifest: SyncManifestSession[],
): MirrorDiff {
  const toUpdate: SyncManifestSession[] = [];
  const htmlStale: SyncManifestSession[] = [];
  const remoteIds = new Set<string>();
  for (const session of manifest) {
    remoteIds.add(session.id);
    const local = index.sessions[session.id];
    if (!local || local.mtimeMs !== session.mtimeMs || local.sizeBytes !== session.sizeBytes) {
      toUpdate.push(session);
    }
    if (!local || local.htmlVersion !== session.mtimeMs) {
      htmlStale.push(session);
    }
  }
  const removed = Object.keys(index.sessions).filter((id) => !remoteIds.has(id));
  return { toUpdate, htmlStale, removed };
}

export function emptyMirrorIndex(): MirrorIndex {
  return { version: 1, updatedAt: 0, sessions: {} };
}

// ---- Capacitor Filesystem 低层封装（全部容错：无壳/无插件 → null） ----------------

async function fsReadFile(path: string): Promise<string | null> {
  const result = await nativePluginCall<{ data?: string }>("Filesystem", "readFile", {
    path,
    directory: DATA_DIR,
    encoding: UTF8,
  });
  return result?.data ?? null;
}

async function fsWrite(path: string, data: string, append = false): Promise<boolean> {
  const method = append ? "appendFile" : "writeFile";
  const result = await nativePluginCall("Filesystem", method, {
    path,
    directory: DATA_DIR,
    data,
    encoding: UTF8,
    recursive: true,
  });
  return result != null;
}

async function fsDelete(path: string): Promise<void> {
  await nativePluginCall("Filesystem", "deleteFile", { path, directory: DATA_DIR });
}

export async function readMirrorIndex(): Promise<MirrorIndex> {
  const raw = await fsReadFile(INDEX_PATH);
  if (!raw) return emptyMirrorIndex();
  try {
    const parsed = JSON.parse(raw) as MirrorIndex;
    if (!parsed || typeof parsed !== "object" || typeof parsed.sessions !== "object") {
      return emptyMirrorIndex();
    }
    return parsed;
  } catch {
    // 索引坏了按空镜像算：下次同步全量重建（jsonl 文件还在，会被 reset 语义重写）。
    return emptyMirrorIndex();
  }
}

async function writeMirrorIndex(index: MirrorIndex): Promise<void> {
  index.updatedAt = Date.now();
  await fsWrite(INDEX_PATH, JSON.stringify(index));
}

// ---- 同步状态（设置面板读这里） ------------------------------------------------------

export interface MobileSyncState {
  running: boolean;
  lastSyncAt: number | null;
  lastError: string | null;
  lastSummary: { updated: number; html: number; removed: number } | null;
  /** 上次跑的时候到底在不在壳里（给面板解释「为什么没动静」）。 */
  lastAttemptInShell: boolean;
}

const STATE_KEY = Symbol.for("pi-web.mobileSyncState");
const LISTENERS_KEY = Symbol.for("pi-web.mobileSyncListeners");

/** 默认态必须是**同一个引用**：useSyncExternalStore 的 getSnapshot 返回新对象会死循环。 */
const INITIAL_STATE: MobileSyncState = {
  running: false,
  lastSyncAt: null,
  lastError: null,
  lastSummary: null,
  lastAttemptInShell: false,
};

interface Registry {
  [STATE_KEY]?: MobileSyncState;
  [LISTENERS_KEY]?: Set<() => void>;
}

function registry(): Registry {
  return globalThis as unknown as Registry;
}

export function getMobileSyncState(): MobileSyncState {
  return registry()[STATE_KEY] ?? INITIAL_STATE;
}

function setMobileSyncState(patch: Partial<MobileSyncState>): void {
  const next = { ...getMobileSyncState(), ...patch };
  registry()[STATE_KEY] = next;
  registry()[LISTENERS_KEY]?.forEach((listener) => listener());
}

export function subscribeMobileSyncState(listener: () => void): () => void {
  const listeners = registry()[LISTENERS_KEY] ?? new Set<() => void>();
  listeners.add(listener);
  registry()[LISTENERS_KEY] = listeners;
  return () => listeners.delete(listener);
}

// ---- 同步主流程 ----------------------------------------------------------------------

export async function runMobileSync(): Promise<MobileSyncState> {
  const state = getMobileSyncState();
  if (state.running) return state;
  setMobileSyncState({ running: true, lastAttemptInShell: isMobileShell() });
  try {
    if (!isMobileShell()) throw new MobileSyncError("not in the mobile shell");
    const manifestResponse = await fetch("/api/sync/manifest", { cache: "no-store" });
    if (!manifestResponse.ok) throw new MobileSyncError(`manifest ${manifestResponse.status}`);
    const manifestJson = (await manifestResponse.json()) as { sessions?: SyncManifestSession[] };
    const manifest = manifestJson.sessions ?? [];

    const index = await readMirrorIndex();
    const diff = diffMirror(index, manifest);

    let updated = 0;
    for (const session of diff.toUpdate) {
      await syncSessionEntries(session, index);
      updated += 1;
    }

    let htmlCount = 0;
    const htmlTargets = [...diff.htmlStale]
      .filter((session) => index.sessions[session.id])
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
      .slice(0, HTML_EAGER_COUNT);
    for (const session of htmlTargets) {
      if (await syncSessionHtml(session, index)) htmlCount += 1;
    }

    for (const id of diff.removed) {
      await fsDelete(`${SESSIONS_DIR}/${id}.jsonl`);
      await fsDelete(`${HTML_DIR}/${id}.html`);
      delete index.sessions[id];
    }

    await writeMirrorIndex(index);
    setMobileSyncState({
      running: false,
      lastSyncAt: Date.now(),
      lastError: null,
      lastSummary: { updated, html: htmlCount, removed: diff.removed.length },
    });
    return getMobileSyncState();
  } catch (error) {
    setMobileSyncState({
      running: false,
      lastError: error instanceof Error ? error.message : String(error),
    });
    return getMobileSyncState();
  }
}

class MobileSyncError extends Error {}

/** 拉一个会话的增量 jsonl（分页到追平为止）。 */
async function syncSessionEntries(remote: SyncManifestSession, index: MirrorIndex): Promise<void> {
  const local = index.sessions[remote.id];
  let cursor = local && remote.sizeBytes >= local.cursor ? local.cursor : 0;
  let pendingReset = !local || cursor === 0;

  let rounds = 0;
  while (rounds < ENTRIES_MAX_ROUNDS) {
    rounds += 1;
    const response = await fetch(
      `/api/sync/session/${encodeURIComponent(remote.id)}/entries?offset=${cursor}&maxBytes=${ENTRIES_CHUNK_BYTES}`,
      { cache: "no-store" },
    );
    if (!response.ok) throw new MobileSyncError(`entries ${remote.id}: ${response.status}`);
    const slice = (await response.json()) as {
      reset: boolean;
      lines: string[];
      nextOffset: number;
      sizeBytes: number;
    };

    if (slice.reset) {
      pendingReset = true;
      cursor = 0;
    }
    if (slice.lines.length > 0) {
      const data = slice.lines.map((line) => `${line}\n`).join("");
      const wrote = await fsWrite(`${SESSIONS_DIR}/${remote.id}.jsonl`, data, !pendingReset);
      if (!wrote) throw new MobileSyncError(`filesystem write failed for ${remote.id}`);
      pendingReset = false;
    }
    cursor = slice.nextOffset;
    if (cursor >= slice.sizeBytes) {
      index.sessions[remote.id] = {
        id: remote.id,
        name: remote.name,
        cwd: remote.cwd,
        projectRoot: remote.projectRoot,
        mtimeMs: remote.mtimeMs,
        sizeBytes: remote.sizeBytes,
        cursor,
        // jsonl 变了 → 之前缓存的 HTML 全部过期。
        htmlVersion: null,
        lastSyncAt: Date.now(),
      };
      return;
    }
  }
  throw new MobileSyncError(`entries ${remote.id}: pagination did not converge`);
}

/** 拉一个会话的离线阅读 HTML（自包含单文件）。 */
export async function syncSessionHtml(
  session: { id: string; mtimeMs: number },
  index?: MirrorIndex,
): Promise<boolean> {
  const response = await fetch(
    `/api/sessions/${encodeURIComponent(session.id)}/export?inline=1`,
    { cache: "no-store" },
  );
  if (!response.ok) return false;
  const html = await response.text();
  const wrote = await fsWrite(`${HTML_DIR}/${session.id}.html`, html);
  if (!wrote) return false;
  if (index?.sessions[session.id]) {
    index.sessions[session.id].htmlVersion = session.mtimeMs;
  }
  return true;
}

// ---- 入口 ----------------------------------------------------------------------------

/**
 * 从 PWA（远端源）跳到本地源的镜像库页。两个平台的本地 scheme 不同：
 * Android 默认 https://localhost，iOS 是 capacitor://localhost。
 */
export function openMirrorLibrary(): void {
  const platform =
    typeof window !== "undefined"
      ? (window as { Capacitor?: { getPlatform?: () => string } }).Capacitor?.getPlatform?.()
      : undefined;
  const base = platform === "ios" ? "capacitor://localhost" : "https://localhost";
  // 目标是壳的**本地源**（webDir 资产），不是 Next 页面 —— next lint 的路由规则不适用。
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.href = `${base}/mirror.html`;
}

// fork:upstream-0.9.3-retry-settings — 上游 closed PR #918 的「后端已在、只差 UI」那半。
/**
 * `settings.retry.{enabled,maxRetries,baseDelayMs}` 的读写。
 *
 * pi 认这个段（`@earendil-works/pi-coding-agent/dist/core/settings-manager.d.ts:23-29`
 * 的 `RetrySettings`、`:90` 的 `retry?: RetrySettings`），本 fork 一直只把它**读**出来
 * 透传给前端（`lib/pi-types.ts:140` `autoRetryEnabled` ← `lib/rpc-manager.ts:854`），
 * 从来没有入口能改 —— 网络抖动只能吃 SDK 默认的 3 次 / 2000ms。
 *
 * ## 写入口：SDK 只给了一半（这一段是本文件存在的原因）
 *
 * 0.87 的 `SettingsManager` 有 `getRetrySettings()` 与 `setRetryEnabled()`，**没有**
 * `maxRetries` / `baseDelayMs` 的 setter（`settings-manager.d.ts:19-24, 200-210`）：
 * 私有 `markModified` / `save` / `globalSettings` 拿不到，`applyOverrides()` 只改内存视图
 * 且不落盘。所以：
 *
 *   · `enabled`      → 走 SDK：`SettingsManager.setRetryEnabled()` + `flush()` +
 *                      `drainErrors()`。它自带文件锁，且写的是**读当前文件再合并**的
 *                      （`persistScopedSettings` 只覆盖 `markModified` 标过的键），
 *                      不会把我们写的另两个数字抹掉。
 *   · `maxRetries` /
 *     `baseDelayMs`  → SDK 没有任何入口，只能自己改文件。写法照本仓已经在同一个文件上
 *                      用的那套（`lib/powershell-settings.ts` 写 `defaultTools`）：
 *                      `proper-lockfile` + 只替换 `retry` 对象的顶层键。
 *
 * **锁协议与 pi 完全一致**：`FileSettingsStorage.acquireLockSyncWithRetry`（SDK
 * `settings-manager.js:64-87`）用的就是 `proper-lockfile.lock(path, {realpath:false})`，
 * 锁的就是 `~/.pi/agent/settings.json` 本身。同一把锁 = 两边的写互斥，
 * 不存在「我们覆盖掉 pi 刚写的」这条路径，也不需要新依赖。
 * 上游 #918 照抄了自己的 `proper-lockfile` 封装（等价于我们已有的 `lib/powershell-settings.ts`），
 * 这里只把它收敛到仓库里既有的一份依赖上。
 *
 * 写用 `writePrivateFileAtomicSync`（临时文件 + rename，0600）：断电/写一半不会留下半个
 * settings.json —— 那个文件里有 API key。
 *
 * **作用域**：只管**全局** `~/.pi/agent/settings.json`。项目级 `settings.json` 里也能写
 * `retry`，但那是 pi 自己的多项目约定，本产品没有对应的项目设置页，不碰。
 *
 * **读不出来就报错**（`RetrySettingsReadError` → HTTP 422），照 `lib/models-config-store.ts`
 * 那个「解析失败被吞成空配置、下一次保存抹掉全部 provider」的教训：文件坏掉时宁可让
 * 保存按钮点不动并说清原因，也不要用默认值盖回去。
 */
import { chmodSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir, SettingsManager } from "@earendil-works/pi-coding-agent";
import lockfile from "proper-lockfile";
import { writePrivateFileAtomicSync } from "./atomic-file";

/** 面板上暴露的三个键。`maxAgentDelayMs` / `provider.*` 是 pi 的内部上限与供应商级旋钮，本产品不给入口。
 *  —— 类型与常量本体在 `lib/retry-settings-shared.ts`（客户端也要用，不能带 fs）。 */
export type { RetrySettings } from "./retry-settings-shared";
export { RETRY_DEFAULTS, RETRY_MAX_RETRIES, RETRY_MAX_BASE_DELAY_MS } from "./retry-settings-shared";
import type { RetrySettings } from "./retry-settings-shared";
import { RETRY_DEFAULTS, RETRY_MAX_RETRIES, RETRY_MAX_BASE_DELAY_MS } from "./retry-settings-shared";

/** settings.json 坏掉 / 不是对象 —— 调用方应据此禁用保存并显示原因（422）。 */
export class RetrySettingsReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RetrySettingsReadError";
  }
}

export function retrySettingsPath(agentDir = getAgentDir()): string {
  return join(agentDir, "settings.json");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readCount(value: unknown, fallback: number, max: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= max
    ? value
    : fallback;
}

/** 只认 `true` / `false`；别的（字符串 "false"、0）都当没写 —— 与 SDK 的 `?? true` 同口径。 */
function readEnabled(value: unknown): boolean {
  return typeof value === "boolean" ? value : RETRY_DEFAULTS.enabled;
}

/** 读 `retry` 段；段缺了或各键类型不对就回落到 SDK 默认，**不抛**（没写 ≠ 写坏）。 */
function parseRetrySection(settings: Record<string, unknown>): RetrySettings {
  const retry = isRecord(settings.retry) ? settings.retry : {};
  return {
    enabled: readEnabled(retry.enabled),
    maxRetries: readCount(retry.maxRetries, RETRY_DEFAULTS.maxRetries, RETRY_MAX_RETRIES),
    baseDelayMs: readCount(retry.baseDelayMs, RETRY_DEFAULTS.baseDelayMs, RETRY_MAX_BASE_DELAY_MS),
  };
}

function readSettingsFile(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  // 语法错误也要归到 RetrySettingsReadError：路由靠这个类型分 422 与 500，
  // 裸 SyntaxError 会被当成「服务器炸了」。
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new RetrySettingsReadError(`Invalid settings.json: ${(error as Error).message}`);
  }
  if (!isRecord(parsed)) throw new RetrySettingsReadError("Invalid settings.json: expected an object");
  return parsed;
}

/**
 * 锁里读改写。`proper-lockfile` 能锁一个尚不存在的文件（只要父目录在），
 * 所以**读不建文件**（GET 不该凭空造出 `settings.json`），只有写才 mkdir。
 * 锁协议与 pi 的 `FileSettingsStorage` 一致，见文件头。
 */
async function withSettingsLock<T>(
  settingsPath: string,
  fn: (settings: Record<string, unknown>) => T | Promise<T>,
  options: { createDirs?: boolean } = {},
): Promise<T> {
  const directory = dirname(settingsPath);
  if (options.createDirs) mkdirSync(directory, { recursive: true });
  else if (!existsSync(directory)) throw new RetrySettingsReadError("Agent settings directory does not exist");
  const release = await lockfile.lock(settingsPath, { realpath: false, retries: 10 });
  try {
    return await fn(readSettingsFile(settingsPath));
  } finally {
    await release();
  }
}

/** 读当前生效的全局重试策略。文件坏掉时抛 `RetrySettingsReadError`（调用方转 422）。 */
export async function readRetrySettings(
  settingsPath = retrySettingsPath(),
): Promise<RetrySettings> {
  return withSettingsLock(settingsPath, parseRetrySection);
}

function assertCount(name: string, value: unknown, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > max) {
    throw new TypeError(`${name} must be an integer between 0 and ${max}`);
  }
  return value;
}

/**
 * 校验 PUT 的请求体。只校验**给了的**键（面板一次只改一项），返回同样的部分更新。
 * 未知键、类型错、越界一律抛 `TypeError`，路由转 400。
 */
export function parseRetrySettingsUpdate(body: unknown): Partial<RetrySettings> {
  if (!isRecord(body)) throw new TypeError("Retry settings body must be an object");
  const update: Partial<RetrySettings> = {};
  for (const key of Object.keys(body) as (keyof RetrySettings)[]) {
    if (key === "enabled") {
      if (typeof body.enabled !== "boolean") throw new TypeError("enabled must be a boolean");
      update.enabled = body.enabled;
    } else if (key === "maxRetries") {
      update.maxRetries = assertCount("maxRetries", body.maxRetries, RETRY_MAX_RETRIES);
    } else if (key === "baseDelayMs") {
      update.baseDelayMs = assertCount("baseDelayMs", body.baseDelayMs, RETRY_MAX_BASE_DELAY_MS);
    } else {
      throw new TypeError(`Unknown retry setting: ${String(key)}`);
    }
  }
  if (Object.keys(update).length === 0) throw new TypeError("Retry settings body is empty");
  return update;
}

/** SDK 没有的 setter：自己按锁读改写，只动 `retry` 对象的顶层键，其余键原样保留。 */
async function writeRetryNumbers(
  update: { maxRetries?: number; baseDelayMs?: number },
  settingsPath: string,
): Promise<void> {
  if (update.maxRetries === undefined && update.baseDelayMs === undefined) return;
  await withSettingsLock(settingsPath, (settings) => {
    const retry = isRecord(settings.retry) ? { ...settings.retry } : {};
    for (const key of ["maxRetries", "baseDelayMs"] as const) {
      const value = update[key];
      if (value !== undefined) retry[key] = value;
    }
    writePrivateFileAtomicSync(settingsPath, JSON.stringify({ ...settings, retry }, null, 2));
    // 已有文件可能不是 0600（老版本 / 别的工具建的），补一次权限收敛。
    chmodSync(settingsPath, 0o600);
  }, { createDirs: true });
}

/**
 * SDK 唯一有的 setter。`setRetryEnabled()` 只是标脏 + 入队，真正落盘要 `flush()`；
 * 写失败不会 throw，而是记进 `drainErrors()`（文件读不出来时 `save()` 干脆是空操作）。
 */
async function writeRetryEnabled(
  enabled: boolean,
  cwd: string,
  agentDir = getAgentDir(),
): Promise<void> {
  const settingsManager = SettingsManager.create(cwd, agentDir);
  settingsManager.setRetryEnabled(enabled);
  await settingsManager.flush();
  const failure = settingsManager.drainErrors()[0];
  if (failure) {
    throw new RetrySettingsReadError(`Failed to write retry.enabled: ${failure.error.message}`);
  }
}

/**
 * 部分更新并回读。返回值是**重新从文件读出来的**生效值，而不是提交的值 ——
 * 这样面板上显示的永远是磁盘上的真相（并发改动 / SDK 侧的钳制都看得见）。
 *
 * 顺序：先写两个数字（自己的读改写），再让 SDK 写 `enabled`（它在锁内重新读文件，
 * 只覆盖 `enabled` 一个键），所以两条路径不会互相抹掉。
 */
export async function writeRetrySettings(
  update: Partial<RetrySettings>,
  options: { cwd?: string; agentDir?: string; settingsPath?: string } = {},
): Promise<RetrySettings> {
  const agentDir = options.agentDir ?? getAgentDir();
  const settingsPath = options.settingsPath ?? retrySettingsPath(agentDir);
  if (update.maxRetries !== undefined || update.baseDelayMs !== undefined) {
    await writeRetryNumbers(update, settingsPath);
  }
  if (update.enabled !== undefined) {
    await writeRetryEnabled(update.enabled, options.cwd ?? process.cwd(), agentDir);
  }
  return readRetrySettings(settingsPath);
}

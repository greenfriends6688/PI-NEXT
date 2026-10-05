// fork:model-roles —— pi 的「新会话起步模型」（settings.json 顶层 defaultProvider /
// defaultModel）。GET /api/models 只读它；这里补上写入，给模型页「默认模型分工」
// 那张卡用（画板 D-08 帧 C）。
//
// 写协议与 lib/retry-settings.ts / lib/context-budget-settings.ts 同一套：
//  · set 走 SDK 唯一的 setter `setDefaultModelAndProvider`（标脏 + flush）；
//  · clear SDK 没有 setter，按锁读改写 —— `proper-lockfile` 锁的就是 settings.json
//    本身，锁内重读、只删这两个顶层键、其余原样保留，再 0600 原子写回。
import { chmodSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { getAgentDir, SettingsManager } from "@earendil-works/pi-coding-agent";
import lockfile from "proper-lockfile";
import { writePrivateFileAtomicSync } from "./atomic-file";

export function defaultModelSettingsPath(agentDir = getAgentDir()): string {
  return `${agentDir}/settings.json`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 解析失败的 settings.json 与「没设默认」必须分开：前者要让控件报错，不能当空。 */
export class DefaultModelWriteError extends Error {}

/**
 * 写入（`{provider, modelId}`）或清除（`null`）默认模型。两分支都与 pi 自己的
 * 写（SettingsManager 的锁）互斥，不会互相抹掉。
 */
export async function writeDefaultModel(
  value: { provider: string; modelId: string } | null,
  options: { cwd?: string; agentDir?: string } = {},
): Promise<void> {
  const agentDir = options.agentDir ?? getAgentDir();
  const settingsPath = defaultModelSettingsPath(agentDir);

  if (value) {
    const settingsManager = SettingsManager.create(options.cwd ?? process.cwd(), agentDir);
    settingsManager.setDefaultModelAndProvider(value.provider, value.modelId);
    await settingsManager.flush();
    const failure = settingsManager.drainErrors()[0];
    if (failure) {
      throw new DefaultModelWriteError(`Failed to write defaultModel: ${failure.error.message}`);
    }
    return;
  }

  // proper-lockfile 能锁一个尚不存在的文件（只要父目录在）：写路径先补目录。
  mkdirSync(dirname(settingsPath), { recursive: true });
  const release = await lockfile.lock(settingsPath, { realpath: false, retries: 10 }).catch((error: unknown) => {
    throw new DefaultModelWriteError(`Failed to lock settings.json: ${String(error)}`);
  });
  try {
    let settings: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(readFileSync(settingsPath, "utf8"));
      if (isRecord(parsed)) settings = parsed;
    } catch (error) {
      // 文件不存在 = 本来就没有默认，清除即无事；读出来了但解析失败 = 不能动，
      // 与 models.json 的「解析失败绝不当空配置写回」同一条纪律。
      if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
        throw new DefaultModelWriteError("settings.json is not valid JSON; not touching it");
      }
    }
    delete settings.defaultModel;
    delete settings.defaultProvider;
    writePrivateFileAtomicSync(settingsPath, JSON.stringify(settings, null, 2));
    // 已有文件可能不是 0600（老版本 / 别的工具建的），补一次权限收敛。
    chmodSync(settingsPath, 0o600);
  } finally {
    // release 是 lockfile.lock() resolve 出来的**释放函数**——先调用再兜错
    // （`release.catch` 是在函数对象上找 .catch，类型与运行时都不成立）。
    // proper-lockfile 的 release 声明成 `() => Promise<void> | void`：同步分支下
    // 直接 `.catch` 过不了类型，所以用 `Promise.resolve()` 兜成 thenable。
    await Promise.resolve(release()).catch(() => {});
  }
}

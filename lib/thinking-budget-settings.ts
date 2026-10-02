// fork:pr12-a6-thinking-budget —— pi 的 `settings.thinkingBudgets` 四档 token 预算。
/**
 * `settings.thinkingBudgets.{minimal,low,medium,high}` 的读写。
 *
 * pi 认这四个字段（`settings-manager.d.ts:50-53`、`:115`），运行时由 pi-ai 消费
 * （`thinkingBudgetForLevel`，`dist/api/simple-options.js:47-51`），本产品一个控件都没有 ——
 * 各思考档的 token 预算只能手改 `~/.pi/agent/settings.json`。
 *
 * ## 写入口：0.87 的 `SettingsManager` **连 getter 都只给了一个**
 *
 * `settings-manager.d.ts:298` 只有 `getThinkingBudgets(): ThinkingBudgetsSettings | undefined`，
 * **没有 setter**：私有 `markModified` / `save` / `globalSettings` 拿不到，
 * `applyOverrides()` 只改内存视图不落盘。也就是说这一段没有任何一条能走 SDK 的路。
 *
 * 但它不是「本 SDK 版本改不了」—— settings.json 就在那儿，且
 * `lib/retry-settings.ts`（`retry.maxRetries`）与 `lib/context-budget-settings.ts`
 * （`compaction.reserveTokens`）已经在同一个文件上趟过同一条路。本文件照抄那套不变量，
 * 不发明新的：
 *
 *   · **锁协议与 pi 完全一致**：`FileSettingsStorage.withLock` 用
 *     `proper-lockfile.lock(path, {realpath:false})`，锁的就是 `settings.json` 本身
 *     （SDK `settings-manager.js:64-87`）。同一把锁 = 两边的写互斥。
 *   · **写前 re-read**，**原子写 0600**（`writePrivateFileAtomicSync`：临时文件 + rename，
 *     断电不会留下半个 settings.json —— 那个文件里有 API key），**GET 不建文件**，
 *     **读不出来就报错**（`ThinkingBudgetReadError` → 422，理由同
 *     `lib/models-config-store.ts` 那条「解析失败被吞成空配置、下一次保存抹掉全部 provider」）。
 *
 * ## 落盘口径：**只写与内建默认不同的值**
 *
 * `settings.json` 里只留「和 pi-ai 内建默认不一样」的档位：等于默认的那一档直接删键，
 * 四档都等于默认就整段删掉（不留 `{ thinkingBudgets: {} }` 空壳）。理由是这条路径的目标
 * 就是「面板上改的值与默认不同」，同值再写一遍只是噪声；而副作用是**读回来再原样写回去
 * 不会动文件**（单测钉住了这条幂等性）。代价写在明处：将来 pi-ai 改了内建默认，
 * 曾经「设成默认值」的用户会跟着变 —— 与 A1「清空即删键」是同一条取舍。
 *
 * **作用域**：只管**全局** `~/.pi/agent/settings.json`，项目级 settings.json 不碰。
 */
import { chmodSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import lockfile from "proper-lockfile";
import { writePrivateFileAtomicSync } from "./atomic-file";

/** 面板上暴露的四个键 —— 类型与常量本体在 `lib/thinking-budget-settings-shared.ts`（客户端也要用）。 */
export type {
  ThinkingBudgetLevel,
  ThinkingBudgetSettings,
  ThinkingBudgetSettingsResponse,
} from "./thinking-budget-settings-shared";
export {
  THINKING_BUDGET_DEFAULTS,
  THINKING_BUDGET_LEVELS,
  THINKING_BUDGET_MAX_TOKENS,
} from "./thinking-budget-settings-shared";
import type { ThinkingBudgetLevel, ThinkingBudgetSettings } from "./thinking-budget-settings-shared";
import {
  THINKING_BUDGET_DEFAULTS,
  THINKING_BUDGET_LEVELS,
  THINKING_BUDGET_MAX_TOKENS,
} from "./thinking-budget-settings-shared";

/** 面板一次只改一项，所以更新体永远是 `Partial`。 */
export type ThinkingBudgetUpdate = Partial<ThinkingBudgetSettings>;

/** settings.json 坏掉 / 不是对象 —— 调用方应据此禁用控件并显示原因（422）。 */
export class ThinkingBudgetReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ThinkingBudgetReadError";
  }
}

export function thinkingBudgetSettingsPath(agentDir = getAgentDir()): string {
  return join(agentDir, "settings.json");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 只认正的安全整数且在我们自己定的上界之内；别的（0、字符串、越界）都当没写 —— 与 pi-ai 的 `{...DEFAULT, ...custom}` 同口径。 */
function readBudget(value: unknown, fallback: number): number {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value > 0
    && value <= THINKING_BUDGET_MAX_TOKENS
    ? value
    : fallback;
}

/** 读 `thinkingBudgets` 段；缺了或类型不对就回落到 pi-ai 的内建默认，**不抛**（没写 ≠ 写坏）。 */
export function parseThinkingBudgets(settings: Record<string, unknown>): ThinkingBudgetSettings {
  const budgets = isRecord(settings.thinkingBudgets) ? settings.thinkingBudgets : {};
  const parsed = {} as ThinkingBudgetSettings;
  for (const level of THINKING_BUDGET_LEVELS) {
    parsed[level] = readBudget(budgets[level], THINKING_BUDGET_DEFAULTS[level]);
  }
  return parsed;
}

function readSettingsFile(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  // 语法错误也要归到 ThinkingBudgetReadError：路由靠这个类型分 422 与 500，
  // 裸 SyntaxError 会被当成「服务器炸了」。
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new ThinkingBudgetReadError(`Invalid settings.json: ${(error as Error).message}`);
  }
  if (!isRecord(parsed)) throw new ThinkingBudgetReadError("Invalid settings.json: expected an object");
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
  else if (!existsSync(directory)) throw new ThinkingBudgetReadError("Agent settings directory does not exist");
  const release = await lockfile.lock(settingsPath, { realpath: false, retries: 10 });
  try {
    return await fn(readSettingsFile(settingsPath));
  } finally {
    await release();
  }
}

/** 读当前生效的四档预算。文件坏掉时抛 `ThinkingBudgetReadError`（调用方转 422）。 */
export async function readThinkingBudgetSettings(
  settingsPath = thinkingBudgetSettingsPath(),
): Promise<ThinkingBudgetSettings> {
  return withSettingsLock(settingsPath, parseThinkingBudgets);
}

function assertBudget(name: string, value: unknown): number {
  if (
    typeof value !== "number"
    || !Number.isSafeInteger(value)
    || value <= 0
    || value > THINKING_BUDGET_MAX_TOKENS
  ) {
    throw new TypeError(`${name} must be an integer between 1 and ${THINKING_BUDGET_MAX_TOKENS}`);
  }
  return value;
}

/**
 * 校验 PUT 的请求体。只校验**给了的**键（面板一次只改一档），返回同样的部分更新。
 * 未知键、类型错、越界一律抛 `TypeError`，路由转 400。
 */
export function parseThinkingBudgetUpdate(body: unknown): ThinkingBudgetUpdate {
  if (!isRecord(body)) throw new TypeError("Thinking budget body must be an object");
  const update: ThinkingBudgetUpdate = {};
  for (const key of Object.keys(body)) {
    if (!(THINKING_BUDGET_LEVELS as readonly string[]).includes(key)) {
      throw new TypeError(`Unknown thinking budget setting: ${String(key)}`);
    }
    update[key as ThinkingBudgetLevel] = assertBudget(key, body[key]);
  }
  if (Object.keys(update).length === 0) throw new TypeError("Thinking budget body is empty");
  return update;
}

/** SDK 没有 setter：锁内 re-read → 只替换 `thinkingBudgets` 这一段的顶层键 → 原子写 0600。 */
async function writeThinkingBudgets(
  update: ThinkingBudgetUpdate,
  settingsPath: string,
): Promise<void> {
  await withSettingsLock(settingsPath, (settings) => {
    const next: Record<string, unknown> = { ...settings };
    const budgets = isRecord(next.thinkingBudgets) ? { ...next.thinkingBudgets } : {};
    for (const [level, value] of Object.entries(update)) {
      // 与内建默认相同的一档不留键（见文件头「落盘口径」）。
      if (value === THINKING_BUDGET_DEFAULTS[level as ThinkingBudgetLevel]) delete budgets[level];
      else budgets[level] = value;
    }
    if (Object.keys(budgets).length === 0) delete next.thinkingBudgets;
    else next.thinkingBudgets = budgets;
    writePrivateFileAtomicSync(settingsPath, JSON.stringify(next, null, 2));
    // 已有文件可能不是 0600（老版本 / 别的工具建的），补一次权限收敛。
    chmodSync(settingsPath, 0o600);
  }, { createDirs: true });
}

/**
 * 部分更新并回读。返回值是**重新从文件读出来的**生效值，而不是提交的值 ——
 * 这样面板上显示的永远是磁盘上的真相。
 */
export async function writeThinkingBudgetSettings(
  update: ThinkingBudgetUpdate,
  options: { settingsPath?: string } = {},
): Promise<ThinkingBudgetSettings> {
  const settingsPath = options.settingsPath ?? thinkingBudgetSettingsPath();
  await writeThinkingBudgets(update, settingsPath);
  return readThinkingBudgetSettings(settingsPath);
}

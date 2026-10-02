// fork:pr12-a5-context-budget —— pi 的 `settings.compaction` / `settings.branchSummary` 预算。
/**
 * `settings.compaction.{reserveTokens,keepRecentTokens,modelOverrides}` 与
 * `settings.branchSummary.reserveTokens` 的读写。
 *
 * pi 一直认这四个字段（`settings-manager.d.ts:4-15`、`:83-84`），本产品一个控件都没有 ——
 * 压缩预留多少 / 保留最近多少 / 哪个模型用另一套预算，全都只能手改
 * `~/.pi/agent/settings.json`。
 *
 * ## 写入口：逐字段查过 0.87 的 `SettingsManager`（`settings-manager.d.ts:198-215`）
 *
 * | 字段 | SDK setter | 我们走的路径 |
 * | --- | --- | --- |
 * | `compaction.enabled` | **有** `setCompactionEnabled()`（`:214`） | SDK：`setCompactionEnabled` + `flush()` + `drainErrors()` |
 * | `compaction.reserveTokens` | 没有（只有 getter `getCompactionReserveTokens`） | 自己的读改写 |
 * | `compaction.keepRecentTokens` | 没有（只有 getter） | 自己的读改写 |
 * | `compaction.modelOverrides` | 没有（只有内部 getter `getCompactionTokenSetting`） | 自己的读改写 |
 * | `branchSummary.reserveTokens` | 没有（只有 getter `getBranchSummarySettings`） | 自己的读改写 |
 *
 * 没有的那四个不是「写不了」：私有 `markModified` / `save` / `globalSettings` 在 `.d.ts` 里
 * 是 private，`applyOverrides()` 只改内存视图不落盘 —— 但 settings.json 就在那儿，且
 * `lib/retry-settings.ts` 已经为 `retry.maxRetries` / `retry.baseDelayMs` 趟过同一条路。
 * 本文件的写入部分照抄那个模式，不发明新的：
 *
 *   · **锁协议与 pi 完全一致**：`FileSettingsStorage.withLock` 用的是
 *     `proper-lockfile.lock(path, {realpath:false})`，锁的就是 `settings.json` 本身
 *     （SDK `settings-manager.js:64-87`）。同一把锁 = 两边的写互斥。
 *   · **写前 re-read**（锁内重读 → 只替换目标顶层键 → 其余键原样保留）。
 *   · **原子写 0600**：`writePrivateFileAtomicSync`（临时文件 + rename），断电不会留下半个
 *     settings.json —— 那个文件里有 API key。老文件的权限再 `chmod` 收敛一次。
 *   · **GET 不建文件**：`proper-lockfile` 能锁一个尚不存在的文件，读路径只上锁不 mkdir。
 *   · **错误从 `drainErrors()` 取**：SDK 的 `save()` 不 throw，写失败只进 `drainErrors()`。
 *   · **读不出来就报错**（`ContextBudgetReadError` → HTTP 422），照
 *     `lib/models-config-store.ts` 那条「解析失败被吞成空配置、下一次保存抹掉全部 provider」
 *     的教训：文件坏掉时宁可让控件点不动并说清原因。
 *
 * ## `modelOverrides` 的真实形状（别按字面猜）
 *
 * 它**不是**「用哪个模型去做压缩」——0.87 根本没有 comp压模型这个设置（全树
 * `grep -n "compactionModel" dist/` 零命中）。它是
 * `Record<"<provider>/<id>", { reserveTokens?, keepRecentTokens? }>`：给某个模型一套
 * **不同的 token 预算**，解析顺序是「模型覆盖 → 全局 → 内建默认」
 * （`getCompactionTokenSetting`，`settings-manager.js:566-581`）。键里少给一个字段，
 * 那个字段就跟随全局。
 *
 * **作用域**：只管**全局** `~/.pi/agent/settings.json`。项目级 settings.json 里也能写同名段，
 * 但那是 pi 自己的多项目约定，本产品没有对应的项目设置页，不碰。
 */
import { chmodSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir, SettingsManager } from "@earendil-works/pi-coding-agent";
import lockfile from "proper-lockfile";
import { writePrivateFileAtomicSync } from "./atomic-file";

/** 面板上暴露的四个键 —— 类型与常量本体在 `lib/context-budget-settings-shared.ts`（客户端也要用）。 */
export type {
  CompactionModelOverride,
  ContextBudgetSettings,
  ContextBudgetSettingsResponse,
} from "./context-budget-settings-shared";
export {
  CONTEXT_BUDGET_DEFAULTS,
  CONTEXT_BUDGET_MAX_TOKENS,
  CONTEXT_BUDGET_MODEL_REF,
} from "./context-budget-settings-shared";
import type { CompactionModelOverride, ContextBudgetSettings } from "./context-budget-settings-shared";
import {
  CONTEXT_BUDGET_DEFAULTS,
  CONTEXT_BUDGET_MAX_TOKENS,
  CONTEXT_BUDGET_MODEL_REF,
} from "./context-budget-settings-shared";

/** 面板一次只改一项，所以更新体永远是 `Partial`。 */
export type ContextBudgetUpdate = Partial<ContextBudgetSettings>;

/** settings.json 坏掉 / 不是对象 —— 调用方应据此禁用控件并显示原因（422）。 */
export class ContextBudgetReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContextBudgetReadError";
  }
}

export function contextBudgetSettingsPath(agentDir = getAgentDir()): string {
  return join(agentDir, "settings.json");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 只认非负安全整数且在我们自己定的上界之内；别的（字符串、负数、越界）都当没写 —— 与 SDK 的 `?? 默认` 同口径。 */
function readTokenCount(value: unknown, fallback: number): number {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= 0
    && value <= CONTEXT_BUDGET_MAX_TOKENS
    ? value
    : fallback;
}

/** 只认 `true` / `false`；别的（字符串 "false"、0）都当没写 —— 与 SDK 的 `?? true` 同口径。 */
function readEnabled(value: unknown): boolean {
  return typeof value === "boolean" ? value : CONTEXT_BUDGET_DEFAULTS.enabled;
}

/** 覆盖条目里两个字段都是可选的：只认合法的那个，另一个留 `undefined`（= 跟随全局）。 */
function readOverride(entry: Record<string, unknown>): CompactionModelOverride {
  const override: CompactionModelOverride = {};
  const reserve = readTokenCount(entry.reserveTokens, -1);
  const keep = readTokenCount(entry.keepRecentTokens, -1);
  if (reserve >= 0) override.reserveTokens = reserve;
  if (keep >= 0) override.keepRecentTokens = keep;
  return override;
}

/** 读覆盖表：键要像模型引用、值要是对象、至少有一个字段认得，否则整条丢掉（不做半条覆盖）。 */
export function parseModelOverrides(value: unknown): Record<string, CompactionModelOverride> {
  if (!isRecord(value)) return {};
  const parsed: Record<string, CompactionModelOverride> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!CONTEXT_BUDGET_MODEL_REF.test(key) || !isRecord(entry)) continue;
    const override = readOverride(entry);
    if (override.reserveTokens !== undefined || override.keepRecentTokens !== undefined) {
      parsed[key] = override;
    }
  }
  return parsed;
}

/** 读 `compaction` / `branchSummary` 两段；缺了或类型不对就回落到内建默认，**不抛**（没写 ≠ 写坏）。 */
function parseContextBudgetSections(settings: Record<string, unknown>): ContextBudgetSettings {
  const compaction = isRecord(settings.compaction) ? settings.compaction : {};
  const branchSummary = isRecord(settings.branchSummary) ? settings.branchSummary : {};
  return {
    enabled: readEnabled(compaction.enabled),
    reserveTokens: readTokenCount(compaction.reserveTokens, CONTEXT_BUDGET_DEFAULTS.reserveTokens),
    keepRecentTokens: readTokenCount(
      compaction.keepRecentTokens,
      CONTEXT_BUDGET_DEFAULTS.keepRecentTokens,
    ),
    branchSummaryReserveTokens: readTokenCount(
      branchSummary.reserveTokens,
      CONTEXT_BUDGET_DEFAULTS.branchSummaryReserveTokens,
    ),
    modelOverrides: parseModelOverrides(compaction.modelOverrides),
  };
}

function readSettingsFile(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  // 语法错误也要归到 ContextBudgetReadError：路由靠这个类型分 422 与 500，
  // 裸 SyntaxError 会被当成「服务器炸了」。
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new ContextBudgetReadError(`Invalid settings.json: ${(error as Error).message}`);
  }
  if (!isRecord(parsed)) throw new ContextBudgetReadError("Invalid settings.json: expected an object");
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
  else if (!existsSync(directory)) throw new ContextBudgetReadError("Agent settings directory does not exist");
  const release = await lockfile.lock(settingsPath, { realpath: false, retries: 10 });
  try {
    return await fn(readSettingsFile(settingsPath));
  } finally {
    await release();
  }
}

/** 读当前生效的全局压缩预算。文件坏掉时抛 `ContextBudgetReadError`（调用方转 422）。 */
export async function readContextBudgetSettings(
  settingsPath = contextBudgetSettingsPath(),
): Promise<ContextBudgetSettings> {
  return withSettingsLock(settingsPath, parseContextBudgetSections);
}

function assertTokenCount(name: string, value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > CONTEXT_BUDGET_MAX_TOKENS) {
    throw new TypeError(`${name} must be an integer between 0 and ${CONTEXT_BUDGET_MAX_TOKENS}`);
  }
  return value;
}

/**
 * 校验 PUT 的请求体。只校验**给了的**键（面板一次只改一项），返回同样的部分更新。
 * 未知键、类型错、越界一律抛 `TypeError`，路由转 400。
 *
 * `modelOverrides` 的合并口径写在 `writeContextBudgetSettings` 里，这里只保证它是
 * 「`"<provider>/<id>"` → { 两个可选数字 }」的形状。
 */
export function parseContextBudgetUpdate(body: unknown): ContextBudgetUpdate {
  if (!isRecord(body)) throw new TypeError("Context budget body must be an object");
  const update: ContextBudgetUpdate = {};
  for (const key of Object.keys(body)) {
    if (key === "enabled") {
      if (typeof body.enabled !== "boolean") throw new TypeError("enabled must be a boolean");
      update.enabled = body.enabled;
    } else if (key === "reserveTokens") {
      update.reserveTokens = assertTokenCount("reserveTokens", body.reserveTokens);
    } else if (key === "keepRecentTokens") {
      update.keepRecentTokens = assertTokenCount("keepRecentTokens", body.keepRecentTokens);
    } else if (key === "branchSummaryReserveTokens") {
      update.branchSummaryReserveTokens = assertTokenCount(
        "branchSummaryReserveTokens",
        body.branchSummaryReserveTokens,
      );
    } else if (key === "modelOverrides") {
      if (!isRecord(body.modelOverrides)) throw new TypeError("modelOverrides must be an object");
      const overrides: Record<string, CompactionModelOverride> = {};
      for (const [modelRef, entry] of Object.entries(body.modelOverrides)) {
        if (!CONTEXT_BUDGET_MODEL_REF.test(modelRef)) {
          throw new TypeError(`modelOverrides key must look like "<provider>/<model>": ${modelRef}`);
        }
        if (!isRecord(entry)) throw new TypeError(`modelOverrides["${modelRef}"] must be an object`);
        const parsed: CompactionModelOverride = {};
        if (entry.reserveTokens !== undefined) {
          parsed.reserveTokens = assertTokenCount(
            `modelOverrides["${modelRef}"].reserveTokens`,
            entry.reserveTokens,
          );
        }
        if (entry.keepRecentTokens !== undefined) {
          parsed.keepRecentTokens = assertTokenCount(
            `modelOverrides["${modelRef}"].keepRecentTokens`,
            entry.keepRecentTokens,
          );
        }
        if (entry.reserveTokens === undefined && entry.keepRecentTokens === undefined) {
          // 空条目 = 删掉这个模型的覆盖（UI 上就是「移除」那枚钮）。
          overrides[modelRef] = {};
        } else {
          overrides[modelRef] = parsed;
        }
      }
      update.modelOverrides = overrides;
    } else {
      throw new TypeError(`Unknown context budget setting: ${String(key)}`);
    }
  }
  if (Object.keys(update).length === 0) throw new TypeError("Context budget body is empty");
  return update;
}

/**
 * SDK 没有的 setter：自己按锁读改写。
 *
 * - 三个数是 `compaction` / `branchSummary` 的**顶层键**，逐个替换。
 * - `modelOverrides` **按模型逐条**替换：一条给的是「这个模型覆盖的字段就是这些」，
 *   没给的字段从旧条目里摘掉（于是 SDK 解析时它回落全局）。空条目删掉那个模型；
 *   别的模型一条都不动。表空了就把 `modelOverrides` 键删掉，`compaction` 因此空掉也
 *   一并删掉 —— 不在 settings.json 里攒 `{ compaction: {} }` 这类空壳。
 */
async function writeContextBudgetNumbers(
  update: ContextBudgetUpdate,
  settingsPath: string,
): Promise<void> {
  const touchesTokens = update.reserveTokens !== undefined || update.keepRecentTokens !== undefined
    || update.branchSummaryReserveTokens !== undefined || update.modelOverrides !== undefined;
  if (!touchesTokens) return;
  await withSettingsLock(settingsPath, (settings) => {
    const next: Record<string, unknown> = { ...settings };
    const compaction = isRecord(next.compaction) ? { ...next.compaction } : {};
    const branchSummary = isRecord(next.branchSummary) ? { ...next.branchSummary } : {};
    if (update.reserveTokens !== undefined) compaction.reserveTokens = update.reserveTokens;
    if (update.keepRecentTokens !== undefined) compaction.keepRecentTokens = update.keepRecentTokens;
    if (update.branchSummaryReserveTokens !== undefined) {
      branchSummary.reserveTokens = update.branchSummaryReserveTokens;
    }
    if (update.modelOverrides !== undefined) {
      // 底表取**磁盘上的原样**（不是解析后的那份）：别的模型上有一条我们读不懂的
      // 覆盖（手写的越界值之类），改这一条不能顺手把它抹掉 —— 面板解析不出来的那条
      // 只是暂时不显示，原文照旧留在文件里。
      const merged: Record<string, unknown> = isRecord(compaction.modelOverrides)
        ? { ...compaction.modelOverrides }
        : {};
      for (const [modelRef, override] of Object.entries(update.modelOverrides)) {
        // 覆盖条目的语义是「这一条覆盖的字段就是这些」：只写进去我们给的字段，
        // 于是 SDK 解析时该模型没被覆盖的字段回落全局；空条目 = 删掉这个模型的覆盖。
        const next: Record<string, unknown> = {};
        if (override.reserveTokens !== undefined) next.reserveTokens = override.reserveTokens;
        if (override.keepRecentTokens !== undefined) next.keepRecentTokens = override.keepRecentTokens;
        if (Object.keys(next).length === 0) delete merged[modelRef];
        else merged[modelRef] = next;
      }
      if (Object.keys(merged).length === 0) delete compaction.modelOverrides;
      else compaction.modelOverrides = merged;
    }
    if (Object.keys(compaction).length === 0) delete next.compaction;
    else next.compaction = compaction;
    if (Object.keys(branchSummary).length === 0) delete next.branchSummary;
    else next.branchSummary = branchSummary;
    writePrivateFileAtomicSync(settingsPath, JSON.stringify(next, null, 2));
    // 已有文件可能不是 0600（老版本 / 别的工具建的），补一次权限收敛。
    chmodSync(settingsPath, 0o600);
  }, { createDirs: true });
}

/**
 * SDK 唯一有的那个 setter。`setCompactionEnabled()` 只是标脏 + 入队，真正落盘要 `flush()`；
 * 写失败不会 throw，而是记进 `drainErrors()`（文件读不出来时 `save()` 干脆是空操作）。
 */
async function writeCompactionEnabled(
  enabled: boolean,
  cwd: string,
  agentDir = getAgentDir(),
): Promise<void> {
  const settingsManager = SettingsManager.create(cwd, agentDir);
  settingsManager.setCompactionEnabled(enabled);
  await settingsManager.flush();
  const failure = settingsManager.drainErrors()[0];
  if (failure) {
    throw new ContextBudgetReadError(`Failed to write compaction.enabled: ${failure.error.message}`);
  }
}

/**
 * 部分更新并回读。返回值是**重新从文件读出来的**生效值，而不是提交的值 ——
 * 这样面板上显示的永远是磁盘上的真相（并发改动 / SDK 侧的钳制都看得见）。
 *
 * 顺序：先写四个数字（自己的读改写），再让 SDK 写 `enabled`（它在锁内重新读文件，
 * 只覆盖 `compaction.enabled` 一个键），所以两条路径不会互相抹掉。
 */
export async function writeContextBudgetSettings(
  update: ContextBudgetUpdate,
  options: { cwd?: string; agentDir?: string; settingsPath?: string } = {},
): Promise<ContextBudgetSettings> {
  const agentDir = options.agentDir ?? getAgentDir();
  const settingsPath = options.settingsPath ?? contextBudgetSettingsPath(agentDir);
  await writeContextBudgetNumbers(update, settingsPath);
  if (update.enabled !== undefined) {
    await writeCompactionEnabled(update.enabled, options.cwd ?? process.cwd(), agentDir);
  }
  return readContextBudgetSettings(settingsPath);
}

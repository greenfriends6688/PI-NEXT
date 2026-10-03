// fork:proma-43-automation —— 定时任务的落盘。
/**
 * 存储布局：`~/.pi/agent/automation/automations.json`
 *
 * 三条设计约束：
 *
 * 1. **放在 `~/.pi/agent/` 下的独立子目录**，而不是往 `settings.json` / `mcp.json` 里塞字段。
 *    pi CLI 启动时会扫描 `agentDir` 的已知文件；我们这个目录不在它的清单里，
 *    所以**读写它都不会让 pi 报错**，反过来若混进 `settings.json`，一次手改就能连带把
 *    定时任务清掉（SDK 的 `save()` 是整体覆盖写）。
 * 2. **原子写**：staging 临时文件 + `renameSync`（复用 `lib/atomic-file.ts` 的
 *    `writePrivateFileAtomicSync`，权限 0600）。调度器每 30s 落盘一次，
 *    断电/被杀发生在写一半的概率不低，半截 JSON 会让全部任务连同运行历史一起消失。
 * 3. **读不出来就报错，不静默回落成空列表**（`AutomationStoreReadError` → HTTP 422）。
 *    照 `lib/models-config-store.ts` 那条教训：解析失败被吞成空配置，下一次保存就把
 *    用户全部 provider 抹掉了。定时任务同理，而且它们更贵。
 *
 * 与调度器的关系：本文件只管数据，算术在 `automation-schedule.ts`，生命周期在
 * `automation-scheduler.ts`。三者的分界就是「哪个模块能被 `--experimental-strip-types` 直接测」。
 */
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { writePrivateFileAtomicSync } from "./atomic-file";
import { computeNextRunAt } from "./automation-schedule";
import {
  AUTOMATION_MAX_HISTORY,
  AUTOMATION_MAX_TAKEN_OVER_SESSIONS,
  type Automation,
  type AutomationDraft,
  type AutomationRun,
} from "./automation-types";

/** 索引文件格式版本。结构变了就 bump，旧版本读法走迁移分支。 */
const INDEX_VERSION = 1;

const MAX_INDEX_BYTES = 4 * 1024 * 1024;

/** 索引文件坏掉 / 不是对象 —— 调用方据此禁用控件并说清原因（422）。 */
export class AutomationStoreReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AutomationStoreReadError";
  }
}

interface AutomationsIndex {
  version: number;
  automations: Automation[];
}

/** `~/.pi/agent/automation` —— 目录本身对 pi CLI 是陌生的，所以不会被打扰。 */
export function automationStoreDir(agentDir: string = getAgentDir()): string {
  return join(agentDir, "automation");
}

export function automationIndexPath(agentDir: string = getAgentDir()): string {
  return join(automationStoreDir(agentDir), "automations.json");
}

function normalizeRecord(raw: unknown): Automation | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Partial<Automation>;
  if (typeof record.id !== "string" || !record.id) return null;
  if (typeof record.nextRunAt !== "number" || !Number.isFinite(record.nextRunAt)) return null;
  return {
    ...record,
    id: record.id,
    name: typeof record.name === "string" ? record.name : record.id,
    prompt: typeof record.prompt === "string" ? record.prompt : "",
    active: record.active !== false,
    scheduleType: record.scheduleType ?? "daily",
    intervalMinutes: Number.isFinite(record.intervalMinutes) ? record.intervalMinutes! : 60,
    createdAt: Number.isFinite(record.createdAt) ? record.createdAt! : 0,
    updatedAt: Number.isFinite(record.updatedAt) ? record.updatedAt! : 0,
    nextRunAt: record.nextRunAt,
    runHistory: Array.isArray(record.runHistory) ? record.runHistory : [],
  } as Automation;
}

/** 读磁盘。文件不存在 = 空列表（第一次用）；存在但坏掉 = 抛错。 */
function readIndexFromDisk(path: string): AutomationsIndex {
  if (!existsSync(path)) return { version: INDEX_VERSION, automations: [] };
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    throw new AutomationStoreReadError(
      `read automations: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (text.trim() === "") return { version: INDEX_VERSION, automations: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // 不吞：吞掉就等于下一次保存把用户所有定时任务连历史一起抹平。
    throw new AutomationStoreReadError("automations.json is not valid JSON");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new AutomationStoreReadError("automations.json is not an object");
  }
  const index = parsed as Partial<AutomationsIndex>;
  if (!Array.isArray(index.automations)) {
    throw new AutomationStoreReadError("automations.json has no automations array");
  }
  // 版本比本仓新（用户回滚了版本）→ 原样加载，不覆盖磁盘，避免永久丢数据。
  if (typeof index.version === "number" && index.version > INDEX_VERSION) return index as AutomationsIndex;
  return { version: INDEX_VERSION, automations: index.automations.map(normalizeRecord).filter((a): a is Automation => a !== null) };
}

interface StoreState {
  /** 上次解析出来的 agent 目录；`undefined` = 还没解析过，下次 `getAgentDir()` 现场取。 */
  agentDir?: string;
  index: AutomationsIndex | null;
}

function state(): StoreState {
  const globalStore = globalThis as typeof globalThis & { __piWebAutomationStore?: StoreState };
  // 注意初值不能写 `agentDir: ""`：`resolveAgentDir` 用的是 `??`，空串不是 nullish，
  // 于是 `getAgentDir()` 永远轮不到，路径会退化成相对路径 `automation/automations.json`。
  globalStore.__piWebAutomationStore ??= { index: null };
  return globalStore.__piWebAutomationStore;
}

/** 缓存只在单次调用链里有效：node 的 fs 调用是同步的，不会在读-改-写之间让出事件循环。 */
function resolveAgentDir(agentDir?: string): string {
  return agentDir ?? state().agentDir ?? getAgentDir();
}

function readIndex(agentDir?: string): AutomationsIndex {
  const store = state();
  const resolved = resolveAgentDir(agentDir);
  if (store.agentDir !== resolved) {
    store.agentDir = resolved;
    store.index = null;
  }
  if (!store.index) store.index = readIndexFromDisk(automationIndexPath(resolved));
  return store.index;
}

function writeIndex(index: AutomationsIndex, agentDir?: string): void {
  const store = state();
  const resolved = resolveAgentDir(agentDir);
  mkdirSync(automationStoreDir(resolved), { recursive: true, mode: 0o700 });
  const payload = `${JSON.stringify(index, null, 2)}\n`;
  if (payload.length > MAX_INDEX_BYTES) {
    throw new Error("automation index would exceed the size limit");
  }
  // staging + renameSync：写到一半被杀不会留下半截 json（原子写见 lib/atomic-file.ts）。
  writePrivateFileAtomicSync(automationIndexPath(resolved), payload);
  store.agentDir = resolved;
  store.index = index;
}

/** 丢掉内存缓存（测试与「文件被外部改过」时用）。 */
export function resetAutomationStoreCache(): void {
  state().index = null;
}

/** 全部任务，按创建时间升序（列表顺序稳定）。 */
export function listAutomations(agentDir?: string): Automation[] {
  return [...readIndex(agentDir).automations].sort((a, b) => a.createdAt - b.createdAt);
}

export function getAutomation(id: string, agentDir?: string): Automation | undefined {
  return readIndex(agentDir).automations.find((a) => a.id === id);
}

function replace(automation: Automation, agentDir?: string): Automation {
  const index = readIndex(agentDir);
  let found = false;
  const next = index.automations.map((a) => {
    if (a.id !== automation.id) return a;
    found = true;
    return automation;
  });
  // 注意判的是「有没有命中 id」而不是「长度变没变」：同 id 覆盖写长度不变，
  // 拿长度当条件会把每一次更新都静默丢掉（写盘还是上一版）。
  if (!found) return saveAutomation(automation, agentDir);
  writeIndex({ version: INDEX_VERSION, automations: next }, agentDir);
  return automation;
}

/** 整条覆盖写回（调度器每轮结束、面板改配置都走这里）。 */
export function saveAutomation(automation: Automation, agentDir?: string): Automation {
  const index = readIndex(agentDir);
  if (index.automations.some((a) => a.id === automation.id)) return replace(automation, agentDir);
  writeIndex({ version: INDEX_VERSION, automations: [...index.automations, automation] }, agentDir);
  return automation;
}

function applyDraft(
  automation: Partial<Automation> & Pick<Automation, "id" | "createdAt" | "updatedAt" | "runHistory">,
  draft: AutomationDraft,
  now: number,
): Automation {
  const reschedule = automation.scheduleType !== draft.scheduleType
    || automation.timeOfDay !== draft.timeOfDay
    || automation.dayOfWeek !== draft.dayOfWeek
    || automation.intervalMinutes !== draft.intervalMinutes
    || automation.scheduledAt !== draft.scheduledAt
    || automation.activeWindowStart !== draft.activeWindowStart
    || automation.activeWindowEnd !== draft.activeWindowEnd
    || automation.activeWeekdays?.join(",") !== draft.activeWeekdays?.join(",");

  const next: Automation = {
    ...automation,
    ...draft,
    intervalMinutes: draft.intervalMinutes,
    nextRunAt: automation.nextRunAt ?? 0,
    updatedAt: now,
    runHistory: automation.runHistory ?? [],
  };
  // 调度规则变了 → 立刻重算 nextRunAt，否则改完配置要等到旧锚点才会生效。
  if (reschedule) next.nextRunAt = computeNextRunAt(next, now, { inclusive: true });
  return next;
}

export function createAutomation(draft: AutomationDraft, now: number, agentDir?: string): Automation {
  const id = randomUUID();
  const base = { id, createdAt: now, updatedAt: now, runHistory: [] as AutomationRun[] };
  const record = applyDraft(base, draft, now);
  record.id = id;
  record.createdAt = now;
  record.nextRunAt = computeNextRunAt(record, now, { inclusive: true });
  saveAutomation(record, agentDir);
  return record;
}

export function updateAutomation(
  id: string,
  draft: AutomationDraft,
  now: number,
  agentDir?: string,
): Automation | undefined {
  const existing = getAutomation(id, agentDir);
  if (!existing) return undefined;
  const next = applyDraft(existing, draft, now);
  return saveAutomation(next, agentDir);
}

/** 直接改一个字段（启用/停用、nextRunAt、lastSessionId…）。 */
export function patchAutomation(
  id: string,
  patch: Partial<Automation>,
  agentDir?: string,
): Automation | undefined {
  const existing = getAutomation(id, agentDir);
  if (!existing) return undefined;
  return saveAutomation({ ...existing, ...patch, id: existing.id }, agentDir);
}

export function deleteAutomation(id: string, agentDir?: string): boolean {
  const index = readIndex(agentDir);
  const next = index.automations.filter((a) => a.id !== id);
  if (next.length === index.automations.length) return false;
  writeIndex({ version: INDEX_VERSION, automations: next }, agentDir);
  return true;
}

/** 追加一条运行记录并截断历史（调度器与手动「立即运行」共用）。 */
export function appendRun(
  id: string,
  run: AutomationRun,
  agentDir?: string,
): Automation | undefined {
  const existing = getAutomation(id, agentDir);
  if (!existing) return undefined;
  const history = [...(existing.runHistory ?? []), run];
  return saveAutomation(
    {
      ...existing,
      runHistory: history.slice(-AUTOMATION_MAX_HISTORY),
      lastAttemptAt: run.runAt,
    },
    agentDir,
  );
}

/** 把一个子会话标记成「用户接管过」——之后不再复用（规则三）。 */
export function markSessionTakenOver(
  id: string,
  sessionId: string,
  agentDir?: string,
): Automation | undefined {
  const existing = getAutomation(id, agentDir);
  if (!existing) return undefined;
  const taken = [...new Set([...(existing.takenOverSessionIds ?? []), sessionId])];
  return saveAutomation(
    { ...existing, takenOverSessionIds: taken.slice(-AUTOMATION_MAX_TAKEN_OVER_SESSIONS) },
    agentDir,
  );
}
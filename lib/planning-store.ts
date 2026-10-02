/**
 * fork:proma-44-planning —— 五类数据的落盘层（`~/.pi/agent/planning/`）。
 *
 * 落在 pi 的 agent 目录里，但**与 pi CLI 无关**：
 *
 * - 目录名叫 `planning/`，下面只有我们自己的 `store.json` 与 `README.md`，没有
 *   `config.toml` / `settings.json` / `*.jsonl` 这些 pi 会去解析的形状。pi CLI
 *   遍历 agent 目录时**不报错也不提示** —— 这一点是刻意保持的：往 agent 目录塞
 *   自己的数据是本仓既有的做法（`pi-web-preferences.json`、`models-store.json`、
 *   `attachments/`），再造一个 pi 会去校验的 schema 才是真的会被上游改动打断。
 * - 原子写用 `writePrivateFileAtomicSync`（同目录 0600 临时文件 + `renameSync`），
 *   与本仓其它 JSON 状态同一套。写到一半断电不会留下半截文件。
 * - 读失败一律**当作空库**（记一行日志），不抛：数据文件被手改坏时工作区要能打开。
 *   唯一抛的是「路径不是文件」以外的硬错，写的时候才抛。
 *
 * 目录里另放一个 `README.md`，把「这个目录归 pi-web、与 pi CLI 无关」写成人能读的
 * 一行 —— 半年后有人在 `~/.pi/agent/` 里翻到这个目录时，不用猜。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { writePrivateFileAtomicSync } from "./atomic-file";
import { normalizePlanningState } from "./planning-state";
import type { PlanningState } from "./planning-types";

const STORE_FILE = "store.json";
const README_FILE = "README.md";

const README_TEXT = [
  "# planning/",
  "",
  "Pi Web 的 Todo / 日程工作区数据（fork:proma-44-planning）。",
  "",
  "这个目录**归 pi-web 所有**，pi CLI 不读它、也不需要认识它：里面既没有",
  "`settings.json`，也没有 `*.jsonl` 会话文件。删掉它只会清空任务与日程。",
  "",
  "· `store.json` —— 五类数据（todos / calendar_events / groups / tags / reminders），",
  "  单文件、原子写。字段说明见 `lib/planning-types.ts`。",
  "",
].join("\n");

export function planningDir(): string {
  return join(getAgentDir(), "planning");
}

export function planningStorePath(): string {
  return join(planningDir(), STORE_FILE);
}

function ensureDir(): string {
  const dir = planningDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const readme = join(dir, README_FILE);
  if (!existsSync(readme)) writeFileSync(readme, README_TEXT, "utf8");
  return dir;
}

/** 读整个库。文件不存在 / 不是 JSON / 顶层不是对象 → 空库。 */
export function readPlanningState(): PlanningState {
  const path = planningStorePath();
  if (!existsSync(path)) return normalizePlanningState(null);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    console.warn("[planning] store.json 读不出来，按空库处理：", path);
    return normalizePlanningState(null);
  }
  return normalizePlanningState(raw);
}

export function writePlanningState(state: PlanningState): void {
  ensureDir();
  writePrivateFileAtomicSync(planningStorePath(), `${JSON.stringify(state, null, 2)}\n`);
}

// ---------------------------------------------------------------------------
// 串行化的读改写
// ---------------------------------------------------------------------------

// Next 的热重载会重跑模块级代码，所以锁挂在 globalThis 上，否则每次热重载都会
// 造一把新锁，两个副本同时写同一个文件。同一把锁的形状与 `lib/rpc-manager.ts`
// 的 `__piStartLocks` 一致。
declare global {
  var __piPlanningWrites: Promise<unknown> | undefined;
}

/**
 * 读 → 改 → 原子写，中间不放手。
 *
 * 提醒调度器与用户操作会同时改同一个文件（用户点了确认，tick 正好在写
 * `lastNotifiedAt`），所以这条链必须是串行的。链本身不缓存状态：每次都重新读盘，
 * 免得长时间运行的进程拿着三天前的内存。
 */
export function mutatePlanningState<T>(mutate: (state: PlanningState) => T): Promise<T> {
  const previous = globalThis.__piPlanningWrites ?? Promise.resolve();
  const next = previous.then(
    () => {
      const state = readPlanningState();
      const result = mutate(state);
      writePlanningState(state);
      return result;
    },
    () => {
      // 前一次写失败不能把队列堵死：照样读改写。
      const state = readPlanningState();
      const result = mutate(state);
      writePlanningState(state);
      return result;
    },
  );
  globalThis.__piPlanningWrites = next.catch(() => undefined);
  return next;
}

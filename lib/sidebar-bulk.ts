/**
 * fork:pi-1.1 —— 侧栏的批量动作与「显示更多」分页，纯函数（上游
 * `lib/session-tree.ts` 的 `familiesToArchive` / `visibleFamilies` / `showMoreFamilies`）。
 *
 * 单独一个模块而不是塞进 3000 行的 `SessionSidebar.tsx`：这些规则（谁算「该归档」、
 * 每次显示多少、置顶与运行中的行不该被折叠掉）都能不起 DOM 直接测。
 */

import { listSessionFamilies } from "./session-family";
import { isArchivedAndQuiet, isPinnedSession, type SessionFlags } from "./session-flags";
import type { SessionInfo } from "./types";

/** 项目菜单里「归档 N 天前的会话」的天数。 */
export const ARCHIVE_OLDER_THAN_MS = 7 * 24 * 60 * 60 * 1000;

/** 一个项目分组默认显示多少个家族，点一次「显示更多」多显示多少。 */
export const GROUP_VISIBLE_LIMIT = 6;
export const SHOW_MORE_STEP = 20;
/** 置顶分区自己的上限（置顶是用户挑出来的，给得多一些）。 */
export const PINNED_VISIBLE_LIMIT = 8;

export interface FamilyStatusInput {
  runningIds: ReadonlySet<string>;
  unreadIds: ReadonlySet<string>;
  selectedSessionId?: string | null;
}

function familyMemberIds(family: { root: SessionInfo; subagents: SessionInfo[] }): string[] {
  return [family.root.id, ...family.subagents.map((session) => session.id)];
}
/**
 * 「归档 N 天前的会话」要归档哪些：**家族根 id**。
 *
 * 排除项与上游一致：已归档（含自动回归判定）、被置顶、有成员在跑、有未读、
 * 当前选中的那个、以及还没落盘（没有 `path`）的会话。`latestModified` 早于
 * `now - olderThanMs` 才算「旧」。
 */
export function familiesOlderThan(
  sessions: readonly SessionInfo[],
  flags: SessionFlags,
  status: FamilyStatusInput,
  olderThanMs: number = ARCHIVE_OLDER_THAN_MS,
  now: number = Date.now(),
): string[] {
  const cutoff = now - olderThanMs;
  const ids: string[] = [];
  for (const family of listSessionFamilies(sessions)) {
    const members = familyMemberIds(family);
    // 归档是按家族根记的（子代理跟着根走）。
    if (isArchivedAndQuiet(family.root, flags)) continue;
    if (isPinnedSession(family.root.id, flags)) continue;
    if (members.some((id) => status.runningIds.has(id))) continue;
    if (members.some((id) => status.unreadIds.has(id))) continue;
    if (status.selectedSessionId && members.includes(status.selectedSessionId)) continue;
    // 还没落盘（新建但没发消息）：没有文件，归档它没有意义。
    if (!family.root.path) continue;
    const modified = Date.parse(family.latestModified);
    if (!Number.isFinite(modified) || modified >= cutoff) continue;
    ids.push(family.root.id);
  }
  return ids;
}

/**
 * 每个分组「显示更多」展开到了多少。key：项目 key，以及置顶分区的
 * `PINNED_MORE_KEY`。
 */
export type MoreShown = Readonly<Record<string, number>>;
export const PINNED_MORE_KEY = "__pinned__";

export function shownMoreFor(more: MoreShown, key: string): number {
  if (!Object.hasOwn(more, key)) return 0;
  const value = more[key];
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/** 点一次「显示更多」：该分组多显示 SHOW_MORE_STEP 个。 */
export function showMoreFamilies(more: MoreShown, key: string): Record<string, number> {
  return { ...more, [key]: shownMoreFor(more, key) + SHOW_MORE_STEP };
}

/** 「收起」：回到基础上限。 */
export function showLessFamilies(more: MoreShown, key: string): Record<string, number> {
  if (!Object.hasOwn(more, key)) return more as Record<string, number>;
  const next = { ...more };
  delete next[key];
  return next;
}

/**
 * 前 `limit` 个家族，加上**运行中 / 未读 / 选中**的后面的家族，再加上 `extra` 个
 * 其余家族（保持排序）。会自己显示的家族不占 `extra` 名额，所以每次「显示更多」
 * 恰好多出 SHOW_MORE_STEP 行；`revealed` 数出 `extra` 实际显示了几个。
 */
export function visibleFamilies<T>(
  families: readonly T[],
  limit: number,
  extra: number,
  isSpecial: (family: T) => boolean,
): { visible: T[]; revealed: number } {
  let revealed = 0;
  const visible = families.filter((family, index) => {
    if (index < limit) return true;
    if (isSpecial(family)) return true;
    if (revealed < extra) {
      revealed += 1;
      return true;
    }
    return false;
  });
  return { visible, revealed };
}

/** 「显示更多 · N」那一行要显示什么；null = 这一组不需要那一行。 */
export function moreRowState(
  total: number,
  visible: number,
  revealed: number,
): { hidden: number; canShowLess: boolean } | null {
  const hidden = total - visible;
  const canShowLess = revealed > 0;
  return hidden > 0 || canShowLess ? { hidden, canShowLess } : null;
}

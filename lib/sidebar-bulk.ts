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

/** 一次 POST /api/sessions/delete 最多带多少个 id（与服务端 MAX_SESSION_DELETE_IDS 对齐）。 */
export const PROJECT_DELETE_IDS_PER_REQUEST = 500;

/**
 * 一个项目的「删除全部会话」要删哪些：**家族根 id**，以及会因在跑而被保留的家族数。
 *
 * fork:upstream-0.12-sidebar-parity —— 传进来的是**已经按项目过滤好**的会话（#1182）。
 * 排除还没落盘（transient）的；有成员在跑（或等待输入）的整个家族保留并计数，
 * 与服务端 `keepRunning` 同一口径。
 */
export function familiesToDelete(
  sessions: readonly SessionInfo[],
  status: FamilyStatusInput & { awaitingIds?: ReadonlySet<string> },
): { ids: string[]; running: number } {
  const ids: string[] = [];
  let running = 0;
  for (const family of listSessionFamilies(sessions)) {
    if (family.root.transient) continue;
    const members = familyMemberIds(family);
    if (members.some((id) => status.runningIds.has(id) || status.awaitingIds?.has(id))) {
      running += 1;
      continue;
    }
    ids.push(family.root.id);
  }
  return { ids, running };
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

/** 点一次「显示更多」：该分组多显示 SHOW_MORE_STEP 个（位置窗口，见 visibleFamilies）。 */
export function showMoreFamilies(more: MoreShown, key: string, nextShown: number): Record<string, number> {
  return { ...more, [key]: Math.max(shownMoreFor(more, key), Math.floor(nextShown)) };
}

/**
 * 一个显式折叠动作关掉的那些分组的窗口：再展开时只显示首行，不回到它原来的窗口。
 * `keys` 为 null 时覆盖 `choices` 里的每一个。
 */
export function forgetShownMoreOfFolded(
  more: MoreShown,
  choices: Readonly<Record<string, boolean>>,
  keys: readonly string[] | null,
): Record<string, number> {
  const folded = (keys ?? Object.keys(choices)).filter((key) => choices[key] === false && Object.hasOwn(more, key));
  if (folded.length === 0) return more as Record<string, number>;
  const next = { ...more };
  for (const key of folded) delete next[key];
  return next;
}

/** 「收起」：回到基础上限。 */
export function showLessFamilies(more: MoreShown, key: string): Record<string, number> {
  if (!Object.hasOwn(more, key)) return more as Record<string, number>;
  const next = { ...more };
  delete next[key];
  return next;
}

/**
 * 前 `limit` 个家族，加上「显示更多」打开的 `shown` 个**位置**，再加上窗口之后任何
 * 运行中 / 未读 / 选中的家族（保持排序）。
 *
 * fork:upstream-0.12-sidebar-parity —— 是**位置**不是预算：窗口内某个家族变成选中 /
 * 未读 / 运行中时保持原位、不腾出名额，所以点开最后一行后再选它不会把下面更旧的一行
 * 顶上来（#51dda7c5）。`revealed` 只数窗口显示的几行（「收起」要折回的）；
 * `nextShown` 是「显示更多」点击时打开的位置窗口：再 SHOW_MORE_STEP 个隐藏家族
 * （本来就会显示的不占名额），或剩余全部。
 */
export function visibleFamilies<T>(
  families: readonly T[],
  limit: number,
  shown: number,
  isSpecial: (family: T) => boolean,
): { visible: T[]; revealed: number; nextShown: number } {
  const flagged = families.map((family, index) => index >= limit && isSpecial(family));
  const end = limit + shown;
  let revealed = 0;
  const visible = families.filter((_family, index) => {
    if (index < limit || flagged[index]) return true;
    if (index < end) {
      revealed += 1;
      return true;
    }
    return false;
  });
  let next = Math.max(limit, Math.min(end, families.length));
  for (let hidden = 0; next < families.length && hidden < SHOW_MORE_STEP; next += 1) {
    if (!flagged[next]) hidden += 1;
  }
  return { visible, revealed, nextShown: next - limit };
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

/**
 * fork:proma-38-tab-mru — 关掉当前 tab 之后，焦点回到**这个会话上一次访问过的
 * tab**，而不是相邻位置或第一个。
 *
 * 数据结构就是计划里写的那一个：`Map<sessionId, tabId>` —— 每个会话各记各的
 * 「上一个 tab」，切会话时各用各的（会话键沿用 `lib/workspace-memory.ts` 的
 * `workspaceKeyOf()`，与右栏 tab 记忆同一把钥匙）。
 *
 * 两个容易写错的判定（见 `.test.mjs`）：
 *  · **别跳到已关闭的那个**：记下的上一个 tab 可能就是刚关掉的（用户 A→B→A 又关 A，
 *    记下的还是 B 才对；但 A→B 后直接关 B，记的就是 B）。所以候选必须既不是
 *    `closedTabId`、又在仍然打开的集合里。
 *  · **切会话不串味**：换会话时前后两个 tab 属于不同会话，不能把上一个会话的 tab
 *    记成这一个会话的「上一个」，所以 `rememberTabVisit()` 要拿 `previousSessionKey`
 *    一起比。
 *
 * MRU 答不出来时**不猜**：返回 `fallbackId`（就是原来的相邻/末尾行为），所以这个
 * 改动在只有一格 MRU 的情况下也只会比旧行为更贴近用户意图，不会更差。
 */

/** MRU 表：`sessionKey` → 该会话上一次离开时所在（或离开前所在的）tab。 */
export type TabMru = ReadonlyMap<string, string>;

export const EMPTY_TAB_MRU: TabMru = new Map<string, string>();

export interface RememberTabVisitInput {
  /** 现在的会话键（`workspaceKeyOf()` 的结果；null = 没开会话的工作区）。 */
  sessionKey: string | null;
  /** 上一次渲染时的会话键 —— 与当前不同就说明刚切了会话，不记。 */
  previousSessionKey: string | null;
  /** 上一次渲染时的激活 tab。 */
  previousTabId: string | null;
  /** 这一次的激活 tab。 */
  currentTabId: string | null;
}

/**
 * 记一次「访问」。返回新表；**不产生记忆时原样返回**（引用相同），调用方可以放心
 * 拿返回值直接 `setState`，不会因为恒等而白白重渲。
 */
export function rememberTabVisit(mru: TabMru, {
  sessionKey,
  previousSessionKey,
  previousTabId,
  currentTabId,
}: RememberTabVisitInput): TabMru {
  if (!sessionKey || !currentTabId) return mru;
  if (sessionKey !== previousSessionKey) return mru;
  if (!previousTabId || previousTabId === currentTabId) return mru;
  if (mru.get(sessionKey) === previousTabId) return mru;
  const next = new Map(mru);
  next.set(sessionKey, previousTabId);
  return next;
}

export interface FocusAfterCloseInput {
  /** 当前会话键（null 表示还没开会话，MRU 里查不到 → 直接用 fallback）。 */
  sessionKey: string | null;
  /** 刚被关掉的 tab id。 */
  closedTabId: string;
  /** 关闭之后**仍然打开**的 tab id（全部种类的 tab，不只是同一类）。 */
  openTabIds: readonly string[];
  /** MRU 答不出来时的答案（旧行为：相邻 / 末尾）。 */
  fallbackId: string | null;
}

/**
 * 关掉 `closedTabId` 之后焦点去哪。
 *
 * MRU 命中且**不是刚关掉的那个**、且仍在打开集合里 → 去它（用户要的「回到上次
 * 去过的地方」）。否则退回 `fallbackId`（它要仍在打开集合里，否则取打开集合的第
 * 一个）；都没有就是 `null`（右栏该空了）。
 */
export function focusAfterClose(mru: TabMru, {
  sessionKey,
  closedTabId,
  openTabIds,
  fallbackId,
}: FocusAfterCloseInput): string | null {
  const open = new Set(openTabIds);
  const remembered = sessionKey ? mru.get(sessionKey) : undefined;
  if (remembered && remembered !== closedTabId && open.has(remembered)) return remembered;
  if (fallbackId && fallbackId !== closedTabId && open.has(fallbackId)) return fallbackId;
  return openTabIds[0] ?? null;
}
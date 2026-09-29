/**
 * 会话列表的分组。
 *
 * fork:flat-sessions（2026-09-29，用户裁定）—— 会话列表**不再按时间分桶**。
 * 上一版按「今天 / 昨天 / 本周 / 本月 / 更早」把会话切成五段（PR-03），
 * 用户明确要求去掉这类分类：会话直接列在所属项目（或分支）行下面，
 * 与画板 `02-sidebar-topbar.html` 的项目 pane 一致。唯一保留的分组是
 * **置顶**——它是用户自己标的，不是时间的函数。
 *
 * 本模块的返回形状（扁平条目数组，头部与条目各占一个槽位）**必须保持**：
 * 侧栏的虚拟列表按「槽位」计算每一行的绝对定位偏移，分组头也强制同高
 * （见 `SESSION_LIST_ITEM_HEIGHT`）。所以这里不是「简化成数组」，而是
 * 「只有 pinned 一个桶的分组」。
 */

/** 现在只剩置顶一个桶；保留类型别名是为了让折叠状态与头部渲染的签名不变。 */
export type TimeBucket = "pinned";

/** 扁平化后的“分组头”条目，渲染成一行可点击的表头。 */
export interface TimeGroupHeaderEntry {
  type: "header";
  bucket: TimeBucket;
  /** 该桶内的条目数（折叠时也显示，方便知道里面有多少条）。 */
  count: number;
}

/** 扁平化后的普通条目，`item` 由调用方决定（侧栏里是 SessionFamily）。 */
export interface TimeGroupItemEntry<T> {
  type: "item";
  item: T;
}

export type TimeGroupEntry<T> = TimeGroupHeaderEntry | TimeGroupItemEntry<T>;

/**
 * 置顶的排在最前，其余按传入顺序平铺。
 *
 * 同一桶内保持输入顺序（稳定）：`applySessionFlags` 的置顶分区、
 * `sessionSort` 的排序结果都不会被打乱。
 *
 * 折叠的置顶桶只输出头部、不输出条目——行不渲染即“按需加载”。
 */
export function groupByPinned<T>(
  items: readonly T[],
  isPinned: (item: T) => boolean,
  collapsed: Partial<Record<TimeBucket, boolean>> = {},
): TimeGroupEntry<T>[] {
  const pinned: T[] = [];
  const rest: T[] = [];
  for (const item of items) (isPinned(item) ? pinned : rest).push(item);

  const entries: TimeGroupEntry<T>[] = [];
  if (pinned.length > 0) {
    entries.push({ type: "header", bucket: "pinned", count: pinned.length });
    if (!collapsed.pinned) for (const item of pinned) entries.push({ type: "item", item });
  }
  for (const item of rest) entries.push({ type: "item", item });
  return entries;
}

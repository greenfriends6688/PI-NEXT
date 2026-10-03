/**
 * fork:proma-38-tab-reorder — 右栏标签的**拖拽排序**纯逻辑。
 *
 * 为什么单独一个模块：TabBar 里能拖的只有「当前看得见的那几个」（折叠进「…」的
 * tab 在菜单里，没有可量的盒子），而落点判定、落点→邻接 tab 的换算、以及顺序数组
 * 的搬移都必须是**与 DOM 无关**的纯函数才能单测 —— 见 `lib/tab-reorder.test.mjs`。
 *
 * 三条规则：
 *  1. **拖动期间不重排 DOM**。重排会移动每个 tab 的 offsetLeft/offsetWidth，
 *     `lib/tab-overflow.ts` 的折叠判定与 `.fork-tab-pill` 的滑动指示器都靠这些
 *     测量值，一次拖拽会来回抖。所以拖动时只画一条**落点指示线**，松手才换顺序。
 *  2. **落点用指针相对各 tab 的中线判定**（`dropIndexFromPointer`）：落在某个
 *     tab 左半边 → 插到它前面，右半边 → 插到它后面。这是列表重排的通用约定，
 *     与 tab 宽度无关，所以不需要先知道「该 tab 会被移走」再重算一遍。
 *  3. **对外只说「插到谁前面」**（`moveIntent` → `beforeId`）。可见集合是全局
 *     顺序的一个窗口，说绝对下标会让调用方在「有 tab 被折叠」时算错位置；
 *     `beforeId: null` 意思是最末尾。
 */

/** 指针按下到判定为拖拽的位移阈值（px）。小于它仍是一次普通点击（选中 tab）。 */
export const TAB_DRAG_ACTIVATION_PX = 4;

/** 一个 tab 的横向盒子（用 `getBoundingClientRect()` 量，只取需要的两个数）。 */
export interface TabRect {
  left: number;
  width: number;
}

/**
 * 落点下标：0 = 最前面，`rects.length` = 最后面。
 *
 * 判据是**中线**：指针在 tab i 的左半边 → 落在 i，右半边 → 落在 i+1。
 * 空列表恒为 0。
 */
export function dropIndexFromPointer(pointerX: number, rects: readonly TabRect[]): number {
  for (let index = 0; index < rects.length; index += 1) {
    const rect = rects[index]!;
    if (pointerX < rect.left + rect.width / 2) return index;
  }
  return rects.length;
}

/**
 * 落点指示线的 x（与 `.fork-tab-pill` 同一坐标系：标签栏内容盒的左缘为 0）。
 * 下标 0 取第一个 tab 的左缘，超出末位取最后一个 tab 的右缘。
 */
export function dropIndicatorX(rects: readonly TabRect[], index: number): number {
  if (rects.length === 0) return 0;
  const first = rects[0]!;
  const last = rects[rects.length - 1]!;
  if (index <= 0) return first.left;
  if (index >= rects.length) return last.left + last.width;
  return rects[index]!.left;
}

export interface TabMoveIntent {
  /** 落点是否真的改变了顺序（没改就不该回调，省一次重排）。 */
  changed: boolean;
  /** 要插到谁前面；`null` = 移到最后面。`changed` 为 false 时无意义。 */
  beforeId: string | null;
}

/**
 * 把「可见 tab 里的落点下标」换算成「插到谁前面」。
 *
 * `visibleIds` 是**可见**的 tab id（顺序与 `tabs` 一致），`fromIndex` 是被拖的那
 * 个在可见集合里的下标。两个 no-op 要在这里就地消掉：
 *  · 落点 == 自己前面 → `beforeId` 就是自己；
 *  · 落点 == 自己后面那个前面 → 已经在那儿了。
 */
export function moveIntentFor(visibleIds: readonly string[], fromIndex: number, insertIndex: number): TabMoveIntent {
  const draggedId = visibleIds[fromIndex];
  if (!draggedId) return { changed: false, beforeId: null };
  if (insertIndex <= fromIndex) {
    const beforeId = visibleIds[insertIndex] ?? null;
    // insertIndex === fromIndex 时 beforeId 就是自己 —— 还没挪。
    return beforeId === draggedId ? { changed: false, beforeId: null } : { changed: true, beforeId };
  }
  // 落在紧挨着自己的那一位（后面那个 tab 之前 / 末尾之后）同样是没挪。
  if (insertIndex === fromIndex + 1) return { changed: false, beforeId: null };
  const beforeId = insertIndex >= visibleIds.length ? null : (visibleIds[insertIndex] ?? null);
  return { changed: true, beforeId };
}

/**
 * 在一条**完整顺序**（tab id 数组）里把 `tabId` 搬到 `beforeId` 前面。
 *
 * `tabId` 不在顺序里（刚开的 tab）就当作插到 `beforeId` 前面；`beforeId` 为
 * null、自身、或同样不在顺序里 → 落到最后面。返回新数组（不改原数组）。
 */
export function moveTabBefore(order: readonly string[], tabId: string, beforeId: string | null): string[] {
  const rest = order.filter((id) => id !== tabId);
  if (beforeId !== null && beforeId !== tabId) {
    const at = rest.indexOf(beforeId);
    if (at >= 0) return [...rest.slice(0, at), tabId, ...rest.slice(at)];
  }
  return [...rest, tabId];
}

/**
 * 把 `tabs` 按 `order` 排好：**顺序表里有的**按它排，**顺序表里没有的**（后开的
 * tab、或关掉后又被同名 id 重开的）保持原来的相对次序并追加到末尾。
 *
 * 传 `null` = 用户还没拖过，原样返回（拖拽顺序是可选的，default 顺序不变）。
 */
export function applyTabOrder<T extends { id: string }>(tabs: readonly T[], order: readonly string[] | null): T[] {
  if (!order || order.length === 0) return [...tabs];
  const position = new Map<string, number>();
  order.forEach((id, index) => {
    if (!position.has(id)) position.set(id, index);
  });
  const known: T[] = [];
  const unknown: T[] = [];
  for (const tab of tabs) (position.has(tab.id) ? known : unknown).push(tab);
  known.sort((a, b) => position.get(a.id)! - position.get(b.id)!);
  return [...known, ...unknown];
}
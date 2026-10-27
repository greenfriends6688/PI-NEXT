export const VISIBLE_PAGE_SIZE = 50;
export const CHAT_SCROLL_TAIL_TOLERANCE = 8;
export const CHAT_SCROLL_REATTACH_TOLERANCE = 96;

export function getVisibleRenderWindow(totalCount: number, visibleCount: number): {
  startIndex: number;
  hasMore: boolean;
} {
  const clampedVisibleCount = Math.min(Math.max(visibleCount, 0), Math.max(totalCount, 0));
  const startIndex = Math.max(0, totalCount - clampedVisibleCount);
  return { startIndex, hasMore: startIndex > 0 };
}

export function getNextVisibleCount(currentVisibleCount: number, pageSize = VISIBLE_PAGE_SIZE): number {
  return currentVisibleCount + pageSize;
}

export function captureScrollDistance(scrollHeight: number, scrollTop: number): number {
  return scrollHeight - scrollTop;
}

export function restoreScrollTop(scrollHeight: number, savedDistance: number): number {
  return Math.max(0, scrollHeight - savedDistance);
}

export function isScrollAtTail(
  scrollTop: number,
  clientHeight: number,
  scrollHeight: number,
  tolerance = CHAT_SCROLL_TAIL_TOLERANCE,
): boolean {
  return scrollTop + clientHeight >= scrollHeight - tolerance;
}

export function getLiveFollowAttached(
  wasAttached: boolean,
  previousScrollTop: number,
  scrollTop: number,
  clientHeight: number,
  scrollHeight: number,
  reattachTolerance = CHAT_SCROLL_REATTACH_TOLERANCE,
): boolean {
  if (isScrollAtTail(scrollTop, clientHeight, scrollHeight)) return true;
  if (scrollTop < previousScrollTop) return false;
  if (
    !wasAttached
    && scrollTop > previousScrollTop
    && isScrollAtTail(scrollTop, clientHeight, scrollHeight, reattachTolerance)
  ) return true;
  return wasAttached;
}

export function shouldShowScrollToLatest(
  scrollTop: number,
  clientHeight: number,
  scrollHeight: number,
  tolerance = CHAT_SCROLL_TAIL_TOLERANCE,
): boolean {
  if (scrollHeight <= clientHeight) return false;
  return !isScrollAtTail(scrollTop, clientHeight, scrollHeight, tolerance);
}

export function getPromptAnchorSpacerHeight(
  targetTop: number,
  contentEnd: number,
  clientHeight: number,
): number {
  const clampedTargetTop = Math.max(0, targetTop);
  if (clampedTargetTop === 0) return 0;

  return Math.max(0, Math.ceil(
    clampedTargetTop + clientHeight - Math.max(0, contentEnd),
  ));
}

/**
 * 一次画多少条：打开会话先画最近这么多，其余的空闲时再补上。
 *
 * 整份历史都在内存里（没有「更早 N 轮」的按钮），但一次把上千条消息交给
 * React 会把首屏卡住好几秒。分段画：先给最近一屏多，剩下的每次空闲补一批，
 * 直到画完。滚动位置不受影响——补的是列表顶部，浏览器保持当前锚点。
 */
export const FIRST_PAINT_MESSAGES = 60;
/** 每补一批至少加这么多条（下一批实际是翻倍，取两者较大者）。 */
export const IDLE_PAINT_STEP = 120;

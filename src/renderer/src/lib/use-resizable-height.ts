import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MutableRefObject,
  type PointerEvent,
} from "react";

/**
 * Drag-to-resize for the composer card, taken from PI NEXT's `fork:pr23-resize`.
 *
 * The handle sits on the card's **top** edge: drag up to grow, down to shrink. The
 * contract is a nullable height — `null` means "content decides", a number means the user
 * has taken over and the caller pins it as the card's inline `height`.
 *
 * Why the composer needs this at all: the textarea's own growth is capped (a chat box that
 * keeps growing eats the transcript), and the cap has to be small enough for that to be
 * true. Someone pasting a long prompt then wants more room than the cap gives, and the only
 * other answer is scrolling inside a three-line box.
 *
 * Manual mode and the textarea's own auto-grow are made mutually exclusive by the caller:
 * in manual mode it adds `.is-manual-height`, and the stylesheet forces the textarea to
 * `height: 100% !important` so the inline height the auto-grow effect keeps writing cannot
 * push the card back. That is what the `!important` is for — not decoration.
 */

interface DragState {
  pointerId: number;
  startY: number;
  startHeight: number;
  /** Set once the pointer has travelled past the dead zone. */
  moved: boolean;
  previousCursor: string;
  previousUserSelect: string;
}

interface UseResizableHeightOptions {
  /** `aria-label` for the separator. */
  ariaLabel: string;
  /** Hard lower bound, px. */
  minHeight: number;
  /** Upper bound, evaluated on demand so it can follow the viewport. */
  getMaxHeight: () => number;
  /** `localStorage` key the manual height is remembered under. */
  storageKey: string;
  /** The element whose height is being driven (the composer card). */
  targetRef: MutableRefObject<HTMLDivElement | null>;
}

/** A plain click on the handle must not pin the current auto height as a manual one. */
const DRAG_ACTIVATE_THRESHOLD_PX = 3;

function readStoredHeight(storageKey: string): number | null {
  try {
    const stored = window.localStorage.getItem(storageKey);
    if (stored === null) return null;
    const parsed = Number.parseInt(stored, 10);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeStoredHeight(storageKey: string, height: number): void {
  try {
    window.localStorage.setItem(storageKey, String(height));
  } catch {
    // Storage unavailable: the drag still works, it just does not survive a reload.
  }
}

function clearStoredHeight(storageKey: string): void {
  try {
    window.localStorage.removeItem(storageKey);
  } catch {
    // Ignore: the height is still reset for this mount.
  }
}

function clampHeight(candidate: number, minHeight: number, maxHeight: number): number {
  const finite = Number.isFinite(candidate) ? candidate : minHeight;
  return Math.round(Math.max(minHeight, Math.min(Math.max(minHeight, maxHeight), finite)));
}

export function useResizableHeight(options: UseResizableHeightOptions) {
  const { ariaLabel, minHeight, getMaxHeight, storageKey, targetRef } = options;
  const dragRef = useRef<DragState | null>(null);
  const restoredRef = useRef(false);
  const [height, setHeight] = useState<number | null>(null);
  const [isResizing, setIsResizing] = useState(false);
  const heightRef = useRef<number | null>(null);
  heightRef.current = height;

  const effectiveMaxHeight = useCallback(
    () => Math.max(minHeight, getMaxHeight()),
    [getMaxHeight, minHeight],
  );

  const restoreBodyState = useCallback((drag: DragState) => {
    document.body.style.cursor = drag.previousCursor;
    document.body.style.userSelect = drag.previousUserSelect;
  }, []);

  const finishResize = useCallback((pointerId: number) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== pointerId) return;
    dragRef.current = null;
    restoreBodyState(drag);
    setIsResizing(false);
    if (heightRef.current !== null) writeStoredHeight(storageKey, heightRef.current);
  }, [restoreBodyState, storageKey]);

  const onPointerDown = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();

    const activeDrag = dragRef.current;
    if (activeDrag) finishResize(activeDrag.pointerId);

    const target = event.currentTarget;
    target.focus({ preventScroll: true });
    // Pointer capture: move/up keep arriving here even outside the handle or the window.
    target.setPointerCapture(event.pointerId);

    dragRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startHeight: clampHeight(
        targetRef.current?.offsetHeight ?? minHeight,
        minHeight,
        effectiveMaxHeight(),
      ),
      moved: false,
      previousCursor: document.body.style.cursor,
      previousUserSelect: document.body.style.userSelect,
    };
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
    setIsResizing(true);
  }, [effectiveMaxHeight, finishResize, minHeight, targetRef]);

  const onPointerMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (event.pointerType === "mouse" && event.buttons === 0) {
      finishResize(event.pointerId);
      return;
    }
    event.preventDefault();
    const deltaY = event.clientY - drag.startY;
    if (!drag.moved && Math.abs(deltaY) < DRAG_ACTIVATE_THRESHOLD_PX) return;
    drag.moved = true;
    // Handle on the top edge: dragging up (clientY falls) grows the card.
    const clamped = clampHeight(drag.startHeight - deltaY, minHeight, effectiveMaxHeight());
    setHeight(clamped);
    event.currentTarget.setAttribute("aria-valuenow", String(clamped));
    event.currentTarget.setAttribute("aria-valuetext", `${clamped} px`);
  }, [effectiveMaxHeight, finishResize, minHeight]);

  const onPointerUp = useCallback((event: PointerEvent<HTMLDivElement>) => {
    finishResize(event.pointerId);
  }, [finishResize]);

  const onPointerCancel = useCallback((event: PointerEvent<HTMLDivElement>) => {
    finishResize(event.pointerId);
  }, [finishResize]);

  const onLostPointerCapture = useCallback((event: PointerEvent<HTMLDivElement>) => {
    finishResize(event.pointerId);
  }, [finishResize]);

  const resetHeight = useCallback(() => {
    dragRef.current = null;
    setIsResizing(false);
    setHeight(null);
    clearStoredHeight(storageKey);
  }, [storageKey]);

  const setHeightTo = useCallback((next: number) => {
    const clamped = clampHeight(next, minHeight, effectiveMaxHeight());
    setHeight(clamped);
    writeStoredHeight(storageKey, clamped);
  }, [effectiveMaxHeight, minHeight, storageKey]);

  const onKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 64 : 24;
    const current = heightRef.current ?? targetRef.current?.offsetHeight ?? minHeight;
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setHeightTo(current + step);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setHeightTo(current - step);
    } else if (event.key === "Home") {
      event.preventDefault();
      setHeightTo(minHeight);
    } else if (event.key === "End") {
      event.preventDefault();
      setHeightTo(effectiveMaxHeight());
    } else if (event.key === "Enter") {
      // Enter and double-click are the way back to auto height.
      event.preventDefault();
      resetHeight();
    }
  }, [effectiveMaxHeight, minHeight, resetHeight, setHeightTo, targetRef]);

  // Restore the remembered height once, re-clamped against the current viewport.
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    const stored = readStoredHeight(storageKey);
    if (stored !== null) setHeight(clampHeight(stored, minHeight, effectiveMaxHeight()));
  }, [effectiveMaxHeight, minHeight, storageKey]);

  // A shrinking window must not leave a manual height taller than the viewport allows.
  useEffect(() => {
    const onResize = () => {
      if (heightRef.current === null) return;
      const clamped = clampHeight(heightRef.current, minHeight, effectiveMaxHeight());
      if (clamped !== heightRef.current) setHeight(clamped);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [effectiveMaxHeight, minHeight]);

  // Losing focus mid-drag would otherwise leave the cursor stuck on row-resize.
  useEffect(() => {
    if (!isResizing) return;
    const cancelResize = () => {
      const drag = dragRef.current;
      if (drag) finishResize(drag.pointerId);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") cancelResize();
    };
    window.addEventListener("blur", cancelResize);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("blur", cancelResize);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [finishResize, isResizing]);

  useEffect(() => () => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    restoreBodyState(drag);
  }, [restoreBodyState]);

  return {
    height,
    isResizing,
    resetHeight,
    separatorProps: {
      "aria-label": ariaLabel,
      "aria-orientation": "horizontal" as const,
      "aria-valuemax": effectiveMaxHeight(),
      "aria-valuemin": minHeight,
      "aria-valuenow": height ?? minHeight,
      "aria-valuetext": height !== null ? `${height} px` : undefined,
      onDoubleClick: resetHeight,
      onKeyDown,
      onLostPointerCapture,
      onPointerCancel,
      onPointerDown,
      onPointerMove,
      onPointerUp,
      role: "separator" as const,
      tabIndex: 0,
    },
    setHeight: setHeightTo,
  };
}

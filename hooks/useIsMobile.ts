"use client";

import { useSyncExternalStore } from "react";

// Mobile breakpoint shared with app/globals.css (max-width: 640px).
const MOBILE_QUERY = "(max-width: 640px)";
// Narrow phones keep secondary toolbar actions behind the More button.
const NARROW_MOBILE_QUERY = "(max-width: 480px)";
/**
 * fork:pwa-tablet-tier — tablet / small-window tier, and it deliberately **includes** the
 * phone range (so `compact` is true wherever `mobile` is).
 *
 * The desktop chrome does not fit between 641 and 1024px: the composer's control strip is
 * one non-wrapping row, and at 768px it ran 110px past the right edge of the chat column
 * (108 elements overflowing, measured). Phones already collapsed that strip behind a
 * "more controls" button; the tablet tier never had a breakpoint at all, so it fell
 * through to the desktop layout.
 */
const COMPACT_QUERY = "(max-width: 1024px)";

function subscribeToQuery(query: string, cb: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mql = window.matchMedia(query);
  mql.addEventListener("change", cb);
  return () => mql.removeEventListener("change", cb);
}

function queryMatches(query: string): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia(query).matches;
}

const subscribeMobile = (cb: () => void) => subscribeToQuery(MOBILE_QUERY, cb);
const getMobileSnapshot = () => queryMatches(MOBILE_QUERY);
const subscribeNarrowMobile = (cb: () => void) => subscribeToQuery(NARROW_MOBILE_QUERY, cb);
const getNarrowMobileSnapshot = () => queryMatches(NARROW_MOBILE_QUERY);
const subscribeCompact = (cb: () => void) => subscribeToQuery(COMPACT_QUERY, cb);
const getCompactSnapshot = () => queryMatches(COMPACT_QUERY);
/**
 * fork:pwa-landscape-composer — landscape phone (width ≤1024 and height ≤500).
 * There is plenty of width but almost no height: the composer's two-row control
 * strip eats ~40% of the viewport, so it falls back to the single desktop row.
 * The max-height half keeps tablets (portrait heights ≥600) on the two-row strip.
 */
const LANDSCAPE_SHORT_QUERY = "(max-width: 1024px) and (max-height: 500px)";
const subscribeLandscapeShort = (cb: () => void) => subscribeToQuery(LANDSCAPE_SHORT_QUERY, cb);
const getLandscapeShortSnapshot = () => queryMatches(LANDSCAPE_SHORT_QUERY);

function getServerSnapshot(): boolean {
  return false;
}

/**
 * Returns true when the viewport is at or below the mobile breakpoint.
 * SSR-safe: renders as desktop (false) on the server and first client paint,
 * then syncs to the real viewport after hydration.
 */
export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribeMobile, getMobileSnapshot, getServerSnapshot);
}

/** Returns true when the compact mobile toolbar should collapse extra actions. */
export function useIsNarrowMobile(): boolean {
  return useSyncExternalStore(subscribeNarrowMobile, getNarrowMobileSnapshot, getServerSnapshot);
}

/**
 * Returns true at or below the tablet breakpoint (1024px), phones included.
 *
 * Use it for chrome that is a single non-wrapping row and therefore cannot survive a
 * narrow column: the composer's control strip, and the decision to dock the sidebar.
 * Do **not** use it where `isMobile` means "the phone layout" — a single full-screen
 * secondary workspace, an overlay drawer, and the touch-specific affordances stay on
 * `useIsMobile`.
 */
export function useIsCompact(): boolean {
  return useSyncExternalStore(subscribeCompact, getCompactSnapshot, getServerSnapshot);
}

/**
 * Returns true on a landscape phone (≤1024 wide **and** ≤500 tall).
 *
 * Use it only to give back vertical space that the compact tier borrows — today
 * that is the composer's two-row control strip. Do not use it for touch
 * affordances: a landscape phone is still a coarse-pointer device, so 40px hit
 * targets and drawer gestures stay on `useIsMobile` / the `pointer: coarse` CSS.
 */
export function useIsLandscapeShort(): boolean {
  return useSyncExternalStore(subscribeLandscapeShort, getLandscapeShortSnapshot, getServerSnapshot);
}

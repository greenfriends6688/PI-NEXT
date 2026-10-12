"use client";

import { useSyncExternalStore } from "react";
import {
  PLATFORM_BREAKPOINTS,
  PLATFORM_MEDIA,
  type PlatformTier,
} from "@/lib/platform-breakpoints";

// Mobile breakpoint shared with app/globals.css (M0 <= 639px).
const MOBILE_QUERY = PLATFORM_MEDIA.phone;
// Narrow phones keep secondary toolbar actions behind the More button.
const NARROW_MOBILE_QUERY = PLATFORM_MEDIA.narrowPhone;
/**
 * fork:pwa-tablet-tier — tablet / small-window tier, and it deliberately **includes** the
 * phone range (so `compact` is true wherever `mobile` is).
 *
 * The desktop chrome does not fit between 640 and 1023px: the composer's control strip is
 * one non-wrapping row, and at 768px it ran 110px past the right edge of the chat column
 * (108 elements overflowing, measured). Phones already collapsed that strip behind a
 * "more controls" button; the tablet tier never had a breakpoint at all, so it fell
 * through to the desktop layout.
 */
const COMPACT_QUERY = PLATFORM_MEDIA.tabletOrSmaller;

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
 * fork:pwa-landscape-composer — landscape phone (width <=1023 and height <=500).
 * There is plenty of width but almost no height: the composer's two-row control
 * strip eats ~40% of the viewport, so it falls back to the single desktop row.
 * The max-height half keeps tablets (portrait heights ≥600) on the two-row strip.
 */
const LANDSCAPE_SHORT_QUERY = PLATFORM_MEDIA.landscapePhone;
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
 * Returns true in M0 + M1 (<= 1023px), phones included.
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
 * Returns true on a landscape phone (<=1023 wide **and** <=500 tall).
 *
 * Use it only to give back vertical space that the compact tier borrows — today
 * that is the composer's two-row control strip. Do not use it for touch
 * affordances: a landscape phone is still a coarse-pointer device, so 40px hit
 * targets and drawer gestures stay on `useIsMobile` / the `pointer: coarse` CSS.
 */
export function useIsLandscapeShort(): boolean {
  return useSyncExternalStore(subscribeLandscapeShort, getLandscapeShortSnapshot, getServerSnapshot);
}

/** The explicit Apple platform tier used by shell-level layout decisions. */
export function usePlatformTier(): PlatformTier {
  const phone = useIsMobile();
  const tablet = useIsCompact();
  return phone ? "phone" : tablet ? "tablet" : "desktop";
}

export const PLATFORM_WIDTHS = PLATFORM_BREAKPOINTS;

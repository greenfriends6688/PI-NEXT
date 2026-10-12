/**
 * Apple platform layout tiers.
 *
 * The values are deliberately explicit at the boundary:
 *
 *   M0 phone:  0-639px
 *   M1 tablet: 640-1023px
 *   M2 desktop: 1024px+
 *
 * CSS, React and tests must read from this module. Do not duplicate the raw
 * breakpoints in a component or media query.
 */
export const PLATFORM_BREAKPOINTS = {
  phoneMax: 639,
  tabletMin: 640,
  tabletMax: 1023,
  desktopMin: 1024,
  narrowPhoneMax: 480,
  landscapePhoneMaxHeight: 500,
} as const;

export const PLATFORM_MEDIA = {
  phone: `(max-width: ${PLATFORM_BREAKPOINTS.phoneMax}px)`,
  narrowPhone: `(max-width: ${PLATFORM_BREAKPOINTS.narrowPhoneMax}px)`,
  tablet: `(min-width: ${PLATFORM_BREAKPOINTS.tabletMin}px) and (max-width: ${PLATFORM_BREAKPOINTS.tabletMax}px)`,
  tabletOrSmaller: `(max-width: ${PLATFORM_BREAKPOINTS.tabletMax}px)`,
  desktop: `(min-width: ${PLATFORM_BREAKPOINTS.desktopMin}px)`,
  landscapePhone: `(max-width: ${PLATFORM_BREAKPOINTS.tabletMax}px) and (max-height: ${PLATFORM_BREAKPOINTS.landscapePhoneMaxHeight}px)`,
} as const;

export type PlatformTier = "phone" | "tablet" | "desktop";

export function platformTierForWidth(width: number): PlatformTier {
  if (width <= PLATFORM_BREAKPOINTS.phoneMax) return "phone";
  if (width <= PLATFORM_BREAKPOINTS.tabletMax) return "tablet";
  return "desktop";
}

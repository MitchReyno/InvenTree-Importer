/** Layout breakpoints from the design system; "compact" is the masthead and touch-target switch. */
export const media = {
  compact: '@media (max-width: 759.98px)',
  stacked: '@media (max-width: 859.98px)',
  reducedMotion: '@media (prefers-reduced-motion: reduce)',
} as const

/** Exact up to 999, then "999+", so counts never widen a tab. */
export function formatCount(value: number) {
  return value > 999 ? '999+' : String(value)
}

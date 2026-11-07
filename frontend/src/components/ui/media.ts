import { breakpoint } from '../../theme/generated/tokens'

// Below a breakpoint the narrower layout applies; .02px under the value keeps the edge exclusive.
function below(width: number) {
  return `@media (max-width: ${width - 0.02}px)`
}

/** Layout breakpoints from the design system; "compact" is the masthead and touch-target switch. */
export const media = {
  phone: below(breakpoint.phone),
  narrow: below(breakpoint.narrow),
  compact: below(breakpoint.compact),
  stacked: below(breakpoint.stacked),
  wide: below(breakpoint.wide),
  reducedMotion: '@media (prefers-reduced-motion: reduce)',
} as const

/** Exact up to 999, then "999+", so counts never widen a tab. */
export function formatCount(value: number) {
  return value > 999 ? '999+' : String(value)
}

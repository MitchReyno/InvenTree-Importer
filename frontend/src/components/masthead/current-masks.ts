// Mask opacity, not a colour: parts under compact text stay at a quarter strength.
const DIMMED = 'color-mix(in srgb, black 25%, transparent)'

/**
 * Parts show only between the bar's left text and its status controls. The masthead measures
 * the four stops; the fallbacks are the default layout's.
 */
export const barGapMask = `linear-gradient(
  to right,
  transparent 0,
  transparent var(--current-clear-start, 460px),
  black var(--current-opaque-start, 600px),
  black var(--current-opaque-end, calc(100% - 420px)),
  transparent var(--current-clear-end, calc(100% - 300px))
)`

/** The compact bar leaves little room between its ends, so parts dim under the text instead. */
export const compactBarGapMask = `linear-gradient(
  to right,
  ${DIMMED} 0,
  ${DIMMED} 200px,
  black 240px,
  black calc(100% - 200px),
  ${DIMMED} calc(100% - 170px)
)`

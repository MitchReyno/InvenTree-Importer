import { css, keyframes } from 'styled-components'
import { color, duration, easing, offset, space } from '#/theme/generated/tokens'
import { media } from './media'

const pulseFrames = keyframes`
  from { opacity: 0.6; }
  to { opacity: 1; }
`

const spinFrames = keyframes`
  to { transform: rotate(360deg); }
`

const sweepFrames = keyframes`
  to { background-position: -200% 0; }
`

// A ring that grows from the dot and fades, so the dot itself never changes size.
const ringFrames = keyframes`
  0% { box-shadow: 0 0 0 0 color-mix(in srgb, ${color.accent} 45%, transparent); }
  70% { box-shadow: 0 0 0 ${space[4]} color-mix(in srgb, ${color.accent} 0%, transparent); }
  100% { box-shadow: 0 0 0 0 color-mix(in srgb, ${color.accent} 0%, transparent); }
`

const riseIn = keyframes`
  from { opacity: 0; transform: translateY(${offset.enter}); }
  to { opacity: 1; transform: translateY(0); }
`

const fallOut = keyframes`
  from { opacity: 1; transform: translateY(0); }
  to { opacity: 0; transform: translateY(${offset.enter}); }
`

/** The design system's looping animations, each with its own duration and easing. */
export const motion = {
  /** The running step's pulse, between 0.6 and 1 opacity. */
  pulse: css`
    animation: ${pulseFrames} ${duration.pulse} ${easing.loop} infinite alternate;
  `,
  spin: css`
    animation: ${spinFrames} ${duration.spin} ${easing.linear} infinite;
  `,
  /** The "now" dot of a working session: an expanding ring, a still ring under reduced motion. */
  nowRing: css`
    animation: ${ringFrames} ${duration.pulse} ${easing.loop} infinite;
    ${media.reducedMotion} {
      animation: none;
      box-shadow: 0 0 0 ${space[2]} ${color.accentWeak};
    }
  `,
  /** The skeleton shimmer while a preview prepares. */
  sweep: css`
    animation: ${sweepFrames} ${duration.sweep} ${easing.linear} infinite;
  `,
  /** A dialog rising into view as it opens; it closes at once, as the native dialog does. */
  enter: css`
    animation: ${riseIn} ${duration.enter} ${easing.enter};
    ${media.reducedMotion} {
      animation: none;
    }
  `,
  /** A popover or menu opening and closing, keyed on Radix's data-state. */
  popover: css`
    &[data-state='open'] {
      animation: ${riseIn} ${duration.enter} ${easing.enter};
    }
    &[data-state='closed'] {
      animation: ${fallOut} ${duration.exit} ${easing.exit};
    }
    ${media.reducedMotion} {
      &[data-state] {
        animation: none;
      }
    }
  `,
} as const

/** Hover colour, border and brightness changes ease over the fast duration. */
export const hoverTransition = css`
  transition-property: background-color, color, border-color, filter;
  transition-duration: ${duration.fast};
  transition-timing-function: ${easing.linear};
  ${media.reducedMotion} {
    transition: none;
  }
`

/** Stops an element's animation under prefers-reduced-motion. */
export const stillWhenReduced = css`
  ${media.reducedMotion} {
    animation: none;
  }
`

import { css, keyframes } from 'styled-components'
import { duration, easing } from '../../theme/generated/tokens'
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

/** The design system's looping animations, each with its own duration and easing. */
export const motion = {
  /** The running step's pulse, between 0.6 and 1 opacity. */
  pulse: css`
    animation: ${pulseFrames} ${duration.pulse} ${easing.loop} infinite alternate;
  `,
  spin: css`
    animation: ${spinFrames} ${duration.spin} ${easing.linear} infinite;
  `,
  /** The skeleton shimmer while a preview prepares. */
  sweep: css`
    animation: ${sweepFrames} ${duration.sweep} ${easing.linear} infinite;
  `,
} as const

/** Stops an element's animation under prefers-reduced-motion. */
export const stillWhenReduced = css`
  ${media.reducedMotion} {
    animation: none;
  }
`

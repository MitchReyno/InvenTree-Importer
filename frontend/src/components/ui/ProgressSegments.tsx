import styled, { keyframes } from 'styled-components'
import { color, duration, easing, opacity, space } from '#/theme/generated/tokens'
import { media } from './media'
import { WORK_STATE, type WorkState } from './StatePill'
import { useMediaQuery } from './useMediaQuery'
import { VisuallyHidden } from './VisuallyHidden'

export type SegmentState = WorkState

/** `fraction` is the counted ready share; a stage without one shows no invented share. */
export type ProgressStep = { label: string; state: SegmentState; fraction?: number }

type ProgressSegmentsProps = {
  steps: ProgressStep[]
  size?: 'sm' | 'lg'
  /** Draws every bar still, as for a read that is stale or unavailable. */
  still?: boolean
}

/** A counted stage fills to its share; an uncounted done or failed stage fills in full. */
function fillWidth(step: ProgressStep) {
  if (step.fraction !== undefined) {
    return `${Math.round(Math.min(Math.max(step.fraction, 0), 1) * 100)}%`
  }
  if (step.state === 'done' || step.state === 'failed') {
    return '100%'
  }

  return '0%'
}

/** Each state's own pattern, so no two states differ by colour alone. */
export const BAR_PATTERN: Record<WorkState, string> = {
  done: 'solid',
  working: 'stripes',
  waiting_for_you: 'dots',
  paused: 'hatch',
  queued: 'outline',
  not_started: 'faint',
  failed: 'crosshatch',
}

/**
 * Bars are decorative; a visually hidden list carries every step and state. Each state has its
 * own colour and pattern, and only a working stage animates, never under reduced motion.
 */
export function ProgressSegments({ steps, size = 'sm', still = false }: ProgressSegmentsProps) {
  const reducedMotion = useMediaQuery(media.reducedMotion)
  const animate = !still && !reducedMotion

  return (
    <>
      <Segments aria-hidden="true" $size={size}>
        {steps.map((step) => (
          <Segment
            key={step.label}
            data-state={step.state}
            data-pattern={BAR_PATTERN[step.state]}
            data-counted={step.fraction !== undefined}
            data-animated={step.state === 'working' && animate}
            $size={size}
          >
            <i style={{ width: fillWidth(step) }} />
          </Segment>
        ))}
      </Segments>
      <VisuallyHidden as="ul">
        {steps.map((step) => (
          <li key={step.label}>{`${step.label}: ${WORK_STATE[step.state].word.toLowerCase()}`}</li>
        ))}
      </VisuallyHidden>
    </>
  )
}

/** Moves the working stripes along by whole repeats (4px across, at 60deg), so the loop is seamless. */
const sheen = keyframes`
  from { background-position: 0 0; }
  to { background-position: calc(4px / 0.8660254 * 6) 0; }
`

/** A state colour faded for a bar's unfilled track, strong enough to read beside the fill. */
const track = (tone: string) => `color-mix(in srgb, ${tone} 35%, transparent)`

/** Pattern lines drawn over any state's colour, light or dark, on the track and the fill alike. */
const ink = `color-mix(in srgb, ${color.surface} 55%, transparent)`

const lines = (angle: string, width: string) =>
  `repeating-linear-gradient(${angle}, ${ink} 0 ${width}, transparent ${width} calc(${width} * 2))`

const Segments = styled.span<{ $size: 'sm' | 'lg' }>`
  display: flex;
  gap: ${space[1]};
  flex: none;
  width: ${({ $size }) => ($size === 'lg' ? '100%' : 'auto')};
`

const Segment = styled.span<{ $size: 'sm' | 'lg' }>`
  display: block;
  /* literal-allowed: a small segment's width, not a glyph box; no token has this role */
  width: ${({ $size }) => ($size === 'lg' ? 'auto' : '14px')};
  flex: ${({ $size }) => ($size === 'lg' ? '1' : 'none')};
  height: ${({ $size }) => ($size === 'lg' ? '8px' : '6px')};
  border-radius: 2px;
  background: ${color.lineStrong};
  overflow: hidden;
  i {
    display: block;
    height: 100%;
  }
  &[data-state='done'] {
    background-color: ${color.okWeak};
    i {
      background-color: ${color.ok};
    }
  }
  &[data-state='failed'] {
    background-color: ${track(color.bad)};
    i {
      background-color: ${color.bad};
    }
  }
  &[data-state='working'] {
    background-color: ${track(color.accent)};
    i {
      background-color: ${color.accent};
    }
  }
  /* Amber and still: a stage that made progress and waits never looks unstarted. */
  &[data-state='waiting_for_you'] {
    background-color: ${track(color.warn)};
    i {
      background-color: ${color.warn};
    }
  }
  &[data-state='waiting_for_you'][data-counted='false'] {
    background-color: ${color.warn};
  }
  &[data-state='paused'] {
    background-color: ${track(color.muted)};
    i {
      background-color: ${color.muted};
    }
  }
  &[data-state='queued'] {
    background-color: transparent;
    i {
      background-color: ${color.muted};
    }
  }
  /* Fine stripes leaning forward: working, even when still. */
  &[data-pattern='stripes'],
  &[data-pattern='stripes'] i {
    background-image: ${lines('60deg', '2px')};
  }
  &[data-pattern='stripes'][data-animated='true'],
  &[data-pattern='stripes'][data-animated='true'] i {
    animation: ${sheen} ${duration.sweep} ${easing.linear} infinite;
  }
  /* Broad hatching leaning back: paused. */
  &[data-pattern='hatch'],
  &[data-pattern='hatch'] i {
    background-image: ${lines('135deg', '4px')};
  }
  /* Crossed lines: failed. */
  &[data-pattern='crosshatch'],
  &[data-pattern='crosshatch'] i {
    background-image: ${lines('45deg', '1px')}, ${lines('-45deg', '1px')};
  }
  /* Dots: waiting for you. */
  &[data-pattern='dots'],
  &[data-pattern='dots'] i {
    background-image: radial-gradient(circle, ${ink} 0.8px, transparent 1.2px);
    /* literal-allowed: the dot grid's pitch, not a spacing role */
    background-size: 3px 3px;
  }
  &[data-pattern='outline'] {
    box-shadow: inset 0 0 0 1px ${color.lineStrong};
  }
  &[data-pattern='faint'] {
    opacity: ${opacity.muted};
  }
`

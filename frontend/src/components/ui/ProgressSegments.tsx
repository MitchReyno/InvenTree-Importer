import styled, { css, keyframes } from 'styled-components'
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

/** Diagonal stripes of one width on a ground; still, they mark the state without colour alone. */
const stripes = (stripe: string, ground: string, angle: string, width: string) => css`
  background-color: ${ground};
  background-image: repeating-linear-gradient(
    ${angle},
    ${stripe} 0 ${width},
    transparent ${width} calc(${width} * 2)
  );
`

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
    background: ${color.okWeak};
    i {
      background: ${color.ok};
    }
  }
  &[data-state='failed'] {
    background: ${track(color.bad)};
    i {
      background: ${color.bad};
    }
  }
  &[data-state='working'] {
    /* Fine stripes leaning forward: working, even when still. */
    ${stripes(track(color.accent), color.surface2, '60deg', '2px')}
    i {
      ${stripes(color.accentWeak, color.accent, '60deg', '2px')}
    }
  }
  &[data-state='working'][data-animated='true'],
  &[data-state='working'][data-animated='true'] i {
    animation: ${sheen} ${duration.sweep} ${easing.linear} infinite;
  }
  /* Amber and still: a stage that made progress and waits never looks unstarted. */
  &[data-state='waiting_for_you'] {
    background: ${track(color.warn)};
    i {
      background: ${color.warn};
    }
  }
  &[data-state='waiting_for_you'][data-counted='false'] {
    background: ${color.warn};
  }
  &[data-state='paused'] {
    /* Broad hatching leaning back: paused. */
    ${stripes(color.lineStrong, color.surface2, '135deg', '4px')}
    i {
      ${stripes(color.surface2, color.muted, '135deg', '4px')}
    }
  }
  &[data-state='queued'] {
    background: transparent;
    box-shadow: inset 0 0 0 1px ${color.lineStrong};
    i {
      background: ${color.muted};
    }
  }
  &[data-state='not_started'] {
    opacity: ${opacity.muted};
  }
`

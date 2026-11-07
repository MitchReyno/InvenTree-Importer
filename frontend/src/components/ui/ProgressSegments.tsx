import styled from 'styled-components'
import { color, space } from '../../theme/generated/tokens'
import { media } from './media'
import { motion } from './motion'
import { VisuallyHidden } from './VisuallyHidden'

export type StepState = 'done' | 'running' | 'waiting'

export type SegmentState = StepState | 'failed'

export type ProgressStep = { label: string; state: SegmentState; fraction?: number }

type ProgressSegmentsProps = { steps: ProgressStep[]; size?: 'sm' | 'lg' }

const RUNNING_WITHOUT_FRACTION = 0.5

function fillWidth(step: ProgressStep) {
  if (step.state === 'done' || step.state === 'failed') {
    return '100%'
  }
  if (step.state === 'waiting') {
    return '0%'
  }

  return `${Math.round((step.fraction ?? RUNNING_WITHOUT_FRACTION) * 100)}%`
}

/** Bars are decorative; a visually hidden list carries every step and state. */
export function ProgressSegments({ steps, size = 'sm' }: ProgressSegmentsProps) {
  return (
    <>
      <Segments aria-hidden="true" $size={size}>
        {steps.map((step) => (
          <Segment key={step.label} data-state={step.state} $size={size}>
            <i style={{ width: fillWidth(step) }} />
          </Segment>
        ))}
      </Segments>
      <VisuallyHidden as="ul">
        {steps.map((step) => (
          <li key={step.label}>{`${step.label}: ${step.state}`}</li>
        ))}
      </VisuallyHidden>
    </>
  )
}

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
    background: ${color.accent};
  }
  &[data-state='done'] i {
    background: ${color.ok};
  }
  &[data-state='failed'] i {
    background: ${color.bad};
  }
  &[data-state='running'] i {
    ${motion.pulse}
  }
  &[data-state='waiting'] {
    opacity: 0.45;
  }
  ${media.reducedMotion} {
    &[data-state='running'] i {
      animation: none;
    }
  }
`

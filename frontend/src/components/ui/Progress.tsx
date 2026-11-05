import styled, { keyframes } from 'styled-components'
import { color, radius } from '../../theme/generated/tokens'
import { media } from './media'

export type StepState = 'done' | 'running' | 'waiting'

export type ProgressStep = { label: string; state: StepState; fraction?: number }

type ProgressSegmentsProps = { steps: ProgressStep[]; size?: 'sm' | 'lg' }

const RUNNING_WITHOUT_FRACTION = 0.5

function fillWidth(step: ProgressStep) {
  if (step.state === 'done') {
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

export function Spinner({ size = 12 }: { size?: number }) {
  return <SpinnerRing aria-hidden="true" style={{ width: size, height: size }} />
}

export function Skeleton({ width, height }: { width: string; height: string }) {
  return <SkeletonBlock aria-hidden="true" style={{ width, height }} />
}

export const VisuallyHidden = styled.span`
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
`

const pulse = keyframes`
  from { opacity: 0.6; }
  to { opacity: 1; }
`

const rotate = keyframes`
  to { transform: rotate(360deg); }
`

const sweep = keyframes`
  to { background-position: -200% 0; }
`

const Segments = styled.span<{ $size: 'sm' | 'lg' }>`
  display: flex;
  gap: 2px;
  flex: none;
  width: ${({ $size }) => ($size === 'lg' ? '100%' : 'auto')};
`

const Segment = styled.span<{ $size: 'sm' | 'lg' }>`
  display: block;
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
  &[data-state='running'] i {
    animation: ${pulse} 1600ms ease-in-out infinite alternate;
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

const SpinnerRing = styled.span`
  display: inline-block;
  flex: none;
  border: 2px solid currentColor;
  border-right-color: transparent;
  border-radius: 50%;
  animation: ${rotate} 800ms linear infinite;
  ${media.reducedMotion} {
    animation: none;
  }
`

const SkeletonBlock = styled.span`
  display: block;
  border-radius: ${radius.thumb};
  background: linear-gradient(90deg, ${color.surface2}, ${color.line}, ${color.surface2});
  background-size: 200% 100%;
  animation: ${sweep} 1300ms linear infinite;
  ${media.reducedMotion} {
    animation: none;
  }
`

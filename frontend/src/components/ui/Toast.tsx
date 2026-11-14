import { useEffect, useState } from 'react'
import styled, { keyframes } from 'styled-components'
import {
  color,
  duration,
  durationMs,
  easing,
  offset,
  radius,
  shadow,
  size,
  space,
  zIndex,
} from '#/theme/generated/tokens'
import { media } from './media'

type ToastProps = {
  message: string
  action?: { label: string; onClick: () => void }
  durationMs?: number
  onDismiss: () => void
}

const DEFAULT_DURATION_MS = 5000
const EXIT_MS = durationMs.enter

/** Auto-dismisses after its duration; hover or focus pauses the timer. */
export function Toast({
  message,
  action,
  durationMs = DEFAULT_DURATION_MS,
  onDismiss,
}: ToastProps) {
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const paused = hovered || focused

  useEffect(() => {
    if (paused || leaving) {
      return
    }
    const timer = window.setTimeout(() => setLeaving(true), durationMs)
    return () => window.clearTimeout(timer)
  }, [paused, leaving, durationMs])

  // Dismissed once the fade has finished.
  useEffect(() => {
    if (!leaving) {
      return
    }
    const timer = window.setTimeout(onDismiss, EXIT_MS)
    return () => window.clearTimeout(timer)
  }, [leaving, onDismiss])

  return (
    <Body
      data-state={leaving ? 'leaving' : 'open'}
      role="status"
      aria-live="polite"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
    >
      <span>{message}</span>
      {action && (
        <Action type="button" onClick={action.onClick}>
          {action.label}
        </Action>
      )}
    </Body>
  )
}

const enter = keyframes`
  from { opacity: 0; transform: translate(-50%, ${offset.toast}); }
  to { opacity: 1; transform: translate(-50%, 0); }
`

const Body = styled.div`
  position: fixed;
  left: 50%;
  bottom: calc(${space[8]} + var(--sticky-footer-height, 0px) + env(safe-area-inset-bottom, 0px));
  z-index: ${zIndex.toast};
  transform: translateX(-50%);
  display: inline-flex;
  align-items: center;
  gap: ${space[5]};
  max-width: calc(100vw - 2 * ${space[8]});
  padding: calc(${space[5]} - 1px) ${space[7]};
  border-radius: ${radius.card};
  background: ${color.fg};
  color: ${color.bg};
  box-shadow: ${shadow};
  animation: ${enter} ${duration.toast} ${easing.enter};
  &[data-state='leaving'] {
    opacity: 0;
    transition: opacity ${duration.enter} ${easing.enter};
  }
  ${media.compact} {
    width: calc(100vw - 2 * ${space[8]});
  }
  ${media.reducedMotion} {
    &,
    &[data-state='leaving'] {
      animation: none;
      transition: none;
    }
  }
`

const Action = styled.button`
  /* On the inverted fg ground the accent ring is too faint, so focus uses the bg ink. */
  &:focus-visible {
    outline-color: ${color.bg};
  }
  border: 0;
  background: none;
  color: inherit;
  text-decoration: underline;
  cursor: pointer;
  ${media.compact} {
    min-width: ${size.touch};
    min-height: ${size.touch};
  }
`

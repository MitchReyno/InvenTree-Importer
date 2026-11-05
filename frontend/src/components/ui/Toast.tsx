import { useEffect, useState } from 'react'
import styled, { keyframes } from 'styled-components'
import { color, radius, shadow, space } from '../../theme/generated/tokens'
import { media } from './media'

type ToastProps = {
  message: string
  action?: { label: string; onClick: () => void }
  durationMs?: number
  onDismiss: () => void
}

const DEFAULT_DURATION_MS = 5000

/** Auto-dismisses after its duration; hover or focus pauses the timer. */
export function Toast({
  message,
  action,
  durationMs = DEFAULT_DURATION_MS,
  onDismiss,
}: ToastProps) {
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const paused = hovered || focused

  useEffect(() => {
    if (paused) {
      return
    }
    const timer = window.setTimeout(onDismiss, durationMs)
    return () => window.clearTimeout(timer)
  }, [paused, durationMs, onDismiss])

  return (
    <Body
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
  from { opacity: 0; transform: translate(-50%, 8px); }
  to { opacity: 1; transform: translate(-50%, 0); }
`

const Body = styled.div`
  position: fixed;
  left: 50%;
  bottom: calc(16px + var(--sticky-footer-height, 0px) + env(safe-area-inset-bottom, 0px));
  z-index: 50;
  transform: translateX(-50%);
  display: inline-flex;
  align-items: center;
  gap: ${space['2-5']};
  max-width: calc(100vw - 2 * ${space[4]});
  padding: 9px ${space['3-5']};
  border-radius: ${radius.card};
  background: ${color.fg};
  color: ${color.bg};
  box-shadow: ${shadow};
  animation: ${enter} 150ms ease-out;
  ${media.compact} {
    width: calc(100vw - 2 * ${space[4]});
  }
  ${media.reducedMotion} {
    animation: none;
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
    min-width: 44px;
    min-height: 44px;
  }
`

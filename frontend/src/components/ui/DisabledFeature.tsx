import {
  useId,
  type ClipboardEvent,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react'
import styled from 'styled-components'
import { color, opacity, radius, space, typeVar } from '#/theme/generated/tokens'

/** Spread onto each control inside a `DisabledFeature`. */
export type DisabledControlProps = {
  'aria-disabled': 'true'
  'aria-describedby': string
}

type Props = {
  /** One line saying why the control is unavailable and what to do instead. */
  explanation: string
  /** Renders the control (checkbox, select, stepper, text field or button) with these props. */
  children: (control: DisabledControlProps) => ReactNode
}

// Keys that only move focus or the caret, or close something, still work.
const PASSIVE_KEYS = new Set([
  'Tab',
  'Escape',
  'Shift',
  'Control',
  'Alt',
  'Meta',
  'ArrowLeft',
  'ArrowRight',
  'Home',
  'End',
])

function isPassiveKey(event: KeyboardEvent) {
  const shortcut = event.ctrlKey || event.metaKey
  const copyOrSelect = shortcut && (event.key === 'c' || event.key === 'a')

  return PASSIVE_KEYS.has(event.key) || copyOrSelect
}

function refuse(event: { preventDefault(): void; stopPropagation(): void }) {
  event.preventDefault()
  event.stopPropagation()
}

function refuseKey(event: KeyboardEvent) {
  if (!isPassiveKey(event)) {
    refuse(event)
  }
}

/** A press still focuses the control, so its explanation is announced, but never activates it. */
function refusePress(event: MouseEvent) {
  refuse(event)
  if (!(event.target instanceof HTMLElement)) {
    return
  }
  const pressed = event.target.closest<HTMLElement>('[aria-disabled="true"]')
  const labelled = event.target.closest('label')?.control

  ;(pressed ?? labelled)?.focus()
}

/**
 * A deferred control, shown but unavailable. The control keeps `aria-disabled` rather than
 * `disabled`, so it stays focusable and announces the linked explanation. Activation and input are
 * stopped before they reach the control's own handlers, so nothing is sent.
 */
export function DisabledFeature({ explanation, children }: Props) {
  const explanationId = useId()

  return (
    <Wrapper
      data-disabled-feature=""
      onClickCapture={refuse}
      onMouseDownCapture={refusePress}
      onKeyDownCapture={refuseKey}
      onBeforeInputCapture={(event: FormEvent) => refuse(event)}
      onChangeCapture={(event: FormEvent) => refuse(event)}
      onPasteCapture={(event: ClipboardEvent) => refuse(event)}
      onCutCapture={(event: ClipboardEvent) => refuse(event)}
      onDropCapture={(event: DragEvent) => refuse(event)}
    >
      {children({ 'aria-disabled': 'true', 'aria-describedby': explanationId })}
      <Soon>Coming later</Soon>
      <Explanation id={explanationId}>{explanation}</Explanation>
    </Wrapper>
  )
}

const Wrapper = styled.div`
  display: inline-flex;
  flex-direction: column;
  align-items: flex-start;
  gap: ${space[2]};
  padding: ${space[5]} ${space[6]};
  border: 1px dashed ${color.lineStrong};
  border-radius: ${radius.card};
  color: ${color.muted};
  label {
    display: inline-flex;
    gap: ${space[4]};
    align-items: center;
    cursor: not-allowed;
  }
  [aria-disabled='true'] {
    opacity: ${opacity.disabled};
    cursor: not-allowed;
  }
`

const Soon = styled.span`
  font-size: ${typeVar.label.size};
  font-weight: ${typeVar.label.weight};
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: ${color.info};
`

const Explanation = styled.span`
  font-size: ${typeVar.small.size};
`

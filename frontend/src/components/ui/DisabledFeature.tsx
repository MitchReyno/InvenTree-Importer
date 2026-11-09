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

// Keys that only move focus, close something or are a modifier on its own still work.
const PASSIVE_KEYS = new Set(['Tab', 'Escape', 'Shift', 'Control', 'Alt', 'Meta'])

// Caret keys only move the caret in a text field; on a closed select they change its value.
const CARET_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'])

// Chords that edit or activate even with Ctrl or Cmd held.
const EDITING_CHORD_KEYS = new Set(['z', 'y', 'Enter', ' '])

function isTextEntry(target: EventTarget) {
  const textInput =
    target instanceof HTMLInputElement && !['checkbox', 'radio'].includes(target.type)

  return textInput || target instanceof HTMLTextAreaElement
}

/** Browser and app shortcuts (reload, find, Ctrl+K…) pass; anything that edits or activates doesn't. */
function isPassiveKey(event: KeyboardEvent) {
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key
  const chord = event.ctrlKey || event.metaKey

  if (key === 'Backspace' || key === 'Delete') {
    return false
  }
  if (PASSIVE_KEYS.has(key) || /^F\d{1,2}$/.test(key)) {
    return true
  }
  if (CARET_KEYS.has(key)) {
    return isTextEntry(event.target)
  }

  return chord && !EDITING_CHORD_KEYS.has(key)
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

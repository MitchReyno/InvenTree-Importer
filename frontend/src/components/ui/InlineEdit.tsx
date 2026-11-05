import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import styled from 'styled-components'
import { color, font, radius } from '../../theme/generated/tokens'
import { media } from './media'

type InlineEditProps = {
  label: string
  value: string
  onSave: (value: string) => void
  /** What the value looks like when not editing. */
  children: ReactNode
  mono?: boolean
}

/** Swaps the value for a text field in place: Enter saves, Escape cancels, focus returns. */
export function InlineEdit({ label, value, onSave, children, mono = false }: InlineEditProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const trigger = useRef<HTMLButtonElement>(null)
  const returnFocus = useRef(false)

  useEffect(() => {
    if (!editing && returnFocus.current) {
      returnFocus.current = false
      trigger.current?.focus()
    }
  }, [editing])

  function finish() {
    returnFocus.current = true
    setEditing(false)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault()
      onSave(draft)
      finish()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      finish()
    }
  }

  if (editing) {
    return (
      <Field
        aria-label={label}
        value={draft}
        autoFocus
        $mono={mono}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => setEditing(false)}
      />
    )
  }

  return (
    <Trigger
      ref={trigger}
      type="button"
      aria-label={`Edit ${label}: ${value}`}
      onClick={() => {
        setDraft(value)
        setEditing(true)
      }}
    >
      {children}
    </Trigger>
  )
}

const Trigger = styled.button`
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 8px;
  width: 100%;
  padding: 3px 6px;
  margin: 0 -6px;
  border: 1px solid transparent;
  border-radius: 5px;
  background: none;
  text-align: left;
  cursor: text;
  &:hover {
    border-color: ${color.line};
    background: ${color.surface2};
  }
  ${media.compact} {
    min-height: 44px;
  }
`

const Field = styled.input<{ $mono: boolean }>`
  width: 100%;
  min-width: 0;
  padding: 3px 6px;
  border: 1px solid ${color.lineStrong};
  border-radius: ${radius.input};
  background: ${color.surface};
  font-family: ${({ $mono }) => ($mono ? font.mono : 'inherit')};
  ${media.compact} {
    min-height: 44px;
  }
`

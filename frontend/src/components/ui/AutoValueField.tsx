import { useEffect, useId, useRef, useState } from 'react'
import * as Popover from '@radix-ui/react-popover'
import styled from 'styled-components'
import { color, radius, shadow, space } from '../../theme/generated/tokens'
import { Input, Small } from './primitives'

export type AutoValue = { mode: 'auto' } | { mode: 'none' } | { mode: 'manual'; value: string }

type Props = {
  label: string
  type: 'text' | 'date'
  value: AutoValue
  onChange: (value: AutoValue) => void
  disabled?: boolean
  maxLength?: number
  error?: string
}

const choices = [
  { mode: 'auto', label: 'Auto', hint: 'Propose from evidence for review' },
  { mode: 'none', label: 'None', hint: 'Record that there is no value' },
  { mode: 'manual', label: 'Manual', hint: 'Enter the exact value' },
] as const

function display(value: AutoValue) {
  if (value.mode === 'manual') {
    return value.value.trim() || 'Manual, not entered'
  }
  return value.mode === 'auto' ? 'Auto' : 'None'
}

/**
 * Auto/None/Manual choice in a popover. Manual text lives in its own labelled input below the
 * radio choices, never inside an option, so focus and keyboard behaviour stay native.
 */
export function AutoValueField({
  label,
  type,
  value,
  onChange,
  disabled = false,
  maxLength,
  error,
}: Props) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const lastManual = useRef(value.mode === 'manual' ? value.value : '')
  const manualInput = useRef<HTMLInputElement>(null)
  const focusManual = useRef(false)
  const manualLabel = `Manual ${label.toLowerCase()}`

  useEffect(() => {
    if (value.mode === 'manual' && focusManual.current) {
      focusManual.current = false
      manualInput.current?.focus()
    }
  }, [value.mode])

  function choose(mode: AutoValue['mode']) {
    if (mode === 'manual') {
      focusManual.current = true
      onChange({ mode, value: lastManual.current })
    } else {
      onChange({ mode })
    }
  }

  return (
    <Wrapper>
      <Popover.Root open={open && !disabled} onOpenChange={setOpen} modal={false}>
        <Popover.Trigger asChild>
          <Trigger
            type="button"
            disabled={disabled}
            aria-label={`${label}: ${display(value)}`}
            aria-describedby={error ? `${id}-error` : undefined}
            aria-invalid={error ? true : undefined}
          >
            <TriggerLabel>{label}</TriggerLabel>
            <TriggerValue>{display(value)}</TriggerValue>
          </Trigger>
        </Popover.Trigger>
        <Popover.Portal>
          <Content align="start" sideOffset={6} collisionPadding={12}>
            <Choices role="radiogroup" aria-labelledby={`${id}-title`}>
              <Title id={`${id}-title`}>{label}</Title>
              {choices.map((choice) => (
                <Choice key={choice.mode}>
                  <input
                    type="radio"
                    name={id}
                    checked={value.mode === choice.mode}
                    onChange={() => choose(choice.mode)}
                    aria-labelledby={`${id}-${choice.mode}-label`}
                    aria-describedby={`${id}-${choice.mode}-hint`}
                  />
                  <span id={`${id}-${choice.mode}-label`}>{choice.label}</span>
                  <Hint id={`${id}-${choice.mode}-hint`}>{choice.hint}</Hint>
                </Choice>
              ))}
            </Choices>
            {value.mode === 'manual' && (
              <ManualArea>
                <label htmlFor={`${id}-manual`}>{manualLabel}</label>
                <Input
                  ref={manualInput}
                  id={`${id}-manual`}
                  type={type}
                  value={value.value}
                  maxLength={type === 'text' ? maxLength : undefined}
                  onChange={(event) => {
                    lastManual.current = event.target.value
                    onChange({ mode: 'manual', value: event.target.value })
                  }}
                />
              </ManualArea>
            )}
          </Content>
        </Popover.Portal>
      </Popover.Root>
      {error && (
        <Small id={`${id}-error`} role="alert">
          {error}
        </Small>
      )}
    </Wrapper>
  )
}

const Wrapper = styled.div`
  display: grid;
  gap: 6px;
  min-width: 0;
`
const Trigger = styled.button`
  display: grid;
  gap: 2px;
  min-height: 44px;
  width: 100%;
  padding: ${space['1-5']} ${space['2-5']};
  text-align: left;
  color: ${color.fg};
  background: ${color.surface};
  border: 1px solid ${color.lineStrong};
  border-radius: ${radius.btn};
  cursor: pointer;
  &:hover:not(:disabled) {
    background: ${color.surface2};
  }
  &[data-state='open'] {
    border-color: ${color.accent};
    background: ${color.accentWeak};
  }
  &[aria-invalid='true'] {
    border-color: ${color.bad};
  }
  &:disabled {
    cursor: not-allowed;
    color: ${color.muted};
    background: ${color.surface2};
    border-style: dashed;
  }
`
const TriggerLabel = styled.span`
  font-size: 12px;
  color: ${color.muted};
`
const TriggerValue = styled.span`
  font-weight: 550;
  overflow-wrap: anywhere;
`
const Content = styled(Popover.Content)`
  z-index: 1000;
  display: grid;
  gap: 12px;
  width: min(320px, calc(100vw - 24px));
  max-height: min(70vh, var(--radix-popover-content-available-height));
  overflow: auto;
  padding: ${space[3]};
  color: ${color.fg};
  background: ${color.surface};
  border: 1px solid ${color.line};
  border-radius: ${radius.popover};
  box-shadow: ${shadow};
  font-size: 14px;
`
const Choices = styled.div`
  display: grid;
  gap: 4px;
`
const Title = styled.span`
  font-weight: 600;
  margin-bottom: 4px;
`
const Choice = styled.label`
  display: grid;
  grid-template-columns: auto 1fr;
  column-gap: 8px;
  align-items: center;
  min-height: 44px;
  padding: 9px 11px;
  border: 1px solid ${color.lineStrong};
  border-radius: ${radius.btn};
  cursor: pointer;
  &:has(input:checked) {
    border-color: ${color.accent};
    background: ${color.accentWeak};
  }
  input {
    width: 18px;
    height: 18px;
    margin: 0;
  }
`
const Hint = styled.span`
  grid-column: 2;
  font-size: 12px;
  color: ${color.muted};
`
const ManualArea = styled.div`
  display: grid;
  gap: 6px;
  padding-top: 10px;
  border-top: 1px solid ${color.line};
  font-weight: 550;
`

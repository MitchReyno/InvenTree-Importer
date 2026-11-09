import { useEffect, useId, useRef, useState } from 'react'
import * as Popover from '@radix-ui/react-popover'
import styled, { css } from 'styled-components'
import { color, radius, shadow, size, space, typeVar, zIndex } from '#/theme/generated/tokens'
import { Input, Small } from './primitives'
import { media } from './media'
import { hoverTransition } from './motion'

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

const TRIGGER_HINT = { auto: 'Propose from evidence', none: 'No value' } as const

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
            aria-labelledby={`${id}-name ${id}-mode ${id}-hint`}
            aria-describedby={error ? `${id}-error` : undefined}
            aria-invalid={error ? true : undefined}
          >
            <TriggerLabel id={`${id}-name`}>{label}</TriggerLabel>
            <Mode id={`${id}-mode`} $mode={value.mode}>
              {choices.find((c) => c.mode === value.mode)?.label}
            </Mode>
            <TriggerHint id={`${id}-hint`}>
              {value.mode === 'manual'
                ? value.value.trim() || 'Not entered'
                : TRIGGER_HINT[value.mode]}
            </TriggerHint>
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
  justify-items: start;
  align-content: start;
  gap: ${space[3]};
  min-width: 0;
`
const Trigger = styled.button`
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${space[4]};
  max-width: 100%;
  padding: ${space[3]} ${space[5]};
  text-align: left;
  color: ${color.fg};
  background: ${color.surface};
  border: 1px solid ${color.lineStrong};
  border-radius: ${radius.btn};
  cursor: pointer;
  ${hoverTransition}
  &:hover:not(:disabled) {
    background: ${color.surface2};
  }
  &[data-state='open'] {
    border-color: ${color.accent};
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
  ${media.compact} {
    min-height: ${size.touch};
  }
`
const TriggerLabel = styled.span`
  font-size: ${typeVar.small.size};
  font-weight: ${typeVar.bodyStrong.weight};
`
const modes = {
  auto: css`
    color: ${color.accent};
    background: ${color.accentWeak};
  `,
  none: css`
    color: ${color.muted};
    background: ${color.surface2};
  `,
  manual: css`
    color: ${color.fg};
    background: ${color.surface2};
  `,
}
const Mode = styled.span<{ $mode: AutoValue['mode'] }>`
  padding: ${space[1]} ${space[4]};
  border-radius: ${radius.pill};
  font-size: ${typeVar.pill.size};
  font-weight: ${typeVar.pill.weight};
  ${({ $mode }) => modes[$mode]}
`
const TriggerHint = styled.span`
  min-width: 0;
  font-size: ${typeVar.small.size};
  color: ${color.muted};
  overflow-wrap: anywhere;
`
const Content = styled(Popover.Content)`
  z-index: ${zIndex.popover};
  display: grid;
  gap: ${space[6]};
  /* literal-allowed: a 12px viewport gutter either side; no gutter token */
  width: min(320px, calc(100vw - 24px));
  max-height: min(70vh, var(--radix-popover-content-available-height));
  overflow: auto;
  padding: ${space[6]};
  color: ${color.fg};
  background: ${color.surface};
  border: 1px solid ${color.line};
  border-radius: ${radius.popover};
  box-shadow: ${shadow};
  font-size: ${typeVar.body.size};
`
const Choices = styled.div`
  display: grid;
  gap: ${space[2]};
`
const Title = styled.span`
  font-weight: ${typeVar.bodyStrong.weight};
  margin-bottom: ${space[2]};
`
const Choice = styled.label`
  display: grid;
  grid-template-columns: auto 1fr;
  column-gap: ${space[4]};
  align-items: center;
  min-height: ${size.touch};
  padding: calc(${space[5]} - 1px) calc(${space[6]} - 1px);
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
  font-size: ${typeVar.small.size};
  color: ${color.muted};
`
const ManualArea = styled.div`
  display: grid;
  gap: ${space[3]};
  padding-top: ${space[5]};
  border-top: 1px solid ${color.line};
  font-weight: ${typeVar.bodyStrong.weight};
`

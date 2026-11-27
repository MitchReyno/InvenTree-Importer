import styled from 'styled-components'
import type { AgentEffortDto } from '@invimport/contracts'
import { Select } from '#/forms'
import type { EffortChoice } from '#/agents/model-catalog'
import { size } from '#/theme/generated/tokens'

type Props = {
  /** Its accessible name, such as "Research effort". */
  label: string
  options: readonly EffortChoice[]
  /** Absent is Default. */
  value: AgentEffortDto | undefined
  /** Null for a select that only shows what applies, such as a step on Default. */
  onChange: ((effort: AgentEffortDto | undefined) => void) | null
  disabled?: boolean
  describedBy?: string
}

/**
 * The effort sent with a model: a short fixed list per model, so a styled native select, as the
 * dropdown guideline says for one.
 */
export function EffortSelect({
  label,
  options,
  value,
  onChange,
  disabled = false,
  describedBy,
}: Props) {
  return (
    <Control
      aria-label={label}
      aria-describedby={describedBy}
      value={value ?? ''}
      disabled={disabled || onChange === null}
      onChange={(event) => onChange?.(event.target.value === '' ? undefined : event.target.value)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </Control>
  )
}

// As tall as the model picker beside it.
const Control = styled(Select)`
  min-height: ${size.touch};
`

import { useId, type ReactNode } from 'react'
import styled from 'styled-components'
import { color, space, typeVar } from '#/theme/generated/tokens'
import { TextArea } from '#/forms/inputs'
import { DisabledFeature } from './DisabledFeature'

/** InvenTree's description limits: 500 for companies, 250 for every other record that has one. */
export const DESCRIPTION_LIMIT = { company: 500, default: 250 } as const

type DescriptionFieldProps = {
  /** Names the record's description, such as "Part description". */
  label: string
  value: string | null
  limit: number
  /** The value's `SourceChip`, such as "InvenTree · Existing". */
  source?: ReactNode
  /** Makes the description editable; without it the value is read-only. */
  onChange?: (value: string) => void
  /** Holds an editable description while its save is in flight. */
  disabled?: boolean
  /** A description the app cannot store or read yet renders disabled with this reason. */
  disabledReason?: string
}

/** InvenTree counts characters, not UTF-16 units. */
function characters(value: string) {
  return Array.from(value).length
}

/** An InvenTree description with its source and a character count against the record's limit. */
export function DescriptionField({
  label,
  value,
  limit,
  source,
  onChange,
  disabled = false,
  disabledReason,
}: DescriptionFieldProps) {
  const id = useId()
  const text = value ?? ''
  const count = characters(text)
  const over = count > limit

  const meta = (
    <Meta>
      {onChange ? source : <span id={`${id}-label`}>{label}</span>}
      <Count id={`${id}-count`} data-over={over || undefined}>
        {count} / {limit}
        {over && ' · over the limit'}
      </Count>
    </Meta>
  )

  if (disabledReason !== undefined) {
    return (
      <Field>
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        <DisabledFeature explanation={disabledReason}>
          {(disabled) => <TextArea id={id} value={text} readOnly {...disabled} />}
        </DisabledFeature>
      </Field>
    )
  }

  if (onChange) {
    return (
      <Field>
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        <TextArea
          id={id}
          value={text}
          aria-describedby={`${id}-count`}
          aria-invalid={over || undefined}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />
        {meta}
      </Field>
    )
  }

  return (
    <Field role="group" aria-labelledby={`${id}-label`}>
      <Value>
        <span>{text}</span>
        {source}
      </Value>
      {meta}
    </Field>
  )
}

const Field = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${space[2]};
  min-width: 0;
`

const FieldLabel = styled.label`
  font-size: ${typeVar.small.size};
  font-weight: ${typeVar.bodyStrong.weight};
`

const Value = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: ${space[2]} ${space[4]};
  overflow-wrap: anywhere;
`

const Meta = styled.div`
  display: flex;
  align-items: center;
  gap: ${space[4]};
  font-size: ${typeVar.small.size};
  color: ${color.muted};
`

const Count = styled.span`
  margin-left: auto;
  font-variant-numeric: tabular-nums;
  &[data-over='true'] {
    color: ${color.bad};
    font-weight: ${typeVar.bodyStrong.weight};
  }
`

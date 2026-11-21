import { useId } from 'react'
import styled from 'styled-components'
import { space } from '#/theme/generated/tokens'
import type {
  CaptureAssignedLocationChangeDto,
  CaptureAssignedLocationDto,
} from '@invimport/contracts'
import type { Snapshot } from '#/capture/types'
import { Small } from '#/components/ui'
import { Field, Label, Select } from '#/forms'

type Props = {
  label: string
  /** What the assignment applies to, shown as the field's description. */
  scope: string
  value: CaptureAssignedLocationDto | undefined
  batch: Snapshot
  disabled?: boolean
  /** Sits directly in its container instead of in its own field box. */
  inline?: boolean
  onChange: (value: CaptureAssignedLocationChangeDto) => void
}

/**
 * A shared-Part or evidence-group location assignment: none (lower levels apply), explicitly no
 * location, or an observed location. It is an application default, never an inventory field.
 */
export function AssignedLocationField({
  label,
  scope,
  value,
  batch,
  disabled,
  inline,
  onChange,
}: Props) {
  const id = useId()
  const observations = batch.observations.filter((item) => item.model === 'location')
  const current =
    value === undefined ? 'unset' : value.mode === 'set' ? value.value.observation_id : 'clear'
  const Box = inline ? InlineField : Field
  return (
    <Box>
      <Label htmlFor={id}>{label}</Label>
      <Select
        id={id}
        value={current}
        disabled={disabled}
        aria-describedby={`${id}-scope`}
        onChange={(event) => {
          const choice = event.target.value
          const observed = observations.find((item) => item.id === choice)
          onChange(
            observed
              ? {
                  mode: 'set',
                  value: {
                    observation_id: observed.id,
                    target_context_id: observed.target_context_id,
                    model: 'location',
                    pk: observed.pk,
                  },
                }
              : { mode: choice as 'unset' | 'clear' },
          )
        }}
      >
        <option value="unset">No assignment</option>
        <option value="clear">Explicitly no location</option>
        {observations.map((item) => (
          <option key={item.id} value={item.id}>
            {item.label} (#{item.pk}) · observed
          </option>
        ))}
      </Select>
      <Small id={`${id}-scope`}>{scope}</Small>
    </Box>
  )
}

const InlineField = styled.div`
  display: grid;
  gap: ${space[2]};
`

import styled from 'styled-components'
import { space } from '#/theme/generated/tokens'
import type {
  CaptureAssignedLocationChangeDto,
  CaptureAssignedLocationDto,
} from '@invimport/contracts'
import type { Snapshot } from '#/capture/types'
import { ChoicePicker, Field } from '#/forms'

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
  const observations = batch.observations.filter((item) => item.model === 'location')
  const current =
    value === undefined ? 'unset' : value.mode === 'set' ? value.value.observation_id : 'clear'
  const choices = [
    { value: 'unset', label: 'No assignment' },
    { value: 'clear', label: 'Explicitly no location' },
    ...observations.map((item) => ({
      value: item.id,
      label: `${item.label} (#${item.pk}) · observed`,
    })),
  ]

  function choose(choice: string) {
    const observed = observations.find((item) => item.id === choice)
    if (observed) {
      onChange({
        mode: 'set',
        value: {
          observation_id: observed.id,
          target_context_id: observed.target_context_id,
          model: 'location',
          pk: observed.pk,
        },
      })
    } else {
      onChange({ mode: choice === 'clear' ? 'clear' : 'unset' })
    }
  }

  const Box = inline ? InlineField : Field
  return (
    <Box>
      <ChoicePicker
        label={label}
        noun="locations"
        placeholder="Choose a location…"
        choices={choices}
        value={current}
        disabled={disabled}
        status={scope}
        onChange={choose}
      />
    </Box>
  )
}

const InlineField = styled.div`
  display: grid;
  gap: ${space[2]};
`

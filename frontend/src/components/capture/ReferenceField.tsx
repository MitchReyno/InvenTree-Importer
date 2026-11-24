import { Small, Button } from '#/components/ui'
import { ChoicePicker, Field, Input, Label } from '#/forms'
import { useState } from 'react'
import type { CaptureObservationDto } from '@invimport/contracts'
import type { Snapshot, Reference } from '#/capture/types'
import type { CaptureObserve } from '#/capture/types'
type ReferenceFieldProps = {
  title: string
  model: 'part' | 'location'
  value: Reference
  defaults: boolean
  batch: Snapshot
  /** Set by the enclosing form, whose fieldset doesn't reach the picker. */
  disabled?: boolean
  onChange: (value: Reference) => void
  observe: CaptureObserve
}

export function ReferenceField({
  title,
  model,
  value,
  defaults,
  batch,
  disabled,
  onChange,
  observe,
}: ReferenceFieldProps) {
  const [pk, setPk] = useState('')
  const observations = batch.observations.filter((o) => o.model === model)

  function choose(o: CaptureObservationDto) {
    onChange({
      mode: 'set',
      value: {
        observation_id: o.id,
        target_context_id: o.target_context_id,
        model,
        pk: o.pk,
      },
    })
  }

  return (
    <Field>
      <ChoicePicker
        label={`${title} selection`}
        noun={model === 'part' ? 'Parts' : 'locations'}
        placeholder={`Choose a ${title.toLowerCase()}…`}
        choices={[
          ...(defaults ? [] : [{ value: 'inherit', label: 'Use batch default' }]),
          { value: 'unset', label: 'Not selected' },
          { value: 'unknown', label: 'Explicitly unknown' },
          { value: 'clear', label: 'Explicitly clear' },
          ...observations.map((o) => ({ value: o.id, label: `${o.label} (#${o.pk}) · observed` })),
        ]}
        value={value.mode === 'set' ? value.value.observation_id : value.mode}
        disabled={disabled}
        onChange={(choice) => {
          const o = observations.find((o) => o.id === choice)
          if (o) {
            choose(o)
          } else {
            onChange({ mode: choice as 'unset' | 'unknown' | 'clear' | 'inherit' })
          }
        }}
      />
      <Label>
        {title} record ID
        <Input
          inputMode="numeric"
          value={pk}
          onChange={(e) => setPk(e.target.value)}
          placeholder="Existing numeric ID"
        />
      </Label>
      <Button
        type="button"
        onClick={() => {
          void observe(model, pk)
        }}
      >
        Read {title.toLowerCase()}
      </Button>
      <Small>
        Read-only lookup on the server-configured target. Inspect the observed name, then select it.
        A read is not a human selection or approval.
      </Small>
    </Field>
  )
}

import { useState } from 'react'
import type { CaptureLotContextDto } from '@invimport/contracts'
import type { Snapshot } from '#/capture/types'
import { Small, Button } from '#/components/ui'
import { ChoicePicker, Field, Input, Label, Select, TextArea } from '#/forms'
import type { CaptureObserve } from '#/capture/types'

type Props = {
  value: CaptureLotContextDto
  defaults: boolean
  batch: Snapshot
  /** Set by the enclosing form, whose fieldset doesn't reach the picker. */
  disabled?: boolean
  onChange: (value: CaptureLotContextDto) => void
  observe: CaptureObserve
}

type Mode = 'inherit' | 'unset' | 'unknown' | 'clear'

export function CaptureContextFields({
  value,
  defaults,
  batch,
  disabled,
  onChange,
  observe,
}: Props) {
  const [pk, setPk] = useState('')
  const suppliers = batch.observations.filter(
    (item) => item.model === 'company' && item.mapping?.kind === 'company' && item.mapping.supplier,
  )
  const supplier = value.supplier
  return (
    <>
      <Field>
        <ChoicePicker
          label="Supplier selection"
          noun="suppliers"
          placeholder="Choose a supplier…"
          choices={[
            ...(defaults ? [] : [{ value: 'inherit', label: 'Use batch default' }]),
            { value: 'unset', label: 'Not selected' },
            { value: 'unknown', label: 'Explicitly unknown' },
            { value: 'clear', label: 'Explicitly clear' },
            ...suppliers.map((item) => ({
              value: item.id,
              label: `${item.label} (#${item.pk}) · observed supplier`,
            })),
          ]}
          value={supplier.mode === 'set' ? supplier.value.observation_id : supplier.mode}
          disabled={disabled}
          onChange={(choice) => {
            const observed = suppliers.find((item) => item.id === choice)
            const next: CaptureLotContextDto['supplier'] = observed
              ? {
                  mode: 'set',
                  value: {
                    observation_id: observed.id,
                    target_context_id: observed.target_context_id,
                    model: 'company',
                    pk: observed.pk,
                  },
                }
              : { mode: choice as Mode }
            onChange({ ...value, supplier: next })
          }}
        />
        <Label>
          Supplier record ID
          <Input inputMode="numeric" value={pk} onChange={(event) => setPk(event.target.value)} />
        </Label>
        <Button type="button" onClick={() => void observe('company', pk)}>
          Read supplier
        </Button>
        <Small>
          Read an existing supplier on the configured target, then inspect and select it. Capture
          context does not create a supplier or approve an inventory effect.
        </Small>
      </Field>
      <Field>
        <Label>
          Purchase date mode
          <Select
            value={value.purchase_date.mode}
            onChange={(event) =>
              onChange({
                ...value,
                purchase_date:
                  event.target.value === 'set'
                    ? { mode: 'set', value: '' }
                    : { mode: event.target.value as Mode },
              })
            }
          >
            {!defaults && <option value="inherit">Use batch default</option>}
            <option value="unset">Not selected</option>
            <option value="unknown">Explicitly unknown</option>
            <option value="clear">Explicitly clear</option>
            <option value="set">Human calendar date</option>
          </Select>
        </Label>
        {value.purchase_date.mode === 'set' && (
          <Label>
            Purchase date
            <Input
              type="date"
              required
              value={value.purchase_date.value}
              onChange={(event) =>
                onChange({ ...value, purchase_date: { mode: 'set', value: event.target.value } })
              }
            />
          </Label>
        )}
      </Field>
      <Field>
        <Label>
          Capture tags mode
          <Select
            value={value.tags.mode}
            onChange={(event) =>
              onChange({
                ...value,
                tags:
                  event.target.value === 'set'
                    ? { mode: 'set', value: [] }
                    : { mode: event.target.value as Mode },
              })
            }
          >
            {!defaults && <option value="inherit">Use batch default</option>}
            <option value="unset">Not selected</option>
            <option value="unknown">Explicitly unknown</option>
            <option value="clear">Explicitly clear</option>
            <option value="set">Human tags</option>
          </Select>
        </Label>
        {value.tags.mode === 'set' && (
          <Label>
            Capture tags (one per line)
            <TextArea
              value={value.tags.value.join('\n')}
              onChange={(event) =>
                onChange({ ...value, tags: { mode: 'set', value: event.target.value.split('\n') } })
              }
            />
            <Small>
              Up to 32 distinct tags, 100 characters each. These are human capture context; Part
              creation tags are separate choices.
            </Small>
          </Label>
        )}
      </Field>
    </>
  )
}

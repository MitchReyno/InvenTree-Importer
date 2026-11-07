import { useState } from 'react'
import type { CaptureLotContextDto } from '@invimport/contracts'
import type { CaptureWorkspaceProps, Snapshot } from '../../capture/types'
import { Field, Input, Label, Select, Small, TextArea } from '../ui/primitives'
import { Button } from '../ui/Button'

type Props = {
  value: CaptureLotContextDto
  defaults: boolean
  batch: Snapshot
  onChange: (value: CaptureLotContextDto) => void
  observe: CaptureWorkspaceProps['observe']
}

type Mode = 'inherit' | 'unset' | 'unknown' | 'clear'

export function CaptureContextFields({ value, defaults, batch, onChange, observe }: Props) {
  const [pk, setPk] = useState('')
  const suppliers = batch.observations.filter(
    (item) => item.model === 'company' && item.mapping?.kind === 'company' && item.mapping.supplier,
  )
  const supplier = value.supplier
  return (
    <>
      <Field>
        <Label>
          Supplier selection
          <Select
            value={supplier.mode === 'set' ? supplier.value.observation_id : supplier.mode}
            onChange={(event) => {
              const observed = suppliers.find((item) => item.id === event.target.value)
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
                : { mode: event.target.value as Mode }
              onChange({ ...value, supplier: next })
            }}
          >
            {!defaults && <option value="inherit">Use batch default</option>}
            <option value="unset">Not selected</option>
            <option value="unknown">Explicitly unknown</option>
            <option value="clear">Explicitly clear</option>
            {suppliers.map((item) => (
              <option value={item.id} key={item.id}>
                {item.label} (#{item.pk}) · observed supplier
              </option>
            ))}
          </Select>
        </Label>
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

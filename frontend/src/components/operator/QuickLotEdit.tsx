import { useState } from 'react'
import { useForm } from 'react-hook-form'
import type { CaptureSnapshotDto } from '@invimport/contracts'
import { Small, Button } from '#/components/ui'
import { Fieldset, Form, Input, Label, Select } from '#/forms'
import { useReportDirty } from '#/navigation/useReportDirty'
import type { CaptureEdit } from '#/capture/types'

type Lot = CaptureSnapshotDto['lots'][number]
type Mode = 'inherit' | 'set' | 'unknown' | 'clear' | 'unset'

export const QUICK_QUANTITY_INPUT_ID = 'review-quick-quantity'

/** Exact decimal string with up to six fractional digits; matches the shared Quantity scalar. */
const QUANTITY_PATTERN = /^(?=.*[1-9])(0|[1-9][0-9]{0,12})(\.[0-9]{0,5}[1-9])?$/

interface Values {
  quantityMode: Mode
  quantity: string
  /** `mode:<inherit|clear|unknown|unset>` or `observation:<id>`. */
  location: string
}

interface Props {
  batch: CaptureSnapshotDto
  lot: Lot
  disabled: boolean
  edit: CaptureEdit
  onDirtyChange?: (dirty: boolean) => void
}

function initialValues(lot: Lot): Values {
  const location =
    lot.location.mode === 'set'
      ? `observation:${lot.location.value.observation_id}`
      : `mode:${lot.location.mode}`
  return {
    quantityMode: lot.quantity.mode,
    quantity: lot.quantity.mode === 'set' ? lot.quantity.value : '',
    location,
  }
}

/** Whether the form holds anything other than the values the editor opened with. */
function differsFrom(defaults: Values, values: Values) {
  return (Object.keys(defaults) as (keyof Values)[]).some((key) => values[key] !== defaults[key])
}

function quantityChange(values: Values): Lot['quantity'] {
  if (values.quantityMode === 'set') {
    return { mode: 'set', value: values.quantity.trim() }
  }
  return { mode: values.quantityMode }
}

function locationChange(batch: CaptureSnapshotDto, value: string): Lot['location'] {
  const [kind, id] = value.split(':')
  if (kind === 'mode') {
    return { mode: id as Exclude<Mode, 'set'> }
  }
  const observation = batch.observations.find((item) => item.id === id)
  if (!observation) {
    throw new Error('location_observation_missing')
  }
  return {
    mode: 'set',
    value: {
      observation_id: observation.id,
      target_context_id: observation.target_context_id,
      model: 'location',
      pk: observation.pk,
    },
  }
}

/** Lot-only edits: no other lot's review depends on these fields. */
export function QuickLotEdit({ batch, lot, disabled, edit, onDirtyChange }: Props) {
  // The editor's baseline: the lot as it was when the editor opened, then each confirmed save.
  const [defaults, setDefaults] = useState(() => initialValues(lot))
  const {
    register,
    handleSubmit,
    watch,
    reset,
    getValues,
    formState: { errors, isDirty, dirtyFields, isSubmitting },
  } = useForm<Values>({ defaultValues: defaults })
  const quantityMode = watch('quantityMode')
  const locations = batch.observations.filter((item) => item.model === 'location')

  useReportDirty(isDirty, onDirtyChange)

  async function save(values: Values) {
    const quantityTouched = Boolean(dirtyFields.quantityMode || dirtyFields.quantity)
    const saved = await edit({
      kind: 'lot',
      id: lot.id,
      ...(quantityTouched ? { quantity: quantityChange(values) } : {}),
      ...(dirtyFields.location ? { location: locationChange(batch, values.location) } : {}),
    })
    if (saved !== false) {
      setDefaults(values)
      reset(values)
      onDirtyChange?.(false)
    }
  }

  return (
    <Form
      onChange={() => onDirtyChange?.(differsFrom(defaults, getValues()))}
      onSubmit={handleSubmit(save)}
      aria-label={`Edit ${lot.label}`}
    >
      <Fieldset disabled={disabled}>
        <Label>
          Quantity
          <Select {...register('quantityMode')}>
            <option value="set">Exact quantity</option>
            <option value="inherit">Use batch default</option>
            <option value="unknown">Explicitly unknown</option>
            <option value="clear">Explicitly cleared</option>
            <option value="unset">Not selected</option>
          </Select>
        </Label>
        {quantityMode === 'set' && (
          <Label>
            Exact pieces
            <Input
              id={QUICK_QUANTITY_INPUT_ID}
              inputMode="decimal"
              autoComplete="off"
              aria-invalid={errors.quantity ? true : undefined}
              {...register('quantity', {
                validate: (value) =>
                  QUANTITY_PATTERN.test(value.trim()) || 'Enter an exact positive quantity.',
              })}
            />
          </Label>
        )}
        {errors.quantity && <Small role="alert">{errors.quantity.message}</Small>}
        <Label>
          Location
          <Select {...register('location')}>
            <option value="mode:inherit">Use batch default</option>
            <option value="mode:clear">No location (explicit)</option>
            <option value="mode:unknown">Explicitly unknown</option>
            <option value="mode:unset">Not selected</option>
            {locations.map((item) => (
              <option key={item.id} value={`observation:${item.id}`}>
                {item.label} (#{item.pk})
              </option>
            ))}
          </Select>
        </Label>
        <Small>Affects only this lot. Read another location in Capture to add it here.</Small>
        <Button type="submit" disabled={!isDirty}>
          Save lot values
        </Button>
      </Fieldset>
      <Button
        type="button"
        disabled={!isDirty || isSubmitting}
        onClick={() => {
          reset(defaults)
          onDirtyChange?.(false)
        }}
      >
        Discard lot edits
      </Button>
    </Form>
  )
}

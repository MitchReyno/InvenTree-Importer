import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import type { CaptureEditDto, CaptureSnapshotDto } from '@invimport/contracts'
import { Button, Fieldset, Form, Input, Label, Select, Small } from '../ui/primitives'

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
  edit: (change: CaptureEditDto['change']) => Promise<boolean | void>
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
  const {
    register,
    handleSubmit,
    watch,
    reset,
    formState: { errors, isDirty, dirtyFields, isSubmitting },
  } = useForm<Values>({ defaultValues: initialValues(lot) })
  const quantityMode = watch('quantityMode')
  const locations = batch.observations.filter((item) => item.model === 'location')

  useEffect(() => {
    onDirtyChange?.(isDirty)
  }, [isDirty, onDirtyChange])

  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange])

  async function save(values: Values) {
    const quantityTouched = Boolean(dirtyFields.quantityMode || dirtyFields.quantity)
    await edit({
      kind: 'lot',
      id: lot.id,
      ...(quantityTouched ? { quantity: quantityChange(values) } : {}),
      ...(dirtyFields.location ? { location: locationChange(batch, values.location) } : {}),
    })
  }

  return (
    <Form
      onChange={() => onDirtyChange?.(true)}
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
          reset(initialValues(lot))
          onDirtyChange?.(false)
        }}
      >
        Discard lot edits
      </Button>
    </Form>
  )
}

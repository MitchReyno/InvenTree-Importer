import { Small } from '#/components/ui'
import { Field, Input, Label, Select } from '#/forms'
import type { Quantity } from '#/capture/types'
type QuantityFieldProps = {
  value: Quantity
  defaults: boolean
  onChange: (value: Quantity) => void
}

export function QuantityField({ value, defaults, onChange }: QuantityFieldProps) {
  return (
    <Field>
      <Label>
        Quantity mode
        <Select
          value={value.mode}
          onChange={(e) =>
            onChange(
              e.target.value === 'set'
                ? { mode: 'set', value: '' }
                : { mode: e.target.value as 'unset' | 'unknown' | 'clear' | 'inherit' },
            )
          }
        >
          {!defaults && <option value="inherit">Use batch default</option>}
          <option value="unset">Not selected</option>
          <option value="unknown">Explicitly unknown</option>
          <option value="clear">Explicitly clear</option>
          <option value="set">Human exact quantity</option>
        </Select>
      </Label>
      {value.mode === 'set' && (
        <Label>
          Exact quantity (pieces)
          <Input
            required
            inputMode="decimal"
            pattern="(?=.*[1-9])(0|[1-9][0-9]{0,12})(\.[0-9]{0,5}[1-9])?"
            value={value.value}
            onChange={(e) => onChange({ mode: 'set', value: e.target.value })}
          />
          <Small>
            Positive decimal text, up to 6 decimal places. No exponent or trailing fractional zeros.
          </Small>
        </Label>
      )}
    </Field>
  )
}

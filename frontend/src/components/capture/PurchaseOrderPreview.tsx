import { useId, useState } from 'react'
import styled from 'styled-components'
import { color, space } from '../../theme/generated/tokens'
import type { CaptureSettingsIntentDto } from '@invimport/contracts'
import { AutoValueField } from '../ui/AutoValueField'
import { NotesField } from '../ui/TextField'
import { Small } from '../ui/primitives'
import { Button } from '../ui/Button'

type Props = {
  order: CaptureSettingsIntentDto['order']
  orderNote: string | null
}

const noop = () => undefined

/**
 * Purchase-order creation is unavailable. The preview shows the retained order context with
 * every control disabled; nothing here can save PO intent.
 */
export function PurchaseOrderPreview({ order, orderNote }: Props) {
  const id = useId()
  const [open, setOpen] = useState(false)
  return (
    <Unavailable aria-labelledby={`${id}-legend`}>
      <legend id={`${id}-legend`}>Purchase order · unavailable</legend>
      <label>
        <input type="checkbox" disabled aria-describedby={`${id}-why`} />
        Create a purchase order in InvenTree
      </label>
      <Small id={`${id}-why`}>
        Purchase-order creation is not yet available. These controls are disabled and no
        purchase-order request is saved or sent.
      </Small>
      <Toggle
        type="button"
        aria-expanded={open}
        aria-controls={`${id}-preview`}
        onClick={() => setOpen(!open)}
      >
        {open ? 'Hide purchase order preview' : 'Show purchase order preview'}
      </Toggle>
      {open && (
        <Preview id={`${id}-preview`}>
          <AutoValueField
            label="Order number"
            type="text"
            value={order.reference}
            onChange={noop}
            disabled
          />
          <AutoValueField
            label="Purchase date"
            type="date"
            value={order.purchase_date}
            onChange={noop}
            disabled
          />
          <NotesField
            toggleLabel="Add order notes"
            label="Order notes"
            value={orderNote}
            onChange={noop}
            disabled
          />
        </Preview>
      )}
    </Unavailable>
  )
}

const Unavailable = styled.fieldset`
  display: grid;
  gap: ${space[4]};
  margin: 0;
  padding: ${space[6]};
  color: ${color.muted};
  background: ${color.surface2};
  border: 1px solid ${color.lineStrong};
  border-radius: 5px;
  min-width: 0;
  label {
    display: flex;
    gap: ${space[4]};
    align-items: center;
  }
`
const Toggle = styled(Button)`
  justify-self: start;
`
const Preview = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 180px), 1fr));
  gap: ${space[5]};
`

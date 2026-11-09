import { useId, useState } from 'react'
import styled from 'styled-components'
import { space } from '#/theme/generated/tokens'
import type { CaptureSettingsIntentDto } from '@invimport/contracts'
import { AutoValueField, NotesField, DisabledFeature, Button } from '#/components/ui'

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
    <Unavailable>
      <DisabledFeature
        label="Create a purchase order in InvenTree"
        explanation="Purchase-order creation is not yet available. No purchase-order request is saved or sent; the preview shows the order details kept with this batch."
      />
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

const Unavailable = styled.div`
  display: grid;
  gap: ${space[4]};
  min-width: 0;
`
const Toggle = styled(Button)`
  justify-self: start;
`
const Preview = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 180px), 1fr));
  gap: ${space[5]};
`

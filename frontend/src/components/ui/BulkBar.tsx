import { useId, useState, type ReactNode } from 'react'
import styled from 'styled-components'
import { color, radius, size, space, typeVar } from '../../theme/generated/tokens'
import { formatCount, media } from './media'

type BulkBarProps = {
  count: number
  /** Without a field and `onApply` the bar carries only the selection actions. */
  field?: string
  value?: string
  onApply?: (value: string) => void
  onClear: () => void
  extraActions?: ReactNode
  label?: string
}

/** Applies one field value to every selected row; the apply label states its scope. */
export function BulkBar({
  count,
  field,
  value = '',
  onApply,
  onClear,
  extraActions,
  label = 'Bulk edit',
}: BulkBarProps) {
  const inputId = useId()
  const [draft, setDraft] = useState(value)

  return (
    <Bar role="region" aria-label={label}>
      <strong>{formatCount(count)} selected</strong>
      {field && onApply && (
        <>
          <label htmlFor={inputId}>{field}</label>
          <input id={inputId} value={draft} onChange={(event) => setDraft(event.target.value)} />
          <BarButton type="button" onClick={() => onApply(draft)}>
            Apply to {formatCount(count)}
          </BarButton>
        </>
      )}
      {extraActions}
      <BarButton type="button" onClick={onClear}>
        Clear selection
      </BarButton>
    </Bar>
  )
}

const Bar = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${space[4]};
  padding: ${space[4]} ${space[6]};
  border-radius: ${radius.card};
  background: ${color.fg};
  color: ${color.bg};
  /* On the inverted fg ground the accent ring is too faint, so focus uses the bg ink. */
  :focus-visible {
    outline-color: ${color.bg};
  }
  input,
  select {
    width: auto;
    min-width: 0;
    padding: ${space[2]} 7px;
    border: 0;
    border-radius: ${radius.input};
    background: ${color.bg};
    color: ${color.fg};
  }
  ${media.compact} {
    input,
    select,
    button {
      min-height: ${size.touch};
    }
  }
`

const BarButton = styled.button`
  padding: ${space[2]} 9px;
  border: 1px solid transparent;
  border-radius: ${radius.btn};
  background: ${color.bg};
  color: ${color.fg};
  font-size: ${typeVar.small.size};
  font-weight: ${typeVar.buttonLg.weight};
  cursor: pointer;
`

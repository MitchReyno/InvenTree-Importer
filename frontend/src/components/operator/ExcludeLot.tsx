import { useEffect, useState } from 'react'
import styled from 'styled-components'
import type { CaptureEditDto, CaptureSnapshotDto } from '@invimport/contracts'
import { space } from '../../theme/generated/tokens'
import { Button } from '../ui/Button'
import { Input, Label } from '../ui/primitives'

type Lot = CaptureSnapshotDto['lots'][number]

/** The reason form for leaving a lot out of the batch; a lot already out is included again. */
export function ExcludeForm({
  lot,
  disabled,
  edit,
  onDone,
  onDirtyChange,
}: {
  lot: Lot
  disabled: boolean
  edit: (change: CaptureEditDto['change']) => Promise<boolean | void>
  onDone: () => void
  onDirtyChange: (dirty: boolean) => void
}) {
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const kept = reason.trim()
  useEffect(() => {
    onDirtyChange(reason !== '')
  }, [reason, onDirtyChange])
  useEffect(() => () => onDirtyChange(false), [onDirtyChange])

  return (
    <Form
      aria-label={`Exclude ${lot.label}`}
      onSubmit={async (event) => {
        event.preventDefault()
        setSaving(true)
        try {
          // The batch edit resolves false when the save was refused or not confirmed.
          if ((await edit({ kind: 'lot_exclusion', lot_id: lot.id, reason: kept })) !== false) {
            setReason('')
            onDone()
          }
        } finally {
          setSaving(false)
        }
      }}
    >
      <Label>
        Why leave {lot.label} out?
        <Input
          value={reason}
          maxLength={500}
          disabled={disabled || saving}
          onChange={(event) => setReason(event.target.value.replace(/[\r\n]/g, ' '))}
        />
      </Label>
      <span>
        <Button type="submit" size="sm" variant="primary" disabled={disabled || saving || !kept}>
          Exclude this lot
        </Button>{' '}
        <Button size="sm" variant="ghost" disabled={saving} onClick={onDone}>
          Cancel
        </Button>
      </span>
    </Form>
  )
}

const Form = styled.form`
  display: grid;
  gap: ${space[3]};
`

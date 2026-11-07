import { useState } from 'react'
import type { CaptureEditDto, CaptureSnapshotDto } from '@invimport/contracts'
import { Label, Select } from '../ui/primitives'
import { Button } from '../ui/Button'

interface Props {
  batch: CaptureSnapshotDto
  observationId: string
  /** The observation's current lot, if it is in a live one. */
  lotId: string | null
  name: string
  edit?: (change: CaptureEditDto['change']) => Promise<boolean | void>
  disabled: boolean
}

/** The operator's own move of one observation to another lot, or out of any lot. */
export function ObservationMove({ batch, observationId, lotId, name, edit, disabled }: Props) {
  const targets = batch.lots.filter((lot) => !lot.retired && lot.id !== lotId)
  const [target, setTarget] = useState('')
  if (!targets.length && lotId === null) {
    return null
  }
  return (
    <span>
      <Label>
        Move {name} to
        <Select
          value={target}
          disabled={disabled || !edit}
          onChange={(event) => setTarget(event.target.value)}
        >
          <option value="">Choose a lot…</option>
          {targets.map((lot) => (
            <option key={lot.id} value={lot.id}>
              {lot.label}
            </option>
          ))}
          {lotId !== null && <option value="none">No lot</option>}
        </Select>
      </Label>{' '}
      <Button
        type="button"
        disabled={disabled || !edit || !target}
        onClick={() =>
          void edit?.({
            kind: 'observation_move',
            observation_id: observationId,
            lot_id: target === 'none' ? null : target,
          })
        }
      >
        Move
      </Button>
    </span>
  )
}
